import test from "node:test";
import assert from "node:assert/strict";
import {
  isBridgeSecretConfigured,
  isValidBridgeSecret,
  maxCreditFcfa,
  parseCreditInput,
  parseVerifyInput,
} from "./game-bridge-security";

const SECRET = "0123456789abcdef0123456789abcdef";

test("secret : accepté seulement s'il est identique et que le secret attendu est assez long", () => {
  assert.equal(isValidBridgeSecret(SECRET, SECRET), true);
  assert.equal(isValidBridgeSecret("autre-secret-0123456789abcdef0123", SECRET), false);
  assert.equal(isValidBridgeSecret("", SECRET), false);
  assert.equal(isValidBridgeSecret(undefined, SECRET), false);
  assert.equal(isValidBridgeSecret(["a", "b"], SECRET), false);
  assert.equal(isValidBridgeSecret(SECRET, undefined), false);
  assert.equal(isValidBridgeSecret("court", "court"), false); // secret attendu trop court : routes fermées
  assert.equal(isBridgeSecretConfigured("court"), false);
  assert.equal(isBridgeSecretConfigured(SECRET), true);
});

test("verify-phone : seul un numéro textuel plausible est accepté", () => {
  assert.deepEqual(parseVerifyInput({ phoneNumber: " +228 97 00 00 00 " }), { ok: true, value: { phoneNumber: "+228 97 00 00 00" } });
  for (const bad of [null, "x", [], {}, { phoneNumber: 22897000000 }, { phoneNumber: "abc" }, { phoneNumber: "1" }, { phoneNumber: "9".repeat(40) }]) {
    assert.equal(parseVerifyInput(bad).ok, false, JSON.stringify(bad));
  }
});

const valid = { idempotencyKey: "weekly-2026-W40-buyer-1", phoneNumber: "+22897000000", amountFcfa: 500, period: "2026-09", reason: "weekly" };

test("crédit : une requête complète est acceptée", () => {
  const parsed = parseCreditInput(valid);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.value, valid);
  assert.equal(parseCreditInput({ ...valid, reason: "podium", amountFcfa: 1 }).ok, true);
  // le jeu verse chaque mois le solde accumulé : motif « monthly »
  assert.equal(parseCreditInput({ ...valid, reason: "monthly" }).ok, true);
});

test("crédit : le montant doit être un entier strictement positif (nombre, pas texte)", () => {
  for (const amountFcfa of [0, -5, 1.5, "500", null, undefined, Number.NaN, Infinity, maxCreditFcfa() + 1]) {
    assert.equal(parseCreditInput({ ...valid, amountFcfa }).ok, false, String(amountFcfa));
  }
  assert.equal(parseCreditInput({ ...valid, amountFcfa: maxCreditFcfa() }).ok, true);
});

test("crédit : clé d'idempotence, période et motif sont contrôlés", () => {
  assert.equal(parseCreditInput({ ...valid, idempotencyKey: "court" }).ok, false);
  assert.equal(parseCreditInput({ ...valid, idempotencyKey: "avec des espaces dedans" }).ok, false);
  assert.equal(parseCreditInput({ ...valid, idempotencyKey: "k".repeat(201) }).ok, false);
  assert.equal(parseCreditInput({ ...valid, idempotencyKey: undefined }).ok, false);
  assert.equal(parseCreditInput({ ...valid, period: "" }).ok, false);
  assert.equal(parseCreditInput({ ...valid, period: "2026/09; DROP" }).ok, false);
  assert.equal(parseCreditInput({ ...valid, reason: "yearly" }).ok, false);
  assert.equal(parseCreditInput({ ...valid, phoneNumber: "abc" }).ok, false);
  assert.equal(parseCreditInput(null).ok, false);
  assert.equal(parseCreditInput("texte").ok, false);
});

test("le plafond d'un crédit se règle par variable d'environnement", () => {
  const previous = process.env.GAME_BRIDGE_MAX_CREDIT_FCFA;
  try {
    process.env.GAME_BRIDGE_MAX_CREDIT_FCFA = "2000";
    assert.equal(maxCreditFcfa(), 2000);
    assert.equal(parseCreditInput({ ...valid, amountFcfa: 2001 }).ok, false);
    process.env.GAME_BRIDGE_MAX_CREDIT_FCFA = "n'importe quoi";
    assert.equal(maxCreditFcfa(), 1_000_000);
  } finally {
    if (previous === undefined) delete process.env.GAME_BRIDGE_MAX_CREDIT_FCFA;
    else process.env.GAME_BRIDGE_MAX_CREDIT_FCFA = previous;
  }
});
