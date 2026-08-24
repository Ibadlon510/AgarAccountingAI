import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";

let server: Server | undefined;
let baseUrl: string;
let database: typeof import("@workspace/db") | undefined;
let poolClosed = false;

function testDatabaseUrl() {
  const value = process.env.LEDGERFLOW_TEST_DATABASE_URL;
  if (!value) throw new Error("LEDGERFLOW_TEST_DATABASE_URL is required for LedgerFlow integration tests.");

  const databaseName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) {
    throw new Error("The LedgerFlow integration test database name must contain 'test'.");
  }
  return value;
}

before(async () => {
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.SESSION_SECRET ??= "ledgerflow-test-session-secret";
  const app = (await import("../src/app")).default;
  database = await import("@workspace/db");
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
  if (database && !poolClosed) await database.pool.end();
});

test("returns a recovery response when session lookup is unavailable", async () => {
  assert.ok(database);
  await database.pool.end();
  poolClosed = true;

  const response = await fetch(`${baseUrl}/auth/user`, {
    headers: { authorization: "Bearer session-lookup-regression" },
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Session service unavailable" });
});