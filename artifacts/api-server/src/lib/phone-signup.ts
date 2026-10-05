import { eq, sql } from "drizzle-orm";
import {
  buyerAccountsTable,
  conversationPhoneVerificationsTable,
  conversationsTable,
  db,
  phoneCodeChallengesTable,
} from "@workspace/db";
import { randomInt } from "node:crypto";
import { getOrCreateBuyerAccountId } from "./buyer-accounts";
import { canonicalPhone } from "./game-wallet";
import { constantTimeHexEqual, hashOpaqueToken } from "./marketplace-security";
import { dispatchVendorOTP } from "./otp-provider";
import { isProofSecretUsable, signPhoneProof, verifyPhoneProof } from "./phone-proof";
import {
  CODE_TTL_MS,
  MAX_CODE_ATTEMPTS,
  evaluateChallenge,
  firstNameOf,
  maskPhone,
  planSend,
} from "./phone-signup-core";
import { BusinessRuleError } from "./route-errors";

/**
 * Inscription PAR NUMÉRO (challenge « 10Défis ») : un visiteur sans compte acheteur saisit son nom et son numéro WhatsApp,
 * reçoit un code, le saisit, et son compte acheteur (compte-numéro) est créé. Aucune conversation n'est nécessaire.
 * La preuve de vérification est un jeton signé conservé par son navigateur (voir phone-proof.ts).
 */

function codeHash(phone: string, code: string): string {
  return hashOpaqueToken(`phone-signup:${phone}:${code}`);
}

function proofSecret(): string | undefined {
  return process.env.SESSION_SECRET;
}

/** Envoie un code de vérification à 6 chiffres sur le WhatsApp du numéro. Réponse identique qu'un compte existe ou non. */
export async function sendSignupCode(rawPhone: string, name: string): Promise<{ phoneMasked: string; expiresInSeconds: number }> {
  const phone = canonicalPhone(rawPhone);
  if (!phone) throw new BusinessRuleError("Numéro invalide. Saisissez-le avec l'indicatif, par exemple +22897000000.");
  if (!isProofSecretUsable(proofSecret())) {
    // sans secret, aucune preuve ne pourrait être signée : on n'envoie donc pas de code pour rien
    throw new Error("SESSION_SECRET absent ou trop court : inscription par numéro indisponible");
  }

  const now = new Date();
  const [existing] = await db.select().from(phoneCodeChallengesTable).where(eq(phoneCodeChallengesTable.phone, phone)).limit(1);
  const plan = planSend(existing ?? null, now);
  if (!plan.allowed) throw new BusinessRuleError("Trop de codes demandés pour ce numéro. Réessayez dans une heure.", 409);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const values = {
    codeHash: codeHash(phone, code),
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    attempts: 0,
    sendCount: plan.sendCount,
    sendWindowStartedAt: plan.windowStartedAt,
    updatedAt: now,
  };
  await db
    .insert(phoneCodeChallengesTable)
    .values({ phone, ...values })
    .onConflictDoUpdate({ target: phoneCodeChallengesTable.phone, set: values });

  const dispatched = await dispatchVendorOTP(phone, code, firstNameOf(name));
  if (!dispatched.sent) {
    throw new BusinessRuleError("Envoi du code WhatsApp impossible pour le moment. Réessayez dans un instant.", 409);
  }
  return { phoneMasked: maskPhone(phone), expiresInSeconds: CODE_TTL_MS / 1000 };
}

export type VerifySignupResult =
  | { kind: "verified"; proof: string; expiresAt: number }
  | { kind: "no_code" | "expired" | "too_many_attempts" }
  | { kind: "wrong_code"; attemptsLeft: number };

/** Contrôle le code. Réussite : compte acheteur créé (ou retrouvé), nom enregistré si absent, preuve signée renvoyée. */
export async function verifySignupCode(rawPhone: string, name: string, code: string): Promise<VerifySignupResult> {
  const phone = canonicalPhone(rawPhone);
  if (!phone) return { kind: "no_code" };

  const now = new Date();
  const [row] = await db.select().from(phoneCodeChallengesTable).where(eq(phoneCodeChallengesTable.phone, phone)).limit(1);
  const state = evaluateChallenge(row ?? null, now);
  if (state !== "ready") return { kind: state };

  if (!constantTimeHexEqual(codeHash(phone, code), row!.codeHash as string)) {
    await db
      .update(phoneCodeChallengesTable)
      .set({ attempts: sql`${phoneCodeChallengesTable.attempts} + 1`, updatedAt: now })
      .where(eq(phoneCodeChallengesTable.phone, phone));
    return { kind: "wrong_code", attemptsLeft: Math.max(0, MAX_CODE_ATTEMPTS - row!.attempts - 1) };
  }

  const issuedAt = Date.now();
  const proof = signPhoneProof(phone, proofSecret(), issuedAt);
  if (!proof) throw new Error("Preuve de vérification impossible à signer (SESSION_SECRET)");

  await db.transaction(async (tx) => {
    // compte-numéro créé s'il n'existe pas ; le nom n'est jamais écrasé s'il est déjà connu
    const accountId = await getOrCreateBuyerAccountId(phone, tx);
    await tx
      .update(buyerAccountsTable)
      .set({
        phoneVerifiedAt: now,
        buyerName: sql`coalesce(${buyerAccountsTable.buyerName}, ${name})`,
      })
      .where(eq(buyerAccountsTable.id, accountId));
    // le code est à usage unique
    await tx
      .update(phoneCodeChallengesTable)
      .set({ codeHash: null, expiresAt: null, attempts: 0, updatedAt: now })
      .where(eq(phoneCodeChallengesTable.phone, phone));
  });

  const decoded = verifyPhoneProof(proof, proofSecret(), issuedAt);
  return { kind: "verified", proof, expiresAt: decoded?.expiresAt ?? issuedAt };
}

/**
 * Rattache une conversation à un numéro DÉJÀ vérifié, sans second code : possible uniquement avec la preuve signée
 * détenue par l'appareil ET si le numéro de la conversation est exactement celui de la preuve.
 */
export async function linkConversationWithProof(conversationId: number, proof: unknown): Promise<boolean> {
  const decoded = verifyPhoneProof(proof, proofSecret());
  if (!decoded) return false;

  const [conversation] = await db
    .select({ buyerPhone: conversationsTable.buyerPhone })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))
    .limit(1);
  const phone = conversation ? canonicalPhone(conversation.buyerPhone ?? "") : null;
  if (!phone || phone !== decoded.phone) return false;

  const now = new Date();
  const values = { phone, verifiedAt: now, codeHash: null, expiresAt: null, attempts: 0 };
  await db
    .insert(conversationPhoneVerificationsTable)
    .values({ conversationId, ...values })
    .onConflictDoUpdate({ target: conversationPhoneVerificationsTable.conversationId, set: values });
  return true;
}
