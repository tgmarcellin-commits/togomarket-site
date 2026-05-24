import { Router, type IRouter } from "express";
import healthRouter from "./health";
import listingsRouter from "./listings";
import ordersRouter from "./orders";
import adminRouter from "./admin";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use(listingsRouter);
router.use(ordersRouter);
router.use(adminRouter);
router.use(statsRouter);

export default router;
