export type DeliveryRoutePhase =
  | "waiting"
  | "to-seller"
  | "picked-up"
  | "to-buyer"
  | "arrived"
  | "delivered"
  | "returning"
  | "returned";

export interface DriverSafeOrder {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  distanceLockedKm: number | null;
  transportFeeLocked: number | null;
  roundTripFeeLocked: number | null;
  status: string;
  createdAt: string;
}

export interface DriverSafeAssignment {
  id: number;
  orderId: number;
  acceptanceStatus: string;
  assignmentExpiresAt: string | null;
  acceptedAt: string | null;
  refusedAt: string | null;
  createdAt: string;
  updatedAt: string;
  order: DriverSafeOrder | null;
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function toDriverSafeAssignment(value: unknown): DriverSafeAssignment {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const sourceOrder = source.order && typeof source.order === "object"
    ? source.order as Record<string, unknown>
    : null;

  return {
    id: safeNumber(source.id) ?? 0,
    orderId: safeNumber(source.orderId) ?? 0,
    acceptanceStatus: safeText(source.acceptanceStatus),
    assignmentExpiresAt: typeof source.assignmentExpiresAt === "string" ? source.assignmentExpiresAt : null,
    acceptedAt: typeof source.acceptedAt === "string" ? source.acceptedAt : null,
    refusedAt: typeof source.refusedAt === "string" ? source.refusedAt : null,
    createdAt: safeText(source.createdAt),
    updatedAt: safeText(source.updatedAt),
    order: sourceOrder ? {
      id: safeNumber(sourceOrder.id) ?? 0,
      firstName: safeText(sourceOrder.firstName),
      lastName: safeText(sourceOrder.lastName),
      phone: safeText(sourceOrder.phone),
      distanceLockedKm: safeNumber(sourceOrder.distanceLockedKm),
      transportFeeLocked: safeNumber(sourceOrder.transportFeeLocked),
      roundTripFeeLocked: safeNumber(sourceOrder.roundTripFeeLocked),
      status: safeText(sourceOrder.status),
      createdAt: safeText(sourceOrder.createdAt),
    } : null,
  };
}

export interface PublicDeliveryDriver {
  id: number;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  workZone: string;
  isAvailable: boolean;
  ratingAverage: number;
  ratingCount: number;
}

export function toPublicDeliveryDriver(value: unknown): PublicDeliveryDriver {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    id: safeNumber(source.id) ?? 0,
    firstName: safeText(source.firstName),
    lastName: safeText(source.lastName),
    photoUrl: typeof source.photoUrl === "string" ? source.photoUrl : null,
    workZone: safeText(source.workZone ?? source.coverageZone),
    isAvailable: source.isAvailable === true,
    ratingAverage: safeNumber(source.ratingAverage) ?? 0,
    ratingCount: safeNumber(source.ratingCount) ?? 0,
  };
}

const TERMINAL_DELIVERY_STATUSES = new Set([
  "DELIVERED",
  "RETURN_CONFIRMED",
  "CANCELLED",
  "CANCELED",
  "CLOSED",
]);

export function isTerminalDeliveryStatus(status: string | null | undefined): boolean {
  return TERMINAL_DELIVERY_STATUSES.has((status ?? "").toUpperCase());
}

export function shouldTrackDelivery(
  acceptanceStatus: string,
  orderStatus: string | null | undefined,
): boolean {
  return acceptanceStatus === "accepted_by_driver" && !isTerminalDeliveryStatus(orderStatus);
}

export function getDeliveryRoutePhase(
  acceptanceStatus: string,
  orderStatus: string | null | undefined,
): DeliveryRoutePhase {
  const status = (orderStatus ?? "").toUpperCase();
  if (status === "RETURN_CONFIRMED") return "returned";
  if (status === "DELIVERED") return "delivered";
  if (status === "RETURN_AT_SELLER") return "arrived";
  if (status === "RETURNING_TO_SELLER") return "returning";
  if (status === "IN_TRANSIT") return "to-buyer";
  if (status === "ASSIGNED" && acceptanceStatus === "accepted_by_driver") return "to-seller";
  if (status === "PICKED_UP") return "picked-up";
  return "waiting";
}

export function isLocationStale(
  recordedAt: string | null | undefined,
  now = Date.now(),
  staleAfterMs = 60_000,
): boolean {
  if (!recordedAt) return true;
  const timestamp = new Date(recordedAt).getTime();
  return !Number.isFinite(timestamp) || now - timestamp > staleAfterMs;
}

export function canWithdrawWallet(wallet: {
  withdrawalReadiness?: { canWithdraw?: boolean } | null;
  withdrawalAvailability?: { canWithdraw?: boolean } | null;
} | null | undefined): boolean {
  return wallet?.withdrawalReadiness?.canWithdraw === true
    || wallet?.withdrawalAvailability?.canWithdraw === true;
}

export function canRequestDeliveryQr(stage: "delivery" | "return", status: string): boolean {
  const normalized = status.toUpperCase();
  if (stage === "delivery") return normalized === "ASSIGNED" || normalized === "IN_TRANSIT";
  return ["RETURNING_TO_SELLER", "RETURN_AT_SELLER"].includes(normalized);
}

export function getQrRemainingSeconds(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1_000));
}

export function createSingleFlightGuard() {
  let pending = false;
  return {
    isPending: () => pending,
    async run<T>(operation: () => Promise<T>): Promise<T | undefined> {
      if (pending) return undefined;
      pending = true;
      try {
        return await operation();
      } finally {
        pending = false;
      }
    },
  };
}

export interface GpsPositionLike {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
    speed: number | null;
    heading: number | null;
  };
  timestamp: number;
}

export interface GpsWatchApi {
  watchPosition(
    success: (position: GpsPositionLike) => void,
    error: (error: { code?: number }) => void,
    options?: PositionOptions,
  ): number;
  clearWatch(watchId: number): void;
  getCurrentPosition?(
    success: (position: GpsPositionLike) => void,
    error: (error: { code?: number }) => void,
    options?: PositionOptions,
  ): void;
}

export function startAutomaticGpsTracking(
  geolocation: GpsWatchApi,
  send: (position: GpsPositionLike) => void,
  onError: (error: { code?: number }) => void,
  now: () => number = Date.now,
  minimumIntervalMs = 2_000,
  heartbeatMs = 15_000,
): () => void {
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let stopped = false;
  const handlePosition = (position: GpsPositionLike) => {
    if (stopped || now() - lastSentAt < minimumIntervalMs) return;
    lastSentAt = now();
    send(position);
  };
  const watchId = geolocation.watchPosition(
    handlePosition,
    onError,
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
  );

  // watchPosition ne se déclenche que lorsque le livreur BOUGE. À l'arrêt (feu rouge,
  // attente chez le vendeur), plus aucune position n'était envoyée et le suivi devenait
  // « obsolète » au bout de 60 s. Ce battement de cœur demande donc une position fraîche
  // toutes les 15 s si rien n'a été envoyé entre-temps.
  const heartbeat = geolocation.getCurrentPosition && heartbeatMs > 0
    ? setInterval(() => {
        if (stopped || now() - lastSentAt < heartbeatMs) return;
        geolocation.getCurrentPosition?.(
          handlePosition,
          onError,
          { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
        );
      }, heartbeatMs)
    : null;

  return () => {
    stopped = true;
    if (heartbeat !== null) clearInterval(heartbeat);
    geolocation.clearWatch(watchId);
  };
}
    
