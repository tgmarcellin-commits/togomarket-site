import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const QR_TOKEN_BYTES = 32;

export function assertIntegerFcfaAmount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("Montant FCFA invalide");
  }
  return value;
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function constantTimeHexEqual(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createQrToken(ttlSeconds: number): {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const rawToken = randomBytes(QR_TOKEN_BYTES).toString("base64url");
  const tokenHash = hashOpaqueToken(rawToken);
  const expiresAt = new Date(Date.now() + Math.max(30, ttlSeconds) * 1000);
  return { rawToken, tokenHash, expiresAt };
}

export function isQrTokenUsable(input: {
  providedRawToken: string;
  persistedTokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
}): boolean {
  if (!input.providedRawToken || input.consumedAt !== null) return false;
  if (input.expiresAt.getTime() <= Date.now()) return false;
  const providedHash = hashOpaqueToken(input.providedRawToken);
  return constantTimeHexEqual(providedHash, input.persistedTokenHash);
}

const JOB_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  pending_assignment: ["assigned"],
  assigned: ["accepted", "cancelled"],
  accepted: ["picked_up", "return_requested"],
  picked_up: ["delivered", "return_requested"],
  delivered: [],
  return_requested: ["returned"],
  returned: [],
  cancelled: [],
};

export function ensureDeliveryJobTransition(currentStatus: string, targetStatus: string): void {
  const allowed = JOB_STATUS_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(targetStatus)) {
    throw new Error(`Transition livraison non autorisée: ${currentStatus} -> ${targetStatus}`);
  }
}

const ORDER_RETURN_TRANSITIONS: Record<string, readonly string[]> = {
  none: ["requested"],
  requested: ["approved", "rejected"],
  approved: ["collected"],
  collected: ["refunded", "rejected"],
  refunded: [],
  rejected: [],
};

export function ensureReturnTransition(currentStatus: string, targetStatus: string): void {
  const allowed = ORDER_RETURN_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(targetStatus)) {
    throw new Error(`Transition retour non autorisée: ${currentStatus} -> ${targetStatus}`);
  }
}

export function normalizeIdempotencyKey(input: unknown): string {
  const key = String(input ?? "").trim();
  if (key.length < 8 || key.length > 128) {
    throw new Error("Clé d'idempotence invalide");
  }
  return hashOpaqueToken(key);
}
