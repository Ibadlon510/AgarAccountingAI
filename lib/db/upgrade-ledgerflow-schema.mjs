import pg from "pg";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LEGACY_TABLE_RENAMES = Object.freeze([
  ["ledgerflow_account_classifications", "agaraccounting_account_classifications"],
  ["ledgerflow_ai_activity", "agaraccounting_ai_activity"],
  ["ledgerflow_ai_model_catalog", "agaraccounting_ai_model_catalog"],
  ["ledgerflow_ai_provider_configs", "agaraccounting_ai_provider_configs"],
  ["ledgerflow_assistant_threads", "agaraccounting_assistant_threads"],
  ["ledgerflow_assistant_turns", "agaraccounting_assistant_turns"],
  ["ledgerflow_bank_accounts", "agaraccounting_bank_accounts"],
  ["ledgerflow_bulk_transition_audits", "agaraccounting_bulk_transition_audits"],
  ["ledgerflow_classification_patterns", "agaraccounting_classification_patterns"],
  ["ledgerflow_client_workspaces", "agaraccounting_client_workspaces"],
  ["ledgerflow_clients", "agaraccounting_clients"],
  ["ledgerflow_exchange_rates", "agaraccounting_exchange_rates"],
  ["ledgerflow_firm_company_engagements", "agaraccounting_firm_company_engagements"],
  ["ledgerflow_firm_engagement_members", "agaraccounting_firm_engagement_members"],
  ["ledgerflow_firm_memberships", "agaraccounting_firm_memberships"],
  ["ledgerflow_firm_profiles", "agaraccounting_firm_profiles"],
  ["ledgerflow_journal_entries", "agaraccounting_journal_entries"],
  ["ledgerflow_organization_invitations", "agaraccounting_organization_invitations"],
  ["ledgerflow_report_packs", "agaraccounting_report_packs"],
  ["ledgerflow_statement_import_undo_audits", "agaraccounting_statement_import_undo_audits"],
  ["ledgerflow_statement_imports", "agaraccounting_statement_imports"],
  ["ledgerflow_statement_lines", "agaraccounting_statement_lines"],
  ["ledgerflow_system_rate_admins", "agaraccounting_system_rate_admins"],
  ["ledgerflow_system_rate_audit_events", "agaraccounting_system_rate_audit_events"],
  ["ledgerflow_system_rates", "agaraccounting_system_rates"],
  ["ledgerflow_workspace_invitations", "agaraccounting_workspace_invitations"],
]);

const LEGACY_INTEGRITY_FUNCTIONS = Object.freeze([
  "ledgerflow_assert_journal_entry_statement_line_client",
  "ledgerflow_assert_statement_import_bank_account_client",
  "ledgerflow_assert_statement_line_bank_account_client",
  "ledgerflow_prevent_client_ownership_change",
  "ledgerflow_reject_bulk_transition_audit_mutation",
]);

function identifier(value) {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function validateSchema(schema) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new Error(`Invalid PostgreSQL schema name: ${schema}`);
  }
}

function agarName(legacyName) {
  // PostgreSQL identifiers are limited to 63 bytes. These names are ASCII.
  return legacyName.replace(/^ledgerflow_/, "agaraccounting_").slice(0, 63);
}

async function renamePrefixedObjects(client, schema, query, statement) {
  const result = await client.query(query, [schema]);
  for (const row of result.rows) {
    const nextName = agarName(row.object_name);
    if (row.object_name === nextName) continue;
    await client.query(statement(row, nextName));
  }
}

async function normalizeJournalLifecycle(client, schema, tables) {
  const schemaId = identifier(schema);
  const columnResult = await client.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name IN ('agaraccounting_statement_lines', 'agaraccounting_journal_entries')`,
    [schema],
  );
  const columns = new Set(columnResult.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const hasStatementLines = tables.has("agaraccounting_statement_lines")
    && columns.has("agaraccounting_statement_lines.status");
  const hasJournalEntries = tables.has("agaraccounting_journal_entries")
    && columns.has("agaraccounting_journal_entries.status");
  const hasJournalLineLink = columns.has("agaraccounting_journal_entries.statement_line_id");
  let normalizedRows = 0;

  if (hasJournalEntries) {
    const result = await client.query(`
      UPDATE ${schemaId}.agaraccounting_journal_entries entry
         SET status = CASE
            WHEN entry.status = 'posted'
              OR (${hasStatementLines && hasJournalLineLink ? `EXISTS (
               SELECT 1
                 FROM ${schemaId}.agaraccounting_statement_lines line
                WHERE line.id = entry.statement_line_id
                  AND line.status = 'posted'
             )` : "FALSE"})
           THEN 'posted'
           ELSE 'draft'
         END
       WHERE entry.status NOT IN ('draft', 'posted')
           OR (${hasStatementLines && hasJournalLineLink ? `EXISTS (
            SELECT 1
              FROM ${schemaId}.agaraccounting_statement_lines line
             WHERE line.id = entry.statement_line_id
               AND line.status = 'posted'
               AND entry.status <> 'posted'
          )` : "FALSE"})
    `);
    normalizedRows += result.rowCount ?? 0;
    await client.query(`
      ALTER TABLE ${schemaId}.agaraccounting_journal_entries
      ALTER COLUMN status SET DEFAULT 'draft'
    `);
  }

  if (hasStatementLines) {
    const result = await client.query(`
      UPDATE ${schemaId}.agaraccounting_statement_lines line
         SET status = CASE
            WHEN line.status = 'posted'
              OR (${hasJournalEntries && hasJournalLineLink ? `EXISTS (
               SELECT 1
                 FROM ${schemaId}.agaraccounting_journal_entries entry
                WHERE entry.statement_line_id = line.id
                  AND entry.status = 'posted'
             )` : "FALSE"})
           THEN 'posted'
           ELSE 'draft'
         END
       WHERE line.status NOT IN ('draft', 'posted')
          OR (${hasJournalEntries && hasJournalLineLink ? `EXISTS (
            SELECT 1
              FROM ${schemaId}.agaraccounting_journal_entries entry
             WHERE entry.statement_line_id = line.id
               AND entry.status = 'posted'
               AND line.status <> 'posted'
          )` : "FALSE"})
    `);
    normalizedRows += result.rowCount ?? 0;
    await client.query(`
      ALTER TABLE ${schemaId}.agaraccounting_statement_lines
      ALTER COLUMN status SET DEFAULT 'draft'
    `);
  }

  return normalizedRows;
}

/**
 * Upgrades the development/post-merge schema namespace before Drizzle push runs.
 * Production schema changes remain owned by Replit's Publish rename-confirmation flow.
 */
export async function upgradeLedgerflowSchema(client, { schema = "public" } = {}) {
  validateSchema(schema);
  const schemaId = identifier(schema);

  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `agaraccounting-ledgerflow-schema-upgrade:${schema}`,
    ]);

    const tableResult = await client.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = $1`,
      [schema],
    );
    const tables = new Set(tableResult.rows.map((row) => row.table_name));
    const conflicts = LEGACY_TABLE_RENAMES.filter(([legacy, current]) => tables.has(legacy) && tables.has(current));
    if (conflicts.length) {
      throw new Error(
        `Cannot upgrade LedgerFlow schema because both legacy and AgarAccounting tables exist: ${
          conflicts.map(([legacy, current]) => `${legacy}/${current}`).join(", ")
        }`,
      );
    }

    const pending = LEGACY_TABLE_RENAMES.filter(([legacy]) => tables.has(legacy));
    if (pending.length) {
      for (const functionName of LEGACY_INTEGRITY_FUNCTIONS) {
        await client.query(`DROP FUNCTION IF EXISTS ${schemaId}.${identifier(functionName)}() CASCADE`);
      }

      for (const [legacy, current] of pending) {
        await client.query(
          `ALTER TABLE ${schemaId}.${identifier(legacy)} RENAME TO ${identifier(current)}`,
        );
        tables.delete(legacy);
        tables.add(current);
      }

      await renamePrefixedObjects(
        client,
        schema,
        `SELECT c.conname AS object_name, t.relname AS table_name
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = $1
          AND c.conname LIKE 'ledgerflow\\_%' ESCAPE '\\'
        ORDER BY c.conname`,
        (row, nextName) =>
          `ALTER TABLE ${schemaId}.${identifier(row.table_name)} RENAME CONSTRAINT ${
            identifier(row.object_name)
          } TO ${identifier(nextName)}`,
      );

      await renamePrefixedObjects(
        client,
        schema,
        `SELECT i.relname AS object_name
         FROM pg_class i
         JOIN pg_namespace n ON n.oid = i.relnamespace
        WHERE n.nspname = $1
          AND i.relkind = 'i'
          AND i.relname LIKE 'ledgerflow\\_%' ESCAPE '\\'
        ORDER BY i.relname`,
        (row, nextName) =>
          `ALTER INDEX ${schemaId}.${identifier(row.object_name)} RENAME TO ${identifier(nextName)}`,
      );

      await renamePrefixedObjects(
        client,
        schema,
        `SELECT s.relname AS object_name
         FROM pg_class s
         JOIN pg_namespace n ON n.oid = s.relnamespace
        WHERE n.nspname = $1
          AND s.relkind = 'S'
          AND s.relname LIKE 'ledgerflow\\_%' ESCAPE '\\'
        ORDER BY s.relname`,
        (row, nextName) =>
          `ALTER SEQUENCE ${schemaId}.${identifier(row.object_name)} RENAME TO ${identifier(nextName)}`,
      );

      await renamePrefixedObjects(
        client,
        schema,
        `SELECT g.tgname AS object_name, t.relname AS table_name
         FROM pg_trigger g
         JOIN pg_class t ON t.oid = g.tgrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = $1
          AND NOT g.tgisinternal
          AND g.tgname LIKE 'ledgerflow\\_%' ESCAPE '\\'
        ORDER BY g.tgname`,
        (row, nextName) =>
          `ALTER TRIGGER ${identifier(row.object_name)} ON ${schemaId}.${identifier(row.table_name)} RENAME TO ${
            identifier(nextName)
          }`,
      );
    }

    const normalizedRows = await normalizeJournalLifecycle(client, schema, tables);
    await client.query("COMMIT");
    return { renamedTables: pending.length, normalizedRows };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function runCli() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set before upgrading the AgarAccounting schema namespace.");
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const result = await upgradeLedgerflowSchema(client);
    if (result.renamedTables) {
      console.log(`Renamed ${result.renamedTables} LedgerFlow tables to AgarAccounting without replacing data.`);
    }
    if (result.normalizedRows) {
      console.log(`Normalized ${result.normalizedRows} journal lifecycle rows to draft or posted.`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

const entryPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (entryPath === import.meta.url) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}