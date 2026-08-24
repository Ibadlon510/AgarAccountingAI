import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { SESSION_SECRET } from "./lib/auth";
import { SessionServiceError } from "./middlewares/authMiddleware";
import { ensureLedgerflowAuditImmutability } from "@workspace/db";

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
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser(SESSION_SECRET));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const bodyError = error as { type?: string; status?: number };
  if (bodyError.type === "entity.too.large" || bodyError.status === 413) {
    return res.status(413).json({
      error: "Request payload is too large.",
    });
  }
  if (error instanceof SessionServiceError) {
    return res.status(error.statusCode).json({
      error: "Session service unavailable",
    });
  }
  return next(error);
});

export default app;
