import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import { SessionServiceError } from "./middlewares/authMiddleware";
import { ensureLedgerflowAuditImmutability } from "@workspace/db";
import express, { type Express, type RequestHandler } from "express";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { createRouter } from "./routes";

const app = createApp();
export default app;

type AppOptions = {
  clerkAuthMiddleware?: RequestHandler;
  requireAuthMiddleware?: RequestHandler;
};

export function createApp(options: AppOptions = {}): Express {
  const app: Express = express();

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
    }),
  );
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
  app.use(cors({ credentials: true, origin: true }));
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    options.clerkAuthMiddleware ??
      clerkMiddleware((req) => ({
        publishableKey: publishableKeyFromHost(
          getClerkProxyHost(req) ?? "",
          process.env.CLERK_PUBLISHABLE_KEY,
        ),
      })),
  );
  app.use("/api", createRouter(options.requireAuthMiddleware));

  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    const bodyError = error as { type?: string; status?: number };
    if (bodyError.type === "entity.too.large" || bodyError.status === 413) {
      return res.status(413).json({
        error: "Statement file is too large. Please choose a file smaller than 15 MB.",
      });
    }
    if (error instanceof SessionServiceError) {
      return res.status(error.statusCode).json({
        error: "Session service unavailable",
      });
    }
    return next(error);
  });

  return app;
}
