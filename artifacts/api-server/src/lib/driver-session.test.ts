import assert from "node:assert/strict";
import test from "node:test";
import {
  createDriverSessionToken,
  isDriverSessionTokenMatch,
  parseBearerToken,
} from "./driver-session";

test("driver session tokens are opaque, hashed, and expiring", () => {
  const session = createDriverSessionToken(60_000);

  assert.ok(session.rawToken.length >= 32);
  assert.equal(session.tokenHash.length, 64);
  assert.equal(isDriverSessionTokenMatch(session.rawToken, session.tokenHash), true);
  assert.equal(isDriverSessionTokenMatch(`${session.rawToken}x`, session.tokenHash), false);
  assert.ok(session.expiresAt.getTime() > Date.now());
});

test("bearer tokens are parsed conservatively", () => {
  assert.equal(parseBearerToken(["Bearer", "abc123"].join(" ")), "abc123");
  assert.equal(parseBearerToken("bearer xyz"), "xyz");
  assert.equal(parseBearerToken("Token xyz"), null);
  assert.equal(parseBearerToken(undefined), null);
  assert.equal(parseBearerToken("Bearer   "), null);
});
