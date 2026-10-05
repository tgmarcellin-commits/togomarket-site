import test from "node:test";
import assert from "node:assert/strict";
import { CURRENT_GAME_RULES_VERSION, parseAcceptRulesInput } from "./game-rules";

const PROOF = "v1.eyJwIjoiMjI4OTcwMDAwMDAiLCJlIjoxODAwMDAwMDAwMDAwfQ.c2lnbmF0dXJlLWRlLXRlc3Q";
const valid = { accepted: true, rulesVersion: CURRENT_GAME_RULES_VERSION, phoneNumber: "+22897000000", proof: PROOF };

test("acceptation valide : booléen true, bonne version, numéro plausible, preuve présente", () => {
  assert.deepEqual(parseAcceptRulesInput(valid), { ok: true, value: { phoneNumber: "+22897000000", proof: PROOF } });
  assert.deepEqual(parseAcceptRulesInput({ ...valid, phoneNumber: " +228 97 00 00 00 " }), { ok: true, value: { phoneNumber: "+228 97 00 00 00", proof: PROOF } });
});

test("sans acceptation explicite (true), la redirection est refusée côté serveur", () => {
  for (const accepted of [false, "true", 1, "on", null, undefined]) {
    assert.deepEqual(parseAcceptRulesInput({ ...valid, accepted }), { ok: false, reason: "not_accepted" }, String(accepted));
  }
  const { accepted: _removed, ...withoutAccepted } = valid;
  assert.deepEqual(parseAcceptRulesInput(withoutAccepted), { ok: false, reason: "not_accepted" });
});

test("ancienne version du règlement : refus avec motif dédié", () => {
  assert.deepEqual(parseAcceptRulesInput({ ...valid, rulesVersion: "2025-01" }), { ok: false, reason: "outdated_version" });
});

test("numéro absent ou invalide : requête refusée", () => {
  for (const phoneNumber of [undefined, "", "abc", "12", 22897000000, "9".repeat(40)]) {
    assert.deepEqual(parseAcceptRulesInput({ ...valid, phoneNumber }), { ok: false, reason: "invalid" }, String(phoneNumber));
  }
  assert.deepEqual(parseAcceptRulesInput({ ...valid, rulesVersion: 2026 }), { ok: false, reason: "invalid" });
  assert.deepEqual(parseAcceptRulesInput(null), { ok: false, reason: "invalid" });
  assert.deepEqual(parseAcceptRulesInput("texte"), { ok: false, reason: "invalid" });
});

test("sans preuve de vérification du numéro, la redirection est refusée (motif dédié)", () => {
  for (const proof of [undefined, null, "", "court", 42, "x".repeat(401)]) {
    assert.deepEqual(parseAcceptRulesInput({ ...valid, proof }), { ok: false, reason: "phone_not_verified" }, String(proof));
  }
  const { proof: _removed, ...withoutProof } = valid;
  assert.deepEqual(parseAcceptRulesInput(withoutProof), { ok: false, reason: "phone_not_verified" });
});
