import assert from "node:assert/strict";
import test from "node:test";
import { isNumericMetadataValue } from "./accounting-ledger";

// Regression tests for the hotfix guard that prevents `GET
// /admin/comptabilite/journals` from throwing a Postgres cast error (500)
// when legacy/partially migrated rows store non-numeric or missing values
// for metadata keys like orderId/driverId/walletId.

test("isNumericMetadataValue accepts plain positive integer strings", () => {
  assert.equal(isNumericMetadataValue("42"), true);
  assert.equal(isNumericMetadataValue("0"), true);
});

test("isNumericMetadataValue accepts negative integer strings", () => {
  assert.equal(isNumericMetadataValue("-7"), true);
});

test("isNumericMetadataValue rejects non-numeric legacy values", () => {
  assert.equal(isNumericMetadataValue("ORDER_42"), false);
  assert.equal(isNumericMetadataValue("N/A"), false);
  assert.equal(isNumericMetadataValue(""), false);
});

test("isNumericMetadataValue rejects decimal strings", () => {
  assert.equal(isNumericMetadataValue("4.2"), false);
});

test("isNumericMetadataValue rejects non-string values (null/undefined/number)", () => {
  assert.equal(isNumericMetadataValue(null), false);
  assert.equal(isNumericMetadataValue(undefined), false);
  assert.equal(isNumericMetadataValue(42), false);
});
