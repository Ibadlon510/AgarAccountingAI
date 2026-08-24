import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Readable } from "node:stream";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";

type ImportResult = {
  fileName: string;
  importId: number;
  sourceUrl?: string;
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
const createdCatalogModels: string[] = [];
const createdUserIds: string[] = [];
const createdSessionIds: string[] = [];
let primaryToken: string;
let secondaryToken: string;
let primaryUserId: string;
let secondaryUserId: string;
const storedObjects = new Map<string, { buffer: Buffer; contentType: string }>();

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
  process.env.SESSION_SECRET ??= "ledgerflow-test-session-secret";

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
    const responseBody = {
      choices: [{ message: { content: JSON.stringify(openAIResult(userMessage)) } }],
    };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(responseBody));
  });
  const aiPort = await listen(aiServer);
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "ledgerflow-test-openai-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = `http://127.0.0.1:${aiPort}/v1`;

  app = (await import("../src/app")).default;
  database = await import("@workspace/db");
  const { createSession } = await import("../src/lib/auth");
  primaryUserId = `ledgerflow-import-primary-${randomUUID()}`;
  secondaryUserId = `ledgerflow-import-secondary-${randomUUID()}`;
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
  const { objectStorageService } = await import("../src/routes/storage");
  const { ObjectNotFoundError } = await import("../src/lib/objectStorage");
  objectStorageService.getObjectEntityUploadURL = async (prefix = "uploads") => `/objects/${prefix}/${randomUUID()}`;
  objectStorageService.getObjectEntityFile = async (objectPath) => {
    const stored = storedObjects.get(objectPath);
    if (!stored) throw new ObjectNotFoundError();
    return {
      getMetadata: async () => [{ size: String(stored.buffer.length), contentType: stored.contentType }],
      download: async () => [stored.buffer],
      createReadStream: () => Readable.from(stored.buffer),
    } as never;
  };
  objectStorageService.downloadObject = async (file) => {
    const [metadata] = await file.getMetadata();
    return new Response(Readable.toWeb(file.createReadStream()) as ReadableStream, {
      headers: {
        "content-type": String(metadata.contentType ?? "application/octet-stream"),
        "content-length": String(metadata.size),
      },
    });
  };
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
    if (activeDatabase && createdSessionIds.length) {
      await activeDatabase.db.delete(activeDatabase.sessionsTable)
        .where(inArray(activeDatabase.sessionsTable.sid, createdSessionIds));
    }
    if (activeDatabase && createdCatalogModels.length) {
      await activeDatabase.db.delete(activeDatabase.aiModelCatalogTable)
        .where(inArray(activeDatabase.aiModelCatalogTable.model, createdCatalogModels));
    }
    if (activeDatabase && createdUserIds.length) {
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

async function request<T>(path: string, init?: RequestInit, token = primaryToken) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  const body = (await response.json()) as T;
  return { response, body };
}

async function createClient(name: string, token = primaryToken) {
  const result = await request<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({ name, legalName: `${name} LLC` }),
  }, token);
  assert.equal(result.response.status, 201);
  createdClientIds.push(result.body.id);
  return result.body.id;
}

function importBody(clientId: number, fileName: string, marker: string, contentSuffix = "", token = primaryToken) {
  const csv = `marker,description,amount\n${marker},statement line,100${contentSuffix}`;
  const userId = token === secondaryToken ? secondaryUserId : primaryUserId;
  const objectPath = `/objects/uploads/${encodeURIComponent(userId)}/${clientId}/${randomUUID()}`;
  storedObjects.set(objectPath, { buffer: Buffer.from(csv), contentType: "text/csv" });
  return JSON.stringify({
    clientId,
    fileName,
    mimeType: "text/csv",
    objectPath,
    currency: "AED",
  });
}

async function importStatement(clientId: number, fileName: string, marker: string, contentSuffix = "", token = primaryToken) {
  return request<ImportResult>("/ledgerflow/import-statement", {
    method: "POST",
    body: importBody(clientId, fileName, marker, contentSuffix, token),
  }, token);
}

async function statementLines(clientId: number, token = primaryToken) {
  const result = await request<StatementLine[]>(`/ledgerflow/statement-lines?clientId=${clientId}`, undefined, token);
  assert.equal(result.response.status, 200);
  return result.body.filter((line) => line.description !== "EMIRATES AIRLINES"
    && line.description !== "STRIPE PAYOUT 8472"
    && line.description !== "AWS EMEA"
    && line.description !== "AL FARAJ OFFICE SUPPLIES"
    && line.description !== "CLIENT RETAINER — NORTHSTAR"
    && line.description !== "GULF TELECOM");
}

test("authorizes statement upload URLs and rejects invalid or oversized files", async () => {
  const clientId = await createClient(`Upload URL ${randomUUID()}`);
  const valid = await request<{ objectPath: string }>("/storage/uploads/request-url", {
    method: "POST",
    body: JSON.stringify({ clientId, name: "statement.csv", size: 1024, contentType: "text/csv" }),
  });
  assert.equal(valid.response.status, 200);
  assert.match(valid.body.objectPath, new RegExp(`/objects/uploads/${encodeURIComponent(primaryUserId)}/${clientId}/`));

  const invalid = await request<{ error: string }>("/storage/uploads/request-url", {
    method: "POST",
    body: JSON.stringify({ clientId, name: "statement.exe", size: 1024, contentType: "application/octet-stream" }),
  });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.body.error, /PDF, CSV, XLS, or XLSX/);

  const oversized = await request<{ error: string }>("/storage/uploads/request-url", {
    method: "POST",
    body: JSON.stringify({ clientId, name: "statement.csv", size: 50 * 1024 * 1024 + 1, contentType: "text/csv" }),
  });
  assert.equal(oversized.response.status, 400);
  assert.match(oversized.body.error, /50 MB/);

  const denied = await request<{ error: string }>("/storage/uploads/request-url", {
    method: "POST",
    body: JSON.stringify({ clientId, name: "statement.csv", size: 1024, contentType: "text/csv" }),
  }, secondaryToken);
  assert.equal(denied.response.status, 403);
});

test("rejects attaching a private statement upload to a different workspace", async () => {
  const sourceClientId = await createClient(`Scoped source ${randomUUID()}`);
  const otherClientId = await createClient(`Scoped target ${randomUUID()}`);
  const payload = JSON.parse(importBody(sourceClientId, "scoped.csv", "client-isolation")) as Record<string, unknown>;
  payload.clientId = otherClientId;
  const result = await request<{ error: string }>("/ledgerflow/import-statement", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  assert.equal(result.response.status, 403);
  assert.match(result.body.error, /not assigned to the selected client workspace/);
});

test("keeps the original source retrievable only in its authorized workspace", async () => {
  const clientId = await createClient(`Source trail ${randomUUID()}`);
  const imported = await importStatement(clientId, "source-trail.csv", "source-trail");
  assert.equal(imported.response.status, 201);
  assert.ok(imported.body.sourceUrl);
  const sourcePath = imported.body.sourceUrl!.replace(/^\/api/, "");

  const denied = await request<{ error: string }>(sourcePath, undefined, secondaryToken);
  assert.equal(denied.response.status, 403);

  const source = await fetch(`${baseUrl}${sourcePath}`, {
    headers: { authorization: `Bearer ${primaryToken}` },
  });
  assert.equal(source.status, 200);
  assert.match(await source.text(), /source-trail/);
});

test("allows another authorized bookkeeper in the same workspace to retrieve the original source", async () => {
  const clientId = await createClient(`Shared source ${randomUUID()}`);
  const activeDatabase = database;
  assert.ok(activeDatabase);
  await activeDatabase.db.insert(activeDatabase.clientWorkspacesTable).values({ clientId, userId: secondaryUserId });
  const imported = await importStatement(clientId, "shared-source.csv", "shared-source");
  assert.equal(imported.response.status, 201);
  const sourcePath = imported.body.sourceUrl!.replace(/^\/api/, "");
  const source = await fetch(`${baseUrl}${sourcePath}`, {
    headers: { authorization: `Bearer ${secondaryToken}` },
  });
  assert.equal(source.status, 200);
  assert.match(await source.text(), /shared-source/);
});

test("rejects stored uploads whose metadata or bytes do not match their claimed statement type", async () => {
  const clientId = await createClient(`Stored metadata ${randomUUID()}`);
  const payload = JSON.parse(importBody(clientId, "invalid.csv", "invalid-content")) as { objectPath: string };
  storedObjects.set(payload.objectPath, { buffer: Buffer.from("%PDF-not-a-csv"), contentType: "application/pdf" });
  const result = await request<{ error: string }>("/ledgerflow/import-statement", {
    method: "POST",
    body: JSON.stringify({ ...payload, clientId, fileName: "invalid.csv", mimeType: "text/csv", currency: "AED" }),
  });
  assert.equal(result.response.status, 422);
  assert.match(result.body.error, /stored statement type/);
});
test("reports an exact file re-upload without adding review lines", async () => {
  const clientId = await createClient(`Exact re-upload ${randomUUID()}`);
  const first = await importStatement(clientId, "exact-reupload.csv", "exact-reupload");
  assert.equal(first.response.status, 201);
  assert.equal(first.body.importStatus, "imported");
  assert.equal(first.body.importedCount, 1);
  assert.equal((await statementLines(clientId)).length, 1);

  const duplicate = await importStatement(clientId, "exact-reupload.csv", "exact-reupload");
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.body.importStatus, "duplicate_file");
  assert.equal(duplicate.body.importedCount, 0);
  assert.equal(duplicate.body.duplicateCount, 1);
  assert.match(duplicate.body.message ?? "", /already imported/i);
  assert.equal((await statementLines(clientId)).length, 1);
});

test("skips matching transaction keys from a changed file without queue growth", async () => {
  const clientId = await createClient(`Changed duplicate ${randomUUID()}`);
  const first = await importStatement(clientId, "changed-original.csv", "changed-key");
  assert.equal(first.response.status, 201);
  assert.equal(first.body.importedCount, 1);

  const duplicate = await importStatement(clientId, "changed-copy.csv", "changed-key", "   ");
  assert.equal(duplicate.response.status, 201);
  assert.equal(duplicate.body.importStatus, "duplicates_found");
  assert.equal(duplicate.body.importedCount, 0);
  assert.equal(duplicate.body.duplicateCount, 1);
  assert.equal(duplicate.body.duplicateLines[0]?.reason, "already_imported");
  assert.equal(duplicate.body.duplicateLines[0]?.existingLineId, first.body.lines[0]?.id);
  assert.equal((await statementLines(clientId)).length, 1);
});

test("keeps one import and returns a structured duplicate for concurrent overlapping imports", async () => {
  const clientId = await createClient(`Concurrent import ${randomUUID()}`);
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
  const primaryClientId = await createClient(`Isolation primary ${randomUUID()}`);
  const secondaryClientId = await createClient(`Isolation secondary ${randomUUID()}`, secondaryToken);

  const primaryImport = await importStatement(primaryClientId, "client-isolation.csv", "client-isolation");
  assert.equal(primaryImport.response.status, 201);
  assert.equal(primaryImport.body.importStatus, "imported");

  const secondaryImport = await importStatement(
    secondaryClientId,
    "client-isolation.csv",
    "client-isolation",
    "",
    secondaryToken,
  );
  assert.equal(secondaryImport.response.status, 201);
  assert.equal(secondaryImport.body.importStatus, "imported");
  assert.equal(secondaryImport.body.importedCount, 1);
  assert.equal((await statementLines(primaryClientId)).length, 1);
  assert.equal((await statementLines(secondaryClientId, secondaryToken)).length, 1);
});

test("serves the managed AI model catalog and blocks retired models from new selections", async () => {
  assert.ok(database);
  const clientId = await createClient(`AI catalog ${randomUUID()}`);
  const initial = await request<{
    availableModels: Array<{ provider: string; model: string; status: string; displayName: string; retiredAt: string | null }>;
  }>(`/ledgerflow/ai-settings?clientId=${clientId}`);
  assert.equal(initial.response.status, 200);
  assert.ok(initial.body.availableModels.some((option) => option.provider === "openai" && option.model === "gpt-4o-mini" && option.status === "active"));

  const retiredModel = `retired-openai-${randomUUID()}`;
  createdCatalogModels.push(retiredModel);
  await database.db.insert(database.aiModelCatalogTable).values({
    provider: "openai",
    model: retiredModel,
    displayName: "Retired test model",
    status: "active",
  });
  const configured = await request<{ model: string }>("/ledgerflow/ai-settings", {
    method: "PUT",
    body: JSON.stringify({ clientId, provider: "openai", model: retiredModel, apiKey: "catalog-test-key-1234" }),
  });
  assert.equal(configured.response.status, 200);

  await database.db.update(database.aiModelCatalogTable).set({
    status: "retired",
    retiredAt: new Date(),
  }).where(and(
    eq(database.aiModelCatalogTable.provider, "openai"),
    eq(database.aiModelCatalogTable.model, retiredModel),
  ));
  const retiredSettings = await request<{
    model: string;
    availableModels: Array<{ model: string; status: string; retiredAt: string | null }>;
  }>(`/ledgerflow/ai-settings?clientId=${clientId}`);
  assert.equal(retiredSettings.response.status, 200);
  assert.equal(retiredSettings.body.model, retiredModel);
  const retiredOption = retiredSettings.body.availableModels.find((option) => option.model === retiredModel);
  assert.equal(retiredOption?.status, "retired");
  assert.ok(retiredOption?.retiredAt);

  const rejectedRetiredModel = await request<{ error: string }>("/ledgerflow/ai-settings", {
    method: "PUT",
    body: JSON.stringify({ clientId, provider: "openai", model: retiredModel }),
  });
  assert.equal(rejectedRetiredModel.response.status, 400);
  const unavailableChat = await request<{ error: string }>("/ledgerflow/ai-chat", {
    method: "POST",
    body: JSON.stringify({ clientId, message: "Can you review this workspace?" }),
  });
  assert.equal(unavailableChat.response.status, 502);
  assert.match(unavailableChat.body.error, /model is no longer available/i);

  const managedFallbackModel = `managed-fallback-${randomUUID()}`;
  createdCatalogModels.push(managedFallbackModel);
  await database.db.insert(database.aiModelCatalogTable).values({
    provider: "managed_openai",
    model: managedFallbackModel,
    displayName: `000 managed fallback ${managedFallbackModel}`,
    status: "active",
  });
  const fallbackClientId = await createClient(`AI catalog fallback ${randomUUID()}`);
  const freshSettings = await request<{ provider: string; model: string }>(`/ledgerflow/ai-settings?clientId=${fallbackClientId}`);
  assert.equal(freshSettings.body.model, managedFallbackModel);

  await request("/ledgerflow/ai-settings", {
    method: "PUT",
    body: JSON.stringify({ clientId: fallbackClientId, provider: "openai", model: "gpt-4o-mini", apiKey: "managed-fallback-test-key-1234" }),
  });
  const resetToManaged = await request<{ provider: string; model: string }>("/ledgerflow/ai-settings/credential", {
    method: "DELETE",
    body: JSON.stringify({ clientId: fallbackClientId }),
  });
  assert.equal(resetToManaged.response.status, 200);
  assert.equal(resetToManaged.body.model, managedFallbackModel);

  const unavailableManagedClientId = await createClient(`No managed model ${randomUUID()}`);
  const managedCatalog = await database.db.select().from(database.aiModelCatalogTable)
    .where(eq(database.aiModelCatalogTable.provider, "managed_openai"));
  try {
    await database.db.update(database.aiModelCatalogTable).set({ status: "retired", retiredAt: new Date() })
      .where(eq(database.aiModelCatalogTable.provider, "managed_openai"));
    const noManagedDefault = await request<{ error: string }>(`/ledgerflow/ai-settings?clientId=${unavailableManagedClientId}`);
    assert.equal(noManagedDefault.response.status, 409);
    const noManagedReset = await request<{ error: string }>("/ledgerflow/ai-settings/credential", {
      method: "DELETE",
      body: JSON.stringify({ clientId: fallbackClientId }),
    });
    assert.equal(noManagedReset.response.status, 409);
  } finally {
    for (const option of managedCatalog) {
      await database.db.update(database.aiModelCatalogTable).set({ status: option.status, retiredAt: option.retiredAt })
        .where(eq(database.aiModelCatalogTable.id, option.id));
    }
  }
});