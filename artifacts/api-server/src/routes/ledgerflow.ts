import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
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
  GetBankAccountsQueryParams,
  GetBankAccountsResponse,
  ApproveJournalEntryResponse,
  UpdateClientParams,
  UpdateClientBody,
  UpdateClientResponse,
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
} from "@workspace/api-zod";
import {
  bankAccountsTable,
  clientWorkspacesTable,
  clientsTable,
  db,
  journalEntriesTable,
  statementLinesTable,
  usersTable,
} from "@workspace/db";

const router: IRouter = Router();
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

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
    date: entry.date,
    memo: entry.memo,
    currency: entry.currency,
    status: entry.status,
    confidence: number(entry.confidence),
    lines: [
      { account: entry.debitAccount, debit: number(entry.amount), credit: 0 },
      { account: entry.creditAccount, debit: 0, credit: number(entry.amount) },
    ],
  };
}
function number(value: string | null | undefined) {
  return Number(value ?? 0);
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

async function createSuggestedEntry(line: {
  id: number;
  clientId: number;
  date: string;
  description: string;
  currency: string;
  amount: string;
  direction: string;
  accountSuggestion?: string | null;
  confidence?: string | null;
}) {
  const account = line.accountSuggestion || suggestAccount(line.description, line.direction);
  await db.insert(journalEntriesTable).values({
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
  });
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
  const existingAccounts = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.clientId, clientId));
  const existing = existingAccounts.find((account) =>
    (clean.accountNumberLast4 && account.accountNumberLast4 === clean.accountNumberLast4)
    || (account.name.toLowerCase() === clean.name.toLowerCase() && account.currency === clean.currency),
  );
  if (existing) return existing;
  const [created] = await db.insert(bankAccountsTable).values({ clientId, ...clean }).returning();
  return created;
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
): AICopilotRecommendation[] {
  const recommendations: AICopilotRecommendation[] = [];
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
  try {
    const buffer = Buffer.from(contentBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
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
    const client = await requireOwnedClient(req, res, typeof clientId === "number" ? clientId : undefined);
    if (!client) return;
    const activeClientId = client.id;
    const selectedBankAccount = bankAccountId == null ? null : (await db.select().from(bankAccountsTable).where(and(
      eq(bankAccountsTable.id, Number(bankAccountId)),
      eq(bankAccountsTable.clientId, activeClientId),
    )))[0];
    if (bankAccountId != null && !selectedBankAccount) {
      return res.status(400).json({ error: "Selected bank account was not found for this client." });
    }
    const detectedBankAccount = selectedBankAccount ?? await findOrCreateBankAccount(activeClientId, candidate.bankAccount, currency);
    const inserted = lines.length ? await db.insert(statementLinesTable).values(lines.map((line) => {
      const accountSuggestion = line.accountSuggestion?.trim() || suggestAccount(line.description, line.direction);
      const parsedConfidence = Number(line.confidence);
      const confidence = Number.isFinite(parsedConfidence) && parsedConfidence >= 0 && parsedConfidence <= 1
        ? parsedConfidence.toFixed(2)
        : "0.75";
      return {
        clientId: activeClientId,
        bankAccountId: detectedBankAccount?.id ?? null,
        date: line.date,
        description: line.description,
        currency: line.currency || currency,
        amount: String(Math.abs(line.amount)),
        direction: line.direction,
        status: "needs_review" as const,
        source: `Imported: ${fileName}`,
        accountSuggestion,
        confidence,
      };
    })).returning() : [];
    for (const line of inserted) await createSuggestedEntry(line);
    return res.status(201).json({ fileName, importedCount: inserted.length, lines: inserted.map((line) => ({ ...line, amount: number(line.amount) })), bankAccount: detectedBankAccount ? bankAccountResponse(detectedBankAccount) : null });
  } catch (error) {
    req.log.error({ err: error }, "Statement import failed");
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
            reviewQueue: pendingLines.slice(0, 50).map((line) => ({ id: line.id, date: line.date, description: line.description, currency: line.currency, amount: line.amount, direction: line.direction, status: line.status, accountSuggestion: line.accountSuggestion })),
             journalEntries: entries.filter((entry) => entry.status !== "posted").slice(0, 50).map((entry) => ({ id: entry.id, statementLineId: entry.statementLineId, date: entry.date, memo: entry.memo, currency: entry.currency, amount: entry.amount, status: entry.status, debit: entry.debitAccount, credit: entry.creditAccount })),
            question: message,
          }),
        },
      ],
    });
    const raw = JSON.parse(response.choices[0]?.message?.content ?? "{}") as { answer?: unknown; recommendations?: unknown };
     const recommendations = collectAICopilotRecommendations(raw.recommendations, pendingLines, clientId);
     const fallbackRecommendations = defaultAICopilotRecommendations(pendingLines, bankAccounts, clientId);
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
  const selectedLines = await db.select().from(statementLinesTable).where(and(
    eq(statementLinesTable.clientId, client.id),
    inArray(statementLinesTable.id, lineIds),
  ));
  if (selectedLines.length !== lineIds.length) {
    return res.status(404).json({ error: "One or more selected statement lines are not available in this client." });
  }
  if (selectedLines.some((line) => line.status === "posted")) {
    return res.status(409).json({ error: "Posted statement lines cannot be recoded through the AI assistant." });
  }
  const entries = await db.select().from(journalEntriesTable).where(and(
    eq(journalEntriesTable.clientId, client.id),
    inArray(journalEntriesTable.statementLineId, lineIds),
  ));
  if (entries.some((entry) => entry.status !== "suggested")) {
    return res.status(409).json({ error: "Only still-suggested journal entries can be recoded. Review approved entries individually." });
  }
  const confidence = Number.isFinite(Number(body.confidence)) && Number(body.confidence) >= 0 && Number(body.confidence) <= 1
    ? Number(body.confidence).toFixed(2)
    : "0.75";
  await db.transaction(async (tx) => {
    await tx.update(statementLinesTable).set({ accountSuggestion, confidence }).where(and(
      eq(statementLinesTable.clientId, client.id),
      inArray(statementLinesTable.id, lineIds),
    ));
    for (const line of selectedLines) {
      await tx.update(journalEntriesTable).set({
        confidence,
        debitAccount: line.direction === "inflow" ? "Bank / cash" : accountSuggestion,
        creditAccount: line.direction === "inflow" ? accountSuggestion : "Bank / cash",
      }).where(and(
        eq(journalEntriesTable.clientId, client.id),
        eq(journalEntriesTable.statementLineId, line.id),
        eq(journalEntriesTable.status, "suggested"),
      ));
    }
  });
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

router.get("/ledgerflow/overview", async (req, res) => {
  const requestedClientId = req.query.clientId === undefined ? undefined : Number(req.query.clientId);
  const client = await requireOwnedClient(req, res, requestedClientId);
  if (!client) return;
  const lines = await db.select().from(statementLinesTable).where(eq(statementLinesTable.clientId, client.id));
  const pendingReview = lines.filter((line) => line.status !== "posted").length;
  const postedAmount = lines.filter((line) => line.status === "posted").reduce((sum, line) => sum + number(line.amount), 0);
  const data = GetLedgerOverviewResponse.parse({
    period: client.period,
    currencies: [...new Set(lines.map((line) => line.currency))],
    totalLines: lines.length,
    pendingReview,
    postedAmount,
    completionPercent: Math.round(((lines.length - pendingReview) / Math.max(lines.length, 1)) * 100),
  });
  res.json(data);
});

router.get("/ledgerflow/statement-lines", async (req, res) => {
  const parsed = GetStatementLinesQueryParams.parse(req.query);
  const client = await requireOwnedClient(req, res, parsed.clientId);
  if (!client) return;
  const lines = await db.select().from(statementLinesTable).where(and(
    eq(statementLinesTable.clientId, client.id),
    parsed.currency ? eq(statementLinesTable.currency, parsed.currency) : undefined,
    parsed.status ? eq(statementLinesTable.status, parsed.status) : undefined,
  )).orderBy(asc(statementLinesTable.date));
  res.json(GetStatementLinesResponse.parse(lines.map((line) => ({
    ...line,
    amount: number(line.amount),
    confidence: line.confidence == null ? null : number(line.confidence),
  }))));
});

router.post("/ledgerflow/statement-lines", async (req, res) => {
  const body = CreateStatementLineBody.parse(req.body);
  const client = await requireOwnedClient(req, res, body.clientId);
  if (!client) return;
  const [line] = await db.insert(statementLinesTable).values({
    ...body,
    clientId: client.id,
    amount: String(body.amount),
    status: "needs_review",
    source: "Manual entry",
    accountSuggestion: suggestAccount(body.description, body.direction),
    confidence: "0.75",
  }).returning();
  await createSuggestedEntry(line);
  res.status(201).json(CreateStatementLineResponse.parse({
    ...line,
    amount: number(line.amount),
    confidence: line.confidence == null ? null : number(line.confidence),
  }));
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
  for (const entry of entries) {
    const debit = accounts.get(entry.debitAccount) ?? { debit: 0, credit: 0, category: entry.debitAccount === "Bank / cash" ? "Assets" : "Expenses" };
    debit.debit += number(entry.amount);
    accounts.set(entry.debitAccount, debit);
    const credit = accounts.get(entry.creditAccount) ?? { debit: 0, credit: 0, category: entry.creditAccount === "Revenue" ? "Revenue" : "Assets" };
    credit.credit += number(entry.amount);
    accounts.set(entry.creditAccount, credit);
  }
  res.json(GetTrialBalanceResponse.parse([...accounts.entries()].map(([account, values]) => ({
    account, category: values.category, debit: values.debit, credit: values.credit, balance: values.debit - values.credit,
  }))));
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
  let cash = 0;
  for (const entry of entries) {
    const amount = number(entry.amount);
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
