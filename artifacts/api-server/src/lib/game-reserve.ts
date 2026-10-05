import { desc, eq } from "drizzle-orm";
import {
  adminAlertsTable,
  db,
  gameWalletMovementsTable,
  reserveTogomarketTable,
} from "@workspace/db";
import { postBalancedJournalEntry, STANDARD_ACCOUNTS, type DbOrTx } from "./accounting-ledger";
import { logger } from "./logger";

/**
 * Réserve TogoMarket : fonds réels que l'opérateur a lui-même injectés chez FedaPay pour couvrir les achats réglés
 * avec le solde « 10défis ». Une seule ligne (id = 1). Toute modification passe par un verrou de ligne.
 * La recharge elle-même (le paiement FedaPay dont l'opérateur est le payeur) se fait HORS de ce code : ici on ne fait
 * qu'enregistrer le solde qui en résulte.
 */

const RESERVE_ROW_ID = 1;

/** Seuil sous lequel une alerte est levée. Réglable : GAME_RESERVE_ALERT_THRESHOLD_FCFA (défaut 50 000). */
export function reserveAlertThreshold(): number {
  const value = Number(process.env.GAME_RESERVE_ALERT_THRESHOLD_FCFA);
  return Number.isInteger(value) && value >= 0 ? value : 50_000;
}

async function ensureReserveRow(tx: DbOrTx): Promise<void> {
  await tx.insert(reserveTogomarketTable).values({ id: RESERVE_ROW_ID, balanceFcfa: 0 }).onConflictDoNothing();
}

/** Verrouille la réserve (FOR UPDATE) et renvoie son solde. À prendre AVANT le verrou du compte acheteur. */
export async function lockReserveBalance(tx: DbOrTx): Promise<number> {
  await ensureReserveRow(tx);
  const [row] = await tx
    .select({ balance: reserveTogomarketTable.balanceFcfa })
    .from(reserveTogomarketTable)
    .where(eq(reserveTogomarketTable.id, RESERVE_ROW_ID))
    .for("update")
    .limit(1);
  if (!row) throw new Error("Réserve TogoMarket introuvable");
  return Number(row.balance);
}

export async function setReserveBalance(tx: DbOrTx, balance: number): Promise<void> {
  await tx
    .update(reserveTogomarketTable)
    .set({ balanceFcfa: balance, updatedAt: new Date() })
    .where(eq(reserveTogomarketTable.id, RESERVE_ROW_ID));
}

/** Lecture sans verrou (devis, écran d'administration). */
export async function readReserveBalance(tx: DbOrTx = db): Promise<number> {
  const [row] = await tx
    .select({ balance: reserveTogomarketTable.balanceFcfa })
    .from(reserveTogomarketTable)
    .where(eq(reserveTogomarketTable.id, RESERVE_ROW_ID))
    .limit(1);
  return row ? Number(row.balance) : 0;
}

/**
 * Alerte d'administration quand la réserve PASSE sous le seuil (une seule fois par franchissement, pas à chaque achat).
 * Ne fait jamais échouer le paiement : l'insertion tourne dans un point de sauvegarde isolé.
 */
export async function alertIfReserveLow(tx: DbOrTx, before: number, after: number): Promise<void> {
  const threshold = reserveAlertThreshold();
  if (!(before >= threshold && after < threshold)) return;
  logger.warn({ reserveFcfa: after, thresholdFcfa: threshold }, "Réserve TogoMarket sous le seuil d'alerte");
  try {
    await tx.transaction(async (savepoint: DbOrTx) => {
      await savepoint.insert(adminAlertsTable).values({
        category: "game_reserve",
        severity: after === 0 ? "critical" : "warning",
        title: "Réserve TogoMarket 10défis sous le seuil",
        message: `La réserve est tombée à ${after} FCFA (seuil ${threshold} FCFA). Rechargez-la : au-delà, les achats en 10défis sont limités à ce qui reste disponible, le reste passe en paiement FedaPay.`,
        metadata: { reserveFcfa: after, thresholdFcfa: threshold },
      });
    });
  } catch (err) {
    logger.error({ err }, "Alerte de réserve impossible à enregistrer");
  }
}

export type TopUpResult =
  | { kind: "recorded"; balanceBefore: number; balanceAfter: number }
  | { kind: "already_recorded" };

/**
 * Recharge manuelle : enregistre le montant et la référence de la transaction FedaPay correspondante.
 * Écriture comptable : débit « Réserve TogoMarket » (actif), crédit « Apports de l'opérateur » (capitaux propres).
 * Une même référence FedaPay ne peut être enregistrée qu'une fois.
 */
export async function topUpReserve(params: {
  amountFcfa: number;
  reference: string;
  actor: string;
  metadata?: Record<string, unknown>;
}): Promise<TopUpResult> {
  return db.transaction(async (tx): Promise<TopUpResult> => {
    const before = await lockReserveBalance(tx);
    const after = before + params.amountFcfa;

    const [movement] = await tx
      .insert(gameWalletMovementsTable)
      .values({
        movementType: "reserve_topup",
        orderId: null,
        buyerAccountId: null,
        amountFcfa: params.amountFcfa,
        buyerBalanceAfter: null,
        reserveBalanceAfter: after,
        reference: params.reference,
        actor: params.actor,
        metadata: params.metadata ?? {},
      })
      .onConflictDoNothing()
      .returning({ id: gameWalletMovementsTable.id });
    if (!movement) return { kind: "already_recorded" };

    await setReserveBalance(tx, after);
    await postBalancedJournalEntry({
      journalReference: `GAME_RESERVE_TOPUP_${params.reference}`,
      legs: [{
        debitAccountCode: STANDARD_ACCOUNTS.RESERVE_TOGOMARKET.code,
        creditAccountCode: STANDARD_ACCOUNTS.OPERATOR_CONTRIBUTIONS.code,
        amount: params.amountFcfa,
        description: `Recharge de la réserve TogoMarket (transaction FedaPay ${params.reference})`,
        metadata: { reference: params.reference, actor: params.actor },
      }],
      metadata: { source: "game_reserve_topup" },
    }, tx);

    return { kind: "recorded", balanceBefore: before, balanceAfter: after };
  });
}

export async function getReserveOverview(limit = 20): Promise<{
  balanceFcfa: number;
  alertThresholdFcfa: number;
  movements: Array<{
    id: number;
    movementType: string;
    orderId: number | null;
    amountFcfa: number;
    reserveBalanceAfter: number;
    reference: string | null;
    actor: string;
    createdAt: Date;
  }>;
}> {
  const balanceFcfa = await readReserveBalance();
  const rows = await db
    .select({
      id: gameWalletMovementsTable.id,
      movementType: gameWalletMovementsTable.movementType,
      orderId: gameWalletMovementsTable.orderId,
      amountFcfa: gameWalletMovementsTable.amountFcfa,
      reserveBalanceAfter: gameWalletMovementsTable.reserveBalanceAfter,
      reference: gameWalletMovementsTable.reference,
      actor: gameWalletMovementsTable.actor,
      createdAt: gameWalletMovementsTable.createdAt,
    })
    .from(gameWalletMovementsTable)
    .orderBy(desc(gameWalletMovementsTable.id))
    .limit(Math.min(Math.max(limit, 1), 100));
  return { balanceFcfa, alertThresholdFcfa: reserveAlertThreshold(), movements: rows.map((row) => ({ ...row, reserveBalanceAfter: Number(row.reserveBalanceAfter) })) };
}
