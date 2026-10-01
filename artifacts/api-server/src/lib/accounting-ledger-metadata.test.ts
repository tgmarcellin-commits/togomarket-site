import assert from "node:assert/strict";
import test from "node:test";
import { jsonb, pgTable } from "drizzle-orm/pg-core";
import { buildSafeMetadataIntFilter, isNumericMetadataValue } from "./accounting-ledger";

const testTable = pgTable("test_ledger_entries", { metadata: jsonb("metadata") });

/** Renders a drizzle SQL fragment to a plain string for assertions, without a live DB. */
function renderSql(fragment: { queryChunks: unknown[] }): string {
  return fragment.queryChunks
    .map((chunk: any) => {
      if (Array.isArray(chunk)) return chunk.join("");
      if (chunk && typeof chunk === "object" && "value" in chunk) return String(chunk.value);
      return "";
    })
    .join("");
}

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

test("isNumericMetadataValue rejects scientific notation and whitespace-padded values", () => {
  assert.equal(isNumericMetadataValue("1e10"), false);
  assert.equal(isNumericMetadataValue(" 42"), false);
  assert.equal(isNumericMetadataValue("42 "), false);
  assert.equal(isNumericMetadataValue("+42"), false);
});

test("isNumericMetadataValue accepts values far beyond the int4 range (digits only)", () => {
  // These are legitimate digit-only strings; the overflow protection against
  // Postgres' "integer out of range" error lives in buildSafeMetadataIntFilter
  // (via a ::numeric cast), not in this format-only guard.
  assert.equal(isNumericMetadataValue("999999999999999999999"), true);
  assert.equal(isNumericMetadataValue("2147483648"), true); // int4 max + 1
});

// buildSafeMetadataIntFilter: generated SQL must never let an out-of-range or
// non-numeric legacy metadata value reach an `::int`/`::bigint` cast, which
// would surface as a Postgres "integer out of range" 500 on
// `GET /admin/comptabilite/journals`.

test("buildSafeMetadataIntFilter casts the metadata value to ::numeric, never ::int", () => {
  const sqlText = renderSql(buildSafeMetadataIntFilter(testTable.metadata, "orderId", 42) as any);
  assert.match(sqlText, /::numeric/);
  assert.doesNotMatch(sqlText, /::int\b/);
  assert.doesNotMatch(sqlText, /::bigint\b/);
});

test("buildSafeMetadataIntFilter keeps the numeric-only regex guard before casting", () => {
  const sqlText = renderSql(buildSafeMetadataIntFilter(testTable.metadata, "driverId", 7) as any);
  assert.match(sqlText, /CASE WHEN/);
  assert.match(sqlText, /ELSE NULL END/);
});

test("buildSafeMetadataIntFilter short-circuits to an always-false condition for non-integer filter values", () => {
  // A malformed query string (e.g. ?orderId=4.5 or ?orderId=NaN) must never
  // produce SQL that could throw; it should simply match nothing.
  assert.equal(renderSql(buildSafeMetadataIntFilter(testTable.metadata, "orderId", 4.5) as any), "false");
  assert.equal(
    renderSql(buildSafeMetadataIntFilter(testTable.metadata, "orderId", Number.NaN) as any),
    "false",
  );
  assert.equal(
    renderSql(buildSafeMetadataIntFilter(testTable.metadata, "orderId", Number.POSITIVE_INFINITY) as any),
    "false",
  );
});

test("buildSafeMetadataIntFilter accepts integer filter values outside the int4 range without throwing", () => {
  // The filter itself must be constructible (and safe) even when matching
  // against ids larger than Postgres' int4 max, since the comparison is
  // numeric, not int4.
  assert.doesNotThrow(() => buildSafeMetadataIntFilter(testTable.metadata, "walletId", 9999999999));
});
