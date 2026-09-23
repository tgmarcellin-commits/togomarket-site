import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function verifyFedapayDriverWebhookSignature(rawBody: Buffer, header: string | undefined): boolean {
  const secret = process.env.FEDAPAY_DRIVER_WEBHOOK_SECRET?.trim();
  if (!secret || !header) return false;
  const fields = new Map(header.split(",").map((part) => {
    const separator = part.indexOf("=");
    return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }));
  const timestamp = Number(fields.get("t"));
  const signature = fields.get("s");
  if (!Number.isFinite(timestamp) || !signature) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`, "utf8")
    .digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  return expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer);
}

export function paymentWebhookEventHash(rawBody: Buffer): string {
  return createHash("sha256").update(rawBody).digest("hex");
}
