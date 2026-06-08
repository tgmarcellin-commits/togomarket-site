import { sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";

/**
 * Normalises a phone number to a pure-digit string with country code.
 * Rules (order matters):
 *  1. Strip spaces, dashes, dots, parentheses, leading +
 *  2. Strip leading 00 (international dialling prefix)
 *  3. If exactly 8 digits remain → assume Togo local → prepend 228
 */
export function normalizePhone(raw: string): string {
  let s = raw.replace(/[\s\-.()+ ]/g, "").trim();
  if (s.startsWith("00")) s = s.slice(2);
  if (/^\d{8}$/.test(s)) s = "228" + s;
  return s;
}

/**
 * Drizzle SQL WHERE expression that compares a phone column to a
 * pre-normalised phone string, handling both stored formats:
 *  - 11-digit international (228XXXXXXXX)
 *  - legacy 8-digit local  (XXXXXXXX) → prefixed with 228 inline
 * Also strips +, spaces, dashes from stored values.
 */
export function phoneEq(column: AnyColumn, normalizedPhone: string): SQL {
  return sql`
    CASE
      WHEN length(regexp_replace(${column}, '[^0-9]', '', 'g')) = 8
      THEN '228' || regexp_replace(${column}, '[^0-9]', '', 'g')
      ELSE regexp_replace(${column}, '[^0-9]', '', 'g')
    END = ${normalizedPhone}
  `;
}
