import { Router, type IRouter } from "express";
import { eq, desc, and, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  conversationsTable,
  messagesTable,
  vendorsTable,
  pushSubscriptionsTable,
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

const upload = multer({ dest: "/tmp", limits: { fileSize: 20 * 1024 * 1024 } }); // 20 MB max
const objectStorage = new ObjectStorageService();

const router: IRouter = Router();

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
    .select({ id: vendorsTable.id })
    .from(vendorsTable)
    .where(eq(vendorsTable.id, Number(vendorId)))
    .limit(1);
  if (!vendorRows.length) {
    res.status(404).json({ error: "vendor not found" });
    return;
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
      listingTitle: listingTitle?.trim() ?? null,
      listingId: listingId ?? null,
      buyerToken,
    })
    .returning();

  res.status(201).json(conv);
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

  const msgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, convId))
    .orderBy(messagesTable.createdAt);

  res.json(msgs);
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

  // Notifications au vendeur quand c'est l'acheteur qui envoie
  if (senderType === "buyer") {
    try {
      const [subs, vendorRows] = await Promise.all([
        db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.vendorId, conv.vendorId)),
        db.select({ firstName: vendorsTable.firstName, phone: vendorsTable.phone, wantsNotifications: vendorsTable.wantsNotifications })
          .from(vendorsTable).where(eq(vendorsTable.id, conv.vendorId)).limit(1),
      ]);

      const vendor = vendorRows[0];

      if (subs.length > 0 && vendor?.wantsNotifications && vapidReady) {
        // ── A) Push Web si notifs activées ─────────────────────────────────
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
        // ── B) Pas de push activé → relance WhatsApp + notification in-app ─
        // Notification in-app (toujours enregistrée)
        await db.insert(vendorNotificationsTable).values({
          vendorId: conv.vendorId,
          title: `💬 Nouveau message de ${conv.buyerName}`,
          body: `Vous avez reçu un message mais vos notifications sont désactivées. Activez-les dans l'onglet Messages pour ne plus rien manquer.`,
          url: null,
          notifType: "push_nudge",
        });

        // WhatsApp rate-limité : 1 message max par heure par vendeur
        if (canSendNudge(conv.vendorId)) {
          markNudgeSent(conv.vendorId);
          sendWhatsAppNotifNudge(vendor.phone, vendor.firstName, conv.buyerName)
            .catch((err) => logger.warn({ err, vendorId: conv.vendorId }, "WhatsApp notif nudge failed"));
        }
      }
    } catch (err) {
      logger.warn({ err }, "Notification vendeur : erreur non fatale");
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
    const convId = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(convId)) { res.status(400).json({ error: "invalid id" }); return; }

    const identity = await resolveIdentity(req as Parameters<typeof resolveIdentity>[0], convId);
    if (!identity) { res.status(401).json({ error: "unauthorized" }); return; }

    const file = req.file;
    if (!file) { res.status(400).json({ error: "file required" }); return; }

    const allowed = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
    if (!allowed.includes(file.mimetype)) {
      res.status(400).json({ error: "only JPEG, PNG, PDF allowed" });
      return;
    }

    const fileType = file.mimetype === "application/pdf" ? "pdf" : "image";
    const mimeType = file.mimetype as "image/jpeg" | "image/png" | "application/pdf";

    // Upload to Object Storage
    const fs = await import("node:fs/promises");
    const buffer = await fs.readFile(file.path);
    await fs.unlink(file.path).catch(() => {});

    const objectPath = await objectStorage.uploadObjectEntity(buffer, mimeType);

    const senderType: "buyer" | "vendor" = identity.role === "vendor" ? "vendor" : "buyer";
    const convRows = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, convId))
      .limit(1);
    if (!convRows.length) { res.status(404).json({ error: "conversation not found" }); return; }
    const conv = convRows[0];

    const [msg] = await db
      .insert(messagesTable)
      .values({ conversationId: convId, senderType, fileUrl: objectPath, fileType, content: null })
      .returning();

    await db
      .update(conversationsTable)
      .set({
        updatedAt: new Date(),
        vendorUnreadCount: senderType === "buyer" ? conv.vendorUnreadCount + 1 : conv.vendorUnreadCount,
        vendorDeletedAt: senderType === "buyer" ? null : conv.vendorDeletedAt,
        buyerDeletedAt: senderType === "vendor" ? null : conv.buyerDeletedAt,
      })
      .where(eq(conversationsTable.id, convId));

    try {
      const io = getIo();
      io.to(`vendor:${conv.vendorId}`).emit("new_message", { conversationId: convId, message: msg });
      io.to(`conv:${convId}`).emit("new_message", { conversationId: convId, message: msg });
    } catch { /* non-fatal */ }

    res.status(201).json(msg);
  },
);

/* ──────────────────────────────────────────────────────────────
   DELETE /api/messages/:id  — soft delete (own message only)
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

  res.json(convs);
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
