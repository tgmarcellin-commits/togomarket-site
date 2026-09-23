/**
 * Shop link token encoding.
 * Format: base64url(String(vendorId))
 * e.g. vendorId=5 → btoa("5") → "NQ"
 *
 * The token is opaque. Its validity is tied to the vendor's active
 * subscription (checked server-side via /vendors/shop-status), not to
 * any publish code.
 * Legacy ?shopNumber= (integer) links are handled separately in home.tsx.
 */

function toBase64Url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return atob(padded);
}

export interface ShopToken {
  vendorId: number;
}

export function encodeShopToken(vendorId: number): string {
  return toBase64Url(String(vendorId));
}

export function decodeShopToken(token: string): ShopToken | null {
  try {
    const decoded = fromBase64Url(token);
    const vendorId = parseInt(decoded, 10);
    if (isNaN(vendorId) || vendorId <= 0) return null;
    return { vendorId };
  } catch {
    return null;
  }
}
