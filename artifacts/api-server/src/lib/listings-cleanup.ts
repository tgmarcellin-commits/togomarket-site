import { lt, and, eq, ne, sql } from "drizzle-orm";
import {
  adsTable,
  db,
  eventsTable,
  listingsTable,
  messagesTable,
  servicesTable,
  vendorsTable,
} from "@workspace/db";
import { normalizeObjectStoragePath, ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";

const objectStorage = new ObjectStorageService();

function storagePath(mediaPath: string): string {
  return normalizeObjectStoragePath(mediaPath) ?? mediaPath;
}

async function deleteOnlyUnreferencedMedia(mediaPaths: string[]): Promise<void> {
  const [listings, ads, vendors, messages, services, events] = await Promise.all([
    db.select({ images: listingsTable.images }).from(listingsTable),
    db.select({ image: adsTable.image, videoPath: adsTable.videoPath }).from(adsTable),
    db.select({ profilePhoto: vendorsTable.profilePhoto }).from(vendorsTable),
    db.select({ fileUrl: messagesTable.fileUrl }).from(messagesTable),
    db.select({ image: servicesTable.image, videoPath: servicesTable.videoPath }).from(servicesTable),
    db.select({ flyerImage: eventsTable.flyerImage, videoPath: eventsTable.videoPath }).from(eventsTable),
  ]);
  const referenced = new Set(
    [
      ...listings.flatMap((listing) => listing.images ?? []),
      ...ads.flatMap((ad) => [ad.image, ad.videoPath]),
      ...vendors.map((vendor) => vendor.profilePhoto),
      ...messages.map((message) => message.fileUrl),
      ...services.flatMap((service) => [service.image, service.videoPath]),
      ...events.flatMap((event) => [event.flyerImage, event.videoPath]),
    ]
      .filter((path): path is string => Boolean(path))
      .map(storagePath),
  );
  const unreferenced = Array.from(new Set(mediaPaths.map(storagePath)))
    .filter((path) => !referenced.has(path));
  await objectStorage.deleteObjectEntities(unreferenced);
}

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

    const expiredMedia = expired.flatMap((listing) => listing.images ?? []);
    await deleteOnlyUnreferencedMedia(expiredMedia).catch((err) => {
      logger.warn({ err }, "Listings cleanup: échec suppression médias non référencés");
    });

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
