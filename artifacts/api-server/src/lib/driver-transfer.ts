import { and, desc, eq, gt, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import {
  conversationsTable,
  db,
  deliveryAuditLogsTable,
  deliveryWorkflowJobsTable,
  driverPresenceTable,
  driversTable,
  ordersTable,
  qrTokensTable,
  whatsappNotificationsTable,
} from "@workspace/db";
import type { DbOrTx } from "./accounting-ledger";
import { createDriverNotification } from "./driver-notifications";
import { sendDriverPush } from "./driver-push";
import { logger } from "./logger";
import { findLatestOrderLink, getPartyLocations, isValidCoordinatePair } from "./party-locations";
import { BusinessRuleError } from "./route-errors";
import { getIo } from "./socket-io";
import { sendVendorPush } from "./vendor-push";
import { sendWhatsAppUtilityTemplate } from "./whatsapp-api";

/**
 * Transfert d'une course entre livreurs.
 *
 *  1. Le livreur A a accepté la course (mission J1, accepted_by_driver) et la commande est en cours.
 *  2. Il choisit un collègue B, disponible et proche de la position du vendeur : une OFFRE (mission J2, liée à J1
 *     par transferred_from_job_id) est créée. Tant que B n'a pas accepté, la course reste à A, qui peut la reprendre.
 *  3. B accepte -> J1 devient « transferred » (A perd tout droit sur la livraison), J2 devient « accepted_by_driver ».
 *     B refuse ou laisse expirer -> A garde la course.
 *  4. A peut aussi refuser la course (« abandoned_by_driver ») : acheteur et vendeur doivent choisir un autre livreur.
 * La course déjà payée par l'acheteur reste valable : seul le livreur change.
 */

/** Rayon autour de la position du vendeur dans lequel un collègue est proposé (km). */
export const TRANSFER_RADIUS_KM = Number(process.env.DRIVER_TRANSFER_RADIUS_KM) > 0
  ? Number(process.env.DRIVER_TRANSFER_RADIUS_KM)
  : 10;
/** Une position de livreur plus ancienne que cela n'est plus considérée comme « proche ». */
export const PRESENCE_MAX_AGE_MS = 15 * 60 * 1000;
/** Délai de réponse du collègue (même durée qu'une assignation classique). */
export const TRANSFER_OFFER_TTL_MS = 15 * 60 * 1000;

const TRANSFERABLE_ORDER_STATUSES = ["ASSIGNED", "IN_TRANSIT"] as const;
const ACTIVE_ORDER_STATUSES = ["ASSIGNED", "IN_TRANSIT", "RETURNING_TO_SELLER", "RETURN_AT_SELLER"] as const;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ───────────────────────── présence des livreurs disponibles ───────────────────────── */

export async function updateDriverPresence(
  driverId: number,
  latitude: unknown,
  longitude: unknown,
  accuracyMeters: unknown,
): Promise<void> {
  if (!isValidCoordinatePair(latitude, longitude)) {
    throw new BusinessRuleError("Position GPS invalide.", 400);
  }
  const accuracy = typeof accuracyMeters === "number" && Number.isFinite(accuracyMeters) && accuracyMeters >= 0
    ? accuracyMeters
    : null;
  const now = new Date();
  await db
    .insert(driverPresenceTable)
    .values({ driverId, latitude: latitude as number, longitude: longitude as number, accuracyMeters: accuracy, updatedAt: now })
    .onConflictDoUpdate({
      target: driverPresenceTable.driverId,
      set: { latitude: latitude as number, longitude: longitude as number, accuracyMeters: accuracy, updatedAt: now },
    });
}

/* ───────────────────────── utilitaires internes ───────────────────────── */

async function audit(
  tx: DbOrTx,
  actorId: number | string,
  action: string,
  orderId: number | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  await tx.insert(deliveryAuditLogsTable).values({
    actorType: "driver",
    actorId: String(actorId),
    action,
    orderId,
    metadata,
  });
}

/** Remet un livreur disponible, sauf s'il a une autre course acceptée en cours ou une proposition en attente. */
async function releaseDriverIfIdle(tx: DbOrTx, driverId: number, excludeJobId: number | null): Promise<void> {
  const now = new Date();
  const busy = await tx
    .select({ id: deliveryWorkflowJobsTable.id })
    .from(deliveryWorkflowJobsTable)
    .innerJoin(ordersTable, eq(deliveryWorkflowJobsTable.orderId, ordersTable.id))
    .where(and(
      eq(deliveryWorkflowJobsTable.driverId, driverId),
      excludeJobId !== null ? ne(deliveryWorkflowJobsTable.id, excludeJobId) : sql`true`,
      or(
        and(
          eq(deliveryWorkflowJobsTable.acceptanceStatus, "accepted_by_driver"),
          inArray(ordersTable.status, [...ACTIVE_ORDER_STATUSES]),
        ),
        and(
          eq(deliveryWorkflowJobsTable.acceptanceStatus, "pending_driver_response"),
          gt(deliveryWorkflowJobsTable.assignmentExpiresAt, now),
        ),
      ),
    ))
    .limit(1);
  if (busy.length > 0) return;
  await tx.update(driversTable).set({ isAvailable: true, updatedAt: now }).where(eq(driversTable.id, driverId));
}

/** Invalide les QR codes non utilisés d'une mission : un ancien QR ne doit jamais régler pour un livreur dessaisi. */
async function expireQrTokens(tx: DbOrTx, deliveryJobId: number): Promise<void> {
  await tx
    .update(qrTokensTable)
    .set({ expiresAt: new Date() })
    .where(and(eq(qrTokensTable.deliveryJobId, deliveryJobId), sql`${qrTokensTable.usedAt} is null`));
}

async function loadAcceptedJob(tx: DbOrTx, driverId: number, jobId: number, lock: boolean) {
  const query = tx
    .select({
      id: deliveryWorkflowJobsTable.id,
      orderId: deliveryWorkflowJobsTable.orderId,
      acceptanceStatus: deliveryWorkflowJobsTable.acceptanceStatus,
      orderStatus: ordersTable.status,
    })
    .from(deliveryWorkflowJobsTable)
    .innerJoin(ordersTable, eq(deliveryWorkflowJobsTable.orderId, ordersTable.id))
    .where(and(eq(deliveryWorkflowJobsTable.id, jobId), eq(deliveryWorkflowJobsTable.driverId, driverId)))
    .limit(1);
  const [job] = lock ? await query.for("update", { of: deliveryWorkflowJobsTable }) : await query;
  if (!job) throw new BusinessRuleError("Mission introuvable.", 404);
  if (job.acceptanceStatus !== "accepted_by_driver") {
    throw new BusinessRuleError("Cette course n'est pas (ou plus) en cours pour vous.", 409);
  }
  if (!(TRANSFERABLE_ORDER_STATUSES as readonly string[]).includes(job.orderStatus)) {
    throw new BusinessRuleError("Cette course n'est plus transférable.", 409);
  }
  return job;
}

/** Offres de transfert en attente (non expirées) émises depuis la mission J1. */
async function pendingOffersFrom(tx: DbOrTx, fromJobId: number, lock: boolean) {
  const query = tx
    .select({
      id: deliveryWorkflowJobsTable.id,
      driverId: deliveryWorkflowJobsTable.driverId,
      orderId: deliveryWorkflowJobsTable.orderId,
      expiresAt: deliveryWorkflowJobsTable.assignmentExpiresAt,
    })
    .from(deliveryWorkflowJobsTable)
    .where(and(
      eq(deliveryWorkflowJobsTable.transferredFromJobId, fromJobId),
      eq(deliveryWorkflowJobsTable.acceptanceStatus, "pending_driver_response"),
    ));
  return lock ? await query.for("update") : await query;
}

async function sellerPosition(orderId: number): Promise<{ latitude: number; longitude: number } | null> {
  const link = await findLatestOrderLink(orderId);
  if (!link) return null;
  const positions = await getPartyLocations(link.conversationId);
  return positions.seller ? { latitude: positions.seller.latitude, longitude: positions.seller.longitude } : null;
}

/** Prévient l'acheteur et le vendeur (temps réel) que les informations du livreur ont changé. */
async function notifyDriverChanged(orderId: number, kind: "transferred" | "abandoned", driverName: string | null): Promise<void> {
  try {
    const link = await findLatestOrderLink(orderId);
    if (!link) return;
    const payload = { conversationId: link.conversationId, orderId, kind, driverName };
    try {
      const io = getIo();
      io.to(`conv:${link.conversationId}`).emit("delivery_driver_changed", payload);
      io.to(`order_${orderId}`).emit("delivery_driver_changed", payload);
    } catch {
      // serveur socket absent (tests)
    }
    const [conversation] = await db
      .select({ vendorId: conversationsTable.vendorId })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, link.conversationId))
      .limit(1);
    if (conversation) {
      await sendVendorPush(conversation.vendorId, kind === "transferred"
        ? {
            title: "Nouveau livreur pour votre commande",
            body: `${driverName ?? "Un nouveau livreur"} a repris la livraison de la commande #${orderId}.`,
            tag: `driver-changed-${orderId}`,
          }
        : {
            title: "Livreur indisponible",
            body: `Le livreur de la commande #${orderId} ne peut plus assurer la course : assignez un nouveau livreur.`,
            tag: `driver-changed-${orderId}`,
          });
    }
  } catch (err) {
    logger.warn({ err, orderId }, "Notification de changement de livreur impossible");
  }
}

async function notifyDriver(
  driverId: number,
  orderId: number,
  kind: string,
  title: string,
  body: string,
): Promise<void> {
  await createDriverNotification({ driverId, orderId, kind, title, body });
  await sendDriverPush(driverId, { title, body, url: "/driver-connexion", tag: kind });
}

async function notifyOfferByWhatsApp(driverId: number, orderId: number): Promise<void> {
  const [driver] = await db
    .select({ firstName: driversTable.firstName, phone: driversTable.phone, whatsappNumber: driversTable.whatsappNumber })
    .from(driversTable)
    .where(eq(driversTable.id, driverId))
    .limit(1);
  const target = driver?.whatsappNumber || driver?.phone;
  if (!target) return;
  // Même modèle Utilitaire que l'assignation classique : « une nouvelle course vous a été proposée »
  const templateName = process.env.WHATSAPP_UTILITY_TEMPLATE_NAME?.trim() || "driver_assignment_utility";
  try {
    await sendWhatsAppUtilityTemplate(target, templateName, [driver?.firstName?.trim() || "Livreur"]);
    await db.insert(whatsappNotificationsTable).values({
      recipientPhone: target,
      messageContent: `[template ${templateName}] transfert de la commande #${orderId}`,
      deliveryStatus: "sent",
      providerResponse: null,
    });
  } catch (err) {
    await db.insert(whatsappNotificationsTable).values({
      recipientPhone: target,
      messageContent: `[template ${templateName}] transfert de la commande #${orderId}`,
      deliveryStatus: "fallback_triggered",
      providerResponse: { error: err instanceof Error ? err.message : String(err) },
    }).catch(() => undefined);
  }
}

/* ───────────────────────── liste des collègues proches du vendeur ───────────────────────── */

export type TransferCandidate = {
  driverId: number;
  firstName: string;
  photoUrl: string | null;
  workZone: string | null;
  distanceKm: number;
};

export type TransferOverview = {
  orderId: number;
  sellerPositionKnown: boolean;
  radiusKm: number;
  candidates: TransferCandidate[];
  pendingOffer: { jobId: number; driverId: number; firstName: string; expiresAt: string | null } | null;
};

export async function getTransferOverview(driverId: number, jobId: number): Promise<TransferOverview> {
  const job = await loadAcceptedJob(db, driverId, jobId, false);
  const offers = await pendingOffersFrom(db, job.id, false);
  const now = Date.now();
  const liveOffer = offers.find((offer) => !offer.expiresAt || offer.expiresAt.getTime() > now) ?? null;

  let pendingOffer: TransferOverview["pendingOffer"] = null;
  if (liveOffer) {
    const [target] = await db
      .select({ firstName: driversTable.firstName })
      .from(driversTable)
      .where(eq(driversTable.id, liveOffer.driverId))
      .limit(1);
    pendingOffer = {
      jobId: liveOffer.id,
      driverId: liveOffer.driverId,
      firstName: target?.firstName ?? "",
      expiresAt: liveOffer.expiresAt?.toISOString() ?? null,
    };
  }

  const seller = await sellerPosition(job.orderId);
  if (!seller) {
    return { orderId: job.orderId, sellerPositionKnown: false, radiusKm: TRANSFER_RADIUS_KM, candidates: [], pendingOffer };
  }

  const freshSince = new Date(now - PRESENCE_MAX_AGE_MS);
  const rows = await db
    .select({
      driverId: driversTable.id,
      firstName: driversTable.firstName,
      photoUrl: driversTable.photoUrl,
      workZone: driversTable.workZone,
      latitude: driverPresenceTable.latitude,
      longitude: driverPresenceTable.longitude,
    })
    .from(driversTable)
    .innerJoin(driverPresenceTable, eq(driverPresenceTable.driverId, driversTable.id))
    .where(and(
      eq(driversTable.isActive, true),
      eq(driversTable.isAvailable, true),
      ne(driversTable.id, driverId),
      gt(driverPresenceTable.updatedAt, freshSince),
    ));

  const candidates = rows
    .map((row) => ({
      driverId: row.driverId,
      firstName: row.firstName,
      photoUrl: row.photoUrl,
      workZone: row.workZone,
      distanceKm: haversineKm(seller.latitude, seller.longitude, row.latitude, row.longitude),
    }))
    .filter((row) => row.distanceKm <= TRANSFER_RADIUS_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 20)
    .map((row) => ({ ...row, distanceKm: Math.round(row.distanceKm * 10) / 10 }));

  return { orderId: job.orderId, sellerPositionKnown: true, radiusKm: TRANSFER_RADIUS_KM, candidates, pendingOffer };
}

/* ───────────────────────── offre de transfert ───────────────────────── */

export async function createTransferOffer(params: {
  driverId: number;
  jobId: number;
  toDriverId: number;
}): Promise<{ offerJobId: number; toDriverName: string; expiresAt: string }> {
  const { driverId, jobId, toDriverId } = params;
  if (!Number.isInteger(toDriverId) || toDriverId <= 0 || toDriverId === driverId) {
    throw new BusinessRuleError("Livreur destinataire invalide.", 400);
  }

  const result = await db.transaction(async (tx) => {
    const job = await loadAcceptedJob(tx, driverId, jobId, true);

    const existing = await pendingOffersFrom(tx, job.id, true);
    const now = new Date();
    if (existing.some((offer) => !offer.expiresAt || offer.expiresAt.getTime() > now.getTime())) {
      throw new BusinessRuleError("Un transfert est déjà en attente de réponse. Reprenez la commande pour en proposer un autre.", 409);
    }

    const seller = await sellerPosition(job.orderId);
    if (!seller) {
      throw new BusinessRuleError("La position du vendeur n'est plus disponible : le transfert est impossible.", 409);
    }

    const [target] = await tx
      .select({ id: driversTable.id, firstName: driversTable.firstName, isActive: driversTable.isActive, isAvailable: driversTable.isAvailable })
      .from(driversTable)
      .where(eq(driversTable.id, toDriverId))
      .for("update")
      .limit(1);
    if (!target || !target.isActive || !target.isAvailable) {
      throw new BusinessRuleError("Ce livreur n'est plus disponible.", 409);
    }
    const [presence] = await tx
      .select()
      .from(driverPresenceTable)
      .where(eq(driverPresenceTable.driverId, toDriverId))
      .limit(1);
    if (
      !presence
      || now.getTime() - presence.updatedAt.getTime() > PRESENCE_MAX_AGE_MS
      || haversineKm(seller.latitude, seller.longitude, presence.latitude, presence.longitude) > TRANSFER_RADIUS_KM
    ) {
      throw new BusinessRuleError("Ce livreur n'est plus proche du vendeur.", 409);
    }

    const expiresAt = new Date(now.getTime() + TRANSFER_OFFER_TTL_MS);
    const [previous] = await tx
      .select({ id: deliveryWorkflowJobsTable.id, acceptanceStatus: deliveryWorkflowJobsTable.acceptanceStatus })
      .from(deliveryWorkflowJobsTable)
      .where(and(eq(deliveryWorkflowJobsTable.orderId, job.orderId), eq(deliveryWorkflowJobsTable.driverId, toDriverId)))
      .for("update")
      .limit(1);

    let offerJobId: number;
    if (previous) {
      if (previous.acceptanceStatus === "accepted_by_driver" || previous.acceptanceStatus === "pending_driver_response") {
        throw new BusinessRuleError("Ce livreur a déjà une proposition pour cette commande.", 409);
      }
      // Une ligne (commande, livreur) existe déjà (ancienne proposition close) : on la rouvre
      await tx
        .update(deliveryWorkflowJobsTable)
        .set({
          acceptanceStatus: "pending_driver_response",
          assignmentExpiresAt: expiresAt,
          transferredFromJobId: job.id,
          whatsappNotifiedAt: null,
          acceptedAt: null,
          refusedAt: null,
          cancelledAt: null,
          cancelReason: null,
          updatedAt: now,
        })
        .where(eq(deliveryWorkflowJobsTable.id, previous.id));
      offerJobId = previous.id;
    } else {
      const [created] = await tx
        .insert(deliveryWorkflowJobsTable)
        .values({
          orderId: job.orderId,
          driverId: toDriverId,
          acceptanceStatus: "pending_driver_response",
          assignmentExpiresAt: expiresAt,
          transferredFromJobId: job.id,
        })
        .returning({ id: deliveryWorkflowJobsTable.id });
      offerJobId = created!.id;
    }

    // Le collègue est réservé le temps de sa réponse
    await tx.update(driversTable).set({ isAvailable: false, updatedAt: now }).where(eq(driversTable.id, toDriverId));
    await audit(tx, driverId, "delivery_transfer_offered", job.orderId, { fromJobId: job.id, offerJobId, toDriverId });

    return { offerJobId, toDriverName: target.firstName, orderId: job.orderId, expiresAt };
  });

  const [giver] = await db.select({ firstName: driversTable.firstName }).from(driversTable).where(eq(driversTable.id, driverId)).limit(1);
  await notifyDriver(
    toDriverId,
    result.orderId,
    `transfer_offer_${result.offerJobId}`,
    "Course proposée par un collègue",
    `${giver?.firstName ?? "Un collègue"} vous propose de reprendre la commande #${result.orderId}. Ouvrez « Mes assignations » pour accepter ou refuser (15 minutes).`,
  );
  void notifyOfferByWhatsApp(toDriverId, result.orderId);

  return { offerJobId: result.offerJobId, toDriverName: result.toDriverName, expiresAt: result.expiresAt.toISOString() };
}

/** « Reprendre la commande » : annule l'offre en attente, la course reste au premier livreur. */
export async function cancelTransferOffer(driverId: number, jobId: number): Promise<{ cancelled: number }> {
  const cancelledOffers = await db.transaction(async (tx) => {
    const [job] = await tx
      .select({ id: deliveryWorkflowJobsTable.id, orderId: deliveryWorkflowJobsTable.orderId })
      .from(deliveryWorkflowJobsTable)
      .where(and(eq(deliveryWorkflowJobsTable.id, jobId), eq(deliveryWorkflowJobsTable.driverId, driverId)))
      .for("update")
      .limit(1);
    if (!job) throw new BusinessRuleError("Mission introuvable.", 404);

    const offers = await pendingOffersFrom(tx, job.id, true);
    const now = new Date();
    for (const offer of offers) {
      await tx
        .update(deliveryWorkflowJobsTable)
        .set({ acceptanceStatus: "cancelled_by_reassignment", cancelledAt: now, cancelReason: "transfer_cancelled_by_giver", updatedAt: now })
        .where(eq(deliveryWorkflowJobsTable.id, offer.id));
      await releaseDriverIfIdle(tx, offer.driverId, offer.id);
      await audit(tx, driverId, "delivery_transfer_cancelled", job.orderId, { fromJobId: job.id, offerJobId: offer.id, toDriverId: offer.driverId });
    }
    return offers;
  });

  for (const offer of cancelledOffers) {
    await notifyDriver(
      offer.driverId,
      offer.orderId,
      `transfer_cancelled_${offer.id}`,
      "Transfert annulé",
      `Le livreur a repris la commande #${offer.orderId} : le transfert est annulé.`,
    );
  }
  return { cancelled: cancelledOffers.length };
}

/* ───────────────────────── réponse du collègue ───────────────────────── */

/** Cette mission est-elle une offre de transfert destinée à ce livreur ? */
export async function isTransferOffer(jobId: number, driverId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: deliveryWorkflowJobsTable.id })
    .from(deliveryWorkflowJobsTable)
    .where(and(
      eq(deliveryWorkflowJobsTable.id, jobId),
      eq(deliveryWorkflowJobsTable.driverId, driverId),
      isNotNull(deliveryWorkflowJobsTable.transferredFromJobId),
    ))
    .limit(1);
  return Boolean(row);
}

export async function respondToTransferOffer(params: {
  driverId: number;
  jobId: number;
  action: "accept" | "refuse";
}): Promise<{ status: "accepted" | "refused" }> {
  const { driverId, jobId, action } = params;
  const outcome = await db.transaction(async (tx) => {
    // Verrous pris dans le MÊME ordre que les autres opérations (mission d'origine, puis offre) : pas de blocage croisé
    const [peek] = await tx
      .select({ fromJobId: deliveryWorkflowJobsTable.transferredFromJobId })
      .from(deliveryWorkflowJobsTable)
      .where(and(
        eq(deliveryWorkflowJobsTable.id, jobId),
        eq(deliveryWorkflowJobsTable.driverId, driverId),
        isNotNull(deliveryWorkflowJobsTable.transferredFromJobId),
      ))
      .limit(1);
    if (!peek || peek.fromJobId === null) throw new BusinessRuleError("Proposition introuvable.", 404);

    const [original] = await tx
      .select({
        id: deliveryWorkflowJobsTable.id,
        driverId: deliveryWorkflowJobsTable.driverId,
        acceptanceStatus: deliveryWorkflowJobsTable.acceptanceStatus,
        orderStatus: ordersTable.status,
      })
      .from(deliveryWorkflowJobsTable)
      .innerJoin(ordersTable, eq(deliveryWorkflowJobsTable.orderId, ordersTable.id))
      .where(eq(deliveryWorkflowJobsTable.id, peek.fromJobId))
      .for("update", { of: deliveryWorkflowJobsTable })
      .limit(1);

    const [offer] = await tx
      .select({
        id: deliveryWorkflowJobsTable.id,
        orderId: deliveryWorkflowJobsTable.orderId,
        acceptanceStatus: deliveryWorkflowJobsTable.acceptanceStatus,
        expiresAt: deliveryWorkflowJobsTable.assignmentExpiresAt,
      })
      .from(deliveryWorkflowJobsTable)
      .where(and(
        eq(deliveryWorkflowJobsTable.id, jobId),
        eq(deliveryWorkflowJobsTable.driverId, driverId),
      ))
      .for("update")
      .limit(1);
    if (!offer) throw new BusinessRuleError("Proposition introuvable.", 404);
    if (offer.acceptanceStatus !== "pending_driver_response") {
      throw new BusinessRuleError("Cette proposition n'est plus valable.", 409);
    }
    const now = new Date();

    // Proposition expirée : on la clôt et on libère le collègue
    if (offer.expiresAt && offer.expiresAt.getTime() < now.getTime()) {
      await tx
        .update(deliveryWorkflowJobsTable)
        .set({ acceptanceStatus: "expired", updatedAt: now })
        .where(eq(deliveryWorkflowJobsTable.id, offer.id));
      await releaseDriverIfIdle(tx, driverId, offer.id);
      return { committed: false as const, error: "La proposition a expiré." };
    }

    const stillTransferable = original
      && original.acceptanceStatus === "accepted_by_driver"
      && (TRANSFERABLE_ORDER_STATUSES as readonly string[]).includes(original.orderStatus);
    if (!stillTransferable || !original) {
      await tx
        .update(deliveryWorkflowJobsTable)
        .set({ acceptanceStatus: "cancelled_by_reassignment", cancelledAt: now, cancelReason: "transfer_source_unavailable", updatedAt: now })
        .where(eq(deliveryWorkflowJobsTable.id, offer.id));
      await releaseDriverIfIdle(tx, driverId, offer.id);
      return { committed: false as const, error: "Cette course n'est plus disponible." };
    }

    if (action === "refuse") {
      await tx
        .update(deliveryWorkflowJobsTable)
        .set({ acceptanceStatus: "refused_by_driver", refusedAt: now, updatedAt: now })
        .where(eq(deliveryWorkflowJobsTable.id, offer.id));
      await releaseDriverIfIdle(tx, driverId, offer.id);
      await audit(tx, driverId, "delivery_transfer_refused", offer.orderId, { fromJobId: original.id, offerJobId: offer.id });
      return { committed: true as const, status: "refused" as const, orderId: offer.orderId, offerJobId: offer.id, fromDriverId: original.driverId };
    }

    // Acceptation : le premier livreur est dessaisi AVANT que le second soit verrouillé (unicité d'une mission acceptée par commande)
    await tx
      .update(deliveryWorkflowJobsTable)
      .set({ acceptanceStatus: "transferred", cancelledAt: now, cancelReason: `transferred_to_driver_${driverId}`, updatedAt: now })
      .where(eq(deliveryWorkflowJobsTable.id, original.id));
    await expireQrTokens(tx, original.id);
    await tx
      .update(deliveryWorkflowJobsTable)
      .set({ acceptanceStatus: "accepted_by_driver", acceptedAt: now, assignmentExpiresAt: null, updatedAt: now })
      .where(eq(deliveryWorkflowJobsTable.id, offer.id));
    await tx.update(driversTable).set({ isAvailable: false, updatedAt: now }).where(eq(driversTable.id, driverId));
    await audit(tx, driverId, "delivery_transfer_completed", offer.orderId, {
      fromJobId: original.id,
      fromDriverId: original.driverId,
      toJobId: offer.id,
      toDriverId: driverId,
    });
    return { committed: true as const, status: "accepted" as const, orderId: offer.orderId, offerJobId: offer.id, fromDriverId: original.driverId };
  });

  if (!outcome.committed) throw new BusinessRuleError(outcome.error, 409);

  const [newDriver] = await db.select({ firstName: driversTable.firstName }).from(driversTable).where(eq(driversTable.id, driverId)).limit(1);
  if (outcome.status === "accepted") {
    await notifyDriver(
      outcome.fromDriverId,
      outcome.orderId,
      `transfer_completed_${outcome.offerJobId}`,
      "Course transférée",
      `${newDriver?.firstName ?? "Votre collègue"} a accepté la commande #${outcome.orderId}. Elle est désormais à lui : vous n'avez plus de droit sur cette livraison.`,
    );
    await notifyDriverChanged(outcome.orderId, "transferred", newDriver?.firstName ?? null);
  } else {
    await notifyDriver(
      outcome.fromDriverId,
      outcome.orderId,
      `transfer_refused_${outcome.offerJobId}`,
      "Transfert refusé",
      `${newDriver?.firstName ?? "Votre collègue"} a refusé la commande #${outcome.orderId}. La course reste à vous : choisissez un autre collègue, reprenez-la ou refusez-la.`,
    );
  }
  return { status: outcome.status };
}

/* ───────────────────────── refus d'une course déjà acceptée ───────────────────────── */

export async function abandonAcceptedAssignment(driverId: number, jobId: number): Promise<{ orderId: number }> {
  const result = await db.transaction(async (tx) => {
    const job = await loadAcceptedJob(tx, driverId, jobId, true);
    const now = new Date();

    // Une éventuelle offre de transfert en attente est annulée
    const offers = await pendingOffersFrom(tx, job.id, true);
    for (const offer of offers) {
      await tx
        .update(deliveryWorkflowJobsTable)
        .set({ acceptanceStatus: "cancelled_by_reassignment", cancelledAt: now, cancelReason: "transfer_source_abandoned", updatedAt: now })
        .where(eq(deliveryWorkflowJobsTable.id, offer.id));
      await releaseDriverIfIdle(tx, offer.driverId, offer.id);
    }

    await tx
      .update(deliveryWorkflowJobsTable)
      .set({ acceptanceStatus: "abandoned_by_driver", cancelledAt: now, cancelReason: "abandoned_by_driver", updatedAt: now })
      .where(eq(deliveryWorkflowJobsTable.id, job.id));
    await expireQrTokens(tx, job.id);
    // La commande redevient « à assigner » (la course déjà payée reste valable pour le prochain livreur)
    await tx.update(ordersTable).set({ status: "ASSIGNED" }).where(and(
      eq(ordersTable.id, job.orderId),
      inArray(ordersTable.status, [...TRANSFERABLE_ORDER_STATUSES]),
    ));
    await audit(tx, driverId, "delivery_driver_abandoned", job.orderId, { jobId: job.id });
    return { orderId: job.orderId, offers };
  });

  for (const offer of result.offers) {
    await notifyDriver(
      offer.driverId,
      result.orderId,
      `transfer_cancelled_${offer.id}`,
      "Transfert annulé",
      `La commande #${result.orderId} n'est plus disponible : le transfert est annulé.`,
    );
  }
  await notifyDriverChanged(result.orderId, "abandoned", null);
  return { orderId: result.orderId };
}

/* ───────────────────────── expiration des offres ───────────────────────── */

export async function expireStaleTransferOffers(): Promise<number> {
  const now = new Date();
  const stale = await db
    .select({
      id: deliveryWorkflowJobsTable.id,
      driverId: deliveryWorkflowJobsTable.driverId,
      orderId: deliveryWorkflowJobsTable.orderId,
      fromJobId: deliveryWorkflowJobsTable.transferredFromJobId,
    })
    .from(deliveryWorkflowJobsTable)
    .where(and(
      eq(deliveryWorkflowJobsTable.acceptanceStatus, "pending_driver_response"),
      isNotNull(deliveryWorkflowJobsTable.transferredFromJobId),
      lt(deliveryWorkflowJobsTable.assignmentExpiresAt, now),
    ));

  let expired = 0;
  for (const offer of stale) {
    const closed = await db.transaction(async (tx) => {
      const updated = await tx
        .update(deliveryWorkflowJobsTable)
        .set({ acceptanceStatus: "expired", updatedAt: now })
        .where(and(eq(deliveryWorkflowJobsTable.id, offer.id), eq(deliveryWorkflowJobsTable.acceptanceStatus, "pending_driver_response")))
        .returning({ id: deliveryWorkflowJobsTable.id });
      if (updated.length === 0) return false;
      await releaseDriverIfIdle(tx, offer.driverId, offer.id);
      return true;
    });
    if (!closed) continue;
    expired++;
    if (offer.fromJobId !== null) {
      const [original] = await db
        .select({ driverId: deliveryWorkflowJobsTable.driverId })
        .from(deliveryWorkflowJobsTable)
        .where(eq(deliveryWorkflowJobsTable.id, offer.fromJobId))
        .limit(1);
      if (original) {
        await notifyDriver(
          original.driverId,
          offer.orderId,
          `transfer_expired_${offer.id}`,
          "Transfert sans réponse",
          `Votre collègue n'a pas répondu à temps pour la commande #${offer.orderId}. La course reste à vous.`,
        );
      }
    }
  }
  return expired;
}

export function startDriverTransferExpiryCron(): void {
  const run = () => {
    expireStaleTransferOffers().catch((err) => logger.error({ err }, "Expiration des offres de transfert impossible"));
  };
  run();
  setInterval(run, 60_000).unref();
}

/* ───────────────────────── information pour l'acheteur et le vendeur ───────────────────────── */

export type DriverNotice =
  | { kind: "driver_unavailable"; message: string; at: string }
  | { kind: "driver_changed"; message: string; driverName: string; at: string }
  | null;

/**
 * Message à afficher à l'acheteur et au vendeur après un changement de livreur (24 h au plus) :
 *  - « Assigner nouveau livreur : livreur indisponible » tant qu'aucun livreur n'a repris la course ;
 *  - « Nouveau livreur : X » quand un collègue a repris la course.
 */
export async function getDriverNotice(orderId: number): Promise<DriverNotice> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [event] = await db
    .select({
      action: deliveryAuditLogsTable.action,
      metadata: deliveryAuditLogsTable.metadata,
      createdAt: deliveryAuditLogsTable.createdAt,
    })
    .from(deliveryAuditLogsTable)
    .where(and(
      eq(deliveryAuditLogsTable.orderId, orderId),
      inArray(deliveryAuditLogsTable.action, ["delivery_transfer_completed", "delivery_driver_abandoned"]),
      gt(deliveryAuditLogsTable.createdAt, since),
    ))
    .orderBy(desc(deliveryAuditLogsTable.createdAt))
    .limit(1);
  if (!event) return null;

  const [order] = await db.select({ status: ordersTable.status }).from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
  if (!order || order.status === "DELIVERED") return null;

  const jobs = await db
    .select({ driverId: deliveryWorkflowJobsTable.driverId, acceptanceStatus: deliveryWorkflowJobsTable.acceptanceStatus, expiresAt: deliveryWorkflowJobsTable.assignmentExpiresAt })
    .from(deliveryWorkflowJobsTable)
    .where(eq(deliveryWorkflowJobsTable.orderId, orderId));
  const now = Date.now();
  const accepted = jobs.find((job) => job.acceptanceStatus === "accepted_by_driver");
  const pending = jobs.find((job) => job.acceptanceStatus === "pending_driver_response" && (!job.expiresAt || job.expiresAt.getTime() > now));
  const at = event.createdAt.toISOString();

  if (event.action === "delivery_driver_abandoned") {
    // Plus de message dès qu'un nouveau livreur a été proposé ou a accepté
    if (accepted || pending) return null;
    return { kind: "driver_unavailable", message: "Assigner nouveau livreur : livreur indisponible", at };
  }
  if (!accepted) return null;
  const [driver] = await db.select({ firstName: driversTable.firstName }).from(driversTable).where(eq(driversTable.id, accepted.driverId)).limit(1);
  const driverName = driver?.firstName ?? "";
  return { kind: "driver_changed", message: `Nouveau livreur : ${driverName}`, driverName, at };
}
