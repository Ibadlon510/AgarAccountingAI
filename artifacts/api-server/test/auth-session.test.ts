import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";

let server: Server | undefined;
let baseUrl: string;

before(async () => {
  const { createApp } = await import("../src/app");
  const { createRequireAuth } = await import("../src/middlewares/authMiddleware");
  const app = createApp({
    clerkAuthMiddleware: (_req, _res, next) => next(),
    requireAuthMiddleware: createRequireAuth(() => {
      throw new Error("Clerk session lookup unavailable");
    }),
  });
  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, () => resolve(listener));
    listener.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}/api`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("returns a recovery response when Clerk session lookup is unavailable", async () => {
  const response = await fetch(`${baseUrl}/clients`);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Session service unavailable" });
});

test("reuses the existing verified-email account when the Clerk subject changes", async () => {
  const database = await import("@workspace/db");
  const { createApp } = await import("../src/app");
  const { createRequireAuth } = await import("../src/middlewares/authMiddleware");
  const existingUserId = `legacy-${randomUUID()}`;
  const clerkUserId = `user_${randomUUID()}`;
  const email = `clerk-bridge-${randomUUID()}@example.test`;
  let testServer: Server | undefined;

  await database.db.insert(database.usersTable).values({
    id: existingUserId,
    email,
    firstName: "Existing",
    onboardingMode: "firm",
  });

  try {
    const app = createApp({
      clerkAuthMiddleware: (_req, _res, next) => next(),
      requireAuthMiddleware: createRequireAuth(
        () => ({ userId: clerkUserId, sessionClaims: { sub: clerkUserId } }),
        async () => ({
          email,
          firstName: "Clerk",
          lastName: "User",
        }),
      ),
    });
    testServer = await new Promise<Server>((resolve, reject) => {
      const listener = app.listen(0, () => resolve(listener));
      listener.once("error", reject);
    });
    const address = testServer.address();
    assert.ok(address && typeof address !== "string");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/clients`);
    assert.equal(response.status, 200);

    const linkedUsers = await database.db
      .select({ id: database.usersTable.id })
      .from(database.usersTable)
      .where(eq(database.usersTable.email, email));
    assert.deepEqual(linkedUsers, [{ id: existingUserId }]);
  } finally {
    if (testServer) {
      await new Promise<void>((resolve, reject) => {
        testServer!.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await database.db.delete(database.usersTable).where(eq(database.usersTable.id, existingUserId));
  }
});