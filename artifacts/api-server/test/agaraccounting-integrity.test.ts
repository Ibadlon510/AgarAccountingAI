import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql } from "drizzle-orm";
import {
  clientsTable,
  db,
  ensureAgarAccountingIntegrity,
  statementImportsTable,
  statementLinesTable,
} from "@workspace/db";

const databaseUrl = process.env.AGARACCOUNTING_TEST_DATABASE_URL;
const testDatabaseName = databaseUrl
  ? decodeURIComponent(new URL(databaseUrl).pathname).replace(/^\/+/, "")
  : "";

test("repairs the legacy statement import hash index and preserves duplicate audit history", {
  skip: !databaseUrl || !/(^|[_-])test(?:[_-]|$)/i.test(testDatabaseName),
}, async () => {
  const suffix = randomUUID();
  const fileHash = `statement-${suffix}`;
  let clientId: number | undefined;

  try {
    await db.execute(sql`DROP INDEX IF EXISTS agaraccounting_statement_imports_client_file_hash_idx`);
    await db.execute(sql`
      CREATE UNIQUE INDEX agaraccounting_statement_imports_client_file_hash_idx
        ON agaraccounting_statement_imports (client_id, file_hash)
    `);

    await ensureAgarAccountingIntegrity();
    const [index] = (await db.execute(sql`
      SELECT
        index_info.indisunique AS "isUnique",
        pg_get_expr(index_info.indpred, index_info.indrelid) AS predicate
      FROM pg_class AS index_class
      JOIN pg_index AS index_info ON index_info.indexrelid = index_class.oid
      JOIN pg_namespace AS index_namespace ON index_namespace.oid = index_class.relnamespace
      WHERE index_namespace.nspname = current_schema()
        AND index_class.relname = 'agaraccounting_statement_imports_client_file_hash_idx'
    `)).rows as Array<{ isUnique: boolean; predicate: string | null }>;
    assert.equal(index?.isUnique, true);
    assert.match(index?.predicate ?? "", /outcome\s*=\s*'completed'/i);

    const [client] = await db.insert(clientsTable).values({
      name: `Integrity ${suffix}`,
      legalName: "Integrity test LLC",
    }).returning({ id: clientsTable.id });
    clientId = client?.id;
    assert.ok(clientId);

    await db.insert(statementImportsTable).values({
      clientId,
      fileName: "statement.pdf",
      mimeType: "application/pdf",
      fileHash,
      outcome: "completed",
    });
    await db.insert(statementImportsTable).values([
      {
        clientId,
        fileName: "statement-copy.pdf",
        mimeType: "application/pdf",
        fileHash,
        outcome: "duplicate",
      },
      {
        clientId,
        fileName: "statement-retry.pdf",
        mimeType: "application/pdf",
        fileHash,
        outcome: "failed",
        errorMessage: "Temporary provider outage",
      },
      {
        clientId,
        fileName: "statement-undone.pdf",
        mimeType: "application/pdf",
        fileHash,
        outcome: "undone",
      },
    ]);
    await assert.rejects(
      db.insert(statementImportsTable).values({
        clientId,
        fileName: "statement-second-completed.pdf",
        mimeType: "application/pdf",
        fileHash,
        outcome: "completed",
      }),
      (error: unknown) => {
        const databaseError = error as { code?: string; cause?: { code?: string } };
        return databaseError?.code === "23505" || databaseError?.cause?.code === "23505";
      },
    );
  } finally {
    if (clientId) {
      await db.delete(statementImportsTable).where(sql`${statementImportsTable.clientId} = ${clientId}`);
      await db.delete(clientsTable).where(sql`${clientsTable.id} = ${clientId}`);
    }
  }
});

test("rejects a statement line whose import belongs to another client", {
  skip: !databaseUrl || !/(^|[_-])test(?:[_-]|$)/i.test(testDatabaseName),
}, async () => {
  const suffix = randomUUID();
  let sourceClientId: number | undefined;
  let targetClientId: number | undefined;
  let importId: number | undefined;

  try {
    await ensureAgarAccountingIntegrity();
    const [sourceClient, targetClient] = await db.insert(clientsTable).values([
      { name: `Source ${suffix}`, legalName: "Source integrity client LLC" },
      { name: `Target ${suffix}`, legalName: "Target integrity client LLC" },
    ]).returning({ id: clientsTable.id });
    sourceClientId = sourceClient?.id;
    targetClientId = targetClient?.id;
    assert.ok(sourceClientId);
    assert.ok(targetClientId);

    const [statementImport] = await db.insert(statementImportsTable).values({
      clientId: sourceClientId,
      fileName: "cross-client.pdf",
      mimeType: "application/pdf",
      fileHash: `cross-client-${suffix}`,
      outcome: "completed",
    }).returning({ id: statementImportsTable.id });
    importId = statementImport?.id;
    assert.ok(importId);

    await assert.rejects(
      db.insert(statementLinesTable).values({
        clientId: targetClientId,
        statementImportId: importId,
        date: "2026-08-27",
        description: "Must not cross client boundaries",
        currency: "AED",
        amount: "1.00",
        direction: "outflow",
        source: "Integrity test",
      }),
      (error: unknown) => {
        const databaseError = error as { code?: string; cause?: { code?: string } };
        return databaseError?.code === "23503" || databaseError?.cause?.code === "23503";
      },
    );
  } finally {
    if (importId) await db.delete(statementImportsTable).where(sql`${statementImportsTable.id} = ${importId}`);
    if (sourceClientId) await db.delete(clientsTable).where(sql`${clientsTable.id} = ${sourceClientId}`);
    if (targetClientId) await db.delete(clientsTable).where(sql`${clientsTable.id} = ${targetClientId}`);
  }
});