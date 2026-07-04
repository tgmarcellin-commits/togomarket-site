import { db, platformSettingsTable } from "@workspace/db";
import { ADMIN_PASSWORD, SUB_ADMIN_PASSWORD_DEFAULT } from "./admin-auth";

export async function isAdminOrSubAdmin(password: string): Promise<boolean> {
  if (password === ADMIN_PASSWORD) return true;
  if (!password) return false;
  const rows = await db
    .select({ subAdminPassword: platformSettingsTable.subAdminPassword })
    .from(platformSettingsTable)
    .limit(1);
  return rows.length > 0 && rows[0].subAdminPassword === password;
}

export async function getSubAdminPassword(): Promise<string> {
  const rows = await db
    .select({ subAdminPassword: platformSettingsTable.subAdminPassword })
    .from(platformSettingsTable)
    .limit(1);
  return rows[0]?.subAdminPassword ?? SUB_ADMIN_PASSWORD_DEFAULT;
}
