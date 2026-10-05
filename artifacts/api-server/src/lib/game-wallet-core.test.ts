import test from "node:test";
import assert from "node:assert/strict";
import type { CreditInput } from "./game-bridge-security";
import { MAX_BALANCE_FCFA, creditWithStore, type CreditStore, type MigrationRecord } from "./game-wallet-core";

/** Magasin en mémoire qui imite la transaction : un « snapshot » est restauré si le crédit lève une erreur. */
function createMemoryStore(options: { buyers?: Record<string, number>; corruptLedger?: boolean; duplicateJournal?: boolean } = {}) {
  const buyers = new Map<string, number>(Object.entries(options.buyers ?? { "22897000000": 1 }));
  const balances = new Map<number, number>([[1, 0], [2, 0]]);
  const migrations = new Map<string, MigrationRecord & { journalReference: string; balanceAfter: number }>();
  const ledger: Array<{ journalReference: string; buyerAccountId: number; amount: number }> = [];
  let nextId = 1;
  let claimRace = false; // simule « une autre requête a pris la clé juste avant nous »

  const store: CreditStore = {
    async readMigration(key) { return migrations.get(key) ?? null; },
    async findBuyerAccountId(phone) { return buyers.get(phone) ?? null; },
    async claimKey(row) {
      if (claimRace) {
        migrations.set(row.idempotencyKey, { id: nextId++, ...row, balanceAfter: 0 });
        claimRace = false;
        return null;
      }
      if (migrations.has(row.idempotencyKey)) return null;
      const id = nextId++;
      migrations.set(row.idempotencyKey, { id, ...row, balanceAfter: 0 });
      return { id };
    },
    async lockBalance(id) { return balances.get(id) ?? 0; },
    async setBalance(id, balance) { balances.set(id, balance); },
    async postLedger(params) {
      if (options.duplicateJournal) return { duplicate: true };
      ledger.push({ journalReference: params.journalReference, buyerAccountId: Number(params.metadata["buyerAccountId"]), amount: params.amountFcfa });
      return { duplicate: false };
    },
    async ledgerBalance(id) {
      const sum = ledger.filter((e) => e.buyerAccountId === id).reduce((total, e) => total + e.amount, 0);
      return options.corruptLedger ? sum + 1 : sum;
    },
    async setBalanceAfter(migrationId, balance) {
      for (const record of migrations.values()) if (record.id === migrationId) record.balanceAfter = balance;
    },
  };

  /** Équivalent d'une transaction SQL : en cas d'erreur, tout revient à l'état d'avant. */
  async function transaction<T>(work: () => Promise<T>): Promise<T> {
    const snapshot = {
      balances: new Map(balances),
      migrations: new Map([...migrations].map(([k, v]) => [k, { ...v }])),
      ledger: ledger.map((e) => ({ ...e })),
    };
    try {
      return await work();
    } catch (err) {
      balances.clear(); snapshot.balances.forEach((v, k) => balances.set(k, v));
      migrations.clear(); snapshot.migrations.forEach((v, k) => migrations.set(k, v));
      ledger.length = 0; ledger.push(...snapshot.ledger);
      throw err;
    }
  }

  return { store, balances, migrations, ledger, transaction, raceOnNextClaim() { claimRace = true; } };
}

const input: CreditInput = { idempotencyKey: "monthly-2026-09-buyer-1", phoneNumber: "+22897000000", amountFcfa: 500, period: "2026-09", reason: "weekly" };
const PHONE = "22897000000";

test("un crédit met à jour le solde, écrit le ledger et l'audit dans le même mouvement", async () => {
  const m = createMemoryStore();
  const result = await m.transaction(() => creditWithStore(m.store, input, PHONE));
  assert.deepEqual(result, { kind: "credited", newBalance: 500 });
  assert.equal(m.balances.get(1), 500);
  assert.equal(m.ledger.length, 1);
  assert.equal(m.ledger[0]!.amount, 500);
  assert.equal(m.migrations.get(input.idempotencyKey)!.balanceAfter, 500);
});

test("le solde reste égal à la somme du ledger après plusieurs crédits", async () => {
  const m = createMemoryStore();
  for (const [key, amount] of [["k-1-aaaaaaa", 500], ["k-2-aaaaaaa", 250], ["k-3-aaaaaaa", 1000]] as const) {
    const result = await m.transaction(() => creditWithStore(m.store, { ...input, idempotencyKey: key, amountFcfa: amount }, PHONE));
    assert.equal(result.kind, "credited");
  }
  assert.equal(m.balances.get(1), 1750);
  assert.equal(await m.store.ledgerBalance(1), 1750);
});

test("rejouer la même clé ne recrédite rien", async () => {
  const m = createMemoryStore();
  await m.transaction(() => creditWithStore(m.store, input, PHONE));
  const replay = await m.transaction(() => creditWithStore(m.store, input, PHONE));
  assert.deepEqual(replay, { kind: "already_processed" });
  assert.equal(m.balances.get(1), 500);
  assert.equal(m.ledger.length, 1);
});

test("même clé avec un autre montant ou un autre acheteur = conflit, rien n'est écrit", async () => {
  const m = createMemoryStore({ buyers: { "22897000000": 1, "22890000000": 2 } });
  await m.transaction(() => creditWithStore(m.store, input, PHONE));
  const otherAmount = await m.transaction(() => creditWithStore(m.store, { ...input, amountFcfa: 999 }, PHONE));
  const otherBuyer = await m.transaction(() => creditWithStore(m.store, { ...input, phoneNumber: "+22890000000" }, "22890000000"));
  assert.deepEqual(otherAmount, { kind: "idempotency_conflict" });
  assert.deepEqual(otherBuyer, { kind: "idempotency_conflict" });
  assert.equal(m.balances.get(1), 500);
  assert.equal(m.balances.get(2), 0);
  assert.equal(m.ledger.length, 1);
});

test("acheteur introuvable : 404 côté route, aucune écriture, la clé reste libre", async () => {
  const m = createMemoryStore();
  const result = await m.transaction(() => creditWithStore(m.store, { ...input, phoneNumber: "+22891111111" }, "22891111111"));
  assert.deepEqual(result, { kind: "buyer_not_found" });
  assert.equal(m.migrations.size, 0);
  assert.equal(m.ledger.length, 0);
  assert.equal(m.balances.get(1), 0);
});

test("course sur la clé : la requête qui perd la course ne crédite pas", async () => {
  const m = createMemoryStore();
  m.raceOnNextClaim();
  const result = await m.transaction(() => creditWithStore(m.store, input, PHONE));
  assert.deepEqual(result, { kind: "already_processed" });
  assert.equal(m.balances.get(1), 0);
  assert.equal(m.ledger.length, 0);
});

test("écart entre le solde et le ledger : tout est annulé (erreur levée)", async () => {
  const m = createMemoryStore({ corruptLedger: true });
  await assert.rejects(() => m.transaction(() => creditWithStore(m.store, input, PHONE)), /Écart solde 10défis/);
  assert.equal(m.balances.get(1), 0);
  assert.equal(m.migrations.size, 0);
  assert.equal(m.ledger.length, 0);
});

test("écriture de ledger déjà présente alors que la clé était libre : tout est annulé", async () => {
  const m = createMemoryStore({ duplicateJournal: true });
  await assert.rejects(() => m.transaction(() => creditWithStore(m.store, input, PHONE)), /déjà présente/);
  assert.equal(m.balances.get(1), 0);
  assert.equal(m.migrations.size, 0);
});

test("plafond du solde : le crédit est refusé et annulé", async () => {
  const m = createMemoryStore();
  m.balances.set(1, MAX_BALANCE_FCFA - 100);
  await assert.rejects(
    () => m.transaction(() => creditWithStore(m.store, input, PHONE)),
    (err: Error) => err.name === "CreditLimitError",
  );
  assert.equal(m.balances.get(1), MAX_BALANCE_FCFA - 100);
  assert.equal(m.migrations.size, 0);
});
