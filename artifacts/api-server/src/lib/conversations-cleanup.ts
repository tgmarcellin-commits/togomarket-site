import { and, eq, lt, ne } from "drizzle-orm";
import {
  conversationsTable,
  db,
  messagesTable,
} from "@workspace/db";
import { logger } from "./logger";
import { deleteCloudinaryMedia, parseCloudinaryMediaUrl } from "./cloudinary-media";

const BROADCAST_BUYER_PHONE = "##007##";
const STORAGE_DELETE_BATCH_SIZE = 100;

async function deleteUnreferencedAttachments(currentCleanupPaths: string[]): Promise<{
  deletedCount: number;
  failedCount: number;
  referencedCount: number;
}> {
  const candidates = Array.from(new Set(currentCleanupPaths))
    .filter((path) => parseCloudinaryMediaUrl(path)?.deliveryType === "authenticated");
  if (candidates.length === 0) return { deletedCount: 0, failedCount: 0, referencedCount: 0 };
  const messages = await db.select({ fileUrl: messagesTable.fileUrl }).from(messagesTable);
  const referencedPaths = new Set(messages.map((message) => message.fileUrl));
  const deletable = candidates.filter((path) => !referencedPaths.has(path));
  let deletedCount = 0;
  let failedCount = 0;

  for (let offset = 0; offset < deletable.length; offset += STORAGE_DELETE_BATCH_SIZE) {
    const batch = deletable.slice(offset, offset + STORAGE_DELETE_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(deleteCloudinaryMedia));
    deletedCount += results.filter((result) => result.status === "fulfilled").length;
    failedCount += results.filter((result) => result.status === "rejected").length;
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
          const fileUrls = removedMessages
            .map(({ fileUrl }) => fileUrl)
            .filter((fileUrl): fileUrl is string => Boolean(fileUrl));

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

    const storageCleanup = await deleteUnreferencedAttachments([...attachmentPaths]);
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
