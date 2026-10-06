import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TOPUP_FCFA,
  MIN_TOPUP_FCFA,
  isTopupTarget,
  parseTopupInput,
  targetFromJournalReference,
  treasuryJournalReference,
} from "./marketplace-topup-core";

test("alimentation : montant entier et destination obligatoires", () => {
  assert.deepEqual(parseTopupInput({ amountFcfa: 10_000, target: "reserve" }), { ok: true, value: { amountFcfa: 10_000, target: "reserve" } });
  assert.deepEqual(parseTopupInput({ amountFcfa: MIN_TOPUP_FCFA, target: "treasury" }), { ok: true, value: { amountFcfa: MIN_TOPUP_FCFA, target: "treasury" } });
  assert.equal(parseTopupInput({ amountFcfa: MAX_TOPUP_FCFA, target: "treasury" }).ok, true);
});

test("alimentation : montant hors limites, décimal ou en texte refusé", () => {
  for (const amountFcfa of [0, -1, 499, MAX_TOPUP_FCFA + 1, 1500.5, "5000", null, undefined, Number.NaN, Infinity]) {
    assert.equal(parseTopupInput({ amountFcfa, target: "reserve" }).ok, false, String(amountFcfa));
  }
});

test("alimentation : destination inconnue et corps invalides refusés", () => {
  for (const target of ["", "autre", "RESERVE", null, undefined, 1]) {
    assert.equal(parseTopupInput({ amountFcfa: 5000, target }).ok, false, String(target));
  }
  for (const body of [null, "x", [], 42, undefined]) assert.equal(parseTopupInput(body).ok, false);
  assert.equal(isTopupTarget("reserve"), true);
  assert.equal(isTopupTarget("treasury"), true);
  assert.equal(isTopupTarget("wallet"), false);
});

test("référence comptable unique par transaction, et retrouvée dans le grand livre", () => {
  assert.equal(treasuryJournalReference("113500001"), "MARKETPLACE_TOPUP_113500001");
  assert.deepEqual(targetFromJournalReference("MARKETPLACE_TOPUP_113500001"), { target: "treasury", transactionId: "113500001" });
  assert.deepEqual(targetFromJournalReference("GAME_RESERVE_TOPUP_113500002"), { target: "reserve", transactionId: "113500002" });
  assert.equal(targetFromJournalReference("JRN_DELV_37"), null);
  assert.equal(targetFromJournalReference("GAME_test-plafond-0001"), null);
});
