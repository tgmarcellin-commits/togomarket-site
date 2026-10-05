import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isProofSecretUsable } from "./phone-proof";

/**
 * Jeton de lancement du jeu « 10Défis » : signé, valable 10 minutes, à usage unique (l'usage unique est garanti en base).
 * Il prouve au jeu qu'un joueur vient de vérifier SON numéro sur TogoMarket, sans qu'il ait à le ressaisir.
 *
 * Il est volontairement distinct de la preuve de vérification du navigateur (phone-proof.ts) : contexte de signature
 * différent, donc l'un ne peut jamais être pris pour l'autre. Module sans accès à la base de données : il se teste seul.
 */

const VERSION = "v1";
const MAX_TOKEN_LENGTH = 400;

/** Durée de validité : le temps d'arriver sur le jeu et de l'échanger. */
export const LAUNCH_TTL_MS = 10 * 60 * 1000;

function signingKey(secret: string): Buffer {
  return createHash("sha256").update(`tm-game-launch:${VERSION}:${secret}`).digest();
}

/** Identifiant unique d'un jeton (jti), 128 bits aléatoires. */
export function newLaunchId(): string {
  return randomBytes(16).toString("base64url");
}

export function signLaunchToken(
  params: { phone: string; jti: string; nowMs?: number },
  secret: string | undefined,
): string | null {
  if (!isProofSecretUsable(secret)) return null;
  const key = signingKey(secret.trim());
  if (!/^\d{8,15}$/.test(params.phone) || !/^[A-Za-z0-9_-]{16,40}$/.test(params.jti)) return null;
  const nowMs = params.nowMs ?? Date.now();
  const payload = Buffer.from(JSON.stringify({ p: params.phone, j: params.jti, e: nowMs + LAUNCH_TTL_MS }), "utf8").toString("base64url");
  const signature = createHmac("sha256", key).update(`${VERSION}.${payload}`).digest("base64url");
  return `${VERSION}.${payload}.${signature}`;
}

export type VerifiedLaunchToken = { phone: string; jti: string; expiresAt: number };

/** Relit un jeton : signature valide, non expiré, contenu bien formé. Toute anomalie renvoie null. */
export function verifyLaunchToken(token: unknown, secret: string | undefined, nowMs: number = Date.now()): VerifiedLaunchToken | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH || !isProofSecretUsable(secret)) return null;
  const key = signingKey(secret.trim());
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, payload, signature] = parts as [string, string, string];

  const expected = createHmac("sha256", key).update(`${VERSION}.${payload}`).digest();
  const provided = Buffer.from(signature, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { p?: unknown; j?: unknown; e?: unknown };
    if (typeof data.p !== "string" || !/^\d{8,15}$/.test(data.p)) return null;
    if (typeof data.j !== "string" || !/^[A-Za-z0-9_-]{16,40}$/.test(data.j)) return null;
    if (typeof data.e !== "number" || !Number.isFinite(data.e) || data.e <= nowMs) return null;
    return { phone: data.p, jti: data.j, expiresAt: data.e };
  } catch {
    return null;
  }
}

/** Corps de la requête d'échange envoyée par le jeu : { token }. */
export function parseLaunchTokenInput(body: unknown): { ok: true; value: { token: string } } | { ok: false } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false };
  const token = (body as Record<string, unknown>)["token"];
  if (typeof token !== "string" || token.length < 20 || token.length > MAX_TOKEN_LENGTH) return { ok: false };
  return { ok: true, value: { token } };
}
