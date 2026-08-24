import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  ApproveJournalEntryParams,
  ApproveJournalEntryResponse,
  CreateStatementLineBody,
  CreateStatementLineResponse,
  GetFinancialStatementsQueryParams,
  GetFinancialStatementsResponse,
  GetJournalEntriesResponse,
  GetLedgerOverviewResponse,
  GetStatementLinesQueryParams,
  GetStatementLinesResponse,
  GetTrialBalanceResponse,
} from "@workspace/api-zod";
import { db, journalEntriesTable, statementLinesTable } from "@workspace/db";

const router: IRouter = Router();

const seedLines = [
  { date: "2026-08-03", description: "EMIRATES AIRLINES", currency: "AED", amount: "1840.00", direction: "outflow", status: "posted", source: "Bank statement", accountSuggestion: "Travel & entertainment", confidence: "0.98" },
  { date: "2026-08-05", description: "STRIPE PAYOUT 8472", currency: "USD", amount: "12450.00", direction: "inflow", status: "posted", source: "Bank statement", accountSuggestion: "Revenue", confidence: "0.99" },
  { date: "2026-08-07", description: "AWS EMEA", currency: "USD", amount: "624.50", direction: "outflow", status: "needs_review", source: "Bank statement", accountSuggestion: "Software & subscriptions", confidence: "0.91" },
  { date: "2026-08-10", description: "AL FARAJ OFFICE SUPPLIES", currency: "AED", amount: "389.00", direction: "outflow", status: "needs_review", source: "Bank statement", accountSuggestion: "Office expenses", confidence: "0.87" },
  { date: "2026-08-12", description: "CLIENT RETAINER — NORTHSTAR", currency: "AED", amount: "28750.00", direction: "inflow", status: "posted", source: "Bank statement", accountSuggestion: "Revenue", confidence: "0.97" },
  { date: "2026-08-15", description: "GULF TELECOM", currency: "AED", amount: "475.00", direction: "outflow", status: "needs_review", source: "Bank statement", accountSuggestion: "Communication expenses", confidence: "0.84" },
];

async function ensureSeeded() {
  const existing = await db.select({ id: statementLinesTable.id }).from(statementLinesTable).limit(1);
  if (existing.length > 0) return;
  const inserted = await db.insert(statementLinesTable).values(seedLines).returning();
  await db.insert(journalEntriesTable).values(inserted.map((line) => ({
    statementLineId: line.id,
    date: line.date,
    memo: line.description,
    currency: line.currency,
    status: line.status === "posted" ? "approved" : "suggested",
    confidence: line.confidence ?? "0.80",
    debitAccount: line.direction === "inflow" ? "Bank / cash" : (line.accountSuggestion ?? "Uncategorized"),
    creditAccount: line.direction === "inflow" ? (line.accountSuggestion ?? "Uncategorized") : "Bank / cash",
    amount: line.amount,
  })));
}

function number(value: string | null | undefined) {
  return Number(value ?? 0);
}

router.get("/ledgerflow/overview", async (_req, res) => {
  await ensureSeeded();
  const lines = await db.select().from(statementLinesTable);
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
  const lines = await db.select().from(statementLinesTable).where(and(
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
  res.status(201).json(CreateStatementLineResponse.parse({
    ...line,
    amount: number(line.amount),
    confidence: line.confidence == null ? null : number(line.confidence),
  }));
});

router.get("/ledgerflow/journal-entries", async (_req, res) => {
  await ensureSeeded();
  const entries = await db.select().from(journalEntriesTable).orderBy(asc(journalEntriesTable.date));
  res.json(GetJournalEntriesResponse.parse(entries.map((entry) => ({
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
  }))));
});

router.post("/ledgerflow/journal-entries/:id/approve", async (req, res) => {
  const { id } = ApproveJournalEntryParams.parse({ id: Number(req.params.id) });
  const [entry] = await db.update(journalEntriesTable).set({ status: "approved" }).where(eq(journalEntriesTable.id, id)).returning();
  if (!entry) return res.status(404).json({ error: "Journal entry not found" });
  await db.update(statementLinesTable).set({ status: "posted" }).where(eq(statementLinesTable.id, entry.statementLineId));
  return res.json(ApproveJournalEntryResponse.parse({
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
  }));
});

router.get("/ledgerflow/trial-balance", async (_req, res) => {
  await ensureSeeded();
  const entries = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.status, "approved"));
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
  const report = {
    period: period ?? "August 2026",
    incomeStatement: [
      { label: "Revenue", amount: 41200, children: [{ label: "Service revenue", amount: 41200 }] },
      { label: "Operating expenses", amount: -3328.5, children: [{ label: "Travel & entertainment", amount: -1840 }, { label: "Office expenses", amount: -389 }, { label: "Software & subscriptions", amount: -624.5 }, { label: "Communication expenses", amount: -475 }] },
      { label: "Net income", amount: 37871.5 },
    ],
    balanceSheet: [
      { label: "Assets", amount: 118420, children: [{ label: "Bank / cash", amount: 118420 }] },
      { label: "Liabilities", amount: 0 },
      { label: "Equity", amount: 118420 },
    ],
    cashFlow: [
      { label: "Net income", amount: 37871.5 },
      { label: "Changes in working capital", amount: 0 },
      { label: "Net cash from operating activities", amount: 37871.5 },
      { label: "Net increase in cash", amount: 37871.5 },
    ],
  };
  res.json(GetFinancialStatementsResponse.parse(report));
});

export default router;