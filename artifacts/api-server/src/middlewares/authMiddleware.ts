import type { AuthUser } from "@workspace/api-zod";
import { type NextFunction, type Request, type Response } from "express";
import * as oidc from "openid-client";
import {
  clearSession,
  getOidcConfig,
  getSession,
  getSessionId,
  updateSession,
  type SessionData,
} from "../lib/auth";
import { isRejectedRefreshToken } from "./refresh-token";

declare global {
  namespace Express {
    interface User extends AuthUser {}
    interface Request {
      isAuthenticated(): this is AuthedRequest;
      user?: User | undefined;
    }
    interface AuthedRequest {
      user: User;
    }
  }
}

export class SessionServiceError extends Error {
  readonly statusCode = 503;

  constructor(cause: unknown) {
    super("Session service unavailable", { cause });
    this.name = "SessionServiceError";
  }
}

async function refreshIfExpired(sid: string, session: SessionData): Promise<SessionData | null> {
  const now = Math.floor(Date.now() / 1000);
  if (!session.expires_at || now <= session.expires_at) return session;
  if (!session.refresh_token) return null;

  try {
    const tokens = await oidc.refreshTokenGrant(await getOidcConfig(), session.refresh_token);
    session.access_token = tokens.access_token;
    session.refresh_token = tokens.refresh_token ?? session.refresh_token;
    session.expires_at = tokens.expiresIn() ? now + tokens.expiresIn()! : session.expires_at;
    await updateSession(sid, session);
    return session;
  } catch (error) {
    if (isRejectedRefreshToken(error)) {
      return null;
    }
    throw error;
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  const sid = getSessionId(req);
  if (!sid) return next();

  try {
    const session = await getSession(sid);
    if (!session?.user?.id) {
      await clearSession(res, sid);
      return next();
    }
    const refreshed = await refreshIfExpired(sid, session);
    if (!refreshed) {
      await clearSession(res, sid);
      return next();
    }
    req.user = refreshed.user;
  } catch (error) {
    req.log?.error({ err: error }, "Session lookup or refresh failed");
    return next(new SessionServiceError(error));
  }
  return next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}