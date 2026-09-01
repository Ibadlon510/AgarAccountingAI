import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";

let server: Server | undefined;
let baseUrl = "";
let database: typeof import("@workspace/db") | undefined;
let primaryUserId = "";
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
  const text = await response.text();
  return {
    response,
    body: (text ? JSON.parse(text) : null) as T,
  };
}

type JournalEntry = {
  id: number;
  statementLineId: number | null;
  source: "manual" | "statement" | "system";
  status: string;
  memo: string;
  date: string;
  currency: string;
  lines: Array<{ account: string; debit: number; credit: number }>;
};

type TrialBalanceRow = {
  account: string;
  debit: number;
  credit: number;
  balance: number;
};

before(async () => {
  process.env.DATABASE_URL = testDatabaseUrl();
  const { createApp } = await import("../src/app");
  const { createRequireAuth } = await import("../src/middlewares/authMiddleware");
  database = await import("@workspace/db");
  primaryUserId = `agaraccounting-manual-journal-${randomUUID()}`;
  await database.db.insert(database.usersTable).values({
    id: primaryUserId,
    email: `${primaryUserId}@example.test`,
    firstName: "Manual",
    lastName: "Journal",
  });

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
      await database.db.delete(database.journalEntriesTable)
        .where(eq(database.journalEntriesTable.clientId, clientId));
      await database.db.delete(database.statementLinesTable)
        .where(eq(database.statementLinesTable.clientId, clientId));
      await database.db.delete(database.clientWorkspacesTable)
        .where(eq(database.clientWorkspacesTable.clientId, clientId));
      await database.db.delete(database.clientsTable)
        .where(eq(database.clientsTable.id, clientId));
    }
    if (database) {
      await database.db.delete(database.clientWorkspacesTable)
        .where(eq(database.clientWorkspacesTable.userId, primaryUserId));
      await database.db.update(database.clientsTable)
        .set({ ownerUserId: null })
        .where(eq(database.clientsTable.ownerUserId, primaryUserId));
      await database.db.delete(database.usersTable)
        .where(eq(database.usersTable.id, primaryUserId));
    }
  } finally {
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    await database?.pool.end();
  }
});

test("manual journal entries post adjustments without a statement line", async () => {
  const client = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Manual journals ${randomUUID()}`,
      legalName: "Manual Journals LLC",
    }),
  });
  assert.equal(client.response.status, 201);
  clientId = client.body.id;

  const rejectedSame = await request<{ error: string }>("/agaraccounting/journal-entries", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-08-31",
      memo: "Invalid same-account entry",
      currency: "AED",
      lines: [
        { description: "Invalid debit", account: "Rent expense", debit: 100, credit: 0 },
        { description: "Unbalanced credit", account: "Accrued expenses", debit: 0, credit: 90 },
      ],
    }),
  });
  assert.equal(rejectedSame.response.status, 400);

  const created = await request<JournalEntry>("/agaraccounting/journal-entries", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-08-31",
      memo: "Accrue August rent",
      currency: "AED",
      lines: [
        { description: "Office rent", account: "Rent expense", debit: 3000, credit: 0 },
        { description: "Shared office costs", account: "Office expenses", debit: 1500, credit: 0 },
        { description: "August accrual", account: "Accrued expenses", debit: 0, credit: 4500 },
      ],
    }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.source, "manual");
  assert.equal(created.body.statementLineId, null);
  assert.equal(created.body.status, "draft");
  assert.deepEqual(created.body.lines, [
    { description: "Office rent", account: "Rent expense", debit: 3000, credit: 0 },
    { description: "Shared office costs", account: "Office expenses", debit: 1500, credit: 0 },
    { description: "August accrual", account: "Accrued expenses", debit: 0, credit: 4500 },
  ]);

  const listed = await request<JournalEntry[]>(`/agaraccounting/journal-entries?clientId=${clientId}`);
  const draft = listed.body.find((entry) => entry.id === created.body.id);
  assert.ok(draft);
  assert.equal(draft.source, "manual");
  assert.equal(draft.statementLineId, null);

  const before = await request<TrialBalanceRow[]>(`/agaraccounting/trial-balance?clientId=${clientId}`);
  assert.equal(before.response.status, 200);
  assert.equal(before.body.find((row) => row.account === "Rent expense")?.debit ?? 0, 0);
  assert.equal(before.body.find((row) => row.account === "Accrued expenses")?.credit ?? 0, 0);

  const posted = await request<JournalEntry>(`/agaraccounting/journal-entries/${created.body.id}/post`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  });
  assert.equal(posted.response.status, 200);
  assert.equal(posted.body.status, "posted");
  assert.equal(posted.body.source, "manual");

  const afterPost = await request<TrialBalanceRow[]>(`/agaraccounting/trial-balance?clientId=${clientId}`);
  assert.equal(afterPost.body.find((row) => row.account === "Rent expense")?.debit ?? 0, 3000);
  assert.equal(afterPost.body.find((row) => row.account === "Office expenses")?.debit ?? 0, 1500);
  assert.equal(afterPost.body.find((row) => row.account === "Accrued expenses")?.credit ?? 0, 4500);
  assert.equal(afterPost.body.find((row) => row.account === "Bank / cash")?.debit ?? 0, 0);

  const transactions = await request<Array<{ entryId: number; statementLineId: number | null; description: string }>>(
    `/agaraccounting/trial-balance/transactions?clientId=${clientId}&account=${encodeURIComponent("Rent expense")}`,
  );
  assert.equal(transactions.response.status, 200);
  assert.ok(transactions.body.some((row) => row.entryId === created.body.id && row.statementLineId == null && row.description === "Office rent"));

  const blockedEdit = await request<{ error: string }>(`/agaraccounting/journal-entries/${created.body.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      clientId,
      date: "2026-08-31",
      memo: "Should not edit posted",
      currency: "AED",
      lines: [
        { description: "", account: "Rent expense", debit: 1, credit: 0 },
        { description: "", account: "Accrued expenses", debit: 0, credit: 1 },
      ],
    }),
  });
  assert.equal(blockedEdit.response.status, 409);

  const unposted = await request<JournalEntry>(`/agaraccounting/journal-entries/${created.body.id}/unpost`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  });
  assert.equal(unposted.response.status, 200);
  assert.equal(unposted.body.status, "draft");

  const afterUnpost = await request<TrialBalanceRow[]>(`/agaraccounting/trial-balance?clientId=${clientId}`);
  assert.equal(afterUnpost.body.find((row) => row.account === "Rent expense")?.debit ?? 0, 0);
  assert.equal(afterUnpost.body.find((row) => row.account === "Accrued expenses")?.credit ?? 0, 0);

  const updated = await request<JournalEntry>(`/agaraccounting/journal-entries/${created.body.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      clientId,
      date: "2026-08-30",
      memo: "Accrue August office rent",
      currency: "AED",
      lines: [
        { description: "Office costs", account: "Office expenses", debit: 4800, credit: 0 },
        { description: "Updated accrual", account: "Accrued expenses", debit: 0, credit: 4800 },
      ],
    }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.memo, "Accrue August office rent");
  assert.equal(updated.body.date, "2026-08-30");
  assert.deepEqual(updated.body.lines, [
    { description: "Office costs", account: "Office expenses", debit: 4800, credit: 0 },
    { description: "Updated accrual", account: "Accrued expenses", debit: 0, credit: 4800 },
  ]);

  const deleted = await request<null>(`/agaraccounting/journal-entries/${created.body.id}`, {
    method: "DELETE",
    body: JSON.stringify({ clientId }),
  });
  assert.equal(deleted.response.status, 204);

  const remaining = await request<JournalEntry[]>(`/agaraccounting/journal-entries?clientId=${clientId}`);
  assert.equal(remaining.body.some((entry) => entry.id === created.body.id), false);
});

test("statement-linked journals cannot be deleted as manual entries", async () => {
  assert.ok(clientId);
  const line = await request<{ id: number }>("/agaraccounting/statement-lines", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-08-25",
      description: "BANK FEE",
      currency: "AED",
      amount: 25,
      direction: "outflow",
    }),
  });
  assert.equal(line.response.status, 201);
  const entries = await request<JournalEntry[]>(`/agaraccounting/journal-entries?clientId=${clientId}`);
  const linked = entries.body.find((entry) => entry.statementLineId === line.body.id);
  assert.ok(linked);
  assert.equal(linked.source, "statement");

  const deleted = await request<{ error: string }>(`/agaraccounting/journal-entries/${linked.id}`, {
    method: "DELETE",
    body: JSON.stringify({ clientId }),
  });
  assert.equal(deleted.response.status, 409);
});
