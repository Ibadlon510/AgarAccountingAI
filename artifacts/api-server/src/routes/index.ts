import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import ledgerflowRouter from "./ledgerflow";
import storageRouter from "./storage";
import { authMiddleware, requireAuth } from "../middlewares/authMiddleware";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authMiddleware);
router.use(authRouter);
router.use(requireAuth);
router.use(storageRouter);
router.use(ledgerflowRouter);

export default router;
