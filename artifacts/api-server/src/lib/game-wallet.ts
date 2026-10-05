import { eq, sql } from "drizzle-orm";
import {
  buyerAccountsTable,
  conversationsTable,
  db,
  gameWalletMigrationsTable,
  ledgerAccountsTable,
  phoneVerificationLogTable,
} from "@workspace/db";
import { postBalancedJournalEntry, STANDARD_ACCOUNTS, type DbOrTx } from "./accounting-ledger";
import { getOrCreateBuyerAccountId } from "./buyer-accounts";
import type { CreditInput } from "./game-bridge-security";
import { CreditLimitError, creditWithStore, type CreditResult, type CreditStore } from "./game-wallet-core";
import { normalizePhone, phoneEq } from "./phone";

/**
 * Solde « 10défis » : gains du mini-jeu reversés chaque mois sur un solde DISTINCT du portefeuille existant.
 *
 * Chaque crédit est une écriture du ledger comptable en partie double déjà en place :
 *   débit  6010 « Récompenses jeu » (compte système)
 *   crédit 2060 « Solde 10défis acheteurs », rattaché à l'acheteur par metadata.buyerAccountId
 * écrite DANS LA MÊME TRANSACTION que la mise à jour de buyer_accounts.solde_10defis_fcfa (simple cache), puis le
 * solde est vérifié égal à la somme des écritures du ledger de cet acheteur : au moindre écart, tout est annulé.
 */

/** Numéro canonique (chiffres, indicatif inclus) ou null s'il est illisible. */
export function canonicalPhone(raw: string): string | null {
  const normalized = normalizePhone(raw);
  return /^\d{8,15}$/.test(normalized) ? normalized : null;
}

/**
 * Acheteur ayant EXACTEMENT ce numéro (après normalisation, comme partout dans le dépôt).
 * Un acheteur est connu par son compte-numéro (buyer_accounts) ou par ses conversations : dans ce second cas, son
 * compte-numéro est créé à la volée (une seule ligne, sans solde). Ne renvoie que l'identifiant interne.
 */
async function findBuyerAccountId(tx: DbOrTx, phone: string): Promise<number | null> {
  const [account] = await tx
    .select({ id: buyerAccountsTable.id })
    .from(buyerAccountsTable)
    .where(eq(buyerAccountsTable.phone, phone))
    .limit(1);
  if (account) return account.id;

  const [conversation] = await tx
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(phoneEq(conversationsTable.buyerPhone, phone))
    .limit(1);
  if (!conversation) return null;
  return getOrCreateBuyerAccountId(phone, tx);
}

/** Vérifie l'existence d'un acheteur et journalise l'appel (numéro, résultat, date, adresse). */
export async function verifyBuyerPhone(rawPhone: string, sourceIp: string | null): Promise<number | null> {
  const phone = canonicalPhone(rawPhone);
  const buyerId = phone ? await db.transaction((tx) => findBuyerAccountId(tx, phone)) : null;
  await db.insert(phoneVerificationLogTable).values({
    phoneNumber: phone ?? rawPhone.trim().slice(0, 40),
    existsResult: buyerId !== null,
    sourceIp: sourceIp?.slice(0, 64) ?? null,
  });
  return buyerId;
}

export type { CreditResult } from "./game-wallet-core";

/** Somme des écritures du ledger rattachées à cet acheteur sur le compte 2060 (crédits moins débits). */
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
  const row = result.rows[0] as { total?: string | number } | undefined;
  return Number(row?.total ?? 0);
}

/** Branche le cœur du crédit sur UNE transaction SQL. */
function storeFor(tx: DbOrTx): CreditStore {
  return {
    async readMigration(idempotencyKey) {
      const [row] = await tx
        .select()
        .from(gameWalletMigrationsTable)
        .where(eq(gameWalletMigrationsTable.idempotencyKey, idempotencyKey))
        .limit(1);
      return row ?? null;
    },
    findBuyerAccountId: (phone) => findBuyerAccountId(tx, phone),
    async claimKey(row) {
      const [claimed] = await tx
        .insert(gameWalletMigrationsTable)
        .values({ ...row, status: "credited", balanceAfter: 0 }) // balanceAfter renseigné en fin de transaction
        .onConflictDoNothing()
        .returning({ id: gameWalletMigrationsTable.id });
      return claimed ?? null;
    },
    async lockBalance(buyerAccountId) {
      const [locked] = await tx
        .select({ balance: buyerAccountsTable.solde10defisFcfa })
        .from(buyerAccountsTable)
        .where(eq(buyerAccountsTable.id, buyerAccountId))
        .for("update")
        .limit(1);
      if (!locked) throw new Error("Compte acheteur introuvable après sélection");
      return locked.balance;
    },
    async setBalance(buyerAccountId, balance) {
      await tx.update(buyerAccountsTable).set({ solde10defisFcfa: balance }).where(eq(buyerAccountsTable.id, buyerAccountId));
    },
    async postLedger(params) {
      const posted = await postBalancedJournalEntry({
        journalReference: params.journalReference,
        legs: [{
          debitAccountCode: STANDARD_ACCOUNTS.GAME_REWARDS.code,
          creditAccountCode: STANDARD_ACCOUNTS.BUYER_GAME_WALLET.code,
          amount: params.amountFcfa,
          description: params.description,
          metadata: params.metadata,
        }],
        metadata: { source: "game_bridge" },
      }, tx);
      return { duplicate: posted.duplicate };
    },
    ledgerBalance: (buyerAccountId) => gameLedgerBalance(tx, buyerAccountId),
    async setBalanceAfter(migrationId, balance) {
      await tx.update(gameWalletMigrationsTable).set({ balanceAfter: balance }).where(eq(gameWalletMigrationsTable.id, migrationId));
    },
  };
}

export async function creditGameWallet(input: CreditInput): Promise<CreditResult> {
  const phone = canonicalPhone(input.phoneNumber);
  if (!phone) return { kind: "buyer_not_found" };
  try {
    return await db.transaction((tx) => creditWithStore(storeFor(tx), input, phone));
  } catch (err) {
    // Plafond atteint : la transaction a été annulée, ce n'est pas une panne
    if (err instanceof CreditLimitError) return { kind: "limit_reached" };
    throw err;
  }
}
