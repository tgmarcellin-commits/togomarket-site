import bcrypt from "bcryptjs";
import { db, adminAccountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function verifyAdminCode(code: string): Promise<{ role: string; username: string } | null> {
  const accounts = await db.select().from(adminAccountsTable);
  for (const account of accounts) {
    const match = await bcrypt.compare(code, account.codeHash);
    if (match) {
      return { role: account.role, username: account.username };
    }
  }
  return null;
}

export async function isSuperAdmin(code: string): Promise<boolean> {
  const result = await verifyAdminCode(code);
  return result?.role === "superadmin";
}

export async function isAdminAny(code: string): Promise<boolean> {
  const result = await verifyAdminCode(code);
  return result !== null;
}

export async function getAdminRole(code: string): Promise<string | null> {
  const result = await verifyAdminCode(code);
  return result?.role ?? null;
}

export async function initDefaultSuperAdmin() {
  const existing = await db
    .select({ id: adminAccountsTable.id })
    .from(adminAccountsTable)
    .where(eq(adminAccountsTable.role, "superadmin"))
    .limit(1);

  if (existing.length === 0) {
    const defaultCode = process.env.ADMIN_PASSWORD ?? "17210";
    const codeHash = await bcrypt.hash(defaultCode, 10);
    await db.insert(adminAccountsTable).values({
      username: "superadmin",
      role: "superadmin",
      codeHash,
    });
  }
}

export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "17210";
export const SUB_ADMIN_PASSWORD_DEFAULT = process.env.SUB_ADMIN_PASSWORD ?? "1234";
