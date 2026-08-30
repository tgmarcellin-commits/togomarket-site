import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, pushSubscriptionsTable, buyerPushSubscriptionsTable, vendorsTable, conversationsTable } from "@workspace/db";
import bcrypt from "bcryptjs";
import { vapidPublicKey } from "../lib/webpush";
import { normalizePhone, phoneEq } from "../lib/phone";

const router: IRouter = Router();

/**
 * Hosts autorisés pour les endpoints Web Push (services push des navigateurs majeurs).
 * Toute URL qui ne correspond pas à cette liste est rejetée pour prévenir le SSRF.
 */
const ALLOWED_PUSH_HOSTS = [
  "fcm.googleapis.com",                      // Chrome / Chromium / Android
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",        // Firefox
  "push.services.mozilla.com",
  "notify.windows.com",                       // Edge (MSN, WNS)
  "push.apple.com",                           // Safari / WebKit
  "push.samsungosp.com",                      // Samsung Internet
  "push.opera.com",                           // Opera
];

/**
 * Valide qu'un endpoint push est bien une URL HTTPS d'un service push navigateur connu.
 * Rejette tout IP (prévention SSRF), localhost, et domaines inconnus.
 */
function isValidPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return false;
    const host = url.hostname;

    // Rejeter toutes les adresses IP (IPv4 et IPv6)
    if (/^[\d.]+$/.test(host)) return false; // IPv4
    if (host.startsWith("[") || host === "localhost") return false; // IPv6 / localhost

    // Autoriser uniquement les hôtes des services push connus
    return ALLOWED_PUSH_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
}

/**
 * Authenticate a vendor by phone + password.
 * Uses phoneEq() inside Drizzle .where() — correct SQL predicate usage.
 */
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

/* GET /api/push/vapid-public-key */
router.get("/push/vapid-public-key", (_req, res) => {
  res.json({ key: vapidPublicKey });
});

/* POST /api/push/subscribe
   Body: { endpoint, keys: { auth, p256dh } }
   Headers: x-vendor-phone, x-vendor-password
*/
router.post("/push/subscribe", async (req, res) => {
  const phone = req.headers["x-vendor-phone"] as string;
  const password = req.headers["x-vendor-password"] as string;
  if (!phone || !password) { res.status(401).json({ error: "auth required" }); return; }

  const vendor = await authenticateVendor(phone, password);
  if (!vendor) { res.status(401).json({ error: "invalid credentials" }); return; }

  const { endpoint, keys } = req.body as {
    endpoint: string;
    keys: { auth: string; p256dh: string };
  };

  if (!endpoint || !keys?.auth || !keys?.p256dh) {
    res.status(400).json({ error: "endpoint and keys required" });
    return;
  }
  if (!isValidPushEndpoint(endpoint)) {
    res.status(400).json({ error: "endpoint non autorisé" });
    return;
  }

  // Upsert subscription (delete old entry for this endpoint first)
  await db
    .delete(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint));

  await db.insert(pushSubscriptionsTable).values({
    vendorId: vendor.id,
    endpoint,
    keys,
  });

  res.json({ ok: true });
});

/* POST /api/push/unsubscribe
   Body: { endpoint }
*/
router.post("/push/unsubscribe", async (req, res) => {
  const phone = req.headers["x-vendor-phone"] as string;
  const password = req.headers["x-vendor-password"] as string;
  if (!phone || !password) { res.status(401).json({ error: "auth required" }); return; }
  const vendor = await authenticateVendor(phone, password);
  if (!vendor) { res.status(401).json({ error: "invalid credentials" }); return; }
  const { endpoint } = req.body as { endpoint: string };
  if (!endpoint || !isValidPushEndpoint(endpoint)) { res.status(400).json({ error: "endpoint invalid" }); return; }
  await db
    .delete(pushSubscriptionsTable)
    .where(and(
      eq(pushSubscriptionsTable.endpoint, endpoint),
      eq(pushSubscriptionsTable.vendorId, vendor.id),
    ));
  res.json({ ok: true });
});

/* POST /api/push/buyer-subscribe
   Headers: x-buyer-token, x-conversation-id
   Body: { endpoint, keys: { auth, p256dh } }
   Authenticated by buyerToken matching the conversation.
*/
router.post("/push/buyer-subscribe", async (req, res) => {
  const buyerToken = req.headers["x-buyer-token"] as string | undefined;
  const convIdStr = req.headers["x-conversation-id"] as string | undefined;
  if (!buyerToken || !convIdStr) {
    res.status(401).json({ error: "x-buyer-token and x-conversation-id headers required" });
    return;
  }
  const convId = parseInt(convIdStr, 10);
  if (isNaN(convId)) { res.status(400).json({ error: "invalid conversation id" }); return; }

  // Verify the token belongs to this conversation
  const convRows = await db
    .select({ buyerToken: conversationsTable.buyerToken })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, convId))
    .limit(1);
  if (!convRows.length || convRows[0].buyerToken !== buyerToken) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { endpoint, keys } = req.body as {
    endpoint: string;
    keys: { auth: string; p256dh: string };
  };
  if (!endpoint || !keys?.auth || !keys?.p256dh) {
    res.status(400).json({ error: "endpoint and keys required" });
    return;
  }
  if (!isValidPushEndpoint(endpoint)) {
    res.status(400).json({ error: "endpoint non autorisé" });
    return;
  }

  // Upsert: supprimer uniquement le doublon exact (convId + endpoint), pas les autres conversations
  await db
    .delete(buyerPushSubscriptionsTable)
    .where(and(
      eq(buyerPushSubscriptionsTable.endpoint, endpoint),
      eq(buyerPushSubscriptionsTable.conversationId, convId),
    ));

  await db.insert(buyerPushSubscriptionsTable).values({
    conversationId: convId,
    endpoint,
    keys,
  });

  res.json({ ok: true });
});

/* POST /api/push/buyer-unsubscribe
   Body: { endpoint }
*/
router.post("/push/buyer-unsubscribe", async (req, res) => {
  const buyerToken = req.headers["x-buyer-token"] as string | undefined;
  const convId = Number(req.headers["x-conversation-id"]);
  if (!buyerToken || !Number.isInteger(convId) || convId <= 0) {
    res.status(401).json({ error: "buyer auth required" });
    return;
  }
  const [conversation] = await db
    .select({ buyerToken: conversationsTable.buyerToken })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, convId))
    .limit(1);
  if (!conversation || conversation.buyerToken !== buyerToken) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const { endpoint } = req.body as { endpoint: string };
  if (!endpoint || !isValidPushEndpoint(endpoint)) { res.status(400).json({ error: "endpoint invalid" }); return; }
  await db
    .delete(buyerPushSubscriptionsTable)
    .where(and(
      eq(buyerPushSubscriptionsTable.endpoint, endpoint),
      eq(buyerPushSubscriptionsTable.conversationId, convId),
    ));
  res.json({ ok: true });
});

export default router;
