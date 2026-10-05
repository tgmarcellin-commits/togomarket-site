import type { CreditInput } from "./game-bridge-security";

/**
 * Cœur du crédit « solde 10défis », indépendant de la base de données : il ne parle qu'à un « magasin » (CreditStore).
 * game-wallet.ts branche ce magasin sur UNE transaction SQL ; les tests le branchent sur une mémoire.
 * Toute erreur levée ici annule la transaction entière : rien n'est écrit à moitié.
 */

export const MAX_BALANCE_FCFA = 2_000_000_000; // limite d'une colonne integer, avec marge

export type CreditResult =
  | { kind: "credited"; newBalance: number }
  | { kind: "already_processed" }
  | { kind: "buyer_not_found" }
  | { kind: "idempotency_conflict" }
  | { kind: "limit_reached" };

export type MigrationRecord = {
  id: number;
  phoneNumber: string;
  amountFcfa: number;
  period: string;
  reason: string;
};

export interface CreditStore {
  readMigration(idempotencyKey: string): Promise<MigrationRecord | null>;
  findBuyerAccountId(phone: string): Promise<number | null>;
  /** Réserve la clé d'idempotence ; null si une autre requête l'a déjà prise. */
  claimKey(row: {
    idempotencyKey: string;
    buyerAccountId: number;
    phoneNumber: string;
    amountFcfa: number;
    period: string;
    reason: string;
    journalReference: string;
  }): Promise<{ id: number } | null>;
  /** Solde actuel, avec verrou de ligne. */
  lockBalance(buyerAccountId: number): Promise<number>;
  setBalance(buyerAccountId: number, balance: number): Promise<void>;
  /** Écriture du ledger en partie double ; duplicate=true si la référence de journal existe déjà. */
  postLedger(params: {
    journalReference: string;
    amountFcfa: number;
    description: string;
    metadata: Record<string, unknown>;
  }): Promise<{ duplicate: boolean }>;
  /** Somme des écritures du ledger rattachées à cet acheteur sur le compte « solde 10défis ». */
  ledgerBalance(buyerAccountId: number): Promise<number>;
  setBalanceAfter(migrationId: number, balance: number): Promise<void>;
}

/** Même clé, mêmes paramètres = rejeu légitime ; même clé avec d'autres paramètres = erreur côté jeu. */
export function classifyReplay(record: MigrationRecord, input: CreditInput, phone: string): CreditResult {
  const same = record.amountFcfa === input.amountFcfa
    && record.period === input.period
    && record.reason === input.reason
    && record.phoneNumber === phone;
  return same ? { kind: "already_processed" } : { kind: "idempotency_conflict" };
}

export async function creditWithStore(store: CreditStore, input: CreditInput, phone: string): Promise<CreditResult> {
  // 1. Clé déjà traitée : rien n'est recrédité
  const replay = await store.readMigration(input.idempotencyKey);
  if (replay) return classifyReplay(replay, input, phone);

  // 2. Acheteur désigné par son numéro (introuvable : rien n'est écrit)
  const buyerId = await store.findBuyerAccountId(phone);
  if (buyerId === null) return { kind: "buyer_not_found" };

  // 3. Réservation de la clé : deux requêtes simultanées avec la même clé ne peuvent pas toutes deux créditer
  const journalReference = `GAME_${input.idempotencyKey}`;
  const claimed = await store.claimKey({
    idempotencyKey: input.idempotencyKey,
    buyerAccountId: buyerId,
    phoneNumber: phone,
    amountFcfa: input.amountFcfa,
    period: input.period,
    reason: input.reason,
    journalReference,
  });
  if (!claimed) {
    const winner = await store.readMigration(input.idempotencyKey);
    return winner ? classifyReplay(winner, input, phone) : { kind: "idempotency_conflict" };
  }

  // 4. Solde (cache)
  const previous = await store.lockBalance(buyerId);
  const newBalance = previous + input.amountFcfa;
  if (newBalance > MAX_BALANCE_FCFA) throw new CreditLimitError();
  await store.setBalance(buyerId, newBalance);

  // 5. Ledger : débit « Récompenses jeu », crédit « Solde 10défis » de cet acheteur
  const posted = await store.postLedger({
    journalReference,
    amountFcfa: input.amountFcfa,
    description: `Gain 10défis (${input.reason}, ${input.period})`,
    metadata: { buyerAccountId: buyerId, gameMigrationId: claimed.id, period: input.period, reason: input.reason },
  });
  if (posted.duplicate) throw new Error("Écriture du ledger déjà présente pour une clé d'idempotence libre");

  // 6. Invariant : solde = somme des écritures du ledger de cet acheteur
  const ledgerBalance = await store.ledgerBalance(buyerId);
  if (ledgerBalance !== newBalance) {
    throw new Error(`Écart solde 10défis (${newBalance}) / ledger (${ledgerBalance}) pour le compte ${buyerId}`);
  }

  await store.setBalanceAfter(claimed.id, newBalance);
  return { kind: "credited", newBalance };
}

/** Plafond du solde atteint : la transaction est annulée et la route répond 409. */
export class CreditLimitError extends Error {
  constructor() {
    super("Plafond du solde 10défis atteint");
    this.name = "CreditLimitError";
  }
}
