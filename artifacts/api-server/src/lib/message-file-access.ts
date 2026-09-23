import { createHmac, timingSafeEqual } from "node:crypto";
import { parseCloudinaryImageUrl } from "./cloudinary-image";

const ACCESS_TTL_MS = 5 * 60 * 1000;

function secret(): string {
  const value = process.env.SESSION_SECRET?.trim();
  if (!value) throw new Error("SESSION_SECRET must be configured");
  return value;
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function secureMessageFileUrl<T extends {
  id: number;
  conversationId: number;
  fileUrl: string | null;
}>(message: T): T {
  if (!message.fileUrl?.startsWith("/objects/") &&
      parseCloudinaryImageUrl(message.fileUrl)?.deliveryType !== "authenticated") return message;
  const expires = Date.now() + ACCESS_TTL_MS;
  const payload = `${message.conversationId}.${message.id}.${expires}`;
  const access = `${expires}.${signature(payload)}`;
  return {
    ...message,
    fileUrl: `/api/conversations/${message.conversationId}/files/${message.id}?access=${encodeURIComponent(access)}`,
  };
}

export function verifyMessageFileAccess(
  conversationId: number,
  messageId: number,
  access: string,
): boolean {
  const [expiresRaw, supplied, ...extra] = access.split(".");
  const expires = Number(expiresRaw);
  if (extra.length || !Number.isFinite(expires) || expires < Date.now() || !supplied) return false;
  const expected = Buffer.from(signature(`${conversationId}.${messageId}.${expires}`));
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}