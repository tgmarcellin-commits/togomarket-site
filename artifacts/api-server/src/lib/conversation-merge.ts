import { eq, inArray, sql } from "drizzle-orm";
import {
  buyerPushSubscriptionsTable,
  conversationBuyerTokensTable,
  conversationsTable,
  db,
  messagesTable,
} from "@workspace/db";

/**
 * Consolidates conversations only after the caller proved possession of every
 * buyer token. Phone/name similarity is deliberately never used as proof.
 */
export async function mergeAuthorizedBuyerConversations(conversationIds: number[]): Promise<void> {
  const requestedIds = [...new Set(conversationIds)].filter(Number.isInteger);
  if (requestedIds.length < 2) return;
  await db.transaction(async (tx) => {
    const candidateVendors = await tx
      .select({ vendorId: conversationsTable.vendorId })
      .from(conversationsTable)
      .where(inArray(conversationsTable.id, requestedIds));
    const vendorIds = [...new Set(candidateVendors.map((row) => row.vendorId))]
      .sort((a, b) => a - b);
    for (const vendorId of vendorIds) {
      await tx.execute(sql`select pg_advisory_xact_lock(${vendorId}, 51)`);
    }

    // Re-read only after all vendor locks are held. Another merge may have
    // removed or aliased one of the originally requested rows while waiting.
    const conversations = await tx
      .select()
      .from(conversationsTable)
      .where(inArray(conversationsTable.id, requestedIds));

    const groups = new Map<number, typeof conversations>();
    for (const conversation of conversations) {
      if (conversation.buyerPhone === "##007##") continue;
      const group = groups.get(conversation.vendorId) ?? [];
      group.push(conversation);
      groups.set(conversation.vendorId, group);
    }

    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const buyerKeys = new Set(
        group.map((conversation) => conversation.buyerKeyHash).filter(Boolean),
      );
      // Never merge two already-established stable identities, even when one
      // browser happens to hold tokens for both.
      if (buyerKeys.size > 1) continue;
      const vendorId = group[0].vendorId;
      const ordered = [...group].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id,
      );
      const canonical = ordered[0];
      const duplicates = ordered.slice(1);
      const duplicateIds = duplicates.map((conversation) => conversation.id);
      const latest = [...group].sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id,
      )[0];
      const selectedBuyerKey = group.find((conversation) => conversation.buyerKeyHash)?.buyerKeyHash ?? null;

      // Free any unique buyer-key owned by a duplicate before assigning it to
      // the canonical thread.
      await tx
        .update(conversationsTable)
        .set({ buyerKeyHash: null })
        .where(inArray(conversationsTable.id, duplicateIds));

      // Messages created before per-message listing snapshots existed can still
      // inherit a trustworthy context here: each source conversation retains
      // the listing it represented until the rows are consolidated. Already
      // consolidated messages stay nullable because their origin is no longer
      // recoverable without guessing.
      for (const sourceConversation of group) {
        await tx
          .update(messagesTable)
          .set({
            listingId: sql`coalesce(${messagesTable.listingId}, ${sourceConversation.listingId})`,
            listingTitle: sql`coalesce(${messagesTable.listingTitle}, ${sourceConversation.listingTitle})`,
            listingImage: sql`coalesce(${messagesTable.listingImage}, ${sourceConversation.listingImage})`,
          })
          .where(eq(messagesTable.conversationId, sourceConversation.id));
      }

      await tx
        .update(messagesTable)
        .set({ conversationId: canonical.id })
        .where(inArray(messagesTable.conversationId, duplicateIds));

      const duplicateSubscriptions = await tx
        .select()
        .from(buyerPushSubscriptionsTable)
        .where(inArray(buyerPushSubscriptionsTable.conversationId, duplicateIds));
      if (duplicateSubscriptions.length > 0) {
        await tx
          .insert(buyerPushSubscriptionsTable)
          .values(duplicateSubscriptions.map((subscription) => ({
            conversationId: canonical.id,
            endpoint: subscription.endpoint,
            keys: subscription.keys,
          })))
          .onConflictDoNothing();
        await tx
          .delete(buyerPushSubscriptionsTable)
          .where(inArray(buyerPushSubscriptionsTable.conversationId, duplicateIds));
      }

      await tx
        .update(conversationBuyerTokensTable)
        .set({ conversationId: canonical.id })
        .where(inArray(conversationBuyerTokensTable.conversationId, duplicateIds));

      await tx
        .insert(conversationBuyerTokensTable)
        .values(duplicates.map((conversation) => ({
          conversationId: canonical.id,
          token: conversation.buyerToken,
          legacyConversationId: conversation.id,
        })))
        .onConflictDoNothing();

      await tx
        .update(conversationsTable)
        .set({
          buyerKeyHash: selectedBuyerKey,
          buyerName: latest.buyerName,
          buyerPhone: latest.buyerPhone,
          listingTitle: latest.listingTitle,
          listingId: latest.listingId,
          listingImage: latest.listingImage,
          createdAt: canonical.createdAt,
          updatedAt: latest.updatedAt,
          vendorUnreadCount: group.reduce((sum, conversation) => sum + conversation.vendorUnreadCount, 0),
          buyerUnreadCount: group.reduce((sum, conversation) => sum + conversation.buyerUnreadCount, 0),
          adminUnreadCount: group.reduce((sum, conversation) => sum + conversation.adminUnreadCount, 0),
          vendorDeletedAt: group.some((conversation) => conversation.vendorDeletedAt === null)
            ? null
            : latest.vendorDeletedAt,
          buyerDeletedAt: group.some((conversation) => conversation.buyerDeletedAt === null)
            ? null
            : latest.buyerDeletedAt,
        })
        .where(eq(conversationsTable.id, canonical.id));

      await tx
        .delete(conversationsTable)
        .where(inArray(conversationsTable.id, duplicateIds));
    }
  });
}