import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import {
  buildReportPack,
  eligibleReportProfiles,
  type ReportSnapshot,
} from "../src/lib/reportPack";

let server: Server | undefined;
let baseUrl = "";
let database: typeof import("@workspace/db") | undefined;
let testUserId = "";
let testClientId: number | undefined;

function testDatabaseUrl() {
  const value = process.env.LEDGERFLOW_TEST_DATABASE_URL;
  if (!value) throw new Error("LEDGERFLOW_TEST_DATABASE_URL is required for report-pack integration tests.");
  const databaseName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) {
    throw new Error("The LedgerFlow integration test database name must contain 'test'.");
  }
  return value;
}

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-user-id": testUserId,
      ...init?.headers,
    },
  });
  return { response, body: await response.json() as T };
}

function buildProfilePack(reportingBasis: string, presentationProfile: string, periodEnd = "2027-12-31") {
  return buildReportPack({
    client: {
      id: 1,
      name: "Profile test entity",
      legalName: "Profile test entity LLC",
      functionalCurrency: "AED",
      basis: reportingBasis,
    } as never,
    entries: [] as never,
    classifications: [],
    periodEnd,
    presentationCurrency: "AED",
    reportingBasis,
    presentationProfile,
    roundingPolicy: "Nearest whole unit",
    sourceImportCount: 0,
    missingRateEntries: [],
  });
}

before(async () => {
  process.env.DATABASE_URL = testDatabaseUrl();
  const { createApp } = await import("../src/app");
  const { createRequireAuth } = await import("../src/middlewares/authMiddleware");
  database = await import("@workspace/db");
  testUserId = `report-pack-test-${randomUUID()}`;
  await database.db.insert(database.usersTable).values({
    id: testUserId,
    email: `${testUserId}@example.test`,
    firstName: "Report",
    lastName: "Pack Test",
  });
  const [client] = await database.db.insert(database.clientsTable).values({
    name: `Report pack test ${testUserId}`,
    legalName: "Report Pack Test LLC",
    functionalCurrency: "AED",
    basis: "IFRS",
    period: "August 2026",
  }).returning();
  testClientId = client.id;
  await database.db.insert(database.clientWorkspacesTable).values({
    clientId: client.id,
    userId: testUserId,
    role: "admin",
  });

  const app = createApp({
    clerkAuthMiddleware: (_req, _res, next) => next(),
    requireAuthMiddleware: createRequireAuth((req) => ({
      sessionClaims: { userId: req.headers["x-test-user-id"] },
    })),
  });
  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}/api`;
});

after(async () => {
  if (database && testClientId) {
    await database.db.delete(database.reportPacksTable)
      .where(eq(database.reportPacksTable.clientId, testClientId));
    await database.db.delete(database.journalEntriesTable)
      .where(eq(database.journalEntriesTable.clientId, testClientId));
    await database.db.delete(database.statementLinesTable)
      .where(eq(database.statementLinesTable.clientId, testClientId));
    await database.db.delete(database.clientWorkspacesTable)
      .where(eq(database.clientWorkspacesTable.clientId, testClientId));
    await database.db.delete(database.clientsTable)
      .where(eq(database.clientsTable.id, testClientId));
  }
  if (database && testUserId) {
    await database.db.delete(database.usersTable).where(eq(database.usersTable.id, testUserId));
  }
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  await database?.pool.end();
});

test("blocks a draft pack with missing comparatives and accountant inputs", () => {
  const result = buildReportPack({
    client: {
      id: 1,
      name: "Test entity",
      legalName: "Test entity LLC",
      functionalCurrency: "AED",
    } as never,
    entries: [{
      id: 10,
      clientId: 1,
      statementLineId: 20,
      date: "2026-06-01",
      status: "posted",
      debitAccount: "General expenses",
      creditAccount: "Bank / cash",
      amount: "100",
      functionalAmount: "100",
      functionalCurrency: "AED",
    }] as never,
    classifications: [],
    periodEnd: "2026-12-31",
    presentationCurrency: "AED",
    reportingBasis: "IFRS",
    presentationProfile: "IAS 1",
    roundingPolicy: "Nearest whole unit",
    sourceImportCount: 1,
    missingRateEntries: [],
  });

  assert.equal(result.snapshot.traceability.postedEntryCount, 1);
  assert.equal(result.snapshot.cashFlows.find((row) => row.label === "Cash at end of year")?.current, -100);
  assert.equal(result.validation.status, "blocked");
  assert.equal(result.validation.checks.find((check) => check.id === "comparatives")?.blocking, true);
  assert.equal(result.validation.checks.find((check) => check.id === "notes")?.status, "error");
  assert.equal(result.checklist.length, 12);
});

test("accepts only the report profiles eligible for each basis and annual period", () => {
  assert.deepEqual(
    eligibleReportProfiles("2026-12-31", "IFRS").map((profile) => profile.profile),
    ["IAS 1"],
  );
  assert.deepEqual(
    eligibleReportProfiles("2027-12-31", "IFRS").map((profile) => profile.profile),
    ["IAS 1", "IFRS 18"],
  );
  assert.deepEqual(
    eligibleReportProfiles("2027-12-31", "IFRS for SMEs").map((profile) => profile.profile),
    ["IFRS for SMEs"],
  );
  assert.deepEqual(eligibleReportProfiles("2027-06-30", "IFRS"), []);
  assert.deepEqual(eligibleReportProfiles("2027-12-31", "US GAAP"), []);
});

test("keeps SME and IFRS 18 statements, notes, and checklist prompts distinct from IAS 1", () => {
  const ias1 = buildProfilePack("IFRS", "IAS 1");
  const sme = buildProfilePack("IFRS for SMEs", "IFRS for SMEs");
  const ifrs18 = buildProfilePack("IFRS", "IFRS 18");

  assert.ok(ias1.snapshot.profitOrLossAndOci.some((row) => row.label === "Other comprehensive income"));
  assert.ok(!sme.snapshot.profitOrLossAndOci.some((row) => row.label === "Other comprehensive income"));
  assert.ok(!sme.snapshot.changesInEquity.some((row) => row.label === "Other comprehensive income"));
  assert.equal(sme.snapshot.profitOrLossAndOci.length, ias1.snapshot.profitOrLossAndOci.length - 2);
  assert.notEqual(sme.notes.find((note) => note.number === 1)?.narrative, ias1.notes.find((note) => note.number === 1)?.narrative);
  assert.notEqual(sme.notes.find((note) => note.number === 4)?.narrative, ias1.notes.find((note) => note.number === 4)?.narrative);
  assert.equal(sme.checklist.length, 9);
  assert.ok(sme.checklist.every((item) => item.standard.startsWith("Section ")));
  assert.notDeepEqual(sme.checklist, ias1.checklist);

  assert.ok(ifrs18.snapshot.statementOfFinancialPosition.some((row) => row.label === "Current operating assets"));
  assert.ok(ifrs18.snapshot.profitOrLossAndOci.some((row) => row.label === "Operating expenses by nature or function"));
  assert.notEqual(
    ifrs18.notes.find((note) => note.number === 4)?.narrative,
    ias1.notes.find((note) => note.number === 4)?.narrative,
  );
  const iasChecklist = ias1.checklist.find((item) => item.standard === "IAS 1");
  const ifrs18Checklist = ifrs18.checklist.find((item) => item.standard === "IFRS 18");
  assert.ok(iasChecklist);
  assert.ok(ifrs18Checklist);
  assert.notEqual(ifrs18Checklist.prompt, iasChecklist.prompt);
  assert.equal(ifrs18Checklist.title, "Presentation and disclosure in financial statements");
});

test("rejects ineligible report-pack basis, profile, and period combinations", async () => {
  assert.ok(testClientId);
  const requests = [
    { periodEnd: "2026-12-31", reportingBasis: "IFRS", presentationProfile: "IFRS 18" },
    { periodEnd: "2027-12-31", reportingBasis: "IFRS for SMEs", presentationProfile: "IFRS for SMEs" },
    { periodEnd: "2027-06-30", reportingBasis: "IFRS", presentationProfile: "IAS 1" },
  ];

  for (const body of requests) {
    const result = await request<{ error: string }>("/ledgerflow/report-packs", {
      method: "POST",
      body: JSON.stringify({ clientId: testClientId, presentationCurrency: "AED", ...body }),
    });
    assert.equal(result.response.status, 422);
    assert.match(result.body.error, /eligible|annual reporting period/i);
  }
});

test("finalized snapshots retain their original profile and cannot be mutated", async () => {
  assert.ok(database);
  assert.ok(testClientId);
  const pack = buildProfilePack("IFRS", "IFRS 18");
  const [finalizedPack] = await database.db.insert(database.reportPacksTable).values({
    clientId: testClientId,
    createdBy: testUserId,
    periodStart: pack.periods.periodStart,
    periodEnd: pack.periods.periodEnd,
    comparativePeriodStart: pack.periods.comparativePeriodStart,
    comparativePeriodEnd: pack.periods.comparativePeriodEnd,
    reportingBasis: "IFRS",
    presentationProfile: "IFRS 18",
    presentationCurrency: "AED",
    roundingPolicy: "Nearest whole unit",
    status: "finalized",
    snapshot: pack.snapshot,
    validation: pack.validation,
    notes: pack.notes,
    checklist: pack.checklist,
    signatory: {
      preparedBy: "Preparer",
      reviewedBy: "Reviewer",
      authorizedBy: "Authorizer",
      authorizationDate: "2027-12-31",
    },
    finalizedAt: new Date(),
  }).returning();

  const saved = await request<{
    status: string;
    reportingBasis: string;
    presentationProfile: string;
    snapshot: ReportSnapshot;
  }>(`/ledgerflow/report-packs/${finalizedPack.id}`);
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.status, "finalized");
  assert.equal(saved.body.reportingBasis, "IFRS");
  assert.equal(saved.body.presentationProfile, "IFRS 18");
  assert.equal(saved.body.snapshot.reportingBasis, "IFRS");
  assert.equal(saved.body.snapshot.presentationProfile, "IFRS 18");
  const finalizedSnapshot = saved.body.snapshot;

  const mutation = await request<{ error: string }>(`/ledgerflow/report-packs/${finalizedPack.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      clientId: testClientId,
      action: "update_inputs",
      notes: [{ ...pack.notes[0], narrative: "Attempted profile mutation", requiresInput: false }],
    }),
  });
  assert.equal(mutation.response.status, 409);
  assert.match(mutation.body.error, /immutable/i);

  const reloaded = await request<{ status: string; snapshot: ReportSnapshot }>(
    `/ledgerflow/report-packs/${finalizedPack.id}`,
  );
  assert.equal(reloaded.response.status, 200);
  assert.equal(reloaded.body.status, "finalized");
  assert.deepEqual(reloaded.body.snapshot, finalizedSnapshot);
});
