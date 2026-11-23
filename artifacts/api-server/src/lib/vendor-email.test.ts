import test from "node:test";
import assert from "node:assert/strict";
import {
  generateTemporaryPassword,
  isEmailIdentifier,
  isUniqueViolation,
  isValidEmail,
  maskEmail,
  normalizeEmail,
} from "./vendor-email";

test("normalizeEmail retire les espaces et passe en minuscules", () => {
  assert.equal(normalizeEmail("  Kofi.Mensah @Gmail.COM "), "kofi.mensah@gmail.com");
});

test("isValidEmail accepte une adresse correcte et refuse le reste", () => {
  assert.equal(isValidEmail("kofi@example.com"), true);
  assert.equal(isValidEmail("kofi@example"), false);
  assert.equal(isValidEmail("kofi example.com"), false);
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail(`${"a".repeat(250)}@x.io`), false);
});

test("isEmailIdentifier distingue e-mail et numéro", () => {
  assert.equal(isEmailIdentifier("kofi@example.com"), true);
  assert.equal(isEmailIdentifier("+228 90 00 00 00"), false);
});

test("maskEmail masque la partie locale", () => {
  assert.equal(maskEmail("kofi.mensah@gmail.com"), "ko•••@gmail.com");
  assert.equal(maskEmail("pasunemail"), "•••");
});

test("generateTemporaryPassword : 12 caractères, 3 classes, différent à chaque appel", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    const pwd = generateTemporaryPassword();
    assert.equal(pwd.length, 12);
    assert.match(pwd, /[A-Z]/);
    assert.match(pwd, /[a-z]/);
    assert.match(pwd, /[0-9]/);
    assert.doesNotMatch(pwd, /[0OIl1]/);
    seen.add(pwd);
  }
  assert.equal(seen.size, 200);
});

test("isUniqueViolation reconnaît le code 23505 direct ou en cause", () => {
  assert.equal(isUniqueViolation({ code: "23505" }), true);
  assert.equal(isUniqueViolation({ cause: { code: "23505" } }), true);
  assert.equal(isUniqueViolation(new Error("autre")), false);
  assert.equal(isUniqueViolation(null), false);
});
