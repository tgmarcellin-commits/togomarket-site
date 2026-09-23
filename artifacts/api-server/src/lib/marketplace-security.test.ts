import assert from "node:assert/strict";
import test from "node:test";
import {
  assertIntegerFcfaAmount,
  createQrToken,
  ensureDeliveryJobTransition,
  ensureReturnTransition,
  isQrTokenUsable,
  normalizeIdempotencyKey,
} from "./marketplace-security";

test("driver/order transitions reject invalid states", () => {
  assert.doesNotThrow(() => ensureDeliveryJobTransition("accepted", "picked_up"));
  assert.throws(() => ensureDeliveryJobTransition("accepted", "delivered"));

  assert.doesNotThrow(() => ensureReturnTransition("requested", "approved"));
  assert.throws(() => ensureReturnTransition("none", "refunded"));
});

test("QR token is usable only before expiry and single-use", () => {
  const created = createQrToken(300);
  assert.equal(
    isQrTokenUsable({
      providedRawToken: created.rawToken,
      persistedTokenHash: created.tokenHash,
      expiresAt: created.expiresAt,
      consumedAt: null,
    }),
    true,
  );

  assert.equal(
    isQrTokenUsable({
      providedRawToken: created.rawToken,
      persistedTokenHash: created.tokenHash,
      expiresAt: new Date(Date.now() - 10),
      consumedAt: null,
    }),
    false,
  );

  assert.equal(
    isQrTokenUsable({
      providedRawToken: created.rawToken,
      persistedTokenHash: created.tokenHash,
      expiresAt: created.expiresAt,
      consumedAt: new Date(),
    }),
    false,
  );
});

test("FCFA amounts and idempotency keys enforce strict constraints", () => {
  assert.equal(assertIntegerFcfaAmount(1500), 1500);
  assert.throws(() => assertIntegerFcfaAmount(10.25));
  assert.throws(() => assertIntegerFcfaAmount(0));

  const hash = normalizeIdempotencyKey("my-safe-key-123");
  assert.equal(hash.length, 64);
  assert.throws(() => normalizeIdempotencyKey("short"));
});
