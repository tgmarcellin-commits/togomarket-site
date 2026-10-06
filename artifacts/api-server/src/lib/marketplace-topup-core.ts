/**
 * Alimentation du compte FedaPay « Marketplace » par l'opérateur (bouton de l'administration) : règles pures,
 * sans accès à la base ni au réseau, pour pouvoir les tester seules.
 */

/** Type d'entité placé dans les métadonnées de la transaction FedaPay : distingue une alimentation d'un paiement de course. */
export const TOPUP_ENTITY_TYPE = "marketplace_topup";

export const MIN_TOPUP_FCFA = 500;
export const MAX_TOPUP_FCFA = 5_000_000;

/**
 *  - reserve  : fonds destinés à couvrir les achats payés avec le solde 10défis (alimente aussi la réserve TogoMarket) ;
 *  - treasury : trésorerie générale chez FedaPay (retraits des livreurs, vendeurs et acheteurs).
 */
export type TopupTarget = "reserve" | "treasury";

export function isTopupTarget(value: unknown): value is TopupTarget {
  return value === "reserve" || value === "treasury";
}

export type TopupInput = { amountFcfa: number; target: TopupTarget };

export function parseTopupInput(body: unknown): { ok: true; value: TopupInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "Requête invalide." };
  const { amountFcfa, target } = body as Record<string, unknown>;
  if (typeof amountFcfa !== "number" || !Number.isInteger(amountFcfa)) {
    return { ok: false, error: "Montant invalide : saisissez un nombre entier de FCFA." };
  }
  if (amountFcfa < MIN_TOPUP_FCFA || amountFcfa > MAX_TOPUP_FCFA) {
    return { ok: false, error: `Le montant doit être compris entre ${MIN_TOPUP_FCFA} et ${MAX_TOPUP_FCFA} FCFA.` };
  }
  if (!isTopupTarget(target)) return { ok: false, error: "Choisissez la destination : réserve du jeu ou trésorerie FedaPay." };
  return { ok: true, value: { amountFcfa, target } };
}

/** Référence comptable d'une alimentation de trésorerie : unique par transaction FedaPay (jamais enregistrée deux fois). */
export function treasuryJournalReference(transactionId: string): string {
  return `MARKETPLACE_TOPUP_${transactionId}`;
}

/** Destination d'une alimentation retrouvée dans le grand livre, d'après la référence de son journal. */
export function targetFromJournalReference(reference: string): { target: TopupTarget; transactionId: string } | null {
  if (reference.startsWith("MARKETPLACE_TOPUP_")) return { target: "treasury", transactionId: reference.slice("MARKETPLACE_TOPUP_".length) };
  if (reference.startsWith("GAME_RESERVE_TOPUP_")) return { target: "reserve", transactionId: reference.slice("GAME_RESERVE_TOPUP_".length) };
  return null;
}
