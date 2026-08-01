import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, vendorNotificationsTable, vendorsTable } from "@workspace/db";
import bcrypt from "bcryptjs";
import { normalizePhone, phoneEq } from "../lib/phone";

const router: IRouter = Router();

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

/* GET /api/vendor/notifications */
router.get("/vendor/notifications", async (req, res) => {
  const phone = req.headers["x-vendor-phone"] as string;
  const password = req.headers["x-vendor-password"] as string;
  if (!phone || !password) { res.status(401).json({ error: "auth required" }); return; }
  const vendor = await authenticateVendor(phone, password);
  if (!vendor) { res.status(401).json({ error: "invalid credentials" }); return; }

  const notifs = await db
    .select()
    .from(vendorNotificationsTable)
    .where(eq(vendorNotificationsTable.vendorId, vendor.id))
    .orderBy(desc(vendorNotificationsTable.createdAt))
    .limit(50);

  res.json(notifs);
});

/* POST /api/vendor/notifications/:id/read */
router.post("/vendor/notifications/:id/read", async (req, res) => {
  const phone = req.headers["x-vendor-phone"] as string;
  const password = req.headers["x-vendor-password"] as string;
  if (!phone || !password) { res.status(401).json({ error: "auth required" }); return; }
  const vendor = await authenticateVendor(phone, password);
  if (!vendor) { res.status(401).json({ error: "invalid credentials" }); return; }

  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  await db
    .update(vendorNotificationsTable)
    .set({ isRead: true })
    .where(and(eq(vendorNotificationsTable.id, id), eq(vendorNotificationsTable.vendorId, vendor.id)));

  res.json({ ok: true });
});

/* POST /api/vendor/notifications/read-all */
router.post("/vendor/notifications/read-all", async (req, res) => {
  const phone = req.headers["x-vendor-phone"] as string;
  const password = req.headers["x-vendor-password"] as string;
  if (!phone || !password) { res.status(401).json({ error: "auth required" }); return; }
  const vendor = await authenticateVendor(phone, password);
  if (!vendor) { res.status(401).json({ error: "invalid credentials" }); return; }

  await db
    .update(vendorNotificationsTable)
    .set({ isRead: true })
    .where(eq(vendorNotificationsTable.vendorId, vendor.id));

  res.json({ ok: true });
});

/* DELETE /api/vendor/notifications/:id */
router.delete("/vendor/notifications/:id", async (req, res) => {
  const phone = req.headers["x-vendor-phone"] as string;
  const password = req.headers["x-vendor-password"] as string;
  if (!phone || !password) { res.status(401).json({ error: "auth required" }); return; }
  const vendor = await authenticateVendor(phone, password);
  if (!vendor) { res.status(401).json({ error: "invalid credentials" }); return; }

  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  await db
    .delete(vendorNotificationsTable)
    .where(and(eq(vendorNotificationsTable.id, id), eq(vendorNotificationsTable.vendorId, vendor.id)));

  res.json({ ok: true });
});

export default router;
