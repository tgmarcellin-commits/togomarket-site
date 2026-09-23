import type { Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { db, vendorsTable, vendorSessionsTable } from "@workspace/db";
import { normalizePhone, phoneEq } from "./phone";
import { getIo } from "./socket-io";

export const VENDOR_SESSION_COOKIE = "tm_vendor_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function parseCookie(cookieHeader: string | undefined, name = VENDOR_SESSION_COOKIE): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return null; }
  }
  return null;
}

function setCookie(res: Response, token: string, maxAge = SESSION_SECONDS): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append("Set-Cookie", `${VENDOR_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
}

export function clearVendorSessionCookie(res: Response): void {
  setCookie(res, "", 0);
}

export async function lookupVendorSessionDetails(cookieHeader: string | undefined) {
  const token = parseCookie(cookieHeader);
  if (!token) return null;
  const now = new Date();
  const [row] = await db.select({
    vendor: vendorsTable,
    sessionId: vendorSessionsTable.id,
    expiresAt: vendorSessionsTable.expiresAt,
  })
    .from(vendorSessionsTable)
    .innerJoin(vendorsTable, eq(vendorSessionsTable.vendorId, vendorsTable.id))
    .where(and(eq(vendorSessionsTable.tokenHash, hashToken(token)), gt(vendorSessionsTable.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  await db.update(vendorSessionsTable).set({ lastUsedAt: now }).where(eq(vendorSessionsTable.id, row.sessionId));
  return { vendor: row.vendor, expiresAt: row.expiresAt };
}

export async function lookupVendorSession(cookieHeader: string | undefined) {
  return (await lookupVendorSessionDetails(cookieHeader))?.vendor ?? null;
}

export function disconnectVendorSockets(vendorId: number): void {
  try {
    getIo().in(`vendor:${vendorId}`).disconnectSockets(true);
  } catch {
    // Socket.IO is not initialized in isolated scripts and unit tests.
  }
}

export async function issueVendorSession(res: Response, vendorId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await db.insert(vendorSessionsTable).values({
    vendorId, tokenHash: hashToken(token), createdAt: now, lastUsedAt: now,
    expiresAt: new Date(now.getTime() + SESSION_SECONDS * 1000),
  });
  setCookie(res, token);
}

export async function revokeVendorSession(req: Request, res: Response): Promise<void> {
  const token = parseCookie(req.headers.cookie);
  if (token) {
    const tokenHash = hashToken(token);
    const [session] = await db.select({ vendorId: vendorSessionsTable.vendorId })
      .from(vendorSessionsTable)
      .where(eq(vendorSessionsTable.tokenHash, tokenHash))
      .limit(1);
    await db.delete(vendorSessionsTable).where(eq(vendorSessionsTable.tokenHash, tokenHash));
    if (session) disconnectVendorSockets(session.vendorId);
  }
  clearVendorSessionCookie(res);
}

export async function revokeAllVendorSessions(vendorId: number): Promise<void> {
  await db.delete(vendorSessionsTable).where(eq(vendorSessionsTable.vendorId, vendorId));
  disconnectVendorSockets(vendorId);
}

/** Cookie session wins; phone/password only remains a backwards-compatible fallback. */
export async function authenticateVendorRequest(
  req: Pick<Request, "headers">,
  legacy?: { phone?: string; password?: string },
) {
  const sessionVendor = await lookupVendorSession(req.headers.cookie);
  if (sessionVendor) return sessionVendor;
  const phone = legacy?.phone ?? (typeof req.headers["x-vendor-phone"] === "string" ? req.headers["x-vendor-phone"] : undefined);
  const password = legacy?.password ?? (typeof req.headers["x-vendor-password"] === "string" ? req.headers["x-vendor-password"] : undefined);
  if (!phone || !password) return null;
  const [vendor] = await db.select().from(vendorsTable).where(phoneEq(vendorsTable.phone, normalizePhone(phone))).limit(1);
  return vendor && await bcrypt.compare(password, vendor.passwordHash) ? vendor : null;
}