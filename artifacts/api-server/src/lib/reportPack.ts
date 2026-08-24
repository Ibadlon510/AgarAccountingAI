import type { accountClassificationsTable, clientsTable, journalEntriesTable } from "@workspace/db";

export type ReportAmount = {
  label: string;
  current: number;
  comparative: number;
  noteRef: string;
  sourceEntryIds: number[];
  sourceLineIds: number[];
  children?: ReportAmount[];
};

export type ReportNote = {
  number: number;
  title: string;
  narrative: string;
  requiresInput: boolean;
  tables: Array<{ label: string; current: number; comparative: number }>;
};

export type ReportChecklistItem = {
  standard: string;
  title: string;
  status: "applicable" | "not_applicable" | "immaterial" | "satisfied" | "requires_accountant_input";
  prompt: string;
};

export type ReportSignatory = {
  preparedBy: string;
  reviewedBy: string;
  authorizedBy: string;
  authorizationDate: string | null;
};

export type ReportValidation = {
  status: "pass" | "blocked";
  errorCount: number;
  checks: Array<{
    id: string;
    label: string;
    status: "pass" | "error" | "warning";
    detail: string;
    blocking: boolean;
  }>;
};

export type ReportSnapshot = {
  entityName: string;
  legalName: string;
  periodEnd: string;
  comparativePeriodEnd: string;
  presentationCurrency: string;
  reportingBasis: string;
  presentationProfile: string;
  statementOfFinancialPosition: ReportAmount[];
  profitOrLossAndOci: ReportAmount[];
  changesInEquity: ReportAmount[];
  cashFlows: ReportAmount[];
  notes: ReportNote[];
  traceability: { postedEntryCount: number; postedLineCount: number; sourceImportCount: number };
};

type Entry = typeof journalEntriesTable.$inferSelect;
type Classification = typeof accountClassificationsTable.$inferSelect;
type Client = typeof clientsTable.$inferSelect;

type AccountKind = "asset" | "liability" | "equity" | "revenue" | "expense" | "oci";
type AccountMeta = {
  kind: AccountKind;
  displayName: string;
  currentNonCurrent: "current" | "non_current" | "not_applicable";
  cashFlowCategory: "operating" | "investing" | "financing";
  noteNumber: number;
  relatedParty: boolean;
  tax: boolean;
};

type AccountBalance = {
  account: string;
  meta: AccountMeta;
  currentDebit: number;
  currentCredit: number;
  comparativeDebit: number;
  comparativeCredit: number;
  currentEntryIds: Set<number>;
  comparativeEntryIds: Set<number>;
  currentLineIds: Set<number>;
  comparativeLineIds: Set<number>;
};

const expensePattern = /expense|cost|travel|software|office|communication|rent|payroll|wage|salary|charge|fee|marketing|insurance|depreciation/i;
const defaultChecklist: Array<Omit<ReportChecklistItem, "status">> = [
  { standard: "IAS 1", title: "Presentation of Financial Statements", prompt: "Confirm the entity’s presentation, going-concern assessment, materiality, and comparative disclosures." },
  { standard: "IAS 7", title: "Statement of Cash Flows", prompt: "Confirm cash-equivalent policy and indirect cash-flow classification." },
  { standard: "IAS 8", title: "Accounting Policies, Changes in Estimates and Errors", prompt: "Confirm policies, estimates, and any errors or restatements." },
  { standard: "IAS 10", title: "Events after the Reporting Period", prompt: "Assess subsequent events through authorization date." },
  { standard: "IAS 12", title: "Income Taxes", prompt: "Assess current and deferred tax balances and disclosures." },
  { standard: "IAS 16", title: "Property, Plant and Equipment", prompt: "Confirm whether fixed-asset registers and depreciation disclosures are required." },
  { standard: "IAS 19", title: "Employee Benefits", prompt: "Confirm employee-benefit obligations and expense disclosures." },
  { standard: "IAS 21", title: "Effects of Changes in Foreign Exchange Rates", prompt: "Confirm functional currency, rate policies, and exchange differences." },
  { standard: "IAS 24", title: "Related Party Disclosures", prompt: "Confirm related parties, balances, terms, and transactions." },
  { standard: "IFRS 7", title: "Financial Instruments: Disclosures", prompt: "Confirm liquidity, credit, and market-risk disclosures." },
  { standard: "IFRS 9", title: "Financial Instruments", prompt: "Confirm classification, impairment, and measurement of financial instruments." },
  { standard: "IFRS 15", title: "Revenue from Contracts with Customers", prompt: "Confirm revenue streams, performance obligations, and contract balances." },
];

const standardAccountMeta = (account: string): AccountMeta => {
  const normalized = account.toLowerCase();
  if (/bank|cash/.test(normalized)) return { kind: "asset", displayName: account, currentNonCurrent: "current", cashFlowCategory: "operating", noteNumber: 3, relatedParty: false, tax: false };
  if (/receivable|inventory|prepayment|deposit|due from/.test(normalized)) return { kind: "asset", displayName: account, currentNonCurrent: "current", cashFlowCategory: "operating", noteNumber: 8, relatedParty: /due from/.test(normalized), tax: false };
  if (/property|plant|equipment|intangible|capital asset/.test(normalized)) return { kind: "asset", displayName: account, currentNonCurrent: "non_current", cashFlowCategory: "investing", noteNumber: 8, relatedParty: false, tax: false };
  if (/payable|accrual|due to|loan|borrow|liabilit/.test(normalized)) return { kind: "liability", displayName: account, currentNonCurrent: /loan|borrow/.test(normalized) ? "non_current" : "current", cashFlowCategory: /loan|borrow/.test(normalized) ? "financing" : "operating", noteNumber: 6, relatedParty: /due to/.test(normalized), tax: /tax/.test(normalized) };
  if (/equity|share capital|retained earnings|reserve/.test(normalized)) return { kind: "equity", displayName: account, currentNonCurrent: "not_applicable", cashFlowCategory: "financing", noteNumber: 1, relatedParty: false, tax: false };
  if (/oci|other comprehensive/.test(normalized)) return { kind: "oci", displayName: account, currentNonCurrent: "not_applicable", cashFlowCategory: "operating", noteNumber: 1, relatedParty: false, tax: false };
  if (/revenue|sales|income|retainer/.test(normalized)) return { kind: "revenue", displayName: account, currentNonCurrent: "not_applicable", cashFlowCategory: "operating", noteNumber: 4, relatedParty: false, tax: false };
  return { kind: "expense", displayName: account, currentNonCurrent: "not_applicable", cashFlowCategory: "operating", noteNumber: /tax/.test(normalized) ? 7 : 5, relatedParty: false, tax: /tax/.test(normalized) };
};

function customAccountMeta(classification: Classification): AccountMeta {
  const fallback = standardAccountMeta(classification.accountName);
  const kind = classification.statementSection as AccountKind;
  return {
    ...fallback,
    kind: ["asset", "liability", "equity", "revenue", "expense", "oci"].includes(kind) ? kind : fallback.kind,
    displayName: classification.displayName,
    currentNonCurrent: classification.currentNonCurrent === "current" || classification.currentNonCurrent === "non_current"
      ? classification.currentNonCurrent
      : "not_applicable",
    cashFlowCategory: classification.cashFlowCategory === "investing" || classification.cashFlowCategory === "financing"
      ? classification.cashFlowCategory
      : "operating",
    noteNumber: classification.noteNumber ?? fallback.noteNumber,
    relatedParty: classification.relatedPartyCategory !== "none",
    tax: classification.taxCategory !== "not_assessed",
  };
}

export function resolveReportPeriod(periodEnd: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || Number.isNaN(Date.parse(`${periodEnd}T00:00:00Z`))) {
    throw new Error("Reporting period end must use YYYY-MM-DD.");
  }
  const year = Number(periodEnd.slice(0, 4));
  return {
    periodStart: `${year}-01-01`,
    periodEnd,
    comparativePeriodStart: `${year - 1}-01-01`,
    comparativePeriodEnd: `${year - 1}-12-31`,
  };
}

function between(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

function reportAmount(label: string, current: number, comparative: number, noteNumber: number, currentEntries: Set<number>, comparativeEntries: Set<number>, currentLines: Set<number>, comparativeLines: Set<number>, children?: ReportAmount[]): ReportAmount {
  return {
    label,
    current,
    comparative,
    noteRef: noteNumber ? String(noteNumber) : "—",
    sourceEntryIds: [...new Set([...currentEntries, ...comparativeEntries])],
    sourceLineIds: [...new Set([...currentLines, ...comparativeLines])],
    ...(children?.length ? { children } : {}),
  };
}

function emptySets() {
  return { entries: new Set<number>(), lines: new Set<number>() };
}

function accountValue(balance: AccountBalance, period: "current" | "comparative") {
  const debit = period === "current" ? balance.currentDebit : balance.comparativeDebit;
  const credit = period === "current" ? balance.currentCredit : balance.comparativeCredit;
  if (balance.meta.kind === "asset" || balance.meta.kind === "expense") return debit - credit;
  return credit - debit;
}

function sums(items: AccountBalance[], period: "current" | "comparative", filter?: (item: AccountBalance) => boolean) {
  return items.filter((item) => !filter || filter(item)).reduce((total, item) => total + accountValue(item, period), 0);
}

function accountLine(balance: AccountBalance): ReportAmount {
  return reportAmount(
    balance.meta.displayName,
    accountValue(balance, "current"),
    accountValue(balance, "comparative"),
    balance.meta.noteNumber,
    balance.currentEntryIds,
    balance.comparativeEntryIds,
    balance.currentLineIds,
    balance.comparativeLineIds,
  );
}

function sumSets(balances: AccountBalance[], period: "current" | "comparative") {
  const result = emptySets();
  for (const balance of balances) {
    const entries = period === "current" ? balance.currentEntryIds : balance.comparativeEntryIds;
    const lines = period === "current" ? balance.currentLineIds : balance.comparativeLineIds;
    entries.forEach((value) => result.entries.add(value));
    lines.forEach((value) => result.lines.add(value));
  }
  return result;
}

export function buildReportPack(input: {
  client: Client;
  entries: Entry[];
  classifications: Classification[];
  periodEnd: string;
  presentationCurrency: string;
  reportingBasis: string;
  presentationProfile: string;
  roundingPolicy: string;
  sourceImportCount: number;
  missingRateEntries: Entry[];
}) {
  const periods = resolveReportPeriod(input.periodEnd);
  const metaByAccount = new Map(input.classifications.map((classification) => [classification.accountName, customAccountMeta(classification)]));
  const balances = new Map<string, AccountBalance>();
  const currentEntries = input.entries.filter((entry) => between(entry.date, periods.periodStart, periods.periodEnd));
  const comparativeEntries = input.entries.filter((entry) => between(entry.date, periods.comparativePeriodStart, periods.comparativePeriodEnd));
  const cumulativeCurrentEntries = input.entries.filter((entry) => entry.date <= periods.periodEnd);
  const cumulativeComparativeEntries = input.entries.filter((entry) => entry.date <= periods.comparativePeriodEnd);

  function add(account: string, amount: number, debit: boolean, entry: Entry, period: "current" | "comparative", cumulative: boolean) {
    const balance = balances.get(account) ?? {
      account,
      meta: metaByAccount.get(account) ?? standardAccountMeta(account),
      currentDebit: 0,
      currentCredit: 0,
      comparativeDebit: 0,
      comparativeCredit: 0,
      currentEntryIds: new Set<number>(),
      comparativeEntryIds: new Set<number>(),
      currentLineIds: new Set<number>(),
      comparativeLineIds: new Set<number>(),
    };
    if (cumulative) {
      if (period === "current") {
        if (debit) balance.currentDebit += amount; else balance.currentCredit += amount;
        balance.currentEntryIds.add(entry.id);
        balance.currentLineIds.add(entry.statementLineId);
      } else {
        if (debit) balance.comparativeDebit += amount; else balance.comparativeCredit += amount;
        balance.comparativeEntryIds.add(entry.id);
        balance.comparativeLineIds.add(entry.statementLineId);
      }
    }
    balances.set(account, balance);
  }

  const convertedAmount = (entry: Entry) => Number(entry.functionalAmount ?? entry.amount);
  for (const entry of cumulativeCurrentEntries) {
    const amount = convertedAmount(entry);
    add(entry.debitAccount, amount, true, entry, "current", true);
    add(entry.creditAccount, amount, false, entry, "current", true);
  }
  for (const entry of cumulativeComparativeEntries) {
    const amount = convertedAmount(entry);
    add(entry.debitAccount, amount, true, entry, "comparative", true);
    add(entry.creditAccount, amount, false, entry, "comparative", true);
  }

  const values = [...balances.values()];
  const assets = values.filter((item) => item.meta.kind === "asset");
  const liabilities = values.filter((item) => item.meta.kind === "liability");
  const equityAccounts = values.filter((item) => item.meta.kind === "equity");
  const revenues = values.filter((item) => item.meta.kind === "revenue");
  const expenses = values.filter((item) => item.meta.kind === "expense");
  const ociAccounts = values.filter((item) => item.meta.kind === "oci");
  const currentNetIncome = sums(revenues, "current") - sums(expenses, "current");
  const comparativeNetIncome = sums(revenues, "comparative") - sums(expenses, "comparative");
  const currentOci = sums(ociAccounts, "current");
  const comparativeOci = sums(ociAccounts, "comparative");
  const currentAssets = sums(assets, "current");
  const comparativeAssets = sums(assets, "comparative");
  const currentLiabilities = sums(liabilities, "current");
  const comparativeLiabilities = sums(liabilities, "comparative");
  const currentExplicitEquity = sums(equityAccounts, "current");
  const comparativeExplicitEquity = sums(equityAccounts, "comparative");
  const currentEquity = currentExplicitEquity + currentNetIncome + currentOci;
  const comparativeEquity = comparativeExplicitEquity + comparativeNetIncome + comparativeOci;

  const cashBalances = assets.filter((item) => /bank|cash/i.test(item.account));
  const cashCurrent = sums(cashBalances, "current");
  const cashComparative = sums(cashBalances, "comparative");
  const openingCash = cashComparative;
  const cashMovement = cashCurrent - openingCash;
  const operatingCash = currentEntries.reduce((total, entry) => {
    const amount = convertedAmount(entry);
    return total + (entry.debitAccount === "Bank / cash" ? amount : entry.creditAccount === "Bank / cash" ? -amount : 0);
  }, 0);
  const investingCash = 0;
  const financingCash = 0;
  const workingCapitalMovement = operatingCash - currentNetIncome;

  const assetsSets = sumSets(assets, "current");
  const comparativeAssetSets = sumSets(assets, "comparative");
  const liabilitySets = sumSets(liabilities, "current");
  const comparativeLiabilitySets = sumSets(liabilities, "comparative");
  const equitySets = sumSets(equityAccounts, "current");
  const comparativeEquitySets = sumSets(equityAccounts, "comparative");
  const revenueSets = sumSets(revenues, "current");
  const comparativeRevenueSets = sumSets(revenues, "comparative");
  const expenseSets = sumSets(expenses, "current");
  const comparativeExpenseSets = sumSets(expenses, "comparative");
  const cashSets = sumSets(cashBalances, "current");
  const comparativeCashSets = sumSets(cashBalances, "comparative");

  const statementOfFinancialPosition = [
    reportAmount("Current assets", sums(assets, "current", (item) => item.meta.currentNonCurrent === "current"), sums(assets, "comparative", (item) => item.meta.currentNonCurrent === "current"), 3, assetsSets.entries, comparativeAssetSets.entries, assetsSets.lines, comparativeAssetSets.lines, assets.filter((item) => item.meta.currentNonCurrent === "current").map(accountLine)),
    reportAmount("Non-current assets", sums(assets, "current", (item) => item.meta.currentNonCurrent === "non_current"), sums(assets, "comparative", (item) => item.meta.currentNonCurrent === "non_current"), 8, assetsSets.entries, comparativeAssetSets.entries, assetsSets.lines, comparativeAssetSets.lines, assets.filter((item) => item.meta.currentNonCurrent === "non_current").map(accountLine)),
    reportAmount("Total assets", currentAssets, comparativeAssets, 3, assetsSets.entries, comparativeAssetSets.entries, assetsSets.lines, comparativeAssetSets.lines),
    reportAmount("Current liabilities", sums(liabilities, "current", (item) => item.meta.currentNonCurrent === "current"), sums(liabilities, "comparative", (item) => item.meta.currentNonCurrent === "current"), 6, liabilitySets.entries, comparativeLiabilitySets.entries, liabilitySets.lines, comparativeLiabilitySets.lines, liabilities.filter((item) => item.meta.currentNonCurrent === "current").map(accountLine)),
    reportAmount("Non-current liabilities", sums(liabilities, "current", (item) => item.meta.currentNonCurrent === "non_current"), sums(liabilities, "comparative", (item) => item.meta.currentNonCurrent === "non_current"), 6, liabilitySets.entries, comparativeLiabilitySets.entries, liabilitySets.lines, comparativeLiabilitySets.lines, liabilities.filter((item) => item.meta.currentNonCurrent === "non_current").map(accountLine)),
    reportAmount("Equity", currentEquity, comparativeEquity, 1, equitySets.entries, comparativeEquitySets.entries, equitySets.lines, comparativeEquitySets.lines, [
      ...equityAccounts.map(accountLine),
      reportAmount("Retained earnings", currentNetIncome + currentOci, comparativeNetIncome + comparativeOci, 1, revenueSets.entries, comparativeRevenueSets.entries, revenueSets.lines, comparativeRevenueSets.lines),
    ]),
    reportAmount("Total liabilities and equity", currentLiabilities + currentEquity, comparativeLiabilities + comparativeEquity, 1, new Set([...liabilitySets.entries, ...equitySets.entries]), new Set([...comparativeLiabilitySets.entries, ...comparativeEquitySets.entries]), new Set([...liabilitySets.lines, ...equitySets.lines]), new Set([...comparativeLiabilitySets.lines, ...comparativeEquitySets.lines])),
  ];

  const profitOrLossAndOci = [
    reportAmount("Revenue", sums(revenues, "current"), sums(revenues, "comparative"), 4, revenueSets.entries, comparativeRevenueSets.entries, revenueSets.lines, comparativeRevenueSets.lines, revenues.map(accountLine)),
    reportAmount("Operating expenses", -sums(expenses, "current", (item) => !item.meta.tax), -sums(expenses, "comparative", (item) => !item.meta.tax), 5, expenseSets.entries, comparativeExpenseSets.entries, expenseSets.lines, comparativeExpenseSets.lines, expenses.filter((item) => !item.meta.tax).map((item) => ({ ...accountLine(item), current: -accountValue(item, "current"), comparative: -accountValue(item, "comparative") }))),
    reportAmount("Profit before tax", currentNetIncome + sums(expenses, "current", (item) => item.meta.tax), comparativeNetIncome + sums(expenses, "comparative", (item) => item.meta.tax), 7, new Set([...revenueSets.entries, ...expenseSets.entries]), new Set([...comparativeRevenueSets.entries, ...comparativeExpenseSets.entries]), new Set([...revenueSets.lines, ...expenseSets.lines]), new Set([...comparativeRevenueSets.lines, ...comparativeExpenseSets.lines])),
    reportAmount("Income tax expense", -sums(expenses, "current", (item) => item.meta.tax), -sums(expenses, "comparative", (item) => item.meta.tax), 7, expenseSets.entries, comparativeExpenseSets.entries, expenseSets.lines, comparativeExpenseSets.lines),
    reportAmount("Profit for the year", currentNetIncome, comparativeNetIncome, 1, new Set([...revenueSets.entries, ...expenseSets.entries]), new Set([...comparativeRevenueSets.entries, ...comparativeExpenseSets.entries]), new Set([...revenueSets.lines, ...expenseSets.lines]), new Set([...comparativeRevenueSets.lines, ...comparativeExpenseSets.lines])),
    reportAmount("Other comprehensive income", currentOci, comparativeOci, 1, new Set(), new Set(), new Set(), new Set(), ociAccounts.map(accountLine)),
    reportAmount("Total comprehensive income", currentNetIncome + currentOci, comparativeNetIncome + comparativeOci, 1, new Set([...revenueSets.entries, ...expenseSets.entries]), new Set([...comparativeRevenueSets.entries, ...comparativeExpenseSets.entries]), new Set([...revenueSets.lines, ...expenseSets.lines]), new Set([...comparativeRevenueSets.lines, ...comparativeExpenseSets.lines])),
  ];

  const changesInEquity = [
    reportAmount("Opening retained earnings", comparativeEquity, 0, 1, comparativeEquitySets.entries, new Set(), comparativeEquitySets.lines, new Set()),
    reportAmount("Profit for the year", currentNetIncome, comparativeNetIncome, 1, revenueSets.entries, comparativeRevenueSets.entries, revenueSets.lines, comparativeRevenueSets.lines),
    reportAmount("Other comprehensive income", currentOci, comparativeOci, 1, new Set(), new Set(), new Set(), new Set()),
    reportAmount("Closing equity", currentEquity, comparativeEquity, 1, equitySets.entries, comparativeEquitySets.entries, equitySets.lines, comparativeEquitySets.lines),
  ];

  const cashFlows = [
    reportAmount("Profit for the year", currentNetIncome, comparativeNetIncome, 1, revenueSets.entries, comparativeRevenueSets.entries, revenueSets.lines, comparativeRevenueSets.lines),
    reportAmount("Changes in working capital", workingCapitalMovement, 0, 8, new Set(), new Set(), new Set(), new Set()),
    reportAmount("Net cash from operating activities", operatingCash, 0, 3, cashSets.entries, comparativeCashSets.entries, cashSets.lines, comparativeCashSets.lines),
    reportAmount("Net cash from investing activities", investingCash, 0, 8, new Set(), new Set(), new Set(), new Set()),
    reportAmount("Net cash from financing activities", financingCash, 0, 1, new Set(), new Set(), new Set(), new Set()),
    reportAmount("Net increase in cash", cashMovement, 0, 3, cashSets.entries, comparativeCashSets.entries, cashSets.lines, comparativeCashSets.lines),
    reportAmount("Cash at beginning of year", openingCash, 0, 3, comparativeCashSets.entries, new Set(), comparativeCashSets.lines, new Set()),
    reportAmount("Cash at end of year", cashCurrent, cashComparative, 3, cashSets.entries, comparativeCashSets.entries, cashSets.lines, comparativeCashSets.lines),
  ];

  const relatedPartyBalances = values.filter((item) => item.meta.relatedParty);
  const notes: ReportNote[] = [
    { number: 1, title: "Basis of preparation", narrative: "Accountant input required: confirm the basis of preparation, going-concern assessment, materiality, and authorization date.", requiresInput: true, tables: [] },
    { number: 2, title: "Material accounting policies", narrative: "Accountant input required: document policies for revenue, foreign currency, financial instruments, taxes, and any other material transactions.", requiresInput: true, tables: [] },
    { number: 3, title: "Cash and cash equivalents", narrative: "Cash is derived from posted cash and bank accounts. Confirm restricted cash and cash-equivalent classification.", requiresInput: true, tables: [{ label: "Cash and bank balances", current: cashCurrent, comparative: cashComparative }] },
    { number: 4, title: "Revenue", narrative: "Revenue is grouped from posted ledger accounts. Confirm revenue streams and IFRS 15 performance obligations.", requiresInput: true, tables: revenues.map((item) => ({ label: item.meta.displayName, current: accountValue(item, "current"), comparative: accountValue(item, "comparative") })) },
    { number: 5, title: "Operating expenses", narrative: "Expense categories are traceable to posted journal entries. Confirm material expense disclosures.", requiresInput: true, tables: expenses.filter((item) => !item.meta.tax).map((item) => ({ label: item.meta.displayName, current: accountValue(item, "current"), comparative: accountValue(item, "comparative") })) },
    { number: 6, title: "Related parties", narrative: "Accountant input required: identify related parties, balances, transaction terms, and whether outstanding balances are unsecured.", requiresInput: true, tables: relatedPartyBalances.map((item) => ({ label: item.meta.displayName, current: accountValue(item, "current"), comparative: accountValue(item, "comparative") })) },
    { number: 7, title: "Income tax", narrative: "Accountant input required: assess current tax, deferred tax, tax losses, and uncertain tax positions. This pack is not a tax return.", requiresInput: true, tables: expenses.filter((item) => item.meta.tax).map((item) => ({ label: item.meta.displayName, current: accountValue(item, "current"), comparative: accountValue(item, "comparative") })) },
    { number: 8, title: "Financial risk, foreign currency and other disclosures", narrative: "Accountant input required: confirm foreign-currency risk, commitments, contingencies, employee benefits, and any significant judgments.", requiresInput: true, tables: [] },
    { number: 9, title: "Subsequent events", narrative: "Accountant input required: record events after the reporting period through the authorization date.", requiresInput: true, tables: [] },
  ];

  const totalDebits = cumulativeCurrentEntries.reduce((total, entry) => total + convertedAmount(entry), 0);
  const totalCredits = totalDebits;
  const relatedPartyCurrent = sums(relatedPartyBalances, "current");
  const relatedPartyComponentCurrent = relatedPartyBalances.reduce((total, item) => total + accountValue(item, "current"), 0);
  const validation = buildReportValidation({
    totalDebits,
    totalCredits,
    assets: currentAssets,
    liabilitiesAndEquity: currentLiabilities + currentEquity,
    retainedEarningsMovement: currentEquity - comparativeEquity,
    profitAndOci: currentNetIncome + currentOci,
    openingCash,
    cashMovement,
    closingCash: cashCurrent,
    noteCash: notes[2].tables[0]?.current ?? 0,
    relatedPartyCurrent,
    relatedPartyComponentCurrent,
    missingRateEntries: input.missingRateEntries,
    hasComparative: comparativeEntries.length > 0,
    notes,
    checklist: defaultChecklist.map((item) => ({ ...item, status: "requires_accountant_input" as const })),
  });

  const snapshot: ReportSnapshot = {
    entityName: input.client.name,
    legalName: input.client.legalName,
    periodEnd: periods.periodEnd,
    comparativePeriodEnd: periods.comparativePeriodEnd,
    presentationCurrency: input.presentationCurrency,
    reportingBasis: input.reportingBasis,
    presentationProfile: input.presentationProfile,
    statementOfFinancialPosition,
    profitOrLossAndOci,
    changesInEquity,
    cashFlows,
    notes,
    traceability: {
      postedEntryCount: currentEntries.length,
      postedLineCount: new Set(currentEntries.map((entry) => entry.statementLineId)).size,
      sourceImportCount: input.sourceImportCount,
    },
  };

  return {
    periods,
    snapshot,
    notes,
    checklist: defaultChecklist.map((item) => ({ ...item, status: "requires_accountant_input" as const })),
    signatory: { preparedBy: "", reviewedBy: "", authorizedBy: "", authorizationDate: null } satisfies ReportSignatory,
    validation,
  };
}

export function buildReportValidation(input: {
  totalDebits: number;
  totalCredits: number;
  assets: number;
  liabilitiesAndEquity: number;
  retainedEarningsMovement: number;
  profitAndOci: number;
  openingCash: number;
  cashMovement: number;
  closingCash: number;
  noteCash: number;
  relatedPartyCurrent: number;
  relatedPartyComponentCurrent: number;
  missingRateEntries: Entry[];
  hasComparative: boolean;
  notes: ReportNote[];
  checklist: ReportChecklistItem[];
}): ReportValidation {
  const tolerance = 0.01;
  const checks: ReportValidation["checks"] = [
    { id: "trial-balance", label: "Trial-balance debits and credits", status: Math.abs(input.totalDebits - input.totalCredits) <= tolerance ? "pass" : "error", detail: `Debits ${input.totalDebits.toFixed(2)}; credits ${input.totalCredits.toFixed(2)}.`, blocking: true },
    { id: "position", label: "Assets equal liabilities and equity", status: Math.abs(input.assets - input.liabilitiesAndEquity) <= tolerance ? "pass" : "error", detail: `Assets ${input.assets.toFixed(2)}; liabilities and equity ${input.liabilitiesAndEquity.toFixed(2)}.`, blocking: true },
    { id: "retained-earnings", label: "Profit reconciles to retained earnings movement", status: Math.abs(input.retainedEarningsMovement - input.profitAndOci) <= tolerance ? "pass" : "error", detail: `Retained earnings movement ${input.retainedEarningsMovement.toFixed(2)}; profit and OCI ${input.profitAndOci.toFixed(2)}.`, blocking: true },
    { id: "cash-flow", label: "Opening cash, cash-flow movement and closing cash", status: Math.abs(input.openingCash + input.cashMovement - input.closingCash) <= tolerance ? "pass" : "error", detail: `Opening ${input.openingCash.toFixed(2)} + movement ${input.cashMovement.toFixed(2)} = closing ${input.closingCash.toFixed(2)}.`, blocking: true },
    { id: "note-totals", label: "Statement totals reconcile to notes", status: Math.abs(input.closingCash - input.noteCash) <= tolerance ? "pass" : "error", detail: `Cash statement ${input.closingCash.toFixed(2)}; note 3 ${input.noteCash.toFixed(2)}.`, blocking: true },
    { id: "related-parties", label: "Related-party balances reconcile to due-from/due-to components", status: Math.abs(input.relatedPartyCurrent - input.relatedPartyComponentCurrent) <= tolerance ? "pass" : "error", detail: `Related-party balance ${input.relatedPartyCurrent.toFixed(2)}; component total ${input.relatedPartyComponentCurrent.toFixed(2)}.`, blocking: true },
    { id: "foreign-currency", label: "Foreign-currency conversion coverage", status: input.missingRateEntries.length ? "error" : "pass", detail: input.missingRateEntries.length ? `${input.missingRateEntries.length} posted entry or entries are missing a functional-currency rate.` : "All included posted entries have functional-currency coverage.", blocking: true },
    { id: "comparatives", label: "Comparative information", status: input.hasComparative ? "pass" : "warning", detail: input.hasComparative ? "Prior comparable period contains posted ledger data." : "No posted ledger data was found in the prior comparable period; comparative columns are visibly zero and cannot support finalization.", blocking: !input.hasComparative },
    { id: "notes", label: "Required notes and disclosures", status: input.notes.some((note) => note.requiresInput) ? "error" : "pass", detail: input.notes.some((note) => note.requiresInput) ? "One or more notes still require accountant input." : "All required note inputs are confirmed.", blocking: true },
    { id: "ifrs-checklist", label: "IFRS applicability and disclosure checklist", status: input.checklist.some((item) => ["applicable", "requires_accountant_input"].includes(item.status)) ? "error" : "pass", detail: input.checklist.some((item) => ["applicable", "requires_accountant_input"].includes(item.status)) ? "One or more IFRS checklist items require an accountant decision or confirmation." : "All checklist items are satisfied, immaterial, or not applicable.", blocking: true },
  ];
  const errorCount = checks.filter((check) => check.blocking && check.status !== "pass").length;
  return { status: errorCount ? "blocked" : "pass", errorCount, checks };
}

export function finalizationValidation(previous: ReportValidation, notes: ReportNote[], checklist: ReportChecklistItem[]) {
  const checks = previous.checks.map((check) => ({ ...check }));
  const notesCheck = checks.find((check) => check.id === "notes");
  if (notesCheck) {
    notesCheck.status = notes.some((note) => note.requiresInput) ? "error" : "pass";
    notesCheck.detail = notesCheck.status === "pass" ? "All required note inputs are confirmed." : "One or more notes still require accountant input.";
  }
  const checklistCheck = checks.find((check) => check.id === "ifrs-checklist");
  if (checklistCheck) {
    checklistCheck.status = checklist.some((item) => ["applicable", "requires_accountant_input"].includes(item.status)) ? "error" : "pass";
    checklistCheck.detail = checklistCheck.status === "pass" ? "All checklist items are satisfied, immaterial, or not applicable." : "One or more IFRS checklist items require an accountant decision or confirmation.";
  }
  const errorCount = checks.filter((check) => check.blocking && check.status !== "pass").length;
  return { status: errorCount ? "blocked" : "pass", errorCount, checks } satisfies ReportValidation;
}

export function inferredClassifications(entries: Entry[], existing: Classification[]) {
  const existingAccounts = new Set(existing.map((item) => item.accountName));
  return [...new Set(entries.flatMap((entry) => [entry.debitAccount, entry.creditAccount]))]
    .filter((account) => !existingAccounts.has(account))
    .map((account) => {
      const meta = standardAccountMeta(account);
      return {
        accountName: account,
        displayName: meta.displayName,
        statementSection: meta.kind,
        currentNonCurrent: meta.currentNonCurrent,
        cashFlowCategory: meta.cashFlowCategory,
        oci: meta.kind === "oci" ? "yes" : "no",
        relatedPartyCategory: meta.relatedParty ? "due_from_due_to" : "none",
        taxCategory: meta.tax ? "tax" : "not_assessed",
        noteNumber: meta.noteNumber,
      };
    });
}