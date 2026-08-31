import { Router, type IRouter, type RequestHandler } from "express";
import healthRouter from "./health";
import agaraccountingRouter from "./agaraccounting";
import storageRouter from "./storage";
import { feedbackAuthRouter, feedbackPublicRouter } from "./feedback";
import publicStatementLineRequestsRouter from "./statementLineRequests";
import { optionalAuth, requireAuth } from "../middlewares/authMiddleware";

type RouterAuthOptions = {
  authMiddleware?: RequestHandler;
  optionalAuthMiddleware?: RequestHandler;
};

export function createRouter(
  authOrOptions: RequestHandler | RouterAuthOptions = requireAuth,
): IRouter {
  const authMiddleware = typeof authOrOptions === "function"
    ? authOrOptions
    : (authOrOptions.authMiddleware ?? requireAuth);
  const optionalAuthMiddleware = typeof authOrOptions === "function"
    ? optionalAuth
    : (authOrOptions.optionalAuthMiddleware ?? optionalAuth);

  const router: IRouter = Router();
  const publicFeedback = Router();
  publicFeedback.use(optionalAuthMiddleware);
  publicFeedback.use(feedbackPublicRouter);

  router.use(healthRouter);
  router.use(publicFeedback);
  router.use(publicStatementLineRequestsRouter);
  router.use(authMiddleware);
  router.use(storageRouter);
  router.use(feedbackAuthRouter);
  router.use(agaraccountingRouter);

  return router;
}

export default createRouter();
