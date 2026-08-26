import { Router, type IRouter, type RequestHandler } from "express";
import healthRouter from "./health";
import agaraccountingRouter from "./agaraccounting";
import storageRouter from "./storage";
import { requireAuth } from "../middlewares/authMiddleware";

export function createRouter(authMiddleware: RequestHandler = requireAuth): IRouter {
  const router: IRouter = Router();

  router.use(healthRouter);
  router.use(authMiddleware);
  router.use(storageRouter);
  router.use(agaraccountingRouter);

  return router;
}

export default createRouter();
