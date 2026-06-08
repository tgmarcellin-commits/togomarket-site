import { sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";

/**
 * Strips spaces, dashes, dots and parentheses from a phone number.
 * Keeps the leading + and all digits.
 */
export function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-.()]/g, "").trim();
}

/**
 * Drizzle SQL expression that compares a phone column (ignoring spaces/dashes/dots)
 * to an already-normalized phone string.
 * Works on existing rows that were stored with spaces or dashes.
 */
export function phoneEq(column: AnyColumn, normalizedPhone: string): SQL {
  return sql`regexp_replace(${column}, '[\s\-.]', '', 'g') = ${normalizedPhone}`;
}
