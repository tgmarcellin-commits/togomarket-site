import test from "node:test";
import assert from "node:assert/strict";
import { LAUNCH_TTL_MS, newLaunchId, parseLaunchTokenInput, signLaunchToken, verifyLaunchToken } from "./game-launch-token";
import { signPhoneProof } from "./phone-proof";

const SECRET = "0123456789abcdef0123456789abcdef";
const PHONE = "22897000000";
const NOW = 1_800_000_000_000;

test("jeton : signé puis relu, avec le numéro, l'identifiant unique et l'expiration à 10 minutes", () => {
  const jti = newLaunchId();
  const token = signLaunchToken({ phone: PHONE, jti, nowMs: NOW }, SECRET);
  assert.ok(token);
  assert.deepEqual(verifyLaunchToken(token, SECRET, NOW + 1000), { phone: PHONE, jti, expiresAt: NOW + LAUNCH_TTL_MS });
  assert.equal(LAUNCH_TTL_MS, 600_000);
});

test("jeton : expiré au bout de 10 minutes", () => {
  const token = signLaunchToken({ phone: PHONE, jti: newLaunchId(), nowMs: NOW }, SECRET)!;
  assert.ok(verifyLaunchToken(token, SECRET, NOW + LAUNCH_TTL_MS - 1));
  assert.equal(verifyLaunchToken(token, SECRET, NOW + LAUNCH_TTL_MS), null);
});

test("jeton : autre secret, contenu modifié ou format invalide sont refusés", () => {
  const jti = newLaunchId();
  const token = signLaunchToken({ phone: PHONE, jti, nowMs: NOW }, SECRET)!;
  assert.equal(verifyLaunchToken(token, "un-autre-secret-0123456789abcdef", NOW), null);
  const [version, , signature] = token.split(".") as [string, string, string];
  const forged = Buffer.from(JSON.stringify({ p: "22890000000", j: jti, e: NOW + LAUNCH_TTL_MS }), "utf8").toString("base64url");
  assert.equal(verifyLaunchToken(`${version}.${forged}.${signature}`, SECRET, NOW), null);
  for (const bad of [undefined, null, "", 42, {}, [], "a.b", "x".repeat(500)]) assert.equal(verifyLaunchToken(bad, SECRET, NOW), null);
  assert.equal(signLaunchToken({ phone: PHONE, jti: newLaunchId(), nowMs: NOW }, undefined), null);
  assert.equal(signLaunchToken({ phone: PHONE, jti: newLaunchId(), nowMs: NOW }, "court"), null);
  assert.equal(signLaunchToken({ phone: "abc", jti: newLaunchId(), nowMs: NOW }, SECRET), null);
  assert.equal(signLaunchToken({ phone: PHONE, jti: "x", nowMs: NOW }, SECRET), null);
});

test("jeton : une preuve de vérification du navigateur n'est jamais acceptée comme jeton de lancement", () => {
  const proof = signPhoneProof(PHONE, SECRET, NOW)!;
  assert.equal(verifyLaunchToken(proof, SECRET, NOW), null);
});

test("chaque jeton a un identifiant unique", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newLaunchId()));
  assert.equal(ids.size, 200);
});

test("requête d'échange : un seul champ « token » de taille plausible", () => {
  const token = signLaunchToken({ phone: PHONE, jti: newLaunchId(), nowMs: NOW }, SECRET)!;
  assert.deepEqual(parseLaunchTokenInput({ token }), { ok: true, value: { token } });
  for (const bad of [null, "x", [], {}, { token: "court" }, { token: 42 }, { token: "x".repeat(401) }]) {
    assert.equal(parseLaunchTokenInput(bad).ok, false, JSON.stringify(bad));
  }
});
