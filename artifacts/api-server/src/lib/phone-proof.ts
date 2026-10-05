import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Preuve de vérification d'un numéro : un jeton SIGNÉ que le navigateur conserve après la vérification par code WhatsApp.
 *
 * Pourquoi un jeton plutôt que « ce numéro est vérifié » côté base : un numéro est du texte saisi à la main. Si le
 * serveur considérait « vérifié » tout numéro déjà validé une fois, n'importe qui pourrait ouvrir une conversation en tapant
 * le numéro d'un autre et utiliser son solde. Ici, seule la personne qui détient LE JETON (donc l'appareil qui a reçu le
 * code) peut rattacher une conversation à ce numéro vérifié.
 *
 * Module sans accès à la base de données : il se teste seul. Le secret est SESSION_SECRET (déjà obligatoire sur le serveur).
 */

const VERSION = "v1";
const MIN_SECRET_LENGTH = 16;
const MAX_TOKEN_LENGTH = 400;

/** Durée de validité d'une preuve : 90 jours (le joueur revérifie son numéro ensuite). */
export const PROOF_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function signingKey(secret: string): Buffer {
  // clé dérivée : le même secret sert à d'autres usages (CSRF), jamais directement ici
  return createHash("sha256").update(`tm-phone-proof:${VERSION}:${secret}`).digest();
}

export function isProofSecretUsable(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.trim().length >= MIN_SECRET_LENGTH;
}

/** Signe une preuve pour un numéro canonique (chiffres, indicatif inclus). Renvoie null si le secret est inutilisable. */
export function signPhoneProof(phone: string, secret: string | undefined, nowMs: number = Date.now()): string | null {
  if (!isProofSecretUsable(secret) || !/^\d{8,15}$/.test(phone)) return null;
  const payload = Buffer.from(JSON.stringify({ p: phone, e: nowMs + PROOF_TTL_MS }), "utf8").toString("base64url");
  const signature = createHmac("sha256", signingKey(secret.trim())).update(`${VERSION}.${payload}`).digest("base64url");
  return `${VERSION}.${payload}.${signature}`;
}

export type VerifiedPhoneProof = { phone: string; expiresAt: number };

/** Relit une preuve : signature valide, non expirée, numéro bien formé. Toute anomalie renvoie null. */
export function verifyPhoneProof(token: unknown, secret: string | undefined, nowMs: number = Date.now()): VerifiedPhoneProof | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH || !isProofSecretUsable(secret)) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, payload, signature] = parts as [string, string, string];

  const expected = createHmac("sha256", signingKey(secret.trim())).update(`${VERSION}.${payload}`).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { p?: unknown; e?: unknown };
    if (typeof data.p !== "string" || !/^\d{8,15}$/.test(data.p)) return null;
    if (typeof data.e !== "number" || !Number.isFinite(data.e) || data.e <= nowMs) return null;
    return { phone: data.p, expiresAt: data.e };
  } catch {
    return null;
  }
}
