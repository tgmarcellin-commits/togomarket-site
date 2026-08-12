import { lt } from "drizzle-orm";
import { db, conversationsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Supprime définitivement les conversations dont la dernière activité
 * remonte à plus de 15 jours (updatedAt < now - 15 jours).
 * Appelé au démarrage (après 120s) puis toutes les 24h.
 */
export async function runConversationsCleanup(): Promise<void> {
  try {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);

    const deleted = await db
      .delete(conversationsTable)
      .where(lt(conversationsTable.updatedAt, fifteenDaysAgo))
      .returning({ id: conversationsTable.id });

    if (deleted.length === 0) {
      logger.info("Conversations cleanup: aucune conversation expirée");
      return;
    }

    logger.info({ count: deleted.length }, "Conversations cleanup: conversations supprimées après 15 jours d'inactivité");
  } catch (err) {
    logger.error({ err }, "Conversations cleanup: erreur inattendue");
  }
}

/**
 * Démarre le cron quotidien de nettoyage des conversations inactives.
 * Première exécution après 120 secondes, puis toutes les 24 heures.
 */
export function startConversationsCleanupCron(): void {
  const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
  const STARTUP_DELAY_MS = 120 * 1000;      // 120s

  setTimeout(async () => {
    logger.info("Conversations cleanup: première vérification au démarrage");
    await runConversationsCleanup();
    setInterval(runConversationsCleanup, INTERVAL_MS);
  }, STARTUP_DELAY_MS);

  logger.info(
    { intervalHours: 24, startupDelaySeconds: 120 },
    "Conversations cleanup cron: démarrage programmé"
  );
}
