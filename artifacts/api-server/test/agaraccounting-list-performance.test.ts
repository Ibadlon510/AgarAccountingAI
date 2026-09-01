import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";

let server: Server | undefined;
let baseUrl = "";
let database: typeof import("@workspace/db");
const ownerId = `list-perf-owner-${randomUUID()}`;
let clientId = 0;
const tag = randomUUID();

function testDatabaseUrl() {
  const value = process.env.AGARACCOUNTING_TEST_DATABASE_URL;
  if (!value) throw new Error("AGARACCOUNTING_TEST_DATABASE_URL is required.");
  const databaseName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) throw new Error("The database name must contain test.");
  return value;
}

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-test-user-id": ownerId, ...init?.headers },
  });
  return { response, body: await response.json() as T };
}

type Line = {
  id: number;
  description: string;
  currency: string;
  date: string;
  journalEntryId?: number | null;
};

type Journal = {
  id: number;
  memo: string;
  currency: string;
  statementLineId: number | null;
};

async function createLine(description: string, date: string, currency: string, amount = 100, bankAccountId?: number) {
  const result = await request<Line>("/agaraccounting/statement-lines", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date,
      description,
      currency,
      amount,
      direction: "outflow",
      bankAccountId,
    }),
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  return result.body;
}

before(async () => {
  process.env.DATABASE_URL = testDatabaseUrl();
  const { createApp } = await import("../src/app");
  const { createRequireAuth } = await import("../src/middlewares/authMiddleware");
  database = await import("@workspace/db");
  await database.db.insert(database.usersTable).values({
    id: ownerId,
    email: `${ownerId}@example.test`,
  });
  const app = createApp({
    clerkAuthMiddleware: (_req, _res, next) => next(),
    requireAuthMiddleware: createRequireAuth((req) => ({ sessionClaims: { userId: req.headers["x-test-user-id"] } })),
  });
  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, () => resolve(listener));
    listener.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}/api`;
  const created = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({ name: `List perf ${tag}`, legalName: `List perf ${tag} LLC` }),
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  clientId = created.body.id;
  await createLine(`${tag} alpha coffee`, "2026-01-10", "AED", 10);
  await createLine(`${tag} beta rent`, "2026-02-10", "AED", 20);
  await createLine(`${tag} gamma payroll`, "2026-03-10", "USD", 30);
});

test("pages a combined bank register in one server-ordered result", async () => {
  const combinedTag = randomUUID();
  const firstAccount = await request<{ id: number }>("/agaraccounting/bank-accounts", {
    method: "POST",
    body: JSON.stringify({ clientId, name: "Combined operating", bankName: "Combined Bank", currency: "AED" }),
  });
  const secondAccount = await request<{ id: number }>("/agaraccounting/bank-accounts", {
    method: "POST",
    body: JSON.stringify({ clientId, name: "Combined savings", bankName: "Combined Bank", currency: "AED" }),
  });
  assert.equal(firstAccount.response.status, 201);
  assert.equal(secondAccount.response.status, 201);

  await createLine(`${combinedTag} middle`, "2026-05-02", "AED", 20, firstAccount.body.id);
  await createLine(`${combinedTag} first`, "2026-05-01", "AED", 10, secondAccount.body.id);
  await createLine(`${combinedTag} last`, "2026-05-03", "AED", 30, secondAccount.body.id);
  const bankAccountIds = `${firstAccount.body.id},${secondAccount.body.id}`;

  const summary = await request<{ totalCount: number }>(
    `/agaraccounting/statement-lines/summary?clientId=${clientId}&bankAccountIds=${bankAccountIds}`,
  );
  assert.equal(summary.response.status, 200);
  assert.equal(summary.body.totalCount, 3);

  const firstPage = await request<Line[]>(
    `/agaraccounting/statement-lines?clientId=${clientId}&bankAccountIds=${bankAccountIds}&sort=date&sortDirection=asc&limit=2&offset=0`,
  );
  assert.equal(firstPage.response.status, 200);
  assert.deepEqual(firstPage.body.map((line) => line.description), [
    `${combinedTag} first`,
    `${combinedTag} middle`,
  ]);

  const secondPage = await request<Line[]>(
    `/agaraccounting/statement-lines?clientId=${clientId}&bankAccountIds=${bankAccountIds}&sort=date&sortDirection=asc&limit=2&offset=2`,
  );
  assert.equal(secondPage.response.status, 200);
  assert.deepEqual(secondPage.body.map((line) => line.description), [`${combinedTag} last`]);
});

after(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  await database.pool.end();
});

test("paginates statement lines and keeps the unbounded list compatible", async () => {
  const all = await request<Line[]>(`/agaraccounting/statement-lines?clientId=${clientId}&search=${encodeURIComponent(tag)}`);
  assert.equal(all.response.status, 200);
  assert.equal(all.body.length, 3);
  assert.ok(all.body.every((line) => line.journalEntryId != null));

  const page = await request<Line[]>(`/agaraccounting/statement-lines?clientId=${clientId}&search=${encodeURIComponent(tag)}&sort=date&sortDirection=asc&limit=2&offset=0`);
  assert.equal(page.response.status, 200);
  assert.equal(page.body.length, 2);
  assert.deepEqual(page.body.map((line) => line.description), [`${tag} alpha coffee`, `${tag} beta rent`]);

  const next = await request<Line[]>(`/agaraccounting/statement-lines?clientId=${clientId}&search=${encodeURIComponent(tag)}&sort=date&sortDirection=asc&limit=2&offset=2`);
  assert.equal(next.response.status, 200);
  assert.equal(next.body.length, 1);
  assert.equal(next.body[0]?.description, `${tag} gamma payroll`);

  const searched = await request<Line[]>(`/agaraccounting/statement-lines?clientId=${clientId}&search=${encodeURIComponent(`${tag} alpha coffee`)}`);
  assert.equal(searched.response.status, 200);
  assert.equal(searched.body.length, 1);
  assert.equal(searched.body[0]?.description, `${tag} alpha coffee`);

  const ranged = await request<Line[]>(`/agaraccounting/statement-lines?clientId=${clientId}&search=${encodeURIComponent(tag)}&dateFrom=2026-02-01&dateTo=2026-02-28`);
  assert.equal(ranged.response.status, 200);
  assert.equal(ranged.body.length, 1);
  assert.equal(ranged.body[0]?.description, `${tag} beta rent`);

  const rejected = await request<{ error: string }>(`/agaraccounting/statement-lines?clientId=${clientId}&limit=201`);
  assert.equal(rejected.response.status, 400);
});

test("summarizes statement lines without returning row payloads", async () => {
  const summary = await request<{
    totalCount: number;
    currencies: string[];
    unassignedCount: number;
    bankAccounts: unknown[];
  }>(`/agaraccounting/statement-lines/summary?clientId=${clientId}&search=${encodeURIComponent(tag)}`);
  assert.equal(summary.response.status, 200);
  assert.equal(summary.body.totalCount, 3);
  assert.deepEqual(summary.body.currencies, ["AED", "USD"]);
  assert.equal(summary.body.unassignedCount, 3);
  assert.deepEqual(summary.body.bankAccounts, []);

  const catalog = await request<{ totalCount: number; currencies: string[] }>(
    `/agaraccounting/statement-lines/summary?clientId=${clientId}`,
  );
  assert.equal(catalog.response.status, 200);
  assert.ok(catalog.body.totalCount >= 3);
  assert.ok(catalog.body.currencies.includes("AED"));
  assert.ok(catalog.body.currencies.includes("USD"));
});

test("paginates journal entries and summarizes currencies", async () => {
  const all = await request<Journal[]>(`/agaraccounting/journal-entries?clientId=${clientId}&search=${encodeURIComponent(tag)}`);
  assert.equal(all.response.status, 200);
  assert.ok(all.body.length >= 3);

  const page = await request<Journal[]>(`/agaraccounting/journal-entries?clientId=${clientId}&search=${encodeURIComponent(tag)}&sort=date&sortDirection=asc&limit=2&offset=0`);
  assert.equal(page.response.status, 200);
  assert.equal(page.body.length, 2);

  const summary = await request<{ totalCount: number; currencies: string[] }>(
    `/agaraccounting/journal-entries/summary?clientId=${clientId}&search=${encodeURIComponent(tag)}`,
  );
  assert.equal(summary.response.status, 200);
  assert.equal(summary.body.totalCount, all.body.length);
  assert.ok(summary.body.currencies.includes("AED"));
  assert.ok(summary.body.currencies.includes("USD"));
});

test("overview uses SQL aggregates and reports journalCount", async () => {
  const journals = await request<Journal[]>(`/agaraccounting/journal-entries?clientId=${clientId}`);
  assert.equal(journals.response.status, 200);
  const overview = await request<{
    totalLines: number;
    journalCount: number;
    currencies: string[];
    pendingReview: number;
  }>(`/agaraccounting/overview?clientId=${clientId}`);
  assert.equal(overview.response.status, 200);
  assert.ok(overview.body.totalLines >= 3);
  assert.equal(overview.body.journalCount, journals.body.length);
  assert.ok(overview.body.currencies.includes("AED"));
  assert.ok(overview.body.currencies.includes("USD"));
  assert.ok(overview.body.pendingReview >= 3);
});
