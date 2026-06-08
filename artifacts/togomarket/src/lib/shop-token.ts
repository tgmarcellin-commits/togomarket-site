/**
 * Encodes/decodes a vendor ID as an opaque hex token.
 * Uses XOR with a fixed key so the token looks like a hash,
 * not a sequential number or a 4-digit code.
 * Key = 0x54474F4D  ("TGOM" in ASCII)
 */
const KEY = 0x54474f4d;

export function vendorIdToShopToken(id: number): string {
  return ((id ^ KEY) >>> 0).toString(16).padStart(8, "0");
}

export function shopTokenToVendorId(token: string): number | null {
  if (!/^[0-9a-f]{8}$/i.test(token)) return null;
  const xored = parseInt(token, 16);
  return (xored ^ KEY) >>> 0;
}
