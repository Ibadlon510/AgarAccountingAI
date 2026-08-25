import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";

let server: Server | undefined;
let baseUrl = "";
let database: typeof import("@workspace/db") | undefined;
let primaryUserId = "";
let secondaryUserId = "";
let clientId: number | undefined;

function testDatabaseUrl() {
  const value = process.env.LEDGERFLOW_TEST_DATABASE_URL;
  if (!value) throw new Error("LEDGERFLOW_TEST_DATABASE_URL is required for LedgerFlow integration tests.");
  const databaseName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) {
    throw new Error("The LedgerFlow integration test database name must contain 'test'.");
  }
  return value;
}

async function request<T>(path: string, init?: RequestInit, userId = primaryUserId) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-user-id": userId,
      ...init?.headers,
    },
  });
  return {
    response,
    body: await response.json() as T,
  };
}

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

function sectionAmount(sections: StatementSection[], label: string) {
  const section = sections.find((item) => item.label === label);
  assert.ok(section, `Expected statement section "${label}"`);
  return section.amount;
}

before(async () => {
  process.env.DATABASE_URL = testDatabaseUrl();
  const { createApp } = await import("../src/app");
  const { createRequireAuth } = await import("../src/middlewares/authMiddleware");
  database = await import("@workspace/db");
  primaryUserId = `ledgerflow-test-primary-${randomUUID()}`;
  secondaryUserId = `ledgerflow-test-secondary-${randomUUID()}`;
  await database.db.insert(database.usersTable).values([
    { id: primaryUserId, email: `${primaryUserId}@example.test`, firstName: "Primary", lastName: "Test" },
    { id: secondaryUserId, email: `${secondaryUserId}@example.test`, firstName: "Secondary", lastName: "Test" },
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
  if (database && clientId) {
    await database.db.delete(database.journalEntriesTable)
      .where(eq(database.journalEntriesTable.clientId, clientId));
    await database.db.delete(database.statementImportsTable)
      .where(eq(database.statementImportsTable.clientId, clientId));
    await database.db.delete(database.statementLinesTable)
      .where(eq(database.statementLinesTable.clientId, clientId));
    await database.db.delete(database.bankAccountsTable)
      .where(eq(database.bankAccountsTable.clientId, clientId));
    await database.db.delete(database.clientWorkspacesTable)
      .where(eq(database.clientWorkspacesTable.clientId, clientId));
    await database.db.delete(database.clientsTable)
      .where(eq(database.clientsTable.id, clientId));
  }
  if (database) {
    await database.db.delete(database.classificationPatternsTable)
      .where(inArray(database.classificationPatternsTable.userId, [primaryUserId, secondaryUserId]));
    await database.db.delete(database.usersTable)
      .where(eq(database.usersTable.id, primaryUserId));
    await database.db.delete(database.usersTable)
      .where(eq(database.usersTable.id, secondaryUserId));
  }
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
});

test("posting a journal entry updates client-scoped reports", async () => {
  const client = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Report scope ${randomUUID()}`,
      legalName: "Report scope LLC",
    }),
  });
  assert.equal(client.response.status, 201);
  clientId = client.body.id;

  const line = await request<{ id: number }>("/ledgerflow/statement-lines", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-08-24",
      description: "Scoped software subscription",
      currency: "AED",
      amount: 125,
      direction: "outflow",
    }),
  });
  assert.equal(line.response.status, 201);

  const entries = await request<Array<{ id: number; statementLineId: number; status: string }>>(
    `/ledgerflow/journal-entries?clientId=${clientId}`,
  );
  assert.equal(entries.response.status, 200);
  const entry = entries.body.find((item) => item.statementLineId === line.body.id);
  assert.ok(entry, "Expected a journal entry for the new statement line");
  assert.equal(entry.status, "suggested");

  const [beforeTrialBalance, beforeStatements, forbiddenReport] = await Promise.all([
    request<TrialBalanceRow[]>(`/ledgerflow/trial-balance?clientId=${clientId}`),
    request<FinancialStatements>(`/ledgerflow/financial-statements?clientId=${clientId}`),
    request<{ error: string }>(`/ledgerflow/trial-balance?clientId=${clientId}`, undefined, secondaryUserId),
  ]);
  assert.equal(beforeTrialBalance.response.status, 200);
  assert.equal(beforeStatements.response.status, 200);
  assert.equal(forbiddenReport.response.status, 403);

  const forbiddenApproval = await request<{ error: string }>(`/ledgerflow/journal-entries/${entry.id}/approve`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  }, secondaryUserId);
  assert.equal(forbiddenApproval.response.status, 403);

  const approval = await request<{ status: string }>(`/ledgerflow/journal-entries/${entry.id}/approve`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  });
  assert.equal(approval.response.status, 200);
  assert.equal(approval.body.status, "approved");

  const [approvedTrialBalance, approvedStatements, forbiddenPost] = await Promise.all([
    request<TrialBalanceRow[]>(`/ledgerflow/trial-balance?clientId=${clientId}`),
    request<FinancialStatements>(`/ledgerflow/financial-statements?clientId=${clientId}`),
    request<{ error: string }>(`/ledgerflow/journal-entries/${entry.id}/post`, {
      method: "POST",
      body: JSON.stringify({ clientId }),
    }, secondaryUserId),
  ]);
  assert.deepEqual(approvedTrialBalance.body, beforeTrialBalance.body);
  assert.deepEqual(approvedStatements.body, beforeStatements.body);
  assert.equal(forbiddenPost.response.status, 403);

  const posting = await request<{ status: string }>(`/ledgerflow/journal-entries/${entry.id}/post`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  });
  assert.equal(posting.response.status, 200);
  assert.equal(posting.body.status, "posted");

  const [postedTrialBalance, postedStatements] = await Promise.all([
    request<TrialBalanceRow[]>(`/ledgerflow/trial-balance?clientId=${clientId}`),
    request<FinancialStatements>(`/ledgerflow/financial-statements?clientId=${clientId}`),
  ]);
  assert.equal(postedTrialBalance.response.status, 200);
  assert.equal(postedStatements.response.status, 200);

  const amount = 125;
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

type WorkspaceUsageSummary = {
  statementImports: { used: number };
  storedEvidence: { documents: number; bytes: number; status: string };
  aiActivity: { used: number };
  clientWorkspaces: { used: number };
  retention: { statementEvidenceDays: number; aiActivityDays: number; ledgerDataDescription: string };
};

test("reports usage only for the authenticated workspace", async () => {
  const beforePrimary = await request<WorkspaceUsageSummary>("/ledgerflow/usage");
  const beforeSecondary = await request<WorkspaceUsageSummary>("/ledgerflow/usage", undefined, secondaryUserId);
  const created = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({ name: `Usage scope ${randomUUID()}`, legalName: "Usage scope LLC" }),
  });
  assert.equal(created.response.status, 201);

  const [afterPrimary, afterSecondary] = await Promise.all([
    request<WorkspaceUsageSummary>("/ledgerflow/usage"),
    request<WorkspaceUsageSummary>("/ledgerflow/usage", undefined, secondaryUserId),
  ]);
  assert.equal(afterPrimary.response.status, 200);
  assert.equal(afterSecondary.response.status, 200);
  assert.equal(afterPrimary.body.clientWorkspaces.used, beforePrimary.body.clientWorkspaces.used + 1);
  assert.equal(afterSecondary.body.clientWorkspaces.used, beforeSecondary.body.clientWorkspaces.used);
  assert.equal(afterSecondary.body.storedEvidence.documents, beforeSecondary.body.storedEvidence.documents);
  assert.equal(afterPrimary.body.retention.statementEvidenceDays, 365);
  assert.equal(afterPrimary.body.retention.aiActivityDays, 90);
});
