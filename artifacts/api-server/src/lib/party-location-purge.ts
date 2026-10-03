import { logger } from "./logger";
import { purgeExpiredPartyLocations } from "./party-locations";

const PURGE_INTERVAL_MS = 60 * 60 * 1000; // toutes les heures

async function runPurge(): Promise<void> {
  try {
    const result = await purgeExpiredPartyLocations();
    if (result.positionsDeleted > 0 || result.qrCoordinatesCleared > 0) {
      logger.info(result, "Purge RGPD : positions acheteur/vendeur de plus de 24 h supprimées");
    }
  } catch (err) {
    logger.error({ err }, "Purge des positions acheteur/vendeur impossible");
  }
}

/** Supprime toutes les heures les positions de l'acheteur et du vendeur de plus de 24 h. */
export function startPartyLocationPurgeCron(): void {
  void runPurge(); // rattrape immédiatement ce qui est expiré au démarrage
  setInterval(() => { void runPurge(); }, PURGE_INTERVAL_MS).unref();
}
