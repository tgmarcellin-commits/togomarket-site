/**
 * En-têtes communs de tous les appels serveur → API FedaPay.
 * Un User-Agent explicite évite que la protection anti-robots (Cloudflare) devant api.fedapay.com
 * prenne les requêtes du serveur pour un robot anonyme et renvoie la page « Just a moment… » (HTTP 403).
 */
export const FEDAPAY_USER_AGENT = "TogoMarket/1.0 (+https://togomarket.site; serveur)";

export function fedapayHeaders(secretKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": FEDAPAY_USER_AGENT,
  };
}
