import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabasePool } from "@workspace/db";
import {
  LEGACY_TABLE_RENAMES,
  upgradeLedgerflowSchema,
} from "../../../lib/db/upgrade-ledgerflow-schema.mjs";

const databaseUrl = process.env.AGARACCOUNTING_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("AGARACCOUNTING_TEST_DATABASE_URL is required for schema upgrade tests.");

const schema = `upgrade_${randomUUID().replaceAll("-", "")}`;
const schemaId = `"${schema}"`;
const pool = createDatabasePool(databaseUrl);

test.after(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${schemaId} CASCADE`);
  await pool.end();
});

test("preserves a populated LedgerFlow schema through the AgarAccounting namespace upgrade", async () => {
  await pool.query(`CREATE SCHEMA ${schemaId}`);

  for (const [legacyTable] of LEGACY_TABLE_RENAMES) {
    await pool.query(`CREATE TABLE ${schemaId}."${legacyTable}" (id BIGSERIAL PRIMARY KEY)`);
  }
  await pool.query(`CREATE TABLE ${schemaId}.users (
    id TEXT PRIMARY KEY,
    starter_client_id BIGINT REFERENCES ${schemaId}.ledgerflow_clients(id)
  )`);
  await pool.query(`
    ALTER TABLE ${schemaId}.ledgerflow_statement_imports
      ADD COLUMN client_id BIGINT REFERENCES ${schemaId}.ledgerflow_clients(id),
      ADD COLUMN file_hash TEXT,
      ADD CONSTRAINT ledgerflow_statement_imports_file_hash_check CHECK (length(file_hash) > 0)
  `);
  await pool.query(`
    CREATE UNIQUE INDEX ledgerflow_statement_imports_client_file_hash_idx
      ON ${schemaId}.ledgerflow_statement_imports(client_id, file_hash)
  `);
  await pool.query(`
    CREATE FUNCTION ${schemaId}.ledgerflow_prevent_client_ownership_change()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'legacy protection';
    END;
    $$
  `);
  await pool.query(`
    CREATE TRIGGER ledgerflow_statement_import_client_ownership_immutable
    BEFORE UPDATE OF client_id ON ${schemaId}.ledgerflow_statement_imports
    FOR EACH ROW EXECUTE FUNCTION ${schemaId}.ledgerflow_prevent_client_ownership_change()
  `);

  const clientInsert = await pool.query(
    `INSERT INTO ${schemaId}.ledgerflow_clients DEFAULT VALUES RETURNING id`,
  );
  const clientId = Number(clientInsert.rows[0].id);
  const importInsert = await pool.query(
    `INSERT INTO ${schemaId}.ledgerflow_statement_imports(client_id, file_hash)
     VALUES ($1, $2) RETURNING id`,
    [clientId, "legacy-file-hash"],
  );
  const importId = Number(importInsert.rows[0].id);
  await pool.query(
    `INSERT INTO ${schemaId}.users(id, starter_client_id) VALUES ($1, $2)`,
    ["legacy-user", clientId],
  );

  const client = await pool.connect();
  try {
    const first = await upgradeLedgerflowSchema(client, { schema });
    assert.equal(first.renamedTables, LEGACY_TABLE_RENAMES.length);
    const repeated = await upgradeLedgerflowSchema(client, { schema });
    assert.equal(repeated.renamedTables, 0);
  } finally {
    client.release();
  }

  const tableNames = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
    [schema],
  );
  const names = new Set(tableNames.rows.map((row) => row.table_name));
  for (const [legacyTable, currentTable] of LEGACY_TABLE_RENAMES) {
    assert.equal(names.has(legacyTable), false);
    assert.equal(names.has(currentTable), true);
  }

  const preserved = await pool.query(
    `SELECT u.starter_client_id, i.id AS import_id, i.file_hash
       FROM ${schemaId}.users u
       JOIN ${schemaId}.agaraccounting_clients c ON c.id = u.starter_client_id
       JOIN ${schemaId}.agaraccounting_statement_imports i ON i.client_id = c.id
      WHERE u.id = $1`,
    ["legacy-user"],
  );
  assert.deepEqual(preserved.rows, [{
    starter_client_id: String(clientId),
    import_id: String(importId),
    file_hash: "legacy-file-hash",
  }]);

  const dependencies = await pool.query(
    `SELECT
       (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
         WHERE n.nspname = $1 AND c.conname LIKE 'ledgerflow\\_%' ESCAPE '\\') AS legacy_constraints,
       (SELECT count(*) FROM pg_class x JOIN pg_namespace n ON n.oid = x.relnamespace
         WHERE n.nspname = $1 AND x.relname LIKE 'ledgerflow\\_%' ESCAPE '\\') AS legacy_relations,
       (SELECT count(*) FROM pg_trigger g JOIN pg_class t ON t.oid = g.tgrelid JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = $1 AND NOT g.tgisinternal AND g.tgname LIKE 'ledgerflow\\_%' ESCAPE '\\') AS legacy_triggers`,
    [schema],
  );
  assert.deepEqual(dependencies.rows[0], {
    legacy_constraints: "0",
    legacy_relations: "0",
    legacy_triggers: "0",
  });

  const currentObjects = await pool.query(
    `SELECT
       to_regclass($1) IS NOT NULL AS renamed_index,
       to_regclass($2) IS NOT NULL AS renamed_sequence`,
    [
      `${schema}.agaraccounting_statement_imports_client_file_hash_idx`,
      `${schema}.agaraccounting_statement_imports_id_seq`,
    ],
  );
  assert.deepEqual(currentObjects.rows[0], { renamed_index: true, renamed_sequence: true });
});