import { Router, type IRouter } from "express";
import { lt, eq, and, sql, inArray } from "drizzle-orm";
import { db, listingsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import healthRouter from "./health";
import listingsRouter from "./listings";
import ordersRouter from "./orders";
import adminRouter from "./admin";
import statsRouter from "./stats";
import settingsRouter from "./settings";
import adsRouter from "./ads";
import vendorsRouter from "./vendors";
import storageRouter from "./storage";
import eventsRouter from "./events";
import contactRequestsRouter from "./contact-requests";
import assistantRouter from "./assistant";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

router.use(healthRouter);
router.use(listingsRouter);
router.use(ordersRouter);
router.use(adminRouter);
router.use(statsRouter);
router.use(settingsRouter);
router.use(adsRouter);
router.use(vendorsRouter);
router.use(storageRouter);
router.use(eventsRouter);
router.use(contactRequestsRouter);
router.use(assistantRouter);

const LISTINGS_TARGET = 300;

async function cleanupOldListings() {
  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(listingsTable)
    .where(eq(listingsTable.approved, true));

  if (count <= LISTINGS_TARGET) return;

  const excess = count - LISTINGS_TARGET;
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const candidates = await db
    .select({ id: listingsTable.id, images: listingsTable.images })
    .from(listingsTable)
    .where(and(eq(listingsTable.approved, true), lt(listingsTable.createdAt, cutoff)))
    .orderBy(listingsTable.createdAt)
    .limit(excess);

  if (candidates.length === 0) return;

  const ids = candidates.map((c) => c.id);
  const deleted = await db
    .delete(listingsTable)
    .where(inArray(listingsTable.id, ids))
    .returning({ id: listingsTable.id, images: listingsTable.images });

  const allImages = deleted.flatMap((d) => d.images ?? []);
  if (allImages.length > 0) await objectStorage.deleteObjectEntities(allImages);
  logger.info({ count: deleted.length, total: count }, "Cleanup: removed oldest listings to stay near 300");
}

cleanupOldListings().catch((err) => logger.error({ err }, "Startup cleanup failed"));
setInterval(() => {
  cleanupOldListings().catch((err) => logger.error({ err }, "Periodic cleanup failed"));
}, 60 * 60 * 1000);

export default router;
