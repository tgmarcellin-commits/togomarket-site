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
