import { Router, type IRouter, type Request } from "express";
import { eq, desc, and, isNull, or, inArray, gt, lt, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  conversationsTable,
  messagesTable,
  vendorsTable,
  listingsTable,
  pushSubscriptionsTable,
  buyerPushSubscriptionsTable,
  vendorNotificationsTable,
} from "@workspace/db";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { emitToAdmin, getIo } from "../lib/socket-io";
import { webpush, vapidReady } from "../lib/webpush";
import { normalizePhone, phoneEq } from "../lib/phone";
import { sendWhatsAppNotifNudge, canSendNudge, markNudgeSent } from "../lib/whatsapp-api";
import { logger } from "../lib/logger";
import { ObjectStorageService } from "../lib/objectStorage";
import { validateFileBytes } from "../lib/file-security";
import { secureMessageFileUrl, verifyMessageFileAccess } from "../lib/message-file-access";
import { authenticateVendorRequest } from "../lib/vendor-auth";
import {
  findConversationsForBuyerTokens,
  hashBuyerKey,
  isValidBuyerKey,
  resolveBuyerConversationId,
  resolveVendorConversationId,
  findInvalidBuyerTokens,
} from "../lib/conversation-access";
import { mergeAuthorizedBuyerConversations } from "../lib/conversation-merge";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 2 },
});
const objectStorage = new ObjectStorageService();

const router: IRouter = Router();

function isExpiredPushError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const statusCode = (err as { statusCode?: unknown }).statusCode;
  return statusCode === 404 || statusCode === 410;
}

async function notifyVendorWithoutPush(
  vendorId: number,
  vendor: { firstName: string; phone: string },
  buyerName: string,
): Promise<void> {
  const now = new Date();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const created = await db.transaction(async (tx) => {
    const [claimed] = await tx.update(vendorsTable)
      .set({ lastPushNudgeAt: now })
      .where(and(
        eq(vendorsTable.id, vendorId),
        or(isNull(vendorsTable.lastPushNudgeAt), lt(vendorsTable.lastPushNudgeAt, since)),
      ))
      .returning({ id: vendorsTable.id });
    if (!claimed) return null;
    const title = `💬 Nouveau message de ${buyerName}`;
    const body = `Vous avez reçu un message mais vos notifications sont désactivées. Activez-les dans l'onglet Messages pour ne plus rien manquer.`;
    const [notification] = await tx.insert(vendorNotificationsTable).values({
      vendorId,
      title,
      body,
      url: null,
      notifType: "push_nudge",
    }).returning({ id: vendorNotificationsTable.id });
    return { ...notification, title, body };
  });

  if (created) {
    try {
      getIo().to(`vendor:${vendorId}`).emit("vendor_system_notification", {
        notificationId: created.id,
        notifType: "push_nudge",
        title: created.title,
        body: created.body,
      });
    } catch { /* persisted notification is still available after reconnect */ }

    if (canSendNudge(vendorId)) {
      markNudgeSent(vendorId);
      sendWhatsAppNotifNudge(vendor.phone, vendor.firstName, buyerName)
        .catch((err) => logger.warn({ err, vendorId }, "WhatsApp notif nudge failed"));
    }
  }
}

function firstValidListingImage(images: string[]): string | null {
  return images.find(
    (image) =>
      !image.startsWith("data:") &&
      !image.startsWith("v:") &&
      !/\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(image),
  ) ?? null;
}

type ConversationImageContext = {
  vendorId: number;
  listingId: number | null;
  listingImage: string | null;
};

/**
 * Older conversations predate listingImage. Resolve their thumbnail at read
 * time from the linked, vendor-owned listing while preserving saved snapshots.
 */
async function addListingImageFallback<T extends ConversationImageContext>(
  conversations: T[],
): Promise<Array<T & { listingImage: string | null }>> {
  const missingImageConversations = conversations.filter(
    (conversation) => !conversation.listingImage?.trim() && conversation.listingId,
  );
  if (missingImageConversations.length === 0) {
    return conversations.map((conversation) => ({
      ...conversation,
      listingImage: conversation.listingImage?.trim() || null,
    }));
  }

  const listingIds = [...new Set(
    missingImageConversations
      .map((conversation) => conversation.listingId)
      .filter((id): id is number => id !== null),
  )];
  const vendorIds = [...new Set(missingImageConversations.map((conversation) => conversation.vendorId))];

  const [listingRows, vendorRows] = await Promise.all([
    db
      .select({ id: listingsTable.id, phone: listingsTable.phone, images: listingsTable.images })
      .from(listingsTable)
      .where(inArray(listingsTable.id, listingIds)),
    db
      .select({ id: vendorsTable.id, phone: vendorsTable.phone })
      .from(vendorsTable)
      .where(inArray(vendorsTable.id, vendorIds)),
  ]);

  const vendorPhones = new Map(vendorRows.map((vendor) => [vendor.id, normalizePhone(vendor.phone)]));
  const listingImages = new Map(
    listingRows.map((listing) => [listing.id, {
      vendorPhone: normalizePhone(listing.phone),
      image: firstValidListingImage(listing.images),
    }]),
  );

  return conversations.map((conversation) => {
    const savedImage = conversation.listingImage?.trim();
    if (savedImage || !conversation.listingId) {
      return { ...conversation, listingImage: savedImage || null };
    }

    const listing = listingImages.get(conversation.listingId);
    const vendorPhone = vendorPhones.get(conversation.vendorId);
    const fallbackImage =
      listing && vendorPhone === listing.vendorPhone
        ? listing.image
        : null;
    return { ...conversation, listingImage: fallbackImage };
  });
}

/* ──────────────────────────────────────────────────────────────
   Helper: authenticate vendor by phone + password
   Uses phoneEq() only inside Drizzle .where() — never as a JS boolean.
   ────────────────────────────────────────────────────────────── */
/* ──────────────────────────────────────────────────────────────
   POST /api/conversations
   Body: { vendorId, buyerName, buyerPhone, buyerKey, resumeBuyerToken?, listingTitle?, listingId? }
   Returns: conversation + buyerToken (store in client, required for reads/sends)
   ────────────────────────────────────────────────────────────── */
router.post("/conversations", async (req, res) => {
  const { vendorId, buyerName, buyerPhone, buyerKey, resumeBuyerToken, knownBuyerTokens, conversationId, listingTitle, listingId } = req.body as {
    vendorId: number;
    buyerName: string;
    buyerPhone: string;
    buyerKey?: string;
    resumeBuyerToken?: string;
    knownBuyerTokens?: string[];
    conversationId?: number;
    listingTitle?: string;
    listingId?: number;
  };

  const vendorBuyer = await authenticateVendorRequest(req);
  const resolvedBuyerName = vendorBuyer
    ? `${vendorBuyer.firstName} ${vendorBuyer.lastName}`.trim()
    : buyerName?.trim();
  const resolvedBuyerPhone = vendorBuyer?.phone ?? buyerPhone?.trim();
  if (!vendorId || !resolvedBuyerName || !resolvedBuyerPhone) {
    res.status(400).json({ error: "vendorId and buyer identity required" });
    return;
  }
  if (vendorBuyer?.id === Number(vendorId)) {
    res.status(400).json({ error: "cannot_contact_own_shop" });
    return;
  }
  if (!vendorBuyer && !isValidBuyerKey(buyerKey)) {
    res.status(400).json({ error: "buyerKey required" });
    return;
  }

  // Validate vendor exists
  const vendorRows = await db
    .select({ id: vendorsTable.id, phone: vendorsTable.phone })
    .from(vendorsTable)
    .where(eq(vendorsTable.id, Number(vendorId)))
    .limit(1);
  if (!vendorRows.length) {
    res.status(404).json({ error: "vendor not found" });
    return;
  }

  const parsedListingId = Number(listingId);
  let resolvedListingTitle = listingTitle?.trim() ?? null;
  let listingImage: string | null = null;

  // The listing context comes from the server-owned listing record rather than
  // a client supplied URL. This ensures the displayed image belongs to this vendor.
  if (Number.isInteger(parsedListingId) && parsedListingId > 0) {
    const listingRows = await db
      .select({ name: listingsTable.name, images: listingsTable.images })
      .from(listingsTable)
      .where(and(
        eq(listingsTable.id, parsedListingId),
        phoneEq(listingsTable.phone, vendorRows[0].phone),
      ))
      .limit(1);
    const listing = listingRows[0];
    if (listing) {
      resolvedListingTitle = listing.name;
      listingImage = firstValidListingImage(listing.images);
    }
  }

  const buyerKeyHash = hashBuyerKey(
    vendorBuyer ? `vendor-account:${vendorBuyer.id}` : `guest:${buyerKey}`,
  );
  const buyerToken = randomUUID();
  let existingByKey = await db
    .select()
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.vendorId, Number(vendorId)),
      eq(conversationsTable.buyerKeyHash, buyerKeyHash),
    ))
    .limit(1);

  const proofTokens = [...new Set([
    ...(Array.isArray(knownBuyerTokens) ? knownBuyerTokens : []),
    ...(resumeBuyerToken ? [resumeBuyerToken] : []),
  ].filter((token): token is string => typeof token === "string" && token.length > 0))].slice(0, 100);
  const authorizedRows = await findConversationsForBuyerTokens(proofTokens);
  const authorizedIds = authorizedRows
    .filter((row) => row.conversation.vendorId === Number(vendorId))
    .map((row) => row.conversation.id);
  if (existingByKey[0]) authorizedIds.push(existingByKey[0].id);
  await mergeAuthorizedBuyerConversations(authorizedIds);
  existingByKey = await db
    .select()
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.vendorId, Number(vendorId)),
      eq(conversationsTable.buyerKeyHash, buyerKeyHash),
    ))
    .limit(1);

  let existing = existingByKey[0];
  if (!existing && resumeBuyerToken) {
    const requestedConversationId = Number(conversationId);
    if (Number.isInteger(requestedConversationId) && requestedConversationId > 0) {
      const canonicalId = await resolveBuyerConversationId(requestedConversationId, resumeBuyerToken);
      if (canonicalId) {
        const [candidate] = await db
          .select()
          .from(conversationsTable)
          .where(and(
            eq(conversationsTable.id, canonicalId),
            eq(conversationsTable.vendorId, Number(vendorId)),
          ))
          .limit(1);
        existing = candidate;
      }
    }
  }

  if (existing) {
    const [updated] = await db
      .update(conversationsTable)
      .set({
        buyerKeyHash,
        buyerName: resolvedBuyerName,
        buyerPhone: resolvedBuyerPhone,
        listingTitle: resolvedListingTitle,
        listingId: Number.isInteger(parsedListingId) && parsedListingId > 0 ? parsedListingId : null,
        listingImage,
        buyerDeletedAt: null,
      })
      .where(eq(conversationsTable.id, existing.id))
      .returning();
    res.json(updated);
    return;
  }

  const [conv] = await db
    .insert(conversationsTable)
    .values({
      vendorId: Number(vendorId),
      buyerName: resolvedBuyerName,
      buyerPhone: resolvedBuyerPhone,
      buyerKeyHash,
      listingTitle: resolvedListingTitle,
      listingId: Number.isInteger(parsedListingId) && parsedListingId > 0 ? parsedListingId : null,
      listingImage,
      buyerToken,
    })
    .onConflictDoUpdate({
      target: [conversationsTable.vendorId, conversationsTable.buyerKeyHash],
      set: {
        buyerName: resolvedBuyerName,
        buyerPhone: resolvedBuyerPhone,
        listingTitle: resolvedListingTitle,
        listingId: Number.isInteger(parsedListingId) && parsedListingId > 0 ? parsedListingId : null,
        listingImage,
        buyerDeletedAt: null,
      },
    })
    .returning();

  res.status(conv.buyerToken === buyerToken ? 201 : 200).json(conv);
});

/* ──────────────────────────────────────────────────────────────
   POST /api/conversations/buyer-list
   Body: { buyerTokens: string[] }
   Returns conversations for all supplied tokens (without exposing other
   buyers' data — each token is validated against its own conversation row).
   ────────────────────────────────────────────────────────────── */
router.post("/conversations/buyer-list", async (req, res) => {
  const { buyerTokens } = req.body as { buyerTokens?: string[] };
  if (!Array.isArray(buyerTokens) || buyerTokens.length === 0) {
    res.json({ conversations: [], invalidTokens: [] });
    return;
  }

  // Cap at 100 tokens to prevent abuse
  const tokens = [...new Set(
    buyerTokens.filter((token): token is string => typeof token === "string" && token.length > 0),
  )].slice(0, 100);
  let authorizedRows = await findConversationsForBuyerTokens(tokens);
  const idsByVendor = new Map<number, number[]>();
  for (const row of authorizedRows) {
    const ids = idsByVendor.get(row.conversation.vendorId) ?? [];
    ids.push(row.conversation.id);
    idsByVendor.set(row.conversation.vendorId, ids);
  }
  await Promise.all([...idsByVendor.values()].map(mergeAuthorizedBuyerConversations));
  authorizedRows = await findConversationsForBuyerTokens(tokens);
  const invalidTokens = await findInvalidBuyerTokens(tokens);
  const convRows = authorizedRows
    .filter((row) => row.conversation.buyerDeletedAt === null)
    .sort((a, b) => b.conversation.updatedAt.getTime() - a.conversation.updatedAt.getTime());

  if (convRows.length === 0) {
    res.json({ conversations: [], invalidTokens });
    return;
  }

  const conversationIds = convRows.map(({ conversation }) => conversation.id);
  const [lastMessages, unreadRows] = await Promise.all([
    db
      .selectDistinctOn([messagesTable.conversationId], {
        conversationId: messagesTable.conversationId,
        content: messagesTable.content,
        createdAt: messagesTable.createdAt,
      })
      .from(messagesTable)
      .where(and(
        inArray(messagesTable.conversationId, conversationIds),
        isNull(messagesTable.deletedAt),
        isNull(messagesTable.buyerDeletedAt),
      ))
      .orderBy(messagesTable.conversationId, desc(messagesTable.createdAt)),
    db
      .select({
        conversationId: messagesTable.conversationId,
        count: sql<number>`count(*)::int`,
      })
      .from(messagesTable)
      .where(and(
        inArray(messagesTable.conversationId, conversationIds),
        eq(messagesTable.senderType, "vendor"),
        isNull(messagesTable.readAt),
        isNull(messagesTable.deletedAt),
        isNull(messagesTable.buyerDeletedAt),
      ))
      .groupBy(messagesTable.conversationId),
  ]);

  const lastMessageByConversation = new Map(
    lastMessages.map((message) => [message.conversationId, message]),
  );
  const unreadByConversation = new Map(
    unreadRows.map((row) => [row.conversationId, row.count]),
  );

  const result = convRows.map(({ conversation: conv, accessToken }) => {
    const last = lastMessageByConversation.get(conv.id);
    return {
      id: conv.id,
      vendorId: conv.vendorId,
      listingTitle: conv.listingTitle,
      listingId: conv.listingId,
      listingImage: conv.listingImage,
      buyerName: conv.buyerName,
      buyerPhone: conv.buyerPhone,
      buyerToken: accessToken,
      lastMessage: last?.content ?? null,
      lastMessageAt: last?.createdAt ?? conv.updatedAt,
      buyerUnreadCount: unreadByConversation.get(conv.id) ?? 0,
    };
  });

  res.json({
    conversations: await addListingImageFallback(result),
    invalidTokens,
  });
});

/* ──────────────────────────────────────────────────────────────
   GET /api/conversations/:id
   Auth: x-buyer-token OR (x-vendor-phone + x-vendor-password)
   Used by clients to avoid opening a conversation that was deleted.
   ────────────────────────────────────────────────────────────── */
router.get("/conversations/:id", async (req, res) => {
  const requestedConvId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(requestedConvId)) { res.status(400).json({ error: "invalid id" }); return; }

  const identity = await resolveIdentity(req as Parameters<typeof resolveIdentity>[0], requestedConvId);
  if (!identity) {
    const suppliedCredentials =
      Boolean(req.headers["x-buyer-token"]) ||
      Boolean(req.headers["x-vendor-phone"] && req.headers["x-vendor-password"]);
    res.status(suppliedCredentials ? 404 : 401).json({
      error: suppliedCredentials ? "conversation not found" : "unauthorized",
    });
    return;
  }
  const convId = identity.conversationId;

  const convRows = await db
    .select({
      buyerDeletedAt: conversationsTable.buyerDeletedAt,
      vendorDeletedAt: conversationsTable.vendorDeletedAt,
    })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, convId))
    .limit(1);
  const conv = convRows[0];
  const hiddenForViewer =
    !conv ||
    (identity.role === "buyer" && conv.buyerDeletedAt !== null) ||
    (identity.role === "vendor" && conv.vendorDeletedAt !== null);
  if (hiddenForViewer) { res.status(404).json({ error: "conversation not found" }); return; }

  res.json({ id: convId });
});

/* ──────────────────────────────────────────────────────────────
   POST /api/conversations/:id/buyer-read
   Marque toutes les réponses vendeur comme lues (reset buyerUnreadCount).
   Auth: x-buyer-token
   ────────────────────────────────────────────────────────────── */
router.post("/conversations/:id/buyer-read", async (req, res) => {
  const requestedConvId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(requestedConvId)) { res.status(400).json({ error: "invalid id" }); return; }

  const buyerToken = req.headers["x-buyer-token"] as string | undefined;
  if (!buyerToken) { res.status(401).json({ error: "x-buyer-token required" }); return; }
  const convId = await resolveBuyerConversationId(requestedConvId, buyerToken);
  if (!convId) { res.status(401).json({ error: "unauthorized" }); return; }

  await db
    .update(conversationsTable)
    .set({ buyerUnreadCount: 0 })
    .where(eq(conversationsTable.id, convId));

  res.json({ ok: true });
});

/* ──────────────────────────────────────────────────────────────
   Helper: resolve caller identity from request headers.
   Returns { role: "vendor", vendor } | { role: "buyer", conv } | null
   ────────────────────────────────────────────────────────────── */
async function resolveIdentity(
  req: { headers: Record<string, string | string[] | undefined> },
  convId: number,
): Promise<
  | { role: "buyer"; conversationId: number }
  | { role: "vendor"; vendorId: number; conversationId: number }
  | null
> {
  const vendorPhone = req.headers["x-vendor-phone"] as string | undefined;
  const vendorPassword = req.headers["x-vendor-password"] as string | undefined;
  const buyerToken = req.headers["x-buyer-token"] as string | undefined;

  if (buyerToken) {
    const canonicalId = await resolveBuyerConversationId(convId, buyerToken);
    if (!canonicalId) return null;
    return { role: "buyer", conversationId: canonicalId };
  }

  {
    const v = await authenticateVendorRequest(req as Request, { phone: vendorPhone, password: vendorPassword });
    if (v) {
      const canonicalId = await resolveVendorConversationId(convId, v.id);
      if (!canonicalId) return null;
      return { role: "vendor", vendorId: v.id, conversationId: canonicalId };
    }
  }

  return null;
}

/* ──────────────────────────────────────────────────────────────
   GET /api/conversations/:id/messages
   Auth: x-buyer-token OR (x-vendor-phone + x-vendor-password)
   ────────────────────────────────────────────────────────────── */
router.get("/conversations/:id/messages", async (req, res) => {
  const requestedConvId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(requestedConvId)) { res.status(400).json({ error: "invalid id" }); return; }

  const identity = await resolveIdentity(req as Parameters<typeof resolveIdentity>[0], requestedConvId);
  if (!identity) {
    const suppliedCredentials =
      Boolean(req.headers["x-buyer-token"]) ||
      Boolean(req.headers["x-vendor-phone"] && req.headers["x-vendor-password"]);
    res.status(suppliedCredentials ? 404 : 401).json({
      error: suppliedCredentials ? "conversation not found" : "unauthorized",
    });
    return;
  }
  const convId = identity.conversationId;

  const convRows = await db
    .select({
      buyerDeletedAt: conversationsTable.buyerDeletedAt,
      vendorDeletedAt: conversationsTable.vendorDeletedAt,
    })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, convId))
    .limit(1);
  const conv = convRows[0];
  const hiddenForViewer =
    !conv ||
    (identity.role === "buyer" && conv.buyerDeletedAt !== null) ||
    (identity.role === "vendor" && conv.vendorDeletedAt !== null);
  if (hiddenForViewer) { res.status(404).json({ error: "conversation not found" }); return; }

  // Filter out messages deleted for the requesting party
  const deletedFilter = identity.role === "vendor"
    ? isNull(messagesTable.vendorDeletedAt)
    : isNull(messagesTable.buyerDeletedAt);

  const msgs = await db
    .select()
    .from(messagesTable)
    .where(and(
      eq(messagesTable.conversationId, convId),
      isNull(messagesTable.deletedAt),
      deletedFilter,
    ))
    .orderBy(messagesTable.createdAt);

  res.json(msgs.map(secureMessageFileUrl));
});

/* ──────────────────────────────────────────────────────────────
   PATCH /api/conversations/:id/read-messages
   Marque comme lus les messages envoyés par l'autre participant.
   Auth: x-buyer-token OR (x-vendor-phone + x-vendor-password)
   ────────────────────────────────────────────────────────────── */
router.patch("/conversations/:id/read-messages", async (req, res) => {
  const requestedConvId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(requestedConvId)) { res.status(400).json({ error: "invalid id" }); return; }

  const identity = await resolveIdentity(req as Parameters<typeof resolveIdentity>[0], requestedConvId);
  if (!identity) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const convId = identity.conversationId;

  const convRows = await db
    .select({
      vendorId: conversationsTable.vendorId,
      buyerDeletedAt: conversationsTable.buyerDeletedAt,
      vendorDeletedAt: conversationsTable.vendorDeletedAt,
    })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, convId))
    .limit(1);
  const conv = convRows[0];
  const hiddenForViewer =
    !conv ||
    (identity.role === "buyer" && conv.buyerDeletedAt !== null) ||
    (identity.role === "vendor" && conv.vendorDeletedAt !== null);
  if (hiddenForViewer) {
    res.status(404).json({ error: "conversation not found" });
    return;
  }

  const readAt = new Date();
  const otherSenderType = identity.role === "buyer" ? "vendor" : "buyer";
  const viewerDeletedFilter = identity.role === "buyer"
    ? isNull(messagesTable.buyerDeletedAt)
    : isNull(messagesTable.vendorDeletedAt);
  const readMessages = await db
    .update(messagesTable)
    .set({ readAt })
    .where(and(
      eq(messagesTable.conversationId, convId),
      eq(messagesTable.senderType, otherSenderType),
      isNull(messagesTable.readAt),
      isNull(messagesTable.deletedAt),
      viewerDeletedFilter,
    ))
    .returning({ id: messagesTable.id });
  const messageIds = readMessages.map((message) => message.id);

  await db
    .update(conversationsTable)
    .set(identity.role === "buyer" ? { buyerUnreadCount: 0 } : { vendorUnreadCount: 0 })
    .where(eq(conversationsTable.id, convId));

  if (messageIds.length > 0) {
    try {
      const io = getIo();
      const payload = { conversationId: convId, messageIds, readAt: readAt.toISOString() };
      io.to(`vendor:${conv.vendorId}`).emit("messages_read", payload);
      io.to(`conv:${convId}`).emit("messages_read", payload);
    } catch {
      // Socket.io not yet ready – the persisted read state remains authoritative.
    }
  }

  res.json({ ok: true, messageIds, readAt: readAt.toISOString() });
});

router.get("/conversations/:id/files/:messageId", async (req, res) => {
  const convId = Number(req.params["id"]);
  const messageId = Number(req.params["messageId"]);
  const access = String(req.query["access"] ?? "");
  if (
    !Number.isInteger(convId) ||
    !Number.isInteger(messageId) ||
    !verifyMessageFileAccess(convId, messageId, access)
  ) {
    res.status(403).json({ error: "Lien de fichier invalide ou expiré" });
    return;
  }
  const [message] = await db.select({ fileUrl: messagesTable.fileUrl })
    .from(messagesTable)
    .where(and(eq(messagesTable.id, messageId), eq(messagesTable.conversationId, convId)))
    .limit(1);
  if (!message?.fileUrl?.startsWith("/objects/")) {
    res.status(404).json({ error: "Fichier introuvable" });
    return;
  }
  const signedUrl = await objectStorage.signObjectEntityReadURL(message.fileUrl, 300);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.redirect(302, signedUrl);
});

/* ──────────────────────────────────────────────────────────────
   POST /api/conversations/:id/messages
   Auth determines senderType — never trust client-provided value.
   Body: { content }
   ────────────────────────────────────────────────────────────── */
router.post("/conversations/:id/messages", async (req, res) => {
  const requestedConvId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(requestedConvId)) { res.status(400).json({ error: "invalid id" }); return; }

  const { content } = req.body as { content: string };
  if (!content?.trim()) {
    res.status(400).json({ error: "content required" });
    return;
  }

  const identity = await resolveIdentity(req as Parameters<typeof resolveIdentity>[0], requestedConvId);
  if (!identity) { res.status(401).json({ error: "unauthorized" }); return; }
  const convId = identity.conversationId;

  // senderType is determined by server-side authentication — never from client
  const senderType: "buyer" | "vendor" = identity.role === "vendor" ? "vendor" : "buyer";

  const convRows = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, convId))
    .limit(1);
  if (!convRows.length) { res.status(404).json({ error: "conversation not found" }); return; }
  const conv = convRows[0];

  // ── Vérification boutique active (expirée = ni envoyer ni recevoir) ────────
  if (senderType === "vendor" || senderType === "buyer") {
    const now = new Date();
    const [vendorRow] = await db
      .select({ isPublished: vendorsTable.isPublished, expiryDate: vendorsTable.expiryDate })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, conv.vendorId))
      .limit(1);
    if (vendorRow) {
      const isActive = vendorRow.isPublished && (!vendorRow.expiryDate || vendorRow.expiryDate > now);
      // Broadcast conv (admin ↔ vendor) : aucune restriction d'expiration côté admin
      const isBroadcastSender = conv.buyerPhone === "##007##" && senderType === "buyer";
      if (!isActive && !isBroadcastSender) {
        res.status(403).json({ error: "shop_expired", message: "Votre boutique est expirée. Renouvelez votre abonnement pour envoyer ou recevoir des messages." });
        return;
      }
    }
  }

  const isBroadcastConv = conv.buyerPhone === "##007##";

  const [msg] = await db
    .insert(messagesTable)
    .values({
      conversationId: convId,
      senderType,
      listingId: conv.listingId,
      listingTitle: conv.listingTitle,
      listingImage: conv.listingImage,
      content: content.trim(),
    })
    .returning();

  // Update updatedAt + unread count + reset recipient's soft-delete so conversation reappears
  await db
    .update(conversationsTable)
    .set({
      updatedAt: new Date(),
      vendorUnreadCount: senderType === "buyer"
        ? sql`${conversationsTable.vendorUnreadCount} + 1`
        : conversationsTable.vendorUnreadCount,
      buyerUnreadCount: senderType === "vendor"
        ? sql`${conversationsTable.buyerUnreadCount} + 1`
        : conversationsTable.buyerUnreadCount,
      // Vendor replies to broadcast → admin inbox gets an unread increment
      adminUnreadCount: senderType === "vendor" && isBroadcastConv
        ? sql`${conversationsTable.adminUnreadCount} + 1`
        : conversationsTable.adminUnreadCount,
      // Sending a message to someone who deleted it from their side brings it back for them
      vendorDeletedAt: senderType === "buyer" ? null : conv.vendorDeletedAt,
      buyerDeletedAt: senderType === "vendor" ? null : conv.buyerDeletedAt,
    })
    .where(eq(conversationsTable.id, convId));

  // Broadcast via Socket.io
  try {
    const io = getIo();
    io.to(`vendor:${conv.vendorId}`).emit("new_message", { conversationId: convId, message: msg });
    io.to(`conv:${convId}`).emit("new_message", { conversationId: convId, message: msg });
    if (senderType === "vendor" && isBroadcastConv) {
      emitToAdmin("new_message", { conversationId: convId, message: secureMessageFileUrl(msg) });
    }
  } catch {
    // socket.io not yet ready – non-fatal
  }

  // ── Notifications selon l'expéditeur ──────────────────────────────────────
  if (senderType === "buyer") {
    // Notifier le vendeur quand l'acheteur envoie
    try {
      const [subs, vendorRows] = await Promise.all([
        db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.vendorId, conv.vendorId)),
        db.select({ firstName: vendorsTable.firstName, phone: vendorsTable.phone, wantsNotifications: vendorsTable.wantsNotifications })
          .from(vendorsTable).where(eq(vendorsTable.id, conv.vendorId)).limit(1),
      ]);

      const vendor = vendorRows[0];

      if (subs.length > 0 && vendor?.wantsNotifications && vapidReady) {
        const payload = JSON.stringify({
          title: `💬 ${conv.buyerName}`,
          body: content.length > 80 ? content.slice(0, 80) + "…" : content,
          conversationId: convId,
        });
        await Promise.allSettled(
          subs.map((sub) =>
            webpush.sendNotification(
              { endpoint: sub.endpoint, keys: sub.keys as { auth: string; p256dh: string } },
              payload,
            ).catch((err: { statusCode?: number }) => {
              if (isExpiredPushError(err)) {
                return db.delete(pushSubscriptionsTable).where(and(
                  eq(pushSubscriptionsTable.endpoint, sub.endpoint),
                  eq(pushSubscriptionsTable.vendorId, conv.vendorId),
                ));
              }
              return undefined;
            }),
          ),
        );
        const remainingSubs = await db
          .select({ id: pushSubscriptionsTable.id })
          .from(pushSubscriptionsTable)
          .where(eq(pushSubscriptionsTable.vendorId, conv.vendorId));
        if (remainingSubs.length === 0 && vendor) {
          await notifyVendorWithoutPush(conv.vendorId, vendor, conv.buyerName);
        }
      } else if (subs.length === 0 && vendor) {
        await notifyVendorWithoutPush(conv.vendorId, vendor, conv.buyerName);
      }
    } catch (err) {
      logger.warn({ err }, "Notification vendeur : erreur non fatale");
    }
  } else if (senderType === "vendor") {
    // Notifier l'acheteur quand le vendeur répond
    try {
      if (vapidReady) {
        const buyerSubs = await db
          .select()
          .from(buyerPushSubscriptionsTable)
          .where(eq(buyerPushSubscriptionsTable.conversationId, convId));

        if (buyerSubs.length > 0) {
          const vendorRows = await db
            .select({ firstName: vendorsTable.firstName, shopName: vendorsTable.shopName })
            .from(vendorsTable)
            .where(eq(vendorsTable.id, conv.vendorId))
            .limit(1);
          const vendorName = vendorRows[0]?.shopName || vendorRows[0]?.firstName || "Vendeur";

          const payload = JSON.stringify({
            title: `💬 ${vendorName}`,
            body: content.length > 80 ? content.slice(0, 80) + "…" : content,
            conversationId: convId,
          });

          await Promise.allSettled(
            buyerSubs.map((sub) =>
              webpush.sendNotification(
                { endpoint: sub.endpoint, keys: sub.keys as { auth: string; p256dh: string } },
                payload,
              ).catch((err: { statusCode?: number }) => {
                if (isExpiredPushError(err)) {
                  return db.delete(buyerPushSubscriptionsTable).where(and(
                    eq(buyerPushSubscriptionsTable.endpoint, sub.endpoint),
                    eq(buyerPushSubscriptionsTable.conversationId, convId),
                  ));
                }
                return undefined;
              }),
            ),
          );
        }
      }
    } catch (err) {
      logger.warn({ err }, "Notification acheteur : erreur non fatale");
    }
  }

  res.status(201).json(msg);
});

/* ──────────────────────────────────────────────────────────────
   POST /api/conversations/:id/upload
   Multipart: field "file" (JPEG/PNG/PDF, max 20 MB)
   ────────────────────────────────────────────────────────────── */
router.post(
  "/conversations/:id/upload",
  upload.single("file"),
  async (req, res) => {
    const rawConversationId = req.params["id"];
    const requestedConvId = parseInt(Array.isArray(rawConversationId) ? rawConversationId[0] ?? "" : rawConversationId ?? "", 10);
    if (isNaN(requestedConvId)) { res.status(400).json({ error: "invalid id" }); return; }

    const identity = await resolveIdentity(req as Parameters<typeof resolveIdentity>[0], requestedConvId);
    if (!identity) { res.status(401).json({ error: "unauthorized" }); return; }
    const convId = identity.conversationId;

    // ── Fetch conv tôt : permet de vérifier expiration AVANT de traiter le fichier ──
    const senderType: "buyer" | "vendor" = identity.role === "vendor" ? "vendor" : "buyer";
    const convRows = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, convId))
      .limit(1);
    if (!convRows.length) { res.status(404).json({ error: "conversation not found" }); return; }
    const conv = convRows[0];

    // Conversation TogoMarket : lecture seule côté vendeur (pas d'envoi de fichiers)
    if (conv.buyerPhone === "##007##" && senderType === "vendor") {
      res.status(403).json({
        error: "admin_conversation_readonly",
        message: "Pour plus d'informations contactez l'administrateur par WhatsApp au +228 70 70 31 31.",
      });
      return;
    }

    // ── Vérification boutique active (même règle que la route texte) ─────────────
    {
      const now = new Date();
      const [vendorRow] = await db
        .select({ isPublished: vendorsTable.isPublished, expiryDate: vendorsTable.expiryDate })
        .from(vendorsTable)
        .where(eq(vendorsTable.id, conv.vendorId))
        .limit(1);
      if (vendorRow) {
        const isActive = vendorRow.isPublished && (!vendorRow.expiryDate || vendorRow.expiryDate > now);
        const isBroadcastSender = conv.buyerPhone === "##007##" && senderType === "buyer";
        if (!isActive && !isBroadcastSender) {
          res.status(403).json({ error: "shop_expired", message: "Votre boutique est expirée. Renouvelez votre abonnement pour envoyer ou recevoir des messages." });
          return;
        }
      }
    }

    const file = req.file;
    if (!file) { res.status(400).json({ error: "file required" }); return; }

    let safeFile;
    try {
      safeFile = validateFileBytes(file.buffer, file.mimetype, ["image", "audio", "pdf"]);
    } catch {
      res.status(400).json({ error: "Le contenu réel du fichier ne correspond pas à un format autorisé" });
      return;
    }
    if (safeFile.kind === "image" && file.size > 2 * 1024 * 1024) {
      res.status(400).json({ error: "L'image dépasse la limite de 2 Mo" });
      return;
    }
    if (safeFile.kind === "pdf" && file.size > 10 * 1024 * 1024) {
      res.status(400).json({ error: "Le document dépasse la limite de 10 Mo" });
      return;
    }

    const fileType = safeFile.kind;
    const objectPath = await objectStorage.uploadObjectEntity(file.buffer, safeFile.contentType, {
      owner: `conversation:${convId}`,
      visibility: "private",
    });
    let msg;
    try {
      [msg] = await db
        .insert(messagesTable)
        .values({
          conversationId: convId,
          senderType,
          listingId: conv.listingId,
          listingTitle: conv.listingTitle,
          listingImage: conv.listingImage,
          fileUrl: objectPath,
          fileType,
          content: null,
        })
        .returning();
    } catch (error) {
      await objectStorage.deleteObjectEntity(objectPath).catch(() => {});
      throw error;
    }

    await db
      .update(conversationsTable)
      .set({
        updatedAt: new Date(),
        vendorUnreadCount: senderType === "buyer"
          ? sql`${conversationsTable.vendorUnreadCount} + 1`
          : conversationsTable.vendorUnreadCount,
        buyerUnreadCount: senderType === "vendor"
          ? sql`${conversationsTable.buyerUnreadCount} + 1`
          : conversationsTable.buyerUnreadCount,
        vendorDeletedAt: senderType === "buyer" ? null : conv.vendorDeletedAt,
        buyerDeletedAt: senderType === "vendor" ? null : conv.buyerDeletedAt,
      })
      .where(eq(conversationsTable.id, convId));

    try {
      const io = getIo();
      const secureMsg = secureMessageFileUrl(msg);
      io.to(`vendor:${conv.vendorId}`).emit("new_message", { conversationId: convId, message: secureMsg });
      io.to(`conv:${convId}`).emit("new_message", { conversationId: convId, message: secureMsg });
      if (senderType === "vendor" && conv.buyerPhone === "##007##") {
        emitToAdmin("new_message", { conversationId: convId, message: secureMsg });
      }
    } catch { /* non-fatal */ }

    // Notifier l'acheteur par push quand le vendeur envoie un fichier
    if (senderType === "vendor" && vapidReady) {
      try {
        const buyerSubs = await db
          .select()
          .from(buyerPushSubscriptionsTable)
          .where(eq(buyerPushSubscriptionsTable.conversationId, convId));
        if (buyerSubs.length > 0) {
          const vRows = await db
            .select({ firstName: vendorsTable.firstName, shopName: vendorsTable.shopName })
            .from(vendorsTable)
            .where(eq(vendorsTable.id, conv.vendorId))
            .limit(1);
          const vendorName = vRows[0]?.shopName || vRows[0]?.firstName || "Vendeur";
          const body = fileType === "audio" ? "🎤 Message vocal" : "📷 Photo";
          const payload = JSON.stringify({
            title: `💬 ${vendorName}`,
            body,
            conversationId: convId,
          });
          await Promise.allSettled(
            buyerSubs.map((sub) =>
              webpush.sendNotification(
                { endpoint: sub.endpoint, keys: sub.keys as { auth: string; p256dh: string } },
                payload,
              ).catch((err: { statusCode?: number }) => {
                if (isExpiredPushError(err)) {
                  return db.delete(buyerPushSubscriptionsTable)
                    .where(and(
                      eq(buyerPushSubscriptionsTable.endpoint, sub.endpoint),
                      eq(buyerPushSubscriptionsTable.conversationId, convId),
                    ));
                }
                return undefined;
              }),
            ),
          );
        }
      } catch (err) {
        logger.warn({ err }, "Notification push acheteur (upload) : erreur non fatale");
      }
    }

    res.status(201).json(secureMessageFileUrl(msg));
  },
);

/* ──────────────────────────────────────────────────────────────
   DELETE /api/messages/:id/me  — hide message from requesting party only
   ────────────────────────────────────────────────────────────── */
router.delete("/messages/:id/me", async (req, res) => {
  const msgId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(msgId)) { res.status(400).json({ error: "invalid id" }); return; }

  const msgRows = await db.select().from(messagesTable).where(eq(messagesTable.id, msgId)).limit(1);
  if (!msgRows.length) { res.status(404).json({ error: "not found" }); return; }
  const msg = msgRows[0];

  const identity = await resolveIdentity(req as Parameters<typeof resolveIdentity>[0], msg.conversationId);
  if (!identity) { res.status(401).json({ error: "unauthorized" }); return; }

  const field = identity.role === "vendor" ? { vendorDeletedAt: new Date() } : { buyerDeletedAt: new Date() };

  await db.update(messagesTable).set(field).where(eq(messagesTable.id, msgId));

  // Notify only the requesting party's socket room
  try {
    const io = getIo();
    if (identity.role === "vendor") {
      io.to(`vendor:${identity.vendorId}`).emit("message_hidden_me", { messageId: msgId, conversationId: msg.conversationId });
    } else {
      io.to(`conv:${msg.conversationId}`).emit("message_hidden_me", { messageId: msgId, conversationId: msg.conversationId });
    }
  } catch { /* non-fatal */ }

  res.json({ ok: true });
});

/* ──────────────────────────────────────────────────────────────
   DELETE /api/messages/:id  — soft delete for both (own message only)
   ────────────────────────────────────────────────────────────── */
router.delete("/messages/:id", async (req, res) => {
  const msgId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(msgId)) { res.status(400).json({ error: "invalid id" }); return; }

  const msgRows = await db.select().from(messagesTable).where(eq(messagesTable.id, msgId)).limit(1);
  if (!msgRows.length) { res.status(404).json({ error: "not found" }); return; }
  const msg = msgRows[0];

  if (msg.deletedAt) { res.status(410).json({ error: "already deleted" }); return; }

  const identity = await resolveIdentity(req as Parameters<typeof resolveIdentity>[0], msg.conversationId);
  if (!identity) { res.status(401).json({ error: "unauthorized" }); return; }

  const senderType: "buyer" | "vendor" = identity.role === "vendor" ? "vendor" : "buyer";
  if (msg.senderType !== senderType) { res.status(403).json({ error: "can only delete own messages" }); return; }

  const [updated] = await db
    .update(messagesTable)
    .set({ deletedAt: new Date() })
    .where(eq(messagesTable.id, msgId))
    .returning();

  const convRows = await db.select({ vendorId: conversationsTable.vendorId }).from(conversationsTable).where(eq(conversationsTable.id, msg.conversationId)).limit(1);
  const vendorId = convRows[0]?.vendorId;
  try {
    const io = getIo();
    if (vendorId) io.to(`vendor:${vendorId}`).emit("message_deleted", { messageId: msgId, conversationId: msg.conversationId });
    io.to(`conv:${msg.conversationId}`).emit("message_deleted", { messageId: msgId, conversationId: msg.conversationId });
  } catch { /* non-fatal */ }

  res.json(updated);
});

/* ──────────────────────────────────────────────────────────────
   PATCH /api/messages/:id  — edit content (own message, < 5 min)
   Body: { content }
   ────────────────────────────────────────────────────────────── */
router.patch("/messages/:id", async (req, res) => {
  const msgId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(msgId)) { res.status(400).json({ error: "invalid id" }); return; }

  const { content } = req.body as { content?: string };
  if (!content?.trim()) { res.status(400).json({ error: "content required" }); return; }

  const msgRows = await db.select().from(messagesTable).where(eq(messagesTable.id, msgId)).limit(1);
  if (!msgRows.length) { res.status(404).json({ error: "not found" }); return; }
  const msg = msgRows[0];

  if (msg.deletedAt) { res.status(410).json({ error: "message deleted" }); return; }

  // Only text messages can be edited (not file messages)
  if (msg.fileUrl) { res.status(400).json({ error: "cannot edit file messages" }); return; }

  // Must be within 5 minutes of creation
  const ageMs = Date.now() - new Date(msg.createdAt).getTime();
  if (ageMs > 5 * 60 * 1000) { res.status(403).json({ error: "too late to edit (5 min limit)" }); return; }

  const identity = await resolveIdentity(req as Parameters<typeof resolveIdentity>[0], msg.conversationId);
  if (!identity) { res.status(401).json({ error: "unauthorized" }); return; }

  const senderType: "buyer" | "vendor" = identity.role === "vendor" ? "vendor" : "buyer";
  if (msg.senderType !== senderType) { res.status(403).json({ error: "can only edit own messages" }); return; }

  const editedAt = new Date();
  const [updated] = await db
    .update(messagesTable)
    .set({ content: content.trim(), editedAt })
    .where(eq(messagesTable.id, msgId))
    .returning();

  const convRows = await db.select({ vendorId: conversationsTable.vendorId }).from(conversationsTable).where(eq(conversationsTable.id, msg.conversationId)).limit(1);
  const vendorId = convRows[0]?.vendorId;
  try {
    const io = getIo();
    const payload = { messageId: msgId, content: content.trim(), editedAt: editedAt.toISOString(), conversationId: msg.conversationId };
    if (vendorId) io.to(`vendor:${vendorId}`).emit("message_edited", payload);
    io.to(`conv:${msg.conversationId}`).emit("message_edited", payload);
  } catch { /* non-fatal */ }

  res.json({ content: updated.content, editedAt: updated.editedAt });
});

/* ──────────────────────────────────────────────────────────────
   GET /api/vendor/conversations
   ────────────────────────────────────────────────────────────── */
router.get("/vendor/conversations", async (req, res) => {
  const vendor = await authenticateVendorRequest(req);
  if (!vendor) { res.status(401).json({ error: "invalid credentials" }); return; }

  // Return conversations without buyerToken (not needed by vendor)
  // Filter out conversations the vendor has soft-deleted
  const convs = await db
    .select({
      id: conversationsTable.id,
      vendorId: conversationsTable.vendorId,
      buyerName: conversationsTable.buyerName,
      buyerPhone: conversationsTable.buyerPhone,
      listingTitle: conversationsTable.listingTitle,
      listingId: conversationsTable.listingId,
      listingImage: conversationsTable.listingImage,
      createdAt: conversationsTable.createdAt,
      updatedAt: conversationsTable.updatedAt,
      vendorUnreadCount: conversationsTable.vendorUnreadCount,
    })
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.vendorId, vendor.id),
      isNull(conversationsTable.vendorDeletedAt),
    ))
    .orderBy(desc(conversationsTable.updatedAt));

  if (convs.length === 0) {
    res.json([]);
    return;
  }

  const unreadRows = await db
    .select({
      conversationId: messagesTable.conversationId,
      count: sql<number>`count(*)::int`,
    })
    .from(messagesTable)
    .where(and(
      inArray(messagesTable.conversationId, convs.map((conversation) => conversation.id)),
      eq(messagesTable.senderType, "buyer"),
      isNull(messagesTable.readAt),
      isNull(messagesTable.readByVendorAt),
      isNull(messagesTable.deletedAt),
      isNull(messagesTable.vendorDeletedAt),
    ))
    .groupBy(messagesTable.conversationId);
  const unreadByConversation = new Map(
    unreadRows.map((row) => [row.conversationId, row.count]),
  );
  const conversationsWithUnread = convs.map((conversation) => ({
    ...conversation,
    vendorUnreadCount: unreadByConversation.get(conversation.id) ?? 0,
  }));

  res.json(await addListingImageFallback(conversationsWithUnread));
});

/* ──────────────────────────────────────────────────────────────
   POST /api/vendor/conversations/:id/read
   Marque les messages acheteur comme lus par le vendeur et reset
   le compteur de messages non lus.
   ────────────────────────────────────────────────────────────── */
router.post("/vendor/conversations/:id/read", async (req, res) => {
  const vendor = await authenticateVendorRequest(req);
  if (!vendor) { res.status(401).json({ error: "invalid credentials" }); return; }

  const requestedConvId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(requestedConvId)) { res.status(400).json({ error: "invalid id" }); return; }
  const convId = await resolveVendorConversationId(requestedConvId, vendor.id);
  if (!convId) { res.status(404).json({ error: "not found" }); return; }

  const readByVendorAt = new Date();
  const readMessages = await db
    .update(messagesTable)
    .set({ readByVendorAt })
    .where(and(
      eq(messagesTable.conversationId, convId),
      eq(messagesTable.senderType, "buyer"),
      isNull(messagesTable.readByVendorAt),
      isNull(messagesTable.deletedAt),
      isNull(messagesTable.vendorDeletedAt),
    ))
    .returning({ id: messagesTable.id });

  await db
    .update(conversationsTable)
    .set({ vendorUnreadCount: 0 })
    .where(
      and(
        eq(conversationsTable.id, convId),
        eq(conversationsTable.vendorId, vendor.id),
      ),
    );

  const messageIds = readMessages.map((message) => message.id);
  if (messageIds.length > 0) {
    try {
      getIo().to(`conv:${convId}`).emit("message_read", {
        conversationId: convId,
        messageIds,
        readByVendorAt: readByVendorAt.toISOString(),
      });
    } catch {
      // Socket.io not yet ready — the persisted read state remains authoritative.
    }
  }

  res.json({
    ok: true,
    messageIds,
    readByVendorAt: readByVendorAt.toISOString(),
  });
});

/*  DELETE /api/vendor/conversations/:id
    ────────────────────────────────────────────────────────────── */
router.delete("/vendor/conversations/:id", async (req, res) => {
  const vendor = await authenticateVendorRequest(req);
  if (!vendor) { res.status(401).json({ error: "invalid credentials" }); return; }

  const requestedConvId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(requestedConvId)) { res.status(400).json({ error: "invalid id" }); return; }
  const convId = await resolveVendorConversationId(requestedConvId, vendor.id);
  if (!convId) { res.status(404).json({ error: "not found" }); return; }

  // Soft-delete: mark deleted only for the vendor — buyer's view is unaffected
  await db
    .update(conversationsTable)
    .set({ vendorDeletedAt: new Date() })
    .where(
      and(
        eq(conversationsTable.id, convId),
        eq(conversationsTable.vendorId, vendor.id),
      ),
    );

  res.json({ ok: true });
});

/* ──────────────────────────────────────────────────────────────
   DELETE /api/conversations/:id   (buyer side)
   Soft-delete the conversation from the buyer's view only.
   Auth: x-buyer-token
   ────────────────────────────────────────────────────────────── */
router.delete("/conversations/:id", async (req, res) => {
  const requestedConvId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(requestedConvId)) { res.status(400).json({ error: "invalid id" }); return; }

  const buyerToken = req.headers["x-buyer-token"] as string | undefined;
  if (!buyerToken) { res.status(401).json({ error: "x-buyer-token required" }); return; }

  const convId = await resolveBuyerConversationId(requestedConvId, buyerToken);
  if (!convId) { res.status(401).json({ error: "unauthorized" }); return; }

  // Soft-delete: mark deleted only for the buyer — vendor's view is unaffected
  await db
    .update(conversationsTable)
    .set({ buyerDeletedAt: new Date() })
    .where(eq(conversationsTable.id, convId));

  res.json({ ok: true });
});

export default router;
