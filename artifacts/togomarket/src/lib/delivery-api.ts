import type { GpsPositionLike } from "./delivery-ui";

export interface DeliveryQrToken {
  rawToken: string;
  stage: "delivery" | "return";
  orderId: number;
  deliveryJobId: number;
  expiresAt: string;
  expiresInSeconds: number;
}

export async function requestDriverDeliveryQr(
  deliveryJobId: number,
  stage: "delivery" | "return",
  token: string,
  position?: Pick<GpsPositionLike["coords"], "latitude" | "longitude">,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryQrToken> {
  const response = await fetchImpl(`/api/delivery/jobs/${deliveryJobId}/qr/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ stage, ...position }),
  });
  const result = await response.json().catch(() => ({})) as DeliveryQrToken & { error?: string };
  if (!response.ok || !result.rawToken || !result.expiresAt) {
    throw new Error(result.error ?? "Unable to request delivery QR.");
  }
  return result;
}

export interface QrScanResult {
  success: true;
  stage: "delivery" | "return";
  orderId: number;
  proximityDistanceMeters: number;
  settlement: Record<string, unknown>;
}

export async function scanDeliveryQr(
  rawToken: string,
  scannerRole: "buyer" | "seller",
  position: { latitude: number; longitude: number },
  fetchImpl: typeof fetch = fetch,
  authHeaders: Record<string, string> = {},
): Promise<QrScanResult> {
  const response = await fetchImpl("/api/delivery/qr/scan", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      rawToken,
      scannerRole,
      scannerLatitude: position.latitude,
      scannerLongitude: position.longitude,
      idempotencyKey: crypto.randomUUID(),
    }),
  });
  const result = await response.json().catch(() => ({})) as QrScanResult & { error?: string };
  if (!response.ok || result.success !== true) {
    throw new Error(result.error ?? "QR verification failed.");
  }
  return result;
}

export interface DeliveryLocation {
  id: number;
  deliveryJobId: number;
  orderId: number;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recordedAt: string;
}

export async function loadDeliveryLocations(
  deliveryJobId: number,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryLocation[]> {
  const response = await fetchImpl(`/api/delivery/jobs/${deliveryJobId}/locations`, {
    headers,
    credentials: "include",
  });
  if (!response.ok) return [];
  const result = await response.json() as { locations?: DeliveryLocation[] };
  return Array.isArray(result.locations) ? result.locations : [];
}

export async function loadDeliveryLatestLocation(
  deliveryJobId: number,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryLocation | null> {
  const response = await fetchImpl(`/api/delivery/jobs/${deliveryJobId}/locations/latest`, {
    headers,
    credentials: "include",
  });
  if (!response.ok) return null;
  return await response.json() as DeliveryLocation;
}
