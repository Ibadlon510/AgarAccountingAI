import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  LEGACY_SHARE_CAPITAL_ACCOUNT_NAME,
  SHARE_CAPITAL_ACCOUNT_NAME,
  SHARE_CAPITAL_DUPLICATE_WARNING,
  SHARE_CAPITAL_SYSTEM_SOURCE,
} from "../src/lib/shareCapital";

let server: Server | undefined;
let baseUrl = "";
let database: typeof import("@workspace/db") | undefined;
let primaryUserId = "";
let secondaryUserId = "";
let clientId: number | undefined;
let isolatedClientId: number | undefined;
let legacyCapitalClientId: number | undefined;

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
  secondaryUserId = `agaraccounting-share-capital-isolated-${randomUUID()}`;
  await database.db.insert(database.usersTable).values([
    {
      id: primaryUserId,
      email: `${primaryUserId}@example.test`,
      firstName: "Share",
      lastName: "Capital",
    },
    {
      id: secondaryUserId,
      email: `${secondaryUserId}@example.test`,
      firstName: "Isolated",
      lastName: "Owner",
    },
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
    if (database) {
      const memberships = await database.db.select({ clientId: database.clientWorkspacesTable.clientId })
        .from(database.clientWorkspacesTable)
        .where(inArray(database.clientWorkspacesTable.userId, [primaryUserId, secondaryUserId]));
      const clientIds = [...new Set([
        ...memberships.map((row) => row.clientId),
        ...(clientId ? [clientId] : []),
        ...(isolatedClientId ? [isolatedClientId] : []),
        ...(legacyCapitalClientId ? [legacyCapitalClientId] : []),
      ])];
      await database.db.update(database.usersTable)
        .set({ starterClientId: null, remediatedLegacyClientId: null })
        .where(inArray(database.usersTable.id, [primaryUserId, secondaryUserId]));
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
        .where(inArray(database.usersTable.id, [primaryUserId, secondaryUserId]));
    }
  } finally {
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    await database?.pool.end();
  }
});

test("fresh schema contains durable share-register storage and one system journal per client", async () => {
  const columns = await database!.pool.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND (
         (table_name = 'agaraccounting_clients'
           AND column_name IN ('share_capital_authorised_shares', 'share_capital_par_value'))
         OR (table_name = 'agaraccounting_journal_entries' AND column_name = 'system_source')
       )
     ORDER BY table_name, column_name
  `);
  assert.deepEqual(columns.rows, [
    { table_name: "agaraccounting_clients", column_name: "share_capital_authorised_shares" },
    { table_name: "agaraccounting_clients", column_name: "share_capital_par_value" },
    { table_name: "agaraccounting_journal_entries", column_name: "system_source" },
  ]);

  const objects = await database!.pool.query<{
    shareholder_table: string | null;
    register_journal_index: string | null;
  }>(`
    SELECT
      to_regclass('agaraccounting_shareholders')::text AS shareholder_table,
      to_regclass('agaraccounting_journal_entries_share_capital_register_idx')::text AS register_journal_index
  `);
  assert.equal(objects.rows[0]?.shareholder_table, "agaraccounting_shareholders");
  assert.equal(
    objects.rows[0]?.register_journal_index,
    "agaraccounting_journal_entries_share_capital_register_idx",
  );
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

  const [reloadedClients, organization, journals] = await Promise.all([
    request<ClientBody[]>("/clients"),
    request<{ companies: ClientBody[] }>("/organizations/context"),
    request<JournalEntry[]>(`/agaraccounting/journal-entries?clientId=${clientId}`),
  ]);
  const reloaded = reloadedClients.body.find((candidate) => candidate.id === clientId);
  const organizationClient = organization.body.companies.find((candidate) => candidate.id === clientId);
  assert.ok(reloaded);
  assert.ok(organizationClient);
  assert.equal(reloaded.shareCapitalAuthorisedShares, 100);
  assert.equal(reloaded.shareCapitalParValue, 2000);
  assert.equal(organizationClient.shareCapitalJournalId, first.body.shareCapitalJournalId);
  assert.equal(organizationClient.shareholders.length, 2);
  assert.deepEqual(reloaded.shareholders.map(({ name, nationality, numberOfShares }) => ({
    name,
    nationality,
    numberOfShares,
  })), [
    { name: "Mona Wagdy Ayad Helmy", nationality: "Indian", numberOfShares: 40 },
    { name: "Emad Helmy Saad Tadros", nationality: null, numberOfShares: 60 },
  ]);
  assert.equal(journals.response.status, 200);
  const systemJournal = journals.body.find((entry) => entry.id === first.body.shareCapitalJournalId);
  assert.ok(systemJournal);
  assert.equal(systemJournal.status, "posted");
  assert.equal(systemJournal.date, "2026-08-01");
  assert.deepEqual(systemJournal.lines, [
    { description: "Share capital per client register", account: "Due from shareholders", debit: 200000, credit: 0 },
    { description: "Share capital per client register", account: SHARE_CAPITAL_ACCOUNT_NAME, debit: 0, credit: 200000 },
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

test("reuses the legacy Share Capital account without duplicate-code seeding failures", async () => {
  const created = await request<ClientBody>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Legacy share capital ${randomUUID()}`,
      legalName: "Legacy Share Capital LLC",
      functionalCurrency: "AED",
      basis: "IFRS",
      period: "August 2026",
    }),
  });
  assert.equal(created.response.status, 201);
  legacyCapitalClientId = created.body.id;

  const [legacyAccount] = await database!.db.update(database!.accountClassificationsTable)
    .set({
      accountName: LEGACY_SHARE_CAPITAL_ACCOUNT_NAME,
      displayName: LEGACY_SHARE_CAPITAL_ACCOUNT_NAME,
      isSystem: false,
    })
    .where(and(
      eq(database!.accountClassificationsTable.clientId, legacyCapitalClientId),
      eq(database!.accountClassificationsTable.accountName, SHARE_CAPITAL_ACCOUNT_NAME),
    ))
    .returning();
  assert.equal(legacyAccount.accountCode, "3000");

  const listed = await request<ClientBody[]>("/clients");
  assert.equal(listed.response.status, 200, JSON.stringify(listed.body));
  const capitalAccounts = await database!.db.select()
    .from(database!.accountClassificationsTable)
    .where(and(
      eq(database!.accountClassificationsTable.clientId, legacyCapitalClientId),
      inArray(database!.accountClassificationsTable.accountName, [
        SHARE_CAPITAL_ACCOUNT_NAME,
        LEGACY_SHARE_CAPITAL_ACCOUNT_NAME,
      ]),
    ));
  assert.deepEqual(capitalAccounts.map((account) => account.accountName), [LEGACY_SHARE_CAPITAL_ACCOUNT_NAME]);

  const saved = await request<ClientBody>(`/clients/${legacyCapitalClientId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: created.body.name,
      legalName: created.body.legalName,
      functionalCurrency: created.body.functionalCurrency,
      basis: created.body.basis,
      period: created.body.period,
      systemRatesEnabled: created.body.systemRatesEnabled,
      shareCapitalAuthorisedShares: 10,
      shareCapitalParValue: 100,
      shareholders: [{ name: "Legacy Owner", nationality: null, numberOfShares: 10 }],
    }),
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  const journals = await request<JournalEntry[]>(`/agaraccounting/journal-entries?clientId=${legacyCapitalClientId}`);
  const systemJournal = journals.body.find((entry) => entry.id === saved.body.shareCapitalJournalId);
  assert.equal(systemJournal?.lines[1]?.account, LEGACY_SHARE_CAPITAL_ACCOUNT_NAME);
});

test("rejects unauthorized register saves and keeps clients isolated", async () => {
  const created = await request<ClientBody>("/clients", {
    method: "POST",
    body: JSON.stringify({
      name: `Isolated share capital ${randomUUID()}`,
      legalName: "Isolated Share Capital LLC",
      functionalCurrency: "AED",
      basis: "IFRS",
      period: "August 2026",
    }),
  }, secondaryUserId);
  assert.equal(created.response.status, 201);
  isolatedClientId = created.body.id;

  const update = {
    name: created.body.name,
    legalName: created.body.legalName,
    functionalCurrency: created.body.functionalCurrency,
    basis: created.body.basis,
    period: created.body.period,
    systemRatesEnabled: created.body.systemRatesEnabled,
    shareCapitalAuthorisedShares: 10,
    shareCapitalParValue: 25,
    shareholders: [{ name: "Isolated Owner", nationality: null, numberOfShares: 10 }],
  };
  const forbidden = await request<{ error: string }>(`/clients/${isolatedClientId}`, {
    method: "PATCH",
    body: JSON.stringify(update),
  });
  assert.equal(forbidden.response.status, 403);

  const saved = await request<ClientBody>(`/clients/${isolatedClientId}`, {
    method: "PATCH",
    body: JSON.stringify(update),
  }, secondaryUserId);
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.shareCapitalJournalId !== null, true);

  const [primaryClients, secondaryClients] = await Promise.all([
    request<ClientBody[]>("/clients"),
    request<ClientBody[]>("/clients", undefined, secondaryUserId),
  ]);
  assert.equal(primaryClients.body.some((candidate) => candidate.id === isolatedClientId), false);
  assert.equal(secondaryClients.body.some((candidate) => candidate.id === isolatedClientId), true);
});