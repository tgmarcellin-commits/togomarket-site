import test from "node:test";
import assert from "node:assert/strict";
import {
  computeGameApplied,
  refundWithStore,
  spendWithStore,
  splitRefund,
  type GameSpendLedgerEntry,
  type SpendStore,
} from "./game-spend-core";

/* ───────── calcul de D et répartition du remboursement ───────── */

test("D = min(solde 10défis, réserve disponible, total)", () => {
  assert.equal(computeGameApplied({ enabled: true, total: 1250, gameBalance: 5000, reserveAvailable: 5000 }), 1250);
  assert.equal(computeGameApplied({ enabled: true, total: 1250, gameBalance: 300, reserveAvailable: 5000 }), 300);
  assert.equal(computeGameApplied({ enabled: true, total: 1250, gameBalance: 5000, reserveAvailable: 400 }), 400);
  assert.equal(computeGameApplied({ enabled: true, total: 1250, gameBalance: 0, reserveAvailable: 5000 }), 0);
  assert.equal(computeGameApplied({ enabled: true, total: 1250, gameBalance: 5000, reserveAvailable: 0 }), 0);
});

test("fonction désactivée ou valeurs invalides : aucun paiement en 10défis", () => {
  assert.equal(computeGameApplied({ enabled: false, total: 1250, gameBalance: 5000, reserveAvailable: 5000 }), 0);
  assert.equal(computeGameApplied({ enabled: true, total: 1250, gameBalance: Number.NaN, reserveAvailable: 5000 }), 0);
  assert.equal(computeGameApplied({ enabled: true, total: 1250, gameBalance: -50, reserveAvailable: 5000 }), 0);
});

test("remboursement : au prorata, la part 10défis ne dépasse jamais ce qui a été payé en 10défis", () => {
  assert.deepEqual(splitRefund(1000, 500, 1000), { game: 500, retirable: 500 });
  assert.deepEqual(splitRefund(600, 500, 1000), { game: 300, retirable: 300 });
  assert.deepEqual(splitRefund(0, 500, 1000), { game: 0, retirable: 0 });
  assert.deepEqual(splitRefund(800, 0, 1000), { game: 0, retirable: 800 }); // commande ancienne ou payée sans 10défis
  assert.deepEqual(splitRefund(999, 1000, 1000), { game: 999, retirable: 0 }); // tout en 10défis : rien de retirable
  for (let refund = 0; refund <= 1250; refund += 7) {
    const { game, retirable } = splitRefund(refund, 333, 1250);
    assert.equal(game + retirable, refund);
    assert.ok(game <= 333 && game >= 0 && retirable >= 0);
  }
});

/* ───────── magasin en mémoire qui imite la transaction SQL ───────── */

function createMemory(init: { reserve: number; buyers: Record<number, number>; ledgerPrefill?: Record<number, number> }) {
  const state = {
    reserve: init.reserve,
    buyers: new Map<number, number>(Object.entries(init.buyers).map(([k, v]) => [Number(k), v])),
    ledger: new Map<number, number>(), // somme des écritures par acheteur sur le compte 2060
    journals: [] as GameSpendLedgerEntry[],
    movements: [] as Array<{ type: string; orderId: number; amount: number }>,
    refs: new Set<string>(),
    locks: [] as string[],
  };
  for (const [id, balance] of state.buyers) state.ledger.set(id, init.ledgerPrefill?.[id] ?? balance);

  const store: SpendStore = {
    async lockReserve() { state.locks.push("reserve"); return state.reserve; },
    async lockBuyerBalance(id) { state.locks.push(`buyer:${id}`); return state.buyers.get(id) ?? 0; },
    async setReserve(b) { if (b < 0) throw new Error("réserve négative"); state.reserve = b; },
    async setBuyerBalance(id, b) { if (b < 0) throw new Error("solde négatif"); state.buyers.set(id, b); },
    async postLedger(entry) {
      if (state.refs.has(entry.journalReference)) return { duplicate: true };
      state.refs.add(entry.journalReference);
      state.journals.push(entry);
      for (const leg of entry.legs) {
        const id = Number(leg.metadata["buyerAccountId"]);
        if (leg.debitAccountCode === "BUYER_GAME_WALLET") state.ledger.set(id, (state.ledger.get(id) ?? 0) - leg.amountFcfa);
        if (leg.creditAccountCode === "BUYER_GAME_WALLET") state.ledger.set(id, (state.ledger.get(id) ?? 0) + leg.amountFcfa);
      }
      return { duplicate: false };
    },
    async gameLedgerBalance(id) { return state.ledger.get(id) ?? 0; },
    async insertMovement(row) {
      if (state.movements.some((m) => m.type === row.movementType && m.orderId === row.orderId)) return null;
      state.movements.push({ type: row.movementType, orderId: row.orderId, amount: row.amountFcfa });
      return { id: state.movements.length };
    },
  };

  /** Équivalent d'une transaction SQL : en cas d'erreur, tout revient à l'état d'avant. */
  async function transaction<T>(work: () => Promise<T>): Promise<T> {
    const snap = {
      reserve: state.reserve,
      buyers: new Map(state.buyers),
      ledger: new Map(state.ledger),
      journals: [...state.journals],
      movements: [...state.movements],
      refs: new Set(state.refs),
    };
    try {
      return await work();
    } catch (err) {
      state.reserve = snap.reserve;
      state.buyers = snap.buyers;
      state.ledger = snap.ledger;
      state.journals = snap.journals;
      state.movements = snap.movements;
      state.refs = snap.refs;
      throw err;
    }
  }
  return { store, state, transaction };
}

test("achat : le solde 10défis ET la réserve baissent ensemble, le ledger suit", async () => {
  const m = createMemory({ reserve: 2000, buyers: { 1: 800 } });
  const result = await m.transaction(() => spendWithStore(m.store, { orderId: 36, buyerAccountId: 1, amount: 500, total: 1250, reference: "trx_1" }));
  assert.deepEqual(result, { ok: true, buyerBalanceAfter: 300, reserveBalanceAfter: 1500, reserveBefore: 2000 });
  assert.equal(m.state.buyers.get(1), 300);
  assert.equal(m.state.reserve, 1500);
  assert.equal(m.state.ledger.get(1), 300);
  assert.equal(m.state.movements.length, 1);
  assert.deepEqual(m.state.locks, ["reserve", "buyer:1"]); // ordre des verrous : réserve puis acheteur
  // chaque écriture est équilibrée côté système : 2 jambes, mêmes montants
  assert.equal(m.state.journals[0]!.legs.length, 2);
  assert.ok(m.state.journals[0]!.legs.every((leg) => leg.amountFcfa === 500));
});

test("solde 10défis insuffisant ou réserve insuffisante : refus, rien n'est écrit", async () => {
  const lowBalance = createMemory({ reserve: 2000, buyers: { 1: 100 } });
  assert.deepEqual(
    await lowBalance.transaction(() => spendWithStore(lowBalance.store, { orderId: 1, buyerAccountId: 1, amount: 500, total: 1250, reference: "r" })),
    { ok: false, reason: "insufficient_balance" },
  );
  const lowReserve = createMemory({ reserve: 200, buyers: { 1: 800 } });
  assert.deepEqual(
    await lowReserve.transaction(() => spendWithStore(lowReserve.store, { orderId: 1, buyerAccountId: 1, amount: 500, total: 1250, reference: "r" })),
    { ok: false, reason: "insufficient_reserve" },
  );
  for (const m of [lowBalance, lowReserve]) {
    assert.equal(m.state.journals.length, 0);
    assert.equal(m.state.movements.length, 0);
  }
  assert.equal(lowBalance.state.reserve, 2000);
  assert.equal(lowReserve.state.buyers.get(1), 800);
});

test("double dépense : deux achats successifs sur un solde qui ne couvre qu'un seul", async () => {
  const m = createMemory({ reserve: 5000, buyers: { 1: 600 } });
  const first = await m.transaction(() => spendWithStore(m.store, { orderId: 10, buyerAccountId: 1, amount: 500, total: 1000, reference: "a" }));
  const second = await m.transaction(() => spendWithStore(m.store, { orderId: 11, buyerAccountId: 1, amount: 500, total: 1000, reference: "b" }));
  assert.equal(first.ok, true);
  assert.deepEqual(second, { ok: false, reason: "insufficient_balance" });
  assert.equal(m.state.buyers.get(1), 100);
  assert.equal(m.state.reserve, 4500);
});

test("rejouer le même achat ne débite pas deux fois", async () => {
  const m = createMemory({ reserve: 5000, buyers: { 1: 1000 } });
  await m.transaction(() => spendWithStore(m.store, { orderId: 20, buyerAccountId: 1, amount: 400, total: 1000, reference: "a" }));
  const replay = await m.transaction(() => spendWithStore(m.store, { orderId: 20, buyerAccountId: 1, amount: 400, total: 1000, reference: "a" }));
  assert.deepEqual(replay, { ok: false, reason: "already_recorded" });
  assert.equal(m.state.buyers.get(1), 600);
  assert.equal(m.state.reserve, 4600);
});

test("écart entre le solde et le ledger : tout est annulé", async () => {
  const m = createMemory({ reserve: 5000, buyers: { 1: 1000 }, ledgerPrefill: { 1: 999 } });
  await assert.rejects(
    () => m.transaction(() => spendWithStore(m.store, { orderId: 30, buyerAccountId: 1, amount: 400, total: 1000, reference: "a" })),
    /Écart solde 10défis/,
  );
  assert.equal(m.state.buyers.get(1), 1000);
  assert.equal(m.state.reserve, 5000);
  assert.equal(m.state.journals.length, 0);
});

test("montant invalide : jamais de débit", async () => {
  const m = createMemory({ reserve: 5000, buyers: { 1: 1000 } });
  for (const amount of [0, -5, 1.5, 2000]) {
    await assert.rejects(() => spendWithStore(m.store, { orderId: 1, buyerAccountId: 1, amount, total: 1000, reference: "x" }), /invalide/);
  }
  assert.equal(m.state.buyers.get(1), 1000);
});

test("remboursement : la part 10défis revient sur le solde 10défis et dans la réserve, jamais ailleurs", async () => {
  const m = createMemory({ reserve: 5000, buyers: { 1: 1000 } });
  await m.transaction(() => spendWithStore(m.store, { orderId: 40, buyerAccountId: 1, amount: 600, total: 1250, reference: "a" }));
  assert.equal(m.state.buyers.get(1), 400);
  assert.equal(m.state.reserve, 4400);

  // le journal de règlement de l'appelant crédite le compte 2060 de la part remboursée ; on le simule ici
  m.state.ledger.set(1, (m.state.ledger.get(1) ?? 0) + 250);
  const refund = await m.transaction(() => refundWithStore(m.store, { orderId: 40, buyerAccountId: 1, amount: 250 }));
  assert.deepEqual(refund, { ok: true, buyerBalanceAfter: 650, reserveBalanceAfter: 4650 });
  assert.equal(m.state.buyers.get(1), 650);
  assert.equal(m.state.reserve, 4650);
  assert.equal(m.state.movements.filter((x) => x.type === "refund").length, 1);
});

test("un remboursement ne peut être enregistré qu'une fois par commande", async () => {
  const m = createMemory({ reserve: 5000, buyers: { 1: 1000 } });
  await m.transaction(() => spendWithStore(m.store, { orderId: 50, buyerAccountId: 1, amount: 600, total: 1000, reference: "a" }));
  m.state.ledger.set(1, (m.state.ledger.get(1) ?? 0) + 600);
  await m.transaction(() => refundWithStore(m.store, { orderId: 50, buyerAccountId: 1, amount: 600 }));
  const again = await m.transaction(() => refundWithStore(m.store, { orderId: 50, buyerAccountId: 1, amount: 600 }));
  assert.deepEqual(again, { ok: false, reason: "already_recorded" });
  assert.equal(m.state.buyers.get(1), 1000);
  assert.equal(m.state.reserve, 5000);
});

test("achat puis remboursement complet : retour exact à l'état initial", async () => {
  const m = createMemory({ reserve: 3000, buyers: { 7: 900 } });
  await m.transaction(() => spendWithStore(m.store, { orderId: 60, buyerAccountId: 7, amount: 900, total: 900, reference: "a" }));
  m.state.ledger.set(7, (m.state.ledger.get(7) ?? 0) + 900);
  await m.transaction(() => refundWithStore(m.store, { orderId: 60, buyerAccountId: 7, amount: 900 }));
  assert.equal(m.state.buyers.get(7), 900);
  assert.equal(m.state.reserve, 3000);
});
