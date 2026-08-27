import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";

let server: Server | undefined;
let baseUrl = "";
let database: typeof import("@workspace/db");
const ownerId = `chart-owner-${randomUUID()}`;
const memberId = `chart-member-${randomUUID()}`;
const foreignId = `chart-foreign-${randomUUID()}`;
let clientId = 0;

function testDatabaseUrl() {
  const value = process.env.AGARACCOUNTING_TEST_DATABASE_URL;
  if (!value) throw new Error("AGARACCOUNTING_TEST_DATABASE_URL is required.");
  const databaseName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) throw new Error("The database name must contain test.");
  return value;
}

async function request<T>(path: string, init?: RequestInit, userId = ownerId) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-test-user-id": userId, ...init?.headers },
  });
  return { response, body: await response.json() as T };
}

type ChartAccount = {
  id: number;
  accountCode: string;
  accountName: string;
  taxTreatment: string;
  isActive: boolean;
  isSystem: boolean;
  referenced: boolean;
  reviewRequired?: boolean;
};

type StatementSection = {
  label: string;
  amount: number;
  children?: StatementSection[];
};

function sectionAmount(sections: StatementSection[], label: string) {
  const section = sections.find((candidate) => candidate.label === label);
  assert.ok(section, `Expected statement section ${label}.`);
  return section.amount;
}

async function createPostableLine(description: string, amount: number, direction: "inflow" | "outflow") {
  const line = await request<{ id: number; accountSuggestion: string }>("/agaraccounting/statement-lines", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-06-30",
      description,
      currency: "AED",
      amount,
      direction,
      source: "Test evidence",
    }),
  });
  assert.equal(line.response.status, 201);
  assert.equal((await request(`/agaraccounting/statement-lines/${line.body.id}/contact`, {
    method: "PATCH",
    body: JSON.stringify({ clientId, contactId: null, contactReviewDisposition: "dismissed" }),
  })).response.status, 200);
  const entries = await request<Array<{ id: number; statementLineId: number }>>(`/agaraccounting/journal-entries?clientId=${clientId}`);
  const entry = entries.body.find((candidate) => candidate.statementLineId === line.body.id);
  assert.ok(entry);
  return { line: line.body, entry };
}

async function approveAndPost(entryId: number) {
  assert.equal((await request(`/agaraccounting/journal-entries/${entryId}/approve`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  })).response.status, 200);
  assert.equal((await request(`/agaraccounting/journal-entries/${entryId}/post`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  })).response.status, 200);
}

before(async () => {
  process.env.DATABASE_URL = testDatabaseUrl();
  const { createApp } = await import("../src/app");
  const { createRequireAuth } = await import("../src/middlewares/authMiddleware");
  database = await import("@workspace/db");
  await database.db.insert(database.usersTable).values([
    { id: ownerId, email: `${ownerId}@example.test` },
    { id: memberId, email: `${memberId}@example.test` },
    { id: foreignId, email: `${foreignId}@example.test` },
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
  try {
    const userIds = [ownerId, memberId, foreignId];
    const memberships = await database.db.select({ clientId: database.clientWorkspacesTable.clientId })
      .from(database.clientWorkspacesTable)
      .where(inArray(database.clientWorkspacesTable.userId, userIds));
    const scopedClientIds = [...new Set(memberships.map((membership) => membership.clientId))];
    if (scopedClientIds.length) {
      await database.db.delete(database.reportPacksTable).where(inArray(database.reportPacksTable.clientId, scopedClientIds));
      await database.db.delete(database.journalEntriesTable).where(inArray(database.journalEntriesTable.clientId, scopedClientIds));
      await database.db.delete(database.statementImportsTable).where(inArray(database.statementImportsTable.clientId, scopedClientIds));
      await database.db.delete(database.statementLinesTable).where(inArray(database.statementLinesTable.clientId, scopedClientIds));
      await database.db.delete(database.accountClassificationsTable).where(inArray(database.accountClassificationsTable.clientId, scopedClientIds));
      await database.db.delete(database.clientWorkspacesTable).where(inArray(database.clientWorkspacesTable.clientId, scopedClientIds));
      await database.db.delete(database.clientsTable).where(inArray(database.clientsTable.id, scopedClientIds));
    }
    await database.db.delete(database.classificationPatternsTable)
      .where(inArray(database.classificationPatternsTable.userId, userIds));
    await database.db.delete(database.usersTable).where(inArray(database.usersTable.id, userIds));
  } finally {
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    await database.pool.end();
  }
});

test("seeds an isolated durable chart and preserves the legacy combined account for review", async () => {
  const [unseededClient] = await database.db.insert(database.clientsTable).values({
    ownerUserId: ownerId,
    name: `Unseeded legacy ${randomUUID()}`,
    legalName: "Unseeded Legacy LLC",
    functionalCurrency: "AED",
    basis: "IFRS",
    period: "2026",
  }).returning();
  await database.db.insert(database.clientWorkspacesTable)
    .values({ clientId: unseededClient.id, userId: ownerId, role: "owner" });
  const [legacyLine] = await database.db.insert(database.statementLinesTable).values({
    clientId: unseededClient.id,
    date: "2026-05-01",
    description: "Historic combined travel balance",
    currency: "AED",
    amount: "300.00",
    direction: "outflow",
    status: "posted",
    source: "Legacy import",
    accountSuggestion: "Travel & entertainment",
    confidence: "0.90",
  }).returning();
  const [legacyEntry] = await database.db.insert(database.journalEntriesTable).values({
    clientId: unseededClient.id,
    statementLineId: legacyLine.id,
    date: legacyLine.date,
    memo: legacyLine.description,
    currency: "AED",
    amount: legacyLine.amount,
    status: "posted",
    debitAccount: "Travel & entertainment",
    creditAccount: "Bank / cash",
    confidence: "0.90",
  }).returning();
  const reservedBeforeList = await request("/agaraccounting/accounts", {
    method: "POST",
    body: JSON.stringify({
      clientId: unseededClient.id,
      accountCode: "9999",
      accountName: "Bank / cash",
      displayName: "Unprotected cash",
      statementSection: "asset",
      taxTreatment: "review_required",
    }),
  });
  assert.equal(reservedBeforeList.response.status, 409);
  const migratedAccounts = await database.db.select().from(database.accountClassificationsTable)
    .where(eq(database.accountClassificationsTable.clientId, unseededClient.id));
  assert.ok(migratedAccounts.some((account) => account.accountName === "Bank / cash" && account.isSystem));
  const migratedLegacy = migratedAccounts.find((account) => account.accountName === "Travel & entertainment");
  assert.ok(migratedLegacy);
  assert.equal(migratedLegacy.taxTreatment, "review_required");
  assert.equal(migratedLegacy.isActive, false);
  const [boundLegacyLine] = await database.db.select().from(database.statementLinesTable)
    .where(eq(database.statementLinesTable.id, legacyLine.id));
  const [boundLegacyEntry] = await database.db.select().from(database.journalEntriesTable)
    .where(eq(database.journalEntriesTable.id, legacyEntry.id));
  assert.equal(boundLegacyLine.accountClassificationId, migratedLegacy.id);
  assert.equal(boundLegacyEntry.debitAccountClassificationId, migratedLegacy.id);
  const legacyStatements = await request<{ incomeStatement: StatementSection[]; taxSummary: { accountingProfitBeforeTax: number; reviewRequiredAmount: number } }>(
    `/agaraccounting/financial-statements?clientId=${unseededClient.id}&period=2026`,
  );
  assert.equal(legacyStatements.response.status, 200);
  assert.equal(sectionAmount(legacyStatements.body.incomeStatement, "Operating expenses"), -300);
  assert.equal(legacyStatements.body.taxSummary.accountingProfitBeforeTax, -300);
  assert.equal(legacyStatements.body.taxSummary.reviewRequiredAmount, 300);

  const created = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `UAE chart ${randomUUID()}`,
      legalName: "UAE Chart Test LLC",
      functionalCurrency: "AED",
      period: "2026",
    }),
  });
  assert.equal(created.response.status, 201);
  clientId = created.body.id;
  await database.db.insert(database.clientWorkspacesTable)
    .values({ clientId, userId: memberId, role: "bookkeeper" });
  const first = await request<ChartAccount[]>(`/agaraccounting/accounts?clientId=${clientId}&includeArchived=true`);
  const second = await request<ChartAccount[]>(`/agaraccounting/accounts?clientId=${clientId}&includeArchived=true`);
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.equal(first.body.length, second.body.length);
  assert.deepEqual(first.body.map((account) => account.id), second.body.map((account) => account.id));
  assert.ok(first.body.some((account) => account.accountName === "Business travel" && account.taxTreatment === "ordinary_deductible"));
  assert.ok(first.body.some((account) => account.accountName === "Entertainment & hospitality" && account.taxTreatment === "entertainment_limited"));
  assert.equal(first.body.some((account) => account.accountName === "Travel & entertainment"), false);

  assert.equal((await request(`/agaraccounting/accounts?clientId=${clientId}`, undefined, memberId)).response.status, 200);
  assert.equal((await request(`/agaraccounting/accounts?clientId=${clientId}`, undefined, foreignId)).response.status, 403);
  const deniedMutation = await request("/agaraccounting/accounts", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      accountCode: "5999",
      accountName: "Member custom",
      displayName: "Member custom",
      statementSection: "expense",
      taxTreatment: "review_required",
    }),
  }, memberId);
  assert.equal(deniedMutation.response.status, 403);

  const bank = first.body.find((account) => account.accountName === "Bank / cash");
  assert.ok(bank);
  const protectedArchive = await request(`/agaraccounting/accounts/${bank.id}/archive`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  });
  assert.equal(protectedArchive.response.status, 409);
});

test("uses active client accounts for recoding and separates travel from entertainment", async () => {
  const custom = await request<ChartAccount>("/agaraccounting/accounts", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      accountCode: "5960",
      accountName: "Project field costs",
      displayName: "Project field costs",
      statementSection: "expense",
      currentNonCurrent: "not_applicable",
      cashFlowCategory: "operating",
      taxTreatment: "ordinary_deductible",
      taxTreatmentReason: "Approved project-only field costs.",
    }),
  });
  assert.equal(custom.response.status, 201);

  const customLine = await createPostableLine("REMOTE PROJECT SUPPLIES", 25, "outflow");
  const recode = await request("/agaraccounting/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      type: "recode_lines",
      lineIds: [customLine.line.id],
      accountSuggestion: custom.body.accountName,
      confidence: 0.9,
    }),
  });
  assert.equal(recode.response.status, 200);
  const blockedRename = await request(`/agaraccounting/accounts/${custom.body.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      clientId,
      accountCode: "5961",
      accountName: "Renamed field costs",
      displayName: "Renamed field costs",
      statementSection: "expense",
      currentNonCurrent: "not_applicable",
      cashFlowCategory: "operating",
      taxTreatment: "ordinary_deductible",
      taxTreatmentReason: "Attempted rename.",
    }),
  });
  assert.equal(blockedRename.response.status, 409);
  const blockedDelete = await request(`/agaraccounting/accounts/${custom.body.id}`, {
    method: "DELETE",
    body: JSON.stringify({ clientId }),
  });
  assert.equal(blockedDelete.response.status, 409);
  const foreignRecode = await request("/agaraccounting/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      type: "recode_lines",
      lineIds: [customLine.line.id],
      accountSuggestion: "A foreign client's account",
      confidence: 0.9,
    }),
  });
  assert.equal(foreignRecode.response.status, 400);

  const travel = await createPostableLine("EMIRATES BUSINESS FLIGHT TO CLIENT SITE", 100, "outflow");
  const entertainment = await createPostableLine("CUSTOMER DINNER HOSPITALITY", 200, "outflow");
  const uncertain = await createPostableLine("HOTEL BOOKING", 50, "outflow");
  assert.equal(travel.line.accountSuggestion, "Business travel");
  assert.equal(entertainment.line.accountSuggestion, "Entertainment & hospitality");
  assert.equal(uncertain.line.accountSuggestion, "Mixed or unsupported purpose");

  const archived = await request<ChartAccount>(`/agaraccounting/accounts/${custom.body.id}/archive`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  });
  assert.equal(archived.response.status, 200);
  assert.equal(archived.body.isActive, false);
  const staleChoice = await request("/agaraccounting/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      type: "recode_lines",
      lineIds: [uncertain.line.id],
      accountSuggestion: custom.body.accountName,
      confidence: 0.9,
    }),
  });
  assert.equal(staleChoice.response.status, 400);
});

test("calculates posted-only UAE tax adjustments and standard AED threshold arithmetic", async () => {
  const revenue = await createPostableLine("CUSTOMER INVOICE RECEIPT", 500000, "inflow");
  const travel = await createPostableLine("AIRLINE BUSINESS TRIP", 100, "outflow");
  const entertainment = await createPostableLine("SUPPLIER DINNER ENTERTAINMENT", 200, "outflow");
  const uncertain = await createPostableLine("TRAVEL HOTEL PURPOSE UNCERTAIN", 50, "outflow");
  await approveAndPost(revenue.entry.id);
  await approveAndPost(travel.entry.id);
  await approveAndPost(entertainment.entry.id);

  const summary = await request<{
    accountingProfitBeforeTax: number;
    entertainmentAccountingCost: number;
    entertainmentPermittedDeduction: number;
    entertainmentAddBack: number;
    estimatedTaxableIncome: number;
    standardEstimatedLiability: number;
    reviewRequiredAmount: number;
    thresholdAed: number;
    rate: number;
    excludedReliefs: string[];
  }>(`/agaraccounting/uae-corporate-tax?clientId=${clientId}&period=2026`);
  assert.equal(summary.response.status, 200);
  assert.equal(summary.body.accountingProfitBeforeTax, 499700);
  assert.equal(summary.body.entertainmentAccountingCost, 200);
  assert.equal(summary.body.entertainmentPermittedDeduction, 100);
  assert.equal(summary.body.entertainmentAddBack, 100);
  assert.equal(summary.body.estimatedTaxableIncome, 499800);
  assert.equal(summary.body.thresholdAed, 375000);
  assert.equal(summary.body.rate, 0.09);
  assert.equal(summary.body.standardEstimatedLiability, 11232);
  assert.equal(summary.body.reviewRequiredAmount, 0);
  assert.ok(summary.body.excludedReliefs.includes("Small Business Relief"));

  const financialStatements = await request<{ taxSummary: typeof summary.body }>(
    `/agaraccounting/financial-statements?clientId=${clientId}&period=2026`,
  );
  assert.equal(financialStatements.response.status, 200);
  assert.deepEqual(financialStatements.body.taxSummary, summary.body);

  await approveAndPost(uncertain.entry.id);
  const withReview = await request<{ reviewRequiredAmount: number }>(
    `/agaraccounting/uae-corporate-tax?clientId=${clientId}&period=2026`,
  );
  assert.equal(withReview.body.reviewRequiredAmount, 50);
});