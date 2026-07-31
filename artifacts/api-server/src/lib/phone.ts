import { sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";

/**
 * Normalises a phone number to a pure-digit string with country code.
 * Rules (order matters):
 *  1. Strip spaces, dashes, dots, parentheses, leading +
 *  2. Strip leading 00 (international dialling prefix)
 *  3. If exactly 8 digits remain → assume Togo local → prepend 228
 *  4. Bénin dual-format: Bénin added "01" in front of all 8-digit local numbers.
 *     Old format : 229 + 8 digits = 11 digits total  (e.g. 22912345678)
 *     New format : 229 + 01 + 8 digits = 13 digits   (e.g. 2290112345678)
 *     → Canonicalise old format to new format so both work seamlessly.
 */
export function normalizePhone(raw: string): string {
  let s = raw.replace(/[\s\-.()+ ]/g, "").trim();
  if (s.startsWith("00")) s = s.slice(2);
  // 8-digit local without country code → assume Togo
  if (/^\d{8}$/.test(s)) s = "228" + s;
  // Bénin old format: 229 + exactly 8 digits (11 total), not already starting with 22901
  if (s.startsWith("229") && s.length === 11 && !s.startsWith("22901")) {
    s = "22901" + s.slice(3); // 229XXXXXXXX → 22901XXXXXXXX
  }
  return s;
}

/**
 * Drizzle SQL WHERE expression that compares a phone column to a
 * pre-normalised phone string, handling stored formats:
 *  - 11-digit Togo international (228XXXXXXXX)
 *  - legacy 8-digit Togo local  (XXXXXXXX) → prefixed with 228 inline
 *  - 11-digit old Bénin (229XXXXXXXX) → canonicalised to 22901XXXXXXXX
 *  - 13-digit new Bénin (22901XXXXXXXX) stored as-is
 * Also strips +, spaces, dashes from stored values.
 */
export function phoneEq(column: AnyColumn, normalizedPhone: string): SQL {
  return sql`
    CASE
      WHEN length(regexp_replace(${column}, '[^0-9]', '', 'g')) = 8
        THEN '228' || regexp_replace(${column}, '[^0-9]', '', 'g')
      WHEN left(regexp_replace(${column}, '[^0-9]', '', 'g'), 3) = '229'
        AND length(regexp_replace(${column}, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(${column}, '[^0-9]', '', 'g'), 5) != '22901'
        THEN '22901' || right(regexp_replace(${column}, '[^0-9]', '', 'g'), 8)
      ELSE regexp_replace(${column}, '[^0-9]', '', 'g')
    END = ${normalizedPhone}
  `;
}
