import { and, eq, lt, ne } from "drizzle-orm";
import {
  adsTable,
  conversationsTable,
  db,
  eventsTable,
  listingsTable,
  messagesTable,
  servicesTable,
  vendorsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { ObjectStorageService } from "./objectStorage";
import { collectReferencedObjectPaths } from "./storageCleanup";

const objectStorage = new ObjectStorageService();
const BROADCAST_BUYER_PHONE = "##007##";
const STORAGE_DELETE_BATCH_SIZE = 100;

function normalizeObjectPath(fileUrl: string | null): string | null {
  const normalized = fileUrl?.startsWith("v:") ? fileUrl.slice(2) : fileUrl;
  return normalized?.startsWith("/objects/") ? normalized : null;
}

async function deleteUnreferencedAttachments(
  currentCleanupPaths: string[],
  cutoff: Date,
): Promise<{
  deletedCount: number;
  failedCount: number;
  referencedCount: number;
}> {
  const [staleObjectPaths, listings, ads, vendors, messages, services, events] =
    await Promise.all([
      objectStorage.listConversationCleanupCandidatePathsOlderThan(cutoff),
      db.select({ images: listingsTable.images }).from(listingsTable),
      db
        .select({ image: adsTable.image, videoPath: adsTable.videoPath })
        .from(adsTable),
      db.select({ profilePhoto: vendorsTable.profilePhoto }).from(vendorsTable),
      db.select({ fileUrl: messagesTable.fileUrl }).from(messagesTable),
      db
        .select({ image: servicesTable.image, videoPath: servicesTable.videoPath })
        .from(servicesTable),
      db
        .select({
          flyerImage: eventsTable.flyerImage,
          videoPath: eventsTable.videoPath,
        })
        .from(eventsTable),
    ]);
  const referencedPaths = collectReferencedObjectPaths({
    listings,
    ads,
    vendors,
    messages,
    services,
    events,
  });
  const candidates = Array.from(
    new Set([...currentCleanupPaths, ...staleObjectPaths]),
  );
  const deletable = candidates.filter(
    (objectPath) => !referencedPaths.has(objectPath),
  );
  let deletedCount = 0;
  let failedCount = 0;

  for (let offset = 0; offset < deletable.length; offset += STORAGE_DELETE_BATCH_SIZE) {
    const batch = deletable.slice(offset, offset + STORAGE_DELETE_BATCH_SIZE);
    const { failed } = await objectStorage.deleteObjectEntities(batch);
    failedCount += failed.length;
    deletedCount += batch.length - failed.length;
  }

  return {
    deletedCount,
    failedCount,
    referencedCount: candidates.length - deletable.length,
  };
}

/**
 * Supprime définitivement les conversations dont la dernière activité
 * remonte à plus de 15 jours (updatedAt < now - 15 jours).
 * Appelé au démarrage (après 120s) puis toutes les 24h.
 */
export async function runConversationsCleanup(): Promise<void> {
  try {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);

    const expired = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(
        and(
          lt(conversationsTable.updatedAt, fifteenDaysAgo),
          ne(conversationsTable.buyerPhone, BROADCAST_BUYER_PHONE),
        ),
      );

    if (expired.length === 0) {
      logger.info("Conversations cleanup: aucune conversation expirée");
    }

    let deletedCount = 0;
    let failedCount = 0;
    const attachmentPaths = new Set<string>();

    for (const { id } of expired) {
      try {
        const deletedAttachmentPaths = await db.transaction(async (tx) => {
          // The parent-row lock conflicts with the FK lock required by a new
          // message insert. Once held, the attachment list remains complete
          // until this transaction either commits or rolls back.
          const [lockedConversation] = await tx
            .select({ id: conversationsTable.id })
            .from(conversationsTable)
            .where(
              and(
                eq(conversationsTable.id, id),
                lt(conversationsTable.updatedAt, fifteenDaysAgo),
                ne(conversationsTable.buyerPhone, BROADCAST_BUYER_PHONE),
              ),
            )
            .for("update");

          if (!lockedConversation) return null;

          const removedMessages = await tx
            .delete(messagesTable)
            .where(eq(messagesTable.conversationId, id))
            .returning({ fileUrl: messagesTable.fileUrl });
          const fileUrls = Array.from(
            new Set(
              removedMessages
                .map(({ fileUrl }) => normalizeObjectPath(fileUrl))
                .filter((fileUrl): fileUrl is string => fileUrl !== null),
            ),
          );

          await Promise.all(
            fileUrls.map((fileUrl) =>
              objectStorage.markObjectEntityForConversationCleanup(fileUrl),
            ),
          );

          const [removed] = await tx
            .delete(conversationsTable)
            .where(
              and(
                eq(conversationsTable.id, id),
                lt(conversationsTable.updatedAt, fifteenDaysAgo),
                ne(conversationsTable.buyerPhone, BROADCAST_BUYER_PHONE),
              ),
            )
            .returning({ id: conversationsTable.id });
          if (!removed) {
            throw new Error("Conversation devenue non supprimable sous verrou");
          }
          return fileUrls;
        });

        if (deletedAttachmentPaths) {
          deletedCount += 1;
          for (const path of deletedAttachmentPaths) {
            attachmentPaths.add(path);
          }
        }
      } catch (err) {
        failedCount += 1;
        logger.warn(
          { err, conversationId: id },
          "Conversations cleanup: suppression différée pour être retentée",
        );
      }
    }

    const storageCleanup = await deleteUnreferencedAttachments(
      [...attachmentPaths],
      fifteenDaysAgo,
    );
    if (storageCleanup.failedCount > 0) {
      logger.warn(
        { count: storageCleanup.failedCount },
        "Conversations cleanup: pièces jointes orphelines à retenter",
      );
    }
    if (storageCleanup.referencedCount > 0) {
      logger.info(
        { count: storageCleanup.referencedCount },
        "Conversations cleanup: pièces jointes encore référencées conservées",
      );
    }

    if (deletedCount === 0) {
      logger.info(
        { attachmentsDeleted: storageCleanup.deletedCount },
        "Conversations cleanup: aucune conversation supprimée",
      );
      return;
    }

    logger.info(
      {
        count: deletedCount,
        deferredCount: failedCount,
        attachmentsDeleted: storageCleanup.deletedCount,
        attachmentsStillReferenced: storageCleanup.referencedCount,
      },
      "Conversations cleanup: conversations supprimées après 15 jours d'inactivité",
    );
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
