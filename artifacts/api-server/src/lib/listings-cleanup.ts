import { lt, and, eq, ne, sql } from "drizzle-orm";
import { db, listingsTable } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";

const objectStorage = new ObjectStorageService();

/**
 * Supprime les annonces approuvées publiées depuis plus de 60 jours.
 * Exception : les catalogues Tourisme ne sont JAMAIS supprimés automatiquement —
 * ils restent visibles tant que le vendeur ou l'administrateur ne les efface pas.
 * Appelé au démarrage (après 60s) puis toutes les 24h.
 */
export async function runListingsCleanup(): Promise<void> {
  try {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    const expired = await db
      .delete(listingsTable)
      .where(
        and(
          eq(listingsTable.approved, true),
          lt(listingsTable.createdAt, sixtyDaysAgo),
          ne(listingsTable.sector, "Tourisme"),
        )
      )
      .returning({ id: listingsTable.id, images: listingsTable.images });

    if (expired.length === 0) {
      logger.info("Listings cleanup: aucune annonce expirée");
      return;
    }

    // Supprimer les images associées dans l'object storage
    for (const listing of expired) {
      if (listing.images && listing.images.length > 0) {
        await objectStorage.deleteObjectEntities(listing.images).catch((err) => {
          logger.warn({ err, id: listing.id }, "Listings cleanup: échec suppression images");
        });
      }
    }

    logger.info({ count: expired.length }, "Listings cleanup: annonces supprimées après 60 jours");
  } catch (err) {
    logger.error({ err }, "Listings cleanup: erreur inattendue");
  }
}

/**
 * Démarre le cron quotidien de nettoyage des annonces.
 * Première exécution après 60 secondes, puis toutes les 24 heures.
 */
export function startListingsCleanupCron(): void {
  const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
  const STARTUP_DELAY_MS = 60 * 1000;       // 60s

  setTimeout(async () => {
    logger.info("Listings cleanup: première vérification au démarrage");
    await runListingsCleanup();
    setInterval(runListingsCleanup, INTERVAL_MS);
  }, STARTUP_DELAY_MS);

  logger.info(
    { intervalHours: 24, startupDelaySeconds: 60 },
    "Listings cleanup cron: démarrage programmé"
  );
}
