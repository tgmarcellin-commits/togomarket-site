import { db, driverNotificationsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Crée une notification dans le tableau de bord du livreur (secours du message WhatsApp).
 * Ne lève jamais d'erreur : une notification manquée ne doit jamais bloquer un paiement
 * ou une mission. Une seule notification par (livreur, type, commande).
 */
export async function createDriverNotification(params: {
  driverId: number;
  orderId?: number | null;
  kind: string;
  title: string;
  body: string;
}): Promise<void> {
  try {
    await db
      .insert(driverNotificationsTable)
      .values({
        driverId: params.driverId,
        orderId: params.orderId ?? null,
        kind: params.kind,
        title: params.title,
        body: params.body,
      })
      .onConflictDoNothing();
  } catch (err) {
    logger.warn({ err, driverId: params.driverId, kind: params.kind }, "Notification livreur : écriture impossible");
  }
}
