import { Router, type IRouter } from "express";
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
import servicesRouter from "./services";
import fedapayRouter from "./fedapay";

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
router.use(eventsRouter);
router.use(contactRequestsRouter);
router.use(assistantRouter);
router.use(servicesRouter);
router.use(fedapayRouter);

export default router;
