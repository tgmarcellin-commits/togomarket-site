import { Router, type IRouter } from "express";
import { eq, desc, and, isNull, or, inArray } from "drizzle-orm";
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
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { getIo } from "../lib/socket-io";
import { webpush, vapidReady } from "../lib/webpush";
import { normalizePhone, phoneEq } from "../lib/phone";
import { sendWhatsAppNotifNudge, canSendNudge, markNudgeSent } from "../lib/whatsapp-api";
import { logger } from "../lib/logger";
import { ObjectStorageService } from "../lib/objectStorage";
import { validateFileBytes } from "../lib/file-security";
import { secureMessageFileUrl, verifyMessageFileAccess } from "../lib/message-file-access";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 2 },
});
const objectStorage = new ObjectStorageService();

const router: IRouter = Router();

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
async function authenticateVendor(phone: string, password: string) {
  const norm = normalizePhone(phone);
  const vendors = await db
    .select()
    .from(vendorsTable)
    .where(phoneEq(vendorsTable.phone, norm))
    .limit(1);
  if (!vendors.length) return null;
  const v = vendors[0];
  const ok = await bcrypt.compare(password, v.passwordHash);
  return ok ? v : null;
}

/* ──────────────────────────────────────────────────────────────
   POST /api/conversations
   Body: { vendorId, buyerName, buyerPhone, listingTitle?, listingId? }
   Returns: conversation + buyerToken (store in client, required for reads/sends)
   ────────────────────────────────────────────────────────────── */
router.post("/conversations", async (req, res) => {
  const { vendorId, buyerName, buyerPhone, listingTitle, listingId } = req.body as {
    vendorId: number;
    buyerName: string;
    buyerPhone: string;
    listingTitle?: string;
    listingId?: number;
  };

  if (!vendorId || !buyerName?.trim() || !buyerPhone?.trim()) {
    res.status(400).json({ error: "vendorId, buyerName, buyerPhone required" });
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

  // Always create a new conversation — no deduplication by PII.
  // Clients that need to resume an existing session must use the buyerToken
  // stored locally at creation time; they must NOT re-derive it from phone + vendorId.
  const buyerToken = randomUUID();
  const [conv] = await db
    .insert(conversationsTable)
    .values({
      vendorId: Number(vendorId),
      buyerName: buyerName.trim(),
      buyerPhone: buyerPhone.trim(),
      listingTitle: resolvedListingTitle,
      listingId: Number.isInteger(parsedListingId) && parsedListingId > 0 ? parsedListingId : null,
      listingImage,
      buyerToken,
    })
    .returning();

  res.status(201).json(conv);
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
    res.json([]);
    return;
  }

  // Cap at 100 tokens to prevent abuse
  const tokens = buyerTokens.slice(0, 100);

  // Fetch all matching conversations (each token is checked by the DB)
  const convRows = await db
    .select()
    .from(conversationsTable)
    .where(and(
      isNull(conversationsTable.buyerDeletedAt),
      inArray(conversationsTable.buyerToken, tokens),
    ))
    .orderBy(desc(conversationsTable.updatedAt));

  // For each conversation, get the last message
  const result = await Promise.all(
    convRows.map(async (conv) => {
      const lastMsgs = await db
        .select({ content: messagesTable.content, createdAt: messagesTable.createdAt, senderType: messagesTable.senderType })
        .from(messagesTable)
        .where(and(
          eq(messagesTable.conversationId, conv.id),
          isNull(messagesTable.deletedAt),
          isNull(messagesTable.buyerDeletedAt),
        ))
        .orderBy(desc(messagesTable.createdAt))
        .limit(1);

      const last = lastMsgs[0];

      // Count unread messages for buyer = vendor messages the buyer hasn't "read" yet
      // We approximate this as vendor messages since the buyer's last fetch.
      // For simplicity, we expose the field but the server doesn't track buyer reads.
      // The client can mark conversations read by opening them.
      return {
        id: conv.id,
        vendorId: conv.vendorId,
        listingTitle: conv.listingTitle,
        listingId: conv.listingId,
        listingImage: conv.listingImage,
        buyerName: conv.buyerName,
        buyerPhone: conv.buyerPhone,
        buyerToken: conv.buyerToken, // safe: only returned to the holder of this token
        lastMessage: last?.content ?? null,
        lastMessageAt: last?.createdAt ?? conv.updatedAt,
        buyerUnreadCount: conv.buyerUnreadCount,
      };
    }),
  );

  res.json(await addListingImageFallback(result));
});

/* ──────────────────────────────────────────────────────────────
   POST /api/conversations/:id/buyer-read
   Marque toutes les réponses vendeur comme lues (reset buyerUnreadCount).
   Auth: x-buyer-token
   ────────────────────────────────────────────────────────────── */
router.post("/conversations/:id/buyer-read", async (req, res) => {
  const convId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(convId)) { res.status(400).json({ error: "invalid id" }); return; }

  const buyerToken = req.headers["x-buyer-token"] as string | undefined;
  if (!buyerToken) { res.status(401).json({ error: "x-buyer-token required" }); return; }

  const convRows = await db
    .select({ buyerToken: conversationsTable.buyerToken })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, convId))
    .limit(1);
  if (!convRows.length) { res.status(404).json({ error: "not found" }); return; }
  if (convRows[0].buyerToken !== buyerToken) { res.status(401).json({ error: "unauthorized" }); return; }

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
  | { role: "vendor"; vendorId: number }
  | { role: "buyer" }
  | null
> {
  const vendorPhone = req.headers["x-vendor-phone"] as string | undefined;
  const vendorPassword = req.headers["x-vendor-password"] as string | undefined;
  const buyerToken = req.headers["x-buyer-token"] as string | undefined;

  if (vendorPhone && vendorPassword) {
    const v = await authenticateVendor(vendorPhone, vendorPassword);
    if (!v) return null;
    // Make sure this vendor actually owns the conversation
    const convRows = await db
      .select({ vendorId: conversationsTable.vendorId })
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, convId), eq(conversationsTable.vendorId, v.id)))
      .limit(1);
    if (!convRows.length) return null;
    return { role: "vendor", vendorId: v.id };
  }

  if (buyerToken) {
    const convRows = await db
      .select({ buyerToken: conversationsTable.buyerToken })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, convId))
      .limit(1);
    if (!convRows.length) return null;
    if (convRows[0].buyerToken !== buyerToken) return null;
    return { role: "buyer" };
  }

  return null;
}

/* ──────────────────────────────────────────────────────────────
   GET /api/conversations/:id/messages
   Auth: x-buyer-token OR (x-vendor-phone + x-vendor-password)
   ────────────────────────────────────────────────────────────── */
router.get("/conversations/:id/messages", async (req, res) => {
  const convId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(convId)) { res.status(400).json({ error: "invalid id" }); return; }

  const identity = await resolveIdentity(req as Parameters<typeof resolveIdentity>[0], convId);
  if (!identity) { res.status(401).json({ error: "unauthorized" }); return; }

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
  const convId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(convId)) { res.status(400).json({ error: "invalid id" }); return; }

  const { content } = req.body as { content: string };
  if (!content?.trim()) {
    res.status(400).json({ error: "content required" });
    return;
  }

  const identity = await resolveIdentity(req as Parameters<typeof resolveIdentity>[0], convId);
  if (!identity) { res.status(401).json({ error: "unauthorized" }); return; }

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

  // ── Conversation TogoMarket (broadcast/admin) : lecture seule côté vendeur ──
  // Les vendeurs ne peuvent pas répondre aux messages de TogoMarket ;
  // ils sont invités à contacter l'administration par WhatsApp.
  const isBroadcastConv = conv.buyerPhone === "##007##";
  if (isBroadcastConv && senderType === "vendor") {
    res.status(403).json({
      error: "admin_conversation_readonly",
      message: "Pour plus d'informations contactez l'administrateur par WhatsApp au +228 70 70 31 31.",
    });
    return;
  }

  const [msg] = await db
    .insert(messagesTable)
    .values({ conversationId: convId, senderType, content: content.trim() })
    .returning();

  // Update updatedAt + unread count + reset recipient's soft-delete so conversation reappears
  await db
    .update(conversationsTable)
    .set({
      updatedAt: new Date(),
      vendorUnreadCount: senderType === "buyer"
        ? conv.vendorUnreadCount + 1
        : conv.vendorUnreadCount,
      buyerUnreadCount: senderType === "vendor"
        ? conv.buyerUnreadCount + 1
        : conv.buyerUnreadCount,
      // Vendor replies to broadcast → admin inbox gets an unread increment
      adminUnreadCount: senderType === "vendor" && isBroadcastConv
        ? (conv.adminUnreadCount ?? 0) + 1
        : (conv.adminUnreadCount ?? 0),
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
              if (err?.statusCode === 410) {
                return db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, sub.endpoint));
              }
              return undefined;
            }),
          ),
        );
      } else if (subs.length === 0 && vendor) {
        await db.insert(vendorNotificationsTable).values({
          vendorId: conv.vendorId,
          title: `💬 Nouveau message de ${conv.buyerName}`,
          body: `Vous avez reçu un message mais vos notifications sont désactivées. Activez-les dans l'onglet Messages pour ne plus rien manquer.`,
          url: null,
          notifType: "push_nudge",
        });
        if (canSendNudge(conv.vendorId)) {
          markNudgeSent(conv.vendorId);
          sendWhatsAppNotifNudge(vendor.phone, vendor.firstName, conv.buyerName)
            .catch((err) => logger.warn({ err, vendorId: conv.vendorId }, "WhatsApp notif nudge failed"));
        }
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
                if (err?.statusCode === 410) {
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
    const convId = parseInt(Array.isArray(rawConversationId) ? rawConversationId[0] ?? "" : rawConversationId ?? "", 10);
    if (isNaN(convId)) { res.status(400).json({ error: "invalid id" }); return; }

    const identity = await resolveIdentity(req as Parameters<typeof resolveIdentity>[0], convId);
    if (!identity) { res.status(401).json({ error: "unauthorized" }); return; }

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
        .values({ conversationId: convId, senderType, fileUrl: objectPath, fileType, content: null })
        .returning();
    } catch (error) {
      await objectStorage.deleteObjectEntity(objectPath).catch(() => {});
      throw error;
    }

    await db
      .update(conversationsTable)
      .set({
        updatedAt: new Date(),
        vendorUnreadCount: senderType === "buyer" ? conv.vendorUnreadCount + 1 : conv.vendorUnreadCount,
        buyerUnreadCount: senderType === "vendor" ? conv.buyerUnreadCount + 1 : conv.buyerUnreadCount,
        vendorDeletedAt: senderType === "buyer" ? null : conv.vendorDeletedAt,
        buyerDeletedAt: senderType === "vendor" ? null : conv.buyerDeletedAt,
      })
      .where(eq(conversationsTable.id, convId));

    try {
      const io = getIo();
      const secureMsg = secureMessageFileUrl(msg);
      io.to(`vendor:${conv.vendorId}`).emit("new_message", { conversationId: convId, message: secureMsg });
      io.to(`conv:${convId}`).emit("new_message", { conversationId: convId, message: secureMsg });
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
                if (err?.statusCode === 410) {
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
  const phone = req.headers["x-vendor-phone"] as string;
  const password = req.headers["x-vendor-password"] as string;
  if (!phone || !password) { res.status(401).json({ error: "auth required" }); return; }

  const vendor = await authenticateVendor(phone, password);
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

  res.json(await addListingImageFallback(convs));
});

/* ──────────────────────────────────────────────────────────────
   POST /api/vendor/conversations/:id/read
   ────────────────────────────────────────────────────────────── */
router.post("/vendor/conversations/:id/read", async (req, res) => {
  const phone = req.headers["x-vendor-phone"] as string;
  const password = req.headers["x-vendor-password"] as string;
  if (!phone || !password) { res.status(401).json({ error: "auth required" }); return; }

  const vendor = await authenticateVendor(phone, password);
  if (!vendor) { res.status(401).json({ error: "invalid credentials" }); return; }

  const convId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(convId)) { res.status(400).json({ error: "invalid id" }); return; }

  await db
    .update(conversationsTable)
    .set({ vendorUnreadCount: 0 })
    .where(
      and(
        eq(conversationsTable.id, convId),
        eq(conversationsTable.vendorId, vendor.id),
      ),
    );

  res.json({ ok: true });
});

/*  DELETE /api/vendor/conversations/:id
    ────────────────────────────────────────────────────────────── */
router.delete("/vendor/conversations/:id", async (req, res) => {
  const phone = req.headers["x-vendor-phone"] as string;
  const password = req.headers["x-vendor-password"] as string;
  if (!phone || !password) { res.status(401).json({ error: "auth required" }); return; }

  const vendor = await authenticateVendor(phone, password);
  if (!vendor) { res.status(401).json({ error: "invalid credentials" }); return; }

  const convId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(convId)) { res.status(400).json({ error: "invalid id" }); return; }

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
  const convId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(convId)) { res.status(400).json({ error: "invalid id" }); return; }

  const buyerToken = req.headers["x-buyer-token"] as string | undefined;
  if (!buyerToken) { res.status(401).json({ error: "x-buyer-token required" }); return; }

  // Verify token matches this conversation
  const convRows = await db
    .select({ id: conversationsTable.id, buyerToken: conversationsTable.buyerToken })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, convId))
    .limit(1);
  if (!convRows.length) { res.status(404).json({ error: "not found" }); return; }
  if (convRows[0].buyerToken !== buyerToken) { res.status(401).json({ error: "unauthorized" }); return; }

  // Soft-delete: mark deleted only for the buyer — vendor's view is unaffected
  await db
    .update(conversationsTable)
    .set({ buyerDeletedAt: new Date() })
    .where(eq(conversationsTable.id, convId));

  res.json({ ok: true });
});

export default router;
