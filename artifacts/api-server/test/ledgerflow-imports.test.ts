import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { inArray } from "drizzle-orm";

type ImportResult = {
  fileName: string;
  importStatus: "imported" | "imported_with_duplicates" | "duplicates_found" | "duplicate_file";
  message?: string;
  importedCount: number;
  duplicateCount: number;
  duplicateLines: Array<{
    date: string;
    description: string;
    currency: string;
    amount: number;
    direction: string;
    existingLineId: number | null;
    reason: "already_imported" | "duplicate_in_file";
  }>;
  lines: Array<{ id: number; bankAccountId: number | null }>;
  bankAccount?: {
    id: number;
    clientId: number;
    name: string;
    bankName: string | null;
    accountNumberLast4: string | null;
    currency: string;
  } | null;
};

type StatementLine = {
  id: number;
  clientId: number;
  bankAccountId: number | null;
  description: string;
};

type OpenAIRequest = {
  messages?: Array<{ role?: string; content?: string }>;
};

let server: Server | undefined;
let aiServer: Server | undefined;
let baseUrl: string;
let app: typeof import("../src/app").default;
let database: typeof import("@workspace/db") | undefined;

const createdClientIds: number[] = [];
const createdUserIds: string[] = [];
const aiRequests: Array<{ path: string; credential: string | undefined }> = [];
let primaryUserId: string;
let secondaryUserId: string;

function testDatabaseUrl() {
  const value = process.env.LEDGERFLOW_TEST_DATABASE_URL;
  if (!value) throw new Error("LEDGERFLOW_TEST_DATABASE_URL is required for LedgerFlow integration tests.");

  const databaseName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) {
    throw new Error("The LedgerFlow integration test database name must contain 'test'.");
  }
  return value;
}

function openAIResult(marker: string) {
  if (marker.includes("bank-alpha")) {
    return {
      bankAccount: { name: "Operating account", bankName: "Alpha Bank", accountNumberLast4: "1234", currency: "AED" },
      lines: [{ date: "2026-08-24", description: "Alpha supplier payment", amount: 100, direction: "outflow", currency: "AED" }],
    };
  }
  if (marker.includes("bank-beta")) {
    return {
      bankAccount: { name: "Operating account", bankName: "Beta Bank", accountNumberLast4: "1234", currency: "AED" },
      lines: [{ date: "2026-08-25", description: "Beta supplier payment", amount: 200, direction: "outflow", currency: "AED" }],
    };
  }
  if (marker.includes("concurrent")) {
    return {
      bankAccount: null,
      lines: [{ date: "2026-08-26", description: "Concurrent supplier payment", amount: 300, direction: "outflow", currency: "AED" }],
    };
  }
  if (marker.includes("client-isolation")) {
    return {
      bankAccount: null,
      lines: [{ date: "2026-08-27", description: "Client isolation payment", amount: 400, direction: "outflow", currency: "AED" }],
    };
  }
  return {
    bankAccount: null,
    lines: [{ date: "2026-08-28", description: "Changed statement payment", amount: 500, direction: "outflow", currency: "AED" }],
  };
}

async function listen(serverToStart: Server) {
  await new Promise<void>((resolve, reject) => {
    serverToStart.listen(0, "127.0.0.1", () => resolve());
    serverToStart.once("error", reject);
  });
  const address = serverToStart.address();
  assert.ok(address && typeof address !== "string");
  return (address as AddressInfo).port;
}

before(async () => {
  process.env.DATABASE_URL = testDatabaseUrl();
  aiServer = (await import("node:http")).createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 404;
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const request = JSON.parse(Buffer.concat(chunks).toString("utf8")) as OpenAIRequest;
    const userMessage = request.messages?.find((message) => message.role === "user")?.content ?? "";
    const credential = req.headers["x-api-key"] ?? req.headers.authorization?.replace(/^Bearer\s+/i, "");
    aiRequests.push({ path: req.url ?? "", credential: Array.isArray(credential) ? credential[0] : credential });
    if (credential === "invalid-key") {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { message: "invalid key" } }));
      return;
    }
    if (req.url?.startsWith("/v1/messages")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(openAIResult(userMessage)) }] }));
      return;
    }
    const responseBody = {
      choices: [{ message: { content: JSON.stringify(openAIResult(userMessage)) } }],
    };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(responseBody));
  });
  const aiPort = await listen(aiServer);
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "ledgerflow-test-openai-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = `http://127.0.0.1:${aiPort}/v1`;
  process.env.LEDGERFLOW_OPENAI_BASE_URL = `http://127.0.0.1:${aiPort}/v1`;
  process.env.LEDGERFLOW_ANTHROPIC_BASE_URL = `http://127.0.0.1:${aiPort}`;

  const { createApp } = await import("../src/app");
  const { createRequireAuth } = await import("../src/middlewares/authMiddleware");
  app = createApp({
    clerkAuthMiddleware: (_req, _res, next) => next(),
    requireAuthMiddleware: createRequireAuth(
      (req) => {
        const legacyUserId = req.headers["x-test-user-id"];
        return {
          // Migrated users retain their former local subject for memberships,
          // while Clerk's API must receive the distinct native Clerk ID.
          userId: typeof legacyUserId === "string" ? `clerk-${legacyUserId}` : undefined,
          sessionClaims: { userId: legacyUserId },
        };
      },
      async (clerkUserId) => {
        const legacyUserId = clerkUserId.replace(/^clerk-/, "");
        return {
          email: `${legacyUserId}@example.test`,
          firstName: legacyUserId === primaryUserId ? "Primary" : "Secondary",
          lastName: "Test",
        };
      },
    ),
  });
  database = await import("@workspace/db");
  primaryUserId = `ledgerflow-import-primary-${randomUUID()}`;
  secondaryUserId = `ledgerflow-import-secondary-${randomUUID()}`;
  await database.db.insert(database.usersTable).values([
    { id: primaryUserId, email: `${primaryUserId}@example.test`, firstName: "Primary", lastName: "Test" },
    { id: secondaryUserId, email: `${secondaryUserId}@example.test`, firstName: "Secondary", lastName: "Test" },
  ]);
  createdUserIds.push(primaryUserId, secondaryUserId);
  const workspaces = await database.db.insert(database.clientsTable).values([
    { name: `Primary test workspace ${primaryUserId}`, legalName: "Primary Test LLC", functionalCurrency: "AED", basis: "IFRS", period: "August 2026" },
    { name: `Secondary test workspace ${secondaryUserId}`, legalName: "Secondary Test LLC", functionalCurrency: "AED", basis: "IFRS", period: "August 2026" },
  ]).returning();
  createdClientIds.push(...workspaces.map((workspace) => workspace.id));
  await database.db.insert(database.clientWorkspacesTable).values([
    { clientId: workspaces[0].id, userId: primaryUserId, role: "admin" },
    { clientId: workspaces[1].id, userId: secondaryUserId, role: "admin" },
  ]);
  server = (await import("node:http")).createServer(app);
  const port = await listen(server);
  baseUrl = `http://127.0.0.1:${port}/api`;
});

after(async () => {
  const activeDatabase = database;
  const activeServer = server;
  const activeAIServer = aiServer;
  try {
    if (activeDatabase && createdClientIds.length) {
      await activeDatabase.db.delete(activeDatabase.aiProviderConfigsTable)
        .where(inArray(activeDatabase.aiProviderConfigsTable.clientId, createdClientIds));
      await activeDatabase.db.delete(activeDatabase.journalEntriesTable)
        .where(inArray(activeDatabase.journalEntriesTable.clientId, createdClientIds));
      await activeDatabase.db.delete(activeDatabase.statementLinesTable)
        .where(inArray(activeDatabase.statementLinesTable.clientId, createdClientIds));
      await activeDatabase.db.delete(activeDatabase.statementImportsTable)
        .where(inArray(activeDatabase.statementImportsTable.clientId, createdClientIds));
      await activeDatabase.db.delete(activeDatabase.bankAccountsTable)
        .where(inArray(activeDatabase.bankAccountsTable.clientId, createdClientIds));
      await activeDatabase.db.delete(activeDatabase.clientWorkspacesTable)
        .where(inArray(activeDatabase.clientWorkspacesTable.clientId, createdClientIds));
      await activeDatabase.db.delete(activeDatabase.clientsTable)
        .where(inArray(activeDatabase.clientsTable.id, createdClientIds));
    }
    if (activeDatabase && createdUserIds.length) {
      await activeDatabase.db.delete(activeDatabase.workspaceInvitationsTable)
        .where(inArray(activeDatabase.workspaceInvitationsTable.invitedByUserId, createdUserIds));
      await activeDatabase.db.delete(activeDatabase.usersTable)
        .where(inArray(activeDatabase.usersTable.id, createdUserIds));
    }
  } finally {
    const closeOperations: Promise<unknown>[] = [];
    for (const activeServerToClose of [activeServer, activeAIServer]) {
      if (activeServerToClose) {
        closeOperations.push(new Promise<void>((resolve, reject) => {
          activeServerToClose.close((error) => (error ? reject(error) : resolve()));
        }));
      }
    }
    if (activeDatabase) closeOperations.push(activeDatabase.pool.end());
    const failures = (await Promise.allSettled(closeOperations))
      .find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures) throw failures.reason;
  }
});

async function request<T>(path: string, init?: RequestInit, userId = primaryUserId) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-test-user-id": userId, ...(init?.headers ?? {}) },
  });
  const body = (await response.json()) as T;
  return { response, body };
}

async function createClient(name: string, userId = primaryUserId) {
  const result = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({ name, legalName: `${name} LLC` }),
  }, userId);
  assert.equal(result.response.status, 201);
  createdClientIds.push(result.body.id);
  return result.body.id;
}

function importBody(clientId: number, fileName: string, marker: string, contentSuffix = "") {
  const csv = `marker,description,amount\n${marker},statement line,100${contentSuffix}`;
  return JSON.stringify({
    clientId,
    fileName,
    mimeType: "text/csv",
    contentBase64: Buffer.from(csv).toString("base64"),
    currency: "AED",
  });
}

async function importStatement(clientId: number, fileName: string, marker: string, contentSuffix = "", userId = primaryUserId) {
  return request<ImportResult>("/ledgerflow/import-statement", {
    method: "POST",
    body: importBody(clientId, fileName, marker, contentSuffix),
  }, userId);
}

async function statementLines(clientId: number, userId = primaryUserId) {
  const result = await request<StatementLine[]>(`/ledgerflow/statement-lines?clientId=${clientId}`, undefined, userId);
  assert.equal(result.response.status, 200);
  return result.body.filter((line) => line.description !== "EMIRATES AIRLINES"
    && line.description !== "STRIPE PAYOUT 8472"
    && line.description !== "AWS EMEA"
    && line.description !== "AL FARAJ OFFICE SUPPLIES"
    && line.description !== "CLIENT RETAINER — NORTHSTAR"
    && line.description !== "GULF TELECOM");
}

test("reports an exact file re-upload without adding review lines", async () => {
  const clientId = await createClient(`Bank identity ${randomUUID()}`);
  const first = await importStatement(clientId, "changed-original.csv", "changed-key");
  assert.equal(first.response.status, 201);
  assert.equal(first.body.importedCount, 1);

  const duplicate = await importStatement(clientId, "changed-original.csv", "changed-key");
  assert.equal(first.body.importStatus, "imported");
  assert.equal(duplicate.response.status, 201);
  assert.equal(duplicate.body.importStatus, "duplicates_found");
  assert.equal(duplicate.body.duplicateCount, 1);
  assert.equal(duplicate.body.duplicateLines[0]?.reason, "already_imported");
  assert.equal(duplicate.body.duplicateLines[0]?.existingLineId, first.body.lines[0]?.id);
  assert.equal((await statementLines(clientId)).length, 1);
});

test("handles concurrent duplicate statement imports once", async () => {
  const clientId = await createClient(`Bank identity ${randomUUID()}`);
  const results = await Promise.all([
    importStatement(clientId, "concurrent-a.csv", "concurrent", " A"),
    importStatement(clientId, "concurrent-b.csv", "concurrent", " B"),
  ]);

  assert.deepEqual(results.map(({ response }) => response.status).sort((a, b) => a - b), [201, 201]);
  assert.deepEqual(results.map(({ body }) => body.importedCount).sort((a, b) => a - b), [0, 1]);
  const imported = results.find(({ body }) => body.importedCount === 1);
  const duplicate = results.find(({ body }) => body.importedCount === 0);
  assert.ok(imported);
  assert.equal(imported.body.importStatus, "imported");
  assert.ok(duplicate);
  assert.equal(duplicate.body.importStatus, "duplicates_found");
  assert.equal(duplicate.body.duplicateCount, 1);
  assert.equal(duplicate.body.duplicateLines[0]?.reason, "already_imported");
  assert.equal(duplicate.body.duplicateLines[0]?.existingLineId, imported.body.lines[0]?.id);
  assert.equal((await statementLines(clientId)).length, 1);
});

test("does not merge bank accounts that share last four digits", async () => {
  const clientId = await createClient(`Bank identity ${randomUUID()}`);
  const alpha = await importStatement(clientId, "bank-alpha.csv", "bank-alpha");
  const beta = await importStatement(clientId, "bank-beta.csv", "bank-beta");
  assert.equal(alpha.response.status, 201);
  assert.equal(beta.response.status, 201);
  assert.equal(alpha.body.bankAccount?.accountNumberLast4, "1234");
  assert.equal(beta.body.bankAccount?.accountNumberLast4, "1234");
  assert.notEqual(alpha.body.bankAccount?.id, beta.body.bankAccount?.id);
  assert.equal(alpha.body.lines[0]?.bankAccountId, alpha.body.bankAccount?.id);
  assert.equal(beta.body.lines[0]?.bankAccountId, beta.body.bankAccount?.id);

  const accounts = await request<Array<{ id: number; bankName: string | null }>>(`/ledgerflow/bank-accounts?clientId=${clientId}`);
  assert.equal(accounts.response.status, 200);
  const importedAccounts = accounts.body.filter((account) => account.bankName === "Alpha Bank" || account.bankName === "Beta Bank");
  assert.equal(importedAccounts.length, 2);
});

test("scopes duplicate detection to the importing client", async () => {
  const primaryClientId = await createClient(`AI provider primary ${randomUUID()}`);
  const secondaryClientId = await createClient(`AI provider secondary ${randomUUID()}`, secondaryUserId);

  const primaryImport = await importStatement(primaryClientId, "client-isolation.csv", "client-isolation");
  assert.equal(primaryImport.response.status, 201);
  assert.equal(primaryImport.body.importStatus, "imported");

  const secondaryImport = await importStatement(
    secondaryClientId,
    "client-isolation.csv",
    "client-isolation",
    "",
    secondaryUserId,
  );
  assert.equal(secondaryImport.response.status, 201);
  assert.equal(secondaryImport.body.importStatus, "imported");
  assert.equal(secondaryImport.body.importedCount, 1);
  assert.equal((await statementLines(primaryClientId)).length, 1);
  assert.equal((await statementLines(secondaryClientId, secondaryUserId)).length, 1);
});

test("keeps workspace AI credentials redacted, isolated, rotatable, and routes extraction through the selected provider", async () => {
  const primaryClientId = await createClient(`AI provider primary ${randomUUID()}`);
  const secondaryClientId = await createClient(`AI provider secondary ${randomUUID()}`, secondaryUserId);

  const defaultSettings = await request<{ provider: string; credentialLast4: string | null }>(
    `/ledgerflow/ai-settings?clientId=${primaryClientId}`,
  );
  assert.equal(defaultSettings.response.status, 200);
  assert.equal(defaultSettings.body.provider, "managed_openai");
  assert.equal(defaultSettings.body.credentialLast4, null);

  const missingKey = await request<{ error: string }>("/ledgerflow/ai-settings", {
    method: "PUT",
    body: JSON.stringify({ clientId: primaryClientId, provider: "anthropic", model: "claude-3-5-sonnet-latest" }),
  });
  assert.equal(missingKey.response.status, 400);
  assert.match(missingKey.body.error, /add an api key/i);

  const saved = await request<Record<string, unknown>>("/ledgerflow/ai-settings", {
    method: "PUT",
    body: JSON.stringify({
      clientId: primaryClientId,
      provider: "anthropic",
      model: "claude-3-5-sonnet-latest",
      apiKey: "anthropic-first-key-1234",
    }),
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.provider, "anthropic");
  assert.equal(saved.body.credentialLast4, "1234");
  assert.equal(JSON.stringify(saved.body).includes("anthropic-first-key-1234"), false);

  const crossWorkspaceRead = await request<{ error: string }>(
    `/ledgerflow/ai-settings?clientId=${secondaryClientId}`,
  );
  assert.equal(crossWorkspaceRead.response.status, 403);

  const rotated = await request<Record<string, unknown>>("/ledgerflow/ai-settings", {
    method: "PUT",
    body: JSON.stringify({
      clientId: primaryClientId,
      provider: "anthropic",
      model: "claude-3-5-sonnet-latest",
      apiKey: "anthropic-rotated-key-5678",
    }),
  });
  assert.equal(rotated.response.status, 200);
  assert.equal(rotated.body.credentialLast4, "5678");

  const tested = await request<{ credentialStatus: string; lastTestedAt: string | null }>("/ledgerflow/ai-settings/test", {
    method: "POST",
    body: JSON.stringify({ clientId: primaryClientId }),
  });
  assert.equal(tested.response.status, 200);
  assert.equal(tested.body.credentialStatus, "configured");
  assert.ok(tested.body.lastTestedAt);

  const routedImport = await importStatement(primaryClientId, "anthropic-provider.csv", "anthropic-provider");
  assert.equal(routedImport.response.status, 201);
  assert.ok(aiRequests.some((item) => item.path === "/v1/messages" && item.credential === "anthropic-rotated-key-5678"));
  const routedChat = await request<{ answer: string }>("/ledgerflow/ai-chat", {
    method: "POST",
    body: JSON.stringify({ clientId: primaryClientId, message: "What should I review first?" }),
  });
  assert.equal(routedChat.response.status, 200);
  assert.ok(routedChat.body.answer.length > 0);
  assert.ok(aiRequests.filter((item) => item.path === "/v1/messages" && item.credential === "anthropic-rotated-key-5678").length >= 2);

  const invalid = await request<Record<string, unknown>>("/ledgerflow/ai-settings", {
    method: "PUT",
    body: JSON.stringify({
      clientId: primaryClientId,
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "invalid-key",
    }),
  });
  assert.equal(invalid.response.status, 200);
  const invalidTest = await request<{ error: string }>("/ledgerflow/ai-settings/test", {
    method: "POST",
    body: JSON.stringify({ clientId: primaryClientId }),
  });
  assert.equal(invalidTest.response.status, 502);
  assert.match(invalidTest.body.error, /credential was rejected/i);

  const removed = await request<{ provider: string; credentialLast4: string | null }>("/ledgerflow/ai-settings/credential", {
    method: "DELETE",
    body: JSON.stringify({ clientId: primaryClientId }),
  });
  assert.equal(removed.response.status, 200);
  assert.equal(removed.body.provider, "managed_openai");
  assert.equal(removed.body.credentialLast4, null);

  const managedImport = await importStatement(primaryClientId, "managed-provider.csv", "managed-provider");
  assert.equal(managedImport.response.status, 201);
  assert.ok(aiRequests.some((item) => item.path === "/v1/chat/completions" && item.credential === "ledgerflow-test-openai-key"));
});

test("invites a bookkeeper with explicit client access and prevents settings administration", async () => {
  const suffix = randomUUID();
  const client = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({ name: `Team scope ${suffix}`, legalName: `Team scope ${suffix} LLC` }),
  });
  assert.equal(client.response.status, 201);
  createdClientIds.push(client.body.id);

  const invitedUserId = `ledgerflow-invited-bookkeeper-${suffix}`;
  const invitedEmail = `${invitedUserId}@example.test`;
  assert.ok(database);
  await database.db.insert(database.usersTable).values({
    id: invitedUserId,
    email: invitedEmail,
    firstName: "Invited",
    lastName: "Bookkeeper",
  });
  createdUserIds.push(invitedUserId);

  const invitation = await request<{ email: string; role: string; inviteLink: string }>("/workspace/invitations", {
    method: "POST",
    body: JSON.stringify({
      email: invitedEmail,
      role: "bookkeeper",
      clientIds: [client.body.id],
    }),
  });
  assert.equal(invitation.response.status, 201);
  assert.equal(invitation.body.role, "bookkeeper");
  const token = new URL(invitation.body.inviteLink).searchParams.get("invite");
  assert.ok(token);
  const accepted = await request<{ role: string; clients: Array<{ id: number }> }>(`/workspace/invitations/${token}/accept`, {
    method: "POST",
  }, invitedUserId);
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.role, "bookkeeper");
  assert.deepEqual(accepted.body.clients.map((workspace) => workspace.id), [client.body.id]);

  const memberView = await request<{ canManage: boolean; members: Array<{ role: string; clients: Array<{ id: number }> }> }>("/workspace/members", undefined, invitedUserId);
  assert.equal(memberView.response.status, 200);
  assert.equal(memberView.body.canManage, false);
  assert.equal(memberView.body.members[0].role, "bookkeeper");
  assert.deepEqual(memberView.body.members[0].clients.map((workspace) => workspace.id), [client.body.id]);

  const blockedClient = await request<{ error: string }>("/clients", {
    method: "POST",
    body: JSON.stringify({ name: `Blocked ${suffix}`, legalName: `Blocked ${suffix} LLC` }),
  }, invitedUserId);
  assert.equal(blockedClient.response.status, 403);
});
