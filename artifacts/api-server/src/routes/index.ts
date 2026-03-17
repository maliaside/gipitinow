import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountsRouter from "./accounts";
import proxiesRouter from "./proxies";
import tasksRouter from "./tasks";
import statsRouter from "./stats";
import settingsRouter from "./settings";
import manualRouter from "./manual";
import autoRouter from "./auto";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accountsRouter);
router.use(proxiesRouter);
router.use(tasksRouter);
router.use(statsRouter);
router.use(settingsRouter);
router.use(manualRouter);
router.use(autoRouter);

export default router;
