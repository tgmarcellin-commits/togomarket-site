import {
  db,
  qrTokensTable,
  ordersTable,
  deliveryWorkflowJobsTable,
  deliveryLocationsTable,
  deliveryAuditLogsTable,
} from "@workspace/db";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import {
  constantTimeHexEqual,
  createQrToken,
  hashOpaqueToken,
} from "./marketplace-security";
import { COURSE_NOT_PAID_MESSAGE, settleDeliveredOrder, settleReturnedOrder } from "./settlement-service";
import { BusinessRuleError } from "./route-errors";
import { findLatestOrderLink } from "./party-locations";
import { getIo } from "./socket-io";
import { logger } from "./logger";

/**
 * Prévient en temps réel la conversation que le livreur vient de demander son QR code : l'écran de l'acheteur
 * (livraison) ou du vendeur (retour) ouvre alors le scanner. Ne lève jamais d'erreur.
 */
async function notifyQrRequested(orderId: number, stage: "delivery" | "return"): Promise<void> {
  try {
    const link = await findLatestOrderLink(orderId);
    if (!link) return;
    const payload = { conversationId: link.conversationId, orderId, stage };
    const io = getIo();
    io.to(`conv:${link.conversationId}`).emit("delivery_qr_requested", payload);
    io.to(`order_${orderId}`).emit("delivery_qr_requested", payload);
  } catch (err) {
    logger.warn({ err, orderId }, "Notification de demande de QR impossible");
  }
}

export const QR_TTL_SECONDS = 180; // Exactly 3 minutes
export const MAX_PROXIMITY_METERS = 300; // 300m radius between scanner and driver
export const ARRIVAL_ZONE_METERS = 1000; // 1km arrival zone

export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function requestDeliveryQrToken(params: {
  deliveryJobId: number;
  driverId: number;
  stage: "delivery" | "return";
  currentLatitude?: number;
  currentLongitude?: number;
}) {
  const { deliveryJobId, driverId, stage, currentLatitude, currentLongitude } = params;

  // 1. Verify job exists and belongs to this driver
  const [job] = await db
    .select()
    .from(deliveryWorkflowJobsTable)
    .where(and(eq(deliveryWorkflowJobsTable.id, deliveryJobId), eq(deliveryWorkflowJobsTable.driverId, driverId)))
    .limit(1);

  if (!job) {
    throw new BusinessRuleError("Mission de livraison introuvable ou non assignée à ce livreur.");
  }

  if (job.acceptanceStatus !== "accepted_by_driver") {
    throw new BusinessRuleError(`La mission doit être acceptée par le livreur (statut actuel: ${job.acceptanceStatus}).`);
  }

  // 2. Verify order status
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, job.orderId))
    .limit(1);

  if (!order) {
    throw new BusinessRuleError(`Commande #${job.orderId} introuvable.`);
  }

  // Le QR n'est délivré qu'une fois la course payée par l'acheteur (cahier des charges, section 10)
  if (!order.driverPaymentConfirmedAt) {
    throw new BusinessRuleError(COURSE_NOT_PAID_MESSAGE, 409);
  }

  if (stage === "delivery") {
    if (order.status !== "IN_TRANSIT" && order.status !== "ASSIGNED") {
      throw new BusinessRuleError(`Statut de commande invalide pour QR livraison: ${order.status}.`);
    }
  } else if (stage === "return") {
    if (
      order.status !== "IN_TRANSIT" &&
      order.status !== "ASSIGNED" &&
      order.status !== "RETURNING_TO_SELLER" &&
      order.status !== "RETURN_AT_SELLER"
    ) {
      throw new BusinessRuleError(`Statut de commande invalide pour QR retour: ${order.status}.`);
    }
  }

  // 3. Arrival zone validation
  let latestDriverLat = currentLatitude ?? null;
  let latestDriverLon = currentLongitude ?? null;

  if (!latestDriverLat || !latestDriverLon) {
    const [latestLocation] = await db
      .select()
      .from(deliveryLocationsTable)
      .where(eq(deliveryLocationsTable.deliveryJobId, job.id))
      .orderBy(desc(deliveryLocationsTable.recordedAt), desc(deliveryLocationsTable.createdAt))
      .limit(1);

    if (latestLocation) {
      latestDriverLat = latestLocation.latitude;
      latestDriverLon = latestLocation.longitude;
    }
  }

  // 4. Generate 3-minute QR token
  const { rawToken, tokenHash, expiresAt } = createQrToken(QR_TTL_SECONDS);

  const [record] = await db
    .insert(qrTokensTable)
    .values({
      orderId: job.orderId,
      deliveryJobId: job.id,
      driverId: job.driverId,
      stage,
      tokenHash,
      expiresAt,
      usedAt: null,
    })
    .returning();

  await db.insert(deliveryAuditLogsTable).values({
    actorType: "driver",
    actorId: String(driverId),
    action: `qr_token_requested_${stage}`,
    orderId: job.orderId,
    metadata: {
      deliveryJobId: job.id,
      stage,
      expiresAt: expiresAt.toISOString(),
      ttlSeconds: QR_TTL_SECONDS,
      driverPositionKnown: Boolean(latestDriverLat && latestDriverLon),
    },
  });

  void notifyQrRequested(job.orderId, stage);

  return {
    rawToken,
    stage,
    orderId: job.orderId,
    deliveryJobId: job.id,
    expiresAt: expiresAt.toISOString(),
    expiresInSeconds: QR_TTL_SECONDS,
  };
}

export async function scanAndVerifyQrToken(params: {
  rawToken: string;
  scannerRole: "buyer" | "seller" | "driver";
  scannerLatitude: number;
  scannerLongitude: number;
  idempotencyKey?: string;
  authorizeScanner: (orderId: number) => Promise<boolean>;
}) {
  const { rawToken, scannerRole, scannerLatitude, scannerLongitude, idempotencyKey, authorizeScanner } = params;

  if (!rawToken || typeof rawToken !== "string") {
    throw new BusinessRuleError("Token QR requis.");
  }

  // Validate scanner coordinates
  if (
    typeof scannerLatitude !== "number" ||
    !Number.isFinite(scannerLatitude) ||
    scannerLatitude < -90 ||
    scannerLatitude > 90 ||
    typeof scannerLongitude !== "number" ||
    !Number.isFinite(scannerLongitude) ||
    scannerLongitude < -180 ||
    scannerLongitude > 180
  ) {
    throw new BusinessRuleError("Coordonnées GPS du scanner invalides ou manquantes.");
  }

  // Driver CANNOT self-confirm financial settlement
  if (scannerRole === "driver") {
    await db.insert(deliveryAuditLogsTable).values({
      actorType: "driver",
      action: "qr_scan_rejected_driver_self_confirmation",
      metadata: { reason: "Le livreur ne peut pas auto-confirmer le règlement financier" },
    });
    throw new BusinessRuleError("Interdit: le livreur ne peut pas auto-confirmer la livraison ou le retour.");
  }

  const tokenHash = hashOpaqueToken(rawToken);

  // Find token in database
  const [qrRecord] = await db
    .select()
    .from(qrTokensTable)
    .where(eq(qrTokensTable.tokenHash, tokenHash))
    .limit(1);

  if (!qrRecord) {
    throw new BusinessRuleError("QR code invalide ou introuvable.");
  }
  if (!(await authorizeScanner(qrRecord.orderId))) {
    throw new BusinessRuleError("Accès refusé à cette validation de livraison.");
  }

  // Vérifié AVANT de consommer le QR : un QR ne doit jamais être brûlé par un règlement refusé
  const [paidCheck] = await db
    .select({ driverPaymentConfirmedAt: ordersTable.driverPaymentConfirmedAt })
    .from(ordersTable)
    .where(eq(ordersTable.id, qrRecord.orderId))
    .limit(1);
  if (!paidCheck?.driverPaymentConfirmedAt) {
    throw new BusinessRuleError(COURSE_NOT_PAID_MESSAGE, 409);
  }

  // Constant-time token verification
  if (!constantTimeHexEqual(tokenHash, qrRecord.tokenHash)) {
    throw new BusinessRuleError("QR code falsifié.");
  }

  // Check single-use / replay protection
  if (qrRecord.usedAt !== null) {
    throw new BusinessRuleError("Ce QR code a déjà été utilisé (protection anti-rejeu).");
  }

  // Check expiration (at most 3 minutes)
  const now = new Date();
  if (qrRecord.expiresAt.getTime() <= now.getTime()) {
    throw new BusinessRuleError("Ce QR code a expiré (durée maximale de validité: 3 minutes).");
  }

  // Role binding verification
  if (qrRecord.stage === "delivery" && scannerRole !== "buyer") {
    throw new BusinessRuleError("Seul l'acheteur est autorisé à scanner le QR de livraison.");
  }

  if (qrRecord.stage === "return" && scannerRole !== "seller") {
    throw new BusinessRuleError("Seul le vendeur est autorisé à scanner le QR de retour.");
  }

  // Retrieve latest trusted driver location for proximity verification
  let driverLat: number | null = null;
  let driverLon: number | null = null;

  if (qrRecord.deliveryJobId) {
    const [latestDriverLocation] = await db
      .select()
      .from(deliveryLocationsTable)
      .where(eq(deliveryLocationsTable.deliveryJobId, qrRecord.deliveryJobId))
      .orderBy(desc(deliveryLocationsTable.recordedAt), desc(deliveryLocationsTable.createdAt))
      .limit(1);

    if (latestDriverLocation) {
      driverLat = latestDriverLocation.latitude;
      driverLon = latestDriverLocation.longitude;
    }
  }

  if (driverLat === null || driverLon === null) {
    const [locByOrder] = await db
      .select()
      .from(deliveryLocationsTable)
      .where(eq(deliveryLocationsTable.orderId, qrRecord.orderId))
      .orderBy(desc(deliveryLocationsTable.recordedAt), desc(deliveryLocationsTable.createdAt))
      .limit(1);

    if (locByOrder) {
      driverLat = locByOrder.latitude;
      driverLon = locByOrder.longitude;
    }
  }

  if (driverLat === null || driverLon === null) {
    throw new BusinessRuleError("Position GPS du livreur introuvable pour la vérification de proximité.");
  }

  // Compute haversine proximity distance
  const proximityDistanceMeters = Math.round(
    haversineDistanceMeters(scannerLatitude, scannerLongitude, driverLat, driverLon),
  );

  if (proximityDistanceMeters > MAX_PROXIMITY_METERS) {
    await db.insert(deliveryAuditLogsTable).values({
      actorType: scannerRole,
      action: "qr_proximity_check_failed",
      orderId: qrRecord.orderId,
      metadata: {
        proximityDistanceMeters,
        maxAllowedMeters: MAX_PROXIMITY_METERS,
        scannerCoordinates: { lat: scannerLatitude, lon: scannerLongitude },
        driverCoordinates: { lat: driverLat, lon: driverLon },
      },
    });
    throw new BusinessRuleError(
      `Échec de vérification de proximité: vous êtes à ${proximityDistanceMeters}m du livreur (maximum autorisé: ${MAX_PROXIMITY_METERS}m). Vous devez être face au livreur pour valider.`,
    );
  }

  // Mark token consumed with full scan audit
  await db
    .update(qrTokensTable)
    .set({
      usedAt: now,
      scannedByRole: scannerRole,
      scannerLatitude,
      scannerLongitude,
      proximityMeters: proximityDistanceMeters,
    })
    .where(eq(qrTokensTable.id, qrRecord.id));

  await db.insert(deliveryAuditLogsTable).values({
    actorType: scannerRole,
    action: `qr_scanned_and_verified_${qrRecord.stage}`,
    orderId: qrRecord.orderId,
    metadata: {
      qrTokenId: qrRecord.id,
      stage: qrRecord.stage,
      proximityDistanceMeters,
      scannerRole,
    },
  });

  // Execute atomic transactional settlement
  if (qrRecord.stage === "delivery") {
    const settlement = await settleDeliveredOrder({
      orderId: qrRecord.orderId,
      deliveryJobId: qrRecord.deliveryJobId ?? undefined,
      idempotencyKey,
    });
    return {
      success: true,
      stage: "delivery",
      orderId: qrRecord.orderId,
      proximityDistanceMeters,
      settlement,
    };
  } else {
    const settlement = await settleReturnedOrder({
      orderId: qrRecord.orderId,
      deliveryJobId: qrRecord.deliveryJobId ?? undefined,
      idempotencyKey,
    });
    return {
      success: true,
      stage: "return",
      orderId: qrRecord.orderId,
      proximityDistanceMeters,
      settlement,
    };
  }
}
