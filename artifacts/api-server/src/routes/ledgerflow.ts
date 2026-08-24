import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import OpenAI from "openai";
import {
  ApproveJournalEntryParams,
  ApproveJournalEntryBody,
  AskLedgerflowAIBody,
  AskLedgerflowAIResponse,
  ConfirmAICopilotActionBody,
  ConfirmAICopilotActionResponse,
  CreateBankAccountBody,
  CreateBankAccountResponse,
  CreateExchangeRateBody,
  CreateExchangeRateResponse,
  DeleteExchangeRateParams,
  GetBankAccountsQueryParams,
  GetBankAccountsResponse,
  GetExchangeRatesResponse,
  ImportExchangeRatesBody,
  ImportExchangeRatesResponse,
  ApproveJournalEntryResponse,
  UpdateClientParams,
  UpdateClientBody,
  UpdateClientResponse,
  UpdateExchangeRateBody,
  UpdateExchangeRateParams,
  UpdateExchangeRateResponse,
  CreateStatementLineBody,
  CreateStatementLineResponse,
  GetFinancialStatementsQueryParams,
  GetFinancialStatementsResponse,
  GetJournalEntriesResponse,
  GetLedgerOverviewResponse,
  GetStatementLinesQueryParams,
  GetStatementLinesResponse,
  GetTrialBalanceResponse,
  PostJournalEntryBody,
  ImportStatementResponse,
} from "@workspace/api-zod";
import {
  bankAccountsTable,
  classificationPatternsTable,
  clientWorkspacesTable,
  clientsTable,
  db,
  exchangeRatesTable,
  journalEntriesTable,
  statementImportsTable,
  statementLinesTable,
  usersTable,
} from "@workspace/db";

const router: IRouter = Router();
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

type LedgerflowTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const seedLines = [
  { date: "2026-08-03", description: "EMIRATES AIRLINES", currency: "AED", amount: "1840.00", direction: "outflow", status: "posted", source: "Bank statement", accountSuggestion: "Travel & entertainment", confidence: "0.98" },
  { date: "2026-08-05", description: "STRIPE PAYOUT 8472", currency: "USD", amount: "12450.00", direction: "inflow", status: "posted", source: "Bank statement", accountSuggestion: "Revenue", confidence: "0.99" },
  { date: "2026-08-07", description: "AWS EMEA", currency: "USD", amount: "624.50", direction: "outflow", status: "needs_review", source: "Bank statement", accountSuggestion: "Software & subscriptions", confidence: "0.91" },
  { date: "2026-08-10", description: "AL FARAJ OFFICE SUPPLIES", currency: "AED", amount: "389.00", direction: "outflow", status: "needs_review", source: "Bank statement", accountSuggestion: "Office expenses", confidence: "0.87" },
  { date: "2026-08-12", description: "CLIENT RETAINER — NORTHSTAR", currency: "AED", amount: "28750.00", direction: "inflow", status: "posted", source: "Bank statement", accountSuggestion: "Revenue", confidence: "0.97" },
  { date: "2026-08-15", description: "GULF TELECOM", currency: "AED", amount: "475.00", direction: "outflow", status: "needs_review", source: "Bank statement", accountSuggestion: "Communication expenses", confidence: "0.84" },
];

function journalEntryResponse(entry: typeof journalEntriesTable.$inferSelect) {
  return {
    id: entry.id,
    statementLineId: entry.statementLineId,
    date: calendarDate(entry.date),
    memo: entry.memo,
    currency: entry.currency,
    status: entry.status,
    confidence: number(entry.confidence),
    functionalCurrency: entry.functionalCurrency,
    functionalAmount: entry.functionalAmount == null ? null : number(entry.functionalAmount),
    exchangeRate: entry.exchangeRate == null ? null : number(entry.exchangeRate),
    exchangeRateEffectiveDate: calendarDate(entry.exchangeRateEffectiveDate),
    exchangeRateStatus: entry.exchangeRateStatus,
    lines: [
      { account: entry.debitAccount, debit: number(entry.amount), credit: 0 },
      { account: entry.creditAccount, debit: 0, credit: number(entry.amount) },
    ],
  };
}
function number(value: string | null | undefined) {
  return Number(value ?? 0);
}

function calendarDate(value: string | Date | null | undefined) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function normalizeCurrency(value: string) {
  return value.trim().toUpperCase();
}

function normalizeRateInput(input: {
  sourceCurrency: string;
  functionalCurrency: string;
  effectiveDate: string | Date;
  rate: number;
  source?: string | null;
  note?: string | null;
}) {
  const sourceCurrency = normalizeCurrency(input.sourceCurrency);
  const functionalCurrency = normalizeCurrency(input.functionalCurrency);
  if (!/^[A-Z]{3}$/.test(sourceCurrency) || !/^[A-Z]{3}$/.test(functionalCurrency)) {
    throw new Error("Currencies must use three-letter ISO codes.");
  }
  if (sourceCurrency === functionalCurrency) {
    throw new Error("A rate must convert between two different currencies.");
  }
  const effectiveDate = calendarDate(input.effectiveDate);
  if (!effectiveDate || !isIsoDate(effectiveDate)) throw new Error("Effective date must use YYYY-MM-DD.");
  if (!Number.isFinite(input.rate) || input.rate <= 0) throw new Error("Exchange rate must be greater than zero.");
  return {
    sourceCurrency,
    functionalCurrency,
    effectiveDate,
    rate: input.rate.toFixed(10),
    source: input.source?.trim().slice(0, 120) || "Manual",
    note: input.note?.trim().slice(0, 500) || null,
  };
}

function exchangeRateResponse(rate: typeof exchangeRatesTable.$inferSelect) {
  return {
    id: rate.id,
    sourceCurrency: rate.sourceCurrency,
    functionalCurrency: rate.functionalCurrency,
    effectiveDate: calendarDate(rate.effectiveDate),
    rate: number(rate.rate),
    source: rate.source,
    note: rate.note,
  };
}

type RateResolution = {
  functionalCurrency: string;
  functionalAmount: string | null;
  exchangeRate: string | null;
  exchangeRateEffectiveDate: string | null;
  exchangeRateStatus: "not_required" | "exact" | "prior" | "missing";
};

async function resolveExchangeRate(userId: string, sourceCurrency: string, functionalCurrency: string, transactionDate: string, amount: string | number): Promise<RateResolution> {
  const source = normalizeCurrency(sourceCurrency);
  const functional = normalizeCurrency(functionalCurrency);
  if (source === functional) {
    return {
      functionalCurrency: functional,
      functionalAmount: Number(amount).toFixed(2),
      exchangeRate: "1.0000000000",
      exchangeRateEffectiveDate: transactionDate,
      exchangeRateStatus: "not_required",
    };
  }
  const [rate] = await db.select().from(exchangeRatesTable).where(and(
    eq(exchangeRatesTable.userId, userId),
    eq(exchangeRatesTable.sourceCurrency, source),
    eq(exchangeRatesTable.functionalCurrency, functional),
    lte(exchangeRatesTable.effectiveDate, transactionDate),
  )).orderBy(desc(exchangeRatesTable.effectiveDate)).limit(1);
  if (!rate) {
    return {
      functionalCurrency: functional,
      functionalAmount: null,
      exchangeRate: null,
      exchangeRateEffectiveDate: null,
      exchangeRateStatus: "missing",
    };
  }
  return {
    functionalCurrency: functional,
    functionalAmount: (Number(amount) * number(rate.rate)).toFixed(2),
    exchangeRate: rate.rate,
    exchangeRateEffectiveDate: calendarDate(rate.effectiveDate),
    exchangeRateStatus: calendarDate(rate.effectiveDate) === transactionDate ? "exact" : "prior",
  };
}

async function refreshWorkspaceRateConversions(userId: string) {
  const lines = await db.select({
    line: statementLinesTable,
    functionalCurrency: clientsTable.functionalCurrency,
  }).from(statementLinesTable)
    .innerJoin(clientWorkspacesTable, and(
      eq(clientWorkspacesTable.clientId, statementLinesTable.clientId),
      eq(clientWorkspacesTable.userId, userId),
    ))
    .innerJoin(clientsTable, eq(clientsTable.id, statementLinesTable.clientId));

  await Promise.all(lines.map(async ({ line, functionalCurrency }) => {
    const conversion = await resolveExchangeRate(userId, line.currency, functionalCurrency, calendarDate(line.date) ?? "", line.amount);
    const values = {
      functionalCurrency: conversion.functionalCurrency,
      functionalAmount: conversion.functionalAmount,
      exchangeRate: conversion.exchangeRate,
      exchangeRateEffectiveDate: conversion.exchangeRateEffectiveDate,
      exchangeRateStatus: conversion.exchangeRateStatus,
    };
    await db.transaction(async (tx) => {
      await tx.update(statementLinesTable).set(values).where(eq(statementLinesTable.id, line.id));
      await tx.update(journalEntriesTable).set(values).where(eq(journalEntriesTable.statementLineId, line.id));
    });
  }));
}

function reportingAmount(entry: typeof journalEntriesTable.$inferSelect, functionalCurrency: string) {
  if (entry.functionalAmount != null && entry.functionalCurrency === functionalCurrency) return number(entry.functionalAmount);
  if (normalizeCurrency(entry.currency) === functionalCurrency) return number(entry.amount);
  return null;
}

function currentUserId(req: Request) {
  if (!req.user) throw new Error("Authenticated user is required.");
  return req.user.id;
}

async function getOwnedClient(req: Request, requestedClientId?: number) {
  const conditions = [eq(clientWorkspacesTable.userId, currentUserId(req))];
  if (requestedClientId !== undefined) {
    conditions.push(eq(clientWorkspacesTable.clientId, requestedClientId));
  }
  const [membership] = await db.select({ clientId: clientWorkspacesTable.clientId })
    .from(clientWorkspacesTable)
    .where(and(...conditions))
    .limit(1);
  if (!membership) return null;
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, membership.clientId));
  return client ?? null;
}

async function requireOwnedClient(req: Request, res: Response, requestedClientId?: number) {
  const client = await getOwnedClient(req, requestedClientId);
  if (!client) {
    res.status(403).json({ error: "You do not have access to this client workspace." });
    return null;
  }
  return client;
}

export async function ensureUserWorkspace(userId: string) {
  await db.transaction(async (tx) => {
    const [user] = await tx.select({ starterClientId: usersTable.starterClientId })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .for("update");
    if (!user) throw new Error("Cannot create a workspace for an unknown user.");
    if (user.starterClientId) return;
    const [existingWorkspace] = await tx.select({ clientId: clientWorkspacesTable.clientId })
      .from(clientWorkspacesTable)
      .where(eq(clientWorkspacesTable.userId, userId))
      .orderBy(asc(clientWorkspacesTable.createdAt))
      .limit(1);
    if (existingWorkspace) {
      await tx.update(usersTable)
        .set({ starterClientId: existingWorkspace.clientId })
        .where(eq(usersTable.id, userId));
      return;
    }

    const [client] = await tx.insert(clientsTable).values({
      name: "Northstar Advisory",
      legalName: "Northstar Advisory FZ-LLC",
      functionalCurrency: "AED",
      basis: "IFRS",
      period: "August 2026",
    }).returning();
    await tx.insert(clientWorkspacesTable).values({ clientId: client.id, userId });
    await tx.update(usersTable)
      .set({ starterClientId: client.id })
      .where(eq(usersTable.id, userId));
    const inserted = await tx.insert(statementLinesTable).values(seedLines.map((line) => ({
      ...line,
      clientId: client.id,
    }))).returning();
    await tx.insert(journalEntriesTable).values(inserted.map((line) => ({
      clientId: line.clientId,
      statementLineId: line.id,
      date: line.date,
      memo: line.description,
      currency: line.currency,
      status: line.status === "posted" ? "posted" : "suggested",
      confidence: line.confidence ?? "0.80",
      debitAccount: line.direction === "inflow" ? "Bank / cash" : (line.accountSuggestion ?? "Uncategorized"),
      creditAccount: line.direction === "inflow" ? (line.accountSuggestion ?? "Uncategorized") : "Bank / cash",
      amount: line.amount,
    })));
  });
}

function normalizeDescription(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase();
}

function importDedupeKey(line: {
  clientId: number;
  bankAccountId?: number | null;
  date: string;
  description: string;
  amount: number | string;
  direction: string;
  currency: string;
}) {
  return [
    line.clientId,
    line.bankAccountId ?? "none",
    line.date.trim(),
    normalizeDescription(line.description),
    Number(line.amount).toFixed(2),
    line.direction.trim().toLocaleLowerCase(),
    line.currency.trim().toLocaleUpperCase(),
  ].join("|");
}

function clientIdFrom(value: unknown) {
  const parsed = Number(value ?? 1);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function suggestAccount(description: string, direction: string) {
  const text = description.toLowerCase();
  if (direction === "inflow") {
    if (/stripe|retainer|client|invoice|sale|sales|payment|payout|customer/.test(text)) return "Revenue";
    return "Other income";
  }
  if (/emirates|airline|flight|hotel|taxi|uber|careem|travel/.test(text)) return "Travel & entertainment";
  if (/aws|azure|google cloud|software|subscription|saas|adobe|microsoft|hosting/.test(text)) return "Software & subscriptions";
  if (/office|stationery|supplies|printer/.test(text)) return "Office expenses";
  if (/telecom|etisalat|du\\b|internet|phone|mobile/.test(text)) return "Communication expenses";
  if (/rent|lease/.test(text)) return "Rent expense";
  if (/salary|payroll|wages/.test(text)) return "Payroll";
  if (/fee|charge|commission/.test(text)) return "Bank charges";
  return "General expenses";
}

const classificationAccounts = new Set([
  "Revenue",
  "Other income",
  "Travel & entertainment",
  "Software & subscriptions",
  "Office expenses",
  "Communication expenses",
  "Rent expense",
  "Payroll",
  "Bank charges",
  "General expenses",
]);
const vendorNoiseWords = new Set([
  "account", "ae", "bank", "charge", "charges", "co", "company", "credit",
  "debit", "fee", "fees", "fze", "fz", "inc", "invoice", "ltd", "llc",
  "payout", "payment", "payments", "ref", "reference", "transaction", "uae",
]);

function normalizeVendor(description: string) {
  return description
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !/^\d+$/.test(token) && !vendorNoiseWords.has(token))
    .join(" ")
    .slice(0, 160);
}

type SuggestionSource = "ai" | "heuristic" | "workspace_learning";
type ClassificationSuggestion = {
  accountSuggestion: string;
  confidence: number;
  suggestionSource: SuggestionSource;
  supportingPatternCount: number;
};

class RecodeConflictError extends Error {}

async function getWorkspacePatterns(userId: string) {
  return db.select().from(classificationPatternsTable).where(eq(classificationPatternsTable.userId, userId));
}

function findWorkspaceSuggestion(
  patterns: Array<typeof classificationPatternsTable.$inferSelect>,
  description: string,
): ClassificationSuggestion | null {
  const normalized = normalizeVendor(description);
  if (!normalized) return null;
  const tokens = new Set(normalized.split(" "));
  const candidates = patterns.map((pattern) => {
    const patternTokens = new Set(pattern.normalizedVendor.split(" "));
    const overlap = [...tokens].filter((token) => patternTokens.has(token)).length;
    const union = new Set([...tokens, ...patternTokens]).size;
    const similarity = normalized === pattern.normalizedVendor
      ? 1
      : union === 0 ? 0 : overlap / union;
    return { pattern, similarity };
  }).filter(({ similarity }) => similarity >= 0.62)
    .sort((a, b) => b.similarity - a.similarity
      || b.pattern.confirmationCount - a.pattern.confirmationCount
      || Number(b.pattern.confidence) - Number(a.pattern.confidence));
  const best = candidates[0];
  if (!best) return null;

  // Do not choose between equally plausible confirmed accounts. Falling back to
  // the normal heuristic is safer than crossing a client's classification.
  const competingAccount = candidates.find(({ pattern, similarity }) =>
    pattern.accountSuggestion !== best.pattern.accountSuggestion
      && similarity >= best.similarity - 0.08,
  );
  if (competingAccount) return null;

  const confidence = Math.min(
    0.99,
    Math.max(0.85, Number(best.pattern.confidence)) * (0.92 + best.similarity * 0.08),
  );
  return {
    accountSuggestion: best.pattern.accountSuggestion,
    confidence,
    suggestionSource: "workspace_learning",
    supportingPatternCount: best.pattern.confirmationCount,
  };
}

async function recordClassificationPattern(
  userId: string,
  description: string,
  accountSuggestion: string,
  confidence: number | string | null | undefined,
  executor: Pick<typeof db, "insert"> = db,
) {
  const normalizedVendor = normalizeVendor(description);
  const normalizedAccount = accountSuggestion.trim().slice(0, 160);
  if (!normalizedVendor || !classificationAccounts.has(normalizedAccount)) return;
  const confirmedConfidence = Math.min(0.99, Math.max(0.85, Number(confidence) || 0.85));
  await executor.insert(classificationPatternsTable).values({
    userId,
    normalizedVendor,
    accountSuggestion: normalizedAccount,
    confidence: confirmedConfidence.toFixed(2),
    confirmationCount: 1,
  }).onConflictDoUpdate({
    target: [
      classificationPatternsTable.userId,
      classificationPatternsTable.normalizedVendor,
      classificationPatternsTable.accountSuggestion,
    ],
    set: {
      confirmationCount: sql`${classificationPatternsTable.confirmationCount} + 1`,
      confidence: sql`GREATEST(${classificationPatternsTable.confidence}, ${confirmedConfidence.toFixed(2)})`,
      updatedAt: new Date(),
    },
  });
}

function lineSuggestion(
  line: { description: string; direction: string; accountSuggestion?: string | null; confidence?: string | number | null },
  patterns: Array<typeof classificationPatternsTable.$inferSelect>,
): ClassificationSuggestion {
  const learned = findWorkspaceSuggestion(patterns, line.description);
  if (learned) return learned;
  const accountSuggestion = line.accountSuggestion?.trim() || suggestAccount(line.description, line.direction);
  const confidence = Number(line.confidence);
  return {
    accountSuggestion,
    confidence: Number.isFinite(confidence) ? confidence : 0.75,
    suggestionSource: line.accountSuggestion ? "ai" : "heuristic",
    supportingPatternCount: 0,
  };
}

function statementLineResponse(
  line: typeof statementLinesTable.$inferSelect,
  patterns: Array<typeof classificationPatternsTable.$inferSelect>,
) {
  const suggestion = lineSuggestion(line, patterns);
  return {
    ...line,
    date: calendarDate(line.date),
    amount: number(line.amount),
    accountSuggestion: suggestion.accountSuggestion,
    confidence: suggestion.confidence,
    suggestionSource: suggestion.suggestionSource,
    supportingPatternCount: suggestion.supportingPatternCount,
    functionalAmount: line.functionalAmount == null ? null : number(line.functionalAmount),
    exchangeRate: line.exchangeRate == null ? null : number(line.exchangeRate),
    exchangeRateEffectiveDate: calendarDate(line.exchangeRateEffectiveDate),
  };
}

async function ensureSuggestedAccounts() {
  const lines = await db.select().from(statementLinesTable);
  for (const line of lines.filter((item) => !item.accountSuggestion)) {
    const accountSuggestion = suggestAccount(line.description, line.direction);
    const confidence = "0.75";
    await db.update(statementLinesTable)
      .set({ accountSuggestion, confidence })
      .where(eq(statementLinesTable.id, line.id));

    await db.update(journalEntriesTable)
      .set({
        confidence,
        debitAccount: line.direction === "inflow" ? "Bank / cash" : accountSuggestion,
        creditAccount: line.direction === "inflow" ? accountSuggestion : "Bank / cash",
      })
      .where(eq(journalEntriesTable.statementLineId, line.id));
  }
}

async function createSuggestedEntry(tx: LedgerflowTransaction, line: {
  id: number;
  clientId: number;
  date: string;
  description: string;
  currency: string;
  amount: string;
  direction: string;
  accountSuggestion?: string | null;
  confidence?: string | null;
  functionalCurrency?: string | null;
  functionalAmount?: string | null;
  exchangeRate?: string | null;
  exchangeRateEffectiveDate?: string | null;
  exchangeRateStatus?: string | null;
}) {
  const account = line.accountSuggestion || suggestAccount(line.description, line.direction);
  await tx.insert(journalEntriesTable).values({
    statementLineId: line.id,
    clientId: line.clientId,
    date: line.date,
    memo: line.description,
    currency: line.currency,
    status: "suggested",
    confidence: line.confidence ?? "0.80",
    debitAccount: line.direction === "inflow" ? "Bank / cash" : account,
    creditAccount: line.direction === "inflow" ? account : "Bank / cash",
    amount: line.amount,
    functionalCurrency: line.functionalCurrency,
    functionalAmount: line.functionalAmount,
    exchangeRate: line.exchangeRate,
    exchangeRateEffectiveDate: line.exchangeRateEffectiveDate,
    exchangeRateStatus: line.exchangeRateStatus ?? "not_required",
  });
}

async function createStatementLineAndJournal(
  tx: LedgerflowTransaction,
  draft: typeof statementLinesTable.$inferInsert,
  options?: { ignoreExistingImportDedupeKey?: boolean },
) {
  const insert = tx.insert(statementLinesTable).values(draft);
  const [line] = options?.ignoreExistingImportDedupeKey
    ? await insert.onConflictDoNothing({ target: statementLinesTable.importDedupeKey }).returning()
    : await insert.returning();
  if (!line) return null;
  await createSuggestedEntry(tx, line);
  return line;
}

async function recordFailedStatementImport(details: {
  clientId: number;
  bankAccountId?: number | null;
  fileName: string;
  mimeType: string;
  fileHash: string;
  errorMessage: string;
}) {
  try {
    await db.insert(statementImportsTable).values({
      clientId: details.clientId,
      bankAccountId: details.bankAccountId ?? null,
      fileName: details.fileName,
      mimeType: details.mimeType,
      fileHash: details.fileHash,
      outcome: "failed",
      errorMessage: details.errorMessage.slice(0, 500),
      importedLineCount: 0,
    });
  } catch (recordError) {
    // Preserve the original import failure if the audit record cannot be written.
    console.error("Failed to record statement import failure", recordError);
  }
}

type ParsedBankLine = {
  date: string;
  description: string;
  amount: number;
  direction: "inflow" | "outflow";
  currency: string;
  accountSuggestion?: string;
  confidence?: number | string;
};

type BankAccountDraft = {
  name?: string | null;
  bankName?: string | null;
  accountNumberLast4?: string | null;
  currency?: string | null;
};

type AICopilotRecommendation = {
  id: string;
  clientId: number;
  type: "next_step" | "review_group" | "recode_lines" | "create_bank_account" | "bulk_approve_entries" | "bulk_post_entries";
  title: string;
  summary: string;
  lineIds?: number[];
  entryIds?: number[];
  statementLineIds?: number[];
  entryCount?: number;
  lineCount?: number;
  fromStatus?: string;
  toStatus?: string;
  statusTransition?: { from: string; to: string };
  accountSuggestion?: string | null;
  confidence?: number | null;
  suggestionSource?: SuggestionSource;
  supportingPatternCount?: number;
  bankAccount?: { name: string; bankName: string | null; accountNumberLast4: string | null; currency: string } | null;
  requiresConfirmation: boolean;
};

const suggestedAccounts = [
  "Revenue",
  "Other income",
  "Travel & entertainment",
  "Software & subscriptions",
  "Office expenses",
  "Communication expenses",
  "Rent expense",
  "Payroll",
  "Bank charges",
  "General expenses",
];

function cleanBankAccountDraft(draft: BankAccountDraft | undefined | null, fallbackCurrency: string) {
  const name = draft?.name?.trim();
  if (!name) return null;
  const digits = (draft?.accountNumberLast4 ?? "").replace(/\D/g, "");
  return {
    name: name.slice(0, 120),
    bankName: draft?.bankName?.trim().slice(0, 120) || null,
    accountNumberLast4: digits.length >= 4 ? digits.slice(-4) : null,
    currency: (draft?.currency?.trim() || fallbackCurrency).toUpperCase().slice(0, 3),
  };
}

function bankAccountIdentityKey(clientId: number, account: NonNullable<ReturnType<typeof cleanBankAccountDraft>>) {
  return [
    clientId,
    `bank:${normalizeDescription(account.bankName ?? "")}`,
    `name:${normalizeDescription(account.name)}`,
    `currency:${account.currency}`,
    `last4:${account.accountNumberLast4 ?? ""}`,
  ].join("|");
}

function matchesBankAccountDraft(
  account: typeof bankAccountsTable.$inferSelect,
  draft: NonNullable<ReturnType<typeof cleanBankAccountDraft>>,
  identityKey: string,
) {
  return account.identityKey === identityKey
    || (
      normalizeDescription(account.name) === normalizeDescription(draft.name)
      && normalizeDescription(account.bankName ?? "") === normalizeDescription(draft.bankName ?? "")
      && account.currency === draft.currency
      && account.accountNumberLast4 === draft.accountNumberLast4
    );
}

function bankAccountResponse(account: typeof bankAccountsTable.$inferSelect) {
  return {
    id: account.id,
    clientId: account.clientId,
    name: account.name,
    bankName: account.bankName,
    accountNumberLast4: account.accountNumberLast4,
    currency: account.currency,
  };
}

async function findOrCreateBankAccount(clientId: number, draft: BankAccountDraft | undefined | null, fallbackCurrency: string) {
  const clean = cleanBankAccountDraft(draft, fallbackCurrency);
  if (!clean) return null;
  const identityKey = bankAccountIdentityKey(clientId, clean);
  const existingAccounts = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.clientId, clientId));
  const existing = existingAccounts.find((account) => matchesBankAccountDraft(account, clean, identityKey));
  if (existing) return existing;
  const [created] = await db.insert(bankAccountsTable).values({ clientId, ...clean, identityKey }).onConflictDoNothing({
    target: bankAccountsTable.identityKey,
  }).returning();
  if (created) return created;
  return (await db.select().from(bankAccountsTable).where(and(
    eq(bankAccountsTable.clientId, clientId),
    eq(bankAccountsTable.identityKey, identityKey),
  )))[0] ?? null;
}

function safeText(value: unknown, fallback: string, maxLength = 160) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}

function collectAICopilotRecommendations(
  rawRecommendations: unknown,
  pendingLines: Array<typeof statementLinesTable.$inferSelect>,
  clientId: number,
): AICopilotRecommendation[] {
  const validLineIds = new Set(pendingLines.map((line) => line.id));
  if (!Array.isArray(rawRecommendations)) return [];
  const recommendations: AICopilotRecommendation[] = [];

  for (const raw of rawRecommendations.slice(0, 3)) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Record<string, unknown>;
    const type = candidate.type;
    const lineIds = Array.isArray(candidate.lineIds)
      ? [...new Set(candidate.lineIds.filter((id): id is number => typeof id === "number" && validLineIds.has(id)))].slice(0, 100)
      : [];

    if (type === "recode_lines") {
      const accountSuggestion = safeText(candidate.accountSuggestion, "");
      if (!accountSuggestion || lineIds.length === 0) continue;
      const confidence = Number(candidate.confidence);
      recommendations.push({
        id: `recode-${lineIds.join("-")}-${accountSuggestion.toLowerCase().replace(/\W+/g, "-")}`,
        clientId,
        type,
        title: safeText(candidate.title, `Recode ${lineIds.length} transactions`),
        summary: safeText(candidate.summary, `Apply ${accountSuggestion} to the selected review lines.`),
        lineIds,
        accountSuggestion,
        confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0.75,
        requiresConfirmation: true,
      });
    }

    if (type === "review_group" && lineIds.length > 1) {
      recommendations.push({
        id: `group-${lineIds.join("-")}`,
        clientId,
        type,
        title: safeText(candidate.title, `Review ${lineIds.length} similar transactions together`),
        summary: safeText(candidate.summary, "These transactions share a recurring pattern and can be checked as a group."),
        lineIds,
        accountSuggestion: typeof candidate.accountSuggestion === "string" ? candidate.accountSuggestion : null,
        requiresConfirmation: false,
      });
    }

    if (type === "create_bank_account") {
      const bankAccount = cleanBankAccountDraft(candidate.bankAccount as BankAccountDraft | undefined, "AED");
      if (!bankAccount) continue;
      recommendations.push({
        id: `bank-${bankAccount.name.toLowerCase().replace(/\W+/g, "-")}-${bankAccount.accountNumberLast4 ?? "new"}`,
        clientId,
        type,
        title: safeText(candidate.title, `Create bank account: ${bankAccount.name}`),
        summary: safeText(candidate.summary, "Keep this statement stream separate from the client’s other bank activity."),
        bankAccount,
        requiresConfirmation: true,
      });
    }
  }
  return recommendations;
}

function defaultAICopilotRecommendations(
  pendingLines: Array<typeof statementLinesTable.$inferSelect>,
  bankAccounts: Array<typeof bankAccountsTable.$inferSelect>,
  clientId: number,
  lineSuggestions: Map<number, ClassificationSuggestion>,
): AICopilotRecommendation[] {
  const recommendations: AICopilotRecommendation[] = [];
  const learnedLines = pendingLines.filter((line) =>
    lineSuggestions.get(line.id)?.suggestionSource === "workspace_learning",
  );
  if (learnedLines.length) {
    const firstSuggestion = lineSuggestions.get(learnedLines[0].id)!;
    const matchingAccountLines = learnedLines.filter((line) =>
      lineSuggestions.get(line.id)?.accountSuggestion === firstSuggestion.accountSuggestion,
    ).slice(0, 20);
    recommendations.push({
      id: `workspace-learning-${matchingAccountLines.map((line) => line.id).join("-")}`,
      clientId,
      type: "recode_lines",
      title: `Confirm ${firstSuggestion.accountSuggestion} learned from this workspace`,
      summary: `${matchingAccountLines.length} pending transaction${matchingAccountLines.length === 1 ? "" : "s"} match a confirmed workspace pattern. Confirm or override the suggested account before approval. Supporting confirmations: ${firstSuggestion.supportingPatternCount}.`,
      lineIds: matchingAccountLines.map((line) => line.id),
      accountSuggestion: firstSuggestion.accountSuggestion,
      confidence: firstSuggestion.confidence,
      suggestionSource: "workspace_learning",
      supportingPatternCount: firstSuggestion.supportingPatternCount,
      requiresConfirmation: true,
    });
  }
  const groups = new Map<string, Array<typeof statementLinesTable.$inferSelect>>();
  for (const line of pendingLines) {
    const account = line.accountSuggestion || suggestAccount(line.description, line.direction);
    const members = groups.get(account) ?? [];
    members.push(line);
    groups.set(account, members);
  }
  const recurringGroup = [...groups.entries()].find(([, members]) => members.length >= 2);
  if (recurringGroup) {
    const [accountSuggestion, members] = recurringGroup;
    recommendations.push({
      id: `group-${members.slice(0, 20).map((line) => line.id).join("-")}`,
      clientId,
      type: "review_group",
      title: `Review ${members.length} ${accountSuggestion} suggestions together`,
      summary: "These transactions already share the same proposed counter-account. Inspect one pattern before approving any of them.",
      lineIds: members.slice(0, 20).map((line) => line.id),
      accountSuggestion,
      requiresConfirmation: false,
    });
  }
  if (pendingLines.length) {
    recommendations.push({
      id: "next-review-step",
      clientId,
      type: "next_step",
      title: `${pendingLines.length} lines are waiting for review`,
      summary: "Confirm the suggested accounts, then approve the journal entries you stand behind. AI will never post them for you.",
      requiresConfirmation: false,
    });
  }
  if (bankAccounts.length === 0) {
    recommendations.push({
      id: "next-bank-account-step",
      clientId,
      type: "next_step",
      title: "Set up the first bank account",
      summary: "Upload a statement with a visible account header or ask me to prepare a bank-account setup card.",
      requiresConfirmation: false,
    });
  }
  return recommendations.slice(0, 3);
}

type BulkActionType = "bulk_approve_entries" | "bulk_post_entries";

class BulkActionValidationError extends Error {
  constructor(readonly kind: "not_found" | "invalid_scope" | "invalid_status") {
    super(kind);
  }
}

function prepareBulkActionRecommendation(
  message: string,
  clientId: number,
  entries: Array<typeof journalEntriesTable.$inferSelect>,
  lines: Array<typeof statementLinesTable.$inferSelect>,
): { recommendation?: AICopilotRecommendation; error?: string } | null {
  const normalized = message.toLowerCase();
  const asksToApprove = /\b(?:approve|approval|approving)\b/.test(normalized);
  const asksToPost = /\b(?:post|posting)\b/.test(normalized);
  if (!asksToApprove && !asksToPost) return null;
  if (asksToApprove && asksToPost) {
    return { error: "Please choose one transition at a time: approve the entries first, or post entries that are already approved." };
  }

  const type: BulkActionType = asksToApprove ? "bulk_approve_entries" : "bulk_post_entries";
  const expectedStatus = asksToApprove ? "suggested" : "approved";
  const targetStatus = asksToApprove ? "approved" : "posted";
  const allRequested = /\b(?:all|every|each)\b/.test(normalized);
  const pendingRequested = /\b(?:pending|review|reviewing|suggested|eligible)\b/.test(normalized);
  const approvedRequested = /\bapproved\b/.test(normalized);
  const idMatches = normalized.match(/(?:\bje\b|\bjournal entries?\b|\bentries?\b)\s*(?:ids?\s*)?#?\s*\d+(?:\s*(?:,|and)\s*#?\s*\d+)*/g) ?? [];
  const requestedIds = [...new Set(idMatches.flatMap((match) => {
    const numbers = match.match(/\d+/g) ?? [];
    return numbers.map(Number);
  }))];

  let selectedEntries: Array<typeof journalEntriesTable.$inferSelect>;
  let scopeDescription: string;
  if (allRequested) {
    const tokens = normalized.match(/[a-z]+/g) ?? [];
    const supportedScopeWords = new Set([
      "please", "can", "could", "would", "you", "approve", "approval", "approving", "post", "posting",
      "all", "every", "each", "pending", "review", "reviewing", "suggested", "eligible", "approved",
      "journal", "entry", "entries", "the", "these", "those", "to", "now", "currently", "available",
      "in", "this", "workspace", "for", "me",
    ]);
    if (requestedIds.length || /\ball\s+clients?\b|\bother\s+client\b/.test(normalized) || tokens.some((token) => !supportedScopeWords.has(token))) {
      return { error: "I cannot safely infer a qualified bulk scope. Use “approve all pending entries”, “post all approved entries”, or list specific journal entry IDs." };
    }
    if (type === "bulk_approve_entries") {
      if (!pendingRequested || approvedRequested) {
        return { error: "For bulk approval, specify all pending or suggested entries. Entries that are already approved or posted need a separate scope." };
      }
      selectedEntries = entries.filter((entry) => entry.status === "suggested");
      scopeDescription = "all suggested entries";
    } else {
      if (!approvedRequested || pendingRequested) {
        return { error: "For bulk posting, specify all approved entries. Suggested entries must be approved first." };
      }
      selectedEntries = entries.filter((entry) => entry.status === "approved");
      scopeDescription = "all approved entries";
    }
  } else if (requestedIds.length) {
    selectedEntries = entries.filter((entry) => requestedIds.includes(entry.id));
    if (selectedEntries.length !== requestedIds.length) {
      return { error: "One or more requested journal entries are not available in this client workspace." };
    }
    scopeDescription = `the ${requestedIds.length} requested journal ${requestedIds.length === 1 ? "entry" : "entries"}`;
  } else {
    const matchingEntries = entries.filter((entry) => {
      const entryMemo = entry.memo.toLowerCase();
      const line = lines.find((candidate) => candidate.id === entry.statementLineId);
      return normalized.includes(entryMemo) || Boolean(line && normalized.includes(line.description.toLowerCase()));
    });
    if (matchingEntries.length !== 1) {
      return { error: "I need a clear scope. Say “approve all pending entries”, “post all approved entries”, or name specific journal entry IDs." };
    }
    selectedEntries = matchingEntries;
    scopeDescription = "the requested journal entry";
  }

  if (!selectedEntries.length) {
    return { error: `There are no eligible entries to ${asksToApprove ? "approve" : "post"} in that scope.` };
  }
  if (selectedEntries.some((entry) => entry.status !== expectedStatus)) {
    const invalidLabel = asksToApprove ? "already approved or posted" : "not already approved";
    return { error: `That scope includes entries that are ${invalidLabel}. Narrow the request to one eligible status before confirming.` };
  }

  const selectedLineIds = [...new Set(selectedEntries.map((entry) => entry.statementLineId))];
  const selectedLines = lines.filter((line) => selectedLineIds.includes(line.id));
  if (selectedLines.length !== selectedLineIds.length || selectedLines.some((line) => line.clientId !== clientId)) {
    return { error: "The requested entries do not have a complete statement-line scope in this client workspace." };
  }
  const entryIds = selectedEntries.map((entry) => entry.id);
  const titleVerb = asksToApprove ? "Approve" : "Post";
  return {
    recommendation: {
      id: `${type}-${entryIds.join("-")}`,
      clientId,
      type,
      title: `${titleVerb} ${selectedEntries.length} journal ${selectedEntries.length === 1 ? "entry" : "entries"}`,
      summary: `${titleVerb} ${scopeDescription}: ${selectedEntries.map((entry) => `JE-${String(entry.id).padStart(4, "0")} · ${entry.memo}`).join("; ")}. This moves ${selectedLines.length} statement ${selectedLines.length === 1 ? "line" : "lines"} from ${expectedStatus} to ${targetStatus}.`,
      entryIds,
      statementLineIds: selectedLineIds,
      entryCount: selectedEntries.length,
      lineCount: selectedLines.length,
      fromStatus: expectedStatus,
      toStatus: targetStatus,
      statusTransition: { from: expectedStatus, to: targetStatus },
      requiresConfirmation: true,
    },
  };
}

function normalizeRows(text: string, currency: string): ParsedBankLine[] {
  return text.split(/\r?\n/).slice(1).map((row) => {
    const cells = row.split(/,|\t|;/).map((cell) => cell.trim().replace(/^"|"$/g, ""));
    const amountCell = cells.find((cell) => /-?\d[\d,]*(\.\d+)?/.test(cell)) ?? "0";
    const amount = Number(amountCell.replace(/[^0-9.-]/g, ""));
    const description = cells.slice(1, Math.max(2, cells.length - 1)).join(" ") || "Imported bank activity";
    return {
      date: cells[0] ?? "",
      description,
      amount: Math.abs(amount),
      direction: (amount < 0 ? "outflow" : "inflow") as "outflow" | "inflow",
      currency,
      accountSuggestion: suggestAccount(description, amount < 0 ? "outflow" : "inflow"),
      confidence: 0.75,
    };
  }).filter((line) => line.date && line.amount > 0);
}

router.post("/ledgerflow/import-statement", async (req, res) => {
  const { clientId, bankAccountId, fileName, mimeType, contentBase64, currency = "AED" } = req.body as {
    clientId?: number; bankAccountId?: number | null; fileName?: string; mimeType?: string; contentBase64?: string; currency?: string;
  };
  if (!fileName || !mimeType || !contentBase64) return res.status(400).json({ error: "A statement file is required" });
  let activeClientId: number | undefined;
  let failedBankAccountId: number | null = null;
  let fileHash: string | undefined;
  try {
    const buffer = Buffer.from(contentBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
    const client = await requireOwnedClient(req, res, typeof clientId === "number" ? clientId : undefined);
    if (!client) return;
    const scopedClientId = client.id;
    const scopedFileHash = createHash("sha256").update(buffer).digest("hex");
    activeClientId = scopedClientId;
    fileHash = scopedFileHash;
    const previousImport = (await db.select().from(statementImportsTable).where(and(
      eq(statementImportsTable.clientId, scopedClientId),
      eq(statementImportsTable.fileHash, scopedFileHash),
      eq(statementImportsTable.outcome, "completed"),
    )))[0];
    if (previousImport) {
      const previousBankAccount = previousImport.bankAccountId == null
        ? null
        : (await db.select().from(bankAccountsTable).where(and(
          eq(bankAccountsTable.id, previousImport.bankAccountId),
          eq(bankAccountsTable.clientId, scopedClientId),
        )))[0] ?? null;
      await db.insert(statementImportsTable).values({
        clientId: scopedClientId,
        bankAccountId: previousImport.bankAccountId,
        fileName,
        mimeType,
        fileHash: scopedFileHash,
        outcome: "duplicate",
        importedLineCount: previousImport.importedLineCount,
      });
      return res.status(200).json(ImportStatementResponse.parse({
        fileName,
        importStatus: "duplicate_file",
        message: `This statement was already imported for this client. No new lines were added.`,
        importedCount: 0,
        duplicateCount: previousImport.importedLineCount,
        duplicateLines: [],
        lines: [],
        bankAccount: previousBankAccount ? bankAccountResponse(previousBankAccount) : null,
      }));
    }
    let extractedText = "";

    if (mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      extractedText = (await parser.getText()).text;
      await parser.destroy();
    } else if (fileName.toLowerCase().endsWith(".xls") || fileName.toLowerCase().endsWith(".xlsx")) {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      extractedText = workbook.SheetNames.map((name) => XLSX.utils.sheet_to_csv(workbook.Sheets[name])).join("\n");
    } else {
      extractedText = buffer.toString("utf8");
    }
    const fallback = normalizeRows(extractedText, currency);
    const response = await openai.chat.completions.create({
      model: "gpt-5.6-luna",
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Extract bank statement transactions, identify the statement's bank account when the document header supports it, and suggest the most likely counterpart account for each line. Return JSON only: {\"bankAccount\":{\"name\":\"string\",\"bankName\":\"string|null\",\"accountNumberLast4\":\"1234|null\",\"currency\":\"AED\"}|null,\"lines\":[{\"date\":\"YYYY-MM-DD\",\"description\":\"string\",\"amount\":123.45,\"direction\":\"inflow|outflow\",\"currency\":\"AED\",\"accountSuggestion\":\"Revenue|Other income|Travel & entertainment|Software & subscriptions|Office expenses|Communication expenses|Rent expense|Payroll|Bank charges|General expenses\",\"confidence\":0.0}]}. Never invent transactions or bank account numbers. Only return bankAccount when a name or bank header is visible; if an account number is visible, return only its last four digits. Use the statement's stated currency when available. For accountSuggestion, choose the closest account from the list and use General expenses or Other income when uncertain. Set confidence between 0 and 1." },
        { role: "user", content: `File: ${fileName}\nDefault currency: ${currency}\n\nStatement text:\n${extractedText.slice(0, 55000)}` },
      ],
    });
    const candidate = JSON.parse(response.choices[0]?.message?.content ?? "{\"lines\":[]}") as { lines?: ParsedBankLine[]; bankAccount?: BankAccountDraft | null };
    const lines = (candidate.lines?.length ? candidate.lines : fallback).filter((line) => line.date && line.description && Number.isFinite(Number(line.amount)) && Number(line.amount) > 0);
    const workspacePatterns = await getWorkspacePatterns(currentUserId(req));
    const selectedBankAccount = bankAccountId == null ? null : (await db.select().from(bankAccountsTable).where(and(
      eq(bankAccountsTable.id, Number(bankAccountId)),
      eq(bankAccountsTable.clientId, scopedClientId),
    )))[0];
    if (bankAccountId != null && !selectedBankAccount) {
      return res.status(400).json({ error: "Selected bank account was not found for this client." });
    }
    failedBankAccountId = selectedBankAccount?.id ?? null;
    const resolvedLines = await Promise.all(lines.map(async (line) => {
      const currencyValue = normalizeCurrency(line.currency || currency);
      return {
        line,
        currencyValue,
        conversion: await resolveExchangeRate(
          currentUserId(req),
          currencyValue,
          normalizeCurrency(client.functionalCurrency),
          line.date,
          Math.abs(line.amount),
        ),
      };
    }));
    const importResult = await db.transaction(async (tx) => {
      const [createdImport] = await tx.insert(statementImportsTable).values({
        clientId: scopedClientId,
        bankAccountId: null,
        fileName,
        mimeType,
        fileHash: scopedFileHash,
        outcome: "completed",
        importedLineCount: 0,
      }).onConflictDoNothing({
        target: [statementImportsTable.clientId, statementImportsTable.fileHash],
        where: eq(statementImportsTable.outcome, "completed"),
      }).returning();
      if (!createdImport) {
        const [completedImport] = await tx.select().from(statementImportsTable).where(and(
          eq(statementImportsTable.clientId, scopedClientId),
          eq(statementImportsTable.fileHash, scopedFileHash),
          eq(statementImportsTable.outcome, "completed"),
        )).limit(1);
        await tx.insert(statementImportsTable).values({
          clientId: scopedClientId,
          bankAccountId: completedImport?.bankAccountId ?? selectedBankAccount?.id ?? null,
          fileName,
          mimeType,
          fileHash: scopedFileHash,
          outcome: "duplicate",
          importedLineCount: completedImport?.importedLineCount ?? 0,
        });
        return { kind: "duplicate_file" as const, completedImport };
      }

      let detectedBankAccount = selectedBankAccount;
      const cleanBankAccount = cleanBankAccountDraft(candidate.bankAccount, currency);
      if (!detectedBankAccount && cleanBankAccount) {
        const identityKey = bankAccountIdentityKey(scopedClientId, cleanBankAccount);
        const accounts = await tx.select().from(bankAccountsTable).where(eq(bankAccountsTable.clientId, scopedClientId));
        detectedBankAccount = accounts.find((account) => matchesBankAccountDraft(account, cleanBankAccount, identityKey)) ?? null;
        if (!detectedBankAccount) {
          const [createdBankAccount] = await tx.insert(bankAccountsTable).values({
            clientId: scopedClientId,
            ...cleanBankAccount,
            identityKey,
          }).onConflictDoNothing({
            target: bankAccountsTable.identityKey,
          }).returning();
          detectedBankAccount = createdBankAccount ?? (await tx.select().from(bankAccountsTable).where(and(
            eq(bankAccountsTable.clientId, scopedClientId),
            eq(bankAccountsTable.identityKey, identityKey),
          )))[0] ?? null;
        }
      }
      await tx.update(statementImportsTable).set({
        bankAccountId: detectedBankAccount?.id ?? null,
      }).where(eq(statementImportsTable.id, createdImport.id));
      const preparedLines = resolvedLines.map(({ line, currencyValue, conversion }) => {
        const workspaceSuggestion = findWorkspaceSuggestion(workspacePatterns, line.description);
        const accountSuggestion = workspaceSuggestion?.accountSuggestion
          || line.accountSuggestion?.trim()
          || suggestAccount(line.description, line.direction);
        const parsedConfidence = workspaceSuggestion?.confidence ?? Number(line.confidence);
        const confidence = Number.isFinite(parsedConfidence) && parsedConfidence >= 0 && parsedConfidence <= 1
          ? parsedConfidence.toFixed(2)
          : "0.75";
        const amount = String(Math.abs(line.amount));
        return {
          clientId: scopedClientId,
          bankAccountId: detectedBankAccount?.id ?? null,
          date: line.date,
          description: line.description.trim(),
          currency: currencyValue,
          amount,
          direction: line.direction,
          status: "needs_review" as const,
          source: `Imported: ${fileName}`,
          accountSuggestion,
          confidence,
          functionalCurrency: conversion.functionalCurrency,
          functionalAmount: conversion.functionalAmount,
          exchangeRate: conversion.exchangeRate,
          exchangeRateEffectiveDate: conversion.exchangeRateEffectiveDate,
          exchangeRateStatus: conversion.exchangeRateStatus,
          importDedupeKey: importDedupeKey({
            clientId: scopedClientId,
            bankAccountId: detectedBankAccount?.id ?? null,
            date: line.date,
            description: line.description,
            amount,
            direction: line.direction,
            currency: currencyValue,
          }),
        };
      });
      const existingLines = await tx.select().from(statementLinesTable).where(eq(statementLinesTable.clientId, scopedClientId));
      const seenKeys = new Set<string>();
      const duplicateLines: Array<{
        date: string;
        description: string;
        currency: string;
        amount: number;
        direction: string;
        existingLineId: number | null;
        reason: "already_imported" | "duplicate_in_file";
      }> = [];
      const inserted: Array<typeof statementLinesTable.$inferSelect> = [];
      for (const line of preparedLines) {
        const existingLine = existingLines.find((item) =>
          item.importDedupeKey === line.importDedupeKey
          || (!item.importDedupeKey
            && importDedupeKey({
              clientId: item.clientId,
              bankAccountId: item.bankAccountId,
              date: item.date,
              description: item.description,
              amount: item.amount,
              direction: item.direction,
              currency: item.currency,
            }) === line.importDedupeKey),
        );
        if (existingLine || seenKeys.has(line.importDedupeKey)) {
          duplicateLines.push({
            date: line.date,
            description: line.description,
            currency: line.currency,
            amount: Number(line.amount),
            direction: line.direction,
            existingLineId: existingLine?.id ?? null,
            reason: existingLine ? "already_imported" : "duplicate_in_file",
          });
          continue;
        }
        seenKeys.add(line.importDedupeKey);
        const insertedLine = await createStatementLineAndJournal(tx, line, {
          ignoreExistingImportDedupeKey: true,
        });
        if (!insertedLine) {
          const racedLine = (await tx.select().from(statementLinesTable).where(and(
            eq(statementLinesTable.clientId, scopedClientId),
            eq(statementLinesTable.importDedupeKey, line.importDedupeKey),
          )))[0];
          duplicateLines.push({
            date: line.date,
            description: line.description,
            currency: line.currency,
            amount: Number(line.amount),
            direction: line.direction,
            existingLineId: racedLine?.id ?? null,
            reason: "already_imported",
          });
          continue;
        }
        inserted.push(insertedLine);
      }
      await tx.update(statementImportsTable).set({ importedLineCount: inserted.length }).where(eq(statementImportsTable.id, createdImport.id));
      return { kind: "imported" as const, inserted, duplicateLines, detectedBankAccount };
    });
    if (importResult.kind === "duplicate_file") {
      return res.status(200).json(ImportStatementResponse.parse({
        fileName,
        importStatus: "duplicate_file",
        message: "This statement was already imported for this client. No new lines were added.",
        importedCount: 0,
        duplicateCount: lines.length,
        duplicateLines: [],
        lines: [],
        bankAccount: selectedBankAccount ? bankAccountResponse(selectedBankAccount) : null,
      }));
    }
    const { inserted, duplicateLines, detectedBankAccount } = importResult;
    const importStatus = inserted.length === 0 ? "duplicates_found" : duplicateLines.length ? "imported_with_duplicates" : "imported";
    const message = duplicateLines.length
      ? `${inserted.length} new line${inserted.length === 1 ? "" : "s"} imported. ${duplicateLines.length} duplicate line${duplicateLines.length === 1 ? "" : "s"} skipped.`
      : `${inserted.length} statement line${inserted.length === 1 ? "" : "s"} imported and ready for review.`;
    return res.status(201).json(ImportStatementResponse.parse({
      fileName,
      importStatus,
      message,
      importedCount: inserted.length,
      duplicateCount: duplicateLines.length,
      duplicateLines,
      lines: inserted.map((line) => statementLineResponse(line, workspacePatterns)),
      bankAccount: detectedBankAccount ? bankAccountResponse(detectedBankAccount) : null,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Statement import failed");
    if (activeClientId !== undefined && fileHash) {
      await recordFailedStatementImport({
        clientId: activeClientId,
        bankAccountId: failedBankAccountId,
        fileName,
        mimeType,
        fileHash,
        errorMessage: error instanceof Error ? error.message : "Unknown statement import error",
      });
    }
    return res.status(422).json({ error: "We could not read this statement. Try a clearer PDF, CSV, or Excel file." });
  }
});

router.post("/ledgerflow/ai-chat", async (req, res) => {
  const { clientId, message } = AskLedgerflowAIBody.parse(req.body);
  const client = await requireOwnedClient(req, res, clientId);
  if (!client) return;
  const lines = await db.select().from(statementLinesTable).where(eq(statementLinesTable.clientId, client.id));
  const entries = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.clientId, client.id));
  const bankAccounts = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.clientId, client.id));
  const workspacePatterns = await getWorkspacePatterns(currentUserId(req));
  const lineSuggestions = new Map(lines.map((line) => [line.id, lineSuggestion(line, workspacePatterns)]));
  const pendingLines = lines.filter((line) => line.status !== "posted");
  const postedLines = lines.filter((line) => line.status === "posted");
  const context = { clientName: client.name, pendingLines: pendingLines.length, postedLines: postedLines.length };
  const bulkAction = prepareBulkActionRecommendation(message, clientId, entries, lines);
  if (bulkAction?.error) {
    res.json(AskLedgerflowAIResponse.parse({
      answer: bulkAction.error,
      context,
      recommendations: [],
    }));
    return;
  }
  if (bulkAction?.recommendation) {
    res.json(AskLedgerflowAIResponse.parse({
      answer: "I prepared this client-scoped ledger transition for your review. Nothing has changed yet.",
      context,
      recommendations: [bulkAction.recommendation],
    }));
    return;
  }
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.6-luna",
      max_completion_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are LedgerFlow's bookkeeping copilot. Return JSON only: {\"answer\":\"string\",\"recommendations\":[{\"type\":\"next_step|review_group|recode_lines|create_bank_account|bulk_approve_entries|bulk_post_entries\",\"title\":\"string\",\"summary\":\"string\",\"lineIds\":[1],\"entryIds\":[1],\"statementLineIds\":[1],\"entryCount\":1,\"lineCount\":1,\"fromStatus\":\"suggested|approved\",\"toStatus\":\"approved|posted\",\"statusTransition\":{\"from\":\"suggested|approved\",\"to\":\"approved|posted\"},\"accountSuggestion\":\"string|null\",\"confidence\":0.0,\"bankAccount\":{\"name\":\"string\",\"bankName\":\"string|null\",\"accountNumberLast4\":\"1234|null\",\"currency\":\"AED\"}|null}]}. Be concise and use only supplied context. AI never approves or posts entries without a separate explicit confirmation. Only propose bulk_approve_entries or bulk_post_entries when the user explicitly requests that single transition and the scope is unambiguous. A bulk approval may include only suggested entries; bulk posting may include only approved entries. Use the supplied entry IDs and statement-line IDs exactly; never invent IDs. You may propose grouping similar pending transactions and recoding them to a counterpart account, but only when supplied line IDs support it. For a recode_lines proposal provide at least one valid line ID and an accountSuggestion. For create_bank_account, only propose a setup card when the user asks for it and the name is clear. Never invent account numbers; use only a supplied masked last four digits. Return at most 3 recommendations.",
        },
        {
          role: "user",
          content: JSON.stringify({
            client: { name: client.name, legalName: client.legalName, basis: client.basis, functionalCurrency: client.functionalCurrency, period: client.period },
            bankAccounts: bankAccounts.map(bankAccountResponse),
             reviewQueue: pendingLines.slice(0, 50).map((line) => {
               const suggestion = lineSuggestions.get(line.id);
               return { id: line.id, date: line.date, description: line.description, currency: line.currency, amount: line.amount, direction: line.direction, status: line.status, accountSuggestion: suggestion?.accountSuggestion, suggestionSource: suggestion?.suggestionSource, supportingPatternCount: suggestion?.supportingPatternCount };
             }),
             journalEntries: entries.filter((entry) => entry.status !== "posted").slice(0, 50).map((entry) => ({ id: entry.id, statementLineId: entry.statementLineId, date: entry.date, memo: entry.memo, currency: entry.currency, amount: entry.amount, status: entry.status, debit: entry.debitAccount, credit: entry.creditAccount })),
            question: message,
          }),
        },
      ],
    });
    const raw = JSON.parse(response.choices[0]?.message?.content ?? "{}") as { answer?: unknown; recommendations?: unknown };
      const recommendations = collectAICopilotRecommendations(raw.recommendations, pendingLines, clientId);
      const learnedRecommendation = defaultAICopilotRecommendations(pendingLines, [], clientId, lineSuggestions)
        .find((recommendation) => recommendation.suggestionSource === "workspace_learning");
      if (learnedRecommendation && !recommendations.some((recommendation) => recommendation.suggestionSource === "workspace_learning")) {
        recommendations.unshift(learnedRecommendation);
      }
      const fallbackRecommendations = defaultAICopilotRecommendations(pendingLines, bankAccounts, clientId, lineSuggestions);
    const answer = safeText(raw.answer, "I can help you review this queue, group recurring transactions, propose recodes, or prepare a bank account for your confirmation.", 1200);
    res.json(AskLedgerflowAIResponse.parse({ answer, context, recommendations: recommendations.length ? recommendations : fallbackRecommendations }));
  } catch (error) {
    req.log.error({ err: error }, "AI workspace chat failed");
    res.status(502).json({ error: "The AI assistant is temporarily unavailable." });
  }
});

router.get("/ledgerflow/bank-accounts", async (req, res) => {
  const { clientId } = GetBankAccountsQueryParams.parse(req.query);
  const client = await requireOwnedClient(req, res, clientId);
  if (!client) return;
  const accounts = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.clientId, client.id)).orderBy(asc(bankAccountsTable.name));
  res.json(GetBankAccountsResponse.parse(accounts.map(bankAccountResponse)));
});

router.post("/ledgerflow/bank-accounts", async (req, res) => {
  const body = CreateBankAccountBody.parse(req.body);
  const client = await requireOwnedClient(req, res, body.clientId);
  if (!client) return;
  const account = await findOrCreateBankAccount(client.id, body, body.currency);
  if (!account) return res.status(400).json({ error: "A bank account name is required." });
  return res.status(201).json(CreateBankAccountResponse.parse(bankAccountResponse(account)));
});

router.post("/ledgerflow/ai-actions/confirm", async (req, res) => {
  const body = ConfirmAICopilotActionBody.parse(req.body);
  const client = await requireOwnedClient(req, res, body.clientId);
  if (!client) return;

  if (body.type === "bulk_approve_entries" || body.type === "bulk_post_entries") {
    const entryIds = [...new Set(body.entryIds ?? [])];
    const statementLineIds = [...new Set(body.statementLineIds ?? [])];
    if (!entryIds.length || !statementLineIds.length || entryIds.length !== statementLineIds.length) {
      return res.status(400).json({ error: "A bulk action needs matching, non-empty journal-entry and statement-line selections." });
    }

    let result: { entries: Array<typeof journalEntriesTable.$inferSelect>; expectedStatus: string; resultingStatus: string };
    try {
      result = await db.transaction(async (tx) => {
        const entries = await tx.select().from(journalEntriesTable).where(and(
          eq(journalEntriesTable.clientId, body.clientId),
          inArray(journalEntriesTable.id, entryIds),
        ));
        if (entries.length !== entryIds.length) throw new BulkActionValidationError("not_found");

        const lines = await tx.select().from(statementLinesTable).where(and(
          eq(statementLinesTable.clientId, body.clientId),
          inArray(statementLinesTable.id, statementLineIds),
        ));
        if (lines.length !== statementLineIds.length) throw new BulkActionValidationError("not_found");

        const entryLineIds = entries.map((entry) => entry.statementLineId);
        if (new Set(entryLineIds).size !== entryLineIds.length
          || entryLineIds.some((lineId) => !statementLineIds.includes(lineId))
          || statementLineIds.some((lineId) => !entryLineIds.includes(lineId))) {
          throw new BulkActionValidationError("invalid_scope");
        }

        const expectedStatus = body.type === "bulk_approve_entries" ? "suggested" : "approved";
        const resultingStatus = body.type === "bulk_approve_entries" ? "approved" : "posted";
        if (entries.some((entry) => entry.status !== expectedStatus)
          || (body.type === "bulk_post_entries" && lines.some((line) => line.status === "posted"))) {
          throw new BulkActionValidationError("invalid_status");
        }

        const updatedEntries = await tx.update(journalEntriesTable)
          .set({ status: resultingStatus })
          .where(and(
            eq(journalEntriesTable.clientId, body.clientId),
            inArray(journalEntriesTable.id, entryIds),
            eq(journalEntriesTable.status, expectedStatus),
          ))
          .returning();
        if (updatedEntries.length !== entryIds.length) throw new BulkActionValidationError("invalid_status");

        if (body.type === "bulk_post_entries") {
          const updatedLines = await tx.update(statementLinesTable)
            .set({ status: "posted" })
            .where(and(
              eq(statementLinesTable.clientId, body.clientId),
              inArray(statementLinesTable.id, statementLineIds),
            ))
            .returning();
          if (updatedLines.length !== statementLineIds.length) throw new BulkActionValidationError("invalid_scope");
        }

        return { entries: updatedEntries, expectedStatus, resultingStatus };
      });
    } catch (error) {
      if (error instanceof BulkActionValidationError) {
        if (error.kind === "not_found") {
          return res.status(404).json({ error: "One or more selected journal entries or statement lines are not available in this client." });
        }
        if (error.kind === "invalid_scope") {
          return res.status(400).json({ error: "The selected journal entries and statement lines do not describe one matching client-scoped selection." });
        }
        const statusMessage = body.type === "bulk_approve_entries"
          ? "Only suggested entries can be bulk approved. Posted or already approved entries were rejected."
          : "Only approved entries can be bulk posted. Suggested or posted entries were rejected.";
        return res.status(409).json({ error: statusMessage });
      }
      throw error;
    }

    return res.json(ConfirmAICopilotActionResponse.parse({
      type: body.type,
      clientId: body.clientId,
      entryIds,
      statementLineIds,
      entryCount: result.entries.length,
      lineCount: statementLineIds.length,
      fromStatus: result.expectedStatus,
      toStatus: result.resultingStatus,
      entries: result.entries.map(journalEntryResponse),
      updatedLineCount: statementLineIds.length,
      bankAccount: null,
    }));
  }
  if (body.type === "create_bank_account") {
    const bankAccount = await findOrCreateBankAccount(client.id, body.bankAccount ?? undefined, body.bankAccount?.currency ?? "AED");
    if (!bankAccount) return res.status(400).json({ error: "The bank account proposal needs a name and currency." });
    return res.json(ConfirmAICopilotActionResponse.parse({
      type: body.type,
      updatedLineCount: 0,
      bankAccount: bankAccountResponse(bankAccount),
    }));
  }

  const lineIds = [...new Set(body.lineIds ?? [])];
  const accountSuggestion = body.accountSuggestion?.trim();
  if (!lineIds.length || !accountSuggestion) {
    return res.status(400).json({ error: "Select at least one line and a proposed account before confirming a recode." });
  }
  if (!classificationAccounts.has(accountSuggestion)) {
    return res.status(400).json({ error: "Choose one of LedgerFlow's supported accounts before confirming a classification." });
  }
  const confidence = Number.isFinite(Number(body.confidence)) && Number(body.confidence) >= 0 && Number(body.confidence) <= 1
    ? Number(body.confidence).toFixed(2)
    : "0.75";
  let selectedLines: Array<typeof statementLinesTable.$inferSelect>;
  try {
    selectedLines = await db.transaction(async (tx) => {
      const lockedLines = await tx.select().from(statementLinesTable).where(and(
        eq(statementLinesTable.clientId, client.id),
        inArray(statementLinesTable.id, lineIds),
      )).for("update");
      if (lockedLines.length !== lineIds.length) {
        throw new RecodeConflictError("One or more selected statement lines are not available in this client.");
      }
      if (lockedLines.some((line) => line.status === "posted")) {
        throw new RecodeConflictError("Posted statement lines cannot be recoded through the AI assistant.");
      }

      const lockedEntries = await tx.select().from(journalEntriesTable).where(and(
        eq(journalEntriesTable.clientId, client.id),
        inArray(journalEntriesTable.statementLineId, lineIds),
      )).for("update");
      const entryLineIds = new Set(lockedEntries.map((entry) => entry.statementLineId));
      if (
        lockedEntries.length !== lockedLines.length
        || entryLineIds.size !== lockedLines.length
        || lockedEntries.some((entry) => entry.status !== "suggested")
      ) {
        throw new RecodeConflictError("Only still-suggested journal entries can be recoded. Review approved entries individually.");
      }

      for (const line of lockedLines) {
        const [updatedEntry] = await tx.update(journalEntriesTable).set({
          confidence,
          debitAccount: line.direction === "inflow" ? "Bank / cash" : accountSuggestion,
          creditAccount: line.direction === "inflow" ? accountSuggestion : "Bank / cash",
        }).where(and(
          eq(journalEntriesTable.clientId, client.id),
          eq(journalEntriesTable.statementLineId, line.id),
          eq(journalEntriesTable.status, "suggested"),
        )).returning({ id: journalEntriesTable.id });
        if (!updatedEntry) throw new RecodeConflictError("A selected journal entry changed while its classification was being confirmed.");
      }

      const updatedLines = await tx.update(statementLinesTable).set({ accountSuggestion, confidence }).where(and(
        eq(statementLinesTable.clientId, client.id),
        inArray(statementLinesTable.id, lineIds),
        ne(statementLinesTable.status, "posted"),
      )).returning({ id: statementLinesTable.id });
      if (updatedLines.length !== lockedLines.length) {
        throw new RecodeConflictError("A selected statement line changed while its classification was being confirmed.");
      }

      for (const line of lockedLines) {
        await recordClassificationPattern(currentUserId(req), line.description, accountSuggestion, confidence, tx);
      }
      return lockedLines;
    }
    );
  } catch (error) {
    if (error instanceof RecodeConflictError) {
      return res.status(409).json({ error: error.message });
    }
    throw error;
  }
  return res.json(ConfirmAICopilotActionResponse.parse({
    type: body.type,
    updatedLineCount: selectedLines.length,
    bankAccount: null,
  }));
});

router.get("/clients", async (req, res) => {
  const memberships = await db.select({ clientId: clientWorkspacesTable.clientId })
    .from(clientWorkspacesTable)
    .where(eq(clientWorkspacesTable.userId, currentUserId(req)));
  const clientIds = memberships.map((membership) => membership.clientId);
  const clients = clientIds.length
    ? await db.select().from(clientsTable).where(inArray(clientsTable.id, clientIds)).orderBy(asc(clientsTable.name))
    : [];
  res.json(clients.map((client) => ({
    id: client.id,
    name: client.name,
    legalName: client.legalName,
    functionalCurrency: client.functionalCurrency,
    basis: client.basis,
    period: client.period,
  })));
});

router.post("/clients", async (req, res) => {
  const body = req.body as { name?: string; legalName?: string };
  if (!body.name || !body.legalName) return res.status(400).json({ error: "Client name and legal name are required" });
  const { name, legalName } = body;
  const client = await db.transaction(async (tx) => {
    const [created] = await tx.insert(clientsTable)
      .values({ name, legalName, functionalCurrency: "AED", basis: "IFRS", period: "August 2026" })
      .returning();
    await tx.insert(clientWorkspacesTable).values({ clientId: created.id, userId: currentUserId(req) });
    return created;
  });
  return res.status(201).json({
    id: client.id,
    name: client.name,
    legalName: client.legalName,
    functionalCurrency: client.functionalCurrency,
    basis: client.basis,
    period: client.period,
  });
});

router.patch("/clients/:id", async (req, res) => {
  const { id } = UpdateClientParams.parse(req.params);
  const body = UpdateClientBody.parse(req.body);
  const ownedClient = await requireOwnedClient(req, res, id);
  if (!ownedClient) return;
  const [client] = await db.update(clientsTable)
    .set(body)
    .where(eq(clientsTable.id, ownedClient.id))
    .returning();
  if (!client) {
    return res.status(404).json({ error: "Client workspace not found" });
  }
  return res.json(UpdateClientResponse.parse({
    id: client.id,
    name: client.name,
    legalName: client.legalName,
    functionalCurrency: client.functionalCurrency,
    basis: client.basis,
    period: client.period,
  }));
});

router.get("/ledgerflow/exchange-rates", async (req, res) => {
  const rates = await db.select().from(exchangeRatesTable).where(eq(
    exchangeRatesTable.userId,
    currentUserId(req),
  )).orderBy(desc(exchangeRatesTable.effectiveDate), asc(exchangeRatesTable.sourceCurrency), asc(exchangeRatesTable.functionalCurrency));
  res.json(GetExchangeRatesResponse.parse(rates.map(exchangeRateResponse)));
});

router.post("/ledgerflow/exchange-rates", async (req, res) => {
  const parsed = CreateExchangeRateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A valid dated exchange rate is required." });
  let body: ReturnType<typeof normalizeRateInput>;
  try {
    body = normalizeRateInput(parsed.data);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid exchange rate." });
  }
  try {
    const [rate] = await db.insert(exchangeRatesTable).values({ ...body, userId: currentUserId(req) }).returning();
    await refreshWorkspaceRateConversions(currentUserId(req));
    return res.status(201).json(CreateExchangeRateResponse.parse(exchangeRateResponse(rate)));
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return res.status(409).json({ error: "A rate already exists for this currency pair and effective date." });
    }
    throw error;
  }
});

router.patch("/ledgerflow/exchange-rates/:id", async (req, res) => {
  const params = UpdateExchangeRateParams.safeParse(req.params);
  const parsed = UpdateExchangeRateBody.safeParse(req.body);
  if (!params.success || !parsed.success) return res.status(400).json({ error: "A valid dated exchange rate is required." });
  let body: ReturnType<typeof normalizeRateInput>;
  try {
    body = normalizeRateInput(parsed.data);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid exchange rate." });
  }
  try {
    const [rate] = await db.update(exchangeRatesTable).set(body).where(and(
      eq(exchangeRatesTable.id, params.data.id),
      eq(exchangeRatesTable.userId, currentUserId(req)),
    )).returning();
    if (!rate) return res.status(404).json({ error: "Exchange rate not found in this workspace." });
    await refreshWorkspaceRateConversions(currentUserId(req));
    return res.json(UpdateExchangeRateResponse.parse(exchangeRateResponse(rate)));
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return res.status(409).json({ error: "A rate already exists for this currency pair and effective date." });
    }
    throw error;
  }
});

router.delete("/ledgerflow/exchange-rates/:id", async (req, res) => {
  const params = DeleteExchangeRateParams.safeParse(req.params);
  if (!params.success) return res.status(400).json({ error: "Invalid exchange rate." });
  const [deleted] = await db.delete(exchangeRatesTable).where(and(
    eq(exchangeRatesTable.id, params.data.id),
    eq(exchangeRatesTable.userId, currentUserId(req)),
  )).returning({ id: exchangeRatesTable.id });
  if (!deleted) return res.status(404).json({ error: "Exchange rate not found in this workspace." });
  await refreshWorkspaceRateConversions(currentUserId(req));
  return res.status(204).send();
});

router.post("/ledgerflow/exchange-rates/import", async (req, res) => {
  const parsed = ImportExchangeRatesBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "At least one valid exchange rate is required." });
  let rates: Array<ReturnType<typeof normalizeRateInput>>;
  try {
    rates = parsed.data.rates.map(normalizeRateInput);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid exchange rate." });
  }
  const uniqueKeys = new Set<string>();
  if (rates.some((rate) => {
    const key = `${rate.sourceCurrency}|${rate.functionalCurrency}|${rate.effectiveDate}`;
    if (uniqueKeys.has(key)) return true;
    uniqueKeys.add(key);
    return false;
  })) return res.status(400).json({ error: "Each imported currency pair and effective date must appear once." });

  const result = await db.transaction(async (tx) => {
    const returned: Array<typeof exchangeRatesTable.$inferSelect> = [];
    let importedCount = 0;
    let updatedCount = 0;
    for (const rate of rates) {
      const [existing] = await tx.select().from(exchangeRatesTable).where(and(
        eq(exchangeRatesTable.userId, currentUserId(req)),
        eq(exchangeRatesTable.sourceCurrency, rate.sourceCurrency),
        eq(exchangeRatesTable.functionalCurrency, rate.functionalCurrency),
        eq(exchangeRatesTable.effectiveDate, rate.effectiveDate),
      ));
      if (existing) {
        const [updated] = await tx.update(exchangeRatesTable).set(rate).where(eq(exchangeRatesTable.id, existing.id)).returning();
        returned.push(updated);
        updatedCount += 1;
      } else {
        const [created] = await tx.insert(exchangeRatesTable).values({ ...rate, userId: currentUserId(req) }).returning();
        returned.push(created);
        importedCount += 1;
      }
    }
    return { importedCount, updatedCount, rates: returned };
  });
  await refreshWorkspaceRateConversions(currentUserId(req));
  return res.json(ImportExchangeRatesResponse.parse({
    ...result,
    rates: result.rates.map(exchangeRateResponse),
  }));
});

router.get("/ledgerflow/overview", async (req, res) => {
  const requestedClientId = req.query.clientId === undefined ? undefined : Number(req.query.clientId);
  const client = await requireOwnedClient(req, res, requestedClientId);
  if (!client) return;
  const lines = await db.select().from(statementLinesTable).where(eq(statementLinesTable.clientId, client.id));
  const pendingReview = lines.filter((line) => line.status !== "posted").length;
  const postedLines = lines.filter((line) => line.status === "posted");
  const missingRateLines = postedLines.filter((line) =>
    normalizeCurrency(line.currency) !== normalizeCurrency(client.functionalCurrency)
    && line.functionalAmount == null,
  );
  const postedAmountFunctional = postedLines.reduce((sum, line) => {
    if (normalizeCurrency(line.currency) === normalizeCurrency(client.functionalCurrency)) return sum + number(line.amount);
    return sum + (line.functionalAmount == null ? 0 : number(line.functionalAmount));
  }, 0);
  const data = GetLedgerOverviewResponse.parse({
    period: client.period,
    currencies: [...new Set(lines.map((line) => line.currency))],
    totalLines: lines.length,
    pendingReview,
    postedAmount: postedAmountFunctional,
    completionPercent: Math.round(((lines.length - pendingReview) / Math.max(lines.length, 1)) * 100),
    functionalCurrency: normalizeCurrency(client.functionalCurrency),
    postedAmountFunctional,
    missingRateCount: missingRateLines.length,
    missingRateCurrencies: [...new Set(missingRateLines.map((line) => line.currency))],
  });
  res.json(data);
});

router.get("/ledgerflow/statement-lines", async (req, res) => {
  const parsed = GetStatementLinesQueryParams.parse(req.query);
  const client = await requireOwnedClient(req, res, parsed.clientId);
  if (!client) return;
  const workspacePatterns = await getWorkspacePatterns(currentUserId(req));
  const lines = await db.select().from(statementLinesTable).where(and(
    eq(statementLinesTable.clientId, client.id),
    parsed.currency ? eq(statementLinesTable.currency, parsed.currency) : undefined,
    parsed.status ? eq(statementLinesTable.status, parsed.status) : undefined,
  )).orderBy(asc(statementLinesTable.date));
  res.json(GetStatementLinesResponse.parse(lines.map((line) => statementLineResponse(line, workspacePatterns))));
});

router.post("/ledgerflow/statement-lines", async (req, res) => {
  const body = CreateStatementLineBody.parse(req.body);
  const client = await requireOwnedClient(req, res, body.clientId);
  if (!client) return;
  if (body.bankAccountId != null) {
    const [bankAccount] = await db.select({ id: bankAccountsTable.id })
      .from(bankAccountsTable)
      .where(and(
        eq(bankAccountsTable.id, body.bankAccountId),
        eq(bankAccountsTable.clientId, client.id),
      ))
      .limit(1);
    if (!bankAccount) return res.status(400).json({ error: "Selected bank account was not found for this client." });
  }
  const workspacePatterns = await getWorkspacePatterns(currentUserId(req));
  const workspaceSuggestion = findWorkspaceSuggestion(workspacePatterns, body.description);
  const conversion = await resolveExchangeRate(
    currentUserId(req),
    body.currency,
    normalizeCurrency(client.functionalCurrency),
    body.date,
    body.amount,
  );
  const line = await db.transaction((tx) => createStatementLineAndJournal(tx, {
    ...body,
    clientId: client.id,
    amount: String(body.amount),
    status: "needs_review",
    source: "Manual entry",
    accountSuggestion: workspaceSuggestion?.accountSuggestion || suggestAccount(body.description, body.direction),
    confidence: (workspaceSuggestion?.confidence ?? 0.75).toFixed(2),
    functionalCurrency: conversion.functionalCurrency,
    functionalAmount: conversion.functionalAmount,
    exchangeRate: conversion.exchangeRate,
    exchangeRateEffectiveDate: conversion.exchangeRateEffectiveDate,
    exchangeRateStatus: conversion.exchangeRateStatus,
  }));
  if (!line) throw new Error("Manual statement line was not created.");
  return res.status(201).json(CreateStatementLineResponse.parse(statementLineResponse(line, workspacePatterns)));
});

router.get("/ledgerflow/journal-entries", async (req, res) => {
  const requestedClientId = req.query.clientId === undefined ? undefined : Number(req.query.clientId);
  const client = await requireOwnedClient(req, res, requestedClientId);
  if (!client) return;
  const entries = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.clientId, client.id)).orderBy(asc(journalEntriesTable.date));
  res.json(GetJournalEntriesResponse.parse(entries.map(journalEntryResponse)));
});

router.post("/ledgerflow/journal-entries/:id/approve", async (req, res) => {
  const { id } = ApproveJournalEntryParams.parse({ id: Number(req.params.id) });
  const { clientId } = ApproveJournalEntryBody.parse(req.body);
  const client = await requireOwnedClient(req, res, clientId);
  if (!client) return;

  const [entry] = await db.update(journalEntriesTable).set({ status: "approved" }).where(and(
    eq(journalEntriesTable.id, id),
    eq(journalEntriesTable.clientId, client.id),
    eq(journalEntriesTable.status, "suggested"),
  )).returning();
  if (!entry) {
    res.status(409).json({ error: "This journal entry is not available for approval for this client" });
    return;
  }
  const [line] = await db.select().from(statementLinesTable).where(and(
    eq(statementLinesTable.id, entry.statementLineId),
    eq(statementLinesTable.clientId, client.id),
  ));
  if (line) {
    const accountSuggestion = line.direction === "inflow" ? entry.creditAccount : entry.debitAccount;
    try {
      await recordClassificationPattern(currentUserId(req), line.description, accountSuggestion, entry.confidence);
    } catch (error) {
      req.log.warn({ err: error }, "Classification learning could not be recorded after approval");
    }
  }
  return res.json(ApproveJournalEntryResponse.parse(journalEntryResponse(entry)));
});

router.post("/ledgerflow/journal-entries/:id/post", async (req, res) => {
  const { id } = ApproveJournalEntryParams.parse({ id: Number(req.params.id) });
  const { clientId } = PostJournalEntryBody.parse(req.body);
  const client = await requireOwnedClient(req, res, clientId);
  if (!client) return;

  const result = await db.transaction(async (tx) => {
    const [entry] = await tx.select().from(journalEntriesTable).where(and(
      eq(journalEntriesTable.id, id),
      eq(journalEntriesTable.clientId, client.id),
    ));
    if (!entry) return { kind: "not_found" as const };
    if (entry.status !== "approved") return { kind: "not_approved" as const };

    const [line] = await tx.select().from(statementLinesTable).where(and(
      eq(statementLinesTable.id, entry.statementLineId),
      eq(statementLinesTable.clientId, client.id),
    ));
    if (!line) return { kind: "not_found" as const };

    const [postedEntry] = await tx.update(journalEntriesTable).set({ status: "posted" }).where(and(
      eq(journalEntriesTable.id, entry.id),
      eq(journalEntriesTable.status, "approved"),
    )).returning();
    if (!postedEntry) return { kind: "not_approved" as const };

    await tx.update(statementLinesTable).set({ status: "posted" }).where(eq(statementLinesTable.id, line.id));
    return { kind: "posted" as const, entry: postedEntry };
  });
  if (result.kind === "not_found") {
    res.status(404).json({ error: "Journal entry not found for this client" });
    return;
  }
  if (result.kind === "not_approved") {
    res.status(409).json({ error: "Journal entry must be approved before posting" });
    return;
  }
  return res.json(ApproveJournalEntryResponse.parse(journalEntryResponse(result.entry)));
});

router.get("/ledgerflow/trial-balance", async (req, res) => {
  const requestedClientId = req.query.clientId === undefined ? undefined : Number(req.query.clientId);
  const client = await requireOwnedClient(req, res, requestedClientId);
  if (!client) return;
  const entries = await db.select().from(journalEntriesTable).where(and(
    eq(journalEntriesTable.clientId, client.id),
    eq(journalEntriesTable.status, "posted"),
  ));
  const accounts = new Map<string, { debit: number; credit: number; category: string }>();
  const functionalCurrency = normalizeCurrency(client.functionalCurrency);
  const missingEntries = entries.filter((entry) => reportingAmount(entry, functionalCurrency) == null);
  const missingRateCurrencies = [...new Set(missingEntries.map((entry) => entry.currency))];
  for (const entry of entries) {
    const amount = reportingAmount(entry, functionalCurrency);
    if (amount == null) continue;
    const debit = accounts.get(entry.debitAccount) ?? { debit: 0, credit: 0, category: entry.debitAccount === "Bank / cash" ? "Assets" : "Expenses" };
    debit.debit += amount;
    accounts.set(entry.debitAccount, debit);
    const credit = accounts.get(entry.creditAccount) ?? { debit: 0, credit: 0, category: entry.creditAccount === "Revenue" ? "Revenue" : "Assets" };
    credit.credit += amount;
    accounts.set(entry.creditAccount, credit);
  }
  const rows = [...accounts.entries()].map(([account, values]) => ({
    account, category: values.category, debit: values.debit, credit: values.credit, balance: values.debit - values.credit,
    functionalCurrency,
    missingRateCount: missingEntries.length,
    missingRateCurrencies,
  }));
  if (missingEntries.length) {
    rows.push({
      account: "Rate coverage required",
      category: "Unconverted transactions",
      debit: 0,
      credit: 0,
      balance: 0,
      functionalCurrency,
      missingRateCount: missingEntries.length,
      missingRateCurrencies,
    });
  }
  res.json(GetTrialBalanceResponse.parse(rows));
});

router.get("/ledgerflow/financial-statements", async (req, res) => {
  const { period } = GetFinancialStatementsQueryParams.parse(req.query);
  const client = await requireOwnedClient(req, res, req.query.clientId === undefined ? undefined : Number(req.query.clientId));
  if (!client) return;
  const entries = await db.select().from(journalEntriesTable).where(and(
    eq(journalEntriesTable.clientId, client.id),
    eq(journalEntriesTable.status, "posted"),
  ));
  const expenseAccounts = new Map<string, number>();
  const revenueAccounts = new Map<string, number>();
  const functionalCurrency = normalizeCurrency(client.functionalCurrency);
  const missingEntries = entries.filter((entry) => reportingAmount(entry, functionalCurrency) == null);
  const missingRateCurrencies = [...new Set(missingEntries.map((entry) => entry.currency))];
  let cash = 0;
  for (const entry of entries) {
    const amount = reportingAmount(entry, functionalCurrency);
    if (amount == null) continue;
    if (entry.debitAccount === "Bank / cash") cash += amount;
    if (entry.creditAccount === "Bank / cash") cash -= amount;
    if (entry.debitAccount !== "Bank / cash") expenseAccounts.set(entry.debitAccount, (expenseAccounts.get(entry.debitAccount) ?? 0) + amount);
    if (entry.creditAccount !== "Bank / cash") revenueAccounts.set(entry.creditAccount, (revenueAccounts.get(entry.creditAccount) ?? 0) + amount);
  }
  const totalExpenses = [...expenseAccounts.values()].reduce((sum, amount) => sum + amount, 0);
  const totalRevenue = [...revenueAccounts.values()].reduce((sum, amount) => sum + amount, 0);
  const netIncome = totalRevenue - totalExpenses;
  const report = {
    period: period ?? client.period,
    functionalCurrency,
    missingRateCount: missingEntries.length,
    missingRateCurrencies,
    incomeStatement: [
      { label: "Revenue", amount: totalRevenue, children: [...revenueAccounts.entries()].map(([label, amount]) => ({ label, amount })) },
      { label: "Operating expenses", amount: -totalExpenses, children: [...expenseAccounts.entries()].map(([label, amount]) => ({ label, amount: -amount })) },
      { label: "Net income", amount: netIncome },
    ],
    balanceSheet: [
      { label: "Assets", amount: cash, children: [{ label: "Bank / cash", amount: cash }] },
      { label: "Liabilities", amount: 0 },
      { label: "Equity", amount: cash },
    ],
    cashFlow: [
      { label: "Net income", amount: netIncome },
      { label: "Changes in working capital", amount: 0 },
      { label: "Net cash from operating activities", amount: cash },
      { label: "Net increase in cash", amount: cash },
    ],
  };
  res.json(GetFinancialStatementsResponse.parse(report));
});

export default router;
