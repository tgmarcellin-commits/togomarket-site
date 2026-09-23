import { isAdminAny, isSuperAdmin, getAdminRole, SUB_ADMIN_PASSWORD_DEFAULT } from "./admin-auth";

export async function isAdminOrSubAdmin(password: string): Promise<boolean> {
  return isAdminAny(password);
}

export async function getSubAdminPassword(): Promise<string> {
  return SUB_ADMIN_PASSWORD_DEFAULT;
}

export { isSuperAdmin, getAdminRole };
