import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ledgerflowRouter from "./ledgerflow";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ledgerflowRouter);

export default router;
