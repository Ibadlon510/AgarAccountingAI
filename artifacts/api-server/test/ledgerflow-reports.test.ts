import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

type TrialBalanceRow = {
  account: string;
  debit: number;
  credit: number;
  balance: number;
  functionalCurrency: string;
  missingRateCount: number;
  missingRateCurrencies: string[];
};

type StatementSection = {
  label: string;
  amount: number;
};

type FinancialStatements = {
  incomeStatement: StatementSection[];
  balanceSheet: StatementSection[];
  cashFlow: StatementSection[];
};

let server: Server | undefined;
let baseUrl: string;
let app: typeof import("../src/app").default;
let database: typeof import("@workspace/db") | undefined;

const createdClientIds: number[] = [];
const createdUserIds: string[] = [];
const createdSessionIds: string[] = [];
let primaryToken: string;
let secondaryToken: string;

function testDatabaseUrl() {
  const value = process.env.LEDGERFLOW_TEST_DATABASE_URL;
  if (!value) throw new Error("LEDGERFLOW_TEST_DATABASE_URL is required for LedgerFlow integration tests.");

  const databaseName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) {
    throw new Error("The LedgerFlow integration test database name must contain 'test'.");
  }
  return value;
}

before(async () => {
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.SESSION_SECRET ??= "ledgerflow-test-session-secret";
  app = (await import("../src/app")).default;
  database = await import("@workspace/db");
  const { createSession } = await import("../src/lib/auth");
  const primaryUserId = `ledgerflow-test-primary-${randomUUID()}`;
  const secondaryUserId = `ledgerflow-test-secondary-${randomUUID()}`;
  await database.db.insert(database.usersTable).values([
    { id: primaryUserId, email: `${primaryUserId}@example.test`, firstName: "Primary", lastName: "Test" },
    { id: secondaryUserId, email: `${secondaryUserId}@example.test`, firstName: "Secondary", lastName: "Test" },
  ]);
  createdUserIds.push(primaryUserId, secondaryUserId);
  primaryToken = await createSession({
    user: { id: primaryUserId, email: `${primaryUserId}@example.test`, firstName: "Primary", lastName: "Test", profileImageUrl: null },
    access_token: "ledgerflow-test-access-token",
  });
  secondaryToken = await createSession({
    user: { id: secondaryUserId, email: `${secondaryUserId}@example.test`, firstName: "Secondary", lastName: "Test", profileImageUrl: null },
    access_token: "ledgerflow-test-access-token",
  });
  createdSessionIds.push(primaryToken, secondaryToken);
  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, () => resolve(listener));
    listener.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}/api`;
});

after(async () => {
  const activeDatabase = database;
  const activeServer = server;
  try {
    if (activeDatabase && createdClientIds.length) {
      await activeDatabase.db.delete(activeDatabase.journalEntriesTable)
        .where(inArray(activeDatabase.journalEntriesTable.clientId, createdClientIds));
      await activeDatabase.db.delete(activeDatabase.statementImportsTable)
        .where(inArray(activeDatabase.statementImportsTable.clientId, createdClientIds));
      await activeDatabase.db.delete(activeDatabase.statementLinesTable)
        .where(inArray(activeDatabase.statementLinesTable.clientId, createdClientIds));
      await activeDatabase.db.delete(activeDatabase.bankAccountsTable)
        .where(inArray(activeDatabase.bankAccountsTable.clientId, createdClientIds));
      await activeDatabase.db.delete(activeDatabase.clientWorkspacesTable)
        .where(inArray(activeDatabase.clientWorkspacesTable.clientId, createdClientIds));
      await activeDatabase.db.delete(activeDatabase.clientsTable)
        .where(inArray(activeDatabase.clientsTable.id, createdClientIds));
    }
    if (activeDatabase && createdSessionIds.length) {
      await activeDatabase.db.delete(activeDatabase.sessionsTable)
        .where(inArray(activeDatabase.sessionsTable.sid, createdSessionIds));
    }
    if (activeDatabase && createdUserIds.length) {
      await activeDatabase.db.delete(activeDatabase.exchangeRatesTable)
        .where(inArray(activeDatabase.exchangeRatesTable.userId, createdUserIds));
      await activeDatabase.db.delete(activeDatabase.classificationPatternsTable)
        .where(inArray(activeDatabase.classificationPatternsTable.userId, createdUserIds));
      await activeDatabase.db.delete(activeDatabase.usersTable)
        .where(inArray(activeDatabase.usersTable.id, createdUserIds));
    }
  } finally {
    const closeOperations: Promise<unknown>[] = [];
    if (activeServer) {
      closeOperations.push(new Promise<void>((resolve, reject) => {
        activeServer.close((error) => (error ? reject(error) : resolve()));
      }));
    }
    if (activeDatabase) closeOperations.push(activeDatabase.pool.end());
    const failures = (await Promise.allSettled(closeOperations))
      .find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures) throw failures.reason;
  }
});

async function request<T>(path: string, init?: RequestInit, token = primaryToken) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  const body = (await response.json()) as T;
  return { response, body };
}

function sectionAmount(sections: StatementSection[], label: string) {
  const section = sections.find((item) => item.label === label);
  assert.ok(section, `Expected statement section "${label}"`);
  return section.amount;
}

test("keeps approved entries out of reports until posting and enforces client scope", async () => {
  const suffix = randomUUID();
  const clientResponse = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Import outcome ${suffix}`,
      legalName: `Import outcome ${suffix} LLC`,
    }),
  });
  assert.equal(clientResponse.response.status, 201);
  const clientId = clientResponse.body.id;
  createdClientIds.push(clientId);

  const otherClientResponse = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Other intake integrity ${suffix}`,
      legalName: `Other intake integrity ${suffix} LLC`,
    }),
  }, secondaryToken);
  assert.equal(otherClientResponse.response.status, 201);
  const otherClientId = otherClientResponse.body.id;
  createdClientIds.push(otherClientId);

  const amount = 987.65;
  const lineResponse = await request<{ id: number }>("/ledgerflow/statement-lines", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-08-24",
      description: `Verified intake ${suffix}`,
      currency: "AED",
      amount: 125,
      direction: "outflow",
    }),
  });
  assert.equal(lineResponse.response.status, 201);

  const entryResponse = await request<Array<{
    id: number;
    statementLineId: number;
    status: string;
  }>>(`/ledgerflow/journal-entries?clientId=${clientId}`);
  assert.equal(entryResponse.response.status, 200);
    const entry = postingEntries.find((candidate) => candidate.statementLineId === lineId);

      const posted = await request<{ status: string }>(`/ledgerflow/journal-entries/${entry.id}/post`, {
        method: "POST",
        body: JSON.stringify({ clientId }),
      });
  assert.ok(entry, "Expected the newly-created journal entry");
  assert.equal(entry.status, "suggested");

  const beforeTrialBalance = await request<TrialBalanceRow[]>(`/ledgerflow/trial-balance?clientId=${clientId}`);
  assert.equal(beforeTrialBalance.response.status, 200);
  const beforeStatements = await request<FinancialStatements>(`/ledgerflow/financial-statements?clientId=${clientId}`);
  assert.equal(beforeStatements.response.status, 200);

  const unapprovedPost = await request<{ error: string }>(`/ledgerflow/journal-entries/${entry.id}/post`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  });
  assert.equal(unapprovedPost.response.status, 409);
  assert.equal(unapprovedPost.body.error, "Journal entry must be approved before posting");

  const mismatchedApproval = await request<{ error: string }>(`/ledgerflow/journal-entries/${entry.id}/approve`, {
    method: "POST",
    body: JSON.stringify({ clientId: otherClientId }),
  });

  const crossUserOverview = await request<{ error: string }>(`/ledgerflow/overview?clientId=${otherClientId}`);
  const approveResponse = await request<{ status: string }>(`/ledgerflow/journal-entries/${entry.id}/approve`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  });
  assert.equal(approveResponse.response.status, 200);
  assert.equal(approveResponse.body.status, "approved");

  const approvedTrialBalance = await request<TrialBalanceRow[]>(`/ledgerflow/trial-balance?clientId=${clientId}`);
  const approvedStatements = await request<FinancialStatements>(`/ledgerflow/financial-statements?clientId=${clientId}`);
  assert.deepEqual(approvedTrialBalance.body, beforeTrialBalance.body);
  assert.deepEqual(approvedStatements.body, beforeStatements.body);

  const mismatchedPost = await request<{ error: string }>(`/ledgerflow/journal-entries/${entry.id}/post`, {
    method: "POST",
    body: JSON.stringify({ clientId: otherClientId }),
  });
  assert.equal(mismatchedPost.response.status, 403);
  assert.equal(mismatchedPost.body.error, "You do not have access to this client workspace.");

  const postResponse = await request<{ status: string }>(`/ledgerflow/journal-entries/${entry.id}/post`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  });
  assert.equal(postResponse.response.status, 200);
  assert.equal(postResponse.body.status, "posted");

  const postedTrialBalance = await request<TrialBalanceRow[]>(`/ledgerflow/trial-balance?clientId=${clientId}`);
  const postedStatements = await request<FinancialStatements>(`/ledgerflow/financial-statements?clientId=${clientId}`);
  assert.equal(postedTrialBalance.response.status, 200);
  assert.equal(postedStatements.response.status, 200);

  const beforeSoftware = beforeTrialBalance.body.find((row) => row.account === "Software & subscriptions")?.debit ?? 0;
  const beforeCash = beforeTrialBalance.body.find((row) => row.account === "Bank / cash")?.credit ?? 0;
  const postedSoftware = postedTrialBalance.body.find((row) => row.account === "Software & subscriptions")?.debit ?? 0;
  const postedCash = postedTrialBalance.body.find((row) => row.account === "Bank / cash")?.credit ?? 0;
  assert.equal(postedSoftware - beforeSoftware, amount);
  assert.equal(postedCash - beforeCash, amount);

  const beforeExpenses = sectionAmount(beforeStatements.body.incomeStatement, "Operating expenses");
  const beforeNetIncome = sectionAmount(beforeStatements.body.incomeStatement, "Net income");
  const beforeCashFlow = sectionAmount(beforeStatements.body.cashFlow, "Net cash from operating activities");
  const postedExpenses = sectionAmount(postedStatements.body.incomeStatement, "Operating expenses");
  const postedNetIncome = sectionAmount(postedStatements.body.incomeStatement, "Net income");
  const postedCashFlow = sectionAmount(postedStatements.body.cashFlow, "Net cash from operating activities");
  assert.equal(postedExpenses - beforeExpenses, -amount);
  assert.equal(postedNetIncome - beforeNetIncome, -amount);
  assert.equal(postedCashFlow - beforeCashFlow, -amount);
});

test("allows only one concurrent posting request for an approved entry", async () => {
  const suffix = randomUUID();
  const clientResponse = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Import outcome ${suffix}`,
      legalName: `Import outcome ${suffix} LLC`,
    }),
  });
  assert.equal(clientResponse.response.status, 201);
  const clientId = clientResponse.body.id;
  createdClientIds.push(clientId);

  const lineResponse = await request<{ id: number }>("/ledgerflow/statement-lines", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-08-24",
      description: `Verified intake ${suffix}`,
      currency: "AED",
      amount: 125,
      direction: "outflow",
    }),
  });
  assert.equal(lineResponse.response.status, 201);

  const entryResponse = await request<Array<{
    id: number;
    statementLineId: number;
    status: string;
  }>>(`/ledgerflow/journal-entries?clientId=${clientId}`);
  assert.equal(entryResponse.response.status, 200);
    const entry = postingEntries.find((candidate) => candidate.statementLineId === lineId);

      const posted = await request<{ status: string }>(`/ledgerflow/journal-entries/${entry.id}/post`, {
        method: "POST",
        body: JSON.stringify({ clientId }),
      });
  assert.ok(entry, "Expected the newly-created journal entry");

  const approveResponse = await request<{ status: string }>(`/ledgerflow/journal-entries/${entry.id}/approve`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  });
  assert.equal(approveResponse.response.status, 200);
  assert.equal(approveResponse.body.status, "approved");

  const approvedTrialBalance = await request<TrialBalanceRow[]>(`/ledgerflow/trial-balance?clientId=${clientId}`);
  const approvedStatements = await request<FinancialStatements>(`/ledgerflow/financial-statements?clientId=${clientId}`);
  assert.equal(approvedTrialBalance.response.status, 200);
  assert.equal(approvedStatements.response.status, 200);

  const postResponses = await Promise.all([
    request<{ status?: string; error?: string }>(`/ledgerflow/journal-entries/${entry.id}/post`, {
      method: "POST",
      body: JSON.stringify({ clientId }),
    }),
    request<{ status?: string; error?: string }>(`/ledgerflow/journal-entries/${entry.id}/post`, {
      method: "POST",
      body: JSON.stringify({ clientId }),
    }),
  ]);

  assert.deepEqual(
    postResponses.map(({ response }) => response.status).sort((a, b) => a - b),
    [200, 409],
  );
  const successfulPost = postResponses.find(({ response }) => response.status === 200);
  const rejectedPost = postResponses.find(({ response }) => response.status === 409);
  assert.ok(successfulPost);
  assert.equal(successfulPost.body.status, "posted");
  assert.ok(rejectedPost);
  assert.equal(rejectedPost.body.error, "Journal entry must be approved before posting");

  const finalEntries = await request<Array<{
    id: number;
    statementLineId: number;
    status: string;
  }>>(`/ledgerflow/journal-entries?clientId=${clientId}`);
  assert.equal(finalEntries.find((item) => item.id === entry.id)?.status, "posted");

  const finalLines = await request<Array<{
    id: number;
    status: string;
  }>>(`/ledgerflow/statement-lines?clientId=${clientId}`);
  assert.equal(finalLines.find((item) => item.id === lineResponse.body.id)?.status, "posted");

  const postedTrialBalance = await request<TrialBalanceRow[]>(`/ledgerflow/trial-balance?clientId=${clientId}`);
  const postedStatements = await request<FinancialStatements>(`/ledgerflow/financial-statements?clientId=${clientId}`);
  assert.equal(postedTrialBalance.response.status, 200);
  assert.equal(postedStatements.response.status, 200);

  const amount = 987.65;
  const approvedSoftware = approvedTrialBalance.body.find((row) => row.account === "Software & subscriptions")?.debit ?? 0;
  const approvedCash = approvedTrialBalance.body.find((row) => row.account === "Bank / cash")?.credit ?? 0;
  const postedSoftware = postedTrialBalance.body.find((row) => row.account === "Software & subscriptions")?.debit ?? 0;
  const postedCash = postedTrialBalance.body.find((row) => row.account === "Bank / cash")?.credit ?? 0;
  assert.equal(postedSoftware - approvedSoftware, amount);
  assert.equal(postedCash - approvedCash, amount);

  const approvedExpenses = sectionAmount(approvedStatements.body.incomeStatement, "Operating expenses");
  const approvedNetIncome = sectionAmount(approvedStatements.body.incomeStatement, "Net income");
  const approvedCashFlow = sectionAmount(approvedStatements.body.cashFlow, "Net cash from operating activities");
  const postedExpenses = sectionAmount(postedStatements.body.incomeStatement, "Operating expenses");
  const postedNetIncome = sectionAmount(postedStatements.body.incomeStatement, "Net income");
  const postedCashFlow = sectionAmount(postedStatements.body.cashFlow, "Net cash from operating activities");
  assert.equal(postedExpenses - approvedExpenses, -amount);
  assert.equal(postedNetIncome - approvedNetIncome, -amount);
  assert.equal(postedCashFlow - approvedCashFlow, -amount);
});

type JournalEntrySummary = {
  id: number;
  statementLineId: number;
  date: string;
  memo: string;
  currency: string;
  status: string;
  confidence: number;
  lines: Array<{ account: string; debit: number; credit: number }>;
};

type StatementLineSummary = {
  id: number;
  clientId: number;
  date: string;
  description: string;
  currency: string;
  amount: number;
  direction: string;
  status: string;
  source: string;
  accountSuggestion: string | null;
  confidence: number | null;
  functionalAmount: number | null;
  functionalCurrency: string | null;
  exchangeRate: number | null;
  exchangeRateEffectiveDate: string | null;
  exchangeRateStatus: "not_required" | "exact" | "prior" | "missing";
};

type BulkTransitionAuditSummary = {
  id: number;
  clientId: number;
  actor: {
    id: string;
    name: string;
    email: string | null;
  };
  transition: "bulk_approve_entries" | "bulk_post_entries";
  fromStatus: string;
  toStatus: string;
  entryIds: number[];
  statementLineIds: number[];
  confirmedAt: string;
};
async function createLedgerflowTestClient(label: string, token = primaryToken) {
  const response = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `${label} ${randomUUID()}`,
      legalName: `${label} ${randomUUID()} LLC`,
    }),
  }, token);
  assert.equal(response.response.status, 201);
  createdClientIds.push(response.body.id);
  return response.body.id;
}

async function createLedgerflowTestLine(clientId: number, description: string, token = primaryToken) {
  const response = await request<{ id: number }>("/ledgerflow/statement-lines", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-08-24",
      description: `${description} ${randomUUID()}`,
      currency: "AED",
      amount: 125,
      direction: "outflow",
    }),
  }, token);
  assert.equal(response.response.status, 201);
  return response.body.id;
}

async function getLedgerflowTestEntries(clientId: number, token = primaryToken) {
  const response = await request<JournalEntrySummary[]>(`/ledgerflow/journal-entries?clientId=${clientId}`, undefined, token);
  assert.equal(response.response.status, 200);
  return response.body;
}

async function getLedgerflowTestLines(clientId: number, token = primaryToken) {
  const response = await request<StatementLineSummary[]>(`/ledgerflow/statement-lines?clientId=${clientId}`, undefined, token);
  assert.equal(response.response.status, 200);
  return response.body;
}

async function getBulkTransitionAudits(clientId: number, token = primaryToken) {
  const response = await request<BulkTransitionAuditSummary[]>(`/ledgerflow/bulk-transition-audits?clientId=${clientId}`, undefined, token);
  assert.equal(response.response.status, 200);
  return response.body;
}
async function approveLedgerflowTestEntry(clientId: number, entryId: number, token = primaryToken) {
  const response = await request<{ status: string }>(`/ledgerflow/journal-entries/${entryId}/approve`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  }, token);
  assert.equal(response.response.status, 200);
  assert.equal(response.body.status, "approved");
}

type ExchangeRate = {
  id: number;
  sourceCurrency: string;
  functionalCurrency: string;
  effectiveDate: string;
  rate: number;
  source: string;
  note: string | null;
};
  const activeDatabase = database;
  const clientId = clientResponse.body.id;
  const lineResponse = await request<{ id: number }>("/ledgerflow/statement-lines", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-08-24",
      description: `Verified intake ${suffix}`,
      currency: "AED",
      amount: 125,
      direction: "outflow",
    }),
  });
  assert.equal(lineResponse.response.status, 201);
  const entries = await activeDatabase.db.select()
    .from(activeDatabase.journalEntriesTable)
    .where(eq(activeDatabase.journalEntriesTable.statementLineId, lineResponse.body.id));
    const entry = postingEntries.find((candidate) => candidate.statementLineId === lineId);

      const posted = await request<{ status: string }>(`/ledgerflow/journal-entries/${entry.id}/post`, {
        method: "POST",
        body: JSON.stringify({ clientId }),
      });
  const finalEntries = await request<Array<{
    id: number;
    statementLineId: number;
    status: string;
  }>>(`/ledgerflow/journal-entries?clientId=${clientId}`);
  const finalLines = await request<Array<{
    id: number;
    status: string;
  }>>(`/ledgerflow/statement-lines?clientId=${clientId}`);
  const approvalClientId = await createLedgerflowTestClient("AI bulk approval");
  const approvalLineIds = await Promise.all([
    createLedgerflowTestLine(approvalClientId, "Approval pending one"),
    createLedgerflowTestLine(approvalClientId, "Approval pending two"),
  ]);
  const approvalEntries = await getLedgerflowTestEntries(approvalClientId);
  const approvalEntryIds = approvalLineIds.map((lineId) => {
    const entry = approvalEntries.find((candidate) => candidate.statementLineId === lineId);
    assert.ok(entry, `Expected an entry for statement line ${lineId}`);
    return entry.id;
  });

  const approvalChat = await request<{
    answer: string;
    recommendations: Array<{
      type: string;
      clientId: number;
      entryIds?: number[];
      statementLineIds?: number[];
      entryCount?: number;
      lineCount?: number;
    }>;
  }>("/ledgerflow/ai-chat", {
    method: "POST",
    body: JSON.stringify({ clientId: approvalClientId, message: "approve all pending entries" }),
  });
  assert.equal(approvalChat.response.status, 200);
  const approvalRecommendation = approvalChat.body.recommendations.find((recommendation) => recommendation.type === "bulk_approve_entries");
  assert.ok(approvalRecommendation);
  assert.equal(approvalRecommendation.clientId, approvalClientId);
  assert.deepEqual(approvalRecommendation.entryIds?.slice().sort((a, b) => a - b), approvalEntryIds.slice().sort((a, b) => a - b));
  assert.deepEqual(approvalRecommendation.statementLineIds?.slice().sort((a, b) => a - b), approvalLineIds.slice().sort((a, b) => a - b));
  assert.equal(approvalRecommendation.entryCount, 2);
  assert.equal(approvalRecommendation.lineCount, 2);

  const approvalConfirmation = await request<{ type: string; entryCount: number; updatedLineCount: number }>(
    "/ledgerflow/ai-actions/confirm",
    {
      method: "POST",
      body: JSON.stringify({
        clientId: approvalClientId,
        type: approvalRecommendation.type,
        entryIds: approvalRecommendation.entryIds,
        statementLineIds: approvalRecommendation.statementLineIds,
      }),
    },
  );

  const approvalAudits = await getBulkTransitionAudits(approvalClientId);
  const postingClientId = await createLedgerflowTestClient("AI bulk posting");
  const postingLineIds = await Promise.all([
    createLedgerflowTestLine(postingClientId, "Posting approved one"),
    createLedgerflowTestLine(postingClientId, "Posting approved two"),
  ]);
  const postingEntries = await getLedgerflowTestEntries(postingClientId);
  for (const lineId of postingLineIds) {
    const entry = postingEntries.find((candidate) => candidate.statementLineId === lineId);

      const posted = await request<{ status: string }>(`/ledgerflow/journal-entries/${entry.id}/post`, {
        method: "POST",
        body: JSON.stringify({ clientId }),
      });
    assert.ok(entry, `Expected an entry for statement line ${lineId}`);
    await approveLedgerflowTestEntry(postingClientId, entry.id);
  }

  const postingChat = await request<{
    recommendations: Array<{
      type: string;
      clientId: number;
      entryIds?: number[];
      statementLineIds?: number[];
      entryCount?: number;
      lineCount?: number;
    }>;
  }>("/ledgerflow/ai-chat", {
    method: "POST",
    body: JSON.stringify({ clientId: postingClientId, message: "post all approved entries" }),
  });
  assert.equal(postingChat.response.status, 200);
  const postingRecommendation = postingChat.body.recommendations.find((recommendation) => recommendation.type === "bulk_post_entries");
  assert.ok(postingRecommendation);
  assert.equal(postingRecommendation.clientId, postingClientId);
  assert.equal(postingRecommendation.entryCount, 2);
  assert.equal(postingRecommendation.lineCount, 2);

  const postingConfirmation = await request<{ type: string; entryCount: number; updatedLineCount: number }>(
    "/ledgerflow/ai-actions/confirm",
    {
      method: "POST",
      body: JSON.stringify({
        clientId: postingClientId,
        type: postingRecommendation.type,
        entryIds: postingRecommendation.entryIds,
        statementLineIds: postingRecommendation.statementLineIds,
      }),
    },
  );

  const postingAudits = await getBulkTransitionAudits(postingClientId);
  const guardedClientId = await createLedgerflowTestClient("AI bulk validation");
  const guardedLineIds = await Promise.all([
    createLedgerflowTestLine(guardedClientId, "Mixed status one"),
    createLedgerflowTestLine(guardedClientId, "Mixed status two"),
    createLedgerflowTestLine(guardedClientId, "Mismatched scope three"),
  ]);
  let guardedEntries = await getLedgerflowTestEntries(guardedClientId);
  const guardedEntryIds = guardedLineIds.map((lineId) => {
    const entry = guardedEntries.find((candidate) => candidate.statementLineId === lineId);
    assert.ok(entry, `Expected an entry for statement line ${lineId}`);
    return entry.id;
  });
  await approveLedgerflowTestEntry(guardedClientId, guardedEntryIds[0]);

  guardedEntries = await getLedgerflowTestEntries(guardedClientId);
  const guardedLines = await getLedgerflowTestLines(guardedClientId);
  const beforeMixedStatusFailure = {
    entries: guardedEntries.filter((entry) => guardedEntryIds.slice(0, 2).includes(entry.id)),
    lines: guardedLines.filter((line) => guardedLineIds.slice(0, 2).includes(line.id)),
  };
  const mixedStatusConfirmation = await request<{ error: string }>("/ledgerflow/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      clientId: guardedClientId,
      type: "bulk_approve_entries",
      entryIds: guardedEntryIds.slice(0, 2),
      statementLineIds: guardedLineIds.slice(0, 2),
    }),
  });
  assert.equal(mixedStatusConfirmation.response.status, 409);
  assert.match(mixedStatusConfirmation.body.error, /Only suggested entries/);
  assert.deepEqual({
    entries: (await getLedgerflowTestEntries(guardedClientId)).filter((entry) => guardedEntryIds.slice(0, 2).includes(entry.id)),
    lines: (await getLedgerflowTestLines(guardedClientId)).filter((line) => guardedLineIds.slice(0, 2).includes(line.id)),
  }, beforeMixedStatusFailure);

  const emptyConfirmation = await request<{ error: string }>("/ledgerflow/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({ clientId: guardedClientId, type: "bulk_approve_entries" }),
  });
  assert.equal(emptyConfirmation.response.status, 400);
  assert.match(emptyConfirmation.body.error, /matching, non-empty/);

  const unequalScopeConfirmation = await request<{ error: string }>("/ledgerflow/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      clientId: guardedClientId,
      type: "bulk_approve_entries",
      entryIds: [guardedEntryIds[1]],
      statementLineIds: guardedLineIds.slice(0, 2),
    }),
  });
  assert.equal(unequalScopeConfirmation.response.status, 400);

  const beforeMismatchedScopeFailure = {
    entries: guardedEntries.filter((entry) => guardedEntryIds.slice(1, 3).includes(entry.id)),
    lines: guardedLines.filter((line) => [guardedLineIds[0], guardedLineIds[2]].includes(line.id)),
  };
  const mismatchedScopeConfirmation = await request<{ error: string }>("/ledgerflow/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      clientId: guardedClientId,
      type: "bulk_approve_entries",
      entryIds: guardedEntryIds.slice(1, 3),
      statementLineIds: [guardedLineIds[0], guardedLineIds[2]],
    }),
  });
  assert.equal(mismatchedScopeConfirmation.response.status, 400);
  assert.match(mismatchedScopeConfirmation.body.error, /matching client-scoped selection/);
  assert.deepEqual({
    entries: (await getLedgerflowTestEntries(guardedClientId)).filter((entry) => guardedEntryIds.slice(1, 3).includes(entry.id)),
    lines: (await getLedgerflowTestLines(guardedClientId)).filter((line) => [guardedLineIds[0], guardedLineIds[2]].includes(line.id)),
  }, beforeMismatchedScopeFailure);

  const otherClientId = otherClientResponse.body.id;
  const otherLineId = await createLedgerflowTestLine(otherClientId, "Cross client entry", secondaryToken);
  const otherEntries = await getLedgerflowTestEntries(otherClientId, secondaryToken);
  const otherEntry = otherEntries.find((entry) => entry.statementLineId === otherLineId);
  assert.ok(otherEntry);
  const otherStateBefore = {
    entries: otherEntries,
    lines: await getLedgerflowTestLines(otherClientId, secondaryToken),
  };
  const crossClientConfirmation = await request<{ error: string }>("/ledgerflow/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      clientId: guardedClientId,
      type: "bulk_approve_entries",
      entryIds: [otherEntry.id],
      statementLineIds: [otherLineId],
    }),
  });
  assert.equal(crossClientConfirmation.response.status, 404);
  assert.match(crossClientConfirmation.body.error, /not available in this client/);
  assert.deepEqual({
    entries: await getLedgerflowTestEntries(otherClientId, secondaryToken),
    lines: await getLedgerflowTestLines(otherClientId, secondaryToken),
  }, otherStateBefore);

  for (const [message, expectedText] of [
    ["approve all March entries", /qualified bulk scope/],
    ["post all approved entries for March", /qualified bulk scope/],
  ] as const) {
    const broadRequest = await request<{
      answer: string;
      recommendations: unknown[];
    }>("/ledgerflow/ai-chat", {
      method: "POST",
      body: JSON.stringify({ clientId: guardedClientId, message }),
    });
    assert.equal(broadRequest.response.status, 200);
    assert.match(broadRequest.body.answer, expectedText);
    assert.deepEqual(broadRequest.body.recommendations, []);
  }
});

test("rolls back a failed manual intake and enforces one client-scoped journal proposal", async () => {
  const activeDatabase = database;
  assert.ok(activeDatabase);
  const suffix = randomUUID();
  const clientResponse = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Import outcome ${suffix}`,
      legalName: `Import outcome ${suffix} LLC`,
    }),
  });
  assert.equal(clientResponse.response.status, 201);
  const clientId = clientResponse.body.id;
  createdClientIds.push(clientId);

  const otherClientResponse = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Other intake integrity ${suffix}`,
      legalName: `Other intake integrity ${suffix} LLC`,
    }),
  }, secondaryToken);
  assert.equal(otherClientResponse.response.status, 201);
  const otherClientId = otherClientResponse.body.id;
  createdClientIds.push(otherClientId);

  const failingDescription = `FORCE JOURNAL ROLLBACK ${suffix}`;
  await activeDatabase.pool.query(`
    create or replace function ledgerflow_test_reject_forced_journal()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.memo like 'FORCE JOURNAL ROLLBACK%' then
        raise exception 'forced journal proposal failure';
      end if;
      return new;
    end;
    $$;
    drop trigger if exists ledgerflow_test_reject_forced_journal on ledgerflow_journal_entries;
    create trigger ledgerflow_test_reject_forced_journal
    before insert on ledgerflow_journal_entries
    for each row execute function ledgerflow_test_reject_forced_journal();
  `);
  try {
    const rollbackResponse = await fetch(`${baseUrl}/ledgerflow/statement-lines`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${primaryToken}`,
      },
      body: JSON.stringify({
        clientId,
        date: "2026-08-24",
        description: failingDescription,
        currency: "AED",
        amount: 125,
        direction: "outflow",
      }),
    });
    assert.equal(rollbackResponse.status, 500);
    await rollbackResponse.text();
  } finally {
    await activeDatabase.pool.query(`
      drop trigger if exists ledgerflow_test_reject_forced_journal on ledgerflow_journal_entries;
      drop function if exists ledgerflow_test_reject_forced_journal();
    `);
  }
  const rolledBackLines = await activeDatabase.db.select()
    .from(activeDatabase.statementLinesTable)
    .where(and(
      eq(activeDatabase.statementLinesTable.clientId, clientId),
      eq(activeDatabase.statementLinesTable.description, failingDescription),
    ));
  assert.equal(rolledBackLines.length, 0, "A failed journal proposal must roll back its statement line.");

  const lineResponse = await request<{ id: number }>("/ledgerflow/statement-lines", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-08-24",
      description: `Verified intake ${suffix}`,
      currency: "AED",
      amount: 125,
      direction: "outflow",
    }),
  });
  assert.equal(lineResponse.response.status, 201);
  const entries = await activeDatabase.db.select()
    .from(activeDatabase.journalEntriesTable)
    .where(eq(activeDatabase.journalEntriesTable.statementLineId, lineResponse.body.id));
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.clientId, clientId);

  await assert.rejects(
    activeDatabase.db.insert(activeDatabase.journalEntriesTable).values({
      statementLineId: lineResponse.body.id,
      clientId,
      date: "2026-08-24",
      memo: `Duplicate journal ${suffix}`,
      currency: "AED",
      status: "suggested",
      confidence: "0.75",
      debitAccount: "General expenses",
      creditAccount: "Bank / cash",
      amount: "125.00",
    }),
  );
  await assert.rejects(
    activeDatabase.db.insert(activeDatabase.journalEntriesTable).values({
      statementLineId: lineResponse.body.id,
      clientId: otherClientId,
      date: "2026-08-24",
      memo: `Cross-client journal ${suffix}`,
      currency: "AED",
      status: "suggested",
      confidence: "0.75",
      debitAccount: "General expenses",
      creditAccount: "Bank / cash",
      amount: "125.00",
    }),
  );

  const [otherBankAccount] = await activeDatabase.db.insert(activeDatabase.bankAccountsTable).values({
    clientId: otherClientId,
    name: `Other account ${suffix}`,
    currency: "AED",
    identityKey: `other-account-${suffix}`,
  }).returning();
  assert.ok(otherBankAccount);
  await assert.rejects(
    activeDatabase.db.update(activeDatabase.bankAccountsTable)
      .set({ clientId })
      .where(eq(activeDatabase.bankAccountsTable.id, otherBankAccount.id)),
  );
  await assert.rejects(
    activeDatabase.db.update(activeDatabase.statementLinesTable)
      .set({ clientId: otherClientId })
      .where(eq(activeDatabase.statementLinesTable.id, lineResponse.body.id)),
  );
  await assert.rejects(
    activeDatabase.db.insert(activeDatabase.statementLinesTable).values({
      clientId,
      bankAccountId: otherBankAccount.id,
      date: "2026-08-24",
      description: `Cross-client bank account ${suffix}`,
      currency: "AED",
      amount: "10.00",
      direction: "outflow",
      status: "needs_review",
      source: "Test",
    }),
  );
});

test("keeps failed statement-import attempts retryable while retaining terminal outcomes", async () => {
  const activeDatabase = database;
  assert.ok(activeDatabase);
  const suffix = randomUUID();
  const clientResponse = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Import outcome ${suffix}`,
      legalName: `Import outcome ${suffix} LLC`,
    }),
  });
  assert.equal(clientResponse.response.status, 201);
  const clientId = clientResponse.body.id;
  createdClientIds.push(clientId);

  const source = {
    clientId,
    bankAccountId: null,
    fileName: `statement-${suffix}.csv`,
    mimeType: "text/csv",
    fileHash: `test-file-hash-${suffix}`,
    importedLineCount: 0,
  };
  await activeDatabase.db.insert(activeDatabase.statementImportsTable).values([
    { ...source, outcome: "failed", errorMessage: "Source could not be parsed." },
    { ...source, outcome: "failed", errorMessage: "Source could not be parsed again." },
    { ...source, outcome: "completed" },
    { ...source, outcome: "duplicate" },
  ]);
  const attempts = await activeDatabase.db.select()
    .from(activeDatabase.statementImportsTable)
    .where(and(
      eq(activeDatabase.statementImportsTable.clientId, clientId),
      eq(activeDatabase.statementImportsTable.fileHash, source.fileHash),
    ));
  assert.deepEqual(
    attempts.map((attempt) => attempt.outcome).sort(),
    ["completed", "duplicate", "failed", "failed"],
  );
  await assert.rejects(
    activeDatabase.db.insert(activeDatabase.statementImportsTable).values({
      ...source,
      outcome: "completed",
    }),
  );
  await assert.rejects(
    activeDatabase.db.insert(activeDatabase.statementImportsTable).values({
      ...source,
      outcome: "unknown",
    }),
  );
});

  const isolatedClient = await createLedgerflowTestClient("Isolated rate schedule", secondaryToken);

  const imported = await request<{ importedCount: number; updatedCount: number; rates: ExchangeRate[] }>("/ledgerflow/exchange-rates/import", {
    method: "POST",
    body: JSON.stringify({
      rates: [
        { sourceCurrency: "USD", functionalCurrency: "AED", effectiveDate: "2026-08-24", rate: 3.7, source: "Test schedule" },
        { sourceCurrency: "EUR", functionalCurrency: "AED", effectiveDate: "2026-08-20", rate: 4, source: "Test schedule" },
      ],
    }),
  });

  const primaryRates = await request<ExchangeRate[]>("/ledgerflow/exchange-rates");

  const crossWorkspaceUpdate = await request<{ error: string }>(`/ledgerflow/exchange-rates/${imported.body.rates[0].id}`, {
    method: "PATCH",
    body: JSON.stringify({ sourceCurrency: "USD", functionalCurrency: "AED", effectiveDate: "2026-08-24", rate: 3.8, source: "Unauthorised" }),
  }, secondaryToken);

  const isolatedLine = await request<StatementLineSummary>("/ledgerflow/statement-lines", {
    method: "POST",
    body: JSON.stringify({ clientId: isolatedClient, date: "2026-08-24", description: "USD isolated workspace", currency: "USD", amount: 10, direction: "outflow" }),
  }, secondaryToken);

  const [exact, prior, missing, sameCurrency] = await Promise.all([
    request<StatementLineSummary>("/ledgerflow/statement-lines", { method: "POST", body: JSON.stringify({ clientId: clientA, date: "2026-08-24", description: "USD software subscription", currency: "USD", amount: 10, direction: "outflow" }) }),
    request<StatementLineSummary>("/ledgerflow/statement-lines", { method: "POST", body: JSON.stringify({ clientId: clientB, date: "2026-08-25", description: "EUR software subscription", currency: "EUR", amount: 10, direction: "outflow" }) }),
    request<StatementLineSummary>("/ledgerflow/statement-lines", { method: "POST", body: JSON.stringify({ clientId: clientA, date: "2026-08-24", description: "GBP software subscription", currency: "GBP", amount: 10, direction: "outflow" }) }),
    request<StatementLineSummary>("/ledgerflow/statement-lines", { method: "POST", body: JSON.stringify({ clientId: clientB, date: "2026-08-25", description: "AED software subscription", currency: "AED", amount: 10, direction: "outflow" }) }),
  ]);

  const isolatedRates = await request<ExchangeRate[]>("/ledgerflow/exchange-rates", undefined, secondaryToken);

  const trial = await request<TrialBalanceRow[]>(`/ledgerflow/trial-balance?clientId=${clientA}`);

  const clientA = await createLedgerflowTestClient("Shared rate schedule A");

  const clientB = await createLedgerflowTestClient("Shared rate schedule B");
