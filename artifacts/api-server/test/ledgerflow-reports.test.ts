import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";

type TrialBalanceRow = {
  account: string;
  debit: number;
  credit: number;
  balance: number;
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
      name: `Concurrent posting ${suffix}`,
      legalName: `Concurrent posting ${suffix} LLC`,
    }),
  });
  assert.equal(clientResponse.response.status, 201);
  const clientId = clientResponse.body.id;
  createdClientIds.push(clientId);

  const otherClientResponse = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Other report boundary ${suffix}`,
      legalName: `Other report boundary ${suffix} LLC`,
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
      description: `Concurrent posting software subscription ${suffix}`,
      currency: "AED",
      amount: 987.65,
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
  const entry = entryResponse.body.find((item) => item.statementLineId === lineResponse.body.id);
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
      name: `Concurrent posting ${suffix}`,
      legalName: `Concurrent posting ${suffix} LLC`,
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
      description: `Concurrent posting software subscription ${suffix}`,
      currency: "AED",
      amount: 987.65,
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
  const entry = entryResponse.body.find((item) => item.statementLineId === lineResponse.body.id);
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
  assert.equal(finalEntries.response.status, 200);
  assert.equal(finalEntries.body.find((item) => item.id === entry.id)?.status, "posted");

  const finalLines = await request<Array<{
    id: number;
    status: string;
  }>>(`/ledgerflow/statement-lines?clientId=${clientId}`);
  assert.equal(finalLines.response.status, 200);
  assert.equal(finalLines.body.find((item) => item.id === lineResponse.body.id)?.status, "posted");

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
