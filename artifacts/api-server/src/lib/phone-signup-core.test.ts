import test from "node:test";
import assert from "node:assert/strict";
import {
  CODE_TTL_MS,
  MAX_CODE_ATTEMPTS,
  MAX_SENDS_PER_WINDOW,
  SEND_WINDOW_MS,
  createRateLimiter,
  evaluateChallenge,
  firstNameOf,
  maskPhone,
  parseName,
  parseSendInput,
  parseVerifyInput,
  planSend,
  type Challenge,
} from "./phone-signup-core";

const NOW = new Date("2026-10-05T12:00:00Z");
const challenge = (over: Partial<Challenge> = {}): Challenge => ({
  codeHash: "hash",
  expiresAt: new Date(NOW.getTime() + CODE_TTL_MS),
  attempts: 0,
  sendCount: 1,
  sendWindowStartedAt: new Date(NOW.getTime() - 60_000),
  ...over,
});

test("nom : 2 à 60 caractères, lettres, espaces, apostrophe, point, tiret", () => {
  assert.equal(parseName("  Amavi   Koffi "), "Amavi Koffi");
  assert.equal(parseName("Jean-Pierre N'Dour"), "Jean-Pierre N'Dour");
  assert.equal(parseName("Édem Ayité"), "Édem Ayité");
  for (const bad of ["", "A", " ", "12345", "<script>", "Nom; DROP TABLE", "x".repeat(61), null, 42, undefined]) {
    assert.equal(parseName(bad), null, String(bad));
  }
  assert.equal(firstNameOf("Amavi Koffi"), "Amavi");
});

test("envoi du code : nom et numéro plausibles obligatoires", () => {
  assert.deepEqual(parseSendInput({ phoneNumber: " +228 97 00 00 00 ", name: "Amavi" }), { ok: true, value: { phoneNumber: "+228 97 00 00 00", name: "Amavi" } });
  for (const bad of [null, "x", {}, { phoneNumber: "+22897000000" }, { name: "Amavi" }, { phoneNumber: "abc", name: "Amavi" }, { phoneNumber: "+22897000000", name: "" }]) {
    assert.equal(parseSendInput(bad).ok, false, JSON.stringify(bad));
  }
});

test("vérification : le code doit comporter exactement 6 chiffres", () => {
  const base = { phoneNumber: "+22897000000", name: "Amavi" };
  assert.deepEqual(parseVerifyInput({ ...base, code: "123 456" }), { ok: true, value: { ...base, code: "123456" } });
  for (const code of ["12345", "1234567", "abcdef", "", undefined, null]) assert.equal(parseVerifyInput({ ...base, code }).ok, false, String(code));
});

test("envoi : 3 codes par heure et par numéro, la fenêtre se renouvelle ensuite", () => {
  let state: Challenge | null = null;
  for (let i = 1; i <= MAX_SENDS_PER_WINDOW; i++) {
    const plan = planSend(state, NOW);
    assert.equal(plan.allowed, true);
    if (plan.allowed) state = challenge({ sendCount: plan.sendCount, sendWindowStartedAt: plan.windowStartedAt });
  }
  assert.equal(planSend(state, new Date(NOW.getTime() + 60_000)).allowed, false);
  const later = planSend(state, new Date(NOW.getTime() + SEND_WINDOW_MS + 1));
  assert.equal(later.allowed, true);
  if (later.allowed) assert.equal(later.sendCount, 1);
});

test("code : absent, expiré ou trop essayé n'est jamais comparé", () => {
  assert.equal(evaluateChallenge(null, NOW), "no_code");
  assert.equal(evaluateChallenge(challenge({ codeHash: null }), NOW), "no_code");
  assert.equal(evaluateChallenge(challenge({ expiresAt: new Date(NOW.getTime() - 1) }), NOW), "expired");
  assert.equal(evaluateChallenge(challenge({ attempts: MAX_CODE_ATTEMPTS }), NOW), "too_many_attempts");
  assert.equal(evaluateChallenge(challenge({ attempts: MAX_CODE_ATTEMPTS - 1 }), NOW), "ready");
});

test("limiteur par adresse : bloque au-delà du maximum puis se libère", () => {
  const limiter = createRateLimiter({ max: 3, windowMs: 1000 });
  assert.deepEqual([1, 2, 3, 4].map(() => limiter.hit("1.2.3.4", 0)), [false, false, false, true]);
  assert.equal(limiter.hit("5.6.7.8", 0), false);
  assert.equal(limiter.hit("1.2.3.4", 1001), false);
});

test("le numéro est masqué sauf ses 3 derniers chiffres", () => {
  assert.equal(maskPhone("22897000123"), "••••• 123");
  assert.equal(maskPhone("12"), "•••");
});
