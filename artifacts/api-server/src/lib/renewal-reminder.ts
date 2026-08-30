// =============================================================================
// CRON QUOTIDIEN — Rappel de renouvellement des boutiques
// =============================================================================
// Chaque jour :
//   • J-3, J-2, J-1 : une notification par jour au vendeur ("expire dans X jour(s)")
//   • Le lendemain de l'expiration : une notification "boutique expirée" (une seule fois)
//
// Fréquence   : toutes les 24 heures (+ 1 vérification au démarrage du serveur)
// Anti-doublon: on vérifie dans vendor_notifications qu'aucune notification du
//               même type n'a été envoyée dans les 20 dernières heures
//               (l'avis d'expiration n'est envoyé qu'une seule fois par cycle)
// Robustesse  : chaque échec d'envoi est loggué mais ne bloque pas les suivants
// In-app      : la notification est toujours enregistrée dans la boîte de
//               réception du vendeur, même s'il n'a pas activé le push
// =============================================================================

import { db, vendorsTable, pushSubscriptionsTable, vendorNotificationsTable } from "@workspace/db";
import { and, gt, gte, lte, eq, desc } from "drizzle-orm";
import { webpush, vapidReady } from "./webpush";
import { logger } from "./logger";
import { createVendorRenewalToken } from "./vendor-renewal-token";

const DAY_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Anti-doublon : une notification du même type a-t-elle été envoyée récemment ?
// ─────────────────────────────────────────────────────────────────────────────
async function wasNotifiedRecently(vendorId: number, notifType: string, sinceMs: number): Promise<boolean> {
  const since = new Date(Date.now() - sinceMs);
  const rows = await db
    .select({ id: vendorNotificationsTable.id })
    .from(vendorNotificationsTable)
    .where(and(
      eq(vendorNotificationsTable.vendorId, vendorId),
      eq(vendorNotificationsTable.notifType, notifType),
      gte(vendorNotificationsTable.createdAt, since),
    ))
    .orderBy(desc(vendorNotificationsTable.createdAt))
    .limit(1);
  return rows.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Enregistre la notif in-app + envoie le push sur tous les appareils du vendeur
// ─────────────────────────────────────────────────────────────────────────────
async function notifyVendor(
  vendorId: number,
  title: string,
  body: string,
  url: string | null,
  notifType: string,
): Promise<void> {
  // Toujours enregistrer dans la boîte de réception in-app
  await db.insert(vendorNotificationsTable).values({ vendorId, title, body, url, notifType });

  if (!vapidReady) return;

  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.vendorId, vendorId));
  if (subs.length === 0) return;

  const payload = JSON.stringify({ title, body, url });

  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys as { auth: string; p256dh: string } },
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
  logger.info({ vendorId, notifType, sent, failed }, "Renewal reminder: notification traitée");
}

// ─────────────────────────────────────────────────────────────────────────────
// Vérification et envoi des rappels
// ─────────────────────────────────────────────────────────────────────────────
export async function checkAndSendRenewalReminders(): Promise<void> {
  const now = new Date();

  // ── 1) Rappels J-3 / J-2 / J-1 : expiryDate entre maintenant et J+3.5 ─────
  let expiring: (typeof vendorsTable.$inferSelect)[];
  try {
    expiring = await db
      .select()
      .from(vendorsTable)
      .where(
        and(
          eq(vendorsTable.isPublished, true),
          gt(vendorsTable.expiryDate, now),
          lte(vendorsTable.expiryDate, new Date(now.getTime() + 3.5 * DAY_MS)),
        )
      );
  } catch (err) {
    logger.error({ err }, "Renewal reminder: échec de la requête DB (expirant)");
    expiring = [];
  }

  for (const vendor of expiring) {
    try {
      if (!vendor.expiryDate) continue;
      // Anti-doublon : max 1 rappel par 20h
      if (await wasNotifiedRecently(vendor.id, "renewal", 20 * 60 * 60 * 1000)) continue;

      const daysLeft = Math.min(3, Math.max(1, Math.ceil((vendor.expiryDate.getTime() - now.getTime()) / DAY_MS)));
      const dayWord = daysLeft > 1 ? `${daysLeft} jours` : "1 jour";

      await notifyVendor(
        vendor.id,
        `⏰ Votre boutique expire dans ${dayWord}`,
        `Bonjour ${vendor.firstName}, renouvelez votre abonnement pour éviter toute interruption de votre boutique.`,
        `/api/vendors/renewal-link/${vendor.id}?token=${encodeURIComponent(createVendorRenewalToken(vendor.id))}`,
        "renewal",
      );
    } catch (err) {
      logger.error({ err, vendorId: vendor.id }, "Renewal reminder: échec rappel expirant");
    }
  }

  // ── 2) Avis d'expiration : expiryDate dépassée depuis 12h à 7 jours ───────
  // Fenêtre large (7 j) pour ne jamais rater l'avis même si le serveur était
  // arrêté ; l'anti-doublon garantit un seul envoi par cycle d'expiration.
  let justExpired: (typeof vendorsTable.$inferSelect)[];
  try {
    justExpired = await db
      .select()
      .from(vendorsTable)
      .where(
        and(
          gt(vendorsTable.expiryDate, new Date(now.getTime() - 7 * DAY_MS)),
          lte(vendorsTable.expiryDate, now),
        )
      );
  } catch (err) {
    logger.error({ err }, "Renewal reminder: échec de la requête DB (expirés)");
    justExpired = [];
  }

  for (const vendor of justExpired) {
    try {
      if (!vendor.expiryDate) continue;
      // Attendre le lendemain de l'expiration (au moins 12h après)
      if (now.getTime() - vendor.expiryDate.getTime() < 12 * 60 * 60 * 1000) continue;
      // Une seule notification "expirée" par cycle : aucune notif 'expired'
      // créée depuis la date d'expiration de ce cycle
      const already = await db
        .select({ id: vendorNotificationsTable.id })
        .from(vendorNotificationsTable)
        .where(and(
          eq(vendorNotificationsTable.vendorId, vendor.id),
          eq(vendorNotificationsTable.notifType, "expired"),
          gte(vendorNotificationsTable.createdAt, vendor.expiryDate),
        ))
        .limit(1);
      if (already.length > 0) continue;

      await notifyVendor(
        vendor.id,
        "🔴 Votre boutique a expiré",
        `Bonjour ${vendor.firstName}, votre boutique est maintenant expirée et n'est plus visible. Renouvelez votre abonnement pour la réactiver.`,
        `/api/vendors/renewal-link/${vendor.id}?token=${encodeURIComponent(createVendorRenewalToken(vendor.id))}`,
        "expired",
      );
    } catch (err) {
      logger.error({ err, vendorId: vendor.id }, "Renewal reminder: échec avis expiration");
    }
  }

  logger.info(
    { expiring: expiring.length, justExpired: justExpired.length },
    "Renewal reminder: cycle terminé"
  );
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
