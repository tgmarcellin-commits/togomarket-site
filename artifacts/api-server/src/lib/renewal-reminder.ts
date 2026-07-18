// =============================================================================
// CRON QUOTIDIEN — Rappel de renouvellement des boutiques
// =============================================================================
// Vérifie chaque jour les boutiques dont l'abonnement expire dans 3 jours
// et envoie un rappel WhatsApp avec un lien de paiement FedaPay.
//
// Fréquence  : toutes les 24 heures (+ 1 vérification au démarrage du serveur)
// Fenêtre    : expiryDate entre J+2.5 et J+3.5 (évite les doublons naturellement)
// Robustesse : chaque échec d'envoi est loggué mais ne bloque pas les suivants
// =============================================================================

import { db, vendorsTable } from "@workspace/db";
import { and, gt, lte, eq } from "drizzle-orm";
import { sendRenewalReminderTemplate } from "./whatsapp-api";
import { logger } from "./logger";

// ─────────────────────────────────────────────────────────────────────────────
// Vérification et envoi des rappels
// ─────────────────────────────────────────────────────────────────────────────
export async function checkAndSendRenewalReminders(): Promise<void> {
  const now = new Date();

  // Fenêtre de 24h centrée sur J+3 : entre J+2.5 jours et J+3.5 jours
  // Cela garantit qu'un vendeur ne reçoit qu'un seul rappel par cycle de 24h
  const windowStart = new Date(now.getTime() + 2.5 * 24 * 60 * 60 * 1000);
  const windowEnd   = new Date(now.getTime() + 3.5 * 24 * 60 * 60 * 1000);

  // ── Requête DB ────────────────────────────────────────────────────────────
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
    // Erreur DB non fatale — on logue et on reviendra demain
    logger.error({ err }, "Renewal reminder: échec de la requête DB");
    return;
  }

  if (vendors.length === 0) {
    logger.info("Renewal reminder: aucune boutique à relancer aujourd'hui");
    return;
  }

  logger.info({ count: vendors.length }, "Renewal reminder: envoi des rappels");

  // ── Envoi WhatsApp pour chaque vendeur ────────────────────────────────────
  for (const vendor of vendors) {
    try {
      // sendRenewalReminderTemplate envoie le template Meta avec :
      //   - {{1}} dans le corps = prénom du vendeur
      //   - Bouton CTA → https://togomarket.site/api/vendors/renewal-link/<id>
      await sendRenewalReminderTemplate(vendor.phone, vendor.firstName, vendor.id);

      logger.info(
        { vendorId: vendor.id, phone: vendor.phone, expiryDate: vendor.expiryDate },
        "Renewal reminder: rappel envoyé avec succès"
      );
    } catch (err) {
      // Erreur WhatsApp non fatale : on continue avec les autres vendeurs
      // Causes possibles : template pas encore approuvé, numéro invalide, timeout API
      logger.error(
        { err, vendorId: vendor.id, phone: vendor.phone },
        "Renewal reminder: échec d'envoi WhatsApp (non fatal, le suivant sera traité)"
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Démarrage du cron quotidien
// ─────────────────────────────────────────────────────────────────────────────
export function startRenewalReminderCron(): void {
  const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 heures en millisecondes
  const STARTUP_DELAY_MS = 60_000;           // 60 secondes après le démarrage du serveur

  logger.info(
    { intervalHours: 24, startupDelaySeconds: 60 },
    "Renewal reminder cron: démarrage programmé"
  );

  // Première vérification 60 secondes après le démarrage
  // (laisse le temps à Express et à la DB de s'initialiser)
  const startupTimer = setTimeout(() => {
    logger.info("Renewal reminder: première vérification au démarrage");
    void checkAndSendRenewalReminders();
  }, STARTUP_DELAY_MS);

  // .unref() : ce timer ne maintient pas le processus Node.js en vie
  // si toutes les autres connexions sont fermées (arrêt propre)
  startupTimer.unref();

  // Vérification toutes les 24 heures
  const dailyTimer = setInterval(() => {
    logger.info("Renewal reminder: vérification quotidienne déclenchée");
    void checkAndSendRenewalReminders();
  }, INTERVAL_MS);

  dailyTimer.unref();
}
