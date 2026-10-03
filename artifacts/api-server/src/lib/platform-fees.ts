/**
 * Barème TogoMarket (cahier des charges, sections 5 et 18).
 * Tout est en FCFA ENTIERS, calculé uniquement côté serveur.
 *
 * Commission fixe TogoMarket = 500 FCFA :
 *   - 250 FCFA payés par l'acheteur (ajoutés au total de la course)
 *   - 250 FCFA payés par le vendeur (déduits de son reversement)
 */
export const TOGOMARKET_BUYER_COMMISSION_FCFA = 250;
export const TOGOMARKET_SELLER_COMMISSION_FCFA = 250;

/**
 * Retour au vendeur : le trajet retour du livreur est payé la MOITIÉ du prix de l'aller.
 * Aller-retour = aller + moitié de l'aller (= 1,5 x l'aller).
 * Les frais d'aller sont toujours des multiples de 50 FCFA : la moitié est un entier.
 */
export function computeReturnLegFee(outboundFee: number): number {
  return Math.round(Math.max(0, outboundFee) / 2);
}

export function computeRoundTripFee(outboundFee: number): number {
  const outbound = Math.max(0, outboundFee);
  return outbound + computeReturnLegFee(outbound);
}

function toFcfa(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value as number)) : 0;
}

/**
 * Total payé par l'acheteur = prix de l'article confirmé
 * + prix du livreur (aller) + part acheteur de la commission TogoMarket.
 */
export function computeCourseTotal(order: {
  articlePriceLocked: number | null | undefined;
  transportFeeLocked: number | null | undefined;
}) {
  const articlePrice = toFcfa(order.articlePriceLocked);
  const driverFee = toFcfa(order.transportFeeLocked);
  const buyerCommission = TOGOMARKET_BUYER_COMMISSION_FCFA;
  return {
    articlePrice,
    driverFee,
    buyerCommission,
    total: articlePrice + driverFee + buyerCommission,
  };
}

/** Part vendeur de la commission : jamais plus que le prix de l'article (pas de reversement négatif). */
export function computeSellerCommission(articlePrice: number | null | undefined): number {
  return Math.min(TOGOMARKET_SELLER_COMMISSION_FCFA, toFcfa(articlePrice));
}

/** Montant reversé au vendeur après livraison confirmée. */
export function computeSellerPayout(articlePrice: number | null | undefined): number {
  return toFcfa(articlePrice) - computeSellerCommission(articlePrice);
}
