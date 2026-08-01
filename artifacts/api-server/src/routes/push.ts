import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, pushSubscriptionsTable, vendorsTable } from "@workspace/db";
import bcrypt from "bcryptjs";
import { vapidPublicKey } from "../lib/webpush";
import { normalizePhone, phoneEq } from "../lib/phone";

const router: IRouter = Router();

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
  const { endpoint } = req.body as { endpoint: string };
  if (!endpoint) { res.status(400).json({ error: "endpoint required" }); return; }
  await db
    .delete(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint));
  res.json({ ok: true });
});

export default router;
