import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before installing LedgerFlow integrity checks.");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(`
    create or replace function ledgerflow_prevent_client_ownership_change()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.client_id is distinct from old.client_id then
        raise exception 'LedgerFlow record ownership cannot be moved between clients.'
          using errcode = '23514';
      end if;
      return new;
    end;
    $$;

    create or replace function ledgerflow_assert_statement_line_bank_account_client()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.bank_account_id is not null and not exists (
        select 1
        from ledgerflow_bank_accounts account
        where account.id = new.bank_account_id
          and account.client_id = new.client_id
      ) then
        raise exception 'Statement line bank account must belong to the same client.'
          using errcode = '23503';
      end if;
      return new;
    end;
    $$;

    create or replace function ledgerflow_assert_statement_import_bank_account_client()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.bank_account_id is not null and not exists (
        select 1
        from ledgerflow_bank_accounts account
        where account.id = new.bank_account_id
          and account.client_id = new.client_id
      ) then
        raise exception 'Statement import bank account must belong to the same client.'
          using errcode = '23503';
      end if;
      return new;
    end;
    $$;

    create or replace function ledgerflow_assert_journal_entry_statement_line_client()
    returns trigger
    language plpgsql
    as $$
    begin
      if not exists (
        select 1
        from ledgerflow_statement_lines line
        where line.id = new.statement_line_id
          and line.client_id = new.client_id
      ) then
        raise exception 'Journal entry statement line must belong to the same client.'
          using errcode = '23503';
      end if;
      return new;
    end;
    $$;

    drop trigger if exists ledgerflow_statement_line_bank_account_client_check on ledgerflow_statement_lines;
    create trigger ledgerflow_statement_line_bank_account_client_check
    before insert or update of client_id, bank_account_id on ledgerflow_statement_lines
    for each row execute function ledgerflow_assert_statement_line_bank_account_client();

    drop trigger if exists ledgerflow_bank_account_client_ownership_immutable on ledgerflow_bank_accounts;
    create trigger ledgerflow_bank_account_client_ownership_immutable
    before update of client_id on ledgerflow_bank_accounts
    for each row execute function ledgerflow_prevent_client_ownership_change();

    drop trigger if exists ledgerflow_statement_line_client_ownership_immutable on ledgerflow_statement_lines;
    create trigger ledgerflow_statement_line_client_ownership_immutable
    before update of client_id on ledgerflow_statement_lines
    for each row execute function ledgerflow_prevent_client_ownership_change();

    drop trigger if exists ledgerflow_statement_import_bank_account_client_check on ledgerflow_statement_imports;
    create trigger ledgerflow_statement_import_bank_account_client_check
    before insert or update of client_id, bank_account_id on ledgerflow_statement_imports
    for each row execute function ledgerflow_assert_statement_import_bank_account_client();

    drop trigger if exists ledgerflow_statement_import_client_ownership_immutable on ledgerflow_statement_imports;
    create trigger ledgerflow_statement_import_client_ownership_immutable
    before update of client_id on ledgerflow_statement_imports
    for each row execute function ledgerflow_prevent_client_ownership_change();

    drop trigger if exists ledgerflow_journal_entry_statement_line_client_check on ledgerflow_journal_entries;
    create trigger ledgerflow_journal_entry_statement_line_client_check
    before insert or update of client_id, statement_line_id on ledgerflow_journal_entries
    for each row execute function ledgerflow_assert_journal_entry_statement_line_client();

    drop trigger if exists ledgerflow_journal_entry_client_ownership_immutable on ledgerflow_journal_entries;
    create trigger ledgerflow_journal_entry_client_ownership_immutable
    before update of client_id on ledgerflow_journal_entries
    for each row execute function ledgerflow_prevent_client_ownership_change();
  `);
} finally {
  await pool.end();
}