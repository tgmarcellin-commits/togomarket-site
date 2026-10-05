/**
 * Cœur de l'inscription par numéro (challenge « 10Défis ») : validation des saisies, règles d'envoi et de contrôle du code
 * WhatsApp, limiteur par adresse. Aucun accès à la base de données : tout se teste seul.
 */

export const CODE_TTL_MS = 5 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
export const MAX_SENDS_PER_WINDOW = 3;
export const SEND_WINDOW_MS = 60 * 60 * 1000;

const PHONE_TEXT = /^[0-9+\s\-.()]{6,30}$/;
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}' .-]{1,59}$/u;

/** Nom normalisé (espaces réduits) ou null : 2 à 60 caractères, lettres, espaces, apostrophe, point, tiret. */
export function parseName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  return NAME_PATTERN.test(name) ? name : null;
}

/** Prénom envoyé dans le message WhatsApp (jamais le nom de famille). */
export function firstNameOf(name: string): string {
  return name.split(" ")[0]?.slice(0, 30) || "Joueur";
}

export type Parsed<T> = { ok: true; value: T } | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type SendInput = { phoneNumber: string; name: string };
export type VerifyInput = { phoneNumber: string; name: string; code: string };

export function parseSendInput(body: unknown): Parsed<SendInput> {
  if (!isRecord(body)) return { ok: false };
  const phone = typeof body["phoneNumber"] === "string" ? body["phoneNumber"].trim() : "";
  const name = parseName(body["name"]);
  if (!PHONE_TEXT.test(phone) || !name) return { ok: false };
  return { ok: true, value: { phoneNumber: phone, name } };
}

export function parseVerifyInput(body: unknown): Parsed<VerifyInput> {
  const send = parseSendInput(body);
  if (!send.ok) return { ok: false };
  const code = String((body as Record<string, unknown>)["code"] ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false };
  return { ok: true, value: { ...send.value, code } };
}

export type Challenge = {
  codeHash: string | null;
  expiresAt: Date | null;
  attempts: number;
  sendCount: number;
  sendWindowStartedAt: Date | null;
};

/** Un nouvel envoi est-il permis ? Au plus 3 codes par heure et par numéro. */
export function planSend(
  existing: Challenge | null,
  now: Date,
): { allowed: false } | { allowed: true; sendCount: number; windowStartedAt: Date } {
  const windowFresh = Boolean(existing?.sendWindowStartedAt)
    && now.getTime() - (existing!.sendWindowStartedAt as Date).getTime() < SEND_WINDOW_MS;
  const sendCount = windowFresh ? existing!.sendCount : 0;
  if (sendCount >= MAX_SENDS_PER_WINDOW) return { allowed: false };
  return {
    allowed: true,
    sendCount: sendCount + 1,
    windowStartedAt: windowFresh ? (existing!.sendWindowStartedAt as Date) : now,
  };
}

export type ChallengeState = "no_code" | "expired" | "too_many_attempts" | "ready";

/** Contrôles AVANT la comparaison du code : un code absent, expiré ou déjà trop essayé n'est jamais comparé. */
export function evaluateChallenge(existing: Challenge | null, now: Date): ChallengeState {
  if (!existing?.codeHash || !existing.expiresAt) return "no_code";
  if (existing.expiresAt.getTime() < now.getTime()) return "expired";
  if (existing.attempts >= MAX_CODE_ATTEMPTS) return "too_many_attempts";
  return "ready";
}

/** Limiteur en mémoire : `hit` renvoie true quand la clé dépasse `max` demandes dans la fenêtre. */
export function createRateLimiter(options: { max: number; windowMs: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    hit(key: string, now: number = Date.now()): boolean {
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + options.windowMs });
        if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
        return false;
      }
      entry.count += 1;
      return entry.count > options.max;
    },
  };
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length <= 3 ? "•••" : `••••• ${digits.slice(-3)}`;
}
