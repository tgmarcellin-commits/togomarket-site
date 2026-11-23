import { randomInt } from "node:crypto";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMAIL_MAX_LENGTH = 254;

/** Normalise une adresse e-mail : sans espaces, en minuscules. */
export function normalizeEmail(raw: string): string {
  return raw.replace(/\s+/g, "").toLowerCase();
}

/** Valide une adresse déjà normalisée. */
export function isValidEmail(email: string): boolean {
  return email.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(email);
}

/** Un identifiant de connexion est un e-mail s'il contient « @ » (un numéro n'en contient jamais). */
export function isEmailIdentifier(identifier: string): boolean {
  return identifier.includes("@");
}

/** « kofi.mensah@gmail.com » → « ko•••@gmail.com » */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  return `${email.slice(0, Math.min(2, at))}•••${email.slice(at)}`;
}

// Sans caractères ambigus (0/O, 1/l/I) pour une saisie fiable depuis un e-mail.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const ALL = UPPER + LOWER + DIGITS;

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)];
}

/** Mot de passe temporaire aléatoire (CSPRNG), 12 caractères, avec majuscule, minuscule et chiffre. */
export function generateTemporaryPassword(length = 12): string {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  while (chars.length < length) chars.push(pick(ALL));
  // Mélange de Fisher-Yates pour ne pas figer la position des 3 premiers caractères.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Violation de contrainte d'unicité Postgres (code 23505), y compris quand Drizzle enveloppe l'erreur. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}
