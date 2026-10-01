import { createHash, randomBytes } from "node:crypto";
import {
  db,
  virtualWalletsTable,
  walletLedgerTable,
  deliveryWithdrawalTicketsTable,
  type WalletOwnerType,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { normalizePhone } from "./phone";
import { postBalancedJournalEntry, STANDARD_ACCOUNTS, type DbOrTx } from "./accounting-ledger";

export function generateImmutableHash(params: {
  walletId: number;
  orderId?: number | null;
  entryType: string;
  amount: number;
  direction: "debit" | "credit";
  balanceAfter: number;
}): string {
  const nonce = randomBytes(8).toString("hex");
  const payload = `${params.walletId}:${params.orderId ?? "none"}:${params.entryType}:${params.amount}:${params.direction}:${params.balanceAfter}:${Date.now()}:${nonce}`;
  return createHash("sha256").update(payload).digest("hex");
}

export async function getOrCreateVirtualWallet(
  ownerType: WalletOwnerType,
  ownerId: number,
  tx: DbOrTx = db,
) {
  const [existing] = await tx
    .select()
    .from(virtualWalletsTable)
    .where(and(eq(virtualWalletsTable.ownerType, ownerType), eq(virtualWalletsTable.ownerId, ownerId)))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [created] = await tx
    .insert(virtualWalletsTable)
    .values({
      ownerType,
      ownerId,
      balance: 0,
      lockedBalance: 0,
      pendingPayoutBalance: 0,
      paidOutBalance: 0,
    })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  const [refetched] = await tx
    .select()
    .from(virtualWalletsTable)
    .where(and(eq(virtualWalletsTable.ownerType, ownerType), eq(virtualWalletsTable.ownerId, ownerId)))
    .limit(1);

  return refetched;
}

export async function recordWalletMovement(
  params: {
    walletId: number;
    orderId?: number | null;
    entryType: string;
    amount: number;
    direction: "debit" | "credit";
    balanceAfter: number;
    settlementRef?: string;
    metadata?: Record<string, unknown>;
  },
  tx: DbOrTx = db,
) {
  const immutableHash = generateImmutableHash(params);
  const [movement] = await tx
    .insert(walletLedgerTable)
    .values({
      walletId: params.walletId,
      orderId: params.orderId ?? null,
      entryType: params.entryType,
      amount: params.amount,
      direction: params.direction,
      balanceAfter: params.balanceAfter,
      settlementRef: params.settlementRef ?? null,
      immutableHash,
      metadata: params.metadata ?? null,
    })
    .returning();

  return movement;
}

export async function getWalletSummary(
  ownerType: WalletOwnerType,
  ownerId: number,
  tx: DbOrTx = db,
) {
  const wallet = await getOrCreateVirtualWallet(ownerType, ownerId, tx);

  const recentMovements = await tx
    .select()
    .from(walletLedgerTable)
    .where(eq(walletLedgerTable.walletId, wallet.id))
    .orderBy(desc(walletLedgerTable.createdAt))
    .limit(20);

  const providerConfigured = Boolean(
    process.env.FEDAPAY_SECRET_KEY || process.env.FEDAPAY_DRIVER_WEBHOOK_SECRET,
  );

  return {
    id: wallet.id,
    walletId: wallet.id,
    ownerType: wallet.ownerType,
    ownerId: wallet.ownerId,
    availableBalance: wallet.balance,
    lockedBalance: wallet.lockedBalance,
    pendingPayoutBalance: wallet.pendingPayoutBalance,
    paidOutBalance: wallet.paidOutBalance,
    balances: {
      availableBalanceFcfa: wallet.balance,
      lockedBalanceFcfa: wallet.lockedBalance,
      pendingPayoutBalanceFcfa: wallet.pendingPayoutBalance,
      paidOutBalanceFcfa: wallet.paidOutBalance,
      totalHoldingsFcfa: wallet.balance + wallet.lockedBalance + wallet.pendingPayoutBalance,
    },
    withdrawalReadiness: {
      canWithdraw: wallet.balance > 0,
      maxWithdrawableAmount: wallet.balance,
    },
    withdrawalAvailability: {
      canWithdraw: wallet.balance > 0,
      availableForWithdrawal: wallet.balance,
      lockedAmount: wallet.lockedBalance,
      pendingPayout: wallet.pendingPayoutBalance,
      statusLabel:
        wallet.pendingPayoutBalance > 0
          ? "Virement FedaPay en attente (délai estimé 2 à 3 jours ouvrés)"
          : wallet.balance > 0
            ? "Fonds disponibles pour retrait immédiat"
            : "Aucun fond retirable disponible",
      estimatedPayoutDays: "2-3 jours ouvrés",
      providerStatus: providerConfigured ? "configured" : "unconfigured",
    },
    recentMovements: recentMovements.map((m: typeof walletLedgerTable.$inferSelect) => ({
      id: m.id,
      entryType: m.entryType,
      amount: m.amount,
      direction: m.direction,
      balanceAfter: m.balanceAfter,
      settlementRef: m.settlementRef,
      createdAt: m.createdAt.toISOString(),
      metadata: m.metadata,
    })),
  };
}

export async function requestWalletWithdrawal(
  params: {
    ownerType: WalletOwnerType;
    ownerId: number;
    amount: number;
    phoneNumber?: string;
    phone?: string;
  },
  tx: DbOrTx = db,
) {
  const { ownerType, ownerId, amount } = params;
  const rawPhone = params.phoneNumber ?? params.phone ?? "";

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Montant de retrait invalide. Doit être un entier FCFA positif.");
  }

  const normalizedPhone = normalizePhone(rawPhone);
  if (!normalizedPhone || normalizedPhone.length < 8) {
    throw new Error("Numéro de téléphone invalide pour le retrait.");
  }

  return await tx.transaction(async (trx: any) => {
    // 1. Lock wallet row
    const [wallet] = await trx
      .select()
      .from(virtualWalletsTable)
      .where(and(eq(virtualWalletsTable.ownerType, ownerType), eq(virtualWalletsTable.ownerId, ownerId)))
      .for("update")
      .limit(1);

    if (!wallet) {
      throw new Error("Portefeuille introuvable.");
    }

    if (wallet.balance < amount) {
      throw new Error(
        `Solde insuffisant: disponible ${wallet.balance} FCFA, demandé ${amount} FCFA. Les fonds verrouillés (${wallet.lockedBalance} FCFA) ou en attente (${wallet.pendingPayoutBalance} FCFA) ne sont pas retirables.`,
      );
    }

    const newAvailable = wallet.balance - amount;
    const newPending = wallet.pendingPayoutBalance + amount;

    // 2. Update balances
    await trx
      .update(virtualWalletsTable)
      .set({
        balance: newAvailable,
        pendingPayoutBalance: newPending,
        updatedAt: new Date(),
      })
      .where(eq(virtualWalletsTable.id, wallet.id));

    // 3. Create withdrawal ticket
    const [ticket] = await trx
      .insert(deliveryWithdrawalTicketsTable)
      .values({
        ownerType,
        ownerId,
        walletId: wallet.id,
        phoneNumber: normalizedPhone,
        amount,
        status: "withdrawal_review_required",
      })
      .returning();

    // 4. Record wallet ledger movement
    await recordWalletMovement(
      {
        walletId: wallet.id,
        entryType: "withdrawal_requested",
        amount,
        direction: "debit",
        balanceAfter: newAvailable,
        settlementRef: `WD_TICKET_${ticket.id}`,
        metadata: {
          ticketId: ticket.id,
          phoneNumber: normalizedPhone,
        },
      },
      trx,
    );

    // 5. Post accounting entry
    const payableAccount =
      ownerType === "seller"
        ? STANDARD_ACCOUNTS.SELLER_PAYABLE.code
        : ownerType === "driver"
          ? STANDARD_ACCOUNTS.DRIVER_PAYABLE.code
          : STANDARD_ACCOUNTS.BUYER_WALLET_AVAILABLE.code;

    await postBalancedJournalEntry(
      {
        journalReference: `WD_REQ_${ticket.id}`,
        legs: [
          {
            debitAccountCode: payableAccount,
            creditAccountCode: STANDARD_ACCOUNTS.PENDING_PAYOUT.code,
            amount,
            description: `Demande de retrait #${ticket.id} (${ownerType} #${ownerId})`,
          },
        ],
        metadata: {
          ticketId: ticket.id,
          ownerType,
          ownerId,
        },
      },
      trx,
    );

    return {
      success: true,
      ticketId: ticket.id,
      amount,
      status: ticket.status,
      newAvailableBalance: newAvailable,
      newPendingPayoutBalance: newPending,
      availabilityNotice: "Retrait enregistré. Transfert FedaPay estimé sous 2-3 jours ouvrés.",
    };
  });
}
