/**
 * Cœur du paiement d'une commande avec le solde « 10défis » et de son remboursement.
 * Aucun accès à la base de données : tout passe par un « magasin » (SpendStore) que game-spend.ts branche sur UNE
 * transaction SQL verrouillée, et que les tests branchent sur une mémoire. Toute erreur levée annule la transaction.
 *
 * Règles de sécurité (non négociables) :
 *  - D = min(solde 10défis, réserve disponible, total) ; le reste R = total - D passe par le paiement classique ;
 *  - le solde 10défis et la réserve baissent ENSEMBLE, sous verrou, et ne deviennent jamais négatifs ;
 *  - un remboursement remet la part 10défis SUR LE SOLDE 10DÉFIS (jamais sur le solde retirable) et dans la réserve.
 */

export type GameSpendLedgerEntry = {
  journalReference: string;
  legs: Array<{
    debitAccountCode: string;
    creditAccountCode: string;
    amountFcfa: number;
    description: string;
    metadata: Record<string, unknown>;
  }>;
};

export interface SpendStore {
  /** Verrou de la réserve (toujours pris EN PREMIER), renvoie son solde. */
  lockReserve(): Promise<number>;
  /** Verrou du compte acheteur, renvoie son solde 10défis. */
  lockBuyerBalance(buyerAccountId: number): Promise<number>;
  setReserve(balance: number): Promise<void>;
  setBuyerBalance(buyerAccountId: number, balance: number): Promise<void>;
  postLedger(entry: GameSpendLedgerEntry): Promise<{ duplicate: boolean }>;
  /** Somme des écritures du ledger rattachées à cet acheteur sur le compte « solde 10défis ». */
  gameLedgerBalance(buyerAccountId: number): Promise<number>;
  /** Insère la ligne d'audit ; null si cette commande a déjà un mouvement de ce type. */
  insertMovement(row: {
    movementType: "purchase" | "refund";
    orderId: number;
    buyerAccountId: number;
    amountFcfa: number;
    buyerBalanceAfter: number;
    reserveBalanceAfter: number;
    actor: string;
    metadata: Record<string, unknown>;
  }): Promise<{ id: number } | null>;
}

/** Montant payé avec le solde 10défis : plafonné par le solde, par la réserve et par le total. */
export function computeGameApplied(params: {
  enabled: boolean;
  total: number;
  gameBalance: number;
  reserveAvailable: number;
}): number {
  if (!params.enabled) return 0;
  const value = Math.min(params.gameBalance, params.reserveAvailable, params.total);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Répartition d'un remboursement entre la part 10défis et la part retirable, au prorata de ce qui a été payé.
 * La part 10défis ne dépasse jamais ce qui a été payé en 10défis (arrondi au franc inférieur).
 */
export function splitRefund(refund: number, paidGame: number, paidTotal: number): { game: number; retirable: number } {
  const amount = Math.max(0, Math.floor(refund));
  if (paidGame <= 0 || paidTotal <= 0 || amount === 0) return { game: 0, retirable: amount };
  const game = Math.min(paidGame, amount, Math.floor((amount * paidGame) / paidTotal));
  return { game, retirable: amount - game };
}

export type SpendResult =
  | { ok: true; buyerBalanceAfter: number; reserveBalanceAfter: number; reserveBefore: number }
  | { ok: false; reason: "insufficient_balance" | "insufficient_reserve" | "already_recorded" };

export async function spendWithStore(
  store: SpendStore,
  params: { orderId: number; buyerAccountId: number; amount: number; total: number; reference: string; actor?: string },
): Promise<SpendResult> {
  const { orderId, buyerAccountId, amount } = params;
  if (!Number.isInteger(amount) || amount <= 0 || amount > params.total) {
    throw new Error("Montant 10défis invalide");
  }

  // Ordre des verrous : réserve, puis compte acheteur (même ordre partout : pas de blocage croisé)
  const reserveBefore = await store.lockReserve();
  const buyerBefore = await store.lockBuyerBalance(buyerAccountId);
  if (buyerBefore < amount) return { ok: false, reason: "insufficient_balance" };
  if (reserveBefore < amount) return { ok: false, reason: "insufficient_reserve" };

  const buyerAfter = buyerBefore - amount;
  const reserveAfter = reserveBefore - amount;

  const metadata = { buyerAccountId, orderId, source: "game_spend" };
  const posted = await store.postLedger({
    journalReference: `GAME_SPEND_${orderId}`,
    legs: [
      {
        // le solde virtuel de l'acheteur devient une somme en séquestre pour la commande
        debitAccountCode: "BUYER_GAME_WALLET",
        creditAccountCode: "BUYER_ESCROW",
        amountFcfa: amount,
        description: `Paiement commande #${orderId} avec le solde 10défis`,
        metadata,
      },
      {
        // les fonds réels qui couvriront ce montant sortent de la réserve et rejoignent la trésorerie FedaPay
        debitAccountCode: "FEDAPAY_CLEARING",
        creditAccountCode: "RESERVE_TOGOMARKET",
        amountFcfa: amount,
        description: `Réserve TogoMarket mobilisée pour la commande #${orderId}`,
        metadata,
      },
    ],
  });
  if (posted.duplicate) return { ok: false, reason: "already_recorded" };

  await store.setBuyerBalance(buyerAccountId, buyerAfter);
  await store.setReserve(reserveAfter);

  // Invariant : solde 10défis = somme des écritures du ledger de cet acheteur
  const ledgerBalance = await store.gameLedgerBalance(buyerAccountId);
  if (ledgerBalance !== buyerAfter) {
    throw new Error(`Écart solde 10défis (${buyerAfter}) / ledger (${ledgerBalance}) pour le compte ${buyerAccountId}`);
  }

  const movement = await store.insertMovement({
    movementType: "purchase",
    orderId,
    buyerAccountId,
    amountFcfa: amount,
    buyerBalanceAfter: buyerAfter,
    reserveBalanceAfter: reserveAfter,
    actor: params.actor ?? "system",
    metadata: { reference: params.reference, total: params.total },
  });
  if (!movement) return { ok: false, reason: "already_recorded" };

  return { ok: true, buyerBalanceAfter: buyerAfter, reserveBalanceAfter: reserveAfter, reserveBefore };
}

export type RefundResult =
  | { ok: true; buyerBalanceAfter: number; reserveBalanceAfter: number }
  | { ok: false; reason: "already_recorded" };

/**
 * Remboursement de la part 10défis. Le crédit du compte 2060 (côté acheteur) est écrit par le journal de règlement
 * de l'appelant ; ici : solde 10défis, réserve, écriture de reclassement de la réserve, audit, contrôle d'invariant.
 */
export async function refundWithStore(
  store: SpendStore,
  params: { orderId: number; buyerAccountId: number; amount: number; actor?: string; metadata?: Record<string, unknown> },
): Promise<RefundResult> {
  const { orderId, buyerAccountId, amount } = params;
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Montant de remboursement 10défis invalide");

  const reserveBefore = await store.lockReserve();
  const buyerBefore = await store.lockBuyerBalance(buyerAccountId);
  const buyerAfter = buyerBefore + amount;
  const reserveAfter = reserveBefore + amount;

  const posted = await store.postLedger({
    journalReference: `GAME_REFUND_RESERVE_${orderId}`,
    legs: [{
      // les fonds ne seront pas versés au vendeur : ils retournent dans la réserve
      debitAccountCode: "RESERVE_TOGOMARKET",
      creditAccountCode: "FEDAPAY_CLEARING",
      amountFcfa: amount,
      description: `Réserve TogoMarket re-créditée, remboursement commande #${orderId}`,
      metadata: { buyerAccountId, orderId, source: "game_refund" },
    }],
  });
  if (posted.duplicate) return { ok: false, reason: "already_recorded" };

  await store.setBuyerBalance(buyerAccountId, buyerAfter);
  await store.setReserve(reserveAfter);

  const ledgerBalance = await store.gameLedgerBalance(buyerAccountId);
  if (ledgerBalance !== buyerAfter) {
    throw new Error(`Écart solde 10défis (${buyerAfter}) / ledger (${ledgerBalance}) pour le compte ${buyerAccountId}`);
  }

  const movement = await store.insertMovement({
    movementType: "refund",
    orderId,
    buyerAccountId,
    amountFcfa: amount,
    buyerBalanceAfter: buyerAfter,
    reserveBalanceAfter: reserveAfter,
    actor: params.actor ?? "system",
    metadata: params.metadata ?? {},
  });
  if (!movement) return { ok: false, reason: "already_recorded" };

  return { ok: true, buyerBalanceAfter: buyerAfter, reserveBalanceAfter: reserveAfter };
}
