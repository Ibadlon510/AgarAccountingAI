import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import {
  accountClassificationsTable,
  db,
  journalEntriesTable,
  shareholdersTable,
  type Client,
} from "@workspace/db";

export const SHARE_CAPITAL_ACCOUNT_NAME = "Share capital";
export const LEGACY_SHARE_CAPITAL_ACCOUNT_NAME = "Share Capital";
export const SHARE_CAPITAL_ACCOUNT_NAMES = [
  SHARE_CAPITAL_ACCOUNT_NAME,
  LEGACY_SHARE_CAPITAL_ACCOUNT_NAME,
] as const;
export const DUE_FROM_SHAREHOLDERS_ACCOUNT_NAME = "Due from shareholders";
export const SHARE_CAPITAL_SYSTEM_SOURCE = "share_capital_register";
export const SHARE_CAPITAL_NOTE_NUMBER = 8;
export const SHARE_CAPITAL_DUPLICATE_WARNING =
  "Share capital is now posted from the client register. The books also contain an earlier Share capital journal. Remove or reverse that older entry so Share capital is not duplicated.";

export function isShareCapitalAccountName(accountName: string) {
  return SHARE_CAPITAL_ACCOUNT_NAMES.includes(accountName as typeof SHARE_CAPITAL_ACCOUNT_NAMES[number]);
}

export type ShareholdingRowInput = {
  name: string;
  nationality: string | null;
  numberOfShares: number;
};

export type ReportShareholdingRow = {
  name: string;
  percentage: number;
  nationality: string | null;
  numberOfShares: number;
  value: number;
};

export type ReportShareholding = {
  authorisedShares: number;
  parValue: number;
  rows: ReportShareholdingRow[];
};

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function closePeriodStartDate(period: string) {
  const numeric = period.match(/^(\d{4})-(\d{2})$/);
  if (numeric && Number(numeric[2]) >= 1 && Number(numeric[2]) <= 12) {
    return `${numeric[1]}-${numeric[2]}-01`;
  }
  const named = period.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (named) {
    const month = monthNames.findIndex((name) => name.toLowerCase() === named[1].toLowerCase()) + 1;
    if (month) return `${named[2]}-${String(month).padStart(2, "0")}-01`;
  }
  const year = Number(period.match(/\d{4}/)?.[0]);
  return Number.isFinite(year) ? `${year}-01-01` : new Date().toISOString().slice(0, 10);
}

export function formatShareParValue(parValue: number) {
  return Number.isInteger(parValue) ? String(parValue) : parValue.toFixed(2);
}

export function buildShareholdingSnapshot(input: {
  authorisedShares: number | null;
  parValue: number | null;
  shareholders: ShareholdingRowInput[];
}): ReportShareholding | undefined {
  const authorisedShares = input.authorisedShares;
  const parValue = input.parValue;
  if (authorisedShares == null || authorisedShares <= 0 || parValue == null || parValue <= 0) {
    return undefined;
  }
  if (!input.shareholders.length) return undefined;
  return {
    authorisedShares,
    parValue,
    rows: input.shareholders.map((row) => ({
      name: row.name,
      nationality: row.nationality ?? null,
      numberOfShares: row.numberOfShares,
      percentage: Math.round((row.numberOfShares / authorisedShares) * 100),
      value: row.numberOfShares * parValue,
    })),
  };
}

export function shareCapitalRegisterComplete(input: {
  authorisedShares: number | null;
  parValue: number | null;
  shareholders: ShareholdingRowInput[];
}) {
  return Boolean(buildShareholdingSnapshot(input));
}

export type ShareCapitalExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

export type ShareCapitalClientExtras = {
  shareholders: Array<{
    id: number;
    clientId: number;
    name: string;
    nationality: string | null;
    numberOfShares: number;
    sortOrder: number;
  }>;
  shareCapitalJournalId: number | null;
  shareCapitalDuplicateWarning: string | null;
};

function numberOrNull(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function clientShareCapitalFields(client: Pick<Client, "shareCapitalAuthorisedShares" | "shareCapitalParValue">) {
  return {
    shareCapitalAuthorisedShares: client.shareCapitalAuthorisedShares ?? null,
    shareCapitalParValue: numberOrNull(client.shareCapitalParValue),
  };
}

export async function loadShareCapitalClientExtras(
  clientIds: number[],
  executor: ShareCapitalExecutor = db,
): Promise<Map<number, ShareCapitalClientExtras>> {
  const extras = new Map<number, ShareCapitalClientExtras>();
  for (const clientId of clientIds) {
    extras.set(clientId, {
      shareholders: [],
      shareCapitalJournalId: null,
      shareCapitalDuplicateWarning: null,
    });
  }
  if (!clientIds.length) return extras;

  const [rows, systemJournals, foreignJournals] = await Promise.all([
    executor.select().from(shareholdersTable)
      .where(inArray(shareholdersTable.clientId, clientIds))
      .orderBy(asc(shareholdersTable.sortOrder), asc(shareholdersTable.id)),
    executor.select({
      id: journalEntriesTable.id,
      clientId: journalEntriesTable.clientId,
    }).from(journalEntriesTable).where(and(
      inArray(journalEntriesTable.clientId, clientIds),
      eq(journalEntriesTable.systemSource, SHARE_CAPITAL_SYSTEM_SOURCE),
    )),
    executor.select({
      clientId: journalEntriesTable.clientId,
    }).from(journalEntriesTable).where(and(
      inArray(journalEntriesTable.clientId, clientIds),
      inArray(journalEntriesTable.creditAccount, [...SHARE_CAPITAL_ACCOUNT_NAMES]),
      eq(journalEntriesTable.status, "posted"),
      or(isNull(journalEntriesTable.systemSource), ne(journalEntriesTable.systemSource, SHARE_CAPITAL_SYSTEM_SOURCE)),
    )),
  ]);

  for (const row of rows) {
    extras.get(row.clientId)?.shareholders.push({
      id: row.id,
      clientId: row.clientId,
      name: row.name,
      nationality: row.nationality,
      numberOfShares: row.numberOfShares,
      sortOrder: row.sortOrder,
    });
  }
  const systemClientIds = new Set(systemJournals.map((row) => row.clientId));
  for (const journal of systemJournals) {
    const current = extras.get(journal.clientId);
    if (current) current.shareCapitalJournalId = journal.id;
  }
  const foreignClients = new Set(foreignJournals.map((row) => row.clientId));
  for (const clientId of foreignClients) {
    if (!systemClientIds.has(clientId)) continue;
    const current = extras.get(clientId);
    if (current) current.shareCapitalDuplicateWarning = SHARE_CAPITAL_DUPLICATE_WARNING;
  }
  return extras;
}

export async function replaceClientShareholders(
  executor: ShareCapitalExecutor,
  clientId: number,
  shareholders: ShareholdingRowInput[],
) {
  await executor.delete(shareholdersTable).where(eq(shareholdersTable.clientId, clientId));
  if (!shareholders.length) return [];
  return executor.insert(shareholdersTable).values(shareholders.map((row, index) => ({
    clientId,
    name: row.name,
    nationality: row.nationality,
    numberOfShares: row.numberOfShares,
    sortOrder: index,
  }))).returning();
}

async function resolveShareCapitalAccounts(executor: ShareCapitalExecutor, clientId: number) {
  const accounts = await executor.select({
    id: accountClassificationsTable.id,
    accountName: accountClassificationsTable.accountName,
  }).from(accountClassificationsTable).where(and(
    eq(accountClassificationsTable.clientId, clientId),
    inArray(accountClassificationsTable.accountName, [
      ...SHARE_CAPITAL_ACCOUNT_NAMES,
      DUE_FROM_SHAREHOLDERS_ACCOUNT_NAME,
    ]),
    eq(accountClassificationsTable.isActive, true),
  ));
  const debit = accounts.find((account) => account.accountName === DUE_FROM_SHAREHOLDERS_ACCOUNT_NAME);
  const credit = accounts.find((account) => isShareCapitalAccountName(account.accountName));
  if (!debit || !credit) {
    throw new Error("Share capital accounts are missing from the client chart.");
  }
  return { debit, credit };
}

export async function syncShareCapitalJournal(input: {
  executor?: ShareCapitalExecutor;
  client: Pick<Client, "id" | "period" | "functionalCurrency">;
  authorisedShares: number | null;
  parValue: number | null;
}) {
  const executor = input.executor ?? db;
  const amount = input.authorisedShares != null && input.parValue != null
    ? input.authorisedShares * input.parValue
    : 0;
  const [existing] = await executor.select().from(journalEntriesTable).where(and(
    eq(journalEntriesTable.clientId, input.client.id),
    eq(journalEntriesTable.systemSource, SHARE_CAPITAL_SYSTEM_SOURCE),
  )).limit(1);

  if (!(amount > 0)) {
    if (existing) {
      await executor.delete(journalEntriesTable).where(and(
        eq(journalEntriesTable.id, existing.id),
        eq(journalEntriesTable.clientId, input.client.id),
        eq(journalEntriesTable.systemSource, SHARE_CAPITAL_SYSTEM_SOURCE),
      ));
    }
    return { journalId: null as number | null };
  }

  const date = closePeriodStartDate(input.client.period);
  const currency = input.client.functionalCurrency;
  const accounts = await resolveShareCapitalAccounts(executor, input.client.id);
  const values = {
    date,
    memo: "Share capital per client register",
    currency,
    status: "posted" as const,
    confidence: "1.00",
    debitAccount: accounts.debit.accountName,
    creditAccount: accounts.credit.accountName,
    debitAccountClassificationId: accounts.debit.id,
    creditAccountClassificationId: accounts.credit.id,
    amount: amount.toFixed(2),
    functionalCurrency: currency,
    functionalAmount: amount.toFixed(2),
    exchangeRate: "1.0000000000",
    exchangeRateEffectiveDate: date,
    exchangeRateSourceScope: "none" as const,
    exchangeRateStatus: "not_required",
    systemSource: SHARE_CAPITAL_SYSTEM_SOURCE,
  };

  if (existing) {
    const [updated] = await executor.update(journalEntriesTable)
      .set(values)
      .where(and(
        eq(journalEntriesTable.id, existing.id),
        eq(journalEntriesTable.clientId, input.client.id),
        eq(journalEntriesTable.systemSource, SHARE_CAPITAL_SYSTEM_SOURCE),
      ))
      .returning({ id: journalEntriesTable.id });
    return { journalId: updated?.id ?? existing.id };
  }

  const [created] = await executor.insert(journalEntriesTable).values({
    statementLineId: null,
    clientId: input.client.id,
    ...values,
  }).returning({ id: journalEntriesTable.id });
  return { journalId: created?.id ?? null };
}
