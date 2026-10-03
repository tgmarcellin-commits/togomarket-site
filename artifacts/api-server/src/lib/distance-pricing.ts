import { db, deliveryAuditLogsTable, platformSettingsTable } from "@workspace/db";
import { BusinessRuleError } from "./route-errors";
import { computeReturnLegFee, computeRoundTripFee } from "./platform-fees";
import { logger } from "./logger";

/**
 * Barème de la course du livreur (aller), par tranches de kilomètres ENTIERS (la distance est tronquée) :
 *   de 0 à 5,99 km      -> 500 FCFA
 *   de 6 à 10,99 km     -> 1 000 FCFA
 *   de 11 à 20,99 km    -> 1 500 FCFA
 *   au-delà de 20,99 km -> 1 500 FCFA + 50 FCFA par kilomètre entier à partir de 21 km
 * Retour au vendeur : le livreur gagne en plus la MOITIÉ du prix de l'aller (aller-retour = 1,5 x l'aller).
 */
export const FCFA_PER_EXTRA_KM = 50;
/** @deprecated ancien tarif au kilomètre ; conservé pour les fichiers qui l'importent encore. Utiliser computeTransportFee. */
export const FCFA_PER_KM = FCFA_PER_EXTRA_KM;

const TRANSPORT_FEE_TIERS: ReadonlyArray<{ belowKm: number; fee: number }> = [
  { belowKm: 6, fee: 500 },
  { belowKm: 11, fee: 1000 },
  { belowKm: 21, fee: 1500 },
];
const TOP_TIER_FEE = 1500;
const FIRST_EXTRA_KM = 21;

/** Frais de course du livreur (aller) pour une distance en km. Les décimales sont ignorées (5,99 km compte pour 5 km). */
export function computeTransportFee(distanceKm: number): number {
  const wholeKm = Number.isFinite(distanceKm) ? Math.max(0, Math.floor(distanceKm)) : 0;
  for (const tier of TRANSPORT_FEE_TIERS) {
    if (wholeKm < tier.belowKm) return tier.fee;
  }
  return TOP_TIER_FEE + (wholeKm - (FIRST_EXTRA_KM - 1)) * FCFA_PER_EXTRA_KM;
}
const FALLBACK_COEFFICIENT_PERMILLE = 1250;
const DEFAULT_ORS_URL = "https://api.openrouteservice.org/v2/directions/driving-car";

function toRadians(value: number): number {
  return value * (Math.PI / 180);
}

export function haversineDistanceKm(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const R = 6371;
  const dLat = toRadians(toLat - fromLat);
  const dLon = toRadians(toLon - fromLon);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function platformDistanceSettings(): Promise<{ coefficientPermille: number; orsApiUrl: string }> {
  try {
    const [settings] = await db.select({
      coefficientPermille: platformSettingsTable.haversineCorrectionCoefficientPermille,
      orsApiUrl: platformSettingsTable.orsApiUrl,
    }).from(platformSettingsTable).limit(1);

    return {
      coefficientPermille: settings?.coefficientPermille ?? FALLBACK_COEFFICIENT_PERMILLE,
      orsApiUrl: settings?.orsApiUrl || DEFAULT_ORS_URL,
    };
  } catch (err) {
    // Base de production en retard sur le schéma (colonnes haversine_correction_coefficient_permille /
    // ors_api_url absentes de platform_settings) : on calcule avec les valeurs par défaut au lieu d'échouer.
    logger.warn({ err }, "platform_settings : réglages de distance indisponibles, valeurs par défaut utilisées");
    return { coefficientPermille: FALLBACK_COEFFICIENT_PERMILLE, orsApiUrl: DEFAULT_ORS_URL };
  }
}

async function orsDistanceKm(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  orsApiUrl: string,
): Promise<number | null> {
  const key = process.env.ORS_API_KEY?.trim();
  if (!key) return null;

  const response = await fetch(orsApiUrl, {
    method: "POST",
    headers: {
      Authorization: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      coordinates: [
        [fromLon, fromLat],
        [toLon, toLat],
      ],
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) return null;
  const json = await response.json() as Record<string, unknown>;
  const firstFeature = (json.features as Array<Record<string, unknown>> | undefined)?.[0];
  const summary = firstFeature?.properties as Record<string, unknown> | undefined;
  const summaryInner = summary?.summary as Record<string, unknown> | undefined;
  const distanceMeters = Number(summaryInner?.distance ?? NaN);
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return null;
  return distanceMeters / 1000;
}

/** Distance verrouillée : kilomètres entiers, tronqués (5,99 km -> 5 km), 1 km au minimum. */
export function toIntegerKm(valueKm: number): number {
  const whole = Math.floor(valueKm);
  return whole <= 0 ? 1 : whole;
}

export type LockedDistanceResult = {
  distanceLockedKm: number;
  transportFeeLocked: number;
  roundTripFeeLocked: number;
  distanceSource: "ors_api" | "fallback_haversine";
};

/** Aller-retour = aller + moitié de l'aller (le retour est payé la moitié du prix de l'aller). */
function computeRoundTripFeeLocked(transportFeeLocked: number): number {
  return computeRoundTripFee(transportFeeLocked);
}

export async function computeLockedDeliveryPricing(input: {
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  orderId?: number;
}): Promise<LockedDistanceResult> {
  const { coefficientPermille, orsApiUrl } = await platformDistanceSettings();
  const orsKm = await orsDistanceKm(input.fromLat, input.fromLon, input.toLat, input.toLon, orsApiUrl).catch(() => null);
  if (orsKm !== null) {
    const distanceLockedKm = toIntegerKm(orsKm);
    const transportFeeLocked = computeTransportFee(distanceLockedKm);
    return {
      distanceLockedKm,
      transportFeeLocked,
      roundTripFeeLocked: computeRoundTripFeeLocked(transportFeeLocked),
      distanceSource: "ors_api",
    };
  }

  const baseKm = haversineDistanceKm(input.fromLat, input.fromLon, input.toLat, input.toLon);
  const correctedKm = (baseKm * coefficientPermille) / 1000;
  const distanceLockedKm = toIntegerKm(correctedKm);

  await db.insert(deliveryAuditLogsTable).values({
    actorType: "system",
    actorId: "distance-pricing",
    action: "distance_fallback_haversine",
    orderId: input.orderId,
    metadata: {
      fromLat: input.fromLat,
      fromLon: input.fromLon,
      toLat: input.toLat,
      toLon: input.toLon,
      coefficientPermille,
      correctedKm: distanceLockedKm,
    },
  });

  const transportFeeLocked = computeTransportFee(distanceLockedKm);
  return {
    distanceLockedKm,
    transportFeeLocked,
    roundTripFeeLocked: computeRoundTripFeeLocked(transportFeeLocked),
    distanceSource: "fallback_haversine",
  };
}

export function computeReturnPricing(transportFeeLocked: number, distanceLockedKm: number) {
  return {
    returnDistanceKm: distanceLockedKm,
    returnFee: computeReturnLegFee(transportFeeLocked),
    roundTripFee: computeRoundTripFee(transportFeeLocked),
  };
}

export async function superadminCorrectOrderPricing(input: {
  orderId: number;
  newDistanceKm: number;
  reason: string;
}) {
  const { orderId, newDistanceKm, reason } = input;
  if (!Number.isInteger(newDistanceKm) || newDistanceKm < 1) {
    throw new BusinessRuleError("La distance corrigée doit être un entier en km >= 1.");
  }
  if (!reason || reason.trim().length === 0) {
    throw new BusinessRuleError("Le motif de la correction est obligatoire pour l'audit.");
  }

  const { ordersTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");

  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);

  if (!order) {
    throw new BusinessRuleError(`Commande #${orderId} introuvable.`);
  }

  const transportFeeLocked = computeTransportFee(newDistanceKm);
  const roundTripFeeLocked = computeRoundTripFee(transportFeeLocked);

  await db
    .update(ordersTable)
    .set({
      distanceLockedKm: newDistanceKm,
      transportFeeLocked,
      roundTripFeeLocked,
    })
    .where(eq(ordersTable.id, orderId));

  await db.insert(deliveryAuditLogsTable).values({
    actorType: "superadmin",
    action: "order_pricing_superadmin_corrected",
    orderId,
    metadata: {
      previousDistanceKm: order.distanceLockedKm,
      previousTransportFee: order.transportFeeLocked,
      previousRoundTripFee: order.roundTripFeeLocked,
      newDistanceKm,
      newTransportFee: transportFeeLocked,
      newRoundTripFee: roundTripFeeLocked,
      reason,
    },
  });

  return {
    orderId,
    distanceLockedKm: newDistanceKm,
    transportFeeLocked,
    roundTripFeeLocked,
    reason,
  };
}
