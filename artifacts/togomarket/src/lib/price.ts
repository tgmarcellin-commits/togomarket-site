/**
 * Les prix TogoMarket sont toujours des montants entiers en FCFA.
 * Les vendeurs saisissent parfois « 10.000 », « 10,000 », « 10 000 » ou « 10000,00 » :
 * on ignore les séparateurs au lieu de les interpréter comme une virgule décimale.
 *
 * Seul cas particulier : 1 ou 2 chiffres après le DERNIER séparateur (« 10000,00 », « 10000.5 »)
 * ne peuvent pas être des milliers (un groupe de milliers fait toujours 3 chiffres) :
 * ils sont écartés pour ne pas multiplier le prix par 100.
 */
export function parsePrice(raw: string | number | null | undefined): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw) : 0;
  const withoutDecimals = String(raw ?? "").trim().replace(/[.,]\d{1,2}$/, "");
  const digits = withoutDecimals.replace(/\D/g, "");
  return digits ? parseInt(digits, 10) : 0;
}
