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
  `historic-starter-owner-${randomUUID()}`,
  `historic-starter-new-${randomUUID()}`,
  `usage-owner-${randomUUID()}`,
  `usage-foreign-${randomUUID()}`,
  `profile-owner-${randomUUID()}`,
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

async function seedPlaceholderStarterWorkspace(ownerId: string, name: string) {
  assert.ok(database);
  const [client] = await database.db.insert(database.clientsTable).values({
    name,
    legalName: "Legal entity to be configured",
    functionalCurrency: "AED",
    basis: "IFRS",
    period: "August 2026",
  }).returning();
  clientIds.push(client.id);
  await database.db.insert(database.clientWorkspacesTable).values({ clientId: client.id, userId: ownerId });
  await database.db.update(database.usersTable)
    .set({ starterClientId: client.id })
    .where(eq(database.usersTable.id, ownerId));
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
      await database.db.delete(database.aiActivityTable).where(inArray(database.aiActivityTable.clientId, clientIds));
      await database.db.delete(database.aiProviderConfigsTable).where(inArray(database.aiProviderConfigsTable.clientId, clientIds));
      await database.db.delete(database.clientWorkspacesTable).where(inArray(database.clientWorkspacesTable.clientId, clientIds));
      await database.db.delete(database.clientsTable).where(inArray(database.clientsTable.id, clientIds));
    }
    await database.db.delete(database.exchangeRatesTable).where(inArray(database.exchangeRatesTable.userId, userIds));
    await database.db.delete(database.usersTable).where(inArray(database.usersTable.id, userIds));
  }
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
});

test("provisions isolated starter workspaces and configures only the owner's workspace", async () => {
  const [first, second] = await Promise.all([
    request<Array<{ id: number; name: string; legalName: string; workspaceState: string }>>("/clients", userIds[0]),
    request<Array<{ id: number; name: string; legalName: string; workspaceState: string }>>("/clients", userIds[1]),
  ]);

  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.equal(first.body.length, 1);
  assert.equal(second.body.length, 1);
  assert.notEqual(first.body[0].id, second.body[0].id);
  assert.doesNotMatch(first.body[0].name, /northstar/i);
  assert.doesNotMatch(second.body[0].name, /northstar/i);
  assert.equal(first.body[0].workspaceState, "starter");
  assert.equal(second.body[0].workspaceState, "starter");
  assert.equal(first.body[0].legalName, "Legal entity to be configured");
  assert.equal(second.body[0].legalName, "Legal entity to be configured");
  clientIds.push(first.body[0].id, second.body[0].id);

  const failedSetup = await request<{ error: string }>(`/clients/${first.body[0].id}`, userIds[0], {
    method: "PATCH",
    body: JSON.stringify({
      name: "First client",
      legalName: "",
      functionalCurrency: "USD",
      basis: "IFRS for SMEs",
      period: "December 2026",
    }),
  });
  assert.equal(failedSetup.response.status, 400);
  assert.match(failedSetup.body.error, /complete.*settings/i);

  const afterFailedSetup = await request<Array<{ workspaceState: string }>>("/clients", userIds[0]);
  assert.equal(afterFailedSetup.response.status, 200);
  assert.equal(afterFailedSetup.body[0].workspaceState, "starter");

  const configured = await request<{ id: number; workspaceState: string; legalName: string; functionalCurrency: string; basis: string; period: string }>(`/clients/${first.body[0].id}`, userIds[0], {
    method: "PATCH",
    body: JSON.stringify({
      name: "First client",
      legalName: "First Client FZ-LLC",
      functionalCurrency: "USD",
      basis: "IFRS for SMEs",
      period: "December 2026",
    }),
  });
  assert.equal(configured.response.status, 200);
  assert.equal(configured.body.workspaceState, "configured");
  assert.equal(configured.body.legalName, "First Client FZ-LLC");
  assert.equal(configured.body.functionalCurrency, "USD");
  assert.equal(configured.body.basis, "IFRS for SMEs");
  assert.equal(configured.body.period, "December 2026");

  const firstAgain = await request<Array<{ id: number; workspaceState: string; legalName: string }>>("/clients", userIds[0]);
  assert.equal(firstAgain.response.status, 200);
  assert.deepEqual(firstAgain.body.map((client) => client.id), [first.body[0].id]);
  assert.equal(firstAgain.body[0].workspaceState, "configured");
  assert.equal(firstAgain.body[0].legalName, "First Client FZ-LLC");

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

test("persists onboarding identity before configuring the owner's starter workspace", async () => {
  const ownerId = userIds[12];
  const profile = await request<{ email: string | null; firstName: string; lastName: string }>(
    "/ledgerflow/account-profile",
    ownerId,
    {
      method: "PATCH",
      body: JSON.stringify({ firstName: "Aisha", lastName: "Rahman" }),
    },
  );
  assert.equal(profile.response.status, 200);
  assert.equal(profile.body.firstName, "Aisha");
  assert.equal(profile.body.lastName, "Rahman");

  const workspaces = await request<Array<{ id: number; workspaceState: string }>>("/clients", ownerId);
  assert.equal(workspaces.response.status, 200);
  assert.equal(workspaces.body.length, 1);
  assert.equal(workspaces.body[0].workspaceState, "starter");
  clientIds.push(workspaces.body[0].id);

  const configured = await request<{ workspaceState: string; legalName: string }>(`/clients/${workspaces.body[0].id}`, ownerId, {
    method: "PATCH",
    body: JSON.stringify({
      name: "Northstar Bookkeeping",
      legalName: "Northstar Bookkeeping FZ-LLC",
      functionalCurrency: "AED",
      basis: "IFRS",
      period: "August 2026",
    }),
  });
  assert.equal(configured.response.status, 200);
  assert.equal(configured.body.workspaceState, "configured");
  assert.equal(configured.body.legalName, "Northstar Bookkeeping FZ-LLC");

  const [storedProfile] = await database!.db.select({
    firstName: database!.usersTable.firstName,
    lastName: database!.usersTable.lastName,
  }).from(database!.usersTable).where(eq(database!.usersTable.id, ownerId));
  assert.deepEqual(storedProfile, { firstName: "Aisha", lastName: "Rahman" });
});

test("continues to classify historic generated placeholders as starter workspaces", async () => {
  assert.ok(database);
  const historicStarters = [
    { userId: userIds[9], name: "Amina's workspace" },
    { userId: userIds[10], name: "New LedgerFlow workspace" },
  ];
  for (const starter of historicStarters) {
    await database.db.insert(database.usersTable).values({ id: starter.userId });
    const client = await seedPlaceholderStarterWorkspace(starter.userId, starter.name);

    const response = await request<Array<{ id: number; workspaceState: string }>>("/clients", starter.userId);
    assert.equal(response.response.status, 200);
    assert.equal(response.body.length, 1);
    assert.equal(response.body[0].id, client.id);
    assert.equal(response.body[0].workspaceState, "starter");
  }
});

test("reports current-cycle AI estimates per authorized client without counting failures or another workspace", async () => {
  assert.ok(database);
  const ownerId = userIds[11];
  const foreignUserId = userIds[12];
  await database.db.insert(database.usersTable).values([{ id: ownerId }, { id: foreignUserId }]);
  const [managedClient, directClient, foreignClient] = await database.db.insert(database.clientsTable).values([
    { name: "Managed AI client", legalName: "Managed AI client FZ-LLC" },
    { name: "Direct AI client", legalName: "Direct AI client FZ-LLC" },
    { name: "Foreign AI client", legalName: "Foreign AI client FZ-LLC" },
  ]).returning();
  clientIds.push(managedClient.id, directClient.id, foreignClient.id);
  await database.db.insert(database.clientWorkspacesTable).values([
    { clientId: managedClient.id, userId: ownerId },
    { clientId: directClient.id, userId: ownerId },
    { clientId: foreignClient.id, userId: foreignUserId },
  ]);
  await database.db.insert(database.aiActivityTable).values([
    {
      clientId: managedClient.id,
      userId: ownerId,
      activityType: "copilot_chat",
      provider: "managed_openai",
      model: "metered-managed",
      inputTokens: 1_000,
      outputTokens: 500,
      estimatedCostUsd: "0.00500000",
      billingSource: "replit_credits",
      status: "completed",
    },
    {
      clientId: managedClient.id,
      userId: ownerId,
      activityType: "copilot_chat",
      provider: "managed_openai",
      model: "unpriced-managed",
      billingSource: "replit_credits",
      status: "completed",
    },
    {
      clientId: managedClient.id,
      userId: ownerId,
      activityType: "copilot_chat",
      provider: "managed_openai",
      model: "failed-managed",
      inputTokens: 10,
      outputTokens: 10,
      estimatedCostUsd: "9.00000000",
      billingSource: "replit_credits",
      status: "failed",
    },
    {
      clientId: directClient.id,
      userId: ownerId,
      activityType: "statement_extraction",
      provider: "openai",
      model: "metered-direct",
      inputTokens: 2_000,
      outputTokens: 250,
      estimatedCostUsd: "0.02000000",
      billingSource: "provider_direct",
      status: "completed",
    },
    {
      clientId: foreignClient.id,
      userId: foreignUserId,
      activityType: "copilot_chat",
      provider: "managed_openai",
      model: "foreign-managed",
      inputTokens: 100,
      outputTokens: 100,
      estimatedCostUsd: "99.00000000",
      billingSource: "replit_credits",
      status: "completed",
    },
  ]);

  const usage = await request<{
    aiActivity: { used: number };
    aiCost: {
      completedActivities: number;
      activitiesWithEstimate: number;
      activitiesWithoutEstimate: number;
      replitPricedActivities: number;
      providerDirectPricedActivities: number;
      inputTokens: number;
      outputTokens: number;
      estimatedReplitCreditsUsd: number;
      estimatedProviderDirectUsd: number;
      estimatedTotalProviderCostUsd: number;
    };
    clientAiCosts: Array<{
      clientId: number;
      clientName: string;
      usage: { estimatedReplitCreditsUsd: number; estimatedProviderDirectUsd: number; models: Array<{ provider: string; model: string }> };
    }>;
  }>("/ledgerflow/usage", ownerId);

  assert.equal(usage.response.status, 200);
  assert.equal(usage.body.aiActivity.used, 3);
  assert.equal(usage.body.aiCost.completedActivities, 3);
  assert.equal(usage.body.aiCost.activitiesWithEstimate, 2);
  assert.equal(usage.body.aiCost.activitiesWithoutEstimate, 1);
  assert.equal(usage.body.aiCost.replitPricedActivities, 1);
  assert.equal(usage.body.aiCost.providerDirectPricedActivities, 1);
  assert.equal(usage.body.aiCost.inputTokens, 3_000);
  assert.equal(usage.body.aiCost.outputTokens, 750);
  assert.equal(usage.body.aiCost.estimatedReplitCreditsUsd, 0.005);
  assert.equal(usage.body.aiCost.estimatedProviderDirectUsd, 0.02);
  assert.equal(usage.body.aiCost.estimatedTotalProviderCostUsd, 0.025);
  const managedUsage = usage.body.clientAiCosts.find((item) => item.clientId === managedClient.id);
  const directUsage = usage.body.clientAiCosts.find((item) => item.clientId === directClient.id);
  assert.equal(managedUsage?.clientName, "Managed AI client");
  assert.equal(managedUsage?.usage.estimatedReplitCreditsUsd, 0.005);
  assert.equal(managedUsage?.usage.estimatedProviderDirectUsd, 0);
  assert.equal(directUsage?.usage.estimatedReplitCreditsUsd, 0);
  assert.equal(directUsage?.usage.estimatedProviderDirectUsd, 0.02);
  assert.equal(usage.body.clientAiCosts.some((item) => item.clientId === foreignClient.id), false);
  assert.deepEqual(
    managedUsage?.usage.models.map((model) => `${model.provider}:${model.model}`).sort(),
    ["managed_openai:metered-managed", "managed_openai:unpriced-managed"],
  );
});

test("moves only an untouched legacy demo workspace to a clean private workspace", async () => {
  assert.ok(database);
  const legacyUserId = userIds[2];
  await database.db.insert(database.usersTable).values({ id: legacyUserId });
  const legacyClient = await seedLegacyDemoWorkspace(legacyUserId);
  await database.db.update(database.usersTable)
    .set({ starterClientId: legacyClient.id })
    .where(eq(database.usersTable.id, legacyUserId));

  const firstVisit = await request<Array<{ id: number; name: string; legacyDemo: boolean; workspaceState: string }>>("/clients", legacyUserId);
  assert.equal(firstVisit.response.status, 200);
  assert.equal(firstVisit.body.length, 2);
  const preservedWorkspace = firstVisit.body.find((client) => client.id === legacyClient.id);
  const cleanWorkspace = firstVisit.body.find((client) => !client.legacyDemo);
  assert.equal(preservedWorkspace?.legacyDemo, true);
  assert.equal(preservedWorkspace?.workspaceState, "legacy_demo");
  assert.ok(cleanWorkspace);
  assert.match(cleanWorkspace.name, /private workspace/i);
  assert.equal(cleanWorkspace.workspaceState, "starter");
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
    workspaceState: "configured",
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