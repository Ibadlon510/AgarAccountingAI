import { and, eq, isNull } from "drizzle-orm";
import {
  accountClassificationsTable,
  db,
  journalEntriesTable,
  statementLinesTable,
  type AccountClassification,
  type JournalEntry,
} from "@workspace/db";

export type UaeTaxTreatment =
  | "ordinary_deductible"
  | "entertainment_limited"
  | "fully_non_deductible"
  | "review_required";

type DefaultAccount = {
  accountCode: string;
  accountName: string;
  displayName: string;
  statementSection: "asset" | "liability" | "equity" | "revenue" | "expense" | "oci";
  currentNonCurrent: "current" | "non_current" | "not_applicable";
  cashFlowCategory: "operating" | "investing" | "financing" | "non_cash";
  taxTreatment: UaeTaxTreatment;
  taxTreatmentReason: string | null;
  noteNumber: number;
  sortOrder: number;
};

export const defaultClientChart: DefaultAccount[] = [
  { accountCode: "1000", accountName: "Bank / cash", displayName: "Bank / cash", statementSection: "asset", currentNonCurrent: "current", cashFlowCategory: "operating", taxTreatment: "review_required", taxTreatmentReason: "Balance-sheet account; not an expense deduction.", noteNumber: 3, sortOrder: 100 },
  { accountCode: "1090", accountName: "Inter-account transfer", displayName: "Inter-account transfer", statementSection: "asset", currentNonCurrent: "current", cashFlowCategory: "non_cash", taxTreatment: "review_required", taxTreatmentReason: "Transfer-clearing account; not an expense deduction.", noteNumber: 3, sortOrder: 110 },
  { accountCode: "1200", accountName: "Prepaid expenses", displayName: "Prepaid expenses", statementSection: "asset", currentNonCurrent: "current", cashFlowCategory: "operating", taxTreatment: "review_required", taxTreatmentReason: "Balance-sheet account; not an expense deduction.", noteNumber: 3, sortOrder: 120 },
  { accountCode: "1210", accountName: "Due from shareholders", displayName: "Due from shareholders", statementSection: "asset", currentNonCurrent: "current", cashFlowCategory: "non_cash", taxTreatment: "review_required", taxTreatmentReason: "Unpaid share capital receivable; not an expense deduction.", noteNumber: 6, sortOrder: 121 },
  { accountCode: "2100", accountName: "Accrued expenses", displayName: "Accrued expenses", statementSection: "liability", currentNonCurrent: "current", cashFlowCategory: "operating", taxTreatment: "review_required", taxTreatmentReason: "Balance-sheet account; not an expense deduction.", noteNumber: 6, sortOrder: 210 },
  { accountCode: "3000", accountName: "Share capital", displayName: "Share capital", statementSection: "equity", currentNonCurrent: "not_applicable", cashFlowCategory: "financing", taxTreatment: "review_required", taxTreatmentReason: "Balance-sheet equity account; not an expense deduction.", noteNumber: 8, sortOrder: 300 },
  { accountCode: "4000", accountName: "Revenue", displayName: "Revenue", statementSection: "revenue", currentNonCurrent: "not_applicable", cashFlowCategory: "operating", taxTreatment: "review_required", taxTreatmentReason: "Income is included in accounting profit before tax.", noteNumber: 4, sortOrder: 400 },
  { accountCode: "4100", accountName: "Other income", displayName: "Other income", statementSection: "revenue", currentNonCurrent: "not_applicable", cashFlowCategory: "operating", taxTreatment: "review_required", taxTreatmentReason: "Income is included in accounting profit before tax.", noteNumber: 4, sortOrder: 410 },
  { accountCode: "5100", accountName: "Business travel", displayName: "Business travel", statementSection: "expense", currentNonCurrent: "not_applicable", cashFlowCategory: "operating", taxTreatment: "ordinary_deductible", taxTreatmentReason: "Mapped as wholly and exclusively business-purpose travel with supporting evidence; mixed or private travel must use a review account.", noteNumber: 5, sortOrder: 510 },
  { accountCode: "5200", accountName: "Entertainment & hospitality", displayName: "Entertainment & hospitality", statementSection: "expense", currentNonCurrent: "not_applicable", cashFlowCategory: "operating", taxTreatment: "entertainment_limited", taxTreatmentReason: "Customer or supplier entertainment is estimated with the standard 50% UAE Corporate Tax deduction limitation.", noteNumber: 5, sortOrder: 520 },
  { accountCode: "5300", accountName: "Software & subscriptions", displayName: "Software & subscriptions", statementSection: "expense", currentNonCurrent: "not_applicable", cashFlowCategory: "operating", taxTreatment: "ordinary_deductible", taxTreatmentReason: "Ordinary business expense, subject to business purpose and evidence.", noteNumber: 5, sortOrder: 530 },
  { accountCode: "5400", accountName: "Office expenses", displayName: "Office expenses", statementSection: "expense", currentNonCurrent: "not_applicable", cashFlowCategory: "operating", taxTreatment: "ordinary_deductible", taxTreatmentReason: "Ordinary business expense, subject to business purpose and evidence.", noteNumber: 5, sortOrder: 540 },
  { accountCode: "5500", accountName: "Communication expenses", displayName: "Communication expenses", statementSection: "expense", currentNonCurrent: "not_applicable", cashFlowCategory: "operating", taxTreatment: "ordinary_deductible", taxTreatmentReason: "Ordinary business expense, subject to business purpose and evidence.", noteNumber: 5, sortOrder: 550 },
  { accountCode: "5600", accountName: "Rent expense", displayName: "Rent expense", statementSection: "expense", currentNonCurrent: "not_applicable", cashFlowCategory: "operating", taxTreatment: "ordinary_deductible", taxTreatmentReason: "Ordinary business expense, subject to business purpose and evidence.", noteNumber: 5, sortOrder: 560 },
  { accountCode: "5700", accountName: "Payroll", displayName: "Payroll", statementSection: "expense", currentNonCurrent: "not_applicable", cashFlowCategory: "operating", taxTreatment: "ordinary_deductible", taxTreatmentReason: "Ordinary business expense, subject to business purpose and evidence.", noteNumber: 5, sortOrder: 570 },
  { accountCode: "5800", accountName: "Bank charges", displayName: "Bank charges", statementSection: "expense", currentNonCurrent: "not_applicable", cashFlowCategory: "operating", taxTreatment: "ordinary_deductible", taxTreatmentReason: "Ordinary business expense, subject to business purpose and evidence.", noteNumber: 5, sortOrder: 580 },
  { accountCode: "5900", accountName: "General expenses", displayName: "General expenses", statementSection: "expense", currentNonCurrent: "not_applicable", cashFlowCategory: "operating", taxTreatment: "review_required", taxTreatmentReason: "Purpose is not specific enough to determine deductibility.", noteNumber: 5, sortOrder: 590 },
  { accountCode: "5910", accountName: "Fines & penalties", displayName: "Fines & penalties", statementSection: "expense", currentNonCurrent: "not_applicable", cashFlowCategory: "operating", taxTreatment: "fully_non_deductible", taxTreatmentReason: "Mapped as non-deductible fines, penalties, or unlawful payments.", noteNumber: 5, sortOrder: 591 },
  { accountCode: "5920", accountName: "Distributions & dividends", displayName: "Distributions & dividends", statementSection: "equity", currentNonCurrent: "not_applicable", cashFlowCategory: "financing", taxTreatment: "fully_non_deductible", taxTreatmentReason: "Owner distributions and dividends are not ordinary business expenses.", noteNumber: 1, sortOrder: 592 },
  { accountCode: "5930", accountName: "Corporate Tax expense", displayName: "Corporate Tax expense", statementSection: "expense", currentNonCurrent: "not_applicable", cashFlowCategory: "operating", taxTreatment: "fully_non_deductible", taxTreatmentReason: "UAE Corporate Tax expense is mapped as non-deductible for this estimate.", noteNumber: 7, sortOrder: 593 },
  { accountCode: "5940", accountName: "Donations & grants", displayName: "Donations & grants", statementSection: "expense", currentNonCurrent: "not_applicable", cashFlowCategory: "operating", taxTreatment: "review_required", taxTreatmentReason: "Qualifying public-benefit-entity donations may differ; accountant review is required.", noteNumber: 5, sortOrder: 594 },
  { accountCode: "5950", accountName: "Mixed or unsupported purpose", displayName: "Mixed or unsupported purpose", statementSection: "expense", currentNonCurrent: "not_applicable", cashFlowCategory: "operating", taxTreatment: "review_required", taxTreatmentReason: "Business purpose, evidence, or apportionment is uncertain.", noteNumber: 5, sortOrder: 595 },
];

function historicalAccountCode(accountName: string) {
  let hash = 2166136261;
  for (const character of accountName) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `LEGACY-${(hash >>> 0).toString(36).toUpperCase()}`;
}

function historicalAccountDefaults(accountName: string, debitNames: Set<string>, creditNames: Set<string>) {
  const normalized = accountName.toLowerCase();
  const legacyCombined = accountName === "Travel & entertainment";
  const revenueLike = /revenue|sales|income|retainer/.test(normalized)
    || (creditNames.has(accountName) && !debitNames.has(accountName));
  const assetLike = /bank|cash|receivable|inventory|prepaid|asset|equipment|property|transfer/.test(normalized);
  const liabilityLike = /payable|loan|liability|accrual|deferred revenue/.test(normalized);
  const equityLike = /equity|capital|retained earnings|distribution|dividend|reserve/.test(normalized);
  const statementSection = assetLike ? "asset"
    : liabilityLike ? "liability"
      : equityLike ? "equity"
        : revenueLike ? "revenue"
          : "expense";
  return {
    accountCode: historicalAccountCode(accountName),
    accountName,
    displayName: accountName,
    statementSection,
    currentNonCurrent: assetLike || liabilityLike ? "current" : "not_applicable",
    cashFlowCategory: equityLike || liabilityLike ? "financing" : "operating",
    oci: "no",
    relatedPartyCategory: "none",
    taxCategory: "review_required",
    taxTreatment: "review_required" as const,
    taxTreatmentReason: legacyCombined
      ? "Legacy combined travel and entertainment balance. Review and apportion without rewriting posted history."
      : "Historical account migrated without an accountant-confirmed UAE Corporate Tax treatment.",
    isActive: !legacyCombined,
    isSystem: false,
    sortOrder: 9000,
    noteNumber: revenueLike ? 4 : statementSection === "expense" ? 5 : 1,
  };
}

export async function ensureClientChart(clientId: number) {
  await db.insert(accountClassificationsTable).values(defaultClientChart.map((account) => ({
    clientId,
    ...account,
    oci: account.statementSection === "oci" ? "yes" : "no",
    relatedPartyCategory: "none",
    taxCategory: account.taxTreatment,
    isActive: true,
    isSystem: true,
  }))).onConflictDoNothing({
    target: [accountClassificationsTable.clientId, accountClassificationsTable.accountName],
  });

  const [historicalLines, historicalEntries, seededAccounts] = await Promise.all([
    db.select({ accountName: statementLinesTable.accountSuggestion }).from(statementLinesTable)
      .where(eq(statementLinesTable.clientId, clientId)),
    db.select({
      debitAccount: journalEntriesTable.debitAccount,
      creditAccount: journalEntriesTable.creditAccount,
      lines: journalEntriesTable.lines,
    }).from(journalEntriesTable).where(eq(journalEntriesTable.clientId, clientId)),
    db.select({ accountName: accountClassificationsTable.accountName }).from(accountClassificationsTable)
      .where(eq(accountClassificationsTable.clientId, clientId)),
  ]);
  const debitNames = new Set(historicalEntries.map((entry) => entry.debitAccount).filter(Boolean));
  const creditNames = new Set(historicalEntries.map((entry) => entry.creditAccount).filter(Boolean));
  const existingNames = new Set(seededAccounts.map((account) => account.accountName));
  const historicalNames = new Set([
    ...historicalLines.map((line) => line.accountName).filter((name): name is string => Boolean(name)),
    ...debitNames,
    ...creditNames,
    ...historicalEntries.flatMap((entry) => entry.lines?.map((line) => line.account) ?? []),
  ]);
  const missingHistoricalNames = [...historicalNames].filter((name) => !existingNames.has(name));
  if (missingHistoricalNames.length) {
    await db.insert(accountClassificationsTable).values(missingHistoricalNames.map((accountName) => ({
      clientId,
      ...historicalAccountDefaults(accountName, debitNames, creditNames),
    }))).onConflictDoNothing({
      target: [accountClassificationsTable.clientId, accountClassificationsTable.accountName],
    });
  }

  const accounts = await db.select().from(accountClassificationsTable)
    .where(eq(accountClassificationsTable.clientId, clientId));
  for (const account of accounts) {
    const isLegacyCombined = account.accountName === "Travel & entertainment";
    const changes: Partial<typeof accountClassificationsTable.$inferInsert> = {};
    if (!account.accountCode) changes.accountCode = isLegacyCombined ? `LEGACY-TE-${account.id}` : `LEGACY-${account.id}`;
    if (isLegacyCombined) {
      changes.taxTreatment = "review_required";
      changes.taxTreatmentReason = "Legacy combined travel and entertainment balance. Review and apportion without rewriting posted history.";
      changes.taxCategory = "review_required";
      changes.isSystem = false;
    }
    if (Object.keys(changes).length) {
      await db.update(accountClassificationsTable).set(changes)
        .where(eq(accountClassificationsTable.id, account.id));
    }
  }

  const refreshed = await db.select().from(accountClassificationsTable)
    .where(eq(accountClassificationsTable.clientId, clientId));
  for (const account of refreshed) {
    await db.update(statementLinesTable)
      .set({ accountClassificationId: account.id })
      .where(and(
        eq(statementLinesTable.clientId, clientId),
        eq(statementLinesTable.accountSuggestion, account.accountName),
        isNull(statementLinesTable.accountClassificationId),
      ));
    await db.update(journalEntriesTable)
      .set({ debitAccountClassificationId: account.id })
      .where(and(
        eq(journalEntriesTable.clientId, clientId),
        eq(journalEntriesTable.debitAccount, account.accountName),
        isNull(journalEntriesTable.debitAccountClassificationId),
      ));
    await db.update(journalEntriesTable)
      .set({ creditAccountClassificationId: account.id })
      .where(and(
        eq(journalEntriesTable.clientId, clientId),
        eq(journalEntriesTable.creditAccount, account.accountName),
        isNull(journalEntriesTable.creditAccountClassificationId),
      ));
  }
  return refreshed;
}

export function calculateUaeCorporateTaxSummary(
  entries: JournalEntry[],
  accounts: AccountClassification[],
  period: string,
  functionalCurrency: string,
) {
  const matchedYear = period.match(/\b(20\d{2})\b/)?.[1];
  const periodEnd = /^\d{4}$/.test(period) ? `${period}-12-31`
    : /^\d{4}-\d{2}$/.test(period) ? `${period}-31`
      : /^\d{4}-\d{2}-\d{2}$/.test(period) ? period
        : matchedYear ? `${matchedYear}-12-31` : period;
  const year = Number(matchedYear ?? periodEnd.slice(0, 4));
  const periodStart = Number.isFinite(year) ? `${year}-01-01` : "0000-01-01";
  const included = entries.filter((entry) =>
    entry.status === "posted" && entry.date >= periodStart && entry.date <= periodEnd,
  );
  const byName = new Map(accounts.map((account) => [account.accountName, account]));
  const expenseTotals = new Map<string, number>();
  let revenue = 0;
  let expenses = 0;
  let unmappedAmount = 0;
  for (const entry of included) {
    const amount = Number(entry.functionalAmount ?? entry.amount);
    const rawLines: Array<{ account: string; debit: number; credit: number }> = Array.isArray(entry.lines) && entry.lines.length >= 2 ? entry.lines : [
      { account: entry.debitAccount, debit: Number(entry.amount), credit: 0 },
      { account: entry.creditAccount, debit: 0, credit: Number(entry.amount) },
    ];
    const sourceTotal = rawLines.reduce((sum, line) => sum + Number(line.debit), 0);
    const factor = sourceTotal > 0 ? amount / sourceTotal : 1;
    for (const line of rawLines) {
      const debitAmount = Number(line.debit) * factor;
      const creditAmount = Number(line.credit) * factor;
      const account = byName.get(String(line.account));
      if (account?.statementSection === "expense") {
        expenses += debitAmount - creditAmount;
        expenseTotals.set(account.accountName, (expenseTotals.get(account.accountName) ?? 0) + debitAmount - creditAmount);
      } else if (account?.statementSection === "revenue") {
        revenue += creditAmount - debitAmount;
      } else if (!account && String(line.account) !== "Bank / cash") {
        unmappedAmount += debitAmount + creditAmount;
      }
    }
  }

  const adjustments = [...expenseTotals.entries()].map(([accountName, accountingCost]) => {
    const account = byName.get(accountName)!;
    const treatment = account.taxTreatment as UaeTaxTreatment;
    const permittedDeduction = treatment === "entertainment_limited" ? accountingCost * 0.5
      : treatment === "ordinary_deductible" ? accountingCost : 0;
    const addBack = treatment === "entertainment_limited" ? accountingCost * 0.5
      : treatment === "fully_non_deductible" ? accountingCost : 0;
    const reviewAmount = treatment === "review_required" ? accountingCost : 0;
    return { label: account.displayName, treatment, accountingCost, permittedDeduction, addBack, reviewAmount };
  });
  const mappedDeductibleExpenses = adjustments.reduce((sum, item) => sum + item.permittedDeduction, 0);
  const entertainmentAccountingCost = adjustments.filter((item) => item.treatment === "entertainment_limited")
    .reduce((sum, item) => sum + item.accountingCost, 0);
  const entertainmentPermittedDeduction = entertainmentAccountingCost * 0.5;
  const entertainmentAddBack = entertainmentAccountingCost * 0.5;
  const addBacks = adjustments.reduce((sum, item) => sum + item.addBack, 0);
  const reviewRequiredAmount = adjustments.reduce((sum, item) => sum + item.reviewAmount, 0);
  const accountingProfitBeforeTax = revenue - expenses;
  const estimatedTaxableIncome = Math.max(0, accountingProfitBeforeTax + addBacks);
  const thresholdAed = 375000;
  const rate = 0.09;
  const post2023Period = year >= 2024;
  const standardEstimatedLiability = post2023Period && functionalCurrency === "AED"
    ? Math.max(0, estimatedTaxableIncome - thresholdAed) * rate
    : 0;

  return {
    jurisdiction: "UAE" as const,
    estimateLabel: "Estimated standard UAE Corporate Tax calculation — accountant review required",
    period,
    functionalCurrency,
    accountingProfitBeforeTax,
    mappedDeductibleExpenses,
    entertainmentAccountingCost,
    entertainmentPermittedDeduction,
    entertainmentAddBack,
    addBacks,
    otherAdjustments: 0,
    estimatedTaxableIncome,
    thresholdAed,
    rate,
    standardEstimatedLiability,
    reviewRequiredAmount,
    unmappedAmount,
    post2023Period,
    assumptions: [
      "Only posted entries with complete functional-currency reporting evidence are included.",
      "Business travel is deductible only when mapped as wholly and exclusively business-purpose travel and supported by evidence.",
      "Customer and supplier entertainment uses the standard 50% deduction limitation.",
      "This is an estimate for decision support, not a tax return, filing, legal conclusion, or final liability notice.",
    ],
    excludedReliefs: [
      "Free Zone qualifying-income rules",
      "Small Business Relief",
      "tax groups",
      "transfer pricing",
      "participation exemptions",
      "interest-limitation calculations",
      "withholding tax",
      "VAT treatment",
    ],
    adjustments,
  };
}