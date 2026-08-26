import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";

let server: Server | undefined;
let baseUrl = "";
let database: typeof import("@workspace/db") | undefined;
const systemAdminId = `system-rate-admin-${randomUUID()}`;
const tenantAdminId = `tenant-admin-${randomUUID()}`;
const initialClaimAdminId = `initial-claim-system-rate-admin-${randomUUID()}`;
const initialClaimOtherUserId = `initial-claim-other-user-${randomUUID()}`;
const userIds = [systemAdminId, tenantAdminId, initialClaimAdminId, initialClaimOtherUserId];
const clientIds: number[] = [];
const firmIds: number[] = [];

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
      await database.db.delete(database.systemRateAdminBootstrapStateTable);
      await database.db.delete(database.systemRateAuditEventsTable)
        .where(inArray(database.systemRateAuditEventsTable.actorUserId, userIds));
      await database.db.delete(database.systemRatesTable)
        .where(inArray(database.systemRatesTable.createdByUserId, userIds));
      await database.db.delete(database.systemRateAdminsTable)
        .where(inArray(database.systemRateAdminsTable.userId, userIds));
      const ownedClients = await database.db.select({ id: database.clientsTable.id })
        .from(database.clientsTable)
        .where(inArray(database.clientsTable.ownerUserId, userIds));
      clientIds.push(...ownedClients.map(({ id }) => id));
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

test("allows one authenticated user to claim once and keeps the claim closed after entitlement deletion", async () => {
  assert.ok(database);
  assert.equal((await request<Array<{ id: number }>>("/clients", initialClaimAdminId)).response.status, 200);
  await database.db.insert(database.usersTable).values({ id: initialClaimOtherUserId });

  const concurrentClaims = await Promise.all([
    request<{ status?: string; error?: string }>(
      "/agaraccounting/system-admin/claim-initial-access",
      initialClaimAdminId,
      { method: "POST" },
    ),
    request<{ status?: string; error?: string }>(
      "/agaraccounting/system-admin/claim-initial-access",
      initialClaimOtherUserId,
      { method: "POST" },
    ),
  ]);
  assert.deepEqual(concurrentClaims.map(({ response }) => response.status).sort(), [200, 409]);
  const winnerId = concurrentClaims[0]!.response.status === 200 ? initialClaimAdminId : initialClaimOtherUserId;
  const otherId = winnerId === initialClaimAdminId ? initialClaimOtherUserId : initialClaimAdminId;
  assert.equal((await request<unknown[]>("/agaraccounting/system-rates", winnerId)).response.status, 200);

  await database.db.update(database.systemRateAdminsTable)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(eq(database.systemRateAdminsTable.userId, winnerId));
  await database.db.delete(database.systemRateAdminsTable)
    .where(eq(database.systemRateAdminsTable.userId, winnerId));
  const deniedAfterRevocation = await request<{ error: string }>(
    "/agaraccounting/system-admin/claim-initial-access",
    otherId,
    { method: "POST" },
  );
  assert.equal(deniedAfterRevocation.response.status, 409);
  assert.equal((await request<unknown[]>("/agaraccounting/system-rates", winnerId)).response.status, 403);
  const [closedBootstrap] = await database.db.select().from(database.systemRateAdminBootstrapStateTable);
  assert.equal(closedBootstrap.reason, "initial_claim");
  assert.equal(closedBootstrap.closedByUserId, winnerId);

  const ownedClients = await database.db.select({ id: database.clientsTable.id }).from(database.clientsTable)
    .where(inArray(database.clientsTable.ownerUserId, [initialClaimAdminId, initialClaimOtherUserId]));
  clientIds.push(...ownedClients.map(({ id }) => id));
});

test("protects and applies the system catalog with traceable fallback precedence", async () => {
  assert.ok(database);
  const adminClients = await request<Array<{ id: number }>>("/clients", systemAdminId);
  const tenantClients = await request<Array<{ id: number }>>("/clients", tenantAdminId);
  assert.equal(adminClients.response.status, 200);
  assert.equal(tenantClients.response.status, 200);
  const clientId = adminClients.body[0]!.id;
  const tenantClientId = tenantClients.body[0]!.id;
  clientIds.push(clientId, tenantClientId);

  const denied = await request<{ error: string }>("/agaraccounting/system-rates", tenantAdminId);
  assert.equal(denied.response.status, 403);
  assert.match(denied.body.error, /system administrator/i);
  const deniedClear = await request<{ error: string }>("/agaraccounting/system-rates", tenantAdminId, {
    method: "DELETE",
  });
  assert.equal(deniedClear.response.status, 403);
  const deniedPreview = await request<{ error: string }>("/agaraccounting/system-rates/parse", tenantAdminId, {
    method: "POST",
    body: JSON.stringify({ fileBase64: "dGVzdA==", fileName: "rates.xlsx" }),
  });
  assert.equal(deniedPreview.response.status, 403);

  await database.db.insert(database.systemRateAdminsTable).values({
    userId: systemAdminId,
    status: "active",
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { effectiveDate: "2026-08-01", sourceCurrency: "CAD", rate: 2.7 },
    { effectiveDate: "2026-08-02", sourceCurrency: "CHF", rate: 4.5 },
  ]), "Rates");
  const preview = await request<{ rates: Array<{ sourceCurrency: string; functionalCurrency: string; rate: number }> }>(
    "/agaraccounting/system-rates/parse",
    systemAdminId,
    {
      method: "POST",
      body: JSON.stringify({
        fileBase64: XLSX.write(workbook, { type: "base64", bookType: "xlsx" }),
        fileName: "system-rates.xlsx",
      }),
    },
  );
  assert.equal(preview.response.status, 200);
  assert.deepEqual(
    preview.body.rates.map(({ sourceCurrency, functionalCurrency, rate }) => ({ sourceCurrency, functionalCurrency, rate })),
    [
      { sourceCurrency: "CAD", functionalCurrency: "AED", rate: 2.7 },
      { sourceCurrency: "CHF", functionalCurrency: "AED", rate: 4.5 },
    ],
  );
  const namedCurrencySheet = XLSX.utils.aoa_to_sheet([
    ["Date", "Currency", "Rate"],
    [new Date("2025-01-01T00:00:00.000Z"), "US Dollar", 3.6725],
    [new Date("2025-01-02T00:00:00.000Z"), "US Dollar", 3.6725],
  ]);
  namedCurrencySheet.A2!.z = "m/d/yy";
  namedCurrencySheet.A3!.z = "m/d/yy";
  const namedCurrencyWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(namedCurrencyWorkbook, namedCurrencySheet, "2025 Consolidated");
  const namedCurrencyPreview = await request<{
    mapping: { functionalCurrency: string | null };
    rates: Array<{ sourceCurrency: string; functionalCurrency: string; effectiveDate: string; rate: number }>;
    warnings: string[];
  }>("/agaraccounting/system-rates/parse", systemAdminId, {
    method: "POST",
    body: JSON.stringify({
      fileBase64: XLSX.write(namedCurrencyWorkbook, { type: "base64", bookType: "xlsx" }),
      fileName: "2025_Consolidated_USD_Rates.xlsx",
    }),
  });
  assert.equal(namedCurrencyPreview.response.status, 200);
  assert.equal(namedCurrencyPreview.body.mapping.functionalCurrency, null);
  assert.deepEqual(namedCurrencyPreview.body.rates.map((rate) => ({
    sourceCurrency: rate.sourceCurrency,
    functionalCurrency: rate.functionalCurrency,
    effectiveDate: rate.effectiveDate,
    rate: rate.rate,
  })), [
    { sourceCurrency: "USD", functionalCurrency: "AED", effectiveDate: "2025-01-01", rate: 3.6725 },
    { sourceCurrency: "USD", functionalCurrency: "AED", effectiveDate: "2025-01-02", rate: 3.6725 },
  ]);
  assert.match(namedCurrencyPreview.body.warnings.join(" "), /AED/i);
  const invalidCurrencyWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(invalidCurrencyWorkbook, XLSX.utils.aoa_to_sheet([
    ["Date", "Currency", "Rate"],
    ["2025-01-01", "Unknown Credits", 3.6725],
  ]), "Rates");
  const invalidCurrencyPreview = await request<{ error: string }>("/agaraccounting/system-rates/parse", systemAdminId, {
    method: "POST",
    body: JSON.stringify({
      fileBase64: XLSX.write(invalidCurrencyWorkbook, { type: "base64", bookType: "xlsx" }),
      fileName: "invalid-currency-rates.xlsx",
    }),
  });
  assert.equal(invalidCurrencyPreview.response.status, 422);
  assert.match(invalidCurrencyPreview.body.error, /source currency values were not recognized/i);
  assert.deepEqual((await request<unknown[]>("/agaraccounting/system-rates", systemAdminId)).body, []);

  const historicalLine = await request<{
    id: number;
    functionalAmount: number | null;
    exchangeRate: number | null;
    exchangeRateSourceScope: string;
    exchangeRateStatus: string;
  }>("/agaraccounting/statement-lines", systemAdminId, {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-08-20",
      description: "Historical rate gap",
      currency: "USD",
      amount: 100,
      direction: "outflow",
    }),
  });
  assert.equal(historicalLine.response.status, 201);
  assert.equal(historicalLine.body.functionalAmount, null);
  assert.equal(historicalLine.body.exchangeRate, null);
  assert.equal(historicalLine.body.exchangeRateStatus, "missing");

  const systemRates = [
    { sourceCurrency: "USD", functionalCurrency: "AED", effectiveDate: "2026-08-01", rate: 3.5, source: "System test" },
    { sourceCurrency: "EUR", functionalCurrency: "AED", effectiveDate: "2026-08-01", rate: 4.0, source: "System test" },
    { sourceCurrency: "GBP", functionalCurrency: "AED", effectiveDate: "2026-08-01", rate: 4.6, source: "System test" },
    { sourceCurrency: "JPY", functionalCurrency: "AED", effectiveDate: "2026-08-01", rate: 0.025, source: "System test" },
  ];
  const imported = await request<{ importedCount: number; rates: Array<{ id: number; effectiveDate: string }> }>(
    "/agaraccounting/system-rates/import",
    systemAdminId,
    { method: "POST", body: JSON.stringify({ rates: systemRates }) },
  );
  assert.equal(imported.response.status, 200);
  assert.equal(imported.body.importedCount, 4);
  assert.equal(imported.body.rates[0]!.effectiveDate, "2026-08-01");
  const [refreshedHistoricalLine] = await database.db.select().from(database.statementLinesTable)
    .where(eq(database.statementLinesTable.id, historicalLine.body.id));
  const [refreshedHistoricalJournal] = await database.db.select().from(database.journalEntriesTable)
    .where(eq(database.journalEntriesTable.statementLineId, historicalLine.body.id));
  assert.equal(refreshedHistoricalLine.functionalAmount, "350.00");
  assert.equal(refreshedHistoricalLine.exchangeRate, "3.5000000000");
  assert.equal(refreshedHistoricalLine.exchangeRateEffectiveDate, "2026-08-01");
  assert.equal(refreshedHistoricalLine.exchangeRateSourceScope, "system");
  assert.equal(refreshedHistoricalLine.exchangeRateStatus, "prior");
  assert.equal(refreshedHistoricalJournal.functionalAmount, refreshedHistoricalLine.functionalAmount);
  assert.equal(refreshedHistoricalJournal.exchangeRate, refreshedHistoricalLine.exchangeRate);
  assert.equal(refreshedHistoricalJournal.exchangeRateEffectiveDate, refreshedHistoricalLine.exchangeRateEffectiveDate);
  assert.equal(refreshedHistoricalJournal.exchangeRateSourceScope, refreshedHistoricalLine.exchangeRateSourceScope);
  assert.equal(refreshedHistoricalJournal.exchangeRateStatus, refreshedHistoricalLine.exchangeRateStatus);

  const companyRate = await request<{ id: number }>(`/agaraccounting/exchange-rates?clientId=${clientId}`, systemAdminId, {
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
  const firmRate = await request<{ id: number }>(`/agaraccounting/exchange-rates?firmId=${firm.id}`, systemAdminId, {
    method: "POST",
    body: JSON.stringify({ sourceCurrency: "EUR", functionalCurrency: "AED", effectiveDate: "2026-08-01", rate: 4.2 }),
  });
  assert.equal(firmRate.response.status, 201);

  const createLine = (currency: string, description: string) => request<{
    id: number;
    exchangeRate: number | null;
    exchangeRateSourceScope: string;
    exchangeRateStatus: string;
  }>("/agaraccounting/statement-lines", systemAdminId, {
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
  const firmOptOutCandidate = await createLine("JPY", "Firm opt-out candidate");
  assert.equal(firmOptOutCandidate.body.exchangeRateSourceScope, "system");
  const disabledFirm = await request("/workspace/firm-profile", systemAdminId, {
    method: "PATCH",
    body: JSON.stringify({
      name: "System rate test firm",
      legalName: "System rate test firm LLC",
      systemRatesEnabled: false,
    }),
  });
  assert.equal(disabledFirm.response.status, 200);
  const [clearedFirmOptOutLine] = await database.db.select().from(database.statementLinesTable)
    .where(eq(database.statementLinesTable.id, firmOptOutCandidate.body.id));
  const [clearedFirmOptOutJournal] = await database.db.select().from(database.journalEntriesTable)
    .where(eq(database.journalEntriesTable.statementLineId, firmOptOutCandidate.body.id));
  assert.equal(clearedFirmOptOutLine.exchangeRate, null);
  assert.equal(clearedFirmOptOutLine.exchangeRateStatus, "missing");
  assert.equal(clearedFirmOptOutJournal.exchangeRate, null);
  assert.equal(clearedFirmOptOutJournal.exchangeRateStatus, "missing");
  const firmOptedOutLine = await createLine("JPY", "Firm opted out");
  assert.equal(firmOptedOutLine.body.exchangeRateSourceScope, "none");
  assert.equal(firmOptedOutLine.body.exchangeRateStatus, "missing");
  const enabledFirm = await request("/workspace/firm-profile", systemAdminId, {
    method: "PATCH",
    body: JSON.stringify({
      name: "System rate test firm",
      legalName: "System rate test firm LLC",
      systemRatesEnabled: true,
    }),
  });
  assert.equal(enabledFirm.response.status, 200);

  const companyLine = await createLine("USD", "Company precedence");
  const firmLine = await createLine("EUR", "Firm precedence");
  const systemLine = await createLine("GBP", "System precedence");
  assert.equal(companyLine.body.exchangeRateSourceScope, "client");
  assert.equal(companyLine.body.exchangeRate, 3.8);
  assert.equal(firmLine.body.exchangeRateSourceScope, "firm");
  assert.equal(firmLine.body.exchangeRate, 4.2);
  assert.equal(systemLine.body.exchangeRateSourceScope, "system");
  assert.equal(systemLine.body.exchangeRate, 4.6);

  const clientOptOutCandidate = await createLine("JPY", "Client opt-out candidate");
  assert.equal(clientOptOutCandidate.body.exchangeRateSourceScope, "system");
  const journals = await request<Array<{ id: number; statementLineId: number }>>(
    `/agaraccounting/journal-entries?clientId=${clientId}`,
    systemAdminId,
  );
  const systemJournal = journals.body.find((entry) => entry.statementLineId === systemLine.body.id);
  assert.ok(systemJournal);
  assert.equal((await request(`/agaraccounting/journal-entries/${systemJournal.id}/approve`, systemAdminId, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  })).response.status, 200);
  assert.equal((await request(`/agaraccounting/journal-entries/${systemJournal.id}/post`, systemAdminId, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  })).response.status, 200);

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
  const [clearedClientOptOutLine] = await database.db.select().from(database.statementLinesTable)
    .where(eq(database.statementLinesTable.id, clientOptOutCandidate.body.id));
  const [clearedClientOptOutJournal] = await database.db.select().from(database.journalEntriesTable)
    .where(eq(database.journalEntriesTable.statementLineId, clientOptOutCandidate.body.id));
  assert.equal(clearedClientOptOutLine.exchangeRate, null);
  assert.equal(clearedClientOptOutLine.exchangeRateStatus, "missing");
  assert.equal(clearedClientOptOutJournal.exchangeRate, null);
  assert.equal(clearedClientOptOutJournal.exchangeRateStatus, "missing");
  const optedOutLine = await createLine("JPY", "Opted out");
  assert.equal(optedOutLine.body.exchangeRateSourceScope, "none");
  assert.equal(optedOutLine.body.exchangeRateStatus, "missing");

  const gbpRate = imported.body.rates[2]!;
  const updatedSystemRate = await request(`/agaraccounting/system-rates/${gbpRate.id}`, systemAdminId, {
    method: "PATCH",
    body: JSON.stringify({ ...systemRates[2], rate: 9.9 }),
  });
  assert.equal(updatedSystemRate.response.status, 200);
  const [postedLine] = await database.db.select().from(database.statementLinesTable)
    .where(eq(database.statementLinesTable.id, systemLine.body.id));
  assert.equal(postedLine.exchangeRate, "4.6000000000");
  assert.equal(postedLine.exchangeRateSourceScope, "system");

  await database.db.update(database.clientsTable).set({ systemRatesEnabled: true })
    .where(eq(database.clientsTable.id, clientId));
  await database.db.update(database.clientsTable).set({ systemRatesEnabled: false })
    .where(eq(database.clientsTable.id, tenantClientId));
  const postedGapLine = await createLine("AUD", "Posted historical gap");
  assert.equal(postedGapLine.body.exchangeRateStatus, "missing");
  await database.db.update(database.statementLinesTable).set({ status: "posted" })
    .where(eq(database.statementLinesTable.id, postedGapLine.body.id));
  await database.db.update(database.journalEntriesTable).set({ status: "posted" })
    .where(eq(database.journalEntriesTable.statementLineId, postedGapLine.body.id));
  const createdAudRate = await request<{ id: number }>("/agaraccounting/system-rates", systemAdminId, {
    method: "POST",
    body: JSON.stringify({
      sourceCurrency: "AUD",
      functionalCurrency: "AED",
      effectiveDate: "2026-08-01",
      rate: 2.4,
      source: "System test",
    }),
  });
  assert.equal(createdAudRate.response.status, 201);
  const [completedPostedLine] = await database.db.select().from(database.statementLinesTable)
    .where(eq(database.statementLinesTable.id, postedGapLine.body.id));
  const [completedPostedJournal] = await database.db.select().from(database.journalEntriesTable)
    .where(eq(database.journalEntriesTable.statementLineId, postedGapLine.body.id));
  assert.equal(completedPostedLine.functionalAmount, "240.00");
  assert.equal(completedPostedLine.exchangeRate, "2.4000000000");
  assert.equal(completedPostedJournal.functionalAmount, completedPostedLine.functionalAmount);
  assert.equal(completedPostedJournal.exchangeRate, completedPostedLine.exchangeRate);

  const unpostedAudLine = await createLine("AUD", "Unposted rate removal");
  assert.equal(unpostedAudLine.body.exchangeRate, 2.4);
  const deletedAudRate = await request(`/agaraccounting/system-rates/${createdAudRate.body.id}`, systemAdminId, {
    method: "DELETE",
  });
  assert.equal(deletedAudRate.response.status, 204);
  const [preservedPostedLine] = await database.db.select().from(database.statementLinesTable)
    .where(eq(database.statementLinesTable.id, postedGapLine.body.id));
  const [refreshedUnpostedLine] = await database.db.select().from(database.statementLinesTable)
    .where(eq(database.statementLinesTable.id, unpostedAudLine.body.id));
  const [refreshedUnpostedJournal] = await database.db.select().from(database.journalEntriesTable)
    .where(eq(database.journalEntriesTable.statementLineId, unpostedAudLine.body.id));
  assert.equal(preservedPostedLine.exchangeRate, "2.4000000000");
  assert.equal(refreshedUnpostedLine.functionalAmount, null);
  assert.equal(refreshedUnpostedLine.exchangeRate, null);
  assert.equal(refreshedUnpostedLine.exchangeRateStatus, "missing");
  assert.equal(refreshedUnpostedJournal.functionalAmount, null);
  assert.equal(refreshedUnpostedJournal.exchangeRate, null);
  assert.equal(refreshedUnpostedJournal.exchangeRateStatus, "missing");

  const dashboard = await request<{
    availablePairs: unknown[];
    workspacesUsingFallback: number;
    workspacesWithFallbackDisabled: number;
    recentChanges: unknown[];
  }>("/agaraccounting/system-rates/dashboard", systemAdminId);
  assert.equal(dashboard.response.status, 200);
  assert.ok(dashboard.body.availablePairs.length >= 4);
  assert.ok(dashboard.body.workspacesUsingFallback >= 1);
  assert.ok(dashboard.body.workspacesWithFallbackDisabled >= 1);
  assert.ok(dashboard.body.recentChanges.length >= 2);
  assert.doesNotMatch(JSON.stringify(dashboard.body), /functionalAmount|amount/i);

  const cleared = await request<{ deletedCount: number }>("/agaraccounting/system-rates", systemAdminId, {
    method: "DELETE",
  });
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.body.deletedCount, systemRates.length);
  assert.deepEqual((await request<unknown[]>("/agaraccounting/system-rates", systemAdminId)).body, []);
  const clearedDashboard = await request<{ availablePairs: unknown[]; recentChanges: Array<{ summary: string }> }>(
    "/agaraccounting/system-rates/dashboard",
    systemAdminId,
  );
  assert.equal(clearedDashboard.response.status, 200);
  assert.deepEqual(clearedDashboard.body.availablePairs, []);
  assert.match(clearedDashboard.body.recentChanges[0]!.summary, /cleared 4 global exchange rates/i);
});

