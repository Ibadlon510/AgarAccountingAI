import { clerkClient, getAuth } from "@clerk/express";
import { db, systemRateAdminsTable, usersTable, type User as DbUser } from "@workspace/db";
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

type ClerkIdentity = {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
};

async function bootstrapSystemRateAdmin(dbUser: DbUser) {
  const email = dbUser.email?.trim().toLowerCase();
  if (!email) return;
  const configuredEmails = new Set(
    (process.env.LEDGERFLOW_SYSTEM_RATE_ADMIN_BOOTSTRAP_EMAILS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!configuredEmails.has(email)) return;
  await db.insert(systemRateAdminsTable).values({
    userId: dbUser.id,
    status: "active",
  }).onConflictDoUpdate({
    target: systemRateAdminsTable.userId,
    set: {
      status: "active",
      revokedAt: null,
    },
  });
}

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
  await bootstrapSystemRateAdmin(dbUser);
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