import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql } from "drizzle-orm";
import {
  clientsTable,
  db,
  ensureLedgerflowIntegrity,
  statementImportsTable,
} from "@workspace/db";

const databaseUrl = process.env.LEDGERFLOW_TEST_DATABASE_URL;
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
    await db.execute(sql`DROP INDEX IF EXISTS ledgerflow_statement_imports_client_file_hash_idx`);
    await db.execute(sql`
      CREATE UNIQUE INDEX ledgerflow_statement_imports_client_file_hash_idx
        ON ledgerflow_statement_imports (client_id, file_hash)
    `);

    await ensureLedgerflowIntegrity();
    const [index] = (await db.execute(sql`
      SELECT
        index_info.indisunique AS "isUnique",
        pg_get_expr(index_info.indpred, index_info.indrelid) AS predicate
      FROM pg_class AS index_class
      JOIN pg_index AS index_info ON index_info.indexrelid = index_class.oid
      JOIN pg_namespace AS index_namespace ON index_namespace.oid = index_class.relnamespace
      WHERE index_namespace.nspname = current_schema()
        AND index_class.relname = 'ledgerflow_statement_imports_client_file_hash_idx'
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