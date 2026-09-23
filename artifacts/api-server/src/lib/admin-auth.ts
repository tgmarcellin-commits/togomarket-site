import bcrypt from "bcryptjs";
import { db, adminAccountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

function requiredSecret(name: "ADMIN_PASSWORD" | "SUB_ADMIN_PASSWORD"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be configured as a Replit Secret`);
  }
  return value;
}

export const ADMIN_PASSWORD = requiredSecret("ADMIN_PASSWORD");
export const SUB_ADMIN_PASSWORD_DEFAULT = requiredSecret("SUB_ADMIN_PASSWORD");

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
    const codeHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await db.insert(adminAccountsTable).values({
      username: "superadmin",
      role: "superadmin",
      codeHash,
    });
  }
}
