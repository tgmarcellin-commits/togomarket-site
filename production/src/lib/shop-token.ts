/**
 * Shop link token encoding.
 * Format: base64url("vendorId:publishCode")
 * e.g. vendorId=5, code="4567" → btoa("5:4567") → "NTo0NTY3"
 *
 * The token is opaque — neither the ID nor the code is readable.
 * The link expires when the publish code expires.
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
  code: string;
}

export function encodeShopToken(vendorId: number, code: string): string {
  return toBase64Url(`${vendorId}:${code}`);
}

export function decodeShopToken(token: string): ShopToken | null {
  try {
    const decoded = fromBase64Url(token);
    const colon = decoded.indexOf(":");
    if (colon < 1) return null;
    const vendorId = parseInt(decoded.slice(0, colon), 10);
    const code = decoded.slice(colon + 1);
    if (isNaN(vendorId) || vendorId <= 0 || !code) return null;
    return { vendorId, code };
  } catch {
    return null;
  }
}
