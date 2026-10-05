import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { buyerAccountsTable, conversationsTable, db, gameLaunchTokensTable } from "@workspace/db";
import { getOrCreateBuyerAccountId } from "./buyer-accounts";
import { LAUNCH_TTL_MS, newLaunchId, signLaunchToken, verifyLaunchToken } from "./game-launch-token";
import { phoneEq } from "./phone";

/**
 * Émission et échange des jetons de lancement du jeu « 10Défis ».
 *  - issueLaunchToken : appelé APRÈS que le serveur a vérifié la preuve du numéro et enregistré l'acceptation du règlement ;
 *  - consumeLaunchToken : appelé par le jeu (route interne protégée par secret) ; un jeton ne s'échange qu'UNE fois.
 */

/** Crée un jeton pour un numéro canonique dont la vérification vient d'être contrôlée. Renvoie null si SESSION_SECRET est inutilisable. */
export async function issueLaunchToken(phone: string): Promise<string | null> {
  const jti = newLaunchId();
  const nowMs = Date.now();
  const token = signLaunchToken({ phone, jti, nowMs }, process.env.SESSION_SECRET);
  if (!token) return null;

  await db.insert(gameLaunchTokensTable).values({
    jti,
    phone,
    expiresAt: new Date(nowMs + LAUNCH_TTL_MS),
  });
  // Nettoyage au passage : les jetons expirés depuis plus d'un jour n'ont plus aucune utilité
  await db
    .delete(gameLaunchTokensTable)
    .where(lt(gameLaunchTokensTable.expiresAt, new Date(nowMs - 24 * 60 * 60 * 1000)))
    .catch(() => undefined);
  return token;
}

export type ConsumedLaunchToken = { phone: string; buyerId: number; name: string | null };

/**
 * Nom du compte acheteur : celui donné à l'inscription par numéro (challenge « 10Défis »), à défaut le dernier nom saisi
 * dans une conversation avec ce numéro. Null si aucun nom n'est connu : le jeu choisit alors un nom neutre.
 */
async function buyerNameForPhone(accountId: number, phone: string): Promise<string | null> {
  const [account] = await db
    .select({ name: buyerAccountsTable.buyerName })
    .from(buyerAccountsTable)
    .where(eq(buyerAccountsTable.id, accountId))
    .limit(1);
  if (account?.name?.trim()) return account.name.trim();

  const [conversation] = await db
    .select({ name: conversationsTable.buyerName })
    .from(conversationsTable)
    .where(phoneEq(conversationsTable.buyerPhone, phone))
    .orderBy(desc(conversationsTable.id))
    .limit(1);
  return conversation?.name?.trim() || null;
}

/**
 * Échange un jeton contre le numéro prouvé. Signature, expiration ET usage unique sont contrôlés ; l'usage unique est garanti
 * par une seule instruction SQL atomique (deux échanges simultanés du même jeton : un seul réussit).
 * Renvoie null, sans détail, pour tout jeton invalide, expiré ou déjà utilisé.
 */
export async function consumeLaunchToken(token: string, sourceIp: string | null): Promise<ConsumedLaunchToken | null> {
  const decoded = verifyLaunchToken(token, process.env.SESSION_SECRET);
  if (!decoded) return null;

  const now = new Date();
  const consumed = await db
    .update(gameLaunchTokensTable)
    .set({ usedAt: now, usedIp: sourceIp?.slice(0, 64) ?? null })
    .where(and(
      eq(gameLaunchTokensTable.jti, decoded.jti),
      eq(gameLaunchTokensTable.phone, decoded.phone),
      isNull(gameLaunchTokensTable.usedAt),
      gt(gameLaunchTokensTable.expiresAt, now),
    ))
    .returning({ phone: gameLaunchTokensTable.phone });
  if (consumed.length === 0) return null;

  // Le compte existe déjà (créé à la vérification du numéro) ; sinon il est retrouvé ou créé ici, sans solde
  const buyerId = await getOrCreateBuyerAccountId(decoded.phone);
  return { phone: decoded.phone, buyerId, name: await buyerNameForPhone(buyerId, decoded.phone) };
}
