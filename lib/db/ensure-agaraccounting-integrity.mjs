import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before installing AgarAccounting AI integrity checks.");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const AGARACCOUNTING_INTEGRITY_LOCK = 239023;
const STATEMENT_IMPORT_HASH_INDEX = "agaraccounting_statement_imports_client_file_hash_idx";
const STATEMENT_IMPORT_HASH_REPLACEMENT_INDEX = "agaraccounting_statement_imports_file_hash_completed_idx";

async function statementImportHashIndex(client, indexName = STATEMENT_IMPORT_HASH_INDEX) {
  return client.query(`
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
}

function expectedStatementImportHashIndex(index) {
  const predicate = index?.predicate
    ?.replace(/::text\b/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\((.*)\)$/, "$1")
    .trim()
    .toLowerCase();
  return Boolean(
    index
    && index.tableName === "agaraccounting_statement_imports"
    && index.isUnique
    && predicate === "outcome = 'completed'"
    && /\(\s*client_id\s*,\s*file_hash\s*\)/i.test(index.indexDefinition),
  );
}

try {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [AGARACCOUNTING_INTEGRITY_LOCK]);

    const index = (await statementImportHashIndex(client)).rows[0];
    if (index && index.tableName !== "agaraccounting_statement_imports") {
      throw new Error(
        `The named index ${STATEMENT_IMPORT_HASH_INDEX} belongs to ${index.tableName}, not agaraccounting_statement_imports.`,
      );
    }
    if (!index) {
      await client.query(`
        CREATE UNIQUE INDEX CONCURRENTLY ${STATEMENT_IMPORT_HASH_INDEX}
          ON agaraccounting_statement_imports (client_id, file_hash)
          WHERE outcome = 'completed'
      `);
    } else if (!expectedStatementImportHashIndex(index)) {
      const replacement = (await statementImportHashIndex(client, STATEMENT_IMPORT_HASH_REPLACEMENT_INDEX)).rows[0];
      if (replacement && replacement.tableName !== "agaraccounting_statement_imports") {
        throw new Error(
          `The replacement index ${STATEMENT_IMPORT_HASH_REPLACEMENT_INDEX} belongs to ${replacement.tableName}, not agaraccounting_statement_imports.`,
        );
      }
      if (replacement && !expectedStatementImportHashIndex(replacement)) {
        await client.query(`DROP INDEX CONCURRENTLY ${STATEMENT_IMPORT_HASH_REPLACEMENT_INDEX}`);
      }
      if (!expectedStatementImportHashIndex(
        (await statementImportHashIndex(client, STATEMENT_IMPORT_HASH_REPLACEMENT_INDEX)).rows[0],
      )) {
        await client.query(`
          CREATE UNIQUE INDEX CONCURRENTLY ${STATEMENT_IMPORT_HASH_REPLACEMENT_INDEX}
            ON agaraccounting_statement_imports (client_id, file_hash)
            WHERE outcome = 'completed'
        `);
      }
      if (!expectedStatementImportHashIndex(
        (await statementImportHashIndex(client, STATEMENT_IMPORT_HASH_REPLACEMENT_INDEX)).rows[0],
      )) {
        throw new Error(
          `The replacement statement import hash index ${STATEMENT_IMPORT_HASH_REPLACEMENT_INDEX} could not be verified.`,
        );
      }
      await client.query(`DROP INDEX CONCURRENTLY ${STATEMENT_IMPORT_HASH_INDEX}`);
      await client.query(`ALTER INDEX ${STATEMENT_IMPORT_HASH_REPLACEMENT_INDEX} RENAME TO ${STATEMENT_IMPORT_HASH_INDEX}`);
    }

    if (!expectedStatementImportHashIndex((await statementImportHashIndex(client)).rows[0])) {
      throw new Error(
        `The statement import hash index ${STATEMENT_IMPORT_HASH_INDEX} does not enforce one completed import per client and file hash.`,
      );
    }

    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(`
      create or replace function agaraccounting_close_initial_system_admin_claim()
      returns trigger
      language plpgsql
      as $$
      begin
        insert into agaraccounting_system_rate_admin_bootstrap_state (id, closed_by_user_id, reason)
        values (1, new.user_id, 'existing_admin')
        on conflict (id) do nothing;
        return new;
      end;
      $$;

      drop trigger if exists agaraccounting_system_rate_admin_closes_initial_claim
        on agaraccounting_system_rate_admins;
      create trigger agaraccounting_system_rate_admin_closes_initial_claim
        after insert on agaraccounting_system_rate_admins
        for each row
        execute function agaraccounting_close_initial_system_admin_claim();

      insert into agaraccounting_system_rate_admin_bootstrap_state (id, closed_by_user_id, reason)
      select 1, user_id, 'existing_admin'
      from agaraccounting_system_rate_admins
      order by created_at, user_id
      limit 1
      on conflict (id) do nothing;

      alter table agaraccounting_firm_profiles
        drop constraint if exists agaraccounting_firm_profiles_owner_user_id_unique;
      alter table agaraccounting_client_workspaces
        drop constraint if exists agaraccounting_client_workspaces_role_check;
      alter table agaraccounting_client_workspaces
        add constraint agaraccounting_client_workspaces_role_check
        check (role in ('owner', 'admin', 'accountant', 'bookkeeper'));

      create or replace function agaraccounting_prevent_client_ownership_change()
      returns trigger
      language plpgsql
      as $$
      begin
        if new.client_id is distinct from old.client_id then
          raise exception 'AgarAccounting AI record ownership cannot be moved between clients.'
            using errcode = '23514';
        end if;
        return new;
      end;
      $$;

    create or replace function agaraccounting_assert_statement_line_bank_account_client()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.bank_account_id is not null and not exists (
        select 1
        from agaraccounting_bank_accounts account
        where account.id = new.bank_account_id
          and account.client_id = new.client_id
      ) then
        raise exception 'Statement line bank account must belong to the same client.'
          using errcode = '23503';
      end if;
      return new;
    end;
    $$;

    create or replace function agaraccounting_assert_statement_line_import_client()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.statement_import_id is not null and not exists (
        select 1
        from agaraccounting_statement_imports statement_import
        where statement_import.id = new.statement_import_id
          and statement_import.client_id = new.client_id
      ) then
        raise exception 'Statement line import must belong to the same client.'
          using errcode = '23503';
      end if;
      return new;
    end;
    $$;

    create or replace function agaraccounting_assert_statement_import_bank_account_client()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.bank_account_id is not null and not exists (
        select 1
        from agaraccounting_bank_accounts account
        where account.id = new.bank_account_id
          and account.client_id = new.client_id
      ) then
        raise exception 'Statement import bank account must belong to the same client.'
          using errcode = '23503';
      end if;
      return new;
    end;
    $$;

    create or replace function agaraccounting_assert_journal_entry_statement_line_client()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.statement_line_id is null then
        return new;
      end if;
      if not exists (
        select 1
        from agaraccounting_statement_lines line
        where line.id = new.statement_line_id
          and line.client_id = new.client_id
      ) then
        raise exception 'Journal entry statement line must belong to the same client.'
          using errcode = '23503';
      end if;
      return new;
    end;
    $$;

    create or replace function agaraccounting_assert_contact_client()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.contact_id is not null and not exists (
        select 1
        from agaraccounting_contacts contact
        where contact.id = new.contact_id
          and contact.client_id = new.client_id
      ) then
        raise exception 'Bookkeeping contact must belong to the same client.'
          using errcode = '23503';
      end if;
      return new;
    end;
    $$;

    create or replace function agaraccounting_assert_contact_evidence_client()
    returns trigger
    language plpgsql
    as $$
    begin
      if not exists (
        select 1
        from agaraccounting_contacts contact
        join agaraccounting_statement_lines line
          on line.id = new.statement_line_id
        join agaraccounting_journal_entries entry
          on entry.id = new.journal_entry_id
         and entry.statement_line_id = line.id
        where contact.id = new.contact_id
          and contact.client_id = new.client_id
          and line.client_id = new.client_id
          and line.contact_id = new.contact_id
          and entry.client_id = new.client_id
          and entry.contact_id = new.contact_id
      ) then
        raise exception 'Contact classification evidence must reference one client-scoped contact, statement line, and journal entry.'
          using errcode = '23503';
      end if;
      return new;
    end;
    $$;

    create or replace function agaraccounting_reject_contact_evidence_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_op = 'DELETE'
        and pg_trigger_depth() > 1
        and current_database() ~* '(^|[_-])test([_-]|$)' then
        return old;
      end if;
      if tg_op = 'UPDATE'
        and current_setting('agaraccounting.allow_contact_merge_reparent', true) = 'true'
        and new.client_id is not distinct from old.client_id
        and new.statement_line_id is not distinct from old.statement_line_id
        and new.journal_entry_id is not distinct from old.journal_entry_id
        and new.account_suggestion is not distinct from old.account_suggestion
        and new.direction is not distinct from old.direction
        and new.amount is not distinct from old.amount
        and new.currency is not distinct from old.currency
        and new.activity_date is not distinct from old.activity_date
        and new.entry_status is not distinct from old.entry_status
        and new.confirmed_by_user_id is not distinct from old.confirmed_by_user_id
        and new.confirmed_at is not distinct from old.confirmed_at then
        return new;
      end if;
      raise exception 'Contact classification evidence is immutable except for a controlled contact merge.'
        using errcode = '55000';
    end;
    $$;

    drop trigger if exists agaraccounting_statement_line_bank_account_client_check on agaraccounting_statement_lines;
    create trigger agaraccounting_statement_line_bank_account_client_check
    before insert or update of client_id, bank_account_id on agaraccounting_statement_lines
    for each row execute function agaraccounting_assert_statement_line_bank_account_client();

    drop trigger if exists agaraccounting_statement_line_import_client_check on agaraccounting_statement_lines;
    create trigger agaraccounting_statement_line_import_client_check
    before insert or update of client_id, statement_import_id on agaraccounting_statement_lines
    for each row execute function agaraccounting_assert_statement_line_import_client();

    drop trigger if exists agaraccounting_bank_account_client_ownership_immutable on agaraccounting_bank_accounts;
    create trigger agaraccounting_bank_account_client_ownership_immutable
    before update of client_id on agaraccounting_bank_accounts
    for each row execute function agaraccounting_prevent_client_ownership_change();

    drop trigger if exists agaraccounting_statement_line_client_ownership_immutable on agaraccounting_statement_lines;
    create trigger agaraccounting_statement_line_client_ownership_immutable
    before update of client_id on agaraccounting_statement_lines
    for each row execute function agaraccounting_prevent_client_ownership_change();

    drop trigger if exists agaraccounting_statement_import_bank_account_client_check on agaraccounting_statement_imports;
    create trigger agaraccounting_statement_import_bank_account_client_check
    before insert or update of client_id, bank_account_id on agaraccounting_statement_imports
    for each row execute function agaraccounting_assert_statement_import_bank_account_client();

    drop trigger if exists agaraccounting_statement_import_client_ownership_immutable on agaraccounting_statement_imports;
    create trigger agaraccounting_statement_import_client_ownership_immutable
    before update of client_id on agaraccounting_statement_imports
    for each row execute function agaraccounting_prevent_client_ownership_change();

    drop trigger if exists agaraccounting_journal_entry_statement_line_client_check on agaraccounting_journal_entries;
    create trigger agaraccounting_journal_entry_statement_line_client_check
    before insert or update of client_id, statement_line_id on agaraccounting_journal_entries
    for each row execute function agaraccounting_assert_journal_entry_statement_line_client();

    drop trigger if exists agaraccounting_journal_entry_client_ownership_immutable on agaraccounting_journal_entries;
    create trigger agaraccounting_journal_entry_client_ownership_immutable
    before update of client_id on agaraccounting_journal_entries
    for each row execute function agaraccounting_prevent_client_ownership_change();

    drop trigger if exists agaraccounting_statement_line_contact_client_check on agaraccounting_statement_lines;
    create trigger agaraccounting_statement_line_contact_client_check
    before insert or update of client_id, contact_id on agaraccounting_statement_lines
    for each row execute function agaraccounting_assert_contact_client();

    drop trigger if exists agaraccounting_journal_entry_contact_client_check on agaraccounting_journal_entries;
    create trigger agaraccounting_journal_entry_contact_client_check
    before insert or update of client_id, contact_id on agaraccounting_journal_entries
    for each row execute function agaraccounting_assert_contact_client();

    drop trigger if exists agaraccounting_contact_alias_client_check on agaraccounting_contact_aliases;
    create trigger agaraccounting_contact_alias_client_check
    before insert or update of client_id, contact_id on agaraccounting_contact_aliases
    for each row execute function agaraccounting_assert_contact_client();

    drop trigger if exists agaraccounting_contact_client_ownership_immutable on agaraccounting_contacts;
    create trigger agaraccounting_contact_client_ownership_immutable
    before update of client_id on agaraccounting_contacts
    for each row execute function agaraccounting_prevent_client_ownership_change();

    drop trigger if exists agaraccounting_contact_evidence_client_check on agaraccounting_contact_classification_evidence;
    create trigger agaraccounting_contact_evidence_client_check
    before insert on agaraccounting_contact_classification_evidence
    for each row execute function agaraccounting_assert_contact_evidence_client();

    create or replace function agaraccounting_reject_bulk_transition_audit_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'Ledger transition audit records are append-only.'
        using errcode = '55000';
    end;
    $$;

    drop trigger if exists agaraccounting_contact_evidence_append_only on agaraccounting_contact_classification_evidence;
    create trigger agaraccounting_contact_evidence_append_only
    before update or delete on agaraccounting_contact_classification_evidence
    for each row execute function agaraccounting_reject_contact_evidence_mutation();

    drop trigger if exists agaraccounting_contact_evidence_no_truncate on agaraccounting_contact_classification_evidence;
    create trigger agaraccounting_contact_evidence_no_truncate
    before truncate on agaraccounting_contact_classification_evidence
    for each statement execute function agaraccounting_reject_bulk_transition_audit_mutation();

    drop trigger if exists agaraccounting_bulk_transition_audits_append_only on agaraccounting_bulk_transition_audits;
    create trigger agaraccounting_bulk_transition_audits_append_only
    before update or delete on agaraccounting_bulk_transition_audits
    for each row execute function agaraccounting_reject_bulk_transition_audit_mutation();

    drop trigger if exists agaraccounting_bulk_transition_audits_no_truncate on agaraccounting_bulk_transition_audits;
      create trigger agaraccounting_bulk_transition_audits_no_truncate
      before truncate on agaraccounting_bulk_transition_audits
      for each statement execute function agaraccounting_reject_bulk_transition_audit_mutation();

    drop trigger if exists agaraccounting_contact_merge_audits_append_only on agaraccounting_contact_merge_audits;
    create trigger agaraccounting_contact_merge_audits_append_only
    before update or delete on agaraccounting_contact_merge_audits
    for each row execute function agaraccounting_reject_bulk_transition_audit_mutation();

    drop trigger if exists agaraccounting_contact_merge_audits_no_truncate on agaraccounting_contact_merge_audits;
    create trigger agaraccounting_contact_merge_audits_no_truncate
      before truncate on agaraccounting_contact_merge_audits
      for each statement execute function agaraccounting_reject_bulk_transition_audit_mutation();
    `);
    await client.query("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `AgarAccounting AI database integrity bootstrap failed before the API could accept traffic. Verify that agaraccounting_statement_imports has at most one completed row for each client and file hash, then rerun the release. ${detail}`,
      { cause: error },
    );
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [AGARACCOUNTING_INTEGRITY_LOCK]);
    client.release();
  }
} finally {
  await pool.end();
}