import test from "node:test";
import assert from "node:assert/strict";
import { PROOF_TTL_MS, isProofSecretUsable, signPhoneProof, verifyPhoneProof } from "./phone-proof";

const SECRET = "0123456789abcdef0123456789abcdef";
const PHONE = "22897000000";
const NOW = 1_800_000_000_000;

test("preuve : signée puis relue avec le même secret", () => {
  const token = signPhoneProof(PHONE, SECRET, NOW);
  assert.ok(token);
  assert.deepEqual(verifyPhoneProof(token, SECRET, NOW + 1000), { phone: PHONE, expiresAt: NOW + PROOF_TTL_MS });
});

test("preuve : un autre secret, un jeton modifié ou tronqué sont refusés", () => {
  const token = signPhoneProof(PHONE, SECRET, NOW)!;
  assert.equal(verifyPhoneProof(token, "un-autre-secret-0123456789abcdef", NOW), null);
  const [version, payload, signature] = token.split(".") as [string, string, string];
  // même signature, numéro modifié
  const forged = Buffer.from(JSON.stringify({ p: "22890000000", e: NOW + PROOF_TTL_MS }), "utf8").toString("base64url");
  assert.equal(verifyPhoneProof(`${version}.${forged}.${signature}`, SECRET, NOW), null);
  assert.equal(verifyPhoneProof(`${version}.${payload}.${signature.slice(0, -2)}`, SECRET, NOW), null);
  assert.equal(verifyPhoneProof(`${version}.${payload}`, SECRET, NOW), null);
  assert.equal(verifyPhoneProof(`v2.${payload}.${signature}`, SECRET, NOW), null);
});

test("preuve : expirée après 90 jours", () => {
  const token = signPhoneProof(PHONE, SECRET, NOW)!;
  assert.ok(verifyPhoneProof(token, SECRET, NOW + PROOF_TTL_MS - 1));
  assert.equal(verifyPhoneProof(token, SECRET, NOW + PROOF_TTL_MS), null);
});

test("preuve : entrées invalides et secret absent ou trop court", () => {
  for (const bad of [undefined, null, "", 42, {}, [], "a.b", "x".repeat(500)]) assert.equal(verifyPhoneProof(bad, SECRET, NOW), null);
  assert.equal(signPhoneProof(PHONE, undefined, NOW), null);
  assert.equal(signPhoneProof(PHONE, "court", NOW), null);
  assert.equal(signPhoneProof("abc", SECRET, NOW), null);
  assert.equal(verifyPhoneProof(signPhoneProof(PHONE, SECRET, NOW), undefined, NOW), null);
  assert.equal(isProofSecretUsable("court"), false);
  assert.equal(isProofSecretUsable(SECRET), true);
});
