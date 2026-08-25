import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export function createDatabasePool(connectionString: string) {
  return new Pool({ connectionString });
}

export async function ensureLedgerflowAuditImmutability() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(239023)");
    await client.query(`
      CREATE OR REPLACE FUNCTION ledgerflow_reject_bulk_transition_audit_mutation()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'Ledger transition audit records are append-only.';
      END;
      $$;

      DO $$
      BEGIN
        CREATE TRIGGER ledgerflow_bulk_transition_audits_append_only
          BEFORE UPDATE OR DELETE ON ledgerflow_bulk_transition_audits
          FOR EACH ROW
          EXECUTE FUNCTION ledgerflow_reject_bulk_transition_audit_mutation();
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END;
      $$;

      DO $$
      BEGIN
        CREATE TRIGGER ledgerflow_bulk_transition_audits_no_truncate
          BEFORE TRUNCATE ON ledgerflow_bulk_transition_audits
          FOR EACH STATEMENT
          EXECUTE FUNCTION ledgerflow_reject_bulk_transition_audit_mutation();
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END;
      $$;
    `);
  } finally {
    await client.query("SELECT pg_advisory_unlock(239023)");
    client.release();
  }
}

export * from "./schema";
