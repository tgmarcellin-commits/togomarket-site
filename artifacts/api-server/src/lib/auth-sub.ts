import { db, platformSettingsTable } from "@workspace/db";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "17210";

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
  return rows[0]?.subAdminPassword ?? "0101";
}
