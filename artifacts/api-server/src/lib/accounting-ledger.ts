import { createHash } from "node:crypto";
import { db, ledgerAccountsTable, ledgerEntriesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export type LedgerAccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type DbOrTx = any;

export const STANDARD_ACCOUNTS = {
  FEDAPAY_CLEARING: {
    code: "1010",
    name: "Compte de compensation FedaPay (Actif)",
    accountType: "asset" as LedgerAccountType,
  },
  FEDAPAY_PAYOUT_SETTLEMENT: {
    code: "5010",
    name: "Règlement des retraits FedaPay (Actif/Trésorerie)",
    accountType: "asset" as LedgerAccountType,
  },
  BUYER_ESCROW: {
    code: "2010",
    name: "Dépôt séquestre acheteur (Passif)",
    accountType: "liability" as LedgerAccountType,
  },
  BUYER_WALLET_AVAILABLE: {
    code: "2015",
    name: "Solde disponible acheteur / Remboursements (Passif)",
    accountType: "liability" as LedgerAccountType,
  },
  SELLER_PAYABLE: {
    code: "2020",
    name: "Fournisseurs / Vendeurs à payer (Passif)",
    accountType: "liability" as LedgerAccountType,
  },
  DRIVER_PAYABLE: {
    code: "2030",
    name: "Livreurs à payer (Passif)",
    accountType: "liability" as LedgerAccountType,
  },
  PENDING_PAYOUT: {
    code: "2040",
    name: "Fonds en cours de virement sortant (Passif)",
    accountType: "liability" as LedgerAccountType,
  },
  MARKETPLACE_COMMISSION: {
    code: "4010",
    name: "Commissions Marketplace TogoMarket (Produit)",
    accountType: "revenue" as LedgerAccountType,
  },
} as const;

export async function ensureStandardLedgerAccounts(tx: DbOrTx = db): Promise<Map<string, number>> {
  const accountMap = new Map<string, number>();
  for (const acc of Object.values(STANDARD_ACCOUNTS)) {
    const [existing] = await tx
      .select({ id: ledgerAccountsTable.id })
      .from(ledgerAccountsTable)
      .where(eq(ledgerAccountsTable.code, acc.code))
      .limit(1);

    if (existing) {
      accountMap.set(acc.code, existing.id);
    } else {
      const [created] = await tx
        .insert(ledgerAccountsTable)
        .values({
          code: acc.code,
          name: acc.name,
          accountType: acc.accountType,
        })
        .returning({ id: ledgerAccountsTable.id });
      accountMap.set(acc.code, created.id);
    }
  }
  return accountMap;
}

export type JournalLeg = {
  debitAccountCode: string;
  creditAccountCode: string;
  amount: number;
  description: string;
  metadata?: Record<string, unknown>;
  entrySide?: "debit" | "credit" | "balanced";
};

export async function postBalancedJournalEntry(
  params: {
    journalReference: string;
    legs: JournalLeg[];
    metadata?: Record<string, unknown>;
  },
  tx: DbOrTx = db,
): Promise<{ success: boolean; journalReference: string; entriesCount: number; duplicate: boolean }> {
  const { journalReference, legs, metadata } = params;

  if (!journalReference || journalReference.trim().length === 0) {
    throw new Error("journalReference est requis");
  }

  if (!legs || legs.length === 0) {
    throw new Error("Au moins une écriture comptable est requise");
  }

  // Idempotency check: verify if this journalReference was already posted
  const existing = await tx
    .select({ id: ledgerEntriesTable.id })
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.journalReference, journalReference))
    .limit(1);

  if (existing.length > 0) {
    return {
      success: true,
      journalReference,
      entriesCount: existing.length,
      duplicate: true,
    };
  }

  // Verify balanced invariant: debits must equal credits across all legs
  let totalDebit = 0;
  let totalCredit = 0;
  for (const leg of legs) {
    if (!Number.isInteger(leg.amount) || leg.amount <= 0) {
      throw new Error(`Montant comptable invalide: ${leg.amount}. Doit être un entier FCFA strictement positif.`);
    }
    const meta = (leg.metadata ?? {}) as Record<string, unknown>;
    const side = leg.entrySide ?? meta.entrySide ?? meta.side;
    if (side === "debit") {
      totalDebit += leg.amount;
    } else if (side === "credit") {
      totalCredit += leg.amount;
    } else if (typeof meta.debitAmount === "number" || typeof meta.creditAmount === "number") {
      totalDebit += Number(meta.debitAmount ?? 0);
      totalCredit += Number(meta.creditAmount ?? 0);
    } else {
      if (leg.debitAccountCode === leg.creditAccountCode) {
        throw new Error(`Le compte de débit et de crédit ne peuvent pas être identiques: ${leg.debitAccountCode}`);
      }
      totalDebit += leg.amount;
      totalCredit += leg.amount;
    }
  }

  if (totalDebit !== totalCredit) {
    throw new Error(`Journal déséquilibré: débit ${totalDebit} != crédit ${totalCredit}`);
  }

  const accountMap = await ensureStandardLedgerAccounts(tx);

  for (const leg of legs) {
    const debitAccountId = accountMap.get(leg.debitAccountCode);
    const creditAccountId = accountMap.get(leg.creditAccountCode);

    if (!debitAccountId) {
      throw new Error(`Compte de débit introuvable: ${leg.debitAccountCode}`);
    }
    if (!creditAccountId) {
      throw new Error(`Compte de crédit introuvable: ${leg.creditAccountCode}`);
    }

    await tx.insert(ledgerEntriesTable).values({
      journalReference,
      debitAccountId,
      creditAccountId,
      amount: leg.amount,
      description: leg.description,
      metadata: {
        ...metadata,
        ...leg.metadata,
        ...(leg.entrySide ? { entrySide: leg.entrySide } : {}),
      },
    });
  }

  return {
    success: true,
    journalReference,
    entriesCount: legs.length,
    duplicate: false,
  };
}

export async function reverseJournalEntry(
  params: {
    originalJournalReference: string;
    reversalJournalReference?: string;
    reason: string;
  },
  tx: DbOrTx = db,
): Promise<{ success: boolean; reversalJournalReference: string; reversedEntriesCount: number }> {
  const { originalJournalReference, reason } = params;
  const reversalRef = params.reversalJournalReference ?? `REV_${originalJournalReference}`;

  const existingEntries = await tx
    .select({
      id: ledgerEntriesTable.id,
      debitAccountId: ledgerEntriesTable.debitAccountId,
      creditAccountId: ledgerEntriesTable.creditAccountId,
      amount: ledgerEntriesTable.amount,
      description: ledgerEntriesTable.description,
      metadata: ledgerEntriesTable.metadata,
    })
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.journalReference, originalJournalReference));

  if (existingEntries.length === 0) {
    throw new Error(`Écritures introuvables pour le journal ${originalJournalReference}`);
  }

  // Append-only reversal: flip debit and credit accounts, and preserve side semantics
  for (const entry of existingEntries) {
    const origMeta = (entry.metadata ?? {}) as Record<string, unknown>;
    const reversedMeta: Record<string, unknown> = {
      ...origMeta,
      reversedFrom: originalJournalReference,
      reversalReason: reason,
    };
    if (origMeta.entrySide === "debit" || origMeta.side === "debit") {
      reversedMeta.entrySide = "credit";
      reversedMeta.side = "credit";
    } else if (origMeta.entrySide === "credit" || origMeta.side === "credit") {
      reversedMeta.entrySide = "debit";
      reversedMeta.side = "debit";
    }
    if (typeof origMeta.debitAmount === "number" || typeof origMeta.creditAmount === "number") {
      reversedMeta.debitAmount = origMeta.creditAmount ?? 0;
      reversedMeta.creditAmount = origMeta.debitAmount ?? 0;
    }

    await tx.insert(ledgerEntriesTable).values({
      journalReference: reversalRef,
      debitAccountId: entry.creditAccountId, // flipped
      creditAccountId: entry.debitAccountId, // flipped
      amount: entry.amount,
      description: `Annulation de [${originalJournalReference}]: ${reason}`,
      metadata: reversedMeta,
    });
  }

  return {
    success: true,
    reversalJournalReference: reversalRef,
    reversedEntriesCount: existingEntries.length,
  };
}

export async function getTrialBalance(tx: DbOrTx = db): Promise<{
  accounts: Array<{
    code: string;
    name: string;
    accountType: string;
    totalDebit: number;
    totalCredit: number;
    netBalance: number;
  }>;
  totalDebitSum: number;
  totalCreditSum: number;
  isBalanced: boolean;
  difference: number;
}> {
  const accounts = await tx.select().from(ledgerAccountsTable);
  const entries = await tx.select().from(ledgerEntriesTable);

  const debitsByAccount = new Map<number, number>();
  const creditsByAccount = new Map<number, number>();

  let totalDebitSum = 0;
  let totalCreditSum = 0;

  for (const entry of entries) {
    const meta = (entry.metadata ?? {}) as Record<string, unknown>;
    const side = meta.entrySide ?? meta.side;

    if (side === "debit") {
      const debitCurr = debitsByAccount.get(entry.debitAccountId) ?? 0;
      debitsByAccount.set(entry.debitAccountId, debitCurr + entry.amount);
      totalDebitSum += entry.amount;
    } else if (side === "credit") {
      const creditCurr = creditsByAccount.get(entry.creditAccountId) ?? 0;
      creditsByAccount.set(entry.creditAccountId, creditCurr + entry.amount);
      totalCreditSum += entry.amount;
    } else if (typeof meta.debitAmount === "number" || typeof meta.creditAmount === "number") {
      const dAmt = Number(meta.debitAmount ?? 0);
      const cAmt = Number(meta.creditAmount ?? 0);
      const debitCurr = debitsByAccount.get(entry.debitAccountId) ?? 0;
      debitsByAccount.set(entry.debitAccountId, debitCurr + dAmt);
      const creditCurr = creditsByAccount.get(entry.creditAccountId) ?? 0;
      creditsByAccount.set(entry.creditAccountId, creditCurr + cAmt);
      totalDebitSum += dAmt;
      totalCreditSum += cAmt;
    } else if (entry.debitAccountId === entry.creditAccountId) {
      // Debiting and crediting identical account is not a genuine double-entry transfer
      const debitCurr = debitsByAccount.get(entry.debitAccountId) ?? 0;
      debitsByAccount.set(entry.debitAccountId, debitCurr + entry.amount);
      totalDebitSum += entry.amount;
    } else {
      const debitCurr = debitsByAccount.get(entry.debitAccountId) ?? 0;
      debitsByAccount.set(entry.debitAccountId, debitCurr + entry.amount);

      const creditCurr = creditsByAccount.get(entry.creditAccountId) ?? 0;
      creditsByAccount.set(entry.creditAccountId, creditCurr + entry.amount);

      totalDebitSum += entry.amount;
      totalCreditSum += entry.amount;
    }
  }

  const result = accounts.map((acc: any) => {
    const totalDebit = debitsByAccount.get(acc.id) ?? 0;
    const totalCredit = creditsByAccount.get(acc.id) ?? 0;
    const netBalance = acc.accountType === "asset" || acc.accountType === "expense"
      ? totalDebit - totalCredit
      : totalCredit - totalDebit;

    return {
      code: acc.code,
      name: acc.name,
      accountType: acc.accountType,
      totalDebit,
      totalCredit,
      netBalance,
    };
  });

  return {
    accounts: result,
    totalDebitSum,
    totalCreditSum,
    isBalanced: totalDebitSum === totalCreditSum,
    difference: Math.abs(totalDebitSum - totalCreditSum),
  };
}

const NUMERIC_METADATA_PATTERN = /^-?[0-9]+$/;

/**
 * Checks whether a jsonb metadata value is safe to cast to an integer.
 * Legacy or partially migrated rows may store non-numeric or missing values
 * for keys like orderId/driverId/walletId; casting those directly with
 * `::int` crashes the query with a Postgres error (500). Exported so the
 * guard regex can be unit-tested without a live database connection.
 */
export function isNumericMetadataValue(value: unknown): value is string {
  return typeof value === "string" && NUMERIC_METADATA_PATTERN.test(value);
}

/**
 * Builds a null-safe SQL filter comparing a jsonb metadata text field to an
 * integer value. Uses a CASE expression (guaranteed short-circuit in
 * PostgreSQL, unlike AND/OR) so rows with non-numeric or absent metadata
 * values never reach the `::int` cast and cannot crash the query.
 */
export function buildSafeMetadataIntFilter(metadataColumn: AnyPgColumn, key: string, value: number) {
  return sql`(CASE WHEN ${metadataColumn}->>${key} ~ '^-?[0-9]+$' THEN (${metadataColumn}->>${key})::int ELSE NULL END) = ${value}`;
}
