/**
 * Acceptation du règlement du challenge « 10Défis » : constantes et validation, sans accès à la base de données.
 * La version doit rester identique à GAME_RULES_VERSION du site (src/content/game-rules.ts) : un site resté en cache
 * avec un ancien règlement reçoit une erreur claire et doit recharger la page.
 */
export const CURRENT_GAME_RULES_VERSION = "2026-10";

export type AcceptRulesFailure = "invalid" | "not_accepted" | "outdated_version" | "phone_not_verified";

export type AcceptRulesInput = { phoneNumber: string; proof: string };

export function parseAcceptRulesInput(
  body: unknown,
): { ok: true; value: AcceptRulesInput } | { ok: false; reason: AcceptRulesFailure } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, reason: "invalid" };
  const { accepted, rulesVersion, phoneNumber, proof } = body as Record<string, unknown>;

  // Re-vérification côté serveur : seule la valeur booléenne `true` vaut acceptation (ni "true", ni 1, ni absence)
  if (accepted !== true) return { ok: false, reason: "not_accepted" };
  if (typeof rulesVersion !== "string") return { ok: false, reason: "invalid" };
  if (rulesVersion !== CURRENT_GAME_RULES_VERSION) return { ok: false, reason: "outdated_version" };
  if (typeof phoneNumber !== "string" || !/^[0-9+\s\-.()]{6,30}$/.test(phoneNumber.trim())) {
    return { ok: false, reason: "invalid" };
  }
  // Preuve de vérification du numéro (jeton signé obtenu après le code WhatsApp) : sans elle, pas de redirection.
  // Sa validité cryptographique est contrôlée par la route ; ici, seulement sa présence et sa taille.
  if (typeof proof !== "string" || proof.length < 20 || proof.length > 400) return { ok: false, reason: "phone_not_verified" };
  return { ok: true, value: { phoneNumber: phoneNumber.trim(), proof } };
}
