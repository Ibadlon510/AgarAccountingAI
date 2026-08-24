import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";

let server: Server | undefined;
let baseUrl = "";
let database: typeof import("@workspace/db") | undefined;
const userIds = [`workspace-a-${randomUUID()}`, `workspace-b-${randomUUID()}`];
const clientIds: number[] = [];

function testDatabaseUrl() {
  const value = process.env.LEDGERFLOW_TEST_DATABASE_URL;
  if (!value) throw new Error("LEDGERFLOW_TEST_DATABASE_URL is required for LedgerFlow integration tests.");
  const databaseName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) {
    throw new Error("The LedgerFlow integration test database name must contain 'test'.");
  }
  return value;
}

async function request<T>(path: string, userId: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-user-id": userId,
      ...init?.headers,
    },
  });
  return { response, body: await response.json() as T };
}

before(async () => {
  process.env.DATABASE_URL = testDatabaseUrl();
  const { createApp } = await import("../src/app");
  const { createRequireAuth } = await import("../src/middlewares/authMiddleware");
  database = await import("@workspace/db");
  const app = createApp({
    clerkAuthMiddleware: (_req, _res, next) => next(),
    requireAuthMiddleware: createRequireAuth((req) => ({
      sessionClaims: { userId: req.headers["x-test-user-id"] },
    })),
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
  if (database) {
    if (clientIds.length) {
      await database.db.delete(database.journalEntriesTable).where(inArray(database.journalEntriesTable.clientId, clientIds));
      await database.db.delete(database.statementImportsTable).where(inArray(database.statementImportsTable.clientId, clientIds));
      await database.db.delete(database.statementLinesTable).where(inArray(database.statementLinesTable.clientId, clientIds));
      await database.db.delete(database.bankAccountsTable).where(inArray(database.bankAccountsTable.clientId, clientIds));
      await database.db.delete(database.clientWorkspacesTable).where(inArray(database.clientWorkspacesTable.clientId, clientIds));
      await database.db.delete(database.clientsTable).where(inArray(database.clientsTable.id, clientIds));
    }
    await database.db.delete(database.usersTable).where(inArray(database.usersTable.id, userIds));
  }
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
});

test("provisions distinct empty workspaces and enforces client boundaries", async () => {
  const [first, second] = await Promise.all([
    request<Array<{ id: number; name: string }>>("/clients", userIds[0]),
    request<Array<{ id: number; name: string }>>("/clients", userIds[1]),
  ]);

  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.equal(first.body.length, 1);
  assert.equal(second.body.length, 1);
  assert.notEqual(first.body[0].id, second.body[0].id);
  assert.doesNotMatch(first.body[0].name, /northstar/i);
  assert.doesNotMatch(second.body[0].name, /northstar/i);
  clientIds.push(first.body[0].id, second.body[0].id);

  const firstAgain = await request<Array<{ id: number }>>("/clients", userIds[0]);
  assert.equal(firstAgain.response.status, 200);
  assert.deepEqual(firstAgain.body.map((client) => client.id), [first.body[0].id]);

  const [firstLines, firstEntries, secondLines, secondEntries] = await Promise.all([
    request<unknown[]>(`/ledgerflow/statement-lines?clientId=${first.body[0].id}`, userIds[0]),
    request<unknown[]>(`/ledgerflow/journal-entries?clientId=${first.body[0].id}`, userIds[0]),
    request<unknown[]>(`/ledgerflow/statement-lines?clientId=${second.body[0].id}`, userIds[1]),
    request<unknown[]>(`/ledgerflow/journal-entries?clientId=${second.body[0].id}`, userIds[1]),
  ]);
  for (const result of [firstLines, firstEntries, secondLines, secondEntries]) {
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, []);
  }

  const foreignClientId = first.body[0].id;
  const [lines, entries, report, update, upload] = await Promise.all([
    request<{ error: string }>(`/ledgerflow/statement-lines?clientId=${foreignClientId}`, userIds[1]),
    request<{ error: string }>(`/ledgerflow/journal-entries?clientId=${foreignClientId}`, userIds[1]),
    request<{ error: string }>(`/ledgerflow/financial-statements?clientId=${foreignClientId}`, userIds[1]),
    request<{ error: string }>(`/clients/${foreignClientId}`, userIds[1], {
      method: "PATCH",
      body: JSON.stringify({ name: "Attempted change" }),
    }),
    request<{ error: string }>("/ledgerflow/import-statement", userIds[1], {
      method: "POST",
      body: JSON.stringify({
        clientId: foreignClientId,
        fileName: "statement.csv",
        mimeType: "text/csv",
        objectPath: `uploads/${userIds[1]}/${foreignClientId}/statement.csv`,
        currency: "AED",
      }),
    }),
  ]);
  for (const result of [lines, entries, report, update, upload]) {
    assert.equal(result.response.status, 403);
    assert.match(result.body.error, /access|assigned/i);
  }

  assert.ok(database);
  const [firstWorkspace] = await database.db.select().from(database.clientWorkspacesTable)
    .where(eq(database.clientWorkspacesTable.clientId, first.body[0].id));
  const [secondWorkspace] = await database.db.select().from(database.clientWorkspacesTable)
    .where(eq(database.clientWorkspacesTable.clientId, second.body[0].id));
  assert.equal(firstWorkspace.userId, userIds[0]);
  assert.equal(secondWorkspace.userId, userIds[1]);
});