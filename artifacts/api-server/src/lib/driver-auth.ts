import { and, eq, gt } from "drizzle-orm";
import { db, deliveryDriverSessionsTable, deliveryDriversTable } from "@workspace/db";
import { hashOpaqueToken, constantTimeHexEqual } from "./marketplace-security";

function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token?.trim()) return null;
  return token.trim();
}

export async function authenticateDriverAuthorization(authorization: string | undefined) {
  const token = parseBearerToken(authorization);
  if (!token) return null;

  const now = new Date();
  const tokenHash = hashOpaqueToken(token);
  const [row] = await db
    .select({
      sessionId: deliveryDriverSessionsTable.id,
      tokenHash: deliveryDriverSessionsTable.tokenHash,
      expiresAt: deliveryDriverSessionsTable.expiresAt,
      driver: deliveryDriversTable,
    })
    .from(deliveryDriverSessionsTable)
    .innerJoin(deliveryDriversTable, eq(deliveryDriverSessionsTable.driverId, deliveryDriversTable.id))
    .where(and(eq(deliveryDriverSessionsTable.tokenHash, tokenHash), gt(deliveryDriverSessionsTable.expiresAt, now)))
    .limit(1);

  if (!row) return null;
  if (!constantTimeHexEqual(tokenHash, row.tokenHash)) return null;

  await db
    .update(deliveryDriverSessionsTable)
    .set({ lastUsedAt: now })
    .where(eq(deliveryDriverSessionsTable.id, row.sessionId));

  return row.driver;
}
