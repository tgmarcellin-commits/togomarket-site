import { and, eq } from "drizzle-orm";
import { db, driverPushSubscriptionsTable } from "@workspace/db";
import { vapidReady, webpush } from "./webpush";
import { logger } from "./logger";

export type DriverPushPayload = {
  title: string;
  body: string;
  /** Chemin ouvert au clic : seul /driver-connexion… est pris en compte par le service worker. */
  url?: string;
  tag?: string;
};

function isExpiredPushError(err: unknown): boolean {
  const status = (err as { statusCode?: number } | null)?.statusCode;
  return status === 404 || status === 410;
}

/**
 * Envoie une notification Web Push à tous les appareils abonnés du livreur.
 * Ne lève jamais d'erreur (une notification ratée ne doit pas bloquer un paiement) ;
 * les abonnements expirés sont supprimés automatiquement.
 */
export async function sendDriverPush(
  driverId: number,
  payload: DriverPushPayload,
): Promise<{ sent: number; failed: number }> {
  if (!vapidReady) return { sent: 0, failed: 0 };
  try {
    const subs = await db
      .select()
      .from(driverPushSubscriptionsTable)
      .where(eq(driverPushSubscriptionsTable.driverId, driverId));
    if (subs.length === 0) return { sent: 0, failed: 0 };

    const message = JSON.stringify({ url: "/driver-connexion", ...payload });
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
              .delete(driverPushSubscriptionsTable)
              .where(and(
                eq(driverPushSubscriptionsTable.endpoint, sub.endpoint),
                eq(driverPushSubscriptionsTable.driverId, driverId),
              ));
          }
          throw err;
        }
      }),
    );
    const sent = results.filter((result) => result.status === "fulfilled").length;
    return { sent, failed: results.length - sent };
  } catch (err) {
    logger.warn({ err, driverId }, "Push livreur : envoi impossible");
    return { sent: 0, failed: 0 };
  }
}
