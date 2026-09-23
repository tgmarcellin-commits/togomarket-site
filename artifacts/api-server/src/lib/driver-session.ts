import { randomBytes } from "node:crypto";
import { constantTimeHexEqual, hashOpaqueToken } from "./marketplace-security";

const DRIVER_SESSION_BYTES = 32;

export function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token?.trim()) return null;
  return token.trim();
}

export function createDriverSessionToken(ttlMs: number): {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const rawToken = randomBytes(DRIVER_SESSION_BYTES).toString("base64url");
  return {
    rawToken,
    tokenHash: hashOpaqueToken(rawToken),
    expiresAt: new Date(Date.now() + ttlMs),
  };
}

export function isDriverSessionTokenMatch(rawToken: string, persistedTokenHash: string): boolean {
  if (!rawToken || !persistedTokenHash) return false;
  const providedHash = hashOpaqueToken(rawToken);
  return constantTimeHexEqual(providedHash, persistedTokenHash);
}
