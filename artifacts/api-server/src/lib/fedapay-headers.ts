/**
 * En-têtes communs de tous les appels serveur → API FedaPay.
 * Un User-Agent explicite évite que la protection anti-robots (Cloudflare) devant api.fedapay.com
 * prenne les requêtes du serveur pour un robot anonyme et renvoie la page « Just a moment… » (HTTP 403).
 */
import { logger } from "./logger";

export const FEDAPAY_USER_AGENT = "TogoMarket/1.0 (+https://togomarket.site; serveur)";

export function fedapayHeaders(secretKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": FEDAPAY_USER_AGENT,
  };
}

const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 500;

/** Cloudflare (devant api.fedapay.com) renvoie parfois une page de vérification « Just a moment… » au lieu de l'API. */
async function isCloudflareChallenge(res: Response): Promise<boolean> {
  if (res.headers.get("cf-mitigated") === "challenge") return true;
  if (res.status !== 403 && res.status !== 503) return false;
  const text = await res.clone().text().catch(() => "");
  return /Just a moment|challenge-platform|cf-chl/i.test(text);
}

/**
 * fetch vers l'API FedaPay avec nouvelles tentatives automatiques.
 * Le blocage de Cloudflare est INTERMITTENT (échec, échec, puis réussite) : on réessaie donc quelques fois
 * avant de renvoyer une erreur. Réessayer est sans risque pour un paiement : une requête arrêtée par la
 * vérification Cloudflare n'a jamais atteint FedaPay, donc aucune transaction en double n'est créée.
 * Les erreurs temporaires 429/502/503/504 ne sont réessayées que pour les lectures (GET).
 */
export async function fedapayFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  let res = await fetch(url, init);
  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
    const challenged = await isCloudflareChallenge(res);
    const transient = method === "GET" && [429, 502, 503, 504].includes(res.status);
    if (!challenged && !transient) return res;
    logger.warn({ attempt, status: res.status, challenged, method }, "FedaPay : réponse bloquée/temporaire, nouvelle tentative");
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    res = await fetch(url, init);
  }
  return res;
}
