import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import { SessionServiceError } from "./middlewares/authMiddleware";
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
  optionalAuthMiddleware?: RequestHandler;
};

function zodIssueMessages(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { name?: string; issues?: Array<{ message?: string }> };
  if (candidate.name !== "ZodError" || !Array.isArray(candidate.issues)) return null;
  const detail = candidate.issues.map((issue) => issue.message).filter(Boolean).join("; ");
  return detail || "Invalid request payload.";
}

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
  app.use("/api", createRouter({
    authMiddleware: options.requireAuthMiddleware,
    optionalAuthMiddleware: options.optionalAuthMiddleware,
  }));

  app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
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
    const zodDetail = zodIssueMessages(error);
    if (zodDetail) {
      return res.status(400).json({
        error: zodDetail.startsWith("Invalid request") ? zodDetail : `Invalid request: ${zodDetail}`,
      });
    }
    // API clients expect JSON. Express' default HTML 500 page surfaces as
    // "HTTP 500: <!DOCTYPE html>..." in the statement-line Post button.
    if (!res.headersSent) {
      logger.error({ err: error, method: req.method, url: req.url?.split("?")[0] }, "Unhandled API error");
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : "Internal server error";
      return res.status(500).json({ error: message });
    }
    return next(error);
  });

  return app;
}
