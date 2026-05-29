import { Router, type IRouter } from "express";
import { lt } from "drizzle-orm";
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

const router: IRouter = Router();

router.use(healthRouter);
router.use(listingsRouter);
router.use(ordersRouter);
router.use(adminRouter);
router.use(statsRouter);
router.use(settingsRouter);
router.use(adsRouter);
router.use(vendorsRouter);
router.use(storageRouter);

async function cleanupOldListings() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(listingsTable)
    .where(lt(listingsTable.createdAt, cutoff))
    .returning({ id: listingsTable.id });
  if (deleted.length > 0) {
    logger.info({ count: deleted.length }, "Cleaned up listings older than 30 days");
  }
}

cleanupOldListings().catch((err) => logger.error({ err }, "Startup cleanup failed"));
setInterval(() => {
  cleanupOldListings().catch((err) => logger.error({ err }, "Periodic cleanup failed"));
}, 60 * 60 * 1000);

export default router;
