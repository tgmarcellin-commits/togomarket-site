import { isAdminAny, isSuperAdmin, getAdminRole } from "./admin-auth";

export async function isAdminOrSubAdmin(password: string): Promise<boolean> {
  return isAdminAny(password);
}

export async function getSubAdminPassword(): Promise<string> {
  return process.env.SUB_ADMIN_PASSWORD ?? "1234";
}

export { isSuperAdmin, getAdminRole };
