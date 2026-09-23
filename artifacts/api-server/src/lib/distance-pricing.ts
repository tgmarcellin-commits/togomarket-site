import { db, deliveryAuditLogsTable, platformSettingsTable } from "@workspace/db";

const FCFA_PER_KM = 50;
const FALLBACK_COEFFICIENT_PERMILLE = 1250;
const DEFAULT_ORS_URL = "https://api.openrouteservice.org/v2/directions/driving-car";

function toRadians(value: number): number {
  return value * (Math.PI / 180);
}

function haversineDistanceKm(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
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
  const [settings] = await db.select({
    coefficientPermille: platformSettingsTable.haversineCorrectionCoefficientPermille,
    orsApiUrl: platformSettingsTable.orsApiUrl,
  }).from(platformSettingsTable).limit(1);

  return {
    coefficientPermille: settings?.coefficientPermille ?? FALLBACK_COEFFICIENT_PERMILLE,
    orsApiUrl: settings?.orsApiUrl || DEFAULT_ORS_URL,
  };
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

function toIntegerKm(valueKm: number): number {
  const rounded = Math.round(valueKm);
  return rounded <= 0 ? 1 : rounded;
}

export type LockedDistanceResult = {
  distanceLockedKm: number;
  transportFeeLocked: number;
  distanceSource: "ors_api" | "fallback_haversine";
};

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
    return {
      distanceLockedKm,
      transportFeeLocked: distanceLockedKm * FCFA_PER_KM,
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

  return {
    distanceLockedKm,
    transportFeeLocked: distanceLockedKm * FCFA_PER_KM,
    distanceSource: "fallback_haversine",
  };
}
