import { desc, like, or } from "drizzle-orm";
import { db, ledgerEntriesTable } from "@workspace/db";
import { postBalancedJournalEntry, STANDARD_ACCOUNTS } from "./accounting-ledger";
import { fetchBalances, isFedapayPayoutConfigured, type FedapayBalance } from "./fedapay-payouts";
import { readReserveBalance, reserveAlertThreshold, topUpReserve } from "./game-reserve";
import { logger } from "./logger";
import {
  MAX_TOPUP_FCFA,
  treasuryJournalReference,
  targetFromJournalReference,
  type TopupTarget,
} from "./marketplace-topup-core";

/**
 * Alimentation du compte FedaPay « Marketplace » : l'opérateur paie lui-même une transaction FedaPay (bouton de l'administration),
 * et le webhook enregistre le résultat. L'argent arrive réellement chez FedaPay ; ici on ne fait que l'inscrire :
 *   - destination « réserve » : réserve TogoMarket + écriture débit « Réserve » / crédit « Apports de l'opérateur » ;
 *   - destination « trésorerie » : écriture débit « FedaPay » / crédit « Apports de l'opérateur ».
 * Chaque transaction FedaPay n'est enregistrée qu'UNE fois (référence unique), même si le webhook est rejoué.
 */

export type TopupConfirmResult =
  | { kind: "recorded" }
  | { kind: "already_recorded" }
  | { kind: "rejected"; reason: "currency" | "amount" };

export async function confirmMarketplaceTopup(params: {
  transactionId: string;
  amount: number;
  currency: string;
  target: TopupTarget;
}): Promise<TopupConfirmResult> {
  if (params.currency !== "XOF") return { kind: "rejected", reason: "currency" };
  if (!Number.isInteger(params.amount) || params.amount <= 0 || params.amount > MAX_TOPUP_FCFA) {
    return { kind: "rejected", reason: "amount" };
  }

  if (params.target === "reserve") {
    const result = await topUpReserve({
      amountFcfa: params.amount,
      reference: params.transactionId,
      actor: "fedapay_topup",
      metadata: { source: "admin_fedapay_button", transactionId: params.transactionId },
    });
    return { kind: result.kind === "recorded" ? "recorded" : "already_recorded" };
  }

  const posted = await db.transaction((tx) =>
    postBalancedJournalEntry({
      journalReference: treasuryJournalReference(params.transactionId),
      legs: [{
        debitAccountCode: STANDARD_ACCOUNTS.FEDAPAY_CLEARING.code,
        creditAccountCode: STANDARD_ACCOUNTS.OPERATOR_CONTRIBUTIONS.code,
        amount: params.amount,
        description: `Alimentation de la trésorerie FedaPay (transaction ${params.transactionId})`,
        metadata: { transactionId: params.transactionId },
      }],
      metadata: { source: "marketplace_topup" },
    }, tx));
  return { kind: posted.duplicate ? "already_recorded" : "recorded" };
}

export type TopupOverview = {
  fedapay: {
    configured: boolean;
    reachable: boolean;
    balances: FedapayBalance[];
    totalFcfa: number;
  };
  reserve: { balanceFcfa: number; alertThresholdFcfa: number };
  recent: Array<{ transactionId: string; target: TopupTarget; amountFcfa: number; at: string }>;
};

/** Données de la carte d'administration : soldes chez FedaPay, réserve du jeu, dernières alimentations. */
export async function getTopupOverview(): Promise<TopupOverview> {
  let balances: FedapayBalance[] = [];
  let reachable = false;
  const configured = isFedapayPayoutConfigured();
  if (configured) {
    try {
      balances = await fetchBalances();
      reachable = true;
    } catch (err) {
      logger.warn({ err }, "Alimentation : soldes FedaPay indisponibles");
    }
  }

  const rows = await db
    .select({
      reference: ledgerEntriesTable.journalReference,
      amount: ledgerEntriesTable.amount,
      createdAt: ledgerEntriesTable.createdAt,
    })
    .from(ledgerEntriesTable)
    .where(or(
      like(ledgerEntriesTable.journalReference, "MARKETPLACE_TOPUP_%"),
      like(ledgerEntriesTable.journalReference, "GAME_RESERVE_TOPUP_%"),
    ))
    .orderBy(desc(ledgerEntriesTable.id))
    .limit(8);

  const recent = rows.flatMap((row) => {
    const parsed = targetFromJournalReference(row.reference);
    return parsed
      ? [{ transactionId: parsed.transactionId, target: parsed.target, amountFcfa: Number(row.amount), at: row.createdAt.toISOString() }]
      : [];
  });

  return {
    fedapay: {
      configured,
      reachable,
      balances,
      totalFcfa: balances.reduce((sum, balance) => sum + balance.amount, 0),
    },
    reserve: { balanceFcfa: await readReserveBalance(), alertThresholdFcfa: reserveAlertThreshold() },
    recent,
  };
}
