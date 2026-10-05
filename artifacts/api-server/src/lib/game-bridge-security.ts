import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Sécurité et validation du pont avec le mini-jeu « Les 10 Super Défis » (service hébergé à part).
 * Module volontairement SANS accès à la base de données : il se teste seul.
 */

const SECRET_MIN_LENGTH = 16;
const DEFAULT_MAX_CREDIT_FCFA = 1_000_000;

/** Plafond d'un crédit (garde-fou contre une erreur côté jeu). Réglable : GAME_BRIDGE_MAX_CREDIT_FCFA. */
export function maxCreditFcfa(): number {
  const value = Number(process.env.GAME_BRIDGE_MAX_CREDIT_FCFA);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_CREDIT_FCFA;
}

/** Le secret partagé doit exister et être assez long : sinon les routes restent fermées. */
export function isBridgeSecretConfigured(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= SECRET_MIN_LENGTH;
}

/** Comparaison en temps constant : les deux valeurs sont hachées d'abord (longueurs égales, aucune fuite de taille). */
export function isValidBridgeSecret(provided: unknown, expected: string | undefined): boolean {
  if (typeof provided !== "string" || provided.length === 0 || !isBridgeSecretConfigured(expected)) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export type VerifyInput = { phoneNumber: string };

export type CreditInput = {
  idempotencyKey: string;
  phoneNumber: string;
  amountFcfa: number;
  period: string;
  reason: "weekly" | "podium" | "monthly";
};

export type Parsed<T> = { ok: true; value: T } | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PHONE_TEXT = /^[0-9+\s\-.()]{6,30}$/;

export function parseVerifyInput(body: unknown): Parsed<VerifyInput> {
  if (!isRecord(body) || typeof body["phoneNumber"] !== "string") return { ok: false };
  const phoneNumber = body["phoneNumber"].trim();
  if (!PHONE_TEXT.test(phoneNumber)) return { ok: false };
  return { ok: true, value: { phoneNumber } };
}

export function parseCreditInput(body: unknown): Parsed<CreditInput> {
  if (!isRecord(body)) return { ok: false };
  const { idempotencyKey, phoneNumber, amountFcfa, period, reason } = body;

  // clé d'idempotence : texte ASCII imprimable sans espace, 8 à 200 caractères
  if (typeof idempotencyKey !== "string" || !/^[\x21-\x7E]{8,200}$/.test(idempotencyKey)) return { ok: false };
  if (typeof phoneNumber !== "string" || !PHONE_TEXT.test(phoneNumber.trim())) return { ok: false };
  // montant : un NOMBRE entier strictement positif (une chaîne « 500 » est refusée)
  if (typeof amountFcfa !== "number" || !Number.isInteger(amountFcfa) || amountFcfa <= 0 || amountFcfa > maxCreditFcfa()) {
    return { ok: false };
  }
  if (typeof period !== "string" || !/^[A-Za-z0-9_.:-]{1,40}$/.test(period)) return { ok: false };
  if (reason !== "weekly" && reason !== "podium" && reason !== "monthly") return { ok: false };

  return { ok: true, value: { idempotencyKey, phoneNumber: phoneNumber.trim(), amountFcfa, period, reason } };
}
