import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";

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
  `firm-schedule-owner-${randomUUID()}`,
  `firm-schedule-foreign-${randomUUID()}`,
  `dual-mode-owner-${randomUUID()}`,
  `dual-mode-foreign-${randomUUID()}`,
  `multi-firm-company-${randomUUID()}`,
  `multi-firm-admin-${randomUUID()}`,
  `multi-firm-owner-a-${randomUUID()}`,
  `multi-firm-owner-b-${randomUUID()}`,
  `scoped-manager-${randomUUID()}`,
  `scoped-other-owner-${randomUUID()}`,
  `scoped-target-${randomUUID()}`,
  `shared-rate-owner-${randomUUID()}`,
  `shared-rate-admin-${randomUUID()}`,
  `engagement-firm-owner-${randomUUID()}`,
  `engagement-unapproved-staff-${randomUUID()}`,
  `engagement-company-owner-${randomUUID()}`,
  `practice-firm-owner-${randomUUID()}`,
  `practice-firm-b-${randomUUID()}`,
  `practice-bookkeeper-${randomUUID()}`,
  `practice-signer-${randomUUID()}`,
  `practice-dual-${randomUUID()}`,
];
const clientIds: number[] = [];
const legacyDemoRows = [
  { date: "2026-08-03", description: "EMIRATES AIRLINES", currency: "AED", amount: "1840.00", direction: "outflow", status: "posted", accountSuggestion: "Travel & entertainment", confidence: "0.98" },
  { date: "2026-08-05", description: "STRIPE PAYOUT 8472", currency: "USD", amount: "12450.00", direction: "inflow", status: "posted", accountSuggestion: "Revenue", confidence: "0.99" },
  { date: "2026-08-07", description: "AWS EMEA", currency: "USD", amount: "624.50", direction: "outflow", status: "draft", accountSuggestion: "Software & subscriptions", confidence: "0.91" },
  { date: "2026-08-10", description: "AL FARAJ OFFICE SUPPLIES", currency: "AED", amount: "389.00", direction: "outflow", status: "draft", accountSuggestion: "Office expenses", confidence: "0.87" },
  { date: "2026-08-12", description: "CLIENT RETAINER — NORTHSTAR", currency: "AED", amount: "28750.00", direction: "inflow", status: "posted", accountSuggestion: "Revenue", confidence: "0.97" },
  { date: "2026-08-15", description: "GULF TELECOM", currency: "AED", amount: "475.00", direction: "outflow", status: "draft", accountSuggestion: "Communication expenses", confidence: "0.84" },
] as const;

function testDatabaseUrl() {
  const value = process.env.AGARACCOUNTING_TEST_DATABASE_URL;
  if (!value) throw new Error("AGARACCOUNTING_TEST_DATABASE_URL is required for AgarAccounting AI System integration tests.");
  const databaseName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) {
    throw new Error("The AgarAccounting AI System integration test database name must contain 'test'.");
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
    status: line.status === "posted" ? "posted" : "draft",
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
  try {
    if (database) {
      if (clientIds.length) {
        await database.db.delete(database.engagementContractsTable).where(inArray(database.engagementContractsTable.clientId, clientIds));
        await database.db.delete(database.organizationInvitationsTable).where(inArray(database.organizationInvitationsTable.clientId, clientIds));
        await database.db.delete(database.firmCompanyEngagementsTable).where(inArray(database.firmCompanyEngagementsTable.clientId, clientIds));
        await database.db.delete(database.journalEntriesTable).where(inArray(database.journalEntriesTable.clientId, clientIds));
        await database.db.delete(database.statementImportsTable).where(inArray(database.statementImportsTable.clientId, clientIds));
        await database.db.delete(database.statementLinesTable).where(inArray(database.statementLinesTable.clientId, clientIds));
        await database.db.delete(database.bankAccountsTable).where(inArray(database.bankAccountsTable.clientId, clientIds));
        await database.db.delete(database.aiActivityTable).where(inArray(database.aiActivityTable.clientId, clientIds));
        await database.db.delete(database.aiProviderConfigsTable).where(inArray(database.aiProviderConfigsTable.clientId, clientIds));
        await database.db.delete(database.clientWorkspacesTable).where(inArray(database.clientWorkspacesTable.clientId, clientIds));
        await database.db.delete(database.clientsTable).where(inArray(database.clientsTable.id, clientIds));
      }
      await database.db.delete(database.organizationInvitationsTable).where(inArray(database.organizationInvitationsTable.invitedByUserId, userIds));
      await database.db.delete(database.exchangeRatesTable).where(inArray(database.exchangeRatesTable.userId, userIds));
      await database.db.delete(database.clientWorkspacesTable).where(inArray(database.clientWorkspacesTable.userId, userIds));
      await database.db.delete(database.usersTable).where(inArray(database.usersTable.id, userIds));
    }
  } finally {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  }
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
  assert.ok(database);
  const starterMemberships = await database.db.select({
    clientId: database.clientWorkspacesTable.clientId,
    userId: database.clientWorkspacesTable.userId,
    role: database.clientWorkspacesTable.role,
  }).from(database.clientWorkspacesTable).where(inArray(
    database.clientWorkspacesTable.clientId,
    [first.body[0].id, second.body[0].id],
  ));
  assert.deepEqual(
    starterMemberships
      .map(({ clientId, userId, role }) => ({ clientId, userId, role }))
      .sort((left, right) => left.clientId - right.clientId),
    [
      { clientId: first.body[0].id, userId: userIds[0], role: "owner" },
      { clientId: second.body[0].id, userId: userIds[1], role: "owner" },
    ].sort((left, right) => left.clientId - right.clientId),
  );
  const starterOwners = await database.db.select({
    id: database.clientsTable.id,
    ownerUserId: database.clientsTable.ownerUserId,
  }).from(database.clientsTable).where(inArray(
    database.clientsTable.id,
    [first.body[0].id, second.body[0].id],
  ));
  assert.deepEqual(
    new Map(starterOwners.map(({ id, ownerUserId }) => [id, ownerUserId])),
    new Map([
      [first.body[0].id, userIds[0]],
      [second.body[0].id, userIds[1]],
    ]),
  );

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
    request<unknown[]>(`/agaraccounting/statement-lines?clientId=${first.body[0].id}`, userIds[0]),
    request<unknown[]>(`/agaraccounting/journal-entries?clientId=${first.body[0].id}`, userIds[0]),
    request<unknown[]>(`/agaraccounting/statement-lines?clientId=${second.body[0].id}`, userIds[1]),
    request<unknown[]>(`/agaraccounting/journal-entries?clientId=${second.body[0].id}`, userIds[1]),
  ]);
  for (const result of [firstLines, firstEntries, secondLines, secondEntries]) {
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, []);
  }

  const foreignClientId = first.body[0].id;
  const [lines, entries, report, update, upload] = await Promise.all([
    request<{ error: string }>(`/agaraccounting/statement-lines?clientId=${foreignClientId}`, userIds[1]),
    request<{ error: string }>(`/agaraccounting/journal-entries?clientId=${foreignClientId}`, userIds[1]),
    request<{ error: string }>(`/agaraccounting/financial-statements?clientId=${foreignClientId}`, userIds[1]),
    request<{ error: string }>(`/clients/${foreignClientId}`, userIds[1], {
      method: "PATCH",
      body: JSON.stringify({ name: "Attempted change" }),
    }),
    request<{ error: string }>("/agaraccounting/import-statement", userIds[1], {
      method: "POST",
      body: JSON.stringify({
        clientId: foreignClientId,
        fileName: "statement.csv",
        mimeType: "text/csv",
        objectPath: `uploads/${userIds[1]}/${foreignClientId}/statement.csv`,
        currency: "AED",
        confirmed: true,
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

test("keeps one exchange-rate schedule with its firm while clients remain separate", async () => {
  const ownerId = userIds[14]!;
  const foreignId = userIds[15]!;
  const starter = await request<Array<{ id: number }>>("/clients", ownerId);
  assert.equal(starter.response.status, 200);
  clientIds.push(starter.body[0]!.id);

  const secondClient = await request<{ id: number }>("/clients", ownerId, {
    method: "POST",
    body: JSON.stringify({ name: "Second firm client", legalName: "Second firm client LLC", functionalCurrency: "AED", basis: "IFRS", period: "December 2026" }),
  });
  assert.equal(secondClient.response.status, 201);
  clientIds.push(secondClient.body.id);

  const profile = await request<{ id: number; name: string }>("/workspace/firm-profile", ownerId);
  assert.equal(profile.response.status, 200);
  const savedProfile = await request<{ name: string }>("/workspace/firm-profile", ownerId, {
    method: "PATCH",
    body: JSON.stringify({ name: "Shared books firm", legalName: "Shared Books Firm LLC" }),
  });
  assert.equal(savedProfile.response.status, 200);
  assert.equal(savedProfile.body.name, "Shared books firm");

  const createdRate = await request<{ id: number }>(`/agaraccounting/exchange-rates?clientId=${starter.body[0]!.id}`, ownerId, {
    method: "POST",
    body: JSON.stringify({ sourceCurrency: "USD", functionalCurrency: "AED", effectiveDate: "2026-12-01", rate: 3.6725, source: "Manual" }),
  });
  assert.equal(createdRate.response.status, 201);
  const firmRates = await request<Array<{ id: number }>>(`/agaraccounting/exchange-rates?clientId=${starter.body[0]!.id}`, ownerId);
  assert.deepEqual(firmRates.body.map((rate) => rate.id), [createdRate.body.id]);

  const foreignStarter = await request<Array<{ id: number }>>("/clients", foreignId);
  clientIds.push(foreignStarter.body[0]!.id);
  const foreignRates = await request<unknown[]>(`/agaraccounting/exchange-rates?clientId=${foreignStarter.body[0]!.id}`, foreignId);
  assert.equal(foreignRates.response.status, 200);
  assert.deepEqual(foreignRates.body, []);
});

test("keeps a dual-mode owner's company schedule separate from their accounting firm", async () => {
  const ownerId = userIds[16]!;
  const foreignId = userIds[17]!;
  const onboarding = await request<{
    firms: Array<{ firmId: number }>;
  }>("/organizations/onboarding", ownerId, {
    method: "POST",
    body: JSON.stringify({
      mode: "both",
      firstName: "Dual",
      lastName: "Owner",
      companyName: "Owner Company",
      companyLegalName: "Owner Company LLC",
      firmName: "Owner Accounting Firm",
      firmLegalName: "Owner Accounting Firm LLC",
      functionalCurrency: "AED",
      basis: "IFRS",
      period: "December 2026",
    }),
  });
  assert.equal(onboarding.response.status, 200);
  const firmId = onboarding.body.firms[0]!.firmId;
  const clients = await request<Array<{ id: number }>>("/clients", ownerId);
  assert.equal(clients.response.status, 200);
  assert.equal(clients.body.length, 1);
  const clientId = clients.body[0]!.id;
  clientIds.push(clientId);

  const firmRate = await request<{ id: number }>(`/agaraccounting/exchange-rates?firmId=${firmId}`, ownerId, {
    method: "POST",
    body: JSON.stringify({ sourceCurrency: "USD", functionalCurrency: "AED", effectiveDate: "2026-12-01", rate: 3.67 }),
  });
  const companyRate = await request<{ id: number }>(`/agaraccounting/exchange-rates?clientId=${clientId}`, ownerId, {
    method: "POST",
    body: JSON.stringify({ sourceCurrency: "EUR", functionalCurrency: "AED", effectiveDate: "2026-12-01", rate: 4.1 }),
  });
  assert.equal(firmRate.response.status, 201);
  assert.equal(companyRate.response.status, 201);

  const firmRates = await request<Array<{ id: number }>>(`/agaraccounting/exchange-rates?firmId=${firmId}`, ownerId);
  const companyRates = await request<Array<{ id: number }>>(`/agaraccounting/exchange-rates?clientId=${clientId}`, ownerId);
  assert.deepEqual(firmRates.body.map(({ id }) => id), [firmRate.body.id]);
  assert.deepEqual(companyRates.body.map(({ id }) => id), [companyRate.body.id]);
  assert.notEqual(firmRate.body.id, companyRate.body.id);

  const foreignClients = await request<Array<{ id: number }>>("/clients", foreignId);
  assert.equal(foreignClients.response.status, 200);
  clientIds.push(...foreignClients.body.map(({ id }) => id));
  const unauthorizedFirmRead = await request<{ error: string }>(`/agaraccounting/exchange-rates?firmId=${firmId}`, foreignId);
  assert.equal(unauthorizedFirmRead.response.status, 403);

  assert.ok(database);
  const profiles = await database.db.select().from(database.firmProfilesTable)
    .where(eq(database.firmProfilesTable.ownerUserId, ownerId));
  assert.deepEqual(new Set(profiles.map(({ profileKind }) => profileKind)), new Set(["accounting_firm", "internal_rate_container"]));
  const [company] = await database.db.select().from(database.clientsTable).where(eq(database.clientsTable.id, clientId));
  assert.ok(company.rateProfileId);
  assert.notEqual(company.rateProfileId, firmId);
});

test("binds invitations and firm-created clients to the explicitly selected firm", async () => {
  assert.ok(database);
  const companyUserId = userIds[18];
  const firmAdminId = userIds[19];
  const firmOwnerAId = userIds[20];
  const firmOwnerBId = userIds[21];
  const email = `multi-firm-${randomUUID()}@example.com`;
  await database.db.insert(database.usersTable).values([
    { id: companyUserId, email: `company-${randomUUID()}@example.com`, firstName: "Company", lastName: "Owner", onboardingMode: "company" },
    { id: firmAdminId, email, firstName: "Firm", lastName: "Admin", onboardingMode: "firm" },
    { id: firmOwnerAId, email: `owner-a-${randomUUID()}@example.com`, firstName: "Firm", lastName: "Owner A", onboardingMode: "firm" },
    { id: firmOwnerBId, email: `owner-b-${randomUUID()}@example.com`, firstName: "Firm", lastName: "Owner B", onboardingMode: "firm" },
  ]);
  const [company] = await database.db.insert(database.clientsTable).values({
    ownerUserId: companyUserId, ownershipStatus: "company_owned", subscriptionLiableParty: "company",
    name: "Selected-firm company", legalName: "Selected-firm company LLC", functionalCurrency: "AED", basis: "IFRS", period: "August 2026",
  }).returning();
  clientIds.push(company.id);
  await database.db.insert(database.clientWorkspacesTable).values({ clientId: company.id, userId: companyUserId, role: "owner" });
  const firms = await database.db.insert(database.firmProfilesTable).values([
    { ownerUserId: firmOwnerAId, name: "Firm A", legalName: "Firm A LLC", profileKind: "accounting_firm" },
    { ownerUserId: firmOwnerBId, name: "Firm B", legalName: "Firm B LLC", profileKind: "accounting_firm" },
  ]).returning();
  await database.db.insert(database.firmMembershipsTable).values(firms.map((firm) => ({ firmId: firm.id, userId: firmAdminId, role: "owner", status: "active" })));

  const invited = await request<{ inviteLink: string }>(`/companies/${company.id}/firm-invitations`, companyUserId, {
    method: "POST", body: JSON.stringify({ email, firmId: firms[1].id, role: "admin" }),
  });
  assert.equal(invited.response.status, 201);
  const token = new URL(invited.body.inviteLink).searchParams.get("organizationInvite");
  assert.ok(token);
  const accepted = await request(`/organization-invitations/${token}/accept`, firmAdminId, { method: "POST" });
  assert.equal(accepted.response.status, 200);
  const engagements = await database.db.select().from(database.firmCompanyEngagementsTable).where(eq(database.firmCompanyEngagementsTable.clientId, company.id));
  assert.deepEqual(engagements.map(({ firmId }) => firmId), [firms[1].id]);

  const created = await request<{ id: number }>("/clients", firmAdminId, {
    method: "POST", body: JSON.stringify({ name: "Explicit Firm Client", legalName: "Explicit Firm Client LLC", creationMode: "firm_client", firmId: firms[0].id }),
  });
  assert.equal(created.response.status, 201);
  clientIds.push(created.body.id);
  const [createdRow] = await database.db.select().from(database.clientsTable).where(eq(database.clientsTable.id, created.body.id));
  assert.equal(createdRow.firmId, firms[0].id);
});

test("keeps team management scoped when an owner is only a bookkeeper elsewhere", async () => {
  assert.ok(database);
  const actorId = userIds[22];
  const otherOwnerId = userIds[23];
  const targetId = userIds[24];
  await database.db.insert(database.usersTable).values([
    { id: actorId, email: `scoped-manager-${randomUUID()}@example.com` },
    { id: otherOwnerId, email: `scoped-owner-${randomUUID()}@example.com` },
    { id: targetId, email: `scoped-target-${randomUUID()}@example.com` },
  ]);
  const clients = await database.db.insert(database.clientsTable).values([
    { ownerUserId: actorId, ownershipStatus: "company_owned", subscriptionLiableParty: "company", name: "Managed A", legalName: "Managed A LLC", functionalCurrency: "AED", basis: "IFRS", period: "August 2026" },
    { ownerUserId: otherOwnerId, ownershipStatus: "company_owned", subscriptionLiableParty: "company", name: "Read-only B", legalName: "Read-only B LLC", functionalCurrency: "AED", basis: "IFRS", period: "August 2026" },
  ]).returning();
  clientIds.push(...clients.map(({ id }) => id));
  await database.db.insert(database.clientWorkspacesTable).values([
    { clientId: clients[0].id, userId: actorId, role: "owner" },
    { clientId: clients[1].id, userId: actorId, role: "bookkeeper" },
    { clientId: clients[1].id, userId: otherOwnerId, role: "owner" },
    { clientId: clients[1].id, userId: targetId, role: "accountant" },
  ]);

  const listed = await request<{ clients: Array<{ id: number }>; members: Array<{ userId: string }> }>("/workspace/members", actorId);
  assert.equal(listed.response.status, 200);
  assert.deepEqual(listed.body.clients.map(({ id }) => id), [clients[0].id]);
  assert.ok(!listed.body.members.some(({ userId }) => userId === targetId));

  const invited = await request("/workspace/invitations", actorId, {
    method: "POST", body: JSON.stringify({ email: `invite-${randomUUID()}@example.com`, role: "bookkeeper", clientIds: [clients[1].id] }),
  });
  assert.equal(invited.response.status, 400);
  const updated = await request(`/workspace/members/${targetId}`, actorId, {
    method: "PATCH", body: JSON.stringify({ role: "accountant", clientIds: [clients[1].id] }),
  });
  assert.equal(updated.response.status, 400);
  const removed = await request(`/workspace/members/${targetId}`, actorId, { method: "DELETE" });
  assert.equal(removed.response.status, 404);
  const [membership] = await database.db.select().from(database.clientWorkspacesTable)
    .where(eq(database.clientWorkspacesTable.userId, targetId));
  assert.equal(membership.clientId, clients[1].id);
});

test("prevents a delegated company admin from changing an owner-shared rate schedule", async () => {
  assert.ok(database);
  const ownerId = userIds[25];
  const adminId = userIds[26];
  await database.db.insert(database.usersTable).values([{ id: ownerId }, { id: adminId }]);
  const clients = await database.db.insert(database.clientsTable).values([
    { ownerUserId: ownerId, ownershipStatus: "company_owned", subscriptionLiableParty: "company", name: "Owner Company A", legalName: "Owner Company A LLC", functionalCurrency: "AED", basis: "IFRS", period: "August 2026" },
    { ownerUserId: ownerId, ownershipStatus: "company_owned", subscriptionLiableParty: "company", name: "Owner Company B", legalName: "Owner Company B LLC", functionalCurrency: "AED", basis: "IFRS", period: "August 2026" },
  ]).returning();
  clientIds.push(...clients.map(({ id }) => id));
  await database.db.insert(database.clientWorkspacesTable).values([
    { clientId: clients[0].id, userId: ownerId, role: "owner" },
    { clientId: clients[1].id, userId: ownerId, role: "owner" },
    { clientId: clients[0].id, userId: adminId, role: "admin" },
  ]);
  const created = await request<{ id: number }>("/agaraccounting/exchange-rates?clientId=" + clients[0].id, ownerId, {
    method: "POST", body: JSON.stringify({ sourceCurrency: "USD", functionalCurrency: "AED", rate: 3.67, effectiveDate: "2026-08-01" }),
  });
  assert.equal(created.response.status, 201);
  const delegatedCreate = await request("/agaraccounting/exchange-rates?clientId=" + clients[0].id, adminId, {
    method: "POST", body: JSON.stringify({ sourceCurrency: "EUR", functionalCurrency: "AED", rate: 4.1, effectiveDate: "2026-08-01" }),
  });
  assert.equal(delegatedCreate.response.status, 403);
  const delegatedEdit = await request(`/agaraccounting/exchange-rates/${created.body.id}`, adminId, {
    method: "PATCH", body: JSON.stringify({ sourceCurrency: "USD", functionalCurrency: "AED", rate: 9.99, effectiveDate: "2026-08-01" }),
  });
  assert.equal(delegatedEdit.response.status, 403);
});

test("hides engagement metadata from firm staff until company approval", async () => {
  assert.ok(database);
  const firmOwnerId = userIds[27];
  const staffId = userIds[28];
  const companyOwnerId = userIds[29];
  await database.db.insert(database.usersTable).values([{ id: firmOwnerId }, { id: staffId }, { id: companyOwnerId }]);
  const [firm] = await database.db.insert(database.firmProfilesTable).values({
    ownerUserId: firmOwnerId, name: "Private Engagement Firm", legalName: "Private Engagement Firm LLC", profileKind: "accounting_firm",
  }).returning();
  await database.db.insert(database.firmMembershipsTable).values([
    { firmId: firm.id, userId: firmOwnerId, role: "owner", status: "active" },
    { firmId: firm.id, userId: staffId, role: "accountant", status: "active" },
  ]);
  const [client] = await database.db.insert(database.clientsTable).values({
    ownerUserId: companyOwnerId, ownershipStatus: "company_owned", subscriptionLiableParty: "company",
    name: "Confidential Client", legalName: "Confidential Client LLC", functionalCurrency: "AED", basis: "IFRS", period: "August 2026",
  }).returning();
  clientIds.push(client.id);
  await database.db.insert(database.clientWorkspacesTable).values({ clientId: client.id, userId: companyOwnerId, role: "owner" });
  const [engagement] = await database.db.insert(database.firmCompanyEngagementsTable).values({
    firmId: firm.id, clientId: client.id, status: "active", invitedByUserId: companyOwnerId, acceptedByUserId: firmOwnerId, acceptedAt: new Date(),
  }).returning();
  await database.db.insert(database.firmEngagementMembersTable).values({
    engagementId: engagement.id, userId: staffId, role: "accountant", status: "nominated", nominatedByUserId: firmOwnerId,
  });
  const context = await request<{ engagements: unknown[] }>("/organizations/context", staffId);
  assert.equal(context.response.status, 200);
  assert.deepEqual(context.body.engagements, []);
  const staffClients = await request<Array<{ id: number }>>("/clients", staffId);
  clientIds.push(...staffClients.body.map(({ id }) => id));
});

test("persists onboarding identity before configuring the owner's starter workspace", async () => {
  const ownerId = userIds[12];
  const profile = await request<{ email: string | null; firstName: string; lastName: string }>(
    "/agaraccounting/account-profile",
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
    { userId: userIds[10], name: "New AgarAccounting workspace" },
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
  const ownerId = `usage-owner-${randomUUID()}`;
  const foreignUserId = `usage-foreign-${randomUUID()}`;
  userIds.push(ownerId, foreignUserId);
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
  }>("/agaraccounting/usage", ownerId);

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
    ownerUserId: null,
    firmId: null,
    ownershipStatus: "company_owned",
    subscriptionLiableParty: "company",
    systemRatesEnabled: true,
    shareCapitalAuthorisedShares: null,
    shareCapitalParValue: null,
    shareholders: [],
    shareCapitalJournalId: null,
    shareCapitalDuplicateWarning: null,
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
    status: "draft",
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

test("keeps firm overview and engagement contracts isolated and hides expired actuals", async () => {
  assert.ok(database);
  const firmOwnerId = userIds[30];
  const firmBOwnerId = userIds[31];
  const bookkeeperId = userIds[32];
  const signerId = userIds[33];
  const dualId = userIds[34];
  const signerEmail = `signer-${randomUUID()}@example.com`;
  await database.db.insert(database.usersTable).values([
    { id: firmOwnerId, email: `practice-owner-${randomUUID()}@example.com`, firstName: "Practice", lastName: "Owner", onboardingMode: "firm" },
    { id: firmBOwnerId, email: `practice-b-${randomUUID()}@example.com`, firstName: "Other", lastName: "Firm", onboardingMode: "firm" },
    { id: bookkeeperId, email: `practice-books-${randomUUID()}@example.com`, firstName: "Practice", lastName: "Books", onboardingMode: "firm" },
    { id: signerId, email: signerEmail, firstName: "Client", lastName: "Signer", onboardingMode: "company" },
    { id: dualId, email: `practice-dual-${randomUUID()}@example.com`, firstName: "Dual", lastName: "Owner", onboardingMode: "both" },
  ]);
  const firms = await database.db.insert(database.firmProfilesTable).values([
    { ownerUserId: firmOwnerId, name: "Practice Firm", legalName: "Practice Firm LLC", profileKind: "accounting_firm" },
    { ownerUserId: firmBOwnerId, name: "Foreign Firm", legalName: "Foreign Firm LLC", profileKind: "accounting_firm" },
  ]).returning();
  await database.db.insert(database.firmMembershipsTable).values([
    { firmId: firms[0].id, userId: firmOwnerId, role: "owner", status: "active" },
    { firmId: firms[0].id, userId: bookkeeperId, role: "bookkeeper", status: "active" },
    { firmId: firms[1].id, userId: firmBOwnerId, role: "owner", status: "active" },
    { firmId: firms[0].id, userId: dualId, role: "owner", status: "active" },
  ]);
  const [personal] = await database.db.insert(database.clientsTable).values({
    ownerUserId: dualId, ownershipStatus: "company_owned", subscriptionLiableParty: "company",
    name: "Dual Personal Co", legalName: "Dual Personal Co LLC", functionalCurrency: "AED", basis: "IFRS", period: "August 2026",
  }).returning();
  clientIds.push(personal.id);
  await database.db.insert(database.clientWorkspacesTable).values({ clientId: personal.id, userId: dualId, role: "owner" });

  const missingTerms = await request<{ error: string }>(`/firms/${firms[0].id}/engagement-onboardings`, firmOwnerId, {
    method: "POST",
    body: JSON.stringify({
      name: "No Volume Client", legalName: "No Volume Client LLC", functionalCurrency: "AED", basis: "IFRS", period: "August 2026",
      services: ["bookkeeping"], startDate: "2026-01-01", termsText: "Terms", signerEmail,
    }),
  });
  assert.equal(missingTerms.response.status, 400);

  const created = await request<{ id: number; clientId: number; inviteLink: string; terms: { agreedTransactionsPerMonth: number; agreedRevenuePerYear: number } }>(`/firms/${firms[0].id}/engagement-onboardings`, firmOwnerId, {
    method: "POST",
    body: JSON.stringify({
      name: "Practice Client", legalName: "Practice Client LLC", functionalCurrency: "AED", basis: "IFRS", period: "August 2026",
      services: ["bookkeeping", "journals"], agreedTransactionsPerMonth: 40, agreedRevenuePerYear: 250000,
      startDate: "2026-01-01", termsText: "Agreed bookkeeping terms.", signerEmail,
    }),
  });
  assert.equal(created.response.status, 201);
  clientIds.push(created.body.clientId);
  assert.equal(created.body.terms.agreedTransactionsPerMonth, 40);
  assert.equal(created.body.terms.agreedRevenuePerYear, 250000);
  const token = new URL(created.body.inviteLink).searchParams.get("organizationInvite");
  assert.ok(token);

  const foreignOverview = await request<{ error: string }>(`/agaraccounting/firm-overview?firmId=${firms[0].id}`, firmBOwnerId);
  assert.equal(foreignOverview.response.status, 403);
  const dualOverview = await request<{ clients: Array<{ name: string }> }>(`/agaraccounting/firm-overview?firmId=${firms[0].id}`, dualId);
  assert.equal(dualOverview.response.status, 200);
  assert.equal(dualOverview.body.clients.some((client) => client.name === "Dual Personal Co"), false);

  const bookkeeperOverview = await request<{ clients: Array<{ id: number }> }>(`/agaraccounting/firm-overview?firmId=${firms[0].id}`, bookkeeperId);
  assert.equal(bookkeeperOverview.response.status, 200);
  assert.equal(bookkeeperOverview.body.clients.length, 0);

  const wrongEmail = await request<{ error: string }>(`/organization-invitations/${token}/engagement-contract`, firmOwnerId, {
    method: "POST", body: JSON.stringify({ signerName: "Wrong Person", accepted: true }),
  });
  assert.equal(wrongEmail.response.status, 403);

  const signed = await request<{ id: number; status: string; terms: { agreedTransactionsPerMonth: number } }>(`/organization-invitations/${token}/engagement-contract`, signerId, {
    method: "POST", body: JSON.stringify({ signerName: "Client Signer", accepted: true }),
  });
  assert.equal(signed.response.status, 200);
  assert.equal(signed.body.status, "signed");
  assert.equal(signed.body.terms.agreedTransactionsPerMonth, 40);

  await database.db.insert(database.journalEntriesTable).values({
    clientId: created.body.clientId,
    date: "2026-08-15",
    memo: "Draft sale",
    currency: "AED",
    status: "draft",
    confidence: "0.90",
    debitAccount: "Bank / cash",
    creditAccount: "Revenue",
    amount: "1000.00",
  });
  await database.db.insert(database.journalEntriesTable).values({
    clientId: created.body.clientId,
    date: "2026-08-16",
    memo: "Posted sale",
    currency: "AED",
    status: "posted",
    confidence: "0.99",
    debitAccount: "Bank / cash",
    creditAccount: "Revenue",
    amount: "5000.00",
    functionalCurrency: "AED",
    functionalAmount: "5000.00",
  });

  const practice = await request<{
    monthlyPostedJournals: Array<{ postedCount: number }>;
    ledgerActualsHidden: boolean;
  }>(`/agaraccounting/firm-clients/${created.body.clientId}/practice-overview?firmId=${firms[0].id}`, firmOwnerId);
  assert.equal(practice.response.status, 200);
  assert.equal(practice.body.ledgerActualsHidden, false);
  assert.equal(practice.body.monthlyPostedJournals.reduce((sum, row) => sum + row.postedCount, 0), 1);

  const confirmed = await request<{ status: string }>(`/engagement-onboardings/${created.body.id}/confirm`, firmOwnerId, { method: "POST" });
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.body.status, "confirmed");

  const expiredContract = await request<{ id: number; clientId: number }>(`/firms/${firms[0].id}/engagement-onboardings`, firmOwnerId, {
    method: "POST",
    body: JSON.stringify({
      name: "Expiring Client", legalName: "Expiring Client LLC", functionalCurrency: "AED", basis: "IFRS", period: "August 2026",
      services: ["bookkeeping"], agreedTransactionsPerMonth: 10, agreedRevenuePerYear: 10000,
      startDate: "2026-01-01", termsText: "Expire me.", signerEmail,
    }),
  });
  assert.equal(expiredContract.response.status, 201);
  clientIds.push(expiredContract.body.clientId);
  await database.db.update(database.engagementContractsTable)
    .set({ status: "signed", confirmBy: new Date(Date.now() - 1000) })
    .where(eq(database.engagementContractsTable.id, expiredContract.body.id));
  const lateConfirm = await request<{ error: string }>(`/engagement-onboardings/${expiredContract.body.id}/confirm`, firmOwnerId, { method: "POST" });
  assert.equal(lateConfirm.response.status, 409);
  const hidden = await request<{ ledgerActualsHidden: boolean }>(`/agaraccounting/firm-clients/${expiredContract.body.clientId}/practice-overview?firmId=${firms[0].id}`, firmOwnerId);
  assert.equal(hidden.response.status, 200);
  assert.equal(hidden.body.ledgerActualsHidden, true);

  const foreignPractice = await request<{ error: string }>(`/agaraccounting/firm-clients/${created.body.clientId}/practice-overview?firmId=${firms[1].id}`, firmBOwnerId);
  assert.equal(foreignPractice.response.status, 403);

  const neverSigned = await request<{ id: number; clientId: number }>(`/firms/${firms[0].id}/engagement-onboardings`, firmOwnerId, {
    method: "POST",
    body: JSON.stringify({
      name: "Unsigned Draft Client", legalName: "Unsigned Draft Client LLC", functionalCurrency: "AED", basis: "IFRS", period: "August 2026",
      services: ["bookkeeping"], agreedTransactionsPerMonth: 8, agreedRevenuePerYear: 8000,
      startDate: "2026-01-01", termsText: "Leave as a firm draft.", signerEmail,
    }),
  });
  assert.equal(neverSigned.response.status, 201);
  clientIds.push(neverSigned.body.clientId);
  await database.db.update(database.organizationInvitationsTable)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(database.organizationInvitationsTable.clientId, neverSigned.body.clientId));
  const afterUnusedInvite = await request<{
    clients: Array<{ id: number; name: string; onboardingStatus: string | null }>;
  }>(`/agaraccounting/firm-overview?firmId=${firms[0].id}`, firmOwnerId);
  assert.equal(afterUnusedInvite.response.status, 200);
  const draftRow = afterUnusedInvite.body.clients.find((client) => client.id === neverSigned.body.clientId);
  assert.ok(draftRow);
  assert.equal(draftRow.onboardingStatus, "expired");
  const [firmDraftWorkspace] = await database.db.select({
    clientId: database.clientWorkspacesTable.clientId,
  }).from(database.clientWorkspacesTable).where(and(
    eq(database.clientWorkspacesTable.clientId, neverSigned.body.clientId),
    eq(database.clientWorkspacesTable.userId, firmOwnerId),
  ));
  assert.ok(firmDraftWorkspace);
  const draftPractice = await request<{ workspaceAccessible: boolean; canResend: boolean; ledgerActualsHidden: boolean }>(
    `/agaraccounting/firm-clients/${neverSigned.body.clientId}/practice-overview?firmId=${firms[0].id}`,
    firmOwnerId,
  );
  assert.equal(draftPractice.response.status, 200);
  assert.equal(draftPractice.body.workspaceAccessible, true);
  assert.equal(draftPractice.body.canResend, true);
  assert.equal(draftPractice.body.ledgerActualsHidden, true);
  const resent = await request<{ status: string; inviteLink?: string }>(`/engagement-onboardings/${neverSigned.body.id}/resend`, firmOwnerId, { method: "POST" });
  assert.equal(resent.response.status, 200);
  assert.equal(resent.body.status, "sent");
  assert.ok(resent.body.inviteLink);
});
