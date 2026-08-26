import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Readable } from "node:stream";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import { objectStorageService } from "../src/routes/storage";

type ImportResult = {
  importId?: number;
  fileName: string;
  importStatus: "preview" | "imported" | "imported_with_duplicates" | "duplicates_found" | "duplicate_file";
  message?: string;
  detectedCurrency?: string | null;
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

type AIRecommendation = {
  type: string;
  lineIds?: number[];
  entryIds?: number[];
  statementLineIds?: number[];
  accountSuggestion?: string;
  entryCount?: number;
  lineCount?: number;
  summary?: string;
  statusTransition?: { from: string; to: string };
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
const statementFiles = new Map<string, Buffer>();
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
  if (marker.includes("rate-ai-preview")) {
    return {
      mapping: {
        effectiveDate: "As at",
        sourceCurrency: "Currency",
        functionalCurrency: null,
        rate: "AED per unit",
        source: "Publisher",
        note: null,
      },
      rates: [],
      warnings: ["The file did not state a target currency; AED was used from the workspace setting."],
      unmappedColumns: [],
      confidence: 0.91,
    };
  }
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
  objectStorageService.getObjectEntityFile = (async (objectPath: string) => {
    const content = statementFiles.get(objectPath);
    if (!content) throw new Error(`Missing test statement object: ${objectPath}`);
    return {
      getMetadata: async () => [{ size: String(content.length), contentType: "text/csv" }],
      download: async () => [content],
      createReadStream: () => Readable.from(content),
    };
  }) as typeof objectStorageService.getObjectEntityFile;
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
        const clerkUserId = req.header("x-test-user-id") ?? primaryUserId;
        const legacyUserId = clerkUserId.replace(/^clerk-/, "");
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
      await activeDatabase.db.delete(activeDatabase.aiActivityTable)
        .where(inArray(activeDatabase.aiActivityTable.clientId, createdClientIds));
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
  } catch {
    // Transition audits are deliberately append-only and can retain their scoped
    // references; the isolated test database is discarded independently.
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

async function importBody(clientId: number, fileName: string, marker: string, contentSuffix = "", userId = primaryUserId) {
  const csv = `Bank Statement\nDate,Description,Debit,Credit\n2026-08-25,${marker}${contentSuffix},100,`;
  const objectPath = `/objects/uploads/${encodeURIComponent(userId)}/${clientId}/${randomUUID()}`;
  statementFiles.set(objectPath, Buffer.from(csv));
  return JSON.stringify({
    clientId,
    fileName,
    mimeType: "text/csv",
    objectPath,
    currency: "AED",
    confirmed: true,
  });
}

async function importStatement(clientId: number, fileName: string, marker: string, contentSuffix = "", userId = primaryUserId) {
  return request<ImportResult>("/ledgerflow/import-statement", {
    method: "POST",
    body: await importBody(clientId, fileName, marker, contentSuffix, userId),
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
  const clientId = await createClient(`Exact re-upload ${randomUUID()}`);
  const first = await importStatement(clientId, "changed-original.csv", "changed-key");
  assert.equal(first.response.status, 201);
  assert.equal(first.body.importedCount, 1);

  const duplicate = await importStatement(clientId, "changed-original.csv", "changed-key");
  assert.equal(first.body.importStatus, "imported");
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.body.importStatus, "duplicate_file");
  assert.equal(duplicate.body.duplicateCount, 1);
  assert.deepEqual(duplicate.body.duplicateLines, []);
  assert.deepEqual(duplicate.body.lines, []);
  assert.equal((await statementLines(clientId)).length, 1);
});

test("undoes only a review-only import, preserves evidence and audit IDs, and is idempotent", async () => {
  assert.ok(database);
  const clientId = await createClient(`Review-only undo ${randomUUID()}`);
  const imported = await importStatement(clientId, "undo-review-only.csv", "undo-review-only");
  assert.equal(imported.response.status, 201);
  assert.ok(imported.body.importId);
  const importId = imported.body.importId;
  const lineId = imported.body.lines[0]?.id;
  assert.ok(lineId);
  const [entry] = await database.db.select().from(database.journalEntriesTable)
    .where(eq(database.journalEntriesTable.statementLineId, lineId));
  assert.ok(entry);

  const undone = await request<{
    outcome: "undone";
    removedLineCount: number;
    removedJournalEntryCount: number;
    alreadyUndone: boolean;
  }>(`/ledgerflow/statement-imports/${importId}/undo`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  });
  assert.equal(undone.response.status, 200);
  assert.equal(undone.body.outcome, "undone");
  assert.equal(undone.body.removedLineCount, 1);
  assert.equal(undone.body.removedJournalEntryCount, 1);
  assert.equal(undone.body.alreadyUndone, false);
  assert.deepEqual(await statementLines(clientId), []);

  const [storedImport] = await database.db.select().from(database.statementImportsTable)
    .where(eq(database.statementImportsTable.id, importId));
  assert.equal(storedImport?.outcome, "undone");
  assert.ok(storedImport?.objectPath);
  const preservedSource = await fetch(`${baseUrl}/ledgerflow/statement-imports/${importId}/source`, {
    headers: { "x-test-user-id": primaryUserId },
  });
  assert.equal(preservedSource.status, 200);
  assert.match(Buffer.from(await preservedSource.arrayBuffer()).toString("utf8"), /undo-review-only/);
  const [audit] = await database.db.select().from(database.statementImportUndoAuditsTable)
    .where(eq(database.statementImportUndoAuditsTable.statementImportId, importId));
  assert.deepEqual(audit?.statementLineIds, [lineId]);
  assert.deepEqual(audit?.journalEntryIds, [entry.id]);
  assert.equal(audit?.clientId, clientId);

  const repeat = await request<{ alreadyUndone: boolean }>(`/ledgerflow/statement-imports/${importId}/undo`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  });
  assert.equal(repeat.response.status, 200);
  assert.equal(repeat.body.alreadyUndone, true);
  const audits = await database.db.select().from(database.statementImportUndoAuditsTable)
    .where(eq(database.statementImportUndoAuditsTable.statementImportId, importId));
  assert.equal(audits.length, 1);

  const trialBalance = await request<unknown[]>(`/ledgerflow/trial-balance?clientId=${clientId}`);
  assert.equal(trialBalance.response.status, 200);
  assert.deepEqual(trialBalance.body, []);
});

test("blocks changed imports and isolates the statement-import undo mutation", async () => {
  assert.ok(database);
  const clientId = await createClient(`Blocked import undo ${randomUUID()}`);
  const imported = await importStatement(clientId, "undo-blocked.csv", "undo-blocked");
  assert.equal(imported.response.status, 201);
  assert.ok(imported.body.importId);
  const importId = imported.body.importId;
  const lineId = imported.body.lines[0]?.id;
  assert.ok(lineId);
  const [entry] = await database.db.select().from(database.journalEntriesTable)
    .where(eq(database.journalEntriesTable.statementLineId, lineId));
  assert.ok(entry);
  await database.db.update(database.journalEntriesTable)
    .set({ status: "approved" })
    .where(eq(database.journalEntriesTable.id, entry.id));

  const foreign = await request<{ error: string }>(`/ledgerflow/statement-imports/${importId}/undo`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  }, secondaryUserId);
  assert.equal(foreign.response.status, 403);

  const blocked = await request<{ error: string }>(`/ledgerflow/statement-imports/${importId}/undo`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  });
  assert.equal(blocked.response.status, 409);
  assert.match(blocked.body.error, /changed, approved, or posted/i);
  assert.equal((await statementLines(clientId)).length, 1);
  const [storedImport] = await database.db.select().from(database.statementImportsTable)
    .where(eq(database.statementImportsTable.id, importId));
  assert.equal(storedImport?.outcome, "completed");
  const audits = await database.db.select().from(database.statementImportUndoAuditsTable)
    .where(eq(database.statementImportUndoAuditsTable.statementImportId, importId));
  assert.equal(audits.length, 0);
});

test("returns a currency-aware statement preview without creating lines or import history", async () => {
  const clientId = await createClient(`Preview only ${randomUUID()}`);
  const fileName = "preview-only.csv";
  const marker = "preview-currency";
  const objectPath = `/objects/uploads/${encodeURIComponent(primaryUserId)}/${clientId}/${randomUUID()}`;
  statementFiles.set(objectPath, Buffer.from(`Bank Statement\nCurrency: AED\nDate,Description,Debit,Credit\n2026-08-25,${marker},100,`));

  const preview = await request<ImportResult>("/ledgerflow/import-statement", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      fileName,
      mimeType: "text/csv",
      objectPath,
      confirmed: false,
    }),
  }, primaryUserId);

  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.importStatus, "preview");
  assert.equal(preview.body.detectedCurrency, "AED");
  assert.equal(preview.body.importedCount, 0);
  assert.equal(preview.body.lines.length, 1);
  assert.ok(preview.body.lines[0].id < 0);
  assert.equal((await statementLines(clientId)).length, 0);
  const history = await request<Array<{ id: number }>>(`/ledgerflow/statement-imports?clientId=${clientId}`, undefined, primaryUserId);
  assert.equal(history.response.status, 200);
  assert.equal(history.body.length, 0);
});

test("handles concurrent duplicate statement imports once", async () => {
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

test("lists only successful uploaded files in newest-first order and keeps expired evidence unavailable", async () => {
  assert.ok(database);
  const clientId = await createClient(`Excel rate preview ${randomUUID()}`);

  const foreignClientId = await createClient(`Foreign bulk selection ${randomUUID()}`, secondaryUserId);
  const now = Date.now();
  const [completed, duplicate, expired] = await database.db.insert(database.statementImportsTable).values([
    {
      clientId,
      fileName: "completed-statement.csv",
      mimeType: "text/csv",
      objectPath: "/objects/completed-statement.csv",
      fileHash: randomUUID(),
      outcome: "completed",
      importedLineCount: 4,
      evidenceExpiresAt: new Date(now + 60_000),
      createdAt: new Date(now - 3_000),
    },
    {
      clientId,
      fileName: "duplicate-statement.csv",
      mimeType: "text/csv",
      objectPath: "/objects/duplicate-statement.csv",
      fileHash: randomUUID(),
      outcome: "duplicate",
      importedLineCount: 4,
      evidenceExpiresAt: new Date(now + 60_000),
      createdAt: new Date(now - 2_000),
    },
    {
      clientId,
      fileName: "expired-statement.pdf",
      mimeType: "application/pdf",
      objectPath: "/objects/expired-statement.pdf",
      fileHash: randomUUID(),
      outcome: "completed",
      importedLineCount: 2,
      evidenceExpiresAt: new Date(now - 1_000),
      createdAt: new Date(now - 1_000),
    },
    {
      clientId,
      fileName: "failed-statement.csv",
      mimeType: "text/csv",
      objectPath: "/objects/failed-statement.csv",
      fileHash: randomUUID(),
      outcome: "failed",
      errorMessage: "Hidden parsing failure",
      importedLineCount: 0,
      createdAt: new Date(now),
    },
  ]).returning();

  const files = await request<Array<{
    id: number;
    fileName: string;
    outcome: "completed" | "duplicate";
    importedLineCount: number;
    processedAt: string;
    sourceStatus: "available" | "expired" | "unavailable";
    sourceUrl: string | null;
  }>>(`/ledgerflow/uploaded-files?clientId=${clientId}`);
  assert.equal(files.response.status, 200);
  assert.deepEqual(files.body.map((file) => file.fileName), [
    "expired-statement.pdf",
    "duplicate-statement.csv",
    "completed-statement.csv",
  ]);
  assert.deepEqual(files.body.map((file) => file.outcome), ["completed", "duplicate", "completed"]);
  assert.equal(files.body[0]?.sourceStatus, "expired");
  assert.equal(files.body[0]?.sourceUrl, null);
  assert.equal(files.body[1]?.sourceStatus, "unavailable");
  assert.equal(files.body[1]?.sourceUrl, null);
  assert.equal(files.body[2]?.importedLineCount, 4);
  assert.match(files.body[2]?.processedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);

  const foreignList = await request<{ error: string }>(
    `/ledgerflow/uploaded-files?clientId=${clientId}`,
    undefined,
    secondaryUserId,
  );
  assert.equal(foreignList.response.status, 403);

  const foreignSource = await request<{ error: string }>(
    `/ledgerflow/statement-imports/${completed.id}/source`,
    undefined,
    secondaryUserId,
  );
  assert.equal(foreignSource.response.status, 403);

  const expiredSource = await request<{ error: string }>(
    `/ledgerflow/statement-imports/${expired.id}/source`,
  );
  assert.equal(expiredSource.response.status, 404);

  await database.db.insert(database.clientWorkspacesTable).values({
    clientId,
    userId: secondaryUserId,
    role: "bookkeeper",
  });
  const teamMemberFiles = await request<Array<{ id: number }>>(
    `/ledgerflow/uploaded-files?clientId=${clientId}`,
    undefined,
    secondaryUserId,
  );
  assert.equal(teamMemberFiles.response.status, 200);
  assert.deepEqual(teamMemberFiles.body.map((file) => file.id), files.body.map((file) => file.id));
});

test("stages deterministic description recodes before separately confirmed approval and posting", async () => {
  const clientId = await createClient(`AI action scope ${randomUUID()}`);
  const createdLine = await request<{ id: number; accountSuggestion: string }>("/ledgerflow/statement-lines", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-08-25",
      description: "Acme invoice 9381",
      currency: "AED",
      amount: 240,
      direction: "outflow",
    }),
  });
  assert.equal(createdLine.response.status, 201);
  assert.equal(createdLine.body.accountSuggestion, "General expenses");

  type Recommendation = {
    type: string;
    lineIds?: number[];
    entryIds?: number[];
    statementLineIds?: number[];
    accountSuggestion?: string;
  };
  type CopilotResponse = { answer: string; recommendations: Recommendation[] };
  const classification = await request<CopilotResponse>("/ledgerflow/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      message: "Classify all transactions matching Acme invoice as Software & subscriptions.",
    }),
  });
  assert.equal(classification.response.status, 200);
  assert.equal(classification.body.recommendations.length, 1);
  assert.equal(classification.body.recommendations[0]?.type, "recode_lines");
  assert.deepEqual(classification.body.recommendations[0]?.lineIds, [createdLine.body.id]);
  assert.equal(classification.body.recommendations[0]?.accountSuggestion, "Software & subscriptions");

  const mixedRequest = await request<CopilotResponse>("/ledgerflow/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      message: "Classify all transactions matching Acme invoice as Software & subscriptions and post them.",
    }),
  });
  assert.equal(mixedRequest.response.status, 200);
  assert.equal(mixedRequest.body.recommendations.length, 0);
  assert.match(mixedRequest.body.answer, /separate steps/i);

  const recode = await request<{ updatedLineCount: number }>("/ledgerflow/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      type: "recode_lines",
      clientId,
      lineIds: classification.body.recommendations[0]?.lineIds,
      accountSuggestion: "Software & subscriptions",
    }),
  });
  assert.equal(recode.response.status, 200);
  assert.equal(recode.body.updatedLineCount, 1);

  const journalEntries = await request<Array<{ id: number; statementLineId: number; status: string }>>(
    `/ledgerflow/journal-entries?clientId=${clientId}`,
  );
  assert.equal(journalEntries.response.status, 200);
  const entry = journalEntries.body.find((item) => item.statementLineId === createdLine.body.id);
  assert.ok(entry);
  assert.equal(entry.status, "suggested");

  const approvalCard = await request<CopilotResponse>("/ledgerflow/ai-chat", {
    method: "POST",
    body: JSON.stringify({ clientId, message: "Approve all suggested entries." }),
  });
  assert.equal(approvalCard.response.status, 200);
  assert.equal(approvalCard.body.recommendations[0]?.type, "bulk_approve_entries");

  const approval = await request<{ toStatus: string; entryCount: number }>("/ledgerflow/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      type: "bulk_approve_entries",
      clientId,
      entryIds: approvalCard.body.recommendations[0]?.entryIds,
      statementLineIds: approvalCard.body.recommendations[0]?.statementLineIds,
    }),
  });
  assert.equal(approval.response.status, 200);
  assert.equal(approval.body.toStatus, "approved");
  assert.equal(approval.body.entryCount, 1);

  const repeatedApproval = await request<{ error: string }>("/ledgerflow/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      type: "bulk_approve_entries",
      clientId,
      entryIds: approvalCard.body.recommendations[0]?.entryIds,
      statementLineIds: approvalCard.body.recommendations[0]?.statementLineIds,
    }),
  });
  assert.equal(repeatedApproval.response.status, 409);
  assert.match(repeatedApproval.body.error, /only suggested entries/i);

  const postingCard = await request<CopilotResponse>("/ledgerflow/ai-chat", {
    method: "POST",
    body: JSON.stringify({ clientId, message: "Post all approved entries." }),
  });
  assert.equal(postingCard.response.status, 200);
  assert.equal(postingCard.body.recommendations[0]?.type, "bulk_post_entries");
  const posting = await request<{ toStatus: string }>("/ledgerflow/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      type: "bulk_post_entries",
      clientId,
      entryIds: postingCard.body.recommendations[0]?.entryIds,
      statementLineIds: postingCard.body.recommendations[0]?.statementLineIds,
    }),
  });
  assert.equal(posting.response.status, 200);
  assert.equal(posting.body.toStatus, "posted");

  const audits = await request<Array<{ transition: string; actor: { id: string } }>>(`/ledgerflow/bulk-transition-audits?clientId=${clientId}`);
  assert.equal(audits.response.status, 200);
  assert.deepEqual(audits.body.map((audit) => audit.transition).sort(), ["bulk_approve_entries", "bulk_post_entries"]);
  assert.ok(audits.body.every((audit) => audit.actor.id === primaryUserId));
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

test("prepares description-scoped recoding, approval, and posting as separate confirmed actions", async () => {
  const clientId = await createClient(`AI batch scope ${randomUUID()}`);
  for (const [date, amount] of [["2026-08-23", 150], ["2026-08-24", 250]] as const) {
    const created = await request<{ id: number }>("/ledgerflow/statement-lines", {
      method: "POST",
      body: JSON.stringify({
        clientId,
        date,
        description: "SUNWEB GROUP GMBH payout",
        currency: "AED",
        amount,
        direction: "inflow",
      }),
    });
    assert.equal(created.response.status, 201);
  }

  const recode = await request<{ recommendations: AIRecommendation[] }>("/ledgerflow/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      message: "All transactions with description SUNWEB GROUP GMBH must be posted as revenue.",
    }),
  });
  assert.equal(recode.response.status, 200);
  const recodeRecommendation = recode.body.recommendations[0];
  assert.equal(recodeRecommendation?.type, "recode_lines");
  assert.equal(recodeRecommendation?.accountSuggestion, "Revenue");
  assert.equal(recodeRecommendation?.lineIds?.length, 2);

  for (const mixedInstruction of [
    "All transactions with description SUNWEB GROUP GMBH must be posted as revenue and post them.",
    "All transactions with description SUNWEB GROUP GMBH must be posted as revenue and approve them.",
  ]) {
    const mixedRequest = await request<{ answer: string; recommendations: AIRecommendation[] }>("/ledgerflow/ai-chat", {
      method: "POST",
      body: JSON.stringify({ clientId, message: mixedInstruction }),
    });
    assert.equal(mixedRequest.response.status, 200);
    assert.equal(mixedRequest.body.recommendations.length, 0);
    assert.match(mixedRequest.body.answer, /separate steps/i);
  }

  const recodeConfirmation = await request<{ updatedLineCount: number }>("/ledgerflow/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      type: "recode_lines",
      lineIds: recodeRecommendation?.lineIds,
      accountSuggestion: recodeRecommendation?.accountSuggestion,
      confidence: 0.9,
    }),
  });
  assert.equal(recodeConfirmation.response.status, 200);
  assert.equal(recodeConfirmation.body.updatedLineCount, 2);

  const approval = await request<{ recommendations: AIRecommendation[] }>("/ledgerflow/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      message: "Approve all pending entries with description SUNWEB GROUP GMBH.",
    }),
  });
  assert.equal(approval.response.status, 200);
  const approvalRecommendation = approval.body.recommendations[0];
  assert.equal(approvalRecommendation?.type, "bulk_approve_entries");
  assert.equal(approvalRecommendation?.entryCount, 2);

  const approvalConfirmation = await request<{ toStatus: string }>("/ledgerflow/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      type: approvalRecommendation?.type,
      entryIds: approvalRecommendation?.entryIds,
      statementLineIds: approvalRecommendation?.statementLineIds,
    }),
  });
  assert.equal(approvalConfirmation.response.status, 200);
  assert.equal(approvalConfirmation.body.toStatus, "approved");

  const posting = await request<{ recommendations: AIRecommendation[] }>("/ledgerflow/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      message: "Post all approved entries with description SUNWEB GROUP GMBH.",
    }),
  });
  assert.equal(posting.response.status, 200);
  const postingRecommendation = posting.body.recommendations[0];
  const postingConfirmation = await request<{ toStatus: string; updatedLineCount: number }>("/ledgerflow/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      type: postingRecommendation?.type,
      entryIds: postingRecommendation?.entryIds,
      statementLineIds: postingRecommendation?.statementLineIds,
    }),
  });
  assert.equal(postingConfirmation.response.status, 200);
  assert.equal(postingConfirmation.body.toStatus, "posted");
  assert.equal(postingConfirmation.body.updatedLineCount, 2);
});

test("resends a pending invitation with its approved scope and invalidates the earlier link", async () => {
  const suffix = randomUUID();
  const client = await request<{ id: number; name: string }>("/clients", {
    method: "POST",
    body: JSON.stringify({ name: `Resend scope ${suffix}`, legalName: `Resend scope ${suffix} LLC` }),
  });
  assert.equal(client.response.status, 201);
  createdClientIds.push(client.body.id);

  const invitedUserId = `ledgerflow-resend-bookkeeper-${suffix}`;
  const invitedEmail = `${invitedUserId}@example.test`;
  assert.ok(database);
  await database.db.insert(database.usersTable).values({
    id: invitedUserId,
    email: invitedEmail,
    firstName: "Resend",
    lastName: "Recipient",
  });
  createdUserIds.push(invitedUserId);

  type InvitationEmail = {
    id: number;
    role: string;
    clients: Array<{ id: number; name: string }>;
    inviteLink: string;
    emailSubject: string;
    emailBody: string;
  };
  const created = await request<InvitationEmail>("/workspace/invitations", {
    method: "POST",
    body: JSON.stringify({
      email: invitedEmail,
      role: "admin",
      clientIds: [client.body.id],
    }),
  });
  assert.equal(created.response.status, 201);
  assert.match(created.body.emailSubject, /invited to agaraccounting ai system/i);
  assert.match(created.body.emailBody, /invited you to agaraccounting ai system/i);
  assert.doesNotMatch(created.body.emailBody, /ledgerflow/i);
  assert.match(created.body.emailBody, /as an admin/i);
  assert.match(created.body.emailBody, new RegExp(client.body.name));
  assert.match(created.body.emailBody, /expires on/i);

  const originalToken = new URL(created.body.inviteLink).searchParams.get("invite");
  assert.ok(originalToken);
  const resent = await request<InvitationEmail>(`/workspace/invitations/${created.body.id}/resend`, {
    method: "POST",
  });
  assert.equal(resent.response.status, 200);
  assert.equal(resent.body.id, created.body.id);
  assert.equal(resent.body.role, created.body.role);
  assert.deepEqual(resent.body.clients, created.body.clients);
  assert.match(resent.body.emailBody, /as an admin/i);
  assert.match(resent.body.emailBody, new RegExp(client.body.name));

  const resentToken = new URL(resent.body.inviteLink).searchParams.get("invite");
  assert.ok(resentToken);
  assert.notEqual(resentToken, originalToken);

  const expiredLink = await request<{ error: string }>(`/workspace/invitations/${originalToken}/accept`, {
    method: "POST",
  }, invitedUserId);
  assert.equal(expiredLink.response.status, 404);
  assert.match(expiredLink.body.error, /no longer available/i);

  const accepted = await request<{ role: string; clients: Array<{ id: number }> }>(`/workspace/invitations/${resentToken}/accept`, {
    method: "POST",
  }, invitedUserId);
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.role, "admin");
  assert.deepEqual(accepted.body.clients.map((workspace) => workspace.id), [client.body.id]);
});

test("prepares unfamiliar exchange-rate CSV data without importing it", async () => {
  const clientId = await createClient(`AI rate preview ${randomUUID()}`);
  const preview = await request<{
    mapping: { effectiveDate: string | null; sourceCurrency: string | null; functionalCurrency: string | null; rate: string | null; source: string | null; note: string | null };
    rates: Array<{ effectiveDate: string; sourceCurrency: string; functionalCurrency: string; rate: number; source: string; note: string | null }>;
    warnings: string[];
    confidence: number;
  }>("/ledgerflow/exchange-rates/parse", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      fileName: "rate-ai-preview.csv",
      content: "As at,Currency,AED per unit,Publisher\n2026-08-25,EUR,4.2105,Central Bank",
    }),
  });

  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.mapping.effectiveDate, "As at");
  assert.equal(preview.body.mapping.functionalCurrency, null);
  assert.deepEqual(preview.body.rates, [{
    effectiveDate: "2026-08-25",
    sourceCurrency: "EUR",
    functionalCurrency: "AED",
    rate: 4.2105,
    source: "Central Bank",
    note: null,
  }]);
  assert.equal(preview.body.confidence, 0.91);
  assert.match(preview.body.warnings[0] ?? "", /workspace setting/i);
});

test("prepares recognizable Excel exchange-rate rows without calling AI or importing them", async () => {
  const clientId = await createClient(`Excel rate preview ${randomUUID()}`);
  const requestCountBefore = aiRequests.length;
  const workbook = XLSX.utils.book_new();
  const rows = [
    ["Value Date", "CCY", "FX Rate", "Inverse Rate"],
    [new Date("2025-01-02T00:00:00.000Z"), "EUR", 3.787254, false],
    [new Date("2025-01-03T00:00:00.000Z"), "EUR", 3.779459, false],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), "2025");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), "Duplicate 2025");
  const preview = await request<{
    mapping: { effectiveDate: string | null; sourceCurrency: string | null; functionalCurrency: string | null; rate: string | null; source: string | null; note: string | null };
    rates: Array<{ effectiveDate: string; sourceCurrency: string; functionalCurrency: string; rate: number; source: string; note: string | null }>;
    warnings: string[];
    confidence: number;
  }>("/ledgerflow/exchange-rates/parse", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      fileName: "2025_Consolidated_EUR_Rates.xlsx",
      fileBase64: XLSX.write(workbook, { type: "base64", bookType: "xlsx", cellDates: true }),
    }),
  });

  assert.equal(preview.response.status, 200);
  assert.deepEqual(preview.body.mapping, {
    effectiveDate: "Value Date",
    sourceCurrency: "CCY",
    functionalCurrency: null,
    rate: "FX Rate",
    source: null,
    note: null,
  });
  assert.deepEqual(preview.body.rates, [
    { effectiveDate: "2025-01-02", sourceCurrency: "EUR", functionalCurrency: "AED", rate: 3.787254, source: "Imported workbook · 2025", note: null },
    { effectiveDate: "2025-01-03", sourceCurrency: "EUR", functionalCurrency: "AED", rate: 3.779459, source: "Imported workbook · 2025", note: null },
  ]);
  assert.equal(preview.body.confidence, 1);
  assert.equal(aiRequests.length, requestCountBefore);
  assert.match(preview.body.warnings[0] ?? "", /recognized 2 valid rates directly from the excel workbook/i);
});
