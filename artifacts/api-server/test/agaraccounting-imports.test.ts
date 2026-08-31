import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Readable } from "node:stream";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import { ObjectNotFoundError } from "../src/lib/objectStorage";
import { objectStorageService } from "../src/routes/storage";

type ImportResult = {
  importId?: number;
  fileName: string;
  importStatus: "analyzing" | "preview" | "imported" | "imported_with_duplicates" | "duplicates_found" | "duplicate_file";
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
  lines: Array<{
    id: number;
    bankAccountId: number | null;
    description: string;
    currency: string;
    accountSuggestion?: string;
    status?: string;
    proposedContactName?: string | null;
    proposedContactAlias?: string | null;
    proposedContactConfidence?: number | null;
    proposedContactSource?: string | null;
    contactDecisionState?: string;
    contactId?: number | null;
    contactName?: string | null;
    contactSuggestionStatus?: string | null;
  }>;
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
  currency: string;
  status: string;
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
  const value = process.env.AGARACCOUNTING_TEST_DATABASE_URL;
  if (!value) throw new Error("AGARACCOUNTING_TEST_DATABASE_URL is required for AgarAccounting AI System integration tests.");

  const databaseName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) {
    throw new Error("The AgarAccounting AI System integration test database name must contain 'test'.");
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
  if (marker.includes("counterparty-ai")) {
    return {
      bankAccount: null,
      lines: [{
        date: "2026-08-27",
        description: "Visa Purchase Circle Espergerde Dkk Susanne Chris Aed",
        amount: 425,
        direction: "outflow",
        currency: "AED",
        counterpartyName: "Circle Espergerde",
        counterpartyAlias: "Circle Espergerde",
        counterpartyConfidence: 0.93,
      }],
    };
  }
  if (marker.includes("counterparty-invalid")) {
    return {
      bankAccount: null,
      lines: [{
        date: "2026-08-27",
        description: "CARD PAYMENT INV-123 2026-08-27 AED",
        amount: 99,
        direction: "outflow",
        currency: "AED",
        counterpartyName: "INV",
        counterpartyAlias: "INV",
        counterpartyConfidence: 0.99,
      }],
    };
  }
  if (marker.includes("counterparty-existing-alias")) {
    return {
      bankAccount: null,
      lines: [{
        date: "2026-08-27",
        description: "ACME PAYMENTS",
        amount: 150,
        direction: "outflow",
        currency: "AED",
        counterpartyName: "Acme",
        counterpartyAlias: "Acme",
        counterpartyConfidence: 0.9,
      }],
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
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.AGARACCOUNTING_EMAIL_TEST_MODE = "success";
  process.env.AGARACCOUNTING_PUBLIC_URL = "https://agaraccounting.example.test/";
  process.env.RESEND_FROM_EMAIL = "AgarAccounting <invitations@example.test>";
  objectStorageService.getObjectEntityFile = (async (objectPath: string) => {
    const content = statementFiles.get(objectPath);
    if (!content) throw new ObjectNotFoundError();
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
    if (userMessage.includes("background-slow")) {
      await new Promise((resolve) => setTimeout(resolve, 150));
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
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "agaraccounting-test-openai-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = `http://127.0.0.1:${aiPort}/v1`;
  process.env.AGARACCOUNTING_OPENAI_BASE_URL = `http://127.0.0.1:${aiPort}/v1`;
  process.env.AGARACCOUNTING_ANTHROPIC_BASE_URL = `http://127.0.0.1:${aiPort}`;

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
  primaryUserId = `agaraccounting-import-primary-${randomUUID()}`;
  secondaryUserId = `agaraccounting-import-secondary-${randomUUID()}`;
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
  const text = await response.text();
  const body = (text ? JSON.parse(text) : undefined) as T;
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
  return request<ImportResult>("/agaraccounting/import-statement", {
    method: "POST",
    body: await importBody(clientId, fileName, marker, contentSuffix, userId),
  }, userId);
}

async function statementLines(clientId: number, userId = primaryUserId) {
  const result = await request<StatementLine[]>(`/agaraccounting/statement-lines?clientId=${clientId}`, undefined, userId);
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

test("uses a grounded AI counterparty while preserving a provisional review decision", async () => {
  const clientId = await createClient(`AI counterparty ${randomUUID()}`);
  const imported = await importStatement(clientId, "counterparty-ai.csv", "counterparty-ai");
  assert.equal(imported.response.status, 201);
  assert.equal(imported.body.importedCount, 1);
  assert.equal(imported.body.lines[0]?.proposedContactName, "Circle Espergerde");
  assert.equal(imported.body.lines[0]?.proposedContactAlias, "Circle Espergerde");
  assert.equal(imported.body.lines[0]?.proposedContactConfidence, 0.93);
  assert.equal(imported.body.lines[0]?.proposedContactSource, "ai_counterparty_extraction");
  assert.equal(imported.body.lines[0]?.contactDecisionState, "named_proposal");
});

test("rejects reference fragments from AI and deterministic counterparty extraction", async () => {
  const clientId = await createClient(`Rejected counterparty ${randomUUID()}`);
  const imported = await importStatement(clientId, "counterparty-invalid.csv", "counterparty-invalid");
  assert.equal(imported.response.status, 201);
  assert.equal(imported.body.lines[0]?.proposedContactName, null);
  assert.equal(imported.body.lines[0]?.proposedContactAlias, null);
  assert.equal(imported.body.lines[0]?.proposedContactSource, null);
  assert.equal(imported.body.lines[0]?.contactDecisionState, "needs_identification");
});

test("keeps existing alias precedence consistent from import preview through confirmation", async () => {
  const clientId = await createClient(`Existing alias preview ${randomUUID()}`);
  const contact = await request<{ id: number; displayName: string }>("/agaraccounting/contacts", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      displayName: "Acme Supplies",
      legalName: "Acme Supplies LLC",
      contactType: "supplier",
      aliases: ["ACME PAYMENTS"],
    }),
  });
  assert.equal(contact.response.status, 201);

  const previewRequest = JSON.parse(
    await importBody(clientId, "counterparty-existing-alias.csv", "counterparty-existing-alias"),
  ) as Record<string, unknown>;
  previewRequest.confirmed = false;
  const preview = await request<ImportResult>("/agaraccounting/import-statement", {
    method: "POST",
    body: JSON.stringify(previewRequest),
  });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.lines[0]?.contactId, contact.body.id);
  assert.equal(preview.body.lines[0]?.contactName, "Acme Supplies");
  assert.equal(preview.body.lines[0]?.contactDecisionState, "matched");
  assert.equal(preview.body.lines[0]?.proposedContactName, null);

  const confirmed = await request<ImportResult>("/agaraccounting/import-statement", {
    method: "POST",
    body: JSON.stringify({
      ...previewRequest,
      confirmed: true,
      pendingImportId: preview.body.importId,
    }),
  });
  assert.equal(confirmed.response.status, 201);
  assert.equal(confirmed.body.lines[0]?.contactId, contact.body.id);
  assert.equal(confirmed.body.lines[0]?.contactName, "Acme Supplies");
  assert.equal(confirmed.body.lines[0]?.contactDecisionState, "matched");
  assert.equal(confirmed.body.lines[0]?.proposedContactName, null);
});

test("undoes an unchanged draft import, preserves evidence and audit IDs, and is idempotent", async () => {
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
  assert.equal(imported.body.lines[0]?.status, "draft");
  assert.equal(entry.status, "draft");

  const undone = await request<{
    outcome: "undone";
    removedLineCount: number;
    removedJournalEntryCount: number;
    alreadyUndone: boolean;
  }>(`/agaraccounting/statement-imports/${importId}/undo`, {
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
  const preservedSource = await fetch(`${baseUrl}/agaraccounting/statement-imports/${importId}/source`, {
    headers: { "x-test-user-id": primaryUserId },
  });
  assert.equal(preservedSource.status, 200);
  assert.equal(preservedSource.headers.get("content-type"), "text/csv");
  assert.equal(preservedSource.headers.get("content-disposition"), 'inline; filename="undo-review-only.csv"');
  assert.match(Buffer.from(await preservedSource.arrayBuffer()).toString("utf8"), /undo-review-only/);
  const downloadedSource = await fetch(`${baseUrl}/agaraccounting/statement-imports/${importId}/source?download=true`, {
    headers: { "x-test-user-id": primaryUserId },
  });
  assert.equal(downloadedSource.status, 200);
  assert.equal(downloadedSource.headers.get("content-disposition"), 'attachment; filename="undo-review-only.csv"');
  assert.match(Buffer.from(await downloadedSource.arrayBuffer()).toString("utf8"), /undo-review-only/);
  const [audit] = await database.db.select().from(database.statementImportUndoAuditsTable)
    .where(eq(database.statementImportUndoAuditsTable.statementImportId, importId));
  assert.deepEqual(audit?.statementLineIds, [lineId]);
  assert.deepEqual(audit?.journalEntryIds, [entry.id]);
  assert.equal(audit?.clientId, clientId);

  const repeat = await request<{ alreadyUndone: boolean }>(`/agaraccounting/statement-imports/${importId}/undo`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  });
  assert.equal(repeat.response.status, 200);
  assert.equal(repeat.body.alreadyUndone, true);
  const audits = await database.db.select().from(database.statementImportUndoAuditsTable)
    .where(eq(database.statementImportUndoAuditsTable.statementImportId, importId));
  assert.equal(audits.length, 1);

  const trialBalance = await request<unknown[]>(`/agaraccounting/trial-balance?clientId=${clientId}`);
  assert.equal(trialBalance.response.status, 200);
  assert.deepEqual(trialBalance.body, []);
});

test("blocks posted imports and isolates the statement-import undo mutation", async () => {
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
    .set({ status: "posted" })
    .where(eq(database.journalEntriesTable.id, entry.id));

  const foreign = await request<{ error: string }>(`/agaraccounting/statement-imports/${importId}/undo`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  }, secondaryUserId);
  assert.equal(foreign.response.status, 403);

  const blocked = await request<{ error: string }>(`/agaraccounting/statement-imports/${importId}/undo`, {
    method: "POST",
    body: JSON.stringify({ clientId }),
  });
  assert.equal(blocked.response.status, 409);
  assert.match(blocked.body.error, /changed or posted/i);
  assert.equal((await statementLines(clientId)).length, 1);
  const [storedImport] = await database.db.select().from(database.statementImportsTable)
    .where(eq(database.statementImportsTable.id, importId));
  assert.equal(storedImport?.outcome, "completed");
  const audits = await database.db.select().from(database.statementImportUndoAuditsTable)
    .where(eq(database.statementImportUndoAuditsTable.statementImportId, importId));
  assert.equal(audits.length, 0);

});

test("stores a USD statement for confirmation without creating lines, then loads it only after confirmation", async () => {
  const clientId = await createClient(`Preview only ${randomUUID()}`);
  const fileName = "preview-only.csv";
  const marker = "preview-currency";
  const objectPath = `/objects/uploads/${encodeURIComponent(primaryUserId)}/${clientId}/${randomUUID()}`;
  statementFiles.set(objectPath, Buffer.from(`Bank Statement\nCurrency: USD\nDate,Description,Debit,Credit\n2026-08-25,${marker},100,`));

  const preview = await request<ImportResult>("/agaraccounting/import-statement", {
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
  assert.equal(preview.body.detectedCurrency, "USD");
  assert.equal(preview.body.importedCount, 0);
  assert.equal(preview.body.lines.length, 1);
  assert.ok(preview.body.lines[0].id < 0);
  assert.equal(preview.body.lines[0].currency, "USD");
  assert.equal((await statementLines(clientId)).length, 0);
  const history = await request<Array<{
    id: number;
    outcome: string;
    detectedCurrency: string | null;
    importedLineCount: number;
    sourceUrl: string | null;
  }>>(`/agaraccounting/statement-imports?clientId=${clientId}`, undefined, primaryUserId);
  assert.equal(history.response.status, 200);
  assert.equal(history.body.length, 1);
  assert.equal(history.body[0].id, preview.body.importId);
  assert.equal(history.body[0].outcome, "pending_confirmation");
  assert.equal(history.body[0].detectedCurrency, "USD");
  assert.equal(history.body[0].importedLineCount, 0);
  assert.equal(history.body[0].sourceUrl, null);

  const confirmed = await request<ImportResult>("/agaraccounting/import-statement", {
    method: "POST",
    body: JSON.stringify({
      importId: preview.body.importId,
      clientId,
      fileName,
      mimeType: "text/csv",
      objectPath,
      currency: "USD",
      confirmed: true,
    }),
  }, primaryUserId);
  assert.equal(confirmed.response.status, 201);
  assert.equal(confirmed.body.importedCount, 1);
  assert.equal(confirmed.body.lines[0].currency, "USD");
  const loadedLines = await statementLines(clientId);
  assert.equal(loadedLines.length, 1);
  assert.equal(loadedLines[0].currency, "USD");

  const confirmedHistory = await request<Array<{ id: number; outcome: string; importedLineCount: number }>>(
    `/agaraccounting/statement-imports?clientId=${clientId}`,
    undefined,
    primaryUserId,
  );
  assert.equal(confirmedHistory.body.length, 1);
  assert.equal(confirmedHistory.body[0].id, preview.body.importId);
  assert.equal(confirmedHistory.body[0].outcome, "completed");
  assert.equal(confirmedHistory.body[0].importedLineCount, 1);
});

test("continues statement analysis after returning a durable background job", async () => {
  assert.ok(database);
  const clientId = await createClient(`Background analysis ${randomUUID()}`);
  const fileName = "background-analysis.csv";
  const objectPath = `/objects/uploads/${encodeURIComponent(primaryUserId)}/${clientId}/${randomUUID()}`;
  statementFiles.set(objectPath, Buffer.from("Bank Statement\nCurrency: AED\nDate,Description,Debit,Credit\n2026-08-25,background-slow,100,"));

  const started = await request<ImportResult>("/agaraccounting/import-statement", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      fileName,
      mimeType: "text/csv",
      objectPath,
      confirmed: false,
      background: true,
    }),
  }, primaryUserId);
  assert.equal(started.response.status, 202);
  assert.equal(started.body.importStatus, "analyzing");
  assert.ok(started.body.importId);

  const [analyzingImport] = await database.db.select().from(database.statementImportsTable)
    .where(eq(database.statementImportsTable.id, started.body.importId as number));
  assert.equal(analyzingImport?.outcome, "analyzing");
  assert.equal(analyzingImport?.objectPath, objectPath);
  assert.equal(analyzingImport?.previewData, null);

  let readyImport: {
    id: number;
    outcome: string;
    importedLineCount: number;
    preview: ImportResult | null;
  } | undefined;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const history = await request<Array<typeof readyImport>>(
      `/agaraccounting/statement-imports?clientId=${clientId}`,
      undefined,
      primaryUserId,
    );
    readyImport = history.body.find((statementImport) => statementImport?.id === started.body.importId);
    if (readyImport?.outcome === "pending_confirmation") break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(readyImport?.outcome, "pending_confirmation");
  assert.equal(readyImport?.importedLineCount, 0);
  assert.equal(readyImport?.preview?.importStatus, "preview");
  assert.equal(readyImport?.preview?.lines.length, 1);
  assert.equal((await statementLines(clientId)).length, 0);
  const reviewedLine = readyImport?.preview?.lines[0];
  assert.ok(reviewedLine);
  const aiRequestCountAfterPreview = aiRequests.length;

  const confirmed = await request<ImportResult>("/agaraccounting/import-statement", {
    method: "POST",
    body: JSON.stringify({
      importId: started.body.importId,
      clientId,
      fileName,
      mimeType: "text/csv",
      objectPath,
      currency: "AED",
      confirmed: true,
    }),
  }, primaryUserId);
  assert.equal(confirmed.response.status, 201);
  assert.equal(confirmed.body.importedCount, 1);
  assert.equal(aiRequests.length, aiRequestCountAfterPreview);
  assert.equal(confirmed.body.lines[0]?.description, reviewedLine.description);
  assert.equal(confirmed.body.lines[0]?.currency, reviewedLine.currency);
  assert.equal(confirmed.body.lines[0]?.accountSuggestion, reviewedLine.accountSuggestion);
  assert.equal((await statementLines(clientId)).length, 1);
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

  const accounts = await request<Array<{ id: number; bankName: string | null }>>(`/agaraccounting/bank-accounts?clientId=${clientId}`);
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
  }>>(`/agaraccounting/uploaded-files?clientId=${clientId}`);
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
    `/agaraccounting/uploaded-files?clientId=${clientId}`,
    undefined,
    secondaryUserId,
  );
  assert.equal(foreignList.response.status, 403);

  const foreignSource = await request<{ error: string }>(
    `/agaraccounting/statement-imports/${completed.id}/source`,
    undefined,
    secondaryUserId,
  );
  assert.equal(foreignSource.response.status, 403);

  const expiredSource = await request<{ error: string }>(
    `/agaraccounting/statement-imports/${expired.id}/source`,
  );
  assert.equal(expiredSource.response.status, 404);

  await database.db.insert(database.clientWorkspacesTable).values({
    clientId,
    userId: secondaryUserId,
    role: "bookkeeper",
  });
  const teamMemberFiles = await request<Array<{ id: number }>>(
    `/agaraccounting/uploaded-files?clientId=${clientId}`,
    undefined,
    secondaryUserId,
  );
  assert.equal(teamMemberFiles.response.status, 200);
  assert.deepEqual(teamMemberFiles.body.map((file) => file.id), files.body.map((file) => file.id));
});

test("serves a private PDF inline with a safe name and downloads it only when requested", async () => {
  assert.ok(database);
  const clientId = await createClient(`Source preview ${randomUUID()}`);
  const objectPath = `/objects/uploads/${encodeURIComponent(primaryUserId)}/${clientId}/${randomUUID()}`;
  const pdf = Buffer.from("%PDF-1.7\nstatement preview fixture");
  statementFiles.set(objectPath, pdf);
  const [statementImport] = await database.db.insert(database.statementImportsTable).values({
    clientId,
    fileName: "Quarterly statement (final).pdf",
    mimeType: "application/octet-stream",
    objectPath,
    fileHash: randomUUID(),
    outcome: "completed",
    importedLineCount: 1,
    evidenceExpiresAt: new Date(Date.now() + 60_000),
  }).returning();

  const preview = await fetch(`${baseUrl}/agaraccounting/statement-imports/${statementImport.id}/source`, {
    headers: { "x-test-user-id": primaryUserId },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-type"), "application/pdf");
  assert.equal(preview.headers.get("content-disposition"), 'inline; filename="Quarterly_statement__final_.pdf"');
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), pdf);

  const download = await fetch(`${baseUrl}/agaraccounting/statement-imports/${statementImport.id}/source?download=1`, {
    headers: { "x-test-user-id": primaryUserId },
  });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-disposition"), 'attachment; filename="Quarterly_statement__final_.pdf"');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);

  const inaccessible = await fetch(`${baseUrl}/agaraccounting/statement-imports/${statementImport.id}/source`, {
    headers: { "x-test-user-id": secondaryUserId },
  });
  assert.equal(inaccessible.status, 403);

  statementFiles.delete(objectPath);
  const missing = await fetch(`${baseUrl}/agaraccounting/statement-imports/${statementImport.id}/source`, {
    headers: { "x-test-user-id": primaryUserId },
  });
  assert.equal(missing.status, 404);
});

test("stages deterministic description recodes before directly posting draft entries", async () => {
  const clientId = await createClient(`AI action scope ${randomUUID()}`);
  const createdLine = await request<{ id: number; accountSuggestion: string }>("/agaraccounting/statement-lines", {
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
    applied?: boolean;
    requiresConfirmation?: boolean;
  };
  type CopilotResponse = { answer: string; recommendations: Recommendation[] };
  const classification = await request<CopilotResponse>("/agaraccounting/ai-chat", {
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
  assert.equal(classification.body.recommendations[0]?.applied, true);
  assert.equal(classification.body.recommendations[0]?.requiresConfirmation, false);

  const mixedRequest = await request<CopilotResponse>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      message: "Classify all transactions matching Acme invoice as Software & subscriptions and post them.",
    }),
  });
  assert.equal(mixedRequest.response.status, 200);
  assert.equal(mixedRequest.body.recommendations.length, 0);
  assert.match(mixedRequest.body.answer, /separate steps/i);

  const journalEntries = await request<Array<{ id: number; statementLineId: number; status: string; lines?: Array<{ account: string }> }>>(
    `/agaraccounting/journal-entries?clientId=${clientId}`,
  );
  assert.equal(journalEntries.response.status, 200);
  const entry = journalEntries.body.find((item) => item.statementLineId === createdLine.body.id);
  assert.ok(entry);
  assert.equal(entry.status, "draft");
  assert.equal((await request(`/agaraccounting/statement-lines/${createdLine.body.id}/contact`, {
    method: "PATCH",
    body: JSON.stringify({ clientId, contactId: null, contactReviewDisposition: "dismissed" }),
  })).response.status, 200);

  const approvalRequest = await request<CopilotResponse>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({ clientId, message: "Approve all suggested entries." }),
  });
  assert.equal(approvalRequest.response.status, 200);
  assert.deepEqual(approvalRequest.body.recommendations, []);
  assert.match(approvalRequest.body.answer, /approval is no longer a separate stage/i);

  const postingCard = await request<CopilotResponse>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({ clientId, message: "Post all draft entries." }),
  });
  assert.equal(postingCard.response.status, 200);
  assert.equal(postingCard.body.recommendations[0]?.type, "bulk_post_entries");
  const posting = await request<{ toStatus: string }>("/agaraccounting/ai-actions/confirm", {
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

  const audits = await request<Array<{ transition: string; actor: { id: string } }>>(`/agaraccounting/bulk-transition-audits?clientId=${clientId}`);
  assert.equal(audits.response.status, 200);
  assert.deepEqual(audits.body.map((audit) => audit.transition), ["bulk_post_entries"]);
  assert.ok(audits.body.every((audit) => audit.actor.id === primaryUserId));
});

test("persists isolated copilot threads and returns complete grounded results across follow-ups", async () => {
  assert.ok(database);
  const clientId = await createClient(`Durable copilot ${randomUUID()}`);
  const seededLines = await database.db.insert(database.statementLinesTable).values(
    Array.from({ length: 65 }, (_, index) => ({
      clientId,
      date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
      description: `Grounded merchant ${String(index + 1).padStart(2, "0")}`,
      currency: index % 2 === 0 ? "USD" : "AED",
      amount: String(100 + index),
      direction: "outflow" as const,
      status: "draft" as const,
      source: "Copilot test",
      accountSuggestion: "Software & subscriptions",
      confidence: "0.90",
    })),
  ).returning();
  const seededEntries = await database.db.insert(database.journalEntriesTable).values(seededLines.map((line) => ({
    clientId,
    statementLineId: line.id,
    date: line.date,
    memo: line.description,
    currency: line.currency,
    status: "draft" as const,
    confidence: "0.90",
    debitAccount: "Software & subscriptions",
    creditAccount: "Bank / cash",
    amount: line.amount,
  }))).returning();

  const created = await request<{
    id: number;
    clientId: number;
    turns: unknown[];
  }>("/agaraccounting/ai-conversations", {
    method: "POST",
    body: JSON.stringify({ clientId, title: "August exception review" }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.clientId, clientId);
  assert.deepEqual(created.body.turns, []);

  const invalidCurrency = await request<{ error: string }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      threadId: created.body.id,
      message: "Find transactions.",
      filters: { currency: "US" },
    }),
  });
  assert.equal(invalidCurrency.response.status, 400);
  assert.match(invalidCurrency.body.error, /three-letter ISO currency code/i);

  const first = await request<{
    threadId: number;
    results: Array<{ complete: boolean; rows: Array<{ id: number }>; totals: { count: number } }>;
    citations: Array<{ recordId: number; href: string }>;
  }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      threadId: created.body.id,
      message: "Find all outflow transactions.",
      filters: { direction: "outflow" },
    }),
  });
  assert.equal(first.response.status, 200);
  assert.equal(first.body.threadId, created.body.id);
  assert.equal(first.body.results[0]?.complete, true);
  assert.equal(first.body.results[0]?.rows.length, 65);
  assert.equal(first.body.results[0]?.totals.count, 65);
  assert.equal(first.body.citations.length, 65);
  assert.ok(first.body.citations.every((citation) => citation.href.includes(`lineId=${citation.recordId}`)));

  const followUp = await request<{
    results: Array<{ rows: Array<{ currency: string; direction: string }> }>;
  }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      threadId: created.body.id,
      message: "Find transactions, but only USD.",
    }),
  });
  assert.equal(followUp.response.status, 200);
  assert.equal(followUp.body.results[0]?.rows.length, 33);
  assert.ok(followUp.body.results[0]?.rows.every((row) => row.currency === "USD" && row.direction === "outflow"));

  const periodFiltered = await request<{ results: Array<{ rows: unknown[] }> }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      threadId: created.body.id,
      message: "Find transactions for period 2025.",
    }),
  });
  assert.equal(periodFiltered.response.status, 200);
  assert.equal(periodFiltered.body.results[0]?.rows.length, 0);

  const resetFilters = await request<{
    results: Array<{ rows: unknown[]; totals: { outflowByCurrency: Record<string, number> } }>;
  }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      threadId: created.body.id,
      message: "Reset filters and show all transactions.",
    }),
  });
  assert.equal(resetFilters.response.status, 200);
  assert.equal(resetFilters.body.results[0]?.rows.length, 65);
  assert.deepEqual(Object.keys(resetFilters.body.results[0]?.totals.outflowByCurrency).sort(), ["AED", "USD"]);

  const resumed = await request<{
    scope: { direction?: string; currency?: string };
    turns: Array<{ role: string; response?: { threadId?: number } }>;
  }>(`/agaraccounting/ai-conversations/${created.body.id}`);
  assert.equal(resumed.response.status, 200);
  assert.deepEqual(resumed.body.scope, {});
  assert.equal(resumed.body.turns.length, 8);
  assert.equal(resumed.body.turns.at(-1)?.response?.threadId, created.body.id);

  await database.db.update(database.statementLinesTable).set({ status: "posted" })
    .where(inArray(database.statementLinesTable.id, seededLines.slice(0, 2).map((line) => line.id)));
  await database.db.update(database.journalEntriesTable).set({ status: "posted" })
    .where(inArray(database.journalEntriesTable.id, seededEntries.slice(0, 2).map((entry) => entry.id)));
  const statements = await request<{
    results: Array<{
      kind: string;
      complete: boolean;
      rows: Array<{ section: string; currency: string }>;
      totals: { functionalCurrency: string; missingRateCount: number };
    }>;
  }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      threadId: created.body.id,
      message: "Explain the financial statements for period 2026.",
    }),
  });
  assert.equal(statements.response.status, 200);
  assert.equal(statements.body.results[0]?.kind, "financial_statements");
  assert.equal(statements.body.results[0]?.complete, false);
  assert.equal(statements.body.results[0]?.totals.functionalCurrency, "AED");
  assert.equal(statements.body.results[0]?.totals.missingRateCount, 1);
  assert.ok(statements.body.results[0]?.rows.some((row) => row.section === "Income statement"));
  assert.ok(statements.body.results[0]?.rows.every((row) => row.currency === "AED"));

  const priorPeriodTrialBalance = await request<{
    results: Array<{ kind: string; rows: unknown[]; totals: { totalDebit: number; totalCredit: number } }>;
  }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      threadId: created.body.id,
      message: "Show the trial balance for period 2025.",
    }),
  });
  assert.equal(priorPeriodTrialBalance.response.status, 200);
  assert.equal(priorPeriodTrialBalance.body.results[0]?.kind, "trial_balance");
  assert.deepEqual(priorPeriodTrialBalance.body.results[0]?.rows, []);
  assert.equal(priorPeriodTrialBalance.body.results[0]?.totals.totalDebit, 0);
  assert.equal(priorPeriodTrialBalance.body.results[0]?.totals.totalCredit, 0);

  const renamed = await request<{ title: string }>(`/agaraccounting/ai-conversations/${created.body.id}`, {
    method: "PATCH",
    body: JSON.stringify({ clientId, title: "USD outflow review" }),
  });
  assert.equal(renamed.response.status, 200);
  assert.equal(renamed.body.title, "USD outflow review");

  const dormant = await request<{ id: number }>("/agaraccounting/ai-conversations", {
    method: "POST",
    body: JSON.stringify({ clientId, title: "Expired conversation" }),
  });
  assert.equal(dormant.response.status, 201);
  const expiredAt = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
  await database.db.insert(database.assistantTurnsTable).values({
    threadId: dormant.body.id,
    role: "user",
    content: "Old accounting context",
    createdAt: expiredAt,
  });
  await database.db.update(database.assistantThreadsTable).set({
    scope: { currency: "USD" },
    updatedAt: expiredAt,
  }).where(eq(database.assistantThreadsTable.id, dormant.body.id));
  const afterRetention = await request<Array<{ id: number; status: string }>>(
    `/agaraccounting/ai-conversations?clientId=${clientId}`,
  );
  assert.equal(afterRetention.response.status, 200);
  assert.equal(afterRetention.body.find((thread) => thread.id === dormant.body.id)?.status, "cleared");
  const expiredConversation = await request<{ scope: Record<string, unknown>; turns: unknown[] }>(
    `/agaraccounting/ai-conversations/${dormant.body.id}`,
  );
  assert.deepEqual(expiredConversation.body.scope, {});
  assert.deepEqual(expiredConversation.body.turns, []);

  await database.db.insert(database.clientWorkspacesTable).values({
    clientId,
    userId: secondaryUserId,
    role: "bookkeeper",
  });
  const foreignThread = await request<{ error: string }>(
    `/agaraccounting/ai-conversations/${created.body.id}`,
    undefined,
    secondaryUserId,
  );
  assert.equal(foreignThread.response.status, 404);
  const foreignList = await request<unknown[]>(
    `/agaraccounting/ai-conversations?clientId=${clientId}`,
    undefined,
    secondaryUserId,
  );
  assert.equal(foreignList.response.status, 200);
  assert.deepEqual(foreignList.body, []);

  const otherClientId = await createClient(`Other copilot client ${randomUUID()}`);
  const crossClient = await request<{ error: string }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId: otherClientId,
      threadId: created.body.id,
      message: "Find transactions.",
    }),
  });
  assert.equal(crossClient.response.status, 409);
  assert.match(crossClient.body.error, /cannot cross client workspaces/i);

  const cleared = await request<unknown>(`/agaraccounting/ai-conversations/${created.body.id}`, {
    method: "DELETE",
  });
  assert.equal(cleared.response.status, 204);
  const afterClear = await request<{ status: string; scope: Record<string, unknown>; turns: unknown[] }>(
    `/agaraccounting/ai-conversations/${created.body.id}`,
  );
  assert.equal(afterClear.response.status, 200);
  assert.equal(afterClear.body.status, "cleared");
  assert.deepEqual(afterClear.body.scope, {});
  assert.deepEqual(afterClear.body.turns, []);
});

test("keeps workspace AI credentials redacted, isolated, rotatable, and routes extraction through the selected provider", async () => {
  const primaryClientId = await createClient(`AI provider primary ${randomUUID()}`);
  const secondaryClientId = await createClient(`AI provider secondary ${randomUUID()}`, secondaryUserId);
  const defaultSettings = await request<{ provider: string; credentialLast4: string | null }>(
    `/agaraccounting/ai-settings?clientId=${primaryClientId}`,
  );
  assert.equal(defaultSettings.response.status, 200);
  assert.equal(defaultSettings.body.provider, "managed_openai");
  assert.equal(defaultSettings.body.credentialLast4, null);

  const missingKey = await request<{ error: string }>("/agaraccounting/ai-settings", {
    method: "PUT",
    body: JSON.stringify({ clientId: primaryClientId, provider: "anthropic", model: "claude-3-5-sonnet-latest" }),
  });
  assert.equal(missingKey.response.status, 400);
  assert.match(missingKey.body.error, /add an api key/i);

  const saved = await request<Record<string, unknown>>("/agaraccounting/ai-settings", {
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
    `/agaraccounting/ai-settings?clientId=${secondaryClientId}`,
  );
  assert.equal(crossWorkspaceRead.response.status, 403);

  const rotated = await request<Record<string, unknown>>("/agaraccounting/ai-settings", {
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

  const tested = await request<{ credentialStatus: string; lastTestedAt: string | null }>("/agaraccounting/ai-settings/test", {
    method: "POST",
    body: JSON.stringify({ clientId: primaryClientId }),
  });
  assert.equal(tested.response.status, 200);
  assert.equal(tested.body.credentialStatus, "configured");
  assert.ok(tested.body.lastTestedAt);

  const routedImport = await importStatement(primaryClientId, "anthropic-provider.csv", "anthropic-provider");
  assert.equal(routedImport.response.status, 201);
  assert.ok(aiRequests.some((item) => item.path === "/v1/messages" && item.credential === "anthropic-rotated-key-5678"));
  const routedChat = await request<{ answer: string }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({ clientId: primaryClientId, message: "What should I review first?" }),
  });
  assert.equal(routedChat.response.status, 200);
  assert.ok(routedChat.body.answer.length > 0);
  assert.ok(aiRequests.filter((item) => item.path === "/v1/messages" && item.credential === "anthropic-rotated-key-5678").length >= 2);

  const invalid = await request<Record<string, unknown>>("/agaraccounting/ai-settings", {
    method: "PUT",
    body: JSON.stringify({
      clientId: primaryClientId,
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "invalid-key",
    }),
  });
  assert.equal(invalid.response.status, 200);
  const invalidTest = await request<{ error: string }>("/agaraccounting/ai-settings/test", {
    method: "POST",
    body: JSON.stringify({ clientId: primaryClientId }),
  });
  assert.equal(invalidTest.response.status, 502);
  assert.match(invalidTest.body.error, /credential was rejected/i);

  const fallbackImport = await importStatement(
    primaryClientId,
    "counterparty-fallback.csv",
    "Visa Purchase Circle Espergerde Dkk Susanne Chris Aed",
  );
  assert.equal(fallbackImport.response.status, 201);
  assert.equal(fallbackImport.body.lines[0]?.proposedContactName, "Circle Espergerde");
  assert.equal(fallbackImport.body.lines[0]?.proposedContactSource, "heuristic_description");

  const removed = await request<{ provider: string; credentialLast4: string | null }>("/agaraccounting/ai-settings/credential", {
    method: "DELETE",
    body: JSON.stringify({ clientId: primaryClientId }),
  });
  assert.equal(removed.response.status, 200);
  assert.equal(removed.body.provider, "managed_openai");
  assert.equal(removed.body.credentialLast4, null);

  const managedImport = await importStatement(primaryClientId, "managed-provider.csv", "managed-provider");
  assert.equal(managedImport.response.status, 201);
  assert.ok(aiRequests.some((item) => item.path === "/v1/chat/completions" && item.credential === "agaraccounting-test-openai-key"));
});

test("prepares description-scoped recoding and direct draft posting as separate confirmed actions", async () => {
  const clientId = await createClient(`AI batch scope ${randomUUID()}`);
  for (const [date, amount] of [["2026-08-23", 150], ["2026-08-24", 250]] as const) {
    const created = await request<{ id: number }>("/agaraccounting/statement-lines", {
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
    assert.equal((await request(`/agaraccounting/statement-lines/${created.body.id}/contact`, {
      method: "PATCH",
      body: JSON.stringify({ clientId, contactId: null, contactReviewDisposition: "dismissed" }),
    })).response.status, 200);
  }

  const recode = await request<{ recommendations: AIRecommendation[] }>("/agaraccounting/ai-chat", {
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
  ]) {
    const mixedRequest = await request<{ answer: string; recommendations: AIRecommendation[] }>("/agaraccounting/ai-chat", {
      method: "POST",
      body: JSON.stringify({ clientId, message: mixedInstruction }),
    });
    assert.equal(mixedRequest.response.status, 200);
    assert.equal(mixedRequest.body.recommendations.length, 0);
    assert.match(mixedRequest.body.answer, /separate steps/i);
  }

  const recodeConfirmation = await request<{ updatedLineCount: number }>("/agaraccounting/ai-actions/confirm", {
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

  const approvalRequest = await request<{ answer: string; recommendations: AIRecommendation[] }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      message: "Approve all pending entries with description SUNWEB GROUP GMBH.",
    }),
  });
  assert.equal(approvalRequest.response.status, 200);
  assert.deepEqual(approvalRequest.body.recommendations, []);
  assert.match(approvalRequest.body.answer, /approval is no longer a separate stage/i);

  const posting = await request<{ recommendations: AIRecommendation[] }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      message: "Post all draft entries with description SUNWEB GROUP GMBH.",
    }),
  });
  assert.equal(posting.response.status, 200);
  const postingRecommendation = posting.body.recommendations[0];
  const postingConfirmation = await request<{ toStatus: string; updatedLineCount: number }>("/agaraccounting/ai-actions/confirm", {
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

test("matches Boldt contact scopes for posting and Transportation recode confirmations", async () => {
  const clientId = await createClient(`AI Boldt contact scope ${randomUUID()}`);
  const contact = await request<{ id: number }>("/agaraccounting/contacts", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      displayName: "Boldt Automobiler Aps",
      legalName: "Boldt Automobiler Aps",
      contactType: "supplier",
      aliases: ["BOLDT AUTOMOBILER"],
    }),
  });
  assert.equal(contact.response.status, 201);

  const lineIds: number[] = [];
  for (const [date, amount] of [["2026-08-20", 420], ["2026-08-21", 380]] as const) {
    const created = await request<{ id: number }>("/agaraccounting/statement-lines", {
      method: "POST",
      body: JSON.stringify({
        clientId,
        date,
        description: "BOLDT AUTOMOBILER IMLEBAEK",
        currency: "AED",
        amount,
        direction: "outflow",
      }),
    });
    assert.equal(created.response.status, 201);
    lineIds.push(created.body.id);
    assert.equal((await request(`/agaraccounting/statement-lines/${created.body.id}/contact`, {
      method: "PATCH",
      body: JSON.stringify({ clientId, contactId: contact.body.id }),
    })).response.status, 200);
  }

  const recode = await request<{ answer: string; recommendations: AIRecommendation[] }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      message: "batch update chart account for Boldt Automobiler to Transportation",
    }),
  });
  assert.equal(recode.response.status, 200);
  const recodeRecommendation = recode.body.recommendations[0];
  assert.equal(recodeRecommendation?.type, "recode_lines");
  assert.equal(recodeRecommendation?.accountSuggestion, "Business travel");
  assert.equal(recodeRecommendation?.lineIds?.length, 2);
  assert.match(recodeRecommendation?.summary ?? "", /Transportation/i);
  assert.match(recodeRecommendation?.summary ?? "", /Business travel/i);

  const recodeConfirmation = await request<{ updatedLineCount: number }>("/agaraccounting/ai-actions/confirm", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      type: recodeRecommendation?.type,
      lineIds: recodeRecommendation?.lineIds,
      accountSuggestion: recodeRecommendation?.accountSuggestion,
    }),
  });
  assert.equal(recodeConfirmation.response.status, 200);
  assert.equal(recodeConfirmation.body.updatedLineCount, 2);

  const posting = await request<{ answer: string; recommendations: AIRecommendation[] }>("/agaraccounting/ai-chat", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      message: "post all boldt automobiler aps statement lines",
    }),
  });
  assert.equal(posting.response.status, 200);
  assert.doesNotMatch(posting.body.answer, /BOLDT AUTOMOBILER APS STATEMENT/i);
  const postingRecommendation = posting.body.recommendations[0];
  assert.equal(postingRecommendation?.type, "bulk_post_entries");
  assert.equal(postingRecommendation?.entryCount, 2);
  assert.equal(postingRecommendation?.lineCount, 2);
  assert.deepEqual([...(postingRecommendation?.statementLineIds ?? [])].sort((a, b) => a - b), lineIds.slice().sort((a, b) => a - b));
  assert.match(postingRecommendation?.summary ?? "", /description or contact/i);

  const unconfirmed = await request<Array<{ id: number; status: string }>>(
    `/agaraccounting/statement-lines?clientId=${clientId}`,
  );
  assert.ok(unconfirmed.body.every((line) => line.status === "draft"));

  const postingConfirmation = await request<{ toStatus: string; updatedLineCount: number }>("/agaraccounting/ai-actions/confirm", {
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

test("filters statement lines by receipts or payments with client, currency, and status scopes", async () => {
  assert.ok(database);
  const clientId = await createClient(`Statement direction filters ${randomUUID()}`);
  const lines = [
    { description: "Direction receipt AED", currency: "AED", amount: 100, direction: "inflow" },
    { description: "Direction payment AED", currency: "AED", amount: 200, direction: "outflow" },
    { description: "Direction payment USD", currency: "USD", amount: 300, direction: "outflow" },
    { description: "Direction receipt USD", currency: "USD", amount: 400, direction: "inflow" },
  ];
  for (const line of lines) {
    const created = await request<{ id: number }>("/agaraccounting/statement-lines", {
      method: "POST",
      body: JSON.stringify({ clientId, date: "2026-08-26", ...line }),
    });
    assert.equal(created.response.status, 201);
  }

  const receipts = await request<Array<{ description: string; direction: string }>>(
    `/agaraccounting/statement-lines?clientId=${clientId}&direction=inflow`,
  );
  assert.deepEqual(receipts.body.map((line) => line.description).sort(), [
    "Direction receipt AED",
    "Direction receipt USD",
  ]);
  assert.ok(receipts.body.every((line) => line.direction === "inflow"));

  const payments = await request<Array<{ description: string; direction: string }>>(
    `/agaraccounting/statement-lines?clientId=${clientId}&direction=outflow`,
  );
  assert.deepEqual(payments.body.map((line) => line.description).sort(), [
    "Direction payment AED",
    "Direction payment USD",
  ]);
  assert.ok(payments.body.every((line) => line.direction === "outflow"));

  const combined = await request<Array<{ description: string; currency: string; status: string }>>(
    `/agaraccounting/statement-lines?clientId=${clientId}&direction=outflow&currency=USD&status=draft`,
  );
  assert.deepEqual(combined.body.map((line) => line.description), ["Direction payment USD"]);
  assert.ok(combined.body.every((line) => line.currency === "USD" && line.status === "draft"));

  const empty = await request<unknown[]>(
    `/agaraccounting/statement-lines?clientId=${clientId}&direction=inflow&currency=GBP`,
  );
  assert.deepEqual(empty.body, []);

  const invalid = await fetch(
    `${baseUrl}/agaraccounting/statement-lines?clientId=${clientId}&direction=refund`,
    { headers: { "x-test-user-id": primaryUserId } },
  );
  assert.equal(invalid.status, 400);
});

test("resends a pending invitation with its approved scope and invalidates the earlier link", async () => {
  const suffix = randomUUID();
  const client = await request<{ id: number; name: string }>("/clients", {
    method: "POST",
    body: JSON.stringify({ name: `Resend scope ${suffix}`, legalName: `Resend scope ${suffix} LLC` }),
  });
  assert.equal(client.response.status, 201);
  createdClientIds.push(client.body.id);

  const invitedUserId = `agaraccounting-resend-bookkeeper-${suffix}`;
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
    emailDeliveryStatus: "sent";
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
  assert.equal(created.body.emailDeliveryStatus, "sent");
  assert.match(created.body.emailSubject, /invited to agaraccounting ai system/i);
  assert.match(created.body.emailBody, /invited you to agaraccounting ai system/i);
  assert.match(created.body.emailBody, /as an admin/i);
  assert.match(created.body.emailBody, new RegExp(client.body.name));
  assert.match(created.body.emailBody, /expires on/i);

  const originalToken = new URL(created.body.inviteLink).searchParams.get("invite");
  assert.ok(originalToken);
  const resent = await request<InvitationEmail>(`/workspace/invitations/${created.body.id}/resend`, {
    method: "POST",
  });
  assert.equal(resent.response.status, 200);
  assert.equal(resent.body.emailDeliveryStatus, "sent");
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

test("reports email delivery failures and removes an unsent new invitation", async () => {
  const suffix = randomUUID();
  const clientId = await createClient(`Failed delivery ${suffix}`);
  const invitedEmail = `failed-delivery-${suffix}@example.test`;

  process.env.AGARACCOUNTING_EMAIL_TEST_MODE = "failure";
  try {
    const invitation = await request<{ error: string }>("/workspace/invitations", {
      method: "POST",
      body: JSON.stringify({
        email: invitedEmail,
        role: "bookkeeper",
        clientIds: [clientId],
      }),
    });
    assert.equal(invitation.response.status, 502);
    assert.match(invitation.body.error, /not sent/i);

    assert.ok(database);
    const unsentInvitations = await database.db.select({ id: database.workspaceInvitationsTable.id })
      .from(database.workspaceInvitationsTable)
      .where(eq(database.workspaceInvitationsTable.email, invitedEmail));
    assert.equal(unsentInvitations.length, 0);
  } finally {
    process.env.AGARACCOUNTING_EMAIL_TEST_MODE = "success";
  }
});

test("requires the AgarAccounting canonical URL before persisting an invitation", async () => {
  const suffix = randomUUID();
  const clientId = await createClient(`Missing canonical URL ${suffix}`);
  const invitedEmail = `missing-canonical-url-${suffix}@example.test`;
  const publicUrl = process.env.AGARACCOUNTING_PUBLIC_URL;
  const nodeEnv = process.env.NODE_ENV;
  delete process.env.AGARACCOUNTING_PUBLIC_URL;
  process.env.NODE_ENV = "production";
  process.env.LEDGERFLOW_PUBLIC_URL = "https://legacy-ledgerflow.example.test/";
  try {
    const invitation = await request<{ error: string }>("/workspace/invitations", {
      method: "POST",
      body: JSON.stringify({
        email: invitedEmail,
        role: "bookkeeper",
        clientIds: [clientId],
      }),
    });
    assert.equal(invitation.response.status, 502);
    assert.match(invitation.body.error, /not sent/i);

    assert.ok(database);
    const invitations = await database.db.select({ id: database.workspaceInvitationsTable.id })
      .from(database.workspaceInvitationsTable)
      .where(eq(database.workspaceInvitationsTable.email, invitedEmail));
    assert.equal(invitations.length, 0);
  } finally {
    if (publicUrl === undefined) delete process.env.AGARACCOUNTING_PUBLIC_URL;
    else process.env.AGARACCOUNTING_PUBLIC_URL = publicUrl;
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    delete process.env.LEDGERFLOW_PUBLIC_URL;
  }
});

test("keeps a failed resend pending with its previous link invalidated and allows retry", async () => {
  const suffix = randomUUID();
  const clientId = await createClient(`Resend failure ${suffix}`);
  const invitedUserId = `agaraccounting-resend-failure-${suffix}`;
  const invitedEmail = `${invitedUserId}@example.test`;
  assert.ok(database);
  await database.db.insert(database.usersTable).values({
    id: invitedUserId,
    email: invitedEmail,
    firstName: "Retry",
    lastName: "Recipient",
  });
  createdUserIds.push(invitedUserId);

  const created = await request<{ id: number; inviteLink: string }>("/workspace/invitations", {
    method: "POST",
    body: JSON.stringify({
      email: invitedEmail,
      role: "bookkeeper",
      clientIds: [clientId],
    }),
  });
  assert.equal(created.response.status, 201);
  const originalToken = new URL(created.body.inviteLink).searchParams.get("invite");
  assert.ok(originalToken);

  process.env.AGARACCOUNTING_EMAIL_TEST_MODE = "failure";
  try {
    const failedResend = await request<{ error: string }>(`/workspace/invitations/${created.body.id}/resend`, {
      method: "POST",
    });
    assert.equal(failedResend.response.status, 502);
    assert.match(failedResend.body.error, /not sent/i);
  } finally {
    process.env.AGARACCOUNTING_EMAIL_TEST_MODE = "success";
  }

  const invalidated = await request<{ error: string }>(`/workspace/invitations/${originalToken}/accept`, {
    method: "POST",
  }, invitedUserId);
  assert.equal(invalidated.response.status, 404);

  const retried = await request<{ inviteLink: string; emailDeliveryStatus: "sent" }>(
    `/workspace/invitations/${created.body.id}/resend`,
    { method: "POST" },
  );
  assert.equal(retried.response.status, 200);
  assert.equal(retried.body.emailDeliveryStatus, "sent");
  const retryToken = new URL(retried.body.inviteLink).searchParams.get("invite");
  assert.ok(retryToken);
  assert.notEqual(retryToken, originalToken);

  const accepted = await request<{ role: string }>(`/workspace/invitations/${retryToken}/accept`, {
    method: "POST",
  }, invitedUserId);
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.role, "bookkeeper");
});

test("prepares unfamiliar exchange-rate CSV data without importing it", async () => {
  const clientId = await createClient(`AI rate preview ${randomUUID()}`);
  const preview = await request<{
    mapping: { effectiveDate: string | null; sourceCurrency: string | null; functionalCurrency: string | null; rate: string | null; source: string | null; note: string | null };
    rates: Array<{ effectiveDate: string; sourceCurrency: string; functionalCurrency: string; rate: number; source: string; note: string | null }>;
    warnings: string[];
    confidence: number;
  }>("/agaraccounting/exchange-rates/parse", {
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
  }>("/agaraccounting/exchange-rates/parse", {
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
