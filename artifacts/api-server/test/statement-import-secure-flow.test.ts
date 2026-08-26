import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  aiActivityTable,
  aiProviderConfigsTable,
  clientsTable,
  clientWorkspacesTable,
  db,
  firmProfilesTable,
  journalEntriesTable,
  pool,
  statementImportsTable,
  statementLinesTable,
  usersTable,
} from "@workspace/db";

type PrivateUpload = { buffer: Buffer; contentType: string };

let app: typeof import("../src/app").default;
let server: Server | undefined;
let aiServer: Server | undefined;
let baseUrl = "";
let primaryUserId = "";
let secondaryUserId = "";
const clientIds: number[] = [];
const privateUploads = new Map<string, PrivateUpload>();

async function listen(serverToStart: Server) {
  await new Promise<void>((resolve, reject) => {
    serverToStart.listen(0, "127.0.0.1", resolve);
    serverToStart.once("error", reject);
  });
  const address = serverToStart.address() as AddressInfo;
  return address.port;
}

async function closeServer(serverToClose: Server | undefined) {
  if (!serverToClose) return;
  serverToClose.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    serverToClose.close((error) => error ? reject(error) : resolve());
  });
}

async function request<T>(path: string, body?: unknown, userId = primaryUserId) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      "x-test-user-id": userId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: await response.json() as T };
}

async function createClient(name: string, userId = primaryUserId) {
  const result = await request<{ id: number }>("/clients", {
    name,
    legalName: `${name} LLC`,
  }, userId);
  assert.equal(result.response.status, 201);
  clientIds.push(result.body.id);
  return result.body.id;
}

async function stagePrivateUpload(clientId: number, fileName: string, contentType: string, buffer: Buffer, userId = primaryUserId) {
  const staged = await request<{ objectPath: string }>("/storage/uploads/request-url", {
    clientId,
    name: fileName,
    size: buffer.length,
    contentType,
  }, userId);
  assert.equal(staged.response.status, 200);
  privateUploads.set(staged.body.objectPath, { buffer, contentType });
  return staged.body.objectPath;
}

async function importPrivatePdf(clientId: number, fileName: string, buffer: Buffer, userId = primaryUserId) {
  const objectPath = await stagePrivateUpload(clientId, fileName, "application/pdf", buffer, userId);
  return request<{
    importStatus: string;
    importedCount: number;
    duplicateCount: number;
    lines: Array<{ id: number }>;
  }>("/agaraccounting/import-statement", {
    clientId,
    fileName,
    mimeType: "application/pdf",
    objectPath,
    currency: "EUR",
    confirmed: true,
  }, userId);
}

before(async () => {
  if (!process.env.AGARACCOUNTING_TEST_DATABASE_URL) {
    throw new Error("AGARACCOUNTING_TEST_DATABASE_URL is required for statement import integration tests.");
  }
  process.env.PRIVATE_OBJECT_DIR = "/test-private";
  primaryUserId = `statement-import-primary-${randomUUID()}`;
  secondaryUserId = `statement-import-secondary-${randomUUID()}`;

  aiServer = (await import("node:http")).createServer((_req, res) => {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: { message: "provider unavailable" } }));
  });
  const aiPort = await listen(aiServer);
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "statement-import-test-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = `http://127.0.0.1:${aiPort}/v1`;
  process.env.AGARACCOUNTING_OPENAI_BASE_URL = `http://127.0.0.1:${aiPort}/v1`;

  const storage = await import("../src/routes/storage");
  storage.objectStorageService.getObjectEntityUploadURL = async (prefix) =>
    `https://storage.googleapis.com/test-private/${prefix}/${randomUUID()}`;
  storage.objectStorageService.getObjectEntityFile = async (objectPath) => {
    const upload = privateUploads.get(objectPath);
    if (!upload) throw new Error("Expected verified private upload was not staged.");
    return {
      getMetadata: async () => [{ size: String(upload.buffer.length), contentType: upload.contentType }],
      download: async () => [upload.buffer],
    } as never;
  };

  const { createApp } = await import("../src/app");
  const { createRequireAuth } = await import("../src/middlewares/authMiddleware");
  app = createApp({
    clerkAuthMiddleware: (_req, _res, next) => next(),
    requireAuthMiddleware: createRequireAuth(
      (req) => {
        const userId = req.header("x-test-user-id");
        return { userId: userId ? `clerk-${userId}` : undefined, sessionClaims: { userId } };
      },
      async (clerkUserId) => {
        const userId = clerkUserId.replace(/^clerk-/, "");
        return { email: `${userId}@example.test`, firstName: "Statement", lastName: "Tester" };
      },
    ),
  });
  await db.insert(usersTable).values([
    { id: primaryUserId, email: `${primaryUserId}@example.test` },
    { id: secondaryUserId, email: `${secondaryUserId}@example.test` },
  ]);
  server = (await import("node:http")).createServer(app);
  baseUrl = `http://127.0.0.1:${await listen(server)}/api`;
});

after(async () => {
  await Promise.all([closeServer(server), closeServer(aiServer)]);
  const userIds = [primaryUserId, secondaryUserId];
  const workspaceRows = await db.select({ clientId: clientWorkspacesTable.clientId })
    .from(clientWorkspacesTable)
    .where(inArray(clientWorkspacesTable.userId, userIds));
  const ownedClientIds = [...new Set([...clientIds, ...workspaceRows.map((workspace) => workspace.clientId)])];
  if (ownedClientIds.length) {
    await db.delete(aiProviderConfigsTable).where(inArray(aiProviderConfigsTable.clientId, ownedClientIds));
    await db.delete(aiActivityTable).where(inArray(aiActivityTable.clientId, ownedClientIds));
    await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.clientId, ownedClientIds));
    await db.delete(statementLinesTable).where(inArray(statementLinesTable.clientId, ownedClientIds));
    await db.delete(statementImportsTable).where(inArray(statementImportsTable.clientId, ownedClientIds));
    await db.delete(clientWorkspacesTable).where(inArray(clientWorkspacesTable.clientId, ownedClientIds));
    await db.delete(clientsTable).where(inArray(clientsTable.id, ownedClientIds));
  }
  await db.delete(firmProfilesTable).where(inArray(firmProfilesTable.ownerUserId, userIds));
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  if (process.env.AGARACCOUNTING_TEST_FOCUSED === "true") await pool.end();
});

test("imports a secure text PDF through the deterministic fallback and records exact re-uploads correctly", async () => {
  const fixture = Buffer.from(
    await readFile(new URL("./fixtures/mashreq-deterministic-fallback.pdf.base64", import.meta.url), "utf8"),
    "base64",
  );
  const primaryClientId = await createClient(`Secure import ${randomUUID()}`);
  const secondaryClientId = await createClient(`Secure import ${randomUUID()}`, secondaryUserId);

  const initial = await importPrivatePdf(primaryClientId, "mashreq-statement.pdf", fixture);
  assert.equal(initial.response.status, 201);
  assert.equal(initial.body.importStatus, "imported");
  assert.equal(initial.body.importedCount, 2);

  const duplicate = await importPrivatePdf(primaryClientId, "mashreq-statement-copy.pdf", fixture);
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.body.importStatus, "duplicate_file");
  assert.equal(duplicate.body.importedCount, 0);
  assert.equal(duplicate.body.lines.length, 0);

  const concurrentContent = Buffer.concat([fixture, Buffer.from("\n% concurrent content\n")]);
  const [concurrentOne, concurrentTwo] = await Promise.all([
    importPrivatePdf(primaryClientId, "mashreq-concurrent-a.pdf", concurrentContent),
    importPrivatePdf(primaryClientId, "mashreq-concurrent-b.pdf", concurrentContent),
  ]);
  assert.deepEqual(
    [concurrentOne.response.status, concurrentTwo.response.status].sort((left, right) => left - right),
    [200, 201],
  );
  assert.deepEqual(
    [concurrentOne.body.importStatus, concurrentTwo.body.importStatus].sort(),
    ["duplicate_file", "duplicates_found"],
  );

  const isolated = await importPrivatePdf(
    secondaryClientId,
    "mashreq-client-isolation.pdf",
    fixture,
    secondaryUserId,
  );
  assert.equal(isolated.response.status, 201);
  assert.equal(isolated.body.importStatus, "imported");
  assert.equal(isolated.body.importedCount, 2);

  const primaryImports = await db.select().from(statementImportsTable).where(and(
    eq(statementImportsTable.clientId, primaryClientId),
    eq(statementImportsTable.fileHash, createHash("sha256").update(fixture).digest("hex")),
  ));
  assert.deepEqual(primaryImports.map((record) => record.outcome).sort(), ["completed", "duplicate"]);
  const primaryLines = await db.select().from(statementLinesTable).where(eq(statementLinesTable.clientId, primaryClientId));
  assert.equal(primaryLines.length, 2);
});