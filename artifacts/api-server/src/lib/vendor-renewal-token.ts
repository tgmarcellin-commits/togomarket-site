import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 4 * 24 * 60 * 60 * 1000;

function signingSecret(): string {
  const value = process.env.SESSION_SECRET?.trim();
  if (!value) throw new Error("SESSION_SECRET must be configured");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

export function createVendorRenewalToken(vendorId: number): string {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${vendorId}.${expiresAt}`;
  return `${expiresAt}.${sign(payload)}`;
}

export function verifyVendorRenewalToken(vendorId: number, token: string): boolean {
  const [expiresRaw, supplied, ...extra] = token.split(".");
  const expiresAt = Number(expiresRaw);
  if (extra.length || !Number.isFinite(expiresAt) || expiresAt < Date.now() || !supplied) return false;
  const expected = Buffer.from(sign(`${vendorId}.${expiresAt}`));
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}