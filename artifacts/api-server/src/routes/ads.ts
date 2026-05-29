import { Router, type IRouter } from "express";
import { gt, lte, eq } from "drizzle-orm";
import { db, adsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "17210";

function mapAd(a: typeof adsTable.$inferSelect) {
  return {
    id: a.id,
    advertiserName: a.advertiserName,
    advertiserPhone: a.advertiserPhone,
    message: a.message,
    image: a.image ?? null,
    videoPath: a.videoPath ?? null,
    startDate: a.startDate.toISOString(),
    endDate: a.endDate.toISOString(),
  };
}

router.get("/ads", async (req, res) => {
  try {
    const now = new Date();
    const ads = await db
      .select()
      .from(adsTable)
      .where(gt(adsTable.endDate, now));
    res.json(ads.map(mapAd));
  } catch (err) {
    req.log.error({ err }, "Failed to get ads");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/ads", async (req, res) => {
  const { password, advertiserName, advertiserPhone, message, image, videoPath } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!advertiserName || !advertiserPhone || !message) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  try {
    const now = new Date();
    const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const [ad] = await db
      .insert(adsTable)
      .values({
        advertiserName,
        advertiserPhone,
        message,
        image: image ?? null,
        videoPath: videoPath ?? null,
        startDate: now,
        endDate,
      })
      .returning();
    return res.status(201).json(mapAd(ad));
  } catch (err) {
    req.log.error({ err }, "Failed to create ad");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/ads/all", async (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const ads = await db.select().from(adsTable).orderBy(adsTable.endDate);
    return res.json(ads.map(mapAd));
  } catch (err) {
    req.log.error({ err }, "Failed to get all ads");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/ads/delete", async (req, res) => {
  const { id, password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    await db.delete(adsTable).where(eq(adsTable.id, id));
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete ad");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
