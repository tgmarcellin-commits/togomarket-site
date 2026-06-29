import { Router, type IRouter } from "express";
import { gt, eq } from "drizzle-orm";
import { db, servicesTable } from "@workspace/db";
import { isAdminOrSubAdmin } from "../lib/auth-sub";

const router: IRouter = Router();

function mapService(s: typeof servicesTable.$inferSelect) {
  return {
    id: s.id,
    type: s.type,
    title: s.title,
    description: s.description,
    contact: s.contact,
    quartier: s.quartier,
    ville: s.ville,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
  };
}

router.get("/services", async (req, res) => {
  try {
    const now = new Date();
    const services = await db
      .select()
      .from(servicesTable)
      .where(gt(servicesTable.expiresAt, now))
      .orderBy(servicesTable.createdAt);
    res.json(services.map(mapService));
  } catch (err) {
    req.log.error({ err }, "Failed to get services");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/services", async (req, res) => {
  const { password, type, title, description, contact, quartier, ville } = req.body;
  if (!await isAdminOrSubAdmin(password)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!type || !title || !description || !contact || !quartier || !ville) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (type !== "seeker" && type !== "offer") {
    return res.status(400).json({ error: "type must be seeker or offer" });
  }
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const [service] = await db
      .insert(servicesTable)
      .values({ type, title, description, contact, quartier, ville, createdAt: now, expiresAt })
      .returning();
    return res.status(201).json(mapService(service));
  } catch (err) {
    req.log.error({ err }, "Failed to create service");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/services/all", async (req, res) => {
  const { password } = req.body;
  if (!await isAdminOrSubAdmin(password)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const services = await db
      .select()
      .from(servicesTable)
      .orderBy(servicesTable.expiresAt);
    return res.json(services.map(mapService));
  } catch (err) {
    req.log.error({ err }, "Failed to get all services");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/services/delete", async (req, res) => {
  const { id, password } = req.body;
  if (!await isAdminOrSubAdmin(password)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    await db.delete(servicesTable).where(eq(servicesTable.id, id));
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete service");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
