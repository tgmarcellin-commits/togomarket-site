export const SESSION_COOKIE_PASSWORD = "session-cookie";

/** Legacy endpoints accept these headers, but cookie-authenticated requests must not send a fake password. */
export function vendorAuthHeaders(phone: string, password: string): Record<string, string> {
  return password === SESSION_COOKIE_PASSWORD
    ? {}
    : { "x-vendor-phone": phone, "x-vendor-password": password };
}