import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";

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