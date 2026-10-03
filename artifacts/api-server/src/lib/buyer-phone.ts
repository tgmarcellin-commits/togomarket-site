import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  conversationPhoneVerificationsTable,
  conversationsTable,
  db,
} from "@workspace/db";
import type { DbOrTx } from "./accounting-ledger";
import { dispatchVendorOTP } from "./otp-provider";
import { constantTimeHexEqual, hashOpaqueToken } from "./marketplace-security";
import { normalizePhone } from "./phone";
import { BusinessRuleError } from "./route-errors";

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_WINDOW = 3;
const SEND_WINDOW_MS = 60 * 60 * 1000;

function codeHash(conversationId: number, phone: string, code: string): string {
  return hashOpaqueToken(`buyer-phone:${conversationId}:${phone}:${code}`);
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length <= 3 ? "•••" : `••••• ${digits.slice(-3)}`;
}

async function loadConversationPhone(
  conversationId: number,
  tx: DbOrTx = db,
): Promise<{ phone: string; buyerName: string } | null> {
  const [conversation] = await tx
    .select({ buyerPhone: conversationsTable.buyerPhone, buyerName: conversationsTable.buyerName })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))
    .limit(1);
  if (!conversation) return null;
  const phone = normalizePhone(conversation.buyerPhone ?? "");
  if (!phone || phone.length < 8) return null;
  return { phone, buyerName: conversation.buyerName || "" };
}

/**
 * Numéro (normalisé) dont la conversation a prouvé le contrôle par code WhatsApp, ou null.
 * Si le numéro de la conversation a changé depuis la vérification, la preuve n'est plus valable.
 */
export async function getVerifiedBuyerPhone(conversationId: number, tx: DbOrTx = db): Promise<string | null> {
  const [row] = await tx
    .select({ phone: conversationPhoneVerificationsTable.phone, verifiedAt: conversationPhoneVerificationsTable.verifiedAt })
    .from(conversationPhoneVerificationsTable)
    .where(eq(conversationPhoneVerificationsTable.conversationId, conversationId))
    .limit(1);
  if (!row?.verifiedAt) return null;
  const current = await loadConversationPhone(conversationId, tx);
  return current && current.phone === row.phone ? row.phone : null;
}

/** Envoie un code de vérification à 6 chiffres sur le WhatsApp du numéro de la conversation. */
export async function sendBuyerPhoneCode(
  conversationId: number,
): Promise<{ phoneMasked: string; expiresInSeconds: number }> {
  const conversation = await loadConversationPhone(conversationId);
  if (!conversation) throw new BusinessRuleError("Numéro de téléphone de la conversation introuvable.", 404);

  const now = new Date();
  const [existing] = await db
    .select()
    .from(conversationPhoneVerificationsTable)
    .where(eq(conversationPhoneVerificationsTable.conversationId, conversationId))
    .limit(1);

  // Limite d'envois : 3 codes par heure et par conversation
  const windowFresh = existing?.sendWindowStartedAt
    && now.getTime() - existing.sendWindowStartedAt.getTime() < SEND_WINDOW_MS;
  const sendCount = windowFresh ? existing.sendCount : 0;
  if (sendCount >= MAX_SENDS_PER_WINDOW) {
    throw new BusinessRuleError("Trop de codes demandés. Réessayez dans une heure.", 409);
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const values = {
    phone: conversation.phone,
    codeHash: codeHash(conversationId, conversation.phone, code),
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    attempts: 0,
    sendCount: sendCount + 1,
    sendWindowStartedAt: windowFresh ? existing.sendWindowStartedAt : now,
    // un nouveau code annule une éventuelle vérification précédente d'un AUTRE numéro
    ...(existing?.verifiedAt && existing.phone !== conversation.phone ? { verifiedAt: null } : {}),
  };
  await db
    .insert(conversationPhoneVerificationsTable)
    .values({ conversationId, ...values })
    .onConflictDoUpdate({ target: conversationPhoneVerificationsTable.conversationId, set: values });

  const dispatched = await dispatchVendorOTP(conversation.phone, code, conversation.buyerName || "Client");
  if (!dispatched.sent) {
    throw new BusinessRuleError("Envoi du code WhatsApp impossible pour le moment. Réessayez dans un instant.", 409);
  }
  return { phoneMasked: maskPhone(conversation.phone), expiresInSeconds: CODE_TTL_MS / 1000 };
}

/** Vérifie le code saisi. Après 5 essais ratés, un nouveau code doit être demandé. */
export async function verifyBuyerPhoneCode(
  conversationId: number,
  code: string,
): Promise<{ verified: true } | { verified: false; reason: "no_code" | "expired" | "too_many_attempts" | "wrong_code"; attemptsLeft?: number }> {
  const [row] = await db
    .select()
    .from(conversationPhoneVerificationsTable)
    .where(eq(conversationPhoneVerificationsTable.conversationId, conversationId))
    .limit(1);
  if (!row?.codeHash || !row.expiresAt) return { verified: false, reason: "no_code" };
  if (row.expiresAt.getTime() < Date.now()) return { verified: false, reason: "expired" };
  if (row.attempts >= MAX_ATTEMPTS) return { verified: false, reason: "too_many_attempts" };

  const current = await loadConversationPhone(conversationId);
  if (!current || current.phone !== row.phone) return { verified: false, reason: "no_code" };

  if (!constantTimeHexEqual(codeHash(conversationId, row.phone, code), row.codeHash)) {
    await db
      .update(conversationPhoneVerificationsTable)
      .set({ attempts: row.attempts + 1 })
      .where(eq(conversationPhoneVerificationsTable.conversationId, conversationId));
    return { verified: false, reason: "wrong_code", attemptsLeft: Math.max(0, MAX_ATTEMPTS - row.attempts - 1) };
  }

  await db
    .update(conversationPhoneVerificationsTable)
    .set({ verifiedAt: new Date(), codeHash: null, expiresAt: null, attempts: 0 })
    .where(eq(conversationPhoneVerificationsTable.conversationId, conversationId));
  return { verified: true };
}
