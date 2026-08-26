import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";

let server: Server | undefined;
let baseUrl = "";
let database: typeof import("@workspace/db") | undefined;
const systemAdminId = `system-rate-admin-${randomUUID()}`;
const tenantAdminId = `tenant-admin-${randomUUID()}`;
const userIds = [systemAdminId, tenantAdminId];
const clientIds: number[] = [];
const firmIds: number[] = [];

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
  const text = await response.text();
  return {
    response,
    body: (text ? JSON.parse(text) : undefined) as T,
  };
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
      await database.db.delete(database.systemRateAuditEventsTable)
        .where(inArray(database.systemRateAuditEventsTable.actorUserId, userIds));
      await database.db.delete(database.systemRatesTable)
        .where(inArray(database.systemRatesTable.createdByUserId, userIds));
      await database.db.delete(database.systemRateAdminsTable)
        .where(inArray(database.systemRateAdminsTable.userId, userIds));
      if (clientIds.length) {
        await database.db.delete(database.journalEntriesTable)
          .where(inArray(database.journalEntriesTable.clientId, clientIds));
        await database.db.delete(database.statementLinesTable)
          .where(inArray(database.statementLinesTable.clientId, clientIds));
        await database.db.delete(database.clientWorkspacesTable)
          .where(inArray(database.clientWorkspacesTable.clientId, clientIds));
        await database.db.delete(database.clientsTable)
          .where(inArray(database.clientsTable.id, clientIds));
      }
      await database.db.delete(database.exchangeRatesTable)
        .where(inArray(database.exchangeRatesTable.userId, userIds));
      if (firmIds.length) {
        await database.db.delete(database.firmMembershipsTable)
          .where(inArray(database.firmMembershipsTable.firmId, firmIds));
        await database.db.delete(database.firmProfilesTable)
          .where(inArray(database.firmProfilesTable.id, firmIds));
      }
      await database.db.delete(database.usersTable).where(inArray(database.usersTable.id, userIds));
    }
  } finally {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  }
});

test("protects and applies the system catalog with traceable fallback precedence", async () => {
  assert.ok(database);
  const adminClients = await request<Array<{ id: number }>>("/clients", systemAdminId);
  const tenantClients = await request<Array<{ id: number }>>("/clients", tenantAdminId);
  assert.equal(adminClients.response.status, 200);
  assert.equal(tenantClients.response.status, 200);
  const clientId = adminClients.body[0]!.id;
  clientIds.push(clientId, tenantClients.body[0]!.id);

  const denied = await request<{ error: string }>("/ledgerflow/system-rates", tenantAdminId);
  assert.equal(denied.response.status, 403);
  assert.match(denied.body.error, /system administrator/i);

  await database.db.insert(database.systemRateAdminsTable).values({
    userId: systemAdminId,
    status: "active",
  });
  const systemRates = [
    { sourceCurrency: "USD", functionalCurrency: "AED", effectiveDate: "2026-08-01", rate: 3.5, source: "System test" },
    { sourceCurrency: "EUR", functionalCurrency: "AED", effectiveDate: "2026-08-01", rate: 4.0, source: "System test" },
    { sourceCurrency: "GBP", functionalCurrency: "AED", effectiveDate: "2026-08-01", rate: 4.6, source: "System test" },
    { sourceCurrency: "JPY", functionalCurrency: "AED", effectiveDate: "2026-08-01", rate: 0.025, source: "System test" },
  ];
  const imported = await request<{ importedCount: number; rates: Array<{ id: number; effectiveDate: string }> }>(
    "/ledgerflow/system-rates/import",
    systemAdminId,
    { method: "POST", body: JSON.stringify({ rates: systemRates }) },
  );
  assert.equal(imported.response.status, 200);
  assert.equal(imported.body.importedCount, 4);
  assert.equal(imported.body.rates[0]!.effectiveDate, "2026-08-01");

  const companyRate = await request<{ id: number }>(`/ledgerflow/exchange-rates?clientId=${clientId}`, systemAdminId, {
    method: "POST",
    body: JSON.stringify({ sourceCurrency: "USD", functionalCurrency: "AED", effectiveDate: "2026-08-01", rate: 3.8 }),
  });
  assert.equal(companyRate.response.status, 201);

  const [firm] = await database.db.insert(database.firmProfilesTable).values({
    ownerUserId: systemAdminId,
    name: "System rate test firm",
    legalName: "System rate test firm LLC",
    profileKind: "accounting_firm",
  }).returning();
  firmIds.push(firm.id);
  await database.db.insert(database.firmMembershipsTable).values({
    firmId: firm.id,
    userId: systemAdminId,
    role: "owner",
    status: "active",
  });
  await database.db.update(database.clientsTable).set({ firmId: firm.id })
    .where(eq(database.clientsTable.id, clientId));
  const firmRate = await request<{ id: number }>(`/ledgerflow/exchange-rates?firmId=${firm.id}`, systemAdminId, {
    method: "POST",
    body: JSON.stringify({ sourceCurrency: "EUR", functionalCurrency: "AED", effectiveDate: "2026-08-01", rate: 4.2 }),
  });
  assert.equal(firmRate.response.status, 201);

  const createLine = (currency: string, description: string) => request<{
    id: number;
    exchangeRate: number | null;
    exchangeRateSourceScope: string;
    exchangeRateStatus: string;
  }>("/ledgerflow/statement-lines", systemAdminId, {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-08-20",
      description,
      currency,
      amount: 100,
      direction: "outflow",
    }),
  });
  const companyLine = await createLine("USD", "Company precedence");
  const firmLine = await createLine("EUR", "Firm precedence");
  const systemLine = await createLine("GBP", "System precedence");
  assert.equal(companyLine.body.exchangeRateSourceScope, "client");
  assert.equal(companyLine.body.exchangeRate, 3.8);
  assert.equal(firmLine.body.exchangeRateSourceScope, "firm");
  assert.equal(firmLine.body.exchangeRate, 4.2);
  assert.equal(systemLine.body.exchangeRateSourceScope, "system");
  assert.equal(systemLine.body.exchangeRate, 4.6);

  const updatedClient = await request(`/clients/${clientId}`, systemAdminId, {
    method: "PATCH",
    body: JSON.stringify({
      name: "System rate admin workspace",
      legalName: "System rate admin workspace LLC",
      functionalCurrency: "AED",
      basis: "IFRS",
      period: "August 2026",
      systemRatesEnabled: false,
    }),
  });
  assert.equal(updatedClient.response.status, 200);
  const optedOutLine = await createLine("JPY", "Opted out");
  assert.equal(optedOutLine.body.exchangeRateSourceScope, "none");
  assert.equal(optedOutLine.body.exchangeRateStatus, "missing");

  const journals = await request<Array<{ id: number; statementLineId: number }>>(
    `/ledgerflow/journal-entries?clientId=${clientId}`,
    systemAdminId,
  );
  const systemJournal = journals.body.find((entry) => entry.statementLineId === systemLine.body.id);
  assert.ok(systemJournal);
  assert.equal((await request(`/ledgerflow/journal-entries/${systemJournal.id}/approve`, systemAdminId, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  })).response.status, 200);
  assert.equal((await request(`/ledgerflow/journal-entries/${systemJournal.id}/post`, systemAdminId, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  })).response.status, 200);

  const gbpRate = imported.body.rates[2]!;
  const updatedSystemRate = await request(`/ledgerflow/system-rates/${gbpRate.id}`, systemAdminId, {
    method: "PATCH",
    body: JSON.stringify({ ...systemRates[2], rate: 9.9 }),
  });
  assert.equal(updatedSystemRate.response.status, 200);
  const [postedLine] = await database.db.select().from(database.statementLinesTable)
    .where(eq(database.statementLinesTable.id, systemLine.body.id));
  assert.equal(postedLine.exchangeRate, "4.6000000000");
  assert.equal(postedLine.exchangeRateSourceScope, "system");

  const dashboard = await request<{
    availablePairs: unknown[];
    workspacesUsingFallback: number;
    workspacesWithFallbackDisabled: number;
    recentChanges: unknown[];
  }>("/ledgerflow/system-rates/dashboard", systemAdminId);
  assert.equal(dashboard.response.status, 200);
  assert.ok(dashboard.body.availablePairs.length >= 4);
  assert.ok(dashboard.body.workspacesUsingFallback >= 1);
  assert.ok(dashboard.body.workspacesWithFallbackDisabled >= 1);
  assert.ok(dashboard.body.recentChanges.length >= 2);
  assert.doesNotMatch(JSON.stringify(dashboard.body), /functionalAmount|amount/i);
});