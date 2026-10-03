import { and, desc, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import {
  conversationDeliveryOrdersTable,
  conversationPartyLocationsTable,
  db,
  deliveryAuditLogsTable,
  orderPriceConfirmationsTable,
  ordersTable,
  qrTokensTable,
} from "@workspace/db";
import { computeLockedDeliveryPricing } from "./distance-pricing";
import { logger } from "./logger";

export type PartyActor = "buyer" | "seller";

/**
 * Durée de conservation des positions de l'acheteur et du vendeur (politique de confidentialité, section 8).
 * La position du livreur n'est PAS concernée : elle est conservée tant qu'il est enregistré par l'administrateur.
 */
export const PARTY_LOCATION_RETENTION_HOURS = 24;

/** Au-delà, la position (antenne relais, IP) est trop imprécise pour calculer une course. */
export const MAX_ACCURACY_METERS = 2000;

export type PartyLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  capturedAt: Date;
};

export function isValidCoordinatePair(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === "number" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && typeof longitude === "number" && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    // (0, 0) = position « vide » renvoyée par certains téléphones sans GPS
    && !(latitude === 0 && longitude === 0);
}

/** Enregistre (ou remplace) la position d'un participant à la conversation. */
export async function savePartyLocation(params: {
  conversationId: number;
  actorType: PartyActor;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
}): Promise<void> {
  const capturedAt = new Date();
  await db
    .insert(conversationPartyLocationsTable)
    .values({
      conversationId: params.conversationId,
      actorType: params.actorType,
      latitude: params.latitude,
      longitude: params.longitude,
      accuracyMeters: params.accuracyMeters,
      capturedAt,
    })
    .onConflictDoUpdate({
      target: [conversationPartyLocationsTable.conversationId, conversationPartyLocationsTable.actorType],
      set: {
        latitude: params.latitude,
        longitude: params.longitude,
        accuracyMeters: params.accuracyMeters,
        capturedAt,
      },
    });
}

export async function getPartyLocations(
  conversationId: number,
): Promise<Partial<Record<PartyActor, PartyLocation>>> {
  const rows = await db
    .select()
    .from(conversationPartyLocationsTable)
    .where(eq(conversationPartyLocationsTable.conversationId, conversationId));
  const result: Partial<Record<PartyActor, PartyLocation>> = {};
  for (const row of rows) {
    if (row.actorType === "buyer" || row.actorType === "seller") {
      result[row.actorType] = {
        latitude: row.latitude,
        longitude: row.longitude,
        accuracyMeters: row.accuracyMeters,
        capturedAt: row.capturedAt,
      };
    }
  }
  return result;
}

export async function findLatestOrderLink(
  orderId: number,
): Promise<{ conversationId: number } | null> {
  const [link] = await db
    .select({ conversationId: conversationDeliveryOrdersTable.conversationId })
    .from(conversationDeliveryOrdersTable)
    .where(eq(conversationDeliveryOrdersTable.orderId, orderId))
    .orderBy(desc(conversationDeliveryOrdersTable.createdAt))
    .limit(1);
  return link ?? null;
}

export async function findLatestOrderIdForConversation(conversationId: number): Promise<number | null> {
  const [link] = await db
    .select({ orderId: conversationDeliveryOrdersTable.orderId })
    .from(conversationDeliveryOrdersTable)
    .where(eq(conversationDeliveryOrdersTable.conversationId, conversationId))
    .orderBy(desc(conversationDeliveryOrdersTable.createdAt))
    .limit(1);
  return link?.orderId ?? null;
}

export type EnsurePricingResult =
  | { status: "already_locked" | "locked" | "no_conversation" | "order_not_found" | "pricing_failed" }
  | { status: "missing_positions"; missing: PartyActor[] };

/**
 * Verrouille la distance et les frais de la commande à partir des positions de
 * l'acheteur et du vendeur (vendeur = retrait, acheteur = livraison).
 * Sans effet si les frais sont déjà verrouillés. Renseigne aussi le prix de l'article
 * lorsqu'il manque et que les deux parties ont confirmé le même montant.
 */
export async function ensureOrderPricingLocked(orderId: number): Promise<EnsurePricingResult> {
  const [order] = await db
    .select({
      id: ordersTable.id,
      articlePriceLocked: ordersTable.articlePriceLocked,
      transportFeeLocked: ordersTable.transportFeeLocked,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);
  if (!order) return { status: "order_not_found" };

  const link = await findLatestOrderLink(orderId);
  if (!link) return { status: "no_conversation" };

  // Prix de l'article : repris de la confirmation commune acheteur/vendeur s'il n'est pas encore verrouillé
  if (!order.articlePriceLocked || order.articlePriceLocked <= 0) {
    const confirmations = await db
      .select({ actorType: orderPriceConfirmationsTable.actorType, amountFcfa: orderPriceConfirmationsTable.amountFcfa })
      .from(orderPriceConfirmationsTable)
      .where(eq(orderPriceConfirmationsTable.conversationId, link.conversationId));
    const buyerAmount = confirmations.find((row) => row.actorType === "buyer")?.amountFcfa;
    const vendorAmount = confirmations.find((row) => row.actorType === "vendor")?.amountFcfa;
    if (buyerAmount != null && buyerAmount === vendorAmount && buyerAmount > 0) {
      await db
        .update(ordersTable)
        .set({ articlePriceLocked: buyerAmount })
        .where(and(
          eq(ordersTable.id, orderId),
          or(isNull(ordersTable.articlePriceLocked), eq(ordersTable.articlePriceLocked, 0)),
        ));
    }
  }

  if (order.transportFeeLocked && order.transportFeeLocked > 0) return { status: "already_locked" };

  const positions = await getPartyLocations(link.conversationId);
  const missing = (["seller", "buyer"] as const).filter((actor) => !positions[actor]);
  if (missing.length > 0 || !positions.seller || !positions.buyer) {
    return { status: "missing_positions", missing: [...missing] };
  }

  try {
    const pricing = await computeLockedDeliveryPricing({
      fromLat: positions.seller.latitude,
      fromLon: positions.seller.longitude,
      toLat: positions.buyer.latitude,
      toLon: positions.buyer.longitude,
      orderId,
    });

    const [updated] = await db
      .update(ordersTable)
      .set({
        distanceLockedKm: pricing.distanceLockedKm,
        transportFeeLocked: pricing.transportFeeLocked,
        roundTripFeeLocked: pricing.roundTripFeeLocked,
        distanceSource: pricing.distanceSource,
      })
      .where(and(
        eq(ordersTable.id, orderId),
        or(isNull(ordersTable.transportFeeLocked), eq(ordersTable.transportFeeLocked, 0)),
      ))
      .returning({ id: ordersTable.id });
    if (!updated) return { status: "already_locked" };

    await db.insert(deliveryAuditLogsTable).values({
      actorType: "system",
      actorId: "party-locations",
      action: "order_pricing_locked_from_party_locations",
      orderId,
      metadata: { ...pricing, conversationId: link.conversationId },
    });
    return { status: "locked" };
  } catch (err) {
    // Visible dans les logs Render : cherchez « Calcul de la course impossible »
    logger.error({ err, orderId }, "Calcul de la course impossible (distance/frais non verrouillés)");
    return { status: "pricing_failed" };
  }
}

/**
 * Supprime les positions GPS de l'acheteur et du vendeur enregistrées il y a plus de 24 h :
 *  - la table des positions partagées à la validation du prix ;
 *  - les coordonnées du scanneur enregistrées avec un QR (la distance mesurée est conservée comme preuve).
 * Les distances et frais déjà verrouillés sur la commande ne sont pas touchés.
 */
export async function purgeExpiredPartyLocations(
  now: Date = new Date(),
): Promise<{ positionsDeleted: number; qrCoordinatesCleared: number }> {
  const cutoff = new Date(now.getTime() - PARTY_LOCATION_RETENTION_HOURS * 60 * 60 * 1000);

  const deleted = await db
    .delete(conversationPartyLocationsTable)
    .where(lt(conversationPartyLocationsTable.capturedAt, cutoff))
    .returning({ id: conversationPartyLocationsTable.id });

  const cleared = await db
    .update(qrTokensTable)
    .set({ scannerLatitude: null, scannerLongitude: null })
    .where(and(
      lt(qrTokensTable.createdAt, cutoff),
      or(isNotNull(qrTokensTable.scannerLatitude), isNotNull(qrTokensTable.scannerLongitude)),
    ))
    .returning({ id: qrTokensTable.id });

  return { positionsDeleted: deleted.length, qrCoordinatesCleared: cleared.length };
}
