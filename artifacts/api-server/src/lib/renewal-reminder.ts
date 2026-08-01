// =============================================================================
// CRON QUOTIDIEN — Rappel de renouvellement des boutiques
// =============================================================================
// Vérifie chaque jour les boutiques dont l'abonnement expire dans 3 jours
// et envoie une notification push navigateur au vendeur.
//
// Fréquence  : toutes les 24 heures (+ 1 vérification au démarrage du serveur)
// Fenêtre    : expiryDate entre J+2.5 et J+3.5 (évite les doublons naturellement)
// Robustesse : chaque échec d'envoi est loggué mais ne bloque pas les suivants
// Condition  : le vendeur doit avoir activé les notifications push (pushSubscriptionsTable)
// =============================================================================

import { db, vendorsTable, pushSubscriptionsTable, vendorNotificationsTable } from "@workspace/db";
import { and, gt, lte, eq } from "drizzle-orm";
import { webpush, vapidReady } from "./webpush";
import { logger } from "./logger";

// ─────────────────────────────────────────────────────────────────────────────
// Vérification et envoi des rappels
// ─────────────────────────────────────────────────────────────────────────────
export async function checkAndSendRenewalReminders(): Promise<void> {
  if (!vapidReady) {
    logger.warn("Renewal reminder: VAPID non configuré — rappels push désactivés");
    return;
  }

  const now = new Date();

  // Fenêtre de 24h centrée sur J+3 : entre J+2.5 jours et J+3.5 jours
  // Cela garantit qu'un vendeur ne reçoit qu'un seul rappel par cycle de 24h
  const windowStart = new Date(now.getTime() + 2.5 * 24 * 60 * 60 * 1000);
  const windowEnd   = new Date(now.getTime() + 3.5 * 24 * 60 * 60 * 1000);

  // ── Requête DB : vendeurs publiés expirant dans ~3 jours ─────────────────
  let vendors: (typeof vendorsTable.$inferSelect)[];
  try {
    vendors = await db
      .select()
      .from(vendorsTable)
      .where(
        and(
          eq(vendorsTable.isPublished, true),
          gt(vendorsTable.expiryDate, windowStart),
          lte(vendorsTable.expiryDate, windowEnd)
        )
      );
  } catch (err) {
    logger.error({ err }, "Renewal reminder: échec de la requête DB");
    return;
  }

  if (vendors.length === 0) {
    logger.info("Renewal reminder: aucune boutique à relancer aujourd'hui");
    return;
  }

  logger.info({ count: vendors.length }, "Renewal reminder: envoi des rappels push");

  // ── Envoi Web Push pour chaque vendeur ───────────────────────────────────
  for (const vendor of vendors) {
    try {
      // Récupérer les abonnements push du vendeur
      const subs = await db
        .select()
        .from(pushSubscriptionsTable)
        .where(eq(pushSubscriptionsTable.vendorId, vendor.id));

      if (subs.length === 0) {
        logger.info(
          { vendorId: vendor.id },
          "Renewal reminder: aucun abonnement push pour ce vendeur — ignoré"
        );
        continue;
      }

      const notifTitle = "⏰ Votre boutique expire dans 3 jours";
      const notifBody = `Bonjour ${vendor.firstName}, renouvelez votre abonnement pour éviter toute interruption.`;
      const notifUrl = `/api/vendors/renewal-link/${vendor.id}`;

      // Enregistrer dans la boîte de réception in-app (visible dans l'onglet Messages)
      await db.insert(vendorNotificationsTable).values({
        vendorId: vendor.id,
        title: notifTitle,
        body: notifBody,
        url: notifUrl,
      });

      const payload = JSON.stringify({
        title: notifTitle,
        body: notifBody,
        url: notifUrl,
      });

      // Envoyer à tous les appareils enregistrés du vendeur
      const results = await Promise.allSettled(
        subs.map((sub) =>
          webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: sub.keys as { auth: string; p256dh: string },
            },
            payload,
          ).catch(async (err: { statusCode?: number }) => {
            // Abonnement expiré → le supprimer proprement
            if (err?.statusCode === 410) {
              await db
                .delete(pushSubscriptionsTable)
                .where(eq(pushSubscriptionsTable.endpoint, sub.endpoint));
            }
            throw err;
          })
        )
      );

      const sent = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      logger.info(
        { vendorId: vendor.id, sent, failed, expiryDate: vendor.expiryDate },
        "Renewal reminder: rappel push traité"
      );
    } catch (err) {
      logger.error(
        { err, vendorId: vendor.id },
        "Renewal reminder: échec inattendu pour ce vendeur"
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Démarrage du cron quotidien
// ─────────────────────────────────────────────────────────────────────────────
export function startRenewalReminderCron(): void {
  const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 heures
  const STARTUP_DELAY_MS = 60_000;           // 60 secondes après démarrage

  logger.info(
    { intervalHours: 24, startupDelaySeconds: 60 },
    "Renewal reminder cron: démarrage programmé"
  );

  const startupTimer = setTimeout(() => {
    logger.info("Renewal reminder: première vérification au démarrage");
    void checkAndSendRenewalReminders();
  }, STARTUP_DELAY_MS);
  startupTimer.unref();

  const dailyTimer = setInterval(() => {
    logger.info("Renewal reminder: vérification quotidienne déclenchée");
    void checkAndSendRenewalReminders();
  }, INTERVAL_MS);
  dailyTimer.unref();
}
