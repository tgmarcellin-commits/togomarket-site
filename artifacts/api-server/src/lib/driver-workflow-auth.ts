import { and, eq, gt } from "drizzle-orm";
import { db, driverSessionsTable, driversTable } from "@workspace/db";
import { hashOpaqueToken } from "./marketplace-security";
import { parseBearerToken } from "./driver-session";

/**
 * Identifie le livreur connecté à l'espace /driver-connexion à partir de l'en-tête
 * `Authorization: Bearer <jeton>`. Retourne l'identifiant dans la table `drivers`, ou null.
 *
 * Deux emplacements possibles pour la session (selon l'historique du projet) :
 *   1. la table `driver_sessions` (token_hash + expires_at) ;
 *   2. les colonnes `drivers.otp_session_token_hash` / `otp_session_expires_at`.
 */
export async function resolveWorkflowDriverId(authorization: string | undefined): Promise<number | null> {
  const token = parseBearerToken(authorization);
  if (!token) return null;
  const tokenHash = hashOpaqueToken(token);
  const now = new Date();

  try {
    const [session] = await db
      .select({ driverId: driverSessionsTable.driverId })
      .from(driverSessionsTable)
      .where(and(eq(driverSessionsTable.tokenHash, tokenHash), gt(driverSessionsTable.expiresAt, now)))
      .limit(1);
    if (session) return session.driverId;
  } catch {
    // table absente ou inaccessible : on essaie l'autre emplacement
  }

  try {
    const [driver] = await db
      .select({ id: driversTable.id })
      .from(driversTable)
      .where(and(
        eq(driversTable.otpSessionTokenHash, tokenHash),
        gt(driversTable.otpSessionExpiresAt, now),
        eq(driversTable.isActive, true),
      ))
      .limit(1);
    if (driver) return driver.id;
  } catch {
    // ignoré : jeton non reconnu
  }
  return null;
}
