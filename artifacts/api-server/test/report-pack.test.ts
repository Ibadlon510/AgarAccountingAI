import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import {
  buildReportPack,
  eligibleReportProfiles,
  finalizationValidation,
  type ReportSnapshot,
} from "../src/lib/reportPack";
import { buildReportPdf } from "../src/lib/reportPdf";
import { buildShareholdingSnapshot, closePeriodStartDate, formatShareParValue } from "../src/lib/shareCapital";

let server: Server | undefined;
let baseUrl = "";
let database: typeof import("@workspace/db") | undefined;
let testUserId = "";
let testClientId: number | undefined;

function testDatabaseUrl() {
  const value = process.env.AGARACCOUNTING_TEST_DATABASE_URL;
  if (!value) throw new Error("AGARACCOUNTING_TEST_DATABASE_URL is required for report-pack integration tests.");
  const databaseName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) {
    throw new Error("The AgarAccounting AI System integration test database name must contain 'test'.");
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

test("keeps missing comparatives as a warning while still blocking accountant inputs", () => {
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
  assert.equal(result.validation.checks.find((check) => check.id === "comparatives")?.status, "warning");
  assert.equal(result.validation.checks.find((check) => check.id === "comparatives")?.blocking, false);
  const validationWithMissingInput = finalizationValidation(
    result.validation,
    result.notes.map((note, index) => index === 0 ? { ...note, requiresInput: true } : note),
    result.checklist,
  );
  assert.equal(validationWithMissingInput.checks.find((check) => check.id === "notes")?.status, "error");
  assert.equal(validationWithMissingInput.status, "blocked");
  assert.equal(result.checklist.length, 12);
});

test("breaks the cash note down by persisted bank account and keeps unassigned cash separate", () => {
  const result = buildReportPack({
    client: {
      id: 1,
      name: "Bank note entity",
      legalName: "Bank Note Entity LLC",
      functionalCurrency: "AED",
    } as never,
    entries: [
      {
        id: 10,
        clientId: 1,
        statementLineId: 20,
        date: "2026-06-01",
        status: "posted",
        debitAccount: "Bank / cash",
        creditAccount: "Revenue",
        amount: "100",
        functionalAmount: "100",
        functionalCurrency: "AED",
      },
      {
        id: 11,
        clientId: 1,
        statementLineId: 21,
        date: "2026-07-01",
        status: "posted",
        debitAccount: "General expenses",
        creditAccount: "Bank / cash",
        amount: "30",
        functionalAmount: "30",
        functionalCurrency: "AED",
      },
      {
        id: 12,
        clientId: 1,
        statementLineId: null,
        date: "2026-08-01",
        status: "posted",
        debitAccount: "Bank / cash",
        creditAccount: "Revenue",
        amount: "5",
        functionalAmount: "5",
        functionalCurrency: "AED",
      },
    ] as never,
    classifications: [],
    periodEnd: "2026-12-31",
    presentationCurrency: "AED",
    reportingBasis: "IFRS",
    presentationProfile: "IAS 1",
    roundingPolicy: "Nearest whole unit",
    sourceImportCount: 1,
    missingRateEntries: [],
    bankAccounts: [
      { id: 1, name: "Operating", bankName: "Wio Bank", accountNumberLast4: "8819", currency: "AED" },
      { id: 2, name: "Reserve", bankName: "Wio Bank", accountNumberLast4: "4421", currency: "AED" },
    ],
    statementLines: [
      { id: 20, bankAccountId: 1 },
      { id: 21, bankAccountId: 2 },
    ],
  });

  const note = result.notes.find((item) => item.number === 3);
  assert.deepEqual(note?.tables, [
    { label: "Wio Bank — Operating •••• 8819 (AED)", current: 100, comparative: 0 },
    { label: "Wio Bank — Reserve •••• 4421 (AED)", current: -30, comparative: 0 },
    { label: "Other cash and bank balances", current: 5, comparative: 0 },
  ]);
  assert.equal(note?.tables.reduce((total, row) => total + row.current, 0), 75);
  assert.equal(result.validation.checks.find((check) => check.id === "note-totals")?.status, "pass");
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

test("brands generated report PDFs as AgarAccounting AI System", () => {
  const { snapshot } = buildProfilePack("IFRS", "IAS 1");
  const pdf = buildReportPdf(snapshot, {
    preparedBy: "Report Preparer",
    reviewedBy: "Report Reviewer",
    authorizedBy: "Report Authorizer",
    authorizationDate: "2027-12-31",
  }).toString("utf8");
  assert.match(pdf, /AgarAccounting AI System report snapshot/);
  assert.match(pdf, /evidence linkage in\)/);
  assert.match(pdf, /\(AgarAccounting AI System\.\)/);
  assert.match(pdf, /\(Profile test entity LLC\)/);
  assert.doesNotMatch(pdf, /\(Profile test entity\)/);
  assert.equal((pdf.match(/Authorized signatory/g) ?? []).length, 5);
});

test("includes only frozen eligible firm attribution in report PDFs", () => {
  const { snapshot } = buildProfilePack("IFRS", "IAS 1");
  const signatory = {
    preparedBy: "Report Preparer",
    reviewedBy: "Report Reviewer",
    authorizedBy: "Report Authorizer",
    authorizationDate: "2027-12-31",
  };
  const unattributedPdf = buildReportPdf(snapshot, signatory).toString("utf8");
  assert.doesNotMatch(unattributedPdf, /Prepared by firm:/);

  const attributedPdf = buildReportPdf({
    ...snapshot,
    firmAttribution: { enabled: true, firmName: "Snapshot Accounting Firm" },
  }, signatory).toString("utf8");
  assert.match(attributedPdf, /\(Prepared by firm: Snapshot Accounting Firm\)/);
});

test("keeps SME and IFRS 18 statements, notes, and checklist prompts distinct from IAS 1", () => {
  const ias1 = buildProfilePack("IFRS", "IAS 1");
  const sme = buildProfilePack("IFRS for SMEs", "IFRS for SMEs");
  const ifrs18 = buildProfilePack("IFRS", "IFRS 18");

  assert.ok(ias1.notes.filter((note) => note.title !== "Share capital").every((note) => !note.requiresInput && note.narrative.trim().length > 40));
  assert.ok(ias1.notes.every((note) => !/Accountant input required/i.test(note.narrative)));
  assert.equal(ias1.notes.find((note) => note.number === 8)?.title, "Share capital");
  assert.equal(ias1.notes.find((note) => note.number === 8)?.requiresInput, true);
  assert.equal(ias1.notes.find((note) => note.number === 9)?.title, "Financial risk, foreign currency and other disclosures");
  assert.equal(ias1.notes.find((note) => note.number === 10)?.title, "Subsequent events");
  assert.ok(ias1.checklist.every((item) => !["applicable", "requires_accountant_input"].includes(item.status)));
  assert.match(ias1.notes.find((note) => note.number === 1)?.narrative ?? "", /International Financial Reporting Standards/);
  assert.match(sme.notes.find((note) => note.number === 1)?.narrative ?? "", /IFRS for SMEs/);

  assert.ok(ias1.snapshot.profitOrLossAndOci.some((row) => row.label === "Other comprehensive income"));
  assert.ok(!sme.snapshot.profitOrLossAndOci.some((row) => row.label === "Other comprehensive income"));
  assert.ok(!sme.snapshot.changesInEquity.some((period) => period.children?.some((row) => row.label === "Other comprehensive income")));
  assert.ok(sme.snapshot.changesInEquity.every((period) => /^Year ended /.test(period.label)));
  assert.ok(ias1.snapshot.changesInEquity[0]?.children?.some((row) => row.children?.some((cell) => cell.label === "Share capital")));
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
    const result: { response: Response; body: { error: string } } = await request<{ error: string }>("/agaraccounting/report-packs", {
      method: "POST",
      body: JSON.stringify({ clientId: testClientId, presentationCurrency: "AED", ...body }),
    });
    assert.equal(result.response.status, 422);
    assert.match(result.body.error, /eligible|annual reporting period/i);
  }
});

test("freezes firm attribution only for active firm relationships and members", async () => {
  assert.ok(database);
  assert.ok(testClientId);
  const staffUserId = `report-pack-staff-${randomUUID()}`;
  let firmId: number | undefined;
  let engagementId: number | undefined;
  try {
    await database.db.insert(database.usersTable).values({
      id: staffUserId,
      email: `${staffUserId}@example.test`,
      firstName: "Firm",
      lastName: "Staff",
    });
    const [firm] = await database.db.insert(database.firmProfilesTable).values({
      ownerUserId: testUserId,
      name: "Original Accounting Firm",
      legalName: "Original Accounting Firm LLC",
      profileKind: "accounting_firm",
    }).returning();
    firmId = firm.id;
    await database.db.insert(database.firmMembershipsTable).values([
      { firmId: firm.id, userId: testUserId, role: "owner", status: "active" },
      { firmId: firm.id, userId: staffUserId, role: "accountant", status: "active" },
    ]);
    const [engagement] = await database.db.insert(database.firmCompanyEngagementsTable).values({
      firmId: firm.id,
      clientId: testClientId,
      status: "active",
      invitedByUserId: testUserId,
      acceptedByUserId: testUserId,
      acceptedAt: new Date(),
    }).returning();
    engagementId = engagement.id;

    const defaultProfile = await request<{ reportAttributionEnabled: boolean }>("/workspace/firm-profile");
    assert.equal(defaultProfile.response.status, 200);
    assert.equal(defaultProfile.body.reportAttributionEnabled, false);

    const enabledProfile = await request<{ name: string; reportAttributionEnabled: boolean }>("/workspace/firm-profile", {
      method: "PATCH",
      body: JSON.stringify({
        name: "Original Accounting Firm",
        legalName: "Original Accounting Firm LLC",
        reportAttributionEnabled: true,
      }),
    });
    assert.equal(enabledProfile.response.status, 200);
    assert.equal(enabledProfile.body.reportAttributionEnabled, true);

    const deniedStaffUpdate = await request<{ error: string }>("/workspace/firm-profile", {
      method: "PATCH",
      headers: { "x-test-user-id": staffUserId },
      body: JSON.stringify({
        name: "Unauthorized Rename",
        legalName: "Unauthorized Rename LLC",
        reportAttributionEnabled: false,
      }),
    });
    assert.equal(deniedStaffUpdate.response.status, 403);
    assert.match(deniedStaffUpdate.body.error, /owners or admins/i);

    const attributed = await request<{ id: number; snapshot: ReportSnapshot }>("/agaraccounting/report-packs", {
      method: "POST",
      body: JSON.stringify({
        clientId: testClientId,
        periodEnd: "2026-12-31",
        reportingBasis: "IFRS",
        presentationProfile: "IAS 1",
        presentationCurrency: "AED",
      }),
    });
    assert.equal(attributed.response.status, 201);
    assert.deepEqual(attributed.body.snapshot.firmAttribution, {
      enabled: true,
      firmName: "Original Accounting Firm",
    });

    const disabledProfile = await request<{ reportAttributionEnabled: boolean }>("/workspace/firm-profile", {
      method: "PATCH",
      body: JSON.stringify({
        name: "Renamed Accounting Firm",
        legalName: "Renamed Accounting Firm LLC",
        reportAttributionEnabled: false,
      }),
    });
    assert.equal(disabledProfile.response.status, 200);
    assert.equal(disabledProfile.body.reportAttributionEnabled, false);
    const historical = await request<{ snapshot: ReportSnapshot }>(`/agaraccounting/report-packs/${attributed.body.id}`);
    assert.deepEqual(historical.body.snapshot.firmAttribution, {
      enabled: true,
      firmName: "Original Accounting Firm",
    });

    const disabled = await request<{ snapshot: ReportSnapshot }>("/agaraccounting/report-packs", {
      method: "POST",
      body: JSON.stringify({ clientId: testClientId, periodEnd: "2026-12-31" }),
    });
    assert.equal(disabled.response.status, 201);
    assert.deepEqual(disabled.body.snapshot.firmAttribution, { enabled: false, firmName: null });

    await request("/workspace/firm-profile", {
      method: "PATCH",
      body: JSON.stringify({
        name: "Renamed Accounting Firm",
        legalName: "Renamed Accounting Firm LLC",
        reportAttributionEnabled: true,
      }),
    });
    await database.db.update(database.firmCompanyEngagementsTable)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(eq(database.firmCompanyEngagementsTable.id, engagement.id));
    const revokedRelationship = await request<{ snapshot: ReportSnapshot }>("/agaraccounting/report-packs", {
      method: "POST",
      body: JSON.stringify({ clientId: testClientId, periodEnd: "2026-12-31" }),
    });
    assert.deepEqual(revokedRelationship.body.snapshot.firmAttribution, { enabled: false, firmName: null });

    await database.db.update(database.firmCompanyEngagementsTable)
      .set({ status: "active", revokedAt: null })
      .where(eq(database.firmCompanyEngagementsTable.id, engagement.id));
    await database.db.update(database.firmMembershipsTable)
      .set({ status: "revoked" })
      .where(eq(database.firmMembershipsTable.userId, testUserId));
    const revokedMember = await request<{ snapshot: ReportSnapshot }>("/agaraccounting/report-packs", {
      method: "POST",
      body: JSON.stringify({ clientId: testClientId, periodEnd: "2026-12-31" }),
    });
    assert.deepEqual(revokedMember.body.snapshot.firmAttribution, { enabled: false, firmName: null });
  } finally {
    if (engagementId) {
      await database.db.delete(database.firmCompanyEngagementsTable)
        .where(eq(database.firmCompanyEngagementsTable.id, engagementId));
    }
    if (firmId) {
      await database.db.delete(database.firmMembershipsTable)
        .where(eq(database.firmMembershipsTable.firmId, firmId));
      await database.db.delete(database.firmProfilesTable)
        .where(eq(database.firmProfilesTable.id, firmId));
    }
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
  }>(`/agaraccounting/report-packs/${finalizedPack.id}`);
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.status, "finalized");
  assert.equal(saved.body.reportingBasis, "IFRS");
  assert.equal(saved.body.presentationProfile, "IFRS 18");
  assert.equal(saved.body.snapshot.reportingBasis, "IFRS");
  assert.equal(saved.body.snapshot.presentationProfile, "IFRS 18");
  const finalizedSnapshot = saved.body.snapshot;

  const mutation = await request<{ error: string }>(`/agaraccounting/report-packs/${finalizedPack.id}`, {
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
    `/agaraccounting/report-packs/${finalizedPack.id}`,
  );
  assert.equal(reloaded.response.status, 200);
  assert.equal(reloaded.body.status, "finalized");
  assert.deepEqual(reloaded.body.snapshot, finalizedSnapshot);
});

test("builds a Share capital note from the client register", () => {
  assert.equal(closePeriodStartDate("August 2026"), "2026-08-01");
  assert.equal(formatShareParValue(2000), "2000");
  const snapshot = buildShareholdingSnapshot({
    authorisedShares: 100,
    parValue: 2000,
    shareholders: [
      { name: "Mona Wagdy Ayad Helmy", nationality: "Indian", numberOfShares: 40 },
      { name: "Emad Helmy Saad Tadros", nationality: null, numberOfShares: 60 },
    ],
  });
  assert.deepEqual(snapshot, {
    authorisedShares: 100,
    parValue: 2000,
    rows: [
      { name: "Mona Wagdy Ayad Helmy", nationality: "Indian", numberOfShares: 40, percentage: 40, value: 80000 },
      { name: "Emad Helmy Saad Tadros", nationality: null, numberOfShares: 60, percentage: 60, value: 120000 },
    ],
  });

  assert.equal(buildShareholdingSnapshot({
    authorisedShares: 100,
    parValue: 2000,
    shareholders: [],
  }), undefined);

  const pack = buildReportPack({
    client: {
      id: 1,
      name: "Share capital entity",
      legalName: "Share Capital Test LLC",
      functionalCurrency: "AED",
      shareCapitalAuthorisedShares: 100,
      shareCapitalParValue: "2000.00",
    } as never,
    entries: [{
      id: 11,
      clientId: 1,
      statementLineId: null,
      date: "2026-08-01",
      status: "posted",
      debitAccount: "Due from shareholders",
      creditAccount: "Share capital",
      amount: "200000",
      functionalAmount: "200000",
      functionalCurrency: "AED",
    }] as never,
    classifications: [],
    periodEnd: "2026-12-31",
    presentationCurrency: "AED",
    reportingBasis: "IFRS",
    presentationProfile: "IAS 1",
    roundingPolicy: "Nearest whole unit",
    sourceImportCount: 0,
    missingRateEntries: [],
    shareholders: [
      { name: "Mona Wagdy Ayad Helmy", nationality: "Indian", numberOfShares: 40 },
      { name: "Emad Helmy Saad Tadros", nationality: null, numberOfShares: 60 },
    ],
  });

  const note = pack.notes.find((item) => item.number === 8);
  assert.equal(note?.title, "Share capital");
  assert.equal(note?.requiresInput, false);
  assert.match(note?.narrative ?? "", /comprises 100 shares of AED 2000 each/);
  assert.match(note?.narrative ?? "", /Shareholding at 31 December 2026 is as under/);
  assert.equal(note?.shareholding?.rows[0]?.value, 80000);
  assert.equal(note?.shareholding?.rows[1]?.value, 120000);
  const equity = pack.snapshot.statementOfFinancialPosition.find((row) => row.label === "Equity");
  const shareCapital = equity?.children?.find((row) => row.label === "Share capital");
  assert.equal(shareCapital?.current, 200000);
  assert.equal(shareCapital?.noteRef, "8");
  const pdf = buildReportPdf(pack.snapshot, {
    preparedBy: "Preparer",
    reviewedBy: "Reviewer",
    authorizedBy: "Authorizer",
    authorizationDate: "2026-12-31",
  }).toString("utf8");
  assert.match(pdf, /Mona Wagdy Ayad Helmy/);
  assert.match(pdf, /80,000/);
});
