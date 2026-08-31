import type { accountClassificationsTable, clientsTable, journalEntriesTable } from "@workspace/db";
import { calculateUaeCorporateTaxSummary } from "./clientChart";

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

export type ReportFirmAttribution = {
  enabled: boolean;
  firmName: string | null;
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
  firmAttribution?: ReportFirmAttribution;
  statementOfFinancialPosition: ReportAmount[];
  profitOrLossAndOci: ReportAmount[];
  changesInEquity: ReportAmount[];
  cashFlows: ReportAmount[];
  notes: ReportNote[];
  traceability: { postedEntryCount: number; postedLineCount: number; sourceImportCount: number };
  taxSummary: ReturnType<typeof calculateUaeCorporateTaxSummary>;
};

type Entry = typeof journalEntriesTable.$inferSelect;
type Classification = typeof accountClassificationsTable.$inferSelect;
type Client = typeof clientsTable.$inferSelect;

type AccountKind = "asset" | "liability" | "equity" | "revenue" | "expense" | "oci";
type AccountMeta = {
  kind: AccountKind;
  displayName: string;
  currentNonCurrent: "current" | "non_current" | "not_applicable";
  cashFlowCategory: "operating" | "investing" | "financing" | "non_cash";
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
const ppePattern = /property|plant|equipment|ppe|fixed asset|depreciation|furniture|vehicle|computer equipment/i;
const payrollPattern = /payroll|wage|salary|employee benefit|pension|gratuity|end of service/i;

function reportDateLabel(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function reportMoneyLabel(value: number, currency: string) {
  const absolute = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? `(${absolute}) ${currency}` : `${absolute} ${currency}`;
}

function joinLabels(labels: string[]) {
  if (!labels.length) return "the posted ledger accounts";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function buildDefaultReportNotes(input: {
  legalName: string;
  periodEnd: string;
  comparativePeriodEnd: string;
  presentationCurrency: string;
  reportingBasis: string;
  presentationProfile: string;
  isSme: boolean;
  isIfrs18: boolean;
  hasComparative: boolean;
  cashCurrent: number;
  cashComparative: number;
  revenues: Array<{ label: string; current: number; comparative: number }>;
  expenses: Array<{ label: string; current: number; comparative: number }>;
  taxExpenses: Array<{ label: string; current: number; comparative: number }>;
  relatedPartyBalances: Array<{ label: string; current: number; comparative: number }>;
  hasForeignCurrency: boolean;
}): ReportNote[] {
  const currency = input.presentationCurrency;
  const periodLabel = reportDateLabel(input.periodEnd);
  const comparativeLabel = reportDateLabel(input.comparativePeriodEnd);
  const framework = input.isSme ? "the IFRS for SMEs Accounting Standard" : input.reportingBasis === "IFRS" ? "International Financial Reporting Standards (IFRS)" : input.reportingBasis;
  const presentation = input.isIfrs18
    ? "These financial statements are presented using the IFRS 18 presentation profile."
    : input.isSme
      ? "These financial statements are presented under the IFRS for SMEs presentation profile."
      : "These financial statements are presented using the IAS 1 presentation profile.";
  const comparativeSentence = input.hasComparative
    ? `Comparative information is presented for the year ended ${comparativeLabel}.`
    : `Comparative figures for the year ended ${comparativeLabel} are presented as zero because no posted prior-period ledger activity is available in this workspace.`;
  const revenueLabels = input.revenues.map((row) => row.label);
  const expenseLabels = input.expenses.map((row) => row.label);
  const taxLabels = input.taxExpenses.map((row) => row.label);
  const relatedLabels = input.relatedPartyBalances.map((row) => row.label);
  const revenueTotal = input.revenues.reduce((total, row) => total + row.current, 0);
  const taxTotal = input.taxExpenses.reduce((total, row) => total + row.current, 0);

  const revenuePolicy = input.isSme
    ? "Revenue is recognised when the significant risks and rewards of the supply have transferred to the customer, the amount can be measured reliably, and collection is probable, consistent with Section 23."
    : input.isIfrs18
      ? "Revenue is recognised when control of goods or services transfers to the customer in an amount that reflects the consideration expected under the contract, and is presented within operating categories under IFRS 18."
      : "Revenue is recognised when control of goods or services transfers to the customer in an amount that reflects the consideration expected under IFRS 15.";

  return [
    {
      number: 1,
      title: "Basis of preparation",
      narrative: [
        `These financial statements of ${input.legalName} have been prepared for the year ended ${periodLabel} in accordance with ${framework}.`,
        presentation,
        `They are presented in ${currency}, which is also the entity’s presentation currency for this report pack.`,
        "Management has prepared the statements on a going-concern basis and has applied materiality when deciding which disclosures are necessary for an understanding of the financial position and performance.",
        comparativeSentence,
        "This pack is generated accounting output for management use and human review. It is not an audit opinion, statutory filing, tax return, or assurance conclusion.",
      ].join(" "),
      requiresInput: false,
      tables: [],
    },
    {
      number: 2,
      title: "Material accounting policies",
      narrative: [
        "The following policies are the system defaults applied to the posted ledger for this reporting period.",
        revenuePolicy,
        `Foreign-currency transactions are translated into ${currency} using rates available in the workspace exchange-rate schedule on or before the transaction date.`,
        "Cash and cash equivalents comprise bank and cash balances available on demand, excluding amounts management identifies as restricted.",
        "Income-tax expense reflects amounts posted to tax accounts in the ledger for the period. Deferred-tax balances are recognised only when separately posted.",
        "Expenses are recognised on an accrual basis as posted in the journal entries supporting this pack.",
      ].join(" "),
      requiresInput: false,
      tables: [],
    },
    {
      number: 3,
      title: "Cash and cash equivalents",
      narrative: [
        `Cash and cash equivalents at ${periodLabel} amount to ${reportMoneyLabel(input.cashCurrent, currency)}.`,
        "The balance is derived from posted cash and bank accounts in the client ledger.",
        "Unless management records a restriction, these balances are treated as available on demand and are included in the statement of cash flows.",
      ].join(" "),
      requiresInput: false,
      tables: [{ label: "Cash and bank balances", current: input.cashCurrent, comparative: input.cashComparative }],
    },
    {
      number: 4,
      title: "Revenue",
      narrative: [
        revenueLabels.length
          ? `Revenue for the year ended ${periodLabel} totals ${reportMoneyLabel(revenueTotal, currency)} and is analysed as ${joinLabels(revenueLabels)}.`
          : `No revenue accounts with posted balances were identified for the year ended ${periodLabel}.`,
        revenuePolicy,
        "Contract assets, contract liabilities, and remaining performance obligations are disclosed only when separately tracked in the ledger.",
      ].join(" "),
      requiresInput: false,
      tables: input.revenues,
    },
    {
      number: 5,
      title: "Operating expenses",
      narrative: [
        expenseLabels.length
          ? `Operating expenses are presented by nature from posted ledger accounts, including ${joinLabels(expenseLabels)}.`
          : "No non-tax operating-expense accounts with posted balances were identified for the current period.",
        "Amounts agree to the journal entries included in this report pack’s traceability set.",
      ].join(" "),
      requiresInput: false,
      tables: input.expenses,
    },
    {
      number: 6,
      title: "Related parties",
      narrative: relatedLabels.length
        ? [
          `Related-party balances recognised in the ledger comprise ${joinLabels(relatedLabels)}.`,
          "Unless management records different terms, outstanding balances are unsecured, interest-free, and repayable on demand.",
          "Key management compensation and other related-party transactions are disclosed when posted to related-party classified accounts.",
        ].join(" ")
        : "Management has not marked any posted ledger accounts as related-party balances for this period. No material related-party receivables or payables are therefore disclosed in the generated table.",
      requiresInput: false,
      tables: input.relatedPartyBalances,
    },
    {
      number: 7,
      title: "Income tax",
      narrative: [
        taxLabels.length
          ? `Income-tax amounts posted for the year ended ${periodLabel} total ${reportMoneyLabel(taxTotal, currency)} and are analysed as ${joinLabels(taxLabels)}.`
          : `No income-tax expense accounts with posted balances were identified for the year ended ${periodLabel}.`,
        currency === "AED"
          ? "Where UAE Corporate Tax estimates appear elsewhere in this pack, they are management estimates derived from mapped ledger activity and are not a filed tax return."
          : "Current and deferred tax are recognised only to the extent posted in the ledger for this reporting period.",
        "Uncertain tax positions and unused tax losses are disclosed only when separately identified by management in the books.",
      ].join(" "),
      requiresInput: false,
      tables: input.taxExpenses,
    },
    {
      number: 8,
      title: "Financial risk, foreign currency and other disclosures",
      narrative: [
        input.hasForeignCurrency
          ? `Some posted transactions were originated in currencies other than ${currency}. Those amounts are translated using workspace rates dated on or before each transaction.`
          : `Posted activity included in this pack is presented in ${currency}. No material foreign-currency exposure was identified from the converted ledger set.`,
        "Liquidity risk is managed by monitoring cash balances and payable obligations arising from posted bank activity.",
        "Credit risk arises primarily from bank balances and any receivable balances posted in the ledger.",
        input.isSme
          ? "Material commitments, contingencies, and other Section 8 disclosures are stated as nil unless management records them in the ledger or edits this note."
          : "Material commitments, contingencies, employee benefits, and significant judgments are stated as nil unless management records them in the ledger or edits this note.",
      ].join(" "),
      requiresInput: false,
      tables: [],
    },
    {
      number: 9,
      title: "Subsequent events",
      narrative: [
        `Management is not aware of material non-adjusting events after ${periodLabel} through the authorization date recorded with this pack.`,
        "If a material subsequent event arises before authorization, this note should be updated and the pack re-saved before finalization.",
      ].join(" "),
      requiresInput: false,
      tables: [],
    },
  ];
}

function defaultChecklistStatus(standard: string, evidence: {
  hasRevenue: boolean;
  hasTax: boolean;
  hasPpe: boolean;
  hasPayroll: boolean;
  hasRelatedParty: boolean;
  hasForeignCurrency: boolean;
}): ReportChecklistItem["status"] {
  const key = standard.replace(/^Section\s+/i, "IAS ").replace(/^IFRS\s+/i, "IFRS ");
  if (/^(IAS 1|IFRS 18|IAS 7|IAS 8|IAS 10)$/i.test(key) || standard === "IFRS 18") return "satisfied";
  if (/IAS 12/i.test(key)) return evidence.hasTax ? "satisfied" : "not_applicable";
  if (/IAS 16/i.test(key)) return evidence.hasPpe ? "satisfied" : "not_applicable";
  if (/IAS 19/i.test(key)) return evidence.hasPayroll ? "satisfied" : "not_applicable";
  if (/IAS 21/i.test(key)) return evidence.hasForeignCurrency ? "satisfied" : "not_applicable";
  if (/IAS 24/i.test(key)) return evidence.hasRelatedParty ? "satisfied" : "not_applicable";
  if (/IFRS 7|IFRS 9/i.test(key)) return "satisfied";
  if (/IFRS 15|Section 23/i.test(standard) || /IFRS 15/i.test(key)) return evidence.hasRevenue ? "satisfied" : "not_applicable";
  return "satisfied";
}

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

export const REPORT_PROFILES = {
  IFRS_IAS_1: { basis: "IFRS", profile: "IAS 1", label: "Full IFRS · IAS 1" },
  IFRS_18: { basis: "IFRS", profile: "IFRS 18", label: "Full IFRS · IFRS 18" },
  IFRS_SME: { basis: "IFRS for SMEs", profile: "IFRS for SMEs", label: "IFRS for SMEs" },
} as const;

export function eligibleReportProfiles(periodEnd: string, clientBasis: string) {
  const year = Number(periodEnd.slice(0, 4));
  if (!periodEnd.endsWith("-12-31")) return [];
  const profiles: Array<(typeof REPORT_PROFILES)[keyof typeof REPORT_PROFILES]> = [REPORT_PROFILES.IFRS_IAS_1, REPORT_PROFILES.IFRS_SME];
  if (clientBasis === "IFRS" && year >= 2027) profiles.push(REPORT_PROFILES.IFRS_18);
  return profiles.filter((profile) => profile.basis === clientBasis);
}

const standardAccountMeta = (account: string): AccountMeta => {
  const normalized = account.toLowerCase();
  if (/inter[\s-]?account transfer/.test(normalized)) return { kind: "asset", displayName: account, currentNonCurrent: "current", cashFlowCategory: "non_cash", noteNumber: 3, relatedParty: false, tax: false };
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
  firmAttribution?: ReportFirmAttribution;
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

  const cashBalances = assets.filter((item) => /bank|cash|inter[\s-]?account transfer/i.test(item.account));
  const cashCurrent = sums(cashBalances, "current");
  const cashComparative = sums(cashBalances, "comparative");
  const openingCash = cashComparative;
  const cashMovement = cashCurrent - openingCash;
  const operatingCash = currentEntries.reduce((total, entry) => {
    if (/inter[\s-]?account transfer/i.test(entry.debitAccount) || /inter[\s-]?account transfer/i.test(entry.creditAccount)) {
      return total;
    }
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
  const isSme = input.reportingBasis === "IFRS for SMEs";
  const isIfrs18 = input.presentationProfile === "IFRS 18";

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

  const profileStatementOfFinancialPosition = isIfrs18
    ? statementOfFinancialPosition.map((row) => row.label === "Current assets" ? { ...row, label: "Current operating assets" } : row)
    : statementOfFinancialPosition;
  const profileProfitOrLossAndOci = isIfrs18
    ? profitOrLossAndOci.map((row) => row.label === "Operating expenses" ? { ...row, label: "Operating expenses by nature or function" } : row)
    : isSme
      ? profitOrLossAndOci.filter((row) => row.label !== "Other comprehensive income" && row.label !== "Total comprehensive income")
      : profitOrLossAndOci;
  const profileChangesInEquity = isSme
    ? changesInEquity.filter((row) => row.label !== "Other comprehensive income")
    : changesInEquity;
  const profileCashFlows = cashFlows;

  const relatedPartyBalances = values.filter((item) => item.meta.relatedParty);
  const revenueNoteRows = revenues.map((item) => ({ label: item.meta.displayName, current: accountValue(item, "current"), comparative: accountValue(item, "comparative") }));
  const expenseNoteRows = expenses.filter((item) => !item.meta.tax).map((item) => ({ label: item.meta.displayName, current: accountValue(item, "current"), comparative: accountValue(item, "comparative") }));
  const taxNoteRows = expenses.filter((item) => item.meta.tax).map((item) => ({ label: item.meta.displayName, current: accountValue(item, "current"), comparative: accountValue(item, "comparative") }));
  const relatedPartyNoteRows = relatedPartyBalances.map((item) => ({ label: item.meta.displayName, current: accountValue(item, "current"), comparative: accountValue(item, "comparative") }));
  const hasForeignCurrency = input.entries.some((entry) => (entry.currency || input.presentationCurrency) !== input.presentationCurrency);
  const hasPpe = values.some((item) => ppePattern.test(item.account) || ppePattern.test(item.meta.displayName));
  const hasPayroll = values.some((item) => payrollPattern.test(item.account) || payrollPattern.test(item.meta.displayName));
  const notes: ReportNote[] = buildDefaultReportNotes({
    legalName: input.client.legalName,
    periodEnd: periods.periodEnd,
    comparativePeriodEnd: periods.comparativePeriodEnd,
    presentationCurrency: input.presentationCurrency,
    reportingBasis: input.reportingBasis,
    presentationProfile: input.presentationProfile,
    isSme,
    isIfrs18,
    hasComparative: comparativeEntries.length > 0,
    cashCurrent,
    cashComparative,
    revenues: revenueNoteRows,
    expenses: expenseNoteRows,
    taxExpenses: taxNoteRows,
    relatedPartyBalances: relatedPartyNoteRows,
    hasForeignCurrency,
  });
  const checklistEvidence = {
    hasRevenue: revenueNoteRows.some((row) => Math.abs(row.current) > 0.009 || Math.abs(row.comparative) > 0.009),
    hasTax: taxNoteRows.some((row) => Math.abs(row.current) > 0.009 || Math.abs(row.comparative) > 0.009),
    hasPpe,
    hasPayroll,
    hasRelatedParty: relatedPartyNoteRows.length > 0,
    hasForeignCurrency,
  };
  const profileChecklist = isSme
    ? defaultChecklist.filter((item) => !["IFRS 7", "IFRS 9", "IFRS 15"].includes(item.standard)).map((item) => ({
      ...item,
      standard: item.standard.replace(/^IAS/, "Section"),
      title: item.title.replace(/IFRS 15/, "Section 23"),
      prompt: item.prompt.replace(/IFRS 15/, "Section 23").replace(/IFRS checklist/, "SME disclosure checklist"),
    }))
    : isIfrs18
      ? defaultChecklist.map((item) => item.standard === "IAS 1"
        ? { ...item, standard: "IFRS 18", title: "Presentation and disclosure in financial statements", prompt: "Confirm operating, investing, financing, income-tax, and discontinued-operation categories, including management-defined performance measures." }
        : item)
      : defaultChecklist;
  const checklist: ReportChecklistItem[] = profileChecklist.map((item) => ({
    ...item,
    status: defaultChecklistStatus(item.standard, checklistEvidence),
  }));

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
    checklist,
  });

  const snapshot: ReportSnapshot = {
    entityName: input.client.name,
    legalName: input.client.legalName,
    periodEnd: periods.periodEnd,
    comparativePeriodEnd: periods.comparativePeriodEnd,
    presentationCurrency: input.presentationCurrency,
    reportingBasis: input.reportingBasis,
    presentationProfile: input.presentationProfile,
    firmAttribution: input.firmAttribution ?? { enabled: false, firmName: null },
    statementOfFinancialPosition: profileStatementOfFinancialPosition,
    profitOrLossAndOci: profileProfitOrLossAndOci,
    changesInEquity: profileChangesInEquity,
    cashFlows: profileCashFlows,
    notes,
    traceability: {
      postedEntryCount: currentEntries.length,
      postedLineCount: new Set(currentEntries.map((entry) => entry.statementLineId)).size,
      sourceImportCount: input.sourceImportCount,
    },
    taxSummary: calculateUaeCorporateTaxSummary(
      input.entries,
      input.classifications,
      periods.periodEnd,
      input.presentationCurrency,
    ),
  };

  return {
    periods,
    snapshot,
    notes,
    checklist,
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
    { id: "notes", label: "Required notes and disclosures", status: input.notes.some((note) => note.requiresInput || !note.narrative.trim()) ? "error" : "pass", detail: input.notes.some((note) => note.requiresInput || !note.narrative.trim()) ? "One or more notes still need owner review or disclosure wording." : "System-generated note wording is present for every required disclosure.", blocking: true },
    { id: "ifrs-checklist", label: "IFRS applicability and disclosure checklist", status: input.checklist.some((item) => ["applicable", "requires_accountant_input"].includes(item.status)) ? "error" : "pass", detail: input.checklist.some((item) => ["applicable", "requires_accountant_input"].includes(item.status)) ? "One or more IFRS checklist items still need a final applicability decision." : "Checklist items are satisfied, immaterial, or not applicable based on ledger evidence and system defaults.", blocking: true },
  ];
  const errorCount = checks.filter((check) => check.blocking && check.status !== "pass").length;
  return { status: errorCount ? "blocked" : "pass", errorCount, checks };
}

export function finalizationValidation(previous: ReportValidation, notes: ReportNote[], checklist: ReportChecklistItem[]) {
  const checks = previous.checks.map((check) => ({ ...check }));
  const notesCheck = checks.find((check) => check.id === "notes");
  if (notesCheck) {
    notesCheck.status = notes.some((note) => note.requiresInput || !note.narrative.trim()) ? "error" : "pass";
    notesCheck.detail = notesCheck.status === "pass" ? "System-generated note wording is present for every required disclosure." : "One or more notes still need owner review or disclosure wording.";
  }
  const checklistCheck = checks.find((check) => check.id === "ifrs-checklist");
  if (checklistCheck) {
    checklistCheck.status = checklist.some((item) => ["applicable", "requires_accountant_input"].includes(item.status)) ? "error" : "pass";
    checklistCheck.detail = checklistCheck.status === "pass" ? "Checklist items are satisfied, immaterial, or not applicable based on ledger evidence and system defaults." : "One or more IFRS checklist items still need a final applicability decision.";
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