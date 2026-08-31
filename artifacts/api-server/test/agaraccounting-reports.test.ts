import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";

let server: Server | undefined;
let baseUrl = "";
let database: typeof import("@workspace/db") | undefined;
let primaryUserId = "";
let secondaryUserId = "";
let clientId: number | undefined;

function testDatabaseUrl() {
  const value = process.env.AGARACCOUNTING_TEST_DATABASE_URL;
  if (!value) throw new Error("AGARACCOUNTING_TEST_DATABASE_URL is required for AgarAccounting AI System integration tests.");
  const databaseName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) {
    throw new Error("The AgarAccounting AI System integration test database name must contain 'test'.");
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
  category?: string;
  debit: number;
  credit: number;
  balance: number;
  missingRateCount?: number;
};

type StatementSection = {
  label: string;
  amount: number;
  children?: StatementSection[];
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
  primaryUserId = `agaraccounting-test-primary-${randomUUID()}`;
  secondaryUserId = `agaraccounting-test-secondary-${randomUUID()}`;
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
  try {
  if (database && clientId) {
    await database.db.delete(database.reportPacksTable)
      .where(eq(database.reportPacksTable.clientId, clientId));
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
    await database.db.delete(database.exchangeRatesTable)
      .where(inArray(database.exchangeRatesTable.userId, [primaryUserId, secondaryUserId]));
    await database.db.delete(database.classificationPatternsTable)
      .where(inArray(database.classificationPatternsTable.userId, [primaryUserId, secondaryUserId]));
    await database.db.delete(database.usersTable)
      .where(eq(database.usersTable.id, primaryUserId));
    await database.db.delete(database.usersTable)
      .where(eq(database.usersTable.id, secondaryUserId));
  }
  } catch {
    // Transition audits are deliberately append-only and can retain their scoped
    // references; the isolated test database is discarded independently.
  } finally {
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    await database?.pool.end();
  }
});

test("posting a draft journal entry updates client-scoped reports", async () => {
  const client = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Report scope ${randomUUID()}`,
      legalName: "Report scope LLC",
    }),
  });
  assert.equal(client.response.status, 201);
  clientId = client.body.id;

  const line = await request<{ id: number; status: string; accountSuggestion: string }>("/agaraccounting/statement-lines", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-08-25",
      description: "ACCT TO ACCT TRANSFER 01910198067",
      currency: "AED",
      amount: 75,
      direction: "outflow",
    }),
  });
  assert.equal(line.response.status, 201);
  assert.equal(line.body.status, "draft");
  assert.equal(line.body.accountSuggestion, "Inter-account transfer");
  assert.equal((await request(`/agaraccounting/statement-lines/${line.body.id}/contact`, {
    method: "PATCH",
    body: JSON.stringify({ clientId, contactId: null, contactReviewDisposition: "dismissed" }),
  })).response.status, 200);

  const entries = await request<Array<{
    id: number;
    statementLineId: number;
    status: string;
    lines: Array<{ account: string; debit: number; credit: number }>;
  }>>(
    `/agaraccounting/journal-entries?clientId=${clientId}`,
  );
  assert.equal(entries.response.status, 200);
  const entry = entries.body.find((item) => item.statementLineId === line.body.id);
  assert.ok(entry, "Expected a journal entry for the new statement line");
  assert.equal(entry.status, "draft");

  const [beforeTrialBalance, beforeStatements, forbiddenReport] = await Promise.all([
    request<TrialBalanceRow[]>(`/agaraccounting/trial-balance?clientId=${clientId}`),
    request<FinancialStatements>(`/agaraccounting/financial-statements?clientId=${clientId}`),
    request<{ error: string }>(`/agaraccounting/trial-balance?clientId=${clientId}`, undefined, secondaryUserId),
  ]);
  assert.equal(beforeTrialBalance.response.status, 200);
  assert.equal(beforeStatements.response.status, 200);
  assert.equal(forbiddenReport.response.status, 403);

  const [draftTrialBalance, draftStatements, forbiddenPost] = await Promise.all([
    request<TrialBalanceRow[]>(`/agaraccounting/trial-balance?clientId=${clientId}`),
    request<FinancialStatements>(`/agaraccounting/financial-statements?clientId=${clientId}`),
    request<{ error: string }>(`/agaraccounting/journal-entries/${entry.id}/post`, {
      method: "POST",
      body: JSON.stringify({ clientId }),
    }, secondaryUserId),
  ]);
  assert.deepEqual(draftTrialBalance.body, beforeTrialBalance.body);
  assert.deepEqual(draftStatements.body, beforeStatements.body);
  assert.equal(forbiddenPost.response.status, 403);

  const posting = await request<{ status: string }>(`/agaraccounting/journal-entries/${entry.id}/post`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  });

  const [trialBalance, after] = await Promise.all([
    request<TrialBalanceRow[]>(`/agaraccounting/trial-balance?clientId=${clientId}`),
    request<FinancialStatements>(`/agaraccounting/financial-statements?clientId=${clientId}`),
  ]);
  assert.equal(posting.response.status, 200);
  assert.equal(posting.body.status, "posted");

  const [postedTrialBalance, postedStatements] = await Promise.all([
    request<TrialBalanceRow[]>(`/agaraccounting/trial-balance?clientId=${clientId}`),
    request<FinancialStatements>(`/agaraccounting/financial-statements?clientId=${clientId}`),
  ]);
  assert.equal(postedTrialBalance.response.status, 200);
  assert.equal(postedStatements.response.status, 200);

  const amount = 75;
  const beforeTransfer = beforeTrialBalance.body.find((row) => row.account === "Inter-account transfer")?.debit ?? 0;
  const beforeCash = beforeTrialBalance.body.find((row) => row.account === "Bank / cash")?.credit ?? 0;
  const postedTransfer = postedTrialBalance.body.find((row) => row.account === "Inter-account transfer")?.debit ?? 0;
  const postedCash = postedTrialBalance.body.find((row) => row.account === "Bank / cash")?.credit ?? 0;
  assert.equal(postedTransfer - beforeTransfer, amount);
  assert.equal(postedCash - beforeCash, amount);

  const beforeExpenses = sectionAmount(beforeStatements.body.incomeStatement, "Operating expenses");
  const beforeNetIncome = sectionAmount(beforeStatements.body.incomeStatement, "Net income");
  const beforeCashFlow = sectionAmount(beforeStatements.body.cashFlow, "Net cash from operating activities");
  const postedExpenses = sectionAmount(postedStatements.body.incomeStatement, "Operating expenses");
  const postedNetIncome = sectionAmount(postedStatements.body.incomeStatement, "Net income");
  const postedCashFlow = sectionAmount(postedStatements.body.cashFlow, "Net cash from operating activities");

  const before = await request<FinancialStatements>(`/agaraccounting/financial-statements?clientId=${clientId}`);
  assert.equal(postedExpenses - beforeExpenses, 0);
  assert.equal(postedNetIncome - beforeNetIncome, 0);
  assert.equal(postedCashFlow - beforeCashFlow, 0);

  const transferLine = await request<{ id: number; status: string; accountSuggestion: string }>("/agaraccounting/statement-lines", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-08-25",
      description: "Transfer to own savings account",
      currency: "AED",
      amount: 75,
      direction: "outflow",
    }),
  });
  assert.equal(transferLine.response.status, 201);
  assert.equal(transferLine.body.status, "draft");
  assert.equal(transferLine.body.accountSuggestion, "Inter-account transfer");
  assert.equal((await request(`/agaraccounting/statement-lines/${transferLine.body.id}/contact`, {
    method: "PATCH",
    body: JSON.stringify({ clientId, contactId: null, contactReviewDisposition: "dismissed" }),
  })).response.status, 200);
  const transferEntries = await request<Array<{ id: number; statementLineId: number; status: string }>>(`/agaraccounting/journal-entries?clientId=${clientId}`);
  const transferEntry = transferEntries.body.find((entry) => entry.statementLineId === transferLine.body.id);
  assert.ok(transferEntry);
  assert.equal(transferEntry.status, "draft");
  assert.equal((await request(`/agaraccounting/journal-entries/${transferEntry.id}/post`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  })).response.status, 200);

  const [afterTransferTrialBalance, afterTransferStatements] = await Promise.all([
    request<TrialBalanceRow[]>(`/agaraccounting/trial-balance?clientId=${clientId}`),
    request<FinancialStatements>(`/agaraccounting/financial-statements?clientId=${clientId}`),
  ]);
  const transferAccount = afterTransferTrialBalance.body.find((row) => row.account === "Inter-account transfer");
  assert.ok(transferAccount);
  assert.equal(transferAccount.category, "Assets");
  const assets = afterTransferStatements.body.balanceSheet.find((section) => section.label === "Assets");
  assert.equal(assets?.children?.find((section) => section.label === "Bank / cash")?.amount, -150);
  assert.equal(assets?.children?.find((section) => section.label === "Inter-account transfer")?.amount, 150);
  assert.equal(
    sectionAmount(afterTransferStatements.body.incomeStatement, "Net income"),
    postedNetIncome,
  );
  assert.equal(
    sectionAmount(afterTransferStatements.body.cashFlow, "Net cash from operating activities"),
    postedCashFlow,
  );
});

test("posting can be reversed without rewriting reports or accountability evidence", async () => {
  assert.ok(database);
  const lifecycleClient = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Reversible lifecycle ${randomUUID()}`,
      legalName: "Reversible lifecycle LLC",
      functionalCurrency: "AED",
    }),
  });
  assert.equal(lifecycleClient.response.status, 201);
  const lifecycleClientId = lifecycleClient.body.id;

  try {
    const line = await request<{ id: number; status: string }>("/agaraccounting/statement-lines", {
      method: "POST",
      body: JSON.stringify({
        clientId: lifecycleClientId,
        date: "2026-08-25",
        description: "Cloud software subscription",
        currency: "AED",
        amount: 55,
        direction: "outflow",
      }),
    });
    assert.equal(line.response.status, 201);
    assert.equal(line.body.status, "draft");
    assert.equal((await request(`/agaraccounting/statement-lines/${line.body.id}/contact`, {
      method: "PATCH",
      body: JSON.stringify({ clientId: lifecycleClientId, contactId: null, contactReviewDisposition: "dismissed" }),
    })).response.status, 200);
    const entries = await request<Array<{ id: number; statementLineId: number; status: string }>>(
      `/agaraccounting/journal-entries?clientId=${lifecycleClientId}`,
    );
    const entry = entries.body.find((candidate) => candidate.statementLineId === line.body.id);
    assert.ok(entry);
    assert.equal(entry.status, "draft");

    const [beforeTrialBalance, beforeStatements] = await Promise.all([
      request<TrialBalanceRow[]>(`/agaraccounting/trial-balance?clientId=${lifecycleClientId}`),
      request<FinancialStatements>(`/agaraccounting/financial-statements?clientId=${lifecycleClientId}`),
    ]);
    const [firstPost, repeatedPost] = await Promise.all([
      request<{ status: string }>(`/agaraccounting/journal-entries/${entry.id}/post`, {
        method: "POST",
        body: JSON.stringify({ clientId: lifecycleClientId }),
      }),
      request<{ error: string }>(`/agaraccounting/journal-entries/${entry.id}/post`, {
        method: "POST",
        body: JSON.stringify({ clientId: lifecycleClientId }),
      }),
    ]);
    assert.equal(beforeTrialBalance.response.status, 200);
    assert.equal(beforeStatements.response.status, 200);
    assert.deepEqual([firstPost.response.status, repeatedPost.response.status].sort(), [200, 409]);

    const [postedTrialBalance, postedStatements, postedLine, audits] = await Promise.all([
      request<TrialBalanceRow[]>(`/agaraccounting/trial-balance?clientId=${lifecycleClientId}`),
      request<FinancialStatements>(`/agaraccounting/financial-statements?clientId=${lifecycleClientId}`),
      request<Array<{ id: number; status: string }>>(`/agaraccounting/statement-lines?clientId=${lifecycleClientId}`),
      request<Array<{ transition: string; fromStatus: string; toStatus: string; actor: { id: string }; entryIds: number[]; statementLineIds: number[]; confirmedAt: string }>>(`/agaraccounting/bulk-transition-audits?clientId=${lifecycleClientId}`),
    ]);
    assert.equal(postedTrialBalance.body.find((row) => row.account === "Software & subscriptions")?.debit, 55);
    assert.equal(sectionAmount(postedStatements.body.incomeStatement, "Operating expenses"), -55);
    assert.equal(postedLine.body.find((candidate) => candidate.id === line.body.id)?.status, "posted");
    const postAudit = audits.body.find((audit) => audit.transition === "post_entry");
    assert.ok(postAudit);
    assert.deepEqual(postAudit.entryIds, [entry.id]);
    assert.deepEqual(postAudit.statementLineIds, [line.body.id]);
    assert.equal(postAudit.fromStatus, "draft");
    assert.equal(postAudit.toStatus, "posted");
    assert.equal(postAudit.actor.id, primaryUserId);
    assert.ok(Date.parse(postAudit.confirmedAt));
    const [persistedPostAudit] = await database.db.select()
      .from(database.bulkTransitionAuditsTable)
      .where(and(
        eq(database.bulkTransitionAuditsTable.clientId, lifecycleClientId),
        eq(database.bulkTransitionAuditsTable.transition, "post_entry"),
      ));
    assert.ok(persistedPostAudit);
    await assert.rejects(
      database.db.delete(database.bulkTransitionAuditsTable)
        .where(eq(database.bulkTransitionAuditsTable.id, persistedPostAudit.id)),
    );

   const draft = await request<{ id: number; snapshot: { traceability: { postedEntryCount: number }; notes: Array<{ number: number; narrative: string }> } }>("/agaraccounting/report-packs", {
      method: "POST",
      body: JSON.stringify({
        clientId: lifecycleClientId,
        periodEnd: "2026-12-31",
        reportingBasis: "IFRS",
        presentationProfile: "IAS 1",
        presentationCurrency: "AED",
      }),
    });
    assert.equal(draft.response.status, 201);
    assert.equal(draft.body.snapshot.traceability.postedEntryCount, 1);
   const basisNote = draft.body.snapshot.notes.find((note) => note.number === 1);
   assert.ok(basisNote);
   assert.match(basisNote.narrative, /Reversible lifecycle/);
   assert.doesNotMatch(basisNote.narrative, /Reversible lifecycle LLC/);

    const forbiddenUnpost = await request<{ error: string }>(`/agaraccounting/journal-entries/${entry.id}/unpost`, {
      method: "POST",
      body: JSON.stringify({ clientId: lifecycleClientId }),
    }, secondaryUserId);
    assert.equal(forbiddenUnpost.response.status, 403);
    const unpost = await request<{ status: string }>(`/agaraccounting/journal-entries/${entry.id}/unpost`, {
      method: "POST",
      body: JSON.stringify({ clientId: lifecycleClientId }),
    });
    assert.equal(unpost.response.status, 200);
    assert.equal(unpost.body.status, "draft");
    const repeatedUnpost = await request<{ error: string }>(`/agaraccounting/journal-entries/${entry.id}/unpost`, {
      method: "POST",
      body: JSON.stringify({ clientId: lifecycleClientId }),
    });
    assert.equal(repeatedUnpost.response.status, 409);

    const [unpostedTrialBalance, unpostedStatements, unpostedLine, unpostedAudits] = await Promise.all([
      request<TrialBalanceRow[]>(`/agaraccounting/trial-balance?clientId=${lifecycleClientId}`),
      request<FinancialStatements>(`/agaraccounting/financial-statements?clientId=${lifecycleClientId}`),
      request<Array<{ id: number; status: string }>>(`/agaraccounting/statement-lines?clientId=${lifecycleClientId}`),
      request<Array<{ transition: string; fromStatus: string; toStatus: string; actor: { id: string }; entryIds: number[]; statementLineIds: number[] }>>(`/agaraccounting/bulk-transition-audits?clientId=${lifecycleClientId}`),
    ]);
    assert.deepEqual(unpostedTrialBalance.body, beforeTrialBalance.body);
    assert.deepEqual(unpostedStatements.body.incomeStatement, beforeStatements.body.incomeStatement);
    assert.equal(unpostedLine.body.find((candidate) => candidate.id === line.body.id)?.status, "draft");
    const unpostAudit = unpostedAudits.body.find((audit) => audit.transition === "unpost_entry");
    assert.ok(unpostAudit);
    assert.deepEqual(unpostAudit.entryIds, [entry.id]);
    assert.deepEqual(unpostAudit.statementLineIds, [line.body.id]);
    assert.equal(unpostAudit.fromStatus, "posted");
    assert.equal(unpostAudit.toStatus, "draft");
    assert.equal(unpostAudit.actor.id, primaryUserId);

    const refreshedDraft = await request<{ snapshot: { traceability: { postedEntryCount: number } } }>("/agaraccounting/report-packs", {
      method: "POST",
      body: JSON.stringify({
        clientId: lifecycleClientId,
        periodEnd: "2026-12-31",
        reportingBasis: "IFRS",
        presentationProfile: "IAS 1",
        presentationCurrency: "AED",
      }),
    });
    assert.equal(refreshedDraft.response.status, 201);
    assert.equal(refreshedDraft.body.snapshot.traceability.postedEntryCount, 0);

    const foreignLine = await request<{ id: number; status: string }>("/agaraccounting/statement-lines", {
      method: "POST",
      body: JSON.stringify({
        clientId: lifecycleClientId,
        date: "2026-09-01",
        description: "Foreign software subscription",
        currency: "USD",
        amount: 10,
        direction: "outflow",
      }),
    });
    assert.equal(foreignLine.response.status, 201);
    assert.equal(foreignLine.body.status, "draft");
    assert.equal((await request(`/agaraccounting/statement-lines/${foreignLine.body.id}/contact`, {
      method: "PATCH",
      body: JSON.stringify({ clientId: lifecycleClientId, contactId: null, contactReviewDisposition: "dismissed" }),
    })).response.status, 200);
    const foreignEntries = await request<Array<{ id: number; statementLineId: number; status: string }>>(`/agaraccounting/journal-entries?clientId=${lifecycleClientId}`);
    const foreignEntry = foreignEntries.body.find((candidate) => candidate.statementLineId === foreignLine.body.id);
    assert.ok(foreignEntry);
    assert.equal(foreignEntry.status, "draft");
    const blockedPostingAfterRateDeletion = await request<{ error: string }>(`/agaraccounting/journal-entries/${foreignEntry.id}/post`, {
      method: "POST",
      body: JSON.stringify({ clientId: lifecycleClientId }),
    });
    assert.equal(blockedPostingAfterRateDeletion.response.status, 409);
    assert.match(blockedPostingAfterRateDeletion.body.error, /exchange rate required before posting/i);
    const stillDraft = await request<Array<{ id: number; status: string }>>(`/agaraccounting/journal-entries?clientId=${lifecycleClientId}`);
    assert.equal(stillDraft.body.find((candidate) => candidate.id === foreignEntry.id)?.status, "draft");

    const addedRate = await request<{ id: number }>(`/agaraccounting/exchange-rates?clientId=${lifecycleClientId}`, {
      method: "POST",
      body: JSON.stringify({
        sourceCurrency: "USD",
        functionalCurrency: "AED",
        effectiveDate: "2026-09-01",
        rate: 3.67,
      }),
    });
    assert.equal(addedRate.response.status, 201);
    const deletedRate = await fetch(`${baseUrl}/agaraccounting/exchange-rates/${addedRate.body.id}`, {
      method: "DELETE",
      headers: {
        "x-test-user-id": primaryUserId,
      },
    });
    assert.equal(deletedRate.status, 204);
    const blockedPosting = await request<{ error: string }>(`/agaraccounting/journal-entries/${foreignEntry.id}/post`, {
      method: "POST",
      body: JSON.stringify({ clientId: lifecycleClientId }),
    });
    assert.equal(blockedPosting.response.status, 409);
    assert.match(blockedPosting.body.error, /exchange rate required before posting/i);

    const restoredRate = await request<{ id: number }>(`/agaraccounting/exchange-rates?clientId=${lifecycleClientId}`, {
      method: "POST",
      body: JSON.stringify({
        sourceCurrency: "USD",
        functionalCurrency: "AED",
        effectiveDate: "2026-09-01",
        rate: 3.67,
      }),
    });
    assert.equal(restoredRate.response.status, 201);
    assert.equal((await request(`/agaraccounting/journal-entries/${foreignEntry.id}/post`, {
      method: "POST",
      body: JSON.stringify({ clientId: lifecycleClientId }),
    })).response.status, 200);
    const missingRate = await request<TrialBalanceRow[]>(`/agaraccounting/trial-balance?clientId=${lifecycleClientId}`);
    assert.equal(missingRate.body.some((row) => row.account === "Rate coverage required"), false);
    assert.equal(missingRate.body.find((row) => row.account === "Software & subscriptions")?.debit, 36.7);
  } finally {
    await database.db.delete(database.reportPacksTable).where(eq(database.reportPacksTable.clientId, lifecycleClientId));
    await database.db.delete(database.accountClassificationsTable).where(eq(database.accountClassificationsTable.clientId, lifecycleClientId));
    await database.db.delete(database.journalEntriesTable).where(eq(database.journalEntriesTable.clientId, lifecycleClientId));
    await database.db.delete(database.statementLinesTable).where(eq(database.statementLinesTable.clientId, lifecycleClientId));
    await database.db.delete(database.clientWorkspacesTable).where(eq(database.clientWorkspacesTable.clientId, lifecycleClientId));
    await database.db.delete(database.clientsTable).where(eq(database.clientsTable.id, lifecycleClientId));
  }
});

type WorkspaceUsageSummary = {
  statementImports: { used: number };
  storedEvidence: { documents: number; bytes: number; status: string };
  aiActivity: { used: number };
  clientWorkspaces: { used: number };
  retention: { statementEvidenceDays: number; aiActivityDays: number; ledgerDataDescription: string };
};

test("reports usage only for the authenticated workspace", async () => {
  const beforePrimary = await request<WorkspaceUsageSummary>("/agaraccounting/usage");
  const beforeSecondary = await request<WorkspaceUsageSummary>("/agaraccounting/usage", undefined, secondaryUserId);
  const created = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({ name: `Usage scope ${randomUUID()}`, legalName: "Usage scope LLC" }),
  });
  assert.equal(created.response.status, 201);

  const [afterPrimary, afterSecondary] = await Promise.all([
    request<WorkspaceUsageSummary>("/agaraccounting/usage"),
    request<WorkspaceUsageSummary>("/agaraccounting/usage", undefined, secondaryUserId),
  ]);
  assert.equal(afterPrimary.response.status, 200);
  assert.equal(afterSecondary.response.status, 200);
  assert.equal(afterPrimary.body.clientWorkspaces.used, beforePrimary.body.clientWorkspaces.used + 1);
  assert.equal(afterSecondary.body.clientWorkspaces.used, beforeSecondary.body.clientWorkspaces.used);
  assert.equal(afterSecondary.body.storedEvidence.documents, beforeSecondary.body.storedEvidence.documents);
  assert.equal(afterPrimary.body.retention.statementEvidenceDays, 365);
  assert.equal(afterPrimary.body.retention.aiActivityDays, 90);
});
