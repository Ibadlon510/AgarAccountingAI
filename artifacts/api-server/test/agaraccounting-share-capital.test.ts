import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { SHARE_CAPITAL_ACCOUNT_NAME, SHARE_CAPITAL_DUPLICATE_WARNING, SHARE_CAPITAL_SYSTEM_SOURCE } from "../src/lib/shareCapital";

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

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-user-id": primaryUserId,
      ...init?.headers,
    },
  });
  const text = await response.text();
  return {
    response,
    body: (text ? JSON.parse(text) : null) as T,
  };
}

type ClientBody = {
  id: number;
  name: string;
  legalName: string;
  functionalCurrency: string;
  basis: string;
  period: string;
  systemRatesEnabled: boolean;
  shareCapitalAuthorisedShares: number | null;
  shareCapitalParValue: number | null;
  shareholders: Array<{ name: string; nationality: string | null; numberOfShares: number }>;
  shareCapitalJournalId: number | null;
  shareCapitalDuplicateWarning: string | null;
};

type JournalEntry = {
  id: number;
  status: string;
  memo: string;
  date: string;
  lines: Array<{ account: string; debit: number; credit: number }>;
};

before(async () => {
  process.env.DATABASE_URL = testDatabaseUrl();
  const { createApp } = await import("../src/app");
  const { createRequireAuth } = await import("../src/middlewares/authMiddleware");
  database = await import("@workspace/db");
  primaryUserId = `agaraccounting-share-capital-${randomUUID()}`;
  await database.db.insert(database.usersTable).values({
    id: primaryUserId,
    email: `${primaryUserId}@example.test`,
    firstName: "Share",
    lastName: "Capital",
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
    if (database) {
      const memberships = await database.db.select({ clientId: database.clientWorkspacesTable.clientId })
        .from(database.clientWorkspacesTable)
        .where(eq(database.clientWorkspacesTable.userId, primaryUserId));
      const clientIds = [...new Set([
        ...memberships.map((row) => row.clientId),
        ...(clientId ? [clientId] : []),
      ])];
      await database.db.update(database.usersTable)
        .set({ starterClientId: null, remediatedLegacyClientId: null })
        .where(eq(database.usersTable.id, primaryUserId));
      if (clientIds.length) {
        await database.db.delete(database.journalEntriesTable)
          .where(inArray(database.journalEntriesTable.clientId, clientIds));
        await database.db.delete(database.shareholdersTable)
          .where(inArray(database.shareholdersTable.clientId, clientIds));
        await database.db.delete(database.accountClassificationsTable)
          .where(inArray(database.accountClassificationsTable.clientId, clientIds));
        await database.db.delete(database.clientWorkspacesTable)
          .where(inArray(database.clientWorkspacesTable.clientId, clientIds));
        await database.db.delete(database.clientsTable)
          .where(inArray(database.clientsTable.id, clientIds));
      }
      await database.db.delete(database.usersTable)
        .where(eq(database.usersTable.id, primaryUserId));
    }
  } finally {
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    await database?.pool.end();
  }
});

test("saves the share register, posts a replaceable system journal, and warns about foreign Share capital credits", async () => {
  const created = await request<ClientBody>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Share capital ${randomUUID()}`,
      legalName: "Share Capital Register LLC",
      functionalCurrency: "AED",
      basis: "IFRS",
      period: "August 2026",
    }),
  });
  assert.equal(created.response.status, 201);
  clientId = created.body.id;

  const identity = {
    name: created.body.name,
    legalName: created.body.legalName,
    functionalCurrency: "AED",
    basis: "IFRS",
    period: "August 2026",
    systemRatesEnabled: created.body.systemRatesEnabled,
  };

  const first = await request<ClientBody>(`/clients/${clientId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...identity,
      shareCapitalAuthorisedShares: 100,
      shareCapitalParValue: 2000,
      shareholders: [
        { name: "Mona Wagdy Ayad Helmy", nationality: "Indian", numberOfShares: 40 },
        { name: "Emad Helmy Saad Tadros", nationality: null, numberOfShares: 60 },
      ],
    }),
  });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.shareCapitalAuthorisedShares, 100);
  assert.equal(first.body.shareCapitalParValue, 2000);
  assert.equal(first.body.shareholders.length, 2);
  assert.ok(first.body.shareCapitalJournalId);
  assert.equal(first.body.shareCapitalDuplicateWarning, null);

  const journals = await request<JournalEntry[]>(`/agaraccounting/journal-entries?clientId=${clientId}`);
  assert.equal(journals.response.status, 200);
  const systemJournal = journals.body.find((entry) => entry.id === first.body.shareCapitalJournalId);
  assert.ok(systemJournal);
  assert.equal(systemJournal.status, "posted");
  assert.equal(systemJournal.date, "2026-08-01");
  assert.deepEqual(systemJournal.lines, [
    {
      description: "Share capital per client register",
      account: "Due from shareholders",
      debit: 200000,
      credit: 0,
    },
    {
      description: "Share capital per client register",
      account: SHARE_CAPITAL_ACCOUNT_NAME,
      debit: 0,
      credit: 200000,
    },
  ]);

  const second = await request<ClientBody>(`/clients/${clientId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...identity,
      shareCapitalAuthorisedShares: 50,
      shareCapitalParValue: 2000,
      shareholders: [
        { name: "Mona Wagdy Ayad Helmy", nationality: "Indian", numberOfShares: 20 },
        { name: "Emad Helmy Saad Tadros", nationality: null, numberOfShares: 30 },
      ],
    }),
  });
  assert.equal(second.response.status, 200);
  assert.equal(second.body.shareCapitalJournalId, first.body.shareCapitalJournalId);
  const replaced = await request<JournalEntry[]>(`/agaraccounting/journal-entries?clientId=${clientId}`);
  const replacedJournal = replaced.body.find((entry) => entry.id === second.body.shareCapitalJournalId);
  assert.equal(replacedJournal?.lines[1]?.credit, 100000);

  const foreign = await database!.db.insert(database!.journalEntriesTable).values({
    clientId,
    date: "2026-01-15",
    memo: "Legacy share capital",
    currency: "AED",
    status: "posted",
    confidence: "1.00",
    debitAccount: "Bank / cash",
    creditAccount: SHARE_CAPITAL_ACCOUNT_NAME,
    amount: "200000.00",
    functionalCurrency: "AED",
    functionalAmount: "200000.00",
    exchangeRateSourceScope: "none",
    exchangeRateStatus: "not_required",
  }).returning();
  assert.equal(foreign.length, 1);

  const duplicate = await request<ClientBody>(`/clients/${clientId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...identity,
      shareCapitalAuthorisedShares: 50,
      shareCapitalParValue: 2000,
      shareholders: [
        { name: "Mona Wagdy Ayad Helmy", nationality: "Indian", numberOfShares: 20 },
        { name: "Emad Helmy Saad Tadros", nationality: null, numberOfShares: 30 },
      ],
    }),
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.body.shareCapitalJournalId, first.body.shareCapitalJournalId);
  assert.equal(duplicate.body.shareCapitalDuplicateWarning, SHARE_CAPITAL_DUPLICATE_WARNING);

  const cleared = await request<ClientBody>(`/clients/${clientId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...identity,
      shareCapitalAuthorisedShares: null,
      shareCapitalParValue: null,
      shareholders: [],
    }),
  });
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.body.shareCapitalJournalId, null);
  assert.equal(cleared.body.shareCapitalDuplicateWarning, null);
  const remaining = await database!.db.select({
    id: database!.journalEntriesTable.id,
    systemSource: database!.journalEntriesTable.systemSource,
  }).from(database!.journalEntriesTable).where(and(
    eq(database!.journalEntriesTable.clientId, clientId),
    eq(database!.journalEntriesTable.systemSource, SHARE_CAPITAL_SYSTEM_SOURCE),
  ));
  assert.equal(remaining.length, 0);
});
