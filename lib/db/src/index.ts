import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { PoolClient } from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

const AGARACCOUNTING_INTEGRITY_LOCK = 239023;

export function createDatabasePool(connectionString: string) {
  return new Pool({ connectionString });
}


export * from "./schema";

type StatementImportHashIndex = {
  tableName: string;
  isUnique: boolean;
  predicate: string | null;
  indexDefinition: string;
};

function isExpectedStatementImportHashIndex(index: StatementImportHashIndex | undefined) {
  return Boolean(
    index
      && index.tableName === "agaraccounting_statement_imports"
      && index.isUnique
      && normalizedIndexPredicate(index.predicate) === "outcome = 'completed'"
      && /\(\s*client_id\s*,\s*file_hash\s*\)/i.test(index.indexDefinition),
  );
}

async function statementImportHashIndex(client: PoolClient, indexName = STATEMENT_IMPORT_HASH_INDEX) {
  const result = await client.query<StatementImportHashIndex>(`
    SELECT
      table_class.relname AS "tableName",
      index_info.indisunique AS "isUnique",
      pg_get_expr(index_info.indpred, index_info.indrelid) AS predicate,
      pg_get_indexdef(index_info.indexrelid) AS "indexDefinition"
    FROM pg_class AS index_class
    JOIN pg_index AS index_info ON index_info.indexrelid = index_class.oid
    JOIN pg_class AS table_class ON table_class.oid = index_info.indrelid
    JOIN pg_namespace AS index_namespace ON index_namespace.oid = index_class.relnamespace
    WHERE index_namespace.nspname = current_schema()
      AND index_class.relname = $1
  `, [indexName]);
  return result.rows[0];
}

const STATEMENT_IMPORT_HASH_INDEX = "agaraccounting_statement_imports_client_file_hash_idx";

async function dropIndexConcurrently(client: PoolClient, indexName: string) {
  await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${indexName}`);
}

export async function ensureAgarAccountingIntegrity() {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [AGARACCOUNTING_INTEGRITY_LOCK]);
    await ensureStatementImportHashIndex(client);
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(`
      CREATE OR REPLACE FUNCTION agaraccounting_reject_bulk_transition_audit_mutation()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'Ledger transition audit records are append-only.';
      END;
      $$;

      DO $$
      BEGIN
        CREATE TRIGGER agaraccounting_bulk_transition_audits_append_only
          BEFORE UPDATE OR DELETE ON agaraccounting_bulk_transition_audits
          FOR EACH ROW
          EXECUTE FUNCTION agaraccounting_reject_bulk_transition_audit_mutation();
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END;
      $$;

      DO $$
      BEGIN
        CREATE TRIGGER agaraccounting_bulk_transition_audits_no_truncate
          BEFORE TRUNCATE ON agaraccounting_bulk_transition_audits
          FOR EACH STATEMENT
          EXECUTE FUNCTION agaraccounting_reject_bulk_transition_audit_mutation();
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END;
      $$;

      DO $$
      BEGIN
        CREATE TRIGGER agaraccounting_statement_import_undo_audits_append_only
          BEFORE UPDATE OR DELETE ON agaraccounting_statement_import_undo_audits
          FOR EACH ROW
          EXECUTE FUNCTION agaraccounting_reject_bulk_transition_audit_mutation();
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END;
      $$;

      DO $$
      BEGIN
        CREATE TRIGGER agaraccounting_statement_import_undo_audits_no_truncate
          BEFORE TRUNCATE ON agaraccounting_statement_import_undo_audits
          FOR EACH STATEMENT
          EXECUTE FUNCTION agaraccounting_reject_bulk_transition_audit_mutation();
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END;
      $$;
    `);
    await client.query("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `AgarAccounting AI database integrity bootstrap failed before the API could accept traffic. Verify that agaraccounting_statement_imports has at most one completed row for each client and file hash, then rerun the release. ${detail}`,
      { cause: error },
    );
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [AGARACCOUNTING_INTEGRITY_LOCK]);
    client.release();
  }
}

async function ensureStatementImportHashIndex(client: PoolClient) {
  const existing = await statementImportHashIndex(client);
  if (existing && existing.tableName !== "agaraccounting_statement_imports") {
    throw new Error(
      `The named index ${STATEMENT_IMPORT_HASH_INDEX} belongs to ${existing.tableName}, not agaraccounting_statement_imports.`,
    );
  }

  if (!existing) {
    await client.query(`
      CREATE UNIQUE INDEX CONCURRENTLY ${STATEMENT_IMPORT_HASH_INDEX}
        ON agaraccounting_statement_imports (client_id, file_hash)
        WHERE outcome = 'completed'
    `);
  } else if (!isExpectedStatementImportHashIndex(existing)) {
    const replacement = await statementImportHashIndex(client, STATEMENT_IMPORT_HASH_REPLACEMENT_INDEX);
    if (replacement && replacement.tableName !== "agaraccounting_statement_imports") {
      throw new Error(
        `The replacement index ${STATEMENT_IMPORT_HASH_REPLACEMENT_INDEX} belongs to ${replacement.tableName}, not agaraccounting_statement_imports.`,
      );
    }
    if (replacement && !isExpectedStatementImportHashIndex(replacement)) {
      await dropIndexConcurrently(client, STATEMENT_IMPORT_HASH_REPLACEMENT_INDEX);
    }
    if (!isExpectedStatementImportHashIndex(
      await statementImportHashIndex(client, STATEMENT_IMPORT_HASH_REPLACEMENT_INDEX),
    )) {
      await client.query(`
        CREATE UNIQUE INDEX CONCURRENTLY ${STATEMENT_IMPORT_HASH_REPLACEMENT_INDEX}
          ON agaraccounting_statement_imports (client_id, file_hash)
          WHERE outcome = 'completed'
      `);
    }
    if (!isExpectedStatementImportHashIndex(
      await statementImportHashIndex(client, STATEMENT_IMPORT_HASH_REPLACEMENT_INDEX),
    )) {
      throw new Error(
        `The replacement statement import hash index ${STATEMENT_IMPORT_HASH_REPLACEMENT_INDEX} could not be verified.`,
      );
    }
    await dropIndexConcurrently(client, STATEMENT_IMPORT_HASH_INDEX);
    await client.query(`ALTER INDEX ${STATEMENT_IMPORT_HASH_REPLACEMENT_INDEX} RENAME TO ${STATEMENT_IMPORT_HASH_INDEX}`);
  }

  const repaired = await statementImportHashIndex(client);
  if (!isExpectedStatementImportHashIndex(repaired)) {
    throw new Error(
      `The statement import hash index ${STATEMENT_IMPORT_HASH_INDEX} does not enforce one completed import per client and file hash.`,
    );
  }
}

export const ensureAgarAccountingAuditImmutability = ensureAgarAccountingIntegrity;

const STATEMENT_IMPORT_HASH_REPLACEMENT_INDEX = "agaraccounting_statement_imports_file_hash_completed_idx";

function normalizedIndexPredicate(predicate: string | null) {
  return predicate
    ?.replace(/::text\b/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\((.*)\)$/, "$1")
    .trim()
    .toLowerCase();
}
