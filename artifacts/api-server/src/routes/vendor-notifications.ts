import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, vendorNotificationsTable } from "@workspace/db";
import { authenticateVendorRequest } from "../lib/vendor-auth";

const router: IRouter = Router();

/* GET /api/vendor/notifications */
router.get("/vendor/notifications", async (req, res) => {
  const vendor = await authenticateVendorRequest(req);
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
  const vendor = await authenticateVendorRequest(req);
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
  const vendor = await authenticateVendorRequest(req);
  if (!vendor) { res.status(401).json({ error: "invalid credentials" }); return; }

  await db
    .update(vendorNotificationsTable)
    .set({ isRead: true })
    .where(eq(vendorNotificationsTable.vendorId, vendor.id));

  res.json({ ok: true });
});

/* DELETE /api/vendor/notifications/:id */
router.delete("/vendor/notifications/:id", async (req, res) => {
  const vendor = await authenticateVendorRequest(req);
  if (!vendor) { res.status(401).json({ error: "invalid credentials" }); return; }

  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  await db
    .delete(vendorNotificationsTable)
    .where(and(eq(vendorNotificationsTable.id, id), eq(vendorNotificationsTable.vendorId, vendor.id)));

  res.json({ ok: true });
});

export default router;
