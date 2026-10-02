import { and, eq } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { vapidReady, webpush } from "./webpush";
import { logger } from "./logger";

export type VendorPushPayload = {
  title: string;
  body: string;
  tag?: string;
};

function isExpiredPushError(err: unknown): boolean {
  const status = (err as { statusCode?: number } | null)?.statusCode;
  return status === 404 || status === 410;
}

/**
 * Envoie une notification Web Push aux appareils abonnés du vendeur.
 * Ne lève jamais d'erreur ; supprime les abonnements expirés.
 */
export async function sendVendorPush(
  vendorId: number,
  payload: VendorPushPayload,
): Promise<{ sent: number; failed: number }> {
  if (!vapidReady || !Number.isInteger(vendorId) || vendorId <= 0) return { sent: 0, failed: 0 };
  try {
    const subs = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.vendorId, vendorId));
    if (subs.length === 0) return { sent: 0, failed: 0 };

    const message = JSON.stringify(payload);
    const results = await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys as { auth: string; p256dh: string } },
            message,
          );
        } catch (err) {
          if (isExpiredPushError(err)) {
            await db
              .delete(pushSubscriptionsTable)
              .where(and(
                eq(pushSubscriptionsTable.endpoint, sub.endpoint),
                eq(pushSubscriptionsTable.vendorId, vendorId),
              ));
          }
          throw err;
        }
      }),
    );
    const sent = results.filter((result) => result.status === "fulfilled").length;
    return { sent, failed: results.length - sent };
  } catch (err) {
    logger.warn({ err, vendorId }, "Push vendeur : envoi impossible");
    return { sent: 0, failed: 0 };
  }
}
