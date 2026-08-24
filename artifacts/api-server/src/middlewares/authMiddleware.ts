import { getAuth } from "@clerk/express";
import { db, usersTable, type User as DbUser } from "@workspace/db";
import { eq } from "drizzle-orm";
import { type NextFunction, type Request, type Response } from "express";
import { ensureUserWorkspace } from "../routes/ledgerflow";

declare global {
  namespace Express {
    interface Request {
      dbUser?: DbUser;
    }
  }
}

async function provisionLocalUser(userId: string): Promise<DbUser> {
  let [dbUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!dbUser) {
    const [inserted] = await db
      .insert(usersTable)
      // Clerk owns identity fields. The local row keeps the legacy ID bridge
      // and app-specific state; nullable identity columns remain untouched.
      .values({ id: userId })
      .onConflictDoNothing()
      .returning();
    dbUser = inserted;
  }

  if (!dbUser) {
    [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
  }

  if (!dbUser) {
    throw new Error("Could not provision the local user record.");
  }

  await ensureUserWorkspace(dbUser.id);
  return dbUser;
}

export class SessionServiceError extends Error {
  readonly statusCode = 503;

  constructor(cause: unknown) {
    super("Session service unavailable", { cause });
    this.name = "SessionServiceError";
  }
}

type RequestAuth = {
  userId?: unknown;
  sessionClaims?: unknown;
};

export const requireAuth = createRequireAuth();

export function createRequireAuth(readAuth?: (request: Request) => RequestAuth) {
  return async function requireAuth(req: Request, res: Response, next: NextFunction) {
    let auth: RequestAuth;
    try {
      auth = readAuth ? readAuth(req) : getAuth(req);
    } catch (error) {
      req.log?.error({ err: error }, "Clerk session lookup failed");
      next(new SessionServiceError(error));
      return;
    }

    const sessionClaims = auth.sessionClaims as { userId?: unknown; sub?: unknown } | null | undefined;
    // Migrated Clerk users carry their former Replit subject in the configured
    // session claim. Prefer it so existing local records and memberships remain
    // addressable; new Clerk users fall back to Clerk's verified native ID.
    const userId = typeof sessionClaims?.userId === "string"
      ? sessionClaims.userId
      : typeof auth.userId === "string"
        ? auth.userId
        : typeof sessionClaims?.sub === "string"
          ? sessionClaims.sub
          : null;

    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      req.dbUser = await provisionLocalUser(userId);
      next();
    } catch (error) {
      req.log?.error({ err: error }, "Local user provisioning failed");
      next(error);
    }
  };
}