import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";

let server: Server | undefined;
let baseUrl = "";
let database: typeof import("@workspace/db") | undefined;
const userIds = [
  `workspace-a-${randomUUID()}`,
  `workspace-b-${randomUUID()}`,
  `legacy-demo-${randomUUID()}`,
  `shared-demo-owner-${randomUUID()}`,
  `shared-demo-member-${randomUUID()}`,
  `mixed-workspace-owner-${randomUUID()}`,
  `edited-demo-owner-${randomUUID()}`,
  `converted-demo-owner-${randomUUID()}`,
  `configured-demo-owner-${randomUUID()}`,
];
const clientIds: number[] = [];
const legacyDemoRows = [
  { date: "2026-08-03", description: "EMIRATES AIRLINES", currency: "AED", amount: "1840.00", direction: "outflow", status: "posted", accountSuggestion: "Travel & entertainment", confidence: "0.98" },
  { date: "2026-08-05", description: "STRIPE PAYOUT 8472", currency: "USD", amount: "12450.00", direction: "inflow", status: "posted", accountSuggestion: "Revenue", confidence: "0.99" },
  { date: "2026-08-07", description: "AWS EMEA", currency: "USD", amount: "624.50", direction: "outflow", status: "needs_review", accountSuggestion: "Software & subscriptions", confidence: "0.91" },
  { date: "2026-08-10", description: "AL FARAJ OFFICE SUPPLIES", currency: "AED", amount: "389.00", direction: "outflow", status: "needs_review", accountSuggestion: "Office expenses", confidence: "0.87" },
  { date: "2026-08-12", description: "CLIENT RETAINER — NORTHSTAR", currency: "AED", amount: "28750.00", direction: "inflow", status: "posted", accountSuggestion: "Revenue", confidence: "0.97" },
  { date: "2026-08-15", description: "GULF TELECOM", currency: "AED", amount: "475.00", direction: "outflow", status: "needs_review", accountSuggestion: "Communication expenses", confidence: "0.84" },
] as const;

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

async function seedLegacyDemoWorkspace(ownerId: string, memberIds = [ownerId]) {
  assert.ok(database);
  const [client] = await database.db.insert(database.clientsTable).values({
    name: "Northstar Advisory",
    legalName: "Northstar Advisory FZ-LLC",
    functionalCurrency: "AED",
    basis: "IFRS",
    period: "August 2026",
  }).returning();
  clientIds.push(client.id);
  await database.db.insert(database.clientWorkspacesTable).values(memberIds.map((userId) => ({ clientId: client.id, userId })));
  const lines = await database.db.insert(database.statementLinesTable).values(legacyDemoRows.map((row) => ({
    ...row,
    clientId: client.id,
    source: "Bank statement",
  }))).returning();
  await database.db.insert(database.journalEntriesTable).values(lines.map((line) => ({
    clientId: client.id,
    statementLineId: line.id,
    date: line.date,
    memo: line.description,
    currency: line.currency,
    status: line.status === "posted" ? "posted" : "suggested",
    confidence: line.confidence ?? "0.80",
    debitAccount: line.direction === "inflow" ? "Bank / cash" : (line.accountSuggestion ?? "Uncategorized"),
    creditAccount: line.direction === "inflow" ? (line.accountSuggestion ?? "Uncategorized") : "Bank / cash",
    amount: line.amount,
  })));
  return client;
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
      await database.db.delete(database.aiProviderConfigsTable).where(inArray(database.aiProviderConfigsTable.clientId, clientIds));
      await database.db.delete(database.clientWorkspacesTable).where(inArray(database.clientWorkspacesTable.clientId, clientIds));
      await database.db.delete(database.clientsTable).where(inArray(database.clientsTable.id, clientIds));
    }
    await database.db.delete(database.exchangeRatesTable).where(inArray(database.exchangeRatesTable.userId, userIds));
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

test("moves only an untouched legacy demo workspace to a clean private workspace", async () => {
  assert.ok(database);
  const legacyUserId = userIds[2];
  await database.db.insert(database.usersTable).values({ id: legacyUserId });
  const legacyClient = await seedLegacyDemoWorkspace(legacyUserId);
  await database.db.update(database.usersTable)
    .set({ starterClientId: legacyClient.id })
    .where(eq(database.usersTable.id, legacyUserId));

  const firstVisit = await request<Array<{ id: number; name: string; legacyDemo: boolean }>>("/clients", legacyUserId);
  assert.equal(firstVisit.response.status, 200);
  assert.equal(firstVisit.body.length, 2);
  const preservedWorkspace = firstVisit.body.find((client) => client.id === legacyClient.id);
  const cleanWorkspace = firstVisit.body.find((client) => !client.legacyDemo);
  assert.equal(preservedWorkspace?.legacyDemo, true);
  assert.ok(cleanWorkspace);
  assert.match(cleanWorkspace.name, /private workspace/i);
  clientIds.push(cleanWorkspace.id);

  const [starter] = await database.db.select({
    starterClientId: database.usersTable.starterClientId,
    remediatedLegacyClientId: database.usersTable.remediatedLegacyClientId,
  })
    .from(database.usersTable)
    .where(eq(database.usersTable.id, legacyUserId));
  assert.equal(starter.starterClientId, cleanWorkspace.id);
  assert.equal(starter.remediatedLegacyClientId, legacyClient.id);
  const [preservedLines, preservedEntries] = await Promise.all([
    database.db.select().from(database.statementLinesTable).where(eq(database.statementLinesTable.clientId, legacyClient.id)),
    database.db.select().from(database.journalEntriesTable).where(eq(database.journalEntriesTable.clientId, legacyClient.id)),
  ]);
  assert.equal(preservedLines.length, legacyDemoRows.length);
  assert.equal(preservedEntries.length, legacyDemoRows.length);

  const repeatVisit = await request<Array<{ id: number; legacyDemo: boolean }>>("/clients", legacyUserId);
  assert.equal(repeatVisit.response.status, 200);
  assert.deepEqual(repeatVisit.body.map((client) => client.id).sort(), firstVisit.body.map((client) => client.id).sort());
  assert.equal(repeatVisit.body.filter((client) => !client.legacyDemo).length, 1);
});

test("does not remediate an exact demo-shaped workspace that is intentionally shared", async () => {
  assert.ok(database);
  const [ownerId, memberId] = [userIds[3], userIds[4]];
  await database.db.insert(database.usersTable).values([{ id: ownerId }, { id: memberId }]);
  const sharedClient = await seedLegacyDemoWorkspace(ownerId, [ownerId, memberId]);
  await database.db.update(database.usersTable)
    .set({ starterClientId: sharedClient.id })
    .where(eq(database.usersTable.id, ownerId));

  const response = await request<Array<{ id: number; legacyDemo: boolean }>>("/clients", ownerId);
  assert.equal(response.response.status, 200);
  assert.deepEqual(response.body, [{
    id: sharedClient.id,
    name: "Northstar Advisory",
    legalName: "Northstar Advisory FZ-LLC",
    functionalCurrency: "AED",
    basis: "IFRS",
    period: "August 2026",
    legacyDemo: false,
  }]);
  const [owner] = await database.db.select({ starterClientId: database.usersTable.starterClientId })
    .from(database.usersTable)
    .where(eq(database.usersTable.id, ownerId));
  assert.equal(owner.starterClientId, sharedClient.id);
});

test("does not remediate a legacy-shaped starter when the account also owns another workspace", async () => {
  assert.ok(database);
  const ownerId = userIds[5];
  await database.db.insert(database.usersTable).values({ id: ownerId });
  const legacyClient = await seedLegacyDemoWorkspace(ownerId);
  const [realClient] = await database.db.insert(database.clientsTable).values({
    name: "Real client workspace",
    legalName: "Real Client FZ-LLC",
    functionalCurrency: "AED",
    basis: "IFRS",
    period: "August 2026",
  }).returning();
  clientIds.push(realClient.id);
  await database.db.insert(database.clientWorkspacesTable).values({ clientId: realClient.id, userId: ownerId });
  await database.db.insert(database.statementLinesTable).values({
    clientId: realClient.id,
    date: "2026-08-20",
    description: "REAL CLIENT BANK ACTIVITY",
    currency: "AED",
    amount: "100.00",
    direction: "inflow",
    status: "needs_review",
    source: "Manual entry",
  });
  await database.db.update(database.usersTable)
    .set({ starterClientId: realClient.id })
    .where(eq(database.usersTable.id, ownerId));

  const response = await request<Array<{ id: number; legacyDemo: boolean }>>("/clients", ownerId);
  assert.equal(response.response.status, 200);
  assert.deepEqual(response.body.map((client) => client.id).sort(), [legacyClient.id, realClient.id].sort());
  assert.equal(response.body.some((client) => client.legacyDemo), false);
  const [owner] = await database.db.select({ starterClientId: database.usersTable.starterClientId })
    .from(database.usersTable)
    .where(eq(database.usersTable.id, ownerId));
  assert.equal(owner.starterClientId, realClient.id);
});

test("does not remediate a demo workspace after its reporting metadata is changed", async () => {
  assert.ok(database);
  const ownerId = userIds[6];
  await database.db.insert(database.usersTable).values({ id: ownerId });
  const legacyClient = await seedLegacyDemoWorkspace(ownerId);
  await database.db.update(database.clientsTable)
    .set({ period: "September 2026" })
    .where(eq(database.clientsTable.id, legacyClient.id));
  await database.db.update(database.usersTable)
    .set({ starterClientId: legacyClient.id })
    .where(eq(database.usersTable.id, ownerId));

  const response = await request<Array<{ id: number; legacyDemo: boolean }>>("/clients", ownerId);
  assert.equal(response.response.status, 200);
  assert.equal(response.body.length, 1);
  assert.equal(response.body[0].legacyDemo, false);
});

test("does not remediate a demo workspace after the owner configures exchange rates", async () => {
  assert.ok(database);
  const ownerId = userIds[7];
  await database.db.insert(database.usersTable).values({ id: ownerId });
  const legacyClient = await seedLegacyDemoWorkspace(ownerId);
  await database.db.insert(database.exchangeRatesTable).values({
    userId: ownerId,
    sourceCurrency: "USD",
    functionalCurrency: "AED",
    effectiveDate: "2026-08-01",
    rate: "3.6725000000",
    source: "Manual",
  });
  await database.db.update(database.usersTable)
    .set({ starterClientId: legacyClient.id })
    .where(eq(database.usersTable.id, ownerId));

  const response = await request<Array<{ id: number; legacyDemo: boolean }>>("/clients", ownerId);
  assert.equal(response.response.status, 200);
  assert.equal(response.body.length, 1);
  assert.equal(response.body[0].legacyDemo, false);
});

test("does not remediate a demo workspace after its AI provider is configured", async () => {
  assert.ok(database);
  const ownerId = userIds[8];
  await database.db.insert(database.usersTable).values({ id: ownerId });
  const legacyClient = await seedLegacyDemoWorkspace(ownerId);
  await database.db.insert(database.aiProviderConfigsTable).values({
    clientId: legacyClient.id,
    provider: "managed_openai",
    model: "gpt-5.6-luna",
    credentialStatus: "configured",
  });
  await database.db.update(database.usersTable)
    .set({ starterClientId: legacyClient.id })
    .where(eq(database.usersTable.id, ownerId));

  const response = await request<Array<{ id: number; legacyDemo: boolean }>>("/clients", ownerId);
  assert.equal(response.response.status, 200);
  assert.equal(response.body.length, 1);
  assert.equal(response.body[0].legacyDemo, false);
});