import assert from "node:assert/strict";
import test from "node:test";
import { getBuyerBalanceContext } from "./buyer-balance-context";

const baseInput = {
  conversationId: 42,
  buyerName: "Awa Koffi",
  buyerPhone: "+228 90 00 00 00",
  authKind: "buyer" as const,
  showAssignDriver: true,
};

test("renders the connected buyer's balance context scoped to their own conversation", () => {
  const context = getBuyerBalanceContext(baseInput);

  assert.ok(context);
  assert.equal(context?.loadUrl, "/api/wallets/buyer/42");
  assert.deepEqual(context?.withdrawBody, { ownerType: "buyer", ownerId: 42 });
  assert.equal(context?.identityLabel.name, "Awa Koffi");
  assert.equal(context?.identityLabel.phone, "+228 90 00 00 00");
});

test("never exposes a balance context to the vendor side of the same conversation", () => {
  const context = getBuyerBalanceContext({ ...baseInput, authKind: "vendor" });

  assert.equal(context, null);
});

test("does not leak the balance when the delivery/wallet feature is disabled for this conversation", () => {
  const context = getBuyerBalanceContext({ ...baseInput, showAssignDriver: false });

  assert.equal(context, null);
});

test("scopes the wallet endpoint to the current conversation, never another participant's", () => {
  const conversationA = getBuyerBalanceContext({ ...baseInput, conversationId: 1 });
  const conversationB = getBuyerBalanceContext({ ...baseInput, conversationId: 2, buyerName: "Other buyer", buyerPhone: "+228 91 11 11 11" });

  assert.equal(conversationA?.loadUrl, "/api/wallets/buyer/1");
  assert.equal(conversationB?.loadUrl, "/api/wallets/buyer/2");
  assert.notEqual(conversationA?.identityLabel.name, conversationB?.identityLabel.name);
});
