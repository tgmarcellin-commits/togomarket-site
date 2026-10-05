import { and, eq, sql } from "drizzle-orm";
import {
  buyerAccountsTable,
  db,
  gameWalletMovementsTable,
  ledgerAccountsTable,
} from "@workspace/db";
import { postBalancedJournalEntry, STANDARD_ACCOUNTS, type DbOrTx } from "./accounting-ledger";
import { getVerifiedBuyerPhone } from "./buyer-phone";
import {
  computeGameApplied,
  refundWithStore,
  spendWithStore,
  splitRefund,
  type SpendStore,
} from "./game-spend-core";
import {
  alertIfReserveLow,
  lockReserveBalance,
  readReserveBalance,
  setReserveBalance,
} from "./game-reserve";

/**
 * Paiement d'une commande avec le solde « 10défis » et remboursement de cette part.
 *
 * GARDE-FOUS :
 *  - tant que GAME_WALLET_SPENDING_ENABLED n'est pas « true », AUCUN achat en 10défis n'est possible ;
 *  - le solde n'est utilisable que si le numéro de l'acheteur est vérifié par code WhatsApp dans la conversation
 *    (un numéro saisi à la main ne prouve pas qu'il appartient à celui qui écrit) ;
 *  - ce module est, avec game-wallet.ts (crédit mensuel du jeu), le SEUL endroit qui écrit solde_10defis_fcfa :
 *    aucun chemin ne le transfère vers le portefeuille retirable ;
 *  - les montants sont toujours lus et modifiés sous verrou (FOR UPDATE), dans la transaction de l'appelant.
 */

export function isGameSpendingEnabled(): boolean {
  return process.env.GAME_WALLET_SPENDING_ENABLED === "true";
}

/* ───────── colonnes de répartition de la commande (SQL direct : aucun impact sur les autres lectures de orders) ───────── */

let splitColumnsKnown = false;
let splitColumnsCheckedAt = 0;

async function ordersSplitColumnsAvailable(tx: DbOrTx): Promise<boolean> {
  if (splitColumnsKnown) return true;
  if (Date.now() - splitColumnsCheckedAt < 60_000) return false;
  splitColumnsCheckedAt = Date.now();
  const result = await tx.execute(sql`
    select count(*)::int as n from information_schema.columns
    where table_name = 'orders' and column_name in ('paye_via_10defis_fcfa', 'paye_via_fedapay_fcfa')`);
  splitColumnsKnown = Number((result.rows[0] as { n?: number } | undefined)?.n ?? 0) === 2;
  return splitColumnsKnown;
}

/** Répartition enregistrée à l'achat ; null pour une commande payée avant cette fonction (tout est retirable). */
export async function readOrderPaymentSplit(
  tx: DbOrTx,
  orderId: number,
): Promise<{ game: number; fedapay: number } | null> {
  if (!(await ordersSplitColumnsAvailable(tx))) return null;
  const result = await tx.execute(sql`
    select paye_via_10defis_fcfa as game, paye_via_fedapay_fcfa as fedapay from orders where id = ${orderId}`);
  const row = result.rows[0] as { game: number | null; fedapay: number | null } | undefined;
  if (!row || row.game === null || row.fedapay === null) return null;
  return { game: Number(row.game), fedapay: Number(row.fedapay) };
}

/**
 * Enregistre, UNE SEULE FOIS, la répartition du paiement : paye_via_10defis_fcfa (D) et paye_via_fedapay_fcfa
 * (tout le reste : solde retirable + FedaPay). Un déclencheur en base les rend ensuite immuables.
 * Sans effet tant que la fonction est désactivée (les colonnes restent vides : commande « classique »).
 */
export async function recordOrderPaymentSplit(tx: DbOrTx, orderId: number, game: number, total: number): Promise<void> {
  if (!isGameSpendingEnabled()) return;
  if (!(await ordersSplitColumnsAvailable(tx))) {
    throw new Error("Colonnes paye_via_* absentes : exécutez la migration 20261012_game_reserve_checkout.sql");
  }
  await tx.execute(sql`
    update orders
    set paye_via_10defis_fcfa = ${game}, paye_via_fedapay_fcfa = ${total - game}
    where id = ${orderId} and paye_via_10defis_fcfa is null and paye_via_fedapay_fcfa is null`);
}

/* ───────── compte acheteur et plan de paiement (lecture seule, pour le devis) ───────── */

async function verifiedGameAccount(tx: DbOrTx, conversationId: number): Promise<{ id: number; balance: number } | null> {
  const phone = await getVerifiedBuyerPhone(conversationId, tx);
  if (!phone) return null;
  const [account] = await tx
    .select({ id: buyerAccountsTable.id, balance: buyerAccountsTable.solde10defisFcfa })
    .from(buyerAccountsTable)
    .where(eq(buyerAccountsTable.phone, phone))
    .limit(1);
  return account ? { id: account.id, balance: account.balance } : null;
}

export type GamePlan = {
  enabled: boolean;
  /** Numéro vérifié et solde disponible : le paiement en 10défis est possible. */
  eligible: boolean;
  gameBalance: number;
  reserveAvailable: number;
  /** D : part du total réglée avec le solde 10défis. */
  gameApplied: number;
};

export async function planGameSpend(params: {
  conversationId: number | null;
  total: number;
  useGame?: boolean;
}): Promise<GamePlan> {
  const none: GamePlan = { enabled: isGameSpendingEnabled(), eligible: false, gameBalance: 0, reserveAvailable: 0, gameApplied: 0 };
  if (!none.enabled || !params.conversationId) return none;
  const account = await verifiedGameAccount(db, params.conversationId);
  if (!account || account.balance <= 0) return none;
  const reserveAvailable = await readReserveBalance(db);
  const gameApplied = params.useGame === false
    ? 0
    : computeGameApplied({ enabled: true, total: params.total, gameBalance: account.balance, reserveAvailable });
  return { enabled: true, eligible: reserveAvailable > 0, gameBalance: account.balance, reserveAvailable, gameApplied };
}

/* ───────── magasin branché sur la transaction SQL de l'appelant ───────── */

async function gameLedgerBalance(tx: DbOrTx, buyerAccountId: number): Promise<number> {
  const [account] = await tx
    .select({ id: ledgerAccountsTable.id })
    .from(ledgerAccountsTable)
    .where(eq(ledgerAccountsTable.code, STANDARD_ACCOUNTS.BUYER_GAME_WALLET.code))
    .limit(1);
  if (!account) return 0;
  const result = await tx.execute(sql`
    select coalesce(sum(case
        when credit_account_id = ${account.id} then amount
        when debit_account_id = ${account.id} then -amount
        else 0 end), 0)::bigint as total
    from ledger_entries
    where (credit_account_id = ${account.id} or debit_account_id = ${account.id})
      and metadata->>'buyerAccountId' = ${String(buyerAccountId)}`);
  return Number((result.rows[0] as { total?: string | number } | undefined)?.total ?? 0);
}

type AccountKey = keyof typeof STANDARD_ACCOUNTS;

function storeFor(tx: DbOrTx): SpendStore {
  return {
    lockReserve: () => lockReserveBalance(tx),
    async lockBuyerBalance(buyerAccountId) {
      const [row] = await tx
        .select({ balance: buyerAccountsTable.solde10defisFcfa })
        .from(buyerAccountsTable)
        .where(eq(buyerAccountsTable.id, buyerAccountId))
        .for("update")
        .limit(1);
      if (!row) throw new Error("Compte acheteur introuvable");
      return row.balance;
    },
    setReserve: (balance) => setReserveBalance(tx, balance),
    async setBuyerBalance(buyerAccountId, balance) {
      await tx.update(buyerAccountsTable).set({ solde10defisFcfa: balance }).where(eq(buyerAccountsTable.id, buyerAccountId));
    },
    async postLedger(entry) {
      const posted = await postBalancedJournalEntry({
        journalReference: entry.journalReference,
        legs: entry.legs.map((leg) => ({
          debitAccountCode: STANDARD_ACCOUNTS[leg.debitAccountCode as AccountKey].code,
          creditAccountCode: STANDARD_ACCOUNTS[leg.creditAccountCode as AccountKey].code,
          amount: leg.amountFcfa,
          description: leg.description,
          metadata: leg.metadata,
        })),
      }, tx);
      return { duplicate: posted.duplicate };
    },
    gameLedgerBalance: (buyerAccountId) => gameLedgerBalance(tx, buyerAccountId),
    async insertMovement(row) {
      const [inserted] = await tx
        .insert(gameWalletMovementsTable)
        .values({
          movementType: row.movementType,
          orderId: row.orderId,
          buyerAccountId: row.buyerAccountId,
          amountFcfa: row.amountFcfa,
          buyerBalanceAfter: row.buyerBalanceAfter,
          reserveBalanceAfter: row.reserveBalanceAfter,
          actor: row.actor,
          metadata: row.metadata,
        })
        .onConflictDoNothing()
        .returning({ id: gameWalletMovementsTable.id });
      return inserted ?? null;
    },
  };
}

/* ───────── achat ───────── */

export type ApplyGameSpendResult =
  | { ok: true; buyerAccountId: number }
  | { ok: false; reason: "disabled" | "not_verified" | "insufficient_balance" | "insufficient_reserve" | "already_recorded" };

/**
 * À appeler DANS la transaction qui confirme le paiement de la commande (verrou de la commande déjà pris).
 * Décrémente solde 10défis ET réserve, écrit le ledger et l'audit. Un refus ne modifie rien.
 */
export async function applyGameSpendInTx(
  tx: DbOrTx,
  params: { orderId: number; conversationId: number | null; amount: number; total: number; reference: string },
): Promise<ApplyGameSpendResult> {
  if (!isGameSpendingEnabled()) return { ok: false, reason: "disabled" };
  if (!params.conversationId) return { ok: false, reason: "not_verified" };
  const account = await verifiedGameAccount(tx, params.conversationId);
  if (!account) return { ok: false, reason: "not_verified" };

  const result = await spendWithStore(storeFor(tx), {
    orderId: params.orderId,
    buyerAccountId: account.id,
    amount: params.amount,
    total: params.total,
    reference: params.reference,
  });
  if (!result.ok) return result;
  await alertIfReserveLow(tx, result.reserveBefore, result.reserveBalanceAfter);
  return { ok: true, buyerAccountId: account.id };
}

/* ───────── remboursement (commande non livrée / retournée) ───────── */

export type ReturnRefundPlan = {
  /** Part remboursée sur le solde 10défis. */
  game: number;
  /** Part remboursée sur le solde classique retirable. */
  retirable: number;
  /** Compte acheteur débité à l'achat : celui qui doit être re-crédité. */
  buyerAccountId: number | null;
};

/**
 * Répartit un remboursement entre solde 10défis et solde retirable, d'après ce qui a été ENREGISTRÉ à l'achat
 * (paye_via_10defis_fcfa / paye_via_fedapay_fcfa), au prorata. Commande sans répartition : tout est retirable.
 */
export async function planReturnRefund(tx: DbOrTx, orderId: number, refundAmount: number): Promise<ReturnRefundPlan> {
  const split = await readOrderPaymentSplit(tx, orderId);
  if (!split || split.game <= 0) return { game: 0, retirable: Math.max(0, Math.floor(refundAmount)), buyerAccountId: null };

  const [purchase] = await tx
    .select({ buyerAccountId: gameWalletMovementsTable.buyerAccountId })
    .from(gameWalletMovementsTable)
    .where(and(eq(gameWalletMovementsTable.orderId, orderId), eq(gameWalletMovementsTable.movementType, "purchase")))
    .limit(1);
  if (!purchase?.buyerAccountId) {
    // Répartition 10défis enregistrée mais achat introuvable : on ne devine jamais, tout est annulé
    throw new Error(`Commande #${orderId} : part 10défis enregistrée sans mouvement d'achat`);
  }
  const { game, retirable } = splitRefund(refundAmount, split.game, split.game + split.fedapay);
  return { game, retirable, buyerAccountId: purchase.buyerAccountId };
}

/**
 * À appeler APRÈS l'écriture du journal de règlement (qui crédite le compte « solde 10défis » de la part remboursée) :
 * re-crédite le solde 10défis et la réserve, reclasse les fonds, audite et contrôle l'invariant.
 */
export async function applyGameRefundInTx(
  tx: DbOrTx,
  params: { orderId: number; buyerAccountId: number; amount: number; metadata?: Record<string, unknown> },
): Promise<void> {
  const result = await refundWithStore(storeFor(tx), params);
  if (!result.ok) throw new Error(`Remboursement 10défis déjà enregistré pour la commande #${params.orderId}`);
}
