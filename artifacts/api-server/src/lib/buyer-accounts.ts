import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  appMigrationsTable,
  buyerAccountsTable,
  conversationsTable,
  db,
  deliveryAuditLogsTable,
  deliveryWithdrawalTicketsTable,
  virtualWalletsTable,
  walletLedgerTable,
} from "@workspace/db";
import type { DbOrTx } from "./accounting-ledger";
import { getVerifiedBuyerPhone } from "./buyer-phone";
import { logger } from "./logger";
import { normalizePhone } from "./phone";
import { getOrCreateVirtualWallet } from "./wallet-service";

/**
 * Un portefeuille unique par numéro de téléphone acheteur.
 * owner_id du portefeuille « buyer » = identifiant du compte (buyer_accounts), plus l'identifiant de conversation.
 */

const MIGRATION_NAME = "buyer_wallets_by_phone_v1";

/**
 * Interrupteur du « portefeuille unique par numéro de téléphone ».
 *  - absent / autre valeur : mode ACTUEL, un portefeuille acheteur par conversation (comportement d'origine,
 *    aucune vérification de numéro, aucune migration) ;
 *  - BUYER_WALLET_BY_PHONE=true : un seul portefeuille par numéro, après vérification du numéro par code WhatsApp,
 *    et regroupement automatique des anciens soldes au prochain démarrage.
 * Le règlement, le paiement de la course et les routes du portefeuille lisent TOUS ce même interrupteur : ils sont
 * donc toujours cohérents entre eux. Ne repassez pas à « false » après l'avoir activé.
 */
export function isBuyerWalletByPhoneEnabled(): boolean {
  return process.env.BUYER_WALLET_BY_PHONE === "true";
}
const MIGRATION_LOCK_KEY = 7_104_220_061; // verrou consultatif PostgreSQL propre à cette migration

/** Numéro utilisable comme identité de compte, ou null s'il est vide / trop court. */
function usablePhone(raw: string | null | undefined): string | null {
  const phone = normalizePhone(raw ?? "");
  return phone && phone.length >= 8 ? phone : null;
}

/** Crée les tables si le script SQL n'a pas (encore) été exécuté : évite un démarrage cassé. */
export async function ensureBuyerAccountTables(): Promise<void> {
  await db.execute(sql`
    create table if not exists buyer_accounts (
      id serial primary key,
      phone text not null unique,
      solde_10defis_fcfa integer not null default 0,
      created_at timestamptz not null default now()
    )`);
  await db.execute(sql`alter table buyer_accounts add column if not exists solde_10defis_fcfa integer not null default 0`);
  await db.execute(sql`
    create table if not exists app_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`);
}

export async function getOrCreateBuyerAccountId(phone: string, tx: DbOrTx = db): Promise<number> {
  const [existing] = await tx
    .select({ id: buyerAccountsTable.id })
    .from(buyerAccountsTable)
    .where(eq(buyerAccountsTable.phone, phone))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await tx
    .insert(buyerAccountsTable)
    .values({ phone })
    .onConflictDoNothing()
    .returning({ id: buyerAccountsTable.id });
  if (created) return created.id;
  const [refetched] = await tx
    .select({ id: buyerAccountsTable.id })
    .from(buyerAccountsTable)
    .where(eq(buyerAccountsTable.phone, phone))
    .limit(1);
  if (!refetched) throw new Error("Compte acheteur introuvable après création");
  return refetched.id;
}

/**
 * Compte acheteur d'une conversation : celui du numéro saisi par l'acheteur. Sans numéro exploitable,
 * le compte est propre à la conversation (jamais partagé avec un autre numéro).
 */
export async function resolveConversationBuyerAccount(
  conversationId: number,
  tx: DbOrTx = db,
): Promise<{ accountId: number; phone: string } | null> {
  const [conversation] = await tx
    .select({ buyerPhone: conversationsTable.buyerPhone })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))
    .limit(1);
  if (!conversation) return null;
  const phone = usablePhone(conversation.buyerPhone) ?? `conv-${conversationId}`;
  return { accountId: await getOrCreateBuyerAccountId(phone, tx), phone };
}

/**
 * Identifiant propriétaire (owner_id) du portefeuille acheteur d'une conversation :
 * l'identifiant de la conversation (mode actuel) ou celui du compte-numéro (portefeuille unique par numéro).
 */
export async function resolveBuyerWalletOwnerId(conversationId: number, tx: DbOrTx = db): Promise<number | null> {
  if (!isBuyerWalletByPhoneEnabled()) return conversationId;
  return (await resolveConversationBuyerAccount(conversationId, tx))?.accountId ?? null;
}

export type BuyerAccountView = {
  /** owner_id du portefeuille : identifiant de la conversation (mode actuel) ou du compte-numéro. */
  accountId: number;
  phone: string;
  /** Le numéro de cette conversation a-t-il été prouvé par code WhatsApp ? Condition pour voir, dépenser et retirer. */
  verified: boolean;
  walletId: number;
  /** Solde disponible. */
  balance: number;
  lockedBalance: number;
  pendingPayoutBalance: number;
  paidOutBalance: number;
};

/** Portefeuille unique du numéro de la conversation, avec l'état de vérification du numéro. */
export async function getBuyerAccountView(conversationId: number, tx: DbOrTx = db): Promise<BuyerAccountView | null> {
  if (!isBuyerWalletByPhoneEnabled()) {
    // Mode actuel : portefeuille propre à la conversation, protégé par le jeton de la conversation
    const wallet = await getOrCreateVirtualWallet("buyer", conversationId, tx);
    return {
      accountId: conversationId,
      phone: "",
      verified: true,
      walletId: wallet.id,
      balance: Math.max(0, wallet.balance),
      lockedBalance: wallet.lockedBalance,
      pendingPayoutBalance: wallet.pendingPayoutBalance,
      paidOutBalance: wallet.paidOutBalance,
    };
  }
  const account = await resolveConversationBuyerAccount(conversationId, tx);
  if (!account) return null;
  const wallet = await getOrCreateVirtualWallet("buyer", account.accountId, tx);
  const verifiedPhone = await getVerifiedBuyerPhone(conversationId, tx);
  return {
    accountId: account.accountId,
    phone: account.phone,
    verified: verifiedPhone !== null && verifiedPhone === account.phone,
    walletId: wallet.id,
    balance: Math.max(0, wallet.balance),
    lockedBalance: wallet.lockedBalance,
    pendingPayoutBalance: wallet.pendingPayoutBalance,
    paidOutBalance: wallet.paidOutBalance,
  };
}

export type BuyerWalletMigrationResult = { migrated: boolean; wallets: number; accounts: number; merged: number };

/**
 * Regroupe, une seule fois, les anciens portefeuilles acheteur (un par conversation) en un portefeuille par numéro.
 * - même numéro => soldes (disponible, bloqué, en attente, déjà versé) additionnés dans UN portefeuille ;
 * - l'historique (wallet_ledger) et les tickets de retrait sont rattachés au portefeuille conservé ;
 * - conversation sans numéro exploitable => son propre compte (rien n'est perdu, rien n'est mélangé).
 * Idempotent : un marqueur dans app_migrations empêche toute seconde exécution.
 */
export async function migrateLegacyBuyerWallets(): Promise<BuyerWalletMigrationResult> {
  await ensureBuyerAccountTables();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`);

    const [done] = await tx
      .select({ name: appMigrationsTable.name })
      .from(appMigrationsTable)
      .where(eq(appMigrationsTable.name, MIGRATION_NAME))
      .limit(1);
    if (done) return { migrated: false, wallets: 0, accounts: 0, merged: 0 };

    const legacy = await tx
      .select()
      .from(virtualWalletsTable)
      .where(eq(virtualWalletsTable.ownerType, "buyer"))
      .orderBy(asc(virtualWalletsTable.id))
      .for("update");

    let accounts = 0;
    let merged = 0;
    const now = new Date();

    if (legacy.length > 0) {
      // 1. Libère l'espace des identifiants : (buyer, id de conversation) ne doit jamais heurter (buyer, id de compte)
      await tx
        .update(virtualWalletsTable)
        .set({ ownerId: sql`-${virtualWalletsTable.id}` })
        .where(eq(virtualWalletsTable.ownerType, "buyer"));

      // 2. Regroupe par numéro normalisé
      const conversationIds = legacy.map((wallet) => wallet.ownerId);
      const conversations = await tx
        .select({ id: conversationsTable.id, buyerPhone: conversationsTable.buyerPhone })
        .from(conversationsTable)
        .where(inArray(conversationsTable.id, conversationIds));
      const phoneByConversation = new Map(conversations.map((conversation) => [conversation.id, usablePhone(conversation.buyerPhone)]));

      const groups = new Map<string, typeof legacy>();
      for (const wallet of legacy) {
        const phone = phoneByConversation.get(wallet.ownerId);
        const key = phone ?? (phoneByConversation.has(wallet.ownerId) ? `conv-${wallet.ownerId}` : `orphan-wallet-${wallet.id}`);
        const group = groups.get(key) ?? [];
        group.push(wallet);
        groups.set(key, group);
      }

      // 3. Un portefeuille par compte
      for (const [phone, wallets] of groups) {
        const accountId = await getOrCreateBuyerAccountId(phone, tx);
        accounts++;

        // Un portefeuille « neuf » a pu être créé pour ce compte avant la migration (démarrage concurrent)
        const [existingNew] = await tx
          .select()
          .from(virtualWalletsTable)
          .where(and(eq(virtualWalletsTable.ownerType, "buyer"), eq(virtualWalletsTable.ownerId, accountId)))
          .for("update")
          .limit(1);
        const target = existingNew ?? wallets[0]!;
        const toMerge = existingNew ? wallets : wallets.slice(1);

        const all = existingNew ? [existingNew, ...wallets] : wallets;
        const totals = all.reduce(
          (sum, wallet) => ({
            balance: sum.balance + wallet.balance,
            locked: sum.locked + wallet.lockedBalance,
            pending: sum.pending + wallet.pendingPayoutBalance,
            paidOut: sum.paidOut + wallet.paidOutBalance,
          }),
          { balance: 0, locked: 0, pending: 0, paidOut: 0 },
        );

        await tx
          .update(virtualWalletsTable)
          .set({
            ownerId: accountId,
            balance: totals.balance,
            lockedBalance: totals.locked,
            pendingPayoutBalance: totals.pending,
            paidOutBalance: totals.paidOut,
            updatedAt: now,
          })
          .where(eq(virtualWalletsTable.id, target.id));

        for (const other of toMerge) {
          if (other.id === target.id) continue;
          await tx.update(walletLedgerTable).set({ walletId: target.id }).where(eq(walletLedgerTable.walletId, other.id));
          await tx
            .update(deliveryWithdrawalTicketsTable)
            .set({ walletId: target.id })
            .where(eq(deliveryWithdrawalTicketsTable.walletId, other.id));
          await tx.delete(virtualWalletsTable).where(eq(virtualWalletsTable.id, other.id));
          merged++;
        }

        // Les tickets de retrait portaient l'ancien identifiant de conversation
        await tx
          .update(deliveryWithdrawalTicketsTable)
          .set({ ownerId: accountId })
          .where(and(
            eq(deliveryWithdrawalTicketsTable.ownerType, "buyer"),
            eq(deliveryWithdrawalTicketsTable.walletId, target.id),
          ));

        await tx.insert(deliveryAuditLogsTable).values({
          actorType: "system",
          actorId: "buyer_wallets_by_phone_v1",
          action: "buyer_wallets_merged_by_phone",
          metadata: {
            accountId,
            keptWalletId: target.id,
            mergedWalletIds: toMerge.map((wallet) => wallet.id),
            legacyConversationIds: wallets.map((wallet) => wallet.ownerId),
            totals,
          },
        });
      }
    }

    await tx.insert(appMigrationsTable).values({ name: MIGRATION_NAME });
    return { migrated: true, wallets: legacy.length, accounts, merged };
  });
}

/** Lancée au démarrage du serveur : une erreur est journalisée mais ne l'empêche jamais de démarrer. */
export async function runBuyerWalletMigrationOnStartup(): Promise<void> {
  if (!isBuyerWalletByPhoneEnabled()) return; // mode actuel : rien à migrer
  try {
    const result = await migrateLegacyBuyerWallets();
    if (result.migrated) {
      logger.info(result, "Portefeuilles acheteur regroupés par numéro de téléphone");
    }
  } catch (err) {
    logger.error({ err }, "Regroupement des portefeuilles acheteur par numéro impossible (sera retenté au prochain démarrage)");
  }
}
