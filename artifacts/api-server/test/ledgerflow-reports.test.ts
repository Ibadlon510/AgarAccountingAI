import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";

let server: Server | undefined;
let baseUrl = "";
let database: typeof import("@workspace/db") | undefined;
let primaryUserId = "";
let secondaryUserId = "";
let clientId: number | undefined;

function testDatabaseUrl() {
  const value = process.env.LEDGERFLOW_TEST_DATABASE_URL;
  if (!value) throw new Error("LEDGERFLOW_TEST_DATABASE_URL is required for LedgerFlow integration tests.");
  const databaseName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) {
    throw new Error("The LedgerFlow integration test database name must contain 'test'.");
  }
  return value;
}

async function request<T>(path: string, init?: RequestInit, userId = primaryUserId) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-user-id": userId,
      ...init?.headers,
    },
  });
  return {
    response,
    body: await response.json() as T,
  };
}

before(async () => {
  process.env.DATABASE_URL = testDatabaseUrl();
  const { createApp } = await import("../src/app");
  const { createRequireAuth } = await import("../src/middlewares/authMiddleware");
  database = await import("@workspace/db");
  primaryUserId = `ledgerflow-test-primary-${randomUUID()}`;
  secondaryUserId = `ledgerflow-test-secondary-${randomUUID()}`;
  await database.db.insert(database.usersTable).values([
    { id: primaryUserId, email: `${primaryUserId}@example.test`, firstName: "Primary", lastName: "Test" },
    { id: secondaryUserId, email: `${secondaryUserId}@example.test`, firstName: "Secondary", lastName: "Test" },
  ]);

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
  if (database && clientId) {
    await database.db.delete(database.journalEntriesTable)
      .where(eq(database.journalEntriesTable.clientId, clientId));
    await database.db.delete(database.statementImportsTable)
      .where(eq(database.statementImportsTable.clientId, clientId));
    await database.db.delete(database.statementLinesTable)
      .where(eq(database.statementLinesTable.clientId, clientId));
    await database.db.delete(database.bankAccountsTable)
      .where(eq(database.bankAccountsTable.clientId, clientId));
    await database.db.delete(database.clientWorkspacesTable)
      .where(eq(database.clientWorkspacesTable.clientId, clientId));
    await database.db.delete(database.clientsTable)
      .where(eq(database.clientsTable.id, clientId));
  }
  if (database) {
    await database.db.delete(database.usersTable)
      .where(eq(database.usersTable.id, primaryUserId));
    await database.db.delete(database.usersTable)
      .where(eq(database.usersTable.id, secondaryUserId));
  }
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
});

test("serves client-scoped reports through Clerk session claims", async () => {
  const client = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Report scope ${randomUUID()}`,
      legalName: "Report scope LLC",
    }),
  });
  assert.equal(client.response.status, 201);
  clientId = client.body.id;

  const line = await request<{ id: number }>("/ledgerflow/statement-lines", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-08-24",
      description: "Scoped report transaction",
      currency: "AED",
      amount: 125,
      direction: "outflow",
    }),
  });
  assert.equal(line.response.status, 201);

  const [trialBalance, financialStatements, forbidden] = await Promise.all([
    request<unknown[]>(`/ledgerflow/trial-balance?clientId=${clientId}`),
    request<{ incomeStatement: unknown[] }>(`/ledgerflow/financial-statements?clientId=${clientId}`),
    request<{ error: string }>(`/ledgerflow/trial-balance?clientId=${clientId}`, undefined, secondaryUserId),
  ]);
  assert.equal(trialBalance.response.status, 200);
  assert.equal(financialStatements.response.status, 200);
  assert.equal(forbidden.response.status, 403);
});

type WorkspaceUsageSummary = {
  statementImports: { used: number };
  storedEvidence: { documents: number; bytes: number; status: string };
  aiActivity: { used: number };
  clientWorkspaces: { used: number };
  retention: { statementEvidenceDays: number; aiActivityDays: number; ledgerDataDescription: string };
};

test("reports usage only for the authenticated workspace", async () => {
  const beforePrimary = await request<WorkspaceUsageSummary>("/ledgerflow/usage");
  const beforeSecondary = await request<WorkspaceUsageSummary>("/ledgerflow/usage", undefined, secondaryUserId);
  const created = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({ name: `Usage scope ${randomUUID()}`, legalName: "Usage scope LLC" }),
  });
  assert.equal(created.response.status, 201);

  const [afterPrimary, afterSecondary] = await Promise.all([
    request<WorkspaceUsageSummary>("/ledgerflow/usage"),
    request<WorkspaceUsageSummary>("/ledgerflow/usage", undefined, secondaryUserId),
  ]);
  assert.equal(afterPrimary.response.status, 200);
  assert.equal(afterSecondary.response.status, 200);
  assert.equal(afterPrimary.body.clientWorkspaces.used, beforePrimary.body.clientWorkspaces.used + 1);
  assert.equal(afterSecondary.body.clientWorkspaces.used, beforeSecondary.body.clientWorkspaces.used);
  assert.equal(afterSecondary.body.storedEvidence.documents, beforeSecondary.body.storedEvidence.documents);
  assert.equal(afterPrimary.body.retention.statementEvidenceDays, 365);
  assert.equal(afterPrimary.body.retention.aiActivityDays, 90);
});
