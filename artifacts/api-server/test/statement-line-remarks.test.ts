import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { eq, sql } from "drizzle-orm";

let server: Server | undefined;
let baseUrl = "";
let database: typeof import("@workspace/db");
const ownerId = `remarks-owner-${randomUUID()}`;
let clientId = 0;

function testDatabaseUrl() {
  const value = process.env.AGARACCOUNTING_TEST_DATABASE_URL;
  if (!value) throw new Error("AGARACCOUNTING_TEST_DATABASE_URL is required.");
  const databaseName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) throw new Error("The database name must contain test.");
  return value;
}

async function request<T>(path: string, init?: RequestInit, userId: string | null = ownerId) {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has("content-type") && init?.body) {
    headers.set("content-type", "application/json");
  }
  if (userId) headers.set("x-test-user-id", userId);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await response.text();
  let body: T | null = null;
  if (text) {
    try { body = JSON.parse(text) as T; } catch { body = text as T; }
  }
  return { response, body };
}

type Line = {
  id: number;
  status: string;
  description: string;
  noteSummary?: { hasNote: boolean; attachmentCount: number; latestNotePreview?: string | null };
  pendingClarification?: { requestId: number; recipientEmail: string } | null;
};

type DetailRequest = {
  id: number;
  recipientEmail: string;
  expiresAt: string;
  sentAt: string;
  revokedAt?: string | null;
  status?: "active" | "inactive";
  publicUrl?: string;
  remarkCount?: number;
  lines?: Array<{ id: number; status: "open" | "posted"; remarkCount: number }>;
};
type PublicRequest = {
  clientDisplayName: string;
  senderMessage: string | null;
  lines: Array<{
    id: number;
    posted: boolean;
    status: "open" | "posted";
    notes: Array<{ id: number; noteText: string; attachments: Array<{ id: number; filename?: string }> }>;
  }>;
};

async function createLine(description: string): Promise<Line> {
  const result = await request<Line>("/agaraccounting/statement-lines", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-09-15",
      description,
      currency: "AED",
      amount: 100,
      direction: "outflow",
    }),
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  return result.body!;
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.LOCAL_OBJECT_STORAGE = "1";
  process.env.AGARACCOUNTING_EMAIL_TEST_MODE = "success";
  process.env.PUBLIC_APP_URL = "http://127.0.0.1:4173";
  process.env.RESEND_FROM_EMAIL = "AgarAccounting <invitations@agaraccounting.test>";
  const { createApp } = await import("../src/app");
  const { createRequireAuth, createOptionalAuth } = await import("../src/middlewares/authMiddleware");
  database = await import("@workspace/db");
  await database.db.insert(database.usersTable).values({
    id: ownerId,
    email: `${ownerId}@example.test`,
  }).onConflictDoNothing();
  const readAuth = (req: { headers: Record<string, unknown> }) => ({
    sessionClaims: { userId: req.headers["x-test-user-id"] },
  });
  const app = createApp({
    clerkAuthMiddleware: (_req, _res, next) => next(),
    requireAuthMiddleware: createRequireAuth(readAuth as never),
    optionalAuthMiddleware: createOptionalAuth(readAuth as never),
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
    body: JSON.stringify({ name: `Remarks ${randomUUID()}`, legalName: `Remarks ${randomUUID()} LLC` }),
  });
  assert.equal(created.response.status, 201);
  clientId = created.body!.id;
});

after(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  await database.pool.end();
});

test("emails a public remarks link for selected draft lines", async () => {
  const first = await createLine(`Remarks alpha ${randomUUID()}`);
  const second = await createLine(`Remarks beta ${randomUUID()}`);
  const sent = await request<DetailRequest>("/agaraccounting/statement-lines/request-details", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      statementLineIds: [first.id, second.id],
      recipientEmail: "owner@client.test",
      senderMessage: "Please confirm these payments.",
    }),
  });
  assert.equal(sent.response.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body?.recipientEmail, "owner@client.test");
  assert.equal(sent.body?.status, "active");
  assert.ok(sent.body?.publicUrl?.includes("/detail-request/"));
  const ttlMs = new Date(sent.body!.expiresAt).getTime() - new Date(sent.body!.sentAt).getTime();
  assert.ok(ttlMs > 2.5 * 24 * 60 * 60 * 1000 && ttlMs < 3.5 * 24 * 60 * 60 * 1000);

  const listed = await request<Line[]>(`/agaraccounting/statement-lines?clientId=${clientId}`);
  const pending = listed.body?.filter((line) => line.id === first.id || line.id === second.id) ?? [];
  assert.equal(pending.length, 2);
  assert.ok(pending.every((line) => line.pendingClarification?.recipientEmail === "owner@client.test"));

  const [requestRow] = await database.db.select().from(database.statementLineDetailRequestsTable)
    .where(eq(database.statementLineDetailRequestsTable.id, sent.body!.id));
  assert.ok(requestRow?.token);
  assert.equal(sent.body?.publicUrl, `http://127.0.0.1:4173/detail-request/${requestRow.token}`);

  const publicPage = await request<PublicRequest>(`/public/statement-line-requests/${requestRow.token}`, undefined, null);
  assert.equal(publicPage.response.status, 200, JSON.stringify(publicPage.body));
  assert.equal(publicPage.body?.lines.length, 2);
  assert.equal(publicPage.body?.senderMessage, "Please confirm these payments.");
});

test("public submit stores a note without creating workspace membership", async () => {
  const line = await createLine(`Remarks note ${randomUUID()}`);
  const sent = await request<DetailRequest>("/agaraccounting/statement-lines/request-details", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      statementLineIds: [line.id],
      recipientEmail: "external-owner@example.test",
    }),
  });
  assert.equal(sent.response.status, 201);
  const [requestRow] = await database.db.select().from(database.statementLineDetailRequestsTable)
    .where(eq(database.statementLineDetailRequestsTable.id, sent.body!.id));
  const membershipsBefore = await database.db.select({ count: sql<number>`count(*)::int` })
    .from(database.clientWorkspacesTable);
  const usersBefore = await database.db.select({ count: sql<number>`count(*)::int` })
    .from(database.usersTable);

  const form = new FormData();
  form.set("noteText", "This was office rent for September.");
  const png = new Blob([Buffer.from("89504e470d0a1a0a", "hex")], { type: "image/png" });
  form.append("files", png, "receipt.png");
  const submitted = await request<PublicRequest["lines"][number]>(
    `/public/statement-line-requests/${requestRow.token}/lines/${line.id}`,
    { method: "POST", body: form },
    null,
  );
  assert.equal(submitted.response.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body?.notes[0]?.noteText, "This was office rent for September.");
  assert.equal(submitted.body?.notes[0]?.attachments[0]?.filename, "receipt.png");

  const membershipsAfter = await database.db.select({ count: sql<number>`count(*)::int` })
    .from(database.clientWorkspacesTable);
  const usersAfter = await database.db.select({ count: sql<number>`count(*)::int` })
    .from(database.usersTable);
  assert.equal(Number(membershipsAfter[0]?.count), Number(membershipsBefore[0]?.count));
  assert.equal(Number(usersAfter[0]?.count), Number(usersBefore[0]?.count));

  const listed = await request<Line[]>(`/agaraccounting/statement-lines?clientId=${clientId}`);
  const updated = listed.body?.find((item) => item.id === line.id);
  assert.equal(updated?.noteSummary?.hasNote, true);
  assert.equal(updated?.pendingClarification, null);

  const notes = await request<{ notes: Array<{ noteText: string }> }>(
    `/agaraccounting/statement-lines/${line.id}/notes?clientId=${clientId}`,
  );
  assert.equal(notes.response.status, 200);
  assert.equal(notes.body?.notes[0]?.noteText, "This was office rent for September.");
});

test("rejects public access to a line outside the batch and expired tokens", async () => {
  const included = await createLine(`Remarks included ${randomUUID()}`);
  const outsider = await createLine(`Remarks outsider ${randomUUID()}`);
  const sent = await request<DetailRequest>("/agaraccounting/statement-lines/request-details", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      statementLineIds: [included.id],
      recipientEmail: "scope@example.test",
    }),
  });
  const [requestRow] = await database.db.select().from(database.statementLineDetailRequestsTable)
    .where(eq(database.statementLineDetailRequestsTable.id, sent.body!.id));
  const form = new FormData();
  form.set("noteText", "Should not apply to another line.");
  const outside = await request<{ error: string }>(
    `/public/statement-line-requests/${requestRow.token}/lines/${outsider.id}`,
    { method: "POST", body: form },
    null,
  );
  assert.equal(outside.response.status, 404);

  await database.db.update(database.statementLineDetailRequestsTable)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(database.statementLineDetailRequestsTable.id, requestRow.id));
  const expired = await request<{ error: string }>(`/public/statement-line-requests/${requestRow.token}`, undefined, null);
  assert.equal(expired.response.status, 410);
  assert.equal(expired.body?.error, "This remarks link has expired.");
  assert.equal(expired.body && "lines" in expired.body, false);
});

test("rejects remarks on posted lines and too many attachments", async () => {
  const line = await createLine(`Remarks posted ${randomUUID()}`);
  const sent = await request<DetailRequest>("/agaraccounting/statement-lines/request-details", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      statementLineIds: [line.id],
      recipientEmail: "posted@example.test",
    }),
  });
  await database.db.update(database.statementLinesTable)
    .set({ status: "posted" })
    .where(eq(database.statementLinesTable.id, line.id));

  const [requestRow] = await database.db.select().from(database.statementLineDetailRequestsTable)
    .where(eq(database.statementLineDetailRequestsTable.id, sent.body!.id));
  const publicPage = await request<PublicRequest>(`/public/statement-line-requests/${requestRow.token}`, undefined, null);
  assert.equal(publicPage.body?.lines[0]?.posted, true);
  assert.equal(publicPage.body?.lines[0]?.status, "posted");

  const form = new FormData();
  form.set("noteText", "Too late.");
  const conflict = await request<{ error: string }>(
    `/public/statement-line-requests/${requestRow.token}/lines/${line.id}`,
    { method: "POST", body: form },
    null,
  );
  assert.equal(conflict.response.status, 409);

  const openLine = await createLine(`Remarks files ${randomUUID()}`);
  const openSent = await request<DetailRequest>("/agaraccounting/statement-lines/request-details", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      statementLineIds: [openLine.id],
      recipientEmail: "files@example.test",
    }),
  });
  const [openRequest] = await database.db.select().from(database.statementLineDetailRequestsTable)
    .where(eq(database.statementLineDetailRequestsTable.id, openSent.body!.id));
  const tooMany = new FormData();
  tooMany.set("noteText", "Too many files.");
  for (let index = 0; index < 6; index += 1) {
    tooMany.append("files", new Blob([Buffer.from("89504e470d0a1a0a", "hex")], { type: "image/png" }), `file-${index}.png`);
  }
  const capped = await request<{ error: string }>(
    `/public/statement-line-requests/${openRequest.token}/lines/${openLine.id}`,
    { method: "POST", body: tooMany },
    null,
  );
  assert.equal(capped.response.status, 400);
});

test("internal notes require authentication even when a public token is known", async () => {
  const line = await createLine(`Remarks auth ${randomUUID()}`);
  const unauthenticated = await request(
    `/agaraccounting/statement-lines/${line.id}/notes?clientId=${clientId}`,
    undefined,
    null,
  );
  assert.equal(unauthenticated.response.status, 401);
});

test("stores each public remark separately, lists active/inactive links, and returns 410 after revoke", async () => {
  const line = await createLine(`Remarks upsert ${randomUUID()}`);
  const sent = await request<DetailRequest>("/agaraccounting/statement-lines/request-details", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      statementLineIds: [line.id],
      recipientEmail: "upsert@example.test",
    }),
  });
  assert.equal(sent.response.status, 201);
  const [requestRow] = await database.db.select().from(database.statementLineDetailRequestsTable)
    .where(eq(database.statementLineDetailRequestsTable.id, sent.body!.id));

  const listed = await request<DetailRequest[]>(`/agaraccounting/statement-lines/detail-requests?clientId=${clientId}`);
  assert.equal(listed.response.status, 200);
  const listedRow = listed.body?.find((item) => item.id === sent.body!.id);
  assert.equal(listedRow?.status, "active");
  assert.equal(listedRow?.lines?.[0]?.status, "open");

  const first = new FormData();
  first.set("noteText", "First remark.");
  const created = await request<PublicRequest["lines"][number]>(
    `/public/statement-line-requests/${requestRow.token}/lines/${line.id}`,
    { method: "POST", body: first },
    ownerId,
  );
  assert.equal(created.response.status, 200, JSON.stringify(created.body));
  assert.equal(created.body?.notes.length, 1);
  assert.equal(created.body?.notes[0]?.noteText, "First remark.");

  const second = new FormData();
  second.set("noteText", "Second remark.");
  const updated = await request<PublicRequest["lines"][number]>(
    `/public/statement-line-requests/${requestRow.token}/lines/${line.id}`,
    { method: "POST", body: second },
    ownerId,
  );
  assert.equal(updated.response.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body?.notes.length, 2);
  assert.equal(updated.body?.notes[1]?.noteText, "Second remark.");

  const notes = await database.db.select().from(database.statementLineNotesTable)
    .where(eq(database.statementLineNotesTable.statementLineId, line.id));
  assert.equal(notes.length, 2);

  const users = await database.db.select({ id: database.usersTable.id })
    .from(database.usersTable)
    .where(eq(database.usersTable.email, "upsert@example.test"));
  assert.equal(users.length, 0);

  const revoked = await request<DetailRequest>(
    `/agaraccounting/statement-lines/detail-requests/${sent.body!.id}/revoke`,
    { method: "POST", body: JSON.stringify({ clientId }) },
  );
  assert.equal(revoked.response.status, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body?.status, "inactive");
  assert.ok(revoked.body?.revokedAt);

  const gone = await request<{ error: string }>(`/public/statement-line-requests/${requestRow.token}`, undefined, null);
  assert.equal(gone.response.status, 410);
  assert.equal(gone.body?.error, "This remarks link has been deactivated.");
  assert.equal(gone.body && "lines" in gone.body, false);

  const late = new FormData();
  late.set("noteText", "After revoke.");
  const rejected = await request<{ error: string }>(
    `/public/statement-line-requests/${requestRow.token}/lines/${line.id}`,
    { method: "POST", body: late },
    null,
  );
  assert.equal(rejected.response.status, 410);
});

test("preserves a configured app base path on remarks links", async () => {
  const previous = process.env.PUBLIC_APP_URL;
  process.env.PUBLIC_APP_URL = "https://example.test/agaraccounting/";
  try {
    const { publicDetailRequestLink } = await import("../src/lib/statementLineRemarks");
    assert.equal(
      publicDetailRequestLink("abcToken"),
      "https://example.test/agaraccounting/detail-request/abcToken",
    );
  } finally {
    process.env.PUBLIC_APP_URL = previous;
  }
});
