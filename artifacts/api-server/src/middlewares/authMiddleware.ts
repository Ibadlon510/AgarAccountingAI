import { clerkClient, getAuth } from "@clerk/express";
import { db, usersTable, type User as DbUser } from "@workspace/db";
import { eq } from "drizzle-orm";
import { type NextFunction, type Request, type Response } from "express";
import { ensureUserWorkspace } from "../routes/agaraccounting";

declare global {
  namespace Express {
    interface Request {
      dbUser?: DbUser;
    }
  }
}

type ClerkIdentity = {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
};

async function provisionLocalUser(userId: string, identity?: ClerkIdentity): Promise<DbUser> {
  let [dbUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!dbUser) {
    const [inserted] = await db
      .insert(usersTable)
      .values({
        id: userId,
        email: identity?.email ?? null,
        firstName: identity?.firstName ?? null,
        lastName: identity?.lastName ?? null,
      })
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
  if (identity && (
    dbUser.email !== identity.email
    || (dbUser.firstName == null && identity.firstName != null)
    || (dbUser.lastName == null && identity.lastName != null)
  )) {
    const [updated] = await db.update(usersTable)
      .set({
        email: identity.email,
        firstName: dbUser.firstName ?? identity.firstName,
        lastName: dbUser.lastName ?? identity.lastName,
      })
      .where(eq(usersTable.id, userId))
      .returning();
    dbUser = updated ?? dbUser;
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
type ClerkIdentityReader = (clerkUserId: string) => Promise<ClerkIdentity>;

export const requireAuth = createRequireAuth();
export const optionalAuth = createOptionalAuth();

export function createRequireAuth(
  readAuth?: (request: Request) => RequestAuth,
  readClerkIdentity?: ClerkIdentityReader,
) {
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
      let identity: ClerkIdentity | undefined;
      if (!readAuth || readClerkIdentity) {
        const clerkUserId = typeof auth.userId === "string"
          ? auth.userId
          : typeof sessionClaims?.sub === "string"
            ? sessionClaims.sub
            : null;
        if (!clerkUserId) {
          res.status(401).json({ error: "Authentication required" });
          return;
        }
        if (readClerkIdentity) {
          identity = await readClerkIdentity(clerkUserId);
        } else {
          const clerkUser = await clerkClient.users.getUser(clerkUserId);
          const primaryEmail = clerkUser.emailAddresses.find((email) =>
            email.id === clerkUser.primaryEmailAddressId && email.verification?.status === "verified",
          )?.emailAddress;
          identity = {
            email: primaryEmail?.toLowerCase() ?? null,
            firstName: clerkUser.firstName ?? null,
            lastName: clerkUser.lastName ?? null,
          };
        }
      }
      req.dbUser = await provisionLocalUser(userId, identity);
      next();
    } catch (error) {
      req.log?.error({ err: error }, "Local user provisioning failed");
      next(error);
    }
  };
}

export function createOptionalAuth(
  readAuth?: (request: Request) => RequestAuth,
  readClerkIdentity?: ClerkIdentityReader,
) {
  return async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
    let auth: RequestAuth;
    try {
      auth = readAuth ? readAuth(req) : getAuth(req);
    } catch {
      next();
      return;
    }

    const sessionClaims = auth.sessionClaims as { userId?: unknown; sub?: unknown } | null | undefined;
    const headerUserId = typeof req.headers["x-test-user-id"] === "string"
      ? req.headers["x-test-user-id"]
      : null;
    const userId = typeof sessionClaims?.userId === "string"
      ? sessionClaims.userId
      : typeof auth.userId === "string"
        ? auth.userId
        : typeof sessionClaims?.sub === "string"
          ? sessionClaims.sub
          : headerUserId;

    if (!userId) {
      next();
      return;
    }

    try {
      let identity: ClerkIdentity | undefined;
      if (!readAuth || readClerkIdentity) {
        const clerkUserId = typeof auth.userId === "string"
          ? auth.userId
          : typeof sessionClaims?.sub === "string"
            ? sessionClaims.sub
            : null;
        if (clerkUserId) {
          if (readClerkIdentity) {
            identity = await readClerkIdentity(clerkUserId);
          } else {
            try {
              const clerkUser = await clerkClient.users.getUser(clerkUserId);
              const primaryEmail = clerkUser.emailAddresses.find((email) =>
                email.id === clerkUser.primaryEmailAddressId && email.verification?.status === "verified",
              )?.emailAddress;
              identity = {
                email: primaryEmail?.toLowerCase() ?? null,
                firstName: clerkUser.firstName ?? null,
                lastName: clerkUser.lastName ?? null,
              };
            } catch {
              identity = undefined;
            }
          }
        }
      }
      req.dbUser = await provisionLocalUser(userId, identity);
    } catch (error) {
      req.log?.error({ err: error }, "Optional auth user provisioning failed");
    }
    next();
  };
}