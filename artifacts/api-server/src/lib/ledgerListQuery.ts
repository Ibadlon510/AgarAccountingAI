import { and, asc, desc, eq, exists, ilike, inArray, isNotNull, isNull, notExists, or, sql } from "drizzle-orm";
import {
  contactsTable,
  db,
  journalEntriesTable,
  statementLineDetailRequestItemsTable,
  statementLineDetailRequestsTable,
  statementLineNotesTable,
  statementLinesTable,
} from "@workspace/db";

const DRAFT_STATUSES = ["draft", "suggested", "approved", "needs_review"] as const;
const LIST_LIMIT_MAX = 200;

export type StatementLineListQuery = {
  clientId?: number;
  currency?: string;
  status?: string;
  direction?: "inflow" | "outflow";
  statementImportId?: number;
  bankAccountId?: number;
  bankAccountIds?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  remarks?: "awaiting";
  sort?: "date" | "description" | "contact" | "account" | "amount" | "confidence" | "status";
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

function parsedBankAccountIds(value?: string) {
  if (!value) return [];
  const ids = [...new Set(value.split(",").map((part) => Number(part.trim())))];
  return ids.length > 0 && ids.length <= 50 && ids.every((id) => Number.isInteger(id) && id > 0)
    ? ids
    : null;
}

export type JournalEntryListQuery = {
  clientId?: number;
  status?: "draft" | "posted";
  source?: "manual" | "statement" | "system";
  currency?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  statementLineId?: number;
  sort?: "date" | "memo" | "currency" | "amount" | "confidence" | "status";
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

function likePattern(value: string) {
  return `%${value.trim()}%`;
}

function awaitingRemarksExists(clientId: number) {
  return exists(
    db.select({ id: statementLineDetailRequestItemsTable.id })
      .from(statementLineDetailRequestItemsTable)
      .innerJoin(
        statementLineDetailRequestsTable,
        eq(statementLineDetailRequestsTable.id, statementLineDetailRequestItemsTable.requestId),
      )
      .where(and(
        eq(statementLineDetailRequestItemsTable.statementLineId, statementLinesTable.id),
        eq(statementLineDetailRequestsTable.clientId, clientId),
        isNull(statementLineDetailRequestsTable.revokedAt),
        sql`${statementLineDetailRequestsTable.expiresAt} > now()`,
        notExists(
          db.select({ id: statementLineNotesTable.id })
            .from(statementLineNotesTable)
            .where(and(
              eq(statementLineNotesTable.requestId, statementLineDetailRequestsTable.id),
              eq(statementLineNotesTable.statementLineId, statementLinesTable.id),
            )),
        ),
      )),
  );
}

export function statementLineConditions(clientId: number, query: StatementLineListQuery) {
  const search = query.search?.trim();
  const bankAccountIds = parsedBankAccountIds(query.bankAccountIds);
  return and(
    eq(statementLinesTable.clientId, clientId),
    query.currency ? eq(statementLinesTable.currency, query.currency) : undefined,
    query.status === "draft"
      ? inArray(statementLinesTable.status, [...DRAFT_STATUSES])
      : query.status ? eq(statementLinesTable.status, query.status) : undefined,
    query.direction ? eq(statementLinesTable.direction, query.direction) : undefined,
    query.statementImportId != null ? eq(statementLinesTable.statementImportId, query.statementImportId) : undefined,
    query.bankAccountId != null ? eq(statementLinesTable.bankAccountId, query.bankAccountId) : undefined,
    bankAccountIds?.length ? inArray(statementLinesTable.bankAccountId, bankAccountIds) : undefined,
    query.dateFrom ? sql`${statementLinesTable.date} >= ${query.dateFrom}` : undefined,
    query.dateTo ? sql`${statementLinesTable.date} <= ${query.dateTo}` : undefined,
    query.remarks === "awaiting" ? and(
      inArray(statementLinesTable.status, [...DRAFT_STATUSES]),
      awaitingRemarksExists(clientId),
    ) : undefined,
    search
      ? or(
        ilike(statementLinesTable.description, likePattern(search)),
        ilike(statementLinesTable.accountSuggestion, likePattern(search)),
        ilike(contactsTable.displayName, likePattern(search)),
        ilike(statementLinesTable.proposedContactName, likePattern(search)),
      )
      : undefined,
  );
}

export function hasValidBankAccountIds(query: StatementLineListQuery) {
  return parsedBankAccountIds(query.bankAccountIds) !== null;
}

function statementLineOrder(query: StatementLineListQuery) {
  const direction = query.sortDirection === "desc" ? desc : asc;
  const column = query.sort === "description" ? statementLinesTable.description
    : query.sort === "contact" ? contactsTable.displayName
      : query.sort === "account" ? statementLinesTable.accountSuggestion
        : query.sort === "amount" ? statementLinesTable.amount
          : query.sort === "confidence" ? statementLinesTable.confidence
            : query.sort === "status" ? statementLinesTable.status
              : statementLinesTable.date;
  return [direction(column), direction(statementLinesTable.id)];
}

export async function listStatementLines(clientId: number, query: StatementLineListQuery) {
  const conditions = statementLineConditions(clientId, query);
  const rowsQuery = db.select({ line: statementLinesTable })
    .from(statementLinesTable)
    .leftJoin(contactsTable, and(
      eq(contactsTable.id, statementLinesTable.contactId),
      eq(contactsTable.clientId, clientId),
    ))
    .where(conditions)
    .orderBy(...statementLineOrder(query));
  const limited = query.limit != null
    ? rowsQuery.limit(Math.min(Math.max(1, query.limit), LIST_LIMIT_MAX)).offset(Math.max(0, query.offset ?? 0))
    : query.offset
      ? rowsQuery.offset(Math.max(0, query.offset))
      : rowsQuery;
  const rows = await limited;
  return rows.map((row) => row.line);
}

export async function summarizeStatementLines(clientId: number, query: StatementLineListQuery) {
  const conditions = statementLineConditions(clientId, query);
  const [countRow, currencyRows, unassignedRow, bankRows] = await Promise.all([
    db.select({
      totalCount: sql<number>`count(distinct ${statementLinesTable.id})::int`,
    }).from(statementLinesTable)
      .leftJoin(contactsTable, and(
        eq(contactsTable.id, statementLinesTable.contactId),
        eq(contactsTable.clientId, clientId),
      ))
      .where(conditions).then((rows) => rows[0]),
    db.selectDistinct({ currency: statementLinesTable.currency })
      .from(statementLinesTable)
      .leftJoin(contactsTable, and(
        eq(contactsTable.id, statementLinesTable.contactId),
        eq(contactsTable.clientId, clientId),
      ))
      .where(conditions)
      .orderBy(asc(statementLinesTable.currency)),
    db.select({
      unassignedCount: sql<number>`count(*)::int`,
    }).from(statementLinesTable)
      .leftJoin(contactsTable, and(
        eq(contactsTable.id, statementLinesTable.contactId),
        eq(contactsTable.clientId, clientId),
      ))
      .where(and(conditions, isNull(statementLinesTable.bankAccountId)))
      .then((rows) => rows[0]),
    db.select({
      bankAccountId: statementLinesTable.bankAccountId,
      lineCount: sql<number>`count(*)::int`,
      dateFrom: sql<string | null>`min(${statementLinesTable.date})`,
      dateTo: sql<string | null>`max(${statementLinesTable.date})`,
      sourceLabels: sql<string[]>`array_remove(array_agg(distinct ${statementLinesTable.source}), null)`,
      inflowTotal: sql<string>`coalesce(sum(case when ${statementLinesTable.direction} = 'inflow' and ${statementLinesTable.date} <= to_char(current_date, 'YYYY-MM-DD') then ${statementLinesTable.amount} else 0 end), 0)`,
      outflowTotal: sql<string>`coalesce(sum(case when ${statementLinesTable.direction} = 'outflow' and ${statementLinesTable.date} <= to_char(current_date, 'YYYY-MM-DD') then ${statementLinesTable.amount} else 0 end), 0)`,
    }).from(statementLinesTable)
      .leftJoin(contactsTable, and(
        eq(contactsTable.id, statementLinesTable.contactId),
        eq(contactsTable.clientId, clientId),
      ))
      .where(and(conditions, isNotNull(statementLinesTable.bankAccountId)))
      .groupBy(statementLinesTable.bankAccountId),
  ]);
  return {
    totalCount: Number(countRow?.totalCount ?? 0),
    currencies: currencyRows.map((row) => row.currency).filter(Boolean).sort(),
    unassignedCount: Number(unassignedRow?.unassignedCount ?? 0),
    bankAccounts: bankRows.flatMap((row) => row.bankAccountId == null ? [] : [{
      bankAccountId: row.bankAccountId,
      lineCount: Number(row.lineCount),
      dateFrom: row.dateFrom,
      dateTo: row.dateTo,
      sourceLabels: (row.sourceLabels ?? []).filter(Boolean),
      inflowTotal: Number(row.inflowTotal ?? 0),
      outflowTotal: Number(row.outflowTotal ?? 0),
    }]),
  };
}

export function journalEntryConditions(clientId: number, query: JournalEntryListQuery) {
  const search = query.search?.trim();
  return and(
    eq(journalEntriesTable.clientId, clientId),
    query.status === "draft"
      ? inArray(journalEntriesTable.status, [...DRAFT_STATUSES])
      : query.status ? eq(journalEntriesTable.status, query.status) : undefined,
    query.source === "manual" ? and(isNull(journalEntriesTable.statementLineId), isNull(journalEntriesTable.systemSource)) : undefined,
    query.source === "statement" ? isNotNull(journalEntriesTable.statementLineId) : undefined,
    query.source === "system" ? isNotNull(journalEntriesTable.systemSource) : undefined,
    query.currency ? eq(journalEntriesTable.currency, query.currency) : undefined,
    query.statementLineId != null ? eq(journalEntriesTable.statementLineId, query.statementLineId) : undefined,
    query.dateFrom ? sql`${journalEntriesTable.date} >= ${query.dateFrom}` : undefined,
    query.dateTo ? sql`${journalEntriesTable.date} <= ${query.dateTo}` : undefined,
    search ? or(
      ilike(journalEntriesTable.memo, likePattern(search)),
      ilike(journalEntriesTable.currency, likePattern(search)),
      sql`('JE-' || lpad(${journalEntriesTable.id}::text, 4, '0')) ilike ${likePattern(search)}`,
    ) : undefined,
  );
}

function journalEntryOrder(query: JournalEntryListQuery) {
  const direction = query.sortDirection === "desc" ? desc : asc;
  const column = query.sort === "memo" ? journalEntriesTable.memo
    : query.sort === "currency" ? journalEntriesTable.currency
      : query.sort === "amount" ? journalEntriesTable.amount
        : query.sort === "confidence" ? journalEntriesTable.confidence
          : query.sort === "status" ? journalEntriesTable.status
            : journalEntriesTable.date;
  return [direction(column), direction(journalEntriesTable.id)];
}

export async function listJournalEntries(clientId: number, query: JournalEntryListQuery) {
  const conditions = journalEntryConditions(clientId, query);
  const rowsQuery = db.select().from(journalEntriesTable)
    .where(conditions)
    .orderBy(...journalEntryOrder(query));
  const limited = query.limit != null
    ? rowsQuery.limit(Math.min(Math.max(1, query.limit), LIST_LIMIT_MAX)).offset(Math.max(0, query.offset ?? 0))
    : query.offset
      ? rowsQuery.offset(Math.max(0, query.offset))
      : rowsQuery;
  return limited;
}

export async function summarizeJournalEntries(clientId: number, query: JournalEntryListQuery) {
  const conditions = journalEntryConditions(clientId, query);
  const [countRow, currencyRows] = await Promise.all([
    db.select({ totalCount: sql<number>`count(*)::int` }).from(journalEntriesTable).where(conditions).then((rows) => rows[0]),
    db.selectDistinct({ currency: journalEntriesTable.currency })
      .from(journalEntriesTable)
      .where(conditions)
      .orderBy(asc(journalEntriesTable.currency)),
  ]);
  return {
    totalCount: Number(countRow?.totalCount ?? 0),
    currencies: currencyRows.map((row) => row.currency).filter(Boolean).sort(),
  };
}
