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

let server: Server;
let baseUrl: string;
let app: typeof import("../src/app").default;
let database: typeof import("@workspace/db");
const createdClientIds: number[] = [];

function testDatabaseUrl() {
  const value = process.env.LEDGERFLOW_TEST_DATABASE_URL;
  if (!value) throw new Error("LEDGERFLOW_TEST_DATABASE_URL is required for LedgerFlow integration tests.");

  const databaseName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) {
    throw new Error("LEDGERFLOW_TEST_DATABASE_URL must use a database name containing 'test'.");
  }
  return value;
}

before(async () => {
  process.env.DATABASE_URL = testDatabaseUrl();
  app = (await import("../src/app")).default;
  database = await import("@workspace/db");
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
    if (createdClientIds.length) {
      await database.db.delete(database.journalEntriesTable)
        .where(inArray(database.journalEntriesTable.clientId, createdClientIds));
      await database.db.delete(database.statementLinesTable)
        .where(inArray(database.statementLinesTable.clientId, createdClientIds));
      await database.db.delete(database.bankAccountsTable)
        .where(inArray(database.bankAccountsTable.clientId, createdClientIds));
      await database.db.delete(database.clientsTable)
        .where(inArray(database.clientsTable.id, createdClientIds));
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await database.pool.end();
  }
});

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
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
      name: `Report boundary ${suffix}`,
      legalName: `Report boundary ${suffix} LLC`,
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
  });
  assert.equal(otherClientResponse.response.status, 201);
  const otherClientId = otherClientResponse.body.id;
  createdClientIds.push(otherClientId);

  const amount = 1234.56;
  const lineResponse = await request<{ id: number }>("/ledgerflow/statement-lines", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-08-24",
      description: `Report boundary software expense ${suffix}`,
      currency: "AED",
      amount,
      direction: "outflow",
    }),
  });
  assert.equal(lineResponse.response.status, 201);

  const entryResponse = await request<Array<{
    id: number;
    statementLineId: number;
    status: string;
    lines: Array<{ account: string; debit: number; credit: number }>;
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
  assert.equal(mismatchedApproval.response.status, 409);

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
  assert.equal(mismatchedPost.response.status, 404);
  assert.equal(mismatchedPost.body.error, "Journal entry not found for this client");

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