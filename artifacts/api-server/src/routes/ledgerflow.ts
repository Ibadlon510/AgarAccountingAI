import { Router, type IRouter } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import OpenAI from "openai";
import {
  ApproveJournalEntryParams,
  ApproveJournalEntryBody,
  AskLedgerflowAIBody,
  AskLedgerflowAIResponse,
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
import { clientsTable, db, journalEntriesTable, statementLinesTable } from "@workspace/db";

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
async function ensureSeeded() {
  const existingClients = await db.select({ id: clientsTable.id }).from(clientsTable).limit(1);
  if (existingClients.length === 0) {
    await db.insert(clientsTable).values([
      { name: "Northstar Advisory", legalName: "Northstar Advisory FZ-LLC", functionalCurrency: "AED", basis: "IFRS", period: "August 2026" },
      { name: "Cedar Studio", legalName: "Cedar Studio LLC", functionalCurrency: "AED", basis: "IFRS", period: "August 2026" },
    ]);
  }
  const existing = await db.select({ id: statementLinesTable.id }).from(statementLinesTable).limit(1);
  if (existing.length > 0) return;
  const inserted = await db.insert(statementLinesTable).values(seedLines).returning();
  await db.insert(journalEntriesTable).values(inserted.map((line) => ({
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
}

export async function initializeLedgerFlow() {
  await ensureSeeded();
  const postedLines = await db.select({ id: statementLinesTable.id }).from(statementLinesTable).where(eq(statementLinesTable.status, "posted"));
  if (postedLines.length) {
    await db.update(journalEntriesTable).set({ status: "posted" }).where(and(
      eq(journalEntriesTable.status, "approved"),
      inArray(journalEntriesTable.statementLineId, postedLines.map((line) => line.id)),
    ));
  }
}
function number(value: string | null | undefined) {
  return Number(value ?? 0);
}

function clientIdFrom(value: unknown) {
  const parsed = Number(value ?? 1);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
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
  const account = line.accountSuggestion || "Uncategorized";
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
};

function normalizeRows(text: string, currency: string): ParsedBankLine[] {
  return text.split(/\r?\n/).slice(1).map((row) => {
    const cells = row.split(/,|\t|;/).map((cell) => cell.trim().replace(/^"|"$/g, ""));
    const amountCell = cells.find((cell) => /-?\d[\d,]*(\.\d+)?/.test(cell)) ?? "0";
    const amount = Number(amountCell.replace(/[^0-9.-]/g, ""));
    return {
      date: cells[0] ?? "",
      description: cells.slice(1, Math.max(2, cells.length - 1)).join(" ") || "Imported bank activity",
      amount: Math.abs(amount),
      direction: (amount < 0 ? "outflow" : "inflow") as "outflow" | "inflow",
      currency,
    };
  }).filter((line) => line.date && line.amount > 0);
}

router.post("/ledgerflow/import-statement", async (req, res) => {
  const { clientId, fileName, mimeType, contentBase64, currency = "AED" } = req.body as {
    clientId?: number; fileName?: string; mimeType?: string; contentBase64?: string; currency?: string;
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
        { role: "system", content: "Extract bank statement transactions. Return JSON only: {\"lines\":[{\"date\":\"YYYY-MM-DD\",\"description\":\"string\",\"amount\":123.45,\"direction\":\"inflow|outflow\",\"currency\":\"AED\"}]}. Never invent transactions. Use the statement's stated currency when available." },
        { role: "user", content: `File: ${fileName}\nDefault currency: ${currency}\n\nStatement text:\n${extractedText.slice(0, 55000)}` },
      ],
    });
    const candidate = JSON.parse(response.choices[0]?.message?.content ?? "{\"lines\":[]}") as { lines?: ParsedBankLine[] };
    const lines = (candidate.lines?.length ? candidate.lines : fallback).filter((line) => line.date && line.description && Number.isFinite(Number(line.amount)) && Number(line.amount) > 0);
    const activeClientId = clientIdFrom(clientId);
    const inserted = lines.length ? await db.insert(statementLinesTable).values(lines.map((line) => ({
      clientId: activeClientId,
      date: line.date,
      description: line.description,
      currency: line.currency || currency,
      amount: String(Math.abs(line.amount)),
      direction: line.direction,
      status: "needs_review",
      source: `Imported: ${fileName}`,
      accountSuggestion: null,
      confidence: null,
    }))).returning() : [];
    for (const line of inserted) await createSuggestedEntry(line);
    return res.status(201).json({ fileName, importedCount: inserted.length, lines: inserted.map((line) => ({ ...line, amount: number(line.amount) })) });
  } catch (error) {
    req.log.error({ err: error }, "Statement import failed");
    return res.status(422).json({ error: "We could not read this statement. Try a clearer PDF, CSV, or Excel file." });
  }
});

router.post("/ledgerflow/ai-chat", async (req, res) => {
  const { clientId, message } = AskLedgerflowAIBody.parse(req.body);
  const client = (await db.select().from(clientsTable).where(eq(clientsTable.id, clientId)))[0];
  if (!client) {
    res.status(404).json({ error: "Client workspace not found" });
    return;
  }
  const lines = await db.select().from(statementLinesTable).where(eq(statementLinesTable.clientId, clientId));
  const entries = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.clientId, clientId));
  const pendingLines = lines.filter((line) => line.status !== "posted");
  const postedLines = lines.filter((line) => line.status === "posted");
  const context = { clientName: client.name, pendingLines: pendingLines.length, postedLines: postedLines.length };
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.6-luna",
      max_completion_tokens: 1200,
      messages: [
        {
          role: "system",
          content: "You are LedgerFlow's bookkeeping assistant. Answer questions about the selected client workspace using only the supplied context. Be concise, practical, and clear that AI does not post anything. If asked to post or approve, explain that the accountant must use the review controls. Use AED as the presentation currency and mention source currencies when relevant.",
        },
        {
          role: "user",
          content: JSON.stringify({
            client: { name: client.name, legalName: client.legalName, basis: client.basis, functionalCurrency: client.functionalCurrency, period: client.period },
            reviewQueue: pendingLines.slice(0, 20).map((line) => ({ date: line.date, description: line.description, currency: line.currency, amount: line.amount, direction: line.direction, status: line.status, accountSuggestion: line.accountSuggestion })),
            approvedEntries: entries.filter((entry) => entry.status === "approved").slice(0, 20).map((entry) => ({ date: entry.date, memo: entry.memo, currency: entry.currency, amount: entry.amount, debit: entry.debitAccount, credit: entry.creditAccount })),
            question: message,
          }),
        },
      ],
    });
    const answer = response.choices[0]?.message?.content?.trim() || "I couldn't produce a response for this workspace.";
    res.json(AskLedgerflowAIResponse.parse({ answer, context }));
  } catch (error) {
    req.log.error({ err: error }, "AI workspace chat failed");
    res.status(502).json({ error: "The AI assistant is temporarily unavailable." });
  }
});

router.get("/clients", async (_req, res) => {
  await ensureSeeded();
  const clients = await db.select().from(clientsTable).orderBy(asc(clientsTable.name));
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
  const [client] = await db.insert(clientsTable)
    .values({ name: body.name, legalName: body.legalName, functionalCurrency: "AED", basis: "IFRS", period: "August 2026" })
    .returning();
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
  const [client] = await db.update(clientsTable)
    .set(body)
    .where(eq(clientsTable.id, id))
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
  await ensureSeeded();
  const clientId = clientIdFrom(req.query.clientId);
  const lines = await db.select().from(statementLinesTable).where(eq(statementLinesTable.clientId, clientId));
  const pendingReview = lines.filter((line) => line.status !== "posted").length;
  const postedAmount = lines.filter((line) => line.status === "posted").reduce((sum, line) => sum + number(line.amount), 0);
  const data = GetLedgerOverviewResponse.parse({
    period: "August 2026",
    currencies: [...new Set(lines.map((line) => line.currency))],
    totalLines: lines.length,
    pendingReview,
    postedAmount,
    completionPercent: Math.round(((lines.length - pendingReview) / Math.max(lines.length, 1)) * 100),
  });
  res.json(data);
});

router.get("/ledgerflow/statement-lines", async (req, res) => {
  await ensureSeeded();
  const parsed = GetStatementLinesQueryParams.parse(req.query);
  const clientId = clientIdFrom(parsed.clientId);
  const lines = await db.select().from(statementLinesTable).where(and(
    eq(statementLinesTable.clientId, clientId),
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
  const [line] = await db.insert(statementLinesTable).values({
    ...body,
    amount: String(body.amount),
    status: "needs_review",
    source: "Manual entry",
  }).returning();
  await createSuggestedEntry(line);
  res.status(201).json(CreateStatementLineResponse.parse({
    ...line,
    amount: number(line.amount),
    confidence: line.confidence == null ? null : number(line.confidence),
  }));
});

router.get("/ledgerflow/journal-entries", async (_req, res) => {
  await ensureSeeded();
  const clientId = clientIdFrom(_req.query.clientId);
  const entries = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.clientId, clientId)).orderBy(asc(journalEntriesTable.date));
  res.json(GetJournalEntriesResponse.parse(entries.map(journalEntryResponse)));
});

router.post("/ledgerflow/journal-entries/:id/approve", async (req, res) => {
  const { id } = ApproveJournalEntryParams.parse({ id: Number(req.params.id) });
  const { clientId } = ApproveJournalEntryBody.parse(req.body);

  const [entry] = await db.update(journalEntriesTable).set({ status: "approved" }).where(and(
    eq(journalEntriesTable.id, id),
    eq(journalEntriesTable.clientId, clientId),
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

  const result = await db.transaction(async (tx) => {
    const [entry] = await tx.select().from(journalEntriesTable).where(and(
      eq(journalEntriesTable.id, id),
      eq(journalEntriesTable.clientId, clientId),
    ));
    if (!entry) return { kind: "not_found" as const };
    if (entry.status !== "approved") return { kind: "not_approved" as const };

    const [line] = await tx.select().from(statementLinesTable).where(and(
      eq(statementLinesTable.id, entry.statementLineId),
      eq(statementLinesTable.clientId, clientId),
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

router.get("/ledgerflow/trial-balance", async (_req, res) => {
  await ensureSeeded();
  const clientId = clientIdFrom(_req.query.clientId);
  const entries = await db.select().from(journalEntriesTable).where(and(
    eq(journalEntriesTable.clientId, clientId),
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
  const clientId = clientIdFrom(req.query.clientId);
  await ensureSeeded();
  const client = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  const entries = await db.select().from(journalEntriesTable).where(and(
    eq(journalEntriesTable.clientId, clientId),
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
    period: period ?? client[0]?.period ?? "Current period",
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
