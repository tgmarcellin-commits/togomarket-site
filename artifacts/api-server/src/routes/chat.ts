import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  conversationsTable,
  messagesTable,
  vendorsTable,
  pushSubscriptionsTable,
} from "@workspace/db";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { getIo } from "../lib/socket-io";
import { webpush, vapidReady } from "../lib/webpush";
import { normalizePhone, phoneEq } from "../lib/phone";

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

  // Update updatedAt + increment unread for vendor when buyer sends
  await db
    .update(conversationsTable)
    .set({
      updatedAt: new Date(),
      vendorUnreadCount: senderType === "buyer"
        ? conv.vendorUnreadCount + 1
        : conv.vendorUnreadCount,
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

  // Web Push to vendor when buyer sends
  if (senderType === "buyer") {
    try {
      const subs = await db
        .select()
        .from(pushSubscriptionsTable)
        .where(eq(pushSubscriptionsTable.vendorId, conv.vendorId));

      const vendorRows = await db
        .select({ wantsNotifications: vendorsTable.wantsNotifications })
        .from(vendorsTable)
        .where(eq(vendorsTable.id, conv.vendorId))
        .limit(1);

      if (subs.length > 0 && vendorRows[0]?.wantsNotifications && vapidReady) {
        const payload = JSON.stringify({
          title: `💬 ${conv.buyerName}`,
          body: content.length > 80 ? content.slice(0, 80) + "…" : content,
          conversationId: convId,
        });
        await Promise.allSettled(
          subs.map((sub) =>
            webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: sub.keys as { auth: string; p256dh: string },
              },
              payload,
            ).catch((err: { statusCode?: number }) => {
              // Remove stale subscription (410 = gone)
              if (err?.statusCode === 410) {
                return db
                  .delete(pushSubscriptionsTable)
                  .where(eq(pushSubscriptionsTable.endpoint, sub.endpoint));
              }
              return undefined; // explicit return for all code paths
            }),
          ),
        );
      }
    } catch {
      // Non-fatal
    }
  }

  res.status(201).json(msg);
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
    .where(eq(conversationsTable.vendorId, vendor.id))
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

export default router;
