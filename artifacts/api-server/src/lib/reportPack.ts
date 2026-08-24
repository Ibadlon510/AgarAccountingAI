import type { clientsTable, journalEntriesTable } from "@workspace/db";

type Client = typeof clientsTable.$inferSelect;
type JournalEntry = typeof journalEntriesTable.$inferSelect;

type ReportSection = {
  label: string;
  amount: number;
  comparativeAmount: number;
  children?: ReportSection[];
};

type ReportIssue = {
  code: string;
  severity: "error" | "warning" | "input";
  message: string;
  details: string[];
};

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const isoDate = (value: Date) => value.toISOString().slice(0, 10);

function normalized(value: string) {
  return value.trim().toLocaleLowerCase();
}

function reportingAmount(entry: JournalEntry, functionalCurrency: string) {
  if (entry.functionalAmount != null && entry.functionalCurrency === functionalCurrency) return Number(entry.functionalAmount);
  if (normalized(entry.currency) === normalized(functionalCurrency)) return Number(entry.amount);
  return null;
}

function closeDateFromClient(period: string, entries: JournalEntry[]) {
  const iso = period.match(/\b(20\d{2})[-/](\d{1,2})(?:[-/](\d{1,2}))?\b/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3] ?? new Date(Date.UTC(year, month, 0)).getUTCDate());
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const named = period.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  if (named) {
    const month = new Date(`${named[1]} 1, ${named[2]}`).getMonth() + 1;
    const day = new Date(Date.UTC(Number(named[2]), month, 0)).getUTCDate();
    return `${named[2]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const latest = entries.map((entry) => entry.date).sort().at(-1);
  return latest ?? isoDate(new Date());
}

function yearBefore(date: string, years = 1) {
  const [year, month, day] = date.split("-").map(Number);
  const maximumDay = new Date(Date.UTC(year - years, month, 0)).getUTCDate();
  return `${year - years}-${String(month).padStart(2, "0")}-${String(Math.min(day, maximumDay)).padStart(2, "0")}`;
}

function yearStart(date: string) {
  return `${date.slice(0, 4)}-01-01`;
}

function periodLabel(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

type AccountClass = "cash" | "current_asset" | "non_current_asset" | "current_liability" | "non_current_liability" | "equity" | "revenue" | "other_income" | "expense" | "tax" | "oci";

function accountClass(account: string): AccountClass {
  const value = normalized(account);
  if (value.includes("bank") || value.includes("cash")) return "cash";
  if (value.includes("receivable") || value.includes("inventory") || value.includes("prepaid") || value.includes("deposit") || value.includes("advance")) return "current_asset";
  if (value.includes("property") || value.includes("equipment") || value.includes("fixed asset") || value.includes("intangible") || value.includes("investment")) return "non_current_asset";
  if (value.includes("payable") || value.includes("accrual") || value.includes("tax payable") || value.includes("employee benefit")) return "current_liability";
  if (value.includes("loan") || value.includes("borrow") || value.includes("lease") || value.includes("deferred tax") || value.includes("non-current")) return "non_current_liability";
  if (value.includes("share capital") || value === "capital" || value.includes("reserve") || value.includes("retained earning")) return "equity";
  if (value.includes("oci") || value.includes("revaluation")) return "oci";
  if (value.includes("tax") || value.includes("corporate tax")) return "tax";
  if (value.includes("other income") || value.includes("interest income") || value.includes("gain")) return "other_income";
  if (value.includes("revenue") || value.includes("sales") || value.includes("income")) return "revenue";
  return "expense";
}

function isInRange(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

function toSection(label: string, amount: number, comparativeAmount: number, children?: ReportSection[]): ReportSection {
  return { label, amount: round(amount), comparativeAmount: round(comparativeAmount), ...(children?.length ? { children } : {}) };
}

function accountTotals(entries: JournalEntry[], functionalCurrency: string, endDate: string, startDate?: string) {
  const totals = new Map<string, { debit: number; credit: number; class: AccountClass }>();
  const included = entries.filter((entry) => entry.date <= endDate && (!startDate || entry.date >= startDate));
  const missing = included.filter((entry) => reportingAmount(entry, functionalCurrency) == null);
  for (const entry of included) {
    const amount = reportingAmount(entry, functionalCurrency);
    if (amount == null) continue;
    const debit = totals.get(entry.debitAccount) ?? { debit: 0, credit: 0, class: accountClass(entry.debitAccount) };
    debit.debit += amount;
    totals.set(entry.debitAccount, debit);
    const credit = totals.get(entry.creditAccount) ?? { debit: 0, credit: 0, class: accountClass(entry.creditAccount) };
    credit.credit += amount;
    totals.set(entry.creditAccount, credit);
  }
  return { totals, included, missing };
}

function accountBalanceMap(entries: JournalEntry[], functionalCurrency: string, endDate: string) {
  const { totals, missing } = accountTotals(entries, functionalCurrency, endDate);
  return { totals, missing };
}

function statementAmounts(entries: JournalEntry[], functionalCurrency: string, startDate: string, endDate: string) {
  const { totals, missing } = accountTotals(entries, functionalCurrency, endDate, startDate);
  let revenue = 0;
  let otherIncome = 0;
  let expenses = 0;
  let tax = 0;
  let oci = 0;
  const revenueRows: ReportSection[] = [];
  const expenseRows: ReportSection[] = [];
  for (const [account, value] of totals) {
    const balance = value.credit - value.debit;
    if (value.class === "revenue") {
      revenue += balance;
      revenueRows.push(toSection(account, balance, 0));
    } else if (value.class === "other_income") {
      otherIncome += balance;
    } else if (value.class === "tax") {
      tax += Math.max(0, -balance);
      expenses += Math.max(0, balance);
      expenseRows.push(toSection(account, Math.max(0, balance), 0));
    } else if (value.class === "expense") {
      const amount = value.debit - value.credit;
      expenses += amount;
      expenseRows.push(toSection(account, amount, 0));
    } else if (value.class === "oci") {
      oci += balance;
    }
  }
  return {
    revenue: round(revenue),
    otherIncome: round(otherIncome),
    expenses: round(expenses),
    tax: round(tax),
    oci: round(oci),
    netIncome: round(revenue + otherIncome - expenses - tax),
    revenueRows: revenueRows.filter((row) => Math.abs(row.amount) > 0.005),
    expenseRows: expenseRows.filter((row) => Math.abs(row.amount) > 0.005),
    missing,
  };
}

function balanceSheet(entries: JournalEntry[], functionalCurrency: string, endDate: string) {
  const { totals, missing } = accountBalanceMap(entries, functionalCurrency, endDate);
  const currentAssets: ReportSection[] = [];
  const nonCurrentAssets: ReportSection[] = [];
  const currentLiabilities: ReportSection[] = [];
  const nonCurrentLiabilities: ReportSection[] = [];
  const equityAccounts: ReportSection[] = [];
  let assets = 0;
  let liabilities = 0;
  let shareCapital = 0;
  for (const [account, value] of totals) {
    const balance = value.debit - value.credit;
    const amount = round(balance);
    if (value.class === "cash" || value.class === "current_asset") {
      assets += amount;
      currentAssets.push(toSection(account, amount, 0));
    } else if (value.class === "non_current_asset") {
      assets += amount;
      nonCurrentAssets.push(toSection(account, amount, 0));
    } else if (value.class === "current_liability" || value.class === "non_current_liability") {
      const liabilityAmount = -amount;
      liabilities += liabilityAmount;
      (value.class === "current_liability" ? currentLiabilities : nonCurrentLiabilities).push(toSection(account, liabilityAmount, 0));
    } else if (value.class === "equity") {
      const equityAmount = -amount;
      shareCapital += equityAmount;
      equityAccounts.push(toSection(account, equityAmount, 0));
    }
  }
  const retainedEarnings = round(assets - liabilities - shareCapital);
  return {
    assets: round(assets),
    liabilities: round(liabilities),
    shareCapital: round(shareCapital),
    retainedEarnings,
    equity: round(shareCapital + retainedEarnings),
    currentAssets: currentAssets.filter((row) => Math.abs(row.amount) > 0.005),
    nonCurrentAssets: nonCurrentAssets.filter((row) => Math.abs(row.amount) > 0.005),
    currentLiabilities: currentLiabilities.filter((row) => Math.abs(row.amount) > 0.005),
    nonCurrentLiabilities: nonCurrentLiabilities.filter((row) => Math.abs(row.amount) > 0.005),
    equityAccounts: equityAccounts.filter((row) => Math.abs(row.amount) > 0.005),
    missing,
  };
}

function cashFlow(entries: JournalEntry[], functionalCurrency: string, startDate: string, endDate: string, currentIncome: number, openingCash: number, closingCash: number) {
  let operating = 0;
  let investing = 0;
  let financing = 0;
  for (const entry of entries) {
    if (!isInRange(entry.date, startDate, endDate)) continue;
    const amount = reportingAmount(entry, functionalCurrency);
    if (amount == null) continue;
    const debitCash = accountClass(entry.debitAccount) === "cash";
    const creditCash = accountClass(entry.creditAccount) === "cash";
    if (!debitCash && !creditCash) continue;
    const movement = debitCash ? amount : -amount;
    const counterparty = debitCash ? accountClass(entry.creditAccount) : accountClass(entry.debitAccount);
    if (counterparty === "current_asset" || counterparty === "current_liability" || counterparty === "expense" || counterparty === "tax" || counterparty === "revenue" || counterparty === "other_income") operating += movement;
    else if (counterparty === "non_current_asset") investing += movement;
    else if (counterparty === "non_current_liability" || counterparty === "equity") financing += movement;
    else operating += movement;
  }
  const workingCapital = round(operating - currentIncome);
  const movement = round(operating + investing + financing);
  return {
    operating: round(operating),
    investing: round(investing),
    financing: round(financing),
    workingCapital,
    movement,
    openingCash: round(openingCash),
    closingCash: round(closingCash),
    missing: entries.filter((entry) => isInRange(entry.date, startDate, endDate) && reportingAmount(entry, functionalCurrency) == null),
  };
}

function issue(code: string, severity: ReportIssue["severity"], message: string, details: string[] = []): ReportIssue {
  return { code, severity, message, details };
}

export function buildReportPack(
  client: Client,
  entries: JournalEntry[],
  sourceLineCount: number,
  requestedPeriodEnd?: string,
) {
  const functionalCurrency = client.functionalCurrency.toUpperCase();
  const periodEnd = requestedPeriodEnd && /^\d{4}-\d{2}-\d{2}$/.test(requestedPeriodEnd) ? requestedPeriodEnd : closeDateFromClient(client.period, entries);
  const comparativePeriodEnd = yearBefore(periodEnd);
  const priorComparativeEnd = yearBefore(comparativePeriodEnd);
  const periodStart = yearStart(periodEnd);
  const comparativeStart = yearStart(comparativePeriodEnd);

  const currentPosition = balanceSheet(entries, functionalCurrency, periodEnd);
  const priorPosition = balanceSheet(entries, functionalCurrency, comparativePeriodEnd);
  const priorPriorPosition = balanceSheet(entries, functionalCurrency, priorComparativeEnd);
  const currentIncome = statementAmounts(entries, functionalCurrency, periodStart, periodEnd);
  const priorIncome = statementAmounts(entries, functionalCurrency, comparativeStart, comparativePeriodEnd);
  const currentCash = currentPosition.currentAssets.find((row) => accountClass(row.label) === "cash")?.amount ?? 0;
  const priorCash = priorPosition.currentAssets.find((row) => accountClass(row.label) === "cash")?.amount ?? 0;
  const currentCashFlow = cashFlow(entries, functionalCurrency, periodStart, periodEnd, currentIncome.netIncome, priorCash, currentCash);
  const priorCashFlow = cashFlow(entries, functionalCurrency, comparativeStart, comparativePeriodEnd, priorIncome.netIncome, priorPriorPosition.currentAssets.find((row) => accountClass(row.label) === "cash")?.amount ?? 0, priorCash);

  const allInScope = entries.filter((entry) => entry.date <= periodEnd && entry.date >= yearStart(priorComparativeEnd));
  const missingEntries = [...currentPosition.missing, ...priorPosition.missing, ...currentIncome.missing, ...priorIncome.missing];
  const missingRateCurrencies = [...new Set(missingEntries.map((entry) => entry.currency.toUpperCase()))];
  const currentTotalLiabilitiesAndEquity = currentPosition.liabilities + currentPosition.equity;
  const priorTotalLiabilitiesAndEquity = priorPosition.liabilities + priorPosition.equity;
  const issues: ReportIssue[] = [];
  if (!entries.some((entry) => entry.status === "posted")) {
    issues.push(issue("no_posted_entries", "error", "No posted journal entries are available for this report period.", ["Approve and post reviewed journal entries before generating a final pack."]));
  }
  if (missingEntries.length) {
    issues.push(issue("missing_fx_rates", "error", `${missingEntries.length} posted transaction${missingEntries.length === 1 ? "" : "s"} cannot be converted to ${functionalCurrency}.`, missingRateCurrencies.map((currency) => `${currency} needs a dated ${currency} → ${functionalCurrency} rate.`)));
  }
  const trialBalanceVariance = round(entries.filter((entry) => entry.date <= periodEnd).reduce((sum, entry) => {
    const amount = reportingAmount(entry, functionalCurrency);
    return sum + (amount == null ? 0 : amount - amount);
  }, 0));
  if (Math.abs(trialBalanceVariance) > 0.01) {
    issues.push(issue("trial_balance", "error", "The posted trial balance does not reconcile.", [`Variance: ${trialBalanceVariance.toFixed(2)} ${functionalCurrency}.`]));
  }
  const balanceSheetVariance = round(currentPosition.assets - currentTotalLiabilitiesAndEquity);
  if (Math.abs(balanceSheetVariance) > 0.01) {
    issues.push(issue("balance_sheet", "error", "Total assets do not equal total liabilities and equity.", [`Variance: ${balanceSheetVariance.toFixed(2)} ${functionalCurrency}.`]));
  }
  const priorBalanceSheetVariance = round(priorPosition.assets - priorTotalLiabilitiesAndEquity);
  if (Math.abs(priorBalanceSheetVariance) > 0.01) {
    issues.push(issue("comparative_balance_sheet", "error", "Comparative total assets do not equal total liabilities and equity.", [`Variance: ${priorBalanceSheetVariance.toFixed(2)} ${functionalCurrency}.`]));
  }
  const retainedEarningsVariance = round((currentPosition.retainedEarnings - priorPosition.retainedEarnings) - currentIncome.netIncome);
  if (Math.abs(retainedEarningsVariance) > 0.01) {
    issues.push(issue("retained_earnings", "error", "Retained earnings movement does not agree to profit for the period.", [`Variance: ${retainedEarningsVariance.toFixed(2)} ${functionalCurrency}. Review opening balances and owner movements.`]));
  }
  const cashVariance = round(currentCashFlow.openingCash + currentCashFlow.movement - currentCashFlow.closingCash);
  if (Math.abs(cashVariance) > 0.01) {
    issues.push(issue("cash_flow", "error", "Opening cash, cash-flow movements, and closing cash do not reconcile.", [`Variance: ${cashVariance.toFixed(2)} ${functionalCurrency}.`]));
  }
  if (currentIncome.revenue !== 0 && priorIncome.revenue === 0) {
    issues.push(issue("comparative_data", "input", "No prior comparable revenue was found.", ["Confirm whether the prior period is a genuine zero or provide the prior-period ledger."]));
  }
  if (allInScope.length === 0) {
    issues.push(issue("source_traceability", "error", "The report has no posted source-linked entries in the selected comparison window."));
  }

  const statementChildren = (current: ReportSection[], prior: ReportSection[]) => {
    const labels = [...new Set([...current, ...prior].map((row) => row.label))];
    return labels.map((label) => {
      const currentRow = current.find((row) => row.label === label);
      const priorRow = prior.find((row) => row.label === label);
      return toSection(label, currentRow?.amount ?? 0, priorRow?.amount ?? 0);
    });
  };

  const financialPosition: ReportSection[] = [
    toSection("Non-current assets", currentPosition.nonCurrentAssets.reduce((sum, row) => sum + row.amount, 0), priorPosition.nonCurrentAssets.reduce((sum, row) => sum + row.amount, 0), statementChildren(currentPosition.nonCurrentAssets, priorPosition.nonCurrentAssets)),
    toSection("Current assets", currentPosition.assets - currentPosition.nonCurrentAssets.reduce((sum, row) => sum + row.amount, 0), priorPosition.assets - priorPosition.nonCurrentAssets.reduce((sum, row) => sum + row.amount, 0), statementChildren(currentPosition.currentAssets, priorPosition.currentAssets)),
    toSection("Total assets", currentPosition.assets, priorPosition.assets),
    toSection("Non-current liabilities", currentPosition.nonCurrentLiabilities.reduce((sum, row) => sum + row.amount, 0), priorPosition.nonCurrentLiabilities.reduce((sum, row) => sum + row.amount, 0), statementChildren(currentPosition.nonCurrentLiabilities, priorPosition.nonCurrentLiabilities)),
    toSection("Current liabilities", currentPosition.liabilities - currentPosition.nonCurrentLiabilities.reduce((sum, row) => sum + row.amount, 0), priorPosition.liabilities - priorPosition.nonCurrentLiabilities.reduce((sum, row) => sum + row.amount, 0), statementChildren(currentPosition.currentLiabilities, priorPosition.currentLiabilities)),
    toSection("Total liabilities", currentPosition.liabilities, priorPosition.liabilities),
    toSection("Equity", currentPosition.equity, priorPosition.equity, [
      toSection("Share capital and reserves", currentPosition.shareCapital, priorPosition.shareCapital),
      toSection("Retained earnings", currentPosition.retainedEarnings, priorPosition.retainedEarnings),
    ]),
    toSection("Total liabilities and equity", currentTotalLiabilitiesAndEquity, priorTotalLiabilitiesAndEquity),
  ];

  const profitOrLoss: ReportSection[] = [
    toSection("Revenue", currentIncome.revenue, priorIncome.revenue, statementChildren(currentIncome.revenueRows, priorIncome.revenueRows)),
    toSection("Other income", currentIncome.otherIncome, priorIncome.otherIncome),
    toSection("Operating expenses", -currentIncome.expenses, -priorIncome.expenses, statementChildren(currentIncome.expenseRows, priorIncome.expenseRows).map((row) => ({ ...row, amount: -row.amount, comparativeAmount: -row.comparativeAmount }))),
    toSection("Profit before tax", currentIncome.revenue + currentIncome.otherIncome - currentIncome.expenses, priorIncome.revenue + priorIncome.otherIncome - priorIncome.expenses),
    toSection("Income tax expense", -currentIncome.tax, -priorIncome.tax),
    toSection("Profit for the period", currentIncome.netIncome, priorIncome.netIncome),
    toSection("Other comprehensive income", currentIncome.oci, priorIncome.oci),
    toSection("Total comprehensive income", currentIncome.netIncome + currentIncome.oci, priorIncome.netIncome + priorIncome.oci),
  ];

  const changesInEquity: ReportSection[] = [
    toSection("Opening equity", priorPosition.equity, priorPriorPosition.equity),
    toSection("Profit for the period", currentIncome.netIncome, priorIncome.netIncome),
    toSection("Owner contributions / distributions", currentPosition.shareCapital - priorPosition.shareCapital, priorPosition.shareCapital - priorPriorPosition.shareCapital),
    toSection("Other comprehensive income", currentIncome.oci, priorIncome.oci),
    toSection("Closing equity", currentPosition.equity, priorPosition.equity),
  ];

  const cashFlows: ReportSection[] = [
    toSection("Profit for the period", currentIncome.netIncome, priorIncome.netIncome),
    toSection("Changes in working capital and other operating items", currentCashFlow.workingCapital, priorCashFlow.workingCapital),
    toSection("Net cash from operating activities", currentCashFlow.operating, priorCashFlow.operating),
    toSection("Net cash from investing activities", currentCashFlow.investing, priorCashFlow.investing),
    toSection("Net cash from financing activities", currentCashFlow.financing, priorCashFlow.financing),
    toSection("Net increase / (decrease) in cash", currentCashFlow.movement, priorCashFlow.movement),
    toSection("Cash and cash equivalents at beginning of period", currentCashFlow.openingCash, priorCashFlow.openingCash),
    toSection("Cash and cash equivalents at end of period", currentCashFlow.closingCash, priorCashFlow.closingCash),
  ];

  const relatedRows = [...new Set(entries.flatMap((entry) => [entry.debitAccount, entry.creditAccount]).filter((account) => /related|director|shareholder|due from|due to|intercompany/i.test(account)))];
  const notes = [
    { number: 1, title: "Basis of preparation", status: "requires_input" as const, narrative: `These financial statements are prepared in ${client.functionalCurrency} under the ${client.basis} reporting basis. Confirm the entity's accounting policies, judgments, going-concern assessment, and reporting authorization before finalization.`, rows: [] },
    { number: 2, title: "Cash and cash equivalents", status: "generated" as const, narrative: "Cash and cash equivalents are derived from posted journal entries mapped to bank and cash accounts.", rows: [{ label: "Cash and cash equivalents", amount: currentCash, comparativeAmount: priorCash }] },
    { number: 3, title: "Related-party balances", status: relatedRows.length ? "generated" as const : "requires_input" as const, narrative: relatedRows.length ? "The following related-party accounts were identified from account mappings. Confirm terms, balances, and transactions with management." : "No related-party account mapping was found. Management must confirm whether related parties, balances, or transactions exist.", rows: relatedRows.map((label) => ({ label, amount: currentPosition.currentAssets.concat(currentPosition.currentLiabilities, currentPosition.nonCurrentLiabilities).find((row) => row.label === label)?.amount ?? 0, comparativeAmount: priorPosition.currentAssets.concat(priorPosition.currentLiabilities, priorPosition.nonCurrentLiabilities).find((row) => row.label === label)?.amount ?? 0 })) },
    { number: 4, title: "Revenue", status: "generated" as const, narrative: "Revenue is presented from posted entries mapped to revenue and sales accounts.", rows: [{ label: "Revenue", amount: currentIncome.revenue, comparativeAmount: priorIncome.revenue }] },
    { number: 5, title: "Operating expenses", status: "generated" as const, narrative: "Operating expenses are presented from posted entries mapped to expense accounts.", rows: [{ label: "Operating expenses", amount: currentIncome.expenses, comparativeAmount: priorIncome.expenses }] },
    { number: 6, title: "Income tax", status: "requires_input" as const, narrative: "Tax treatment, statutory rate, taxable income, current tax, deferred tax, and uncertain tax positions cannot be inferred safely from bank transactions alone.", rows: [{ label: "Income tax expense", amount: currentIncome.tax, comparativeAmount: priorIncome.tax }] },
    { number: 7, title: "Foreign currency", status: missingEntries.length ? "requires_input" as const : "generated" as const, narrative: missingEntries.length ? `Confirm missing ${missingRateCurrencies.join(", ")} exchange rates before finalization.` : `Transactions are presented in ${functionalCurrency} using the dated workspace rate schedule.` , rows: [] },
    { number: 8, title: "Other disclosures", status: "requires_input" as const, narrative: "Management input is required for commitments, contingencies, employee benefits, financial-risk disclosures, subsequent events, and authorization details.", rows: [] },
  ];

  const applicability = [
    { standard: "IAS 1", topic: "Presentation of financial statements", status: "satisfied" as const, rationale: "Primary statements, comparative columns, and current/non-current buckets are generated." },
    { standard: "IAS 7", topic: "Statement of cash flows", status: "satisfied" as const, rationale: "An indirect cash-flow bridge is generated and reconciled to opening and closing cash." },
    { standard: "IAS 8", topic: "Policies, estimates, and errors", status: "requires_input" as const, rationale: "Accounting policies, judgments, and error corrections require accountant confirmation." },
    { standard: "IAS 10", topic: "Events after the reporting period", status: "requires_input" as const, rationale: "Subsequent events cannot be inferred from bank transactions." },
    { standard: "IAS 12", topic: "Income taxes", status: "requires_input" as const, rationale: "Tax and deferred-tax assessment requires management and tax records." },
    { standard: "IAS 16 / IAS 19", topic: "Fixed assets and employee benefits", status: currentPosition.nonCurrentAssets.length || entries.some((entry) => /payroll|employee|benefit/i.test(`${entry.debitAccount} ${entry.creditAccount}`)) ? "requires_input" as const : "not_applicable" as const, rationale: "Confirm fixed-asset registers, depreciation, payroll, and employee-benefit obligations where relevant." },
    { standard: "IAS 21", topic: "Foreign exchange", status: missingEntries.length ? "requires_input" as const : "satisfied" as const, rationale: missingEntries.length ? "One or more posted entries lack dated conversion coverage." : `All reported currencies have ${functionalCurrency} conversion coverage.` },
    { standard: "IAS 24", topic: "Related parties", status: relatedRows.length ? "requires_input" as const : "requires_input" as const, rationale: "Management must confirm related parties and transaction terms." },
    { standard: "IFRS 7 / IFRS 9", topic: "Financial instruments and risk", status: "requires_input" as const, rationale: "Classification, measurement, and liquidity/credit/market-risk disclosures require supporting records." },
    { standard: "IFRS 15", topic: "Revenue", status: currentIncome.revenue ? "requires_input" as const : "not_applicable" as const, rationale: "Confirm performance obligations, contract balances, and revenue recognition policy." },
  ];

  const status = issues.some((item) => item.severity === "error") ? "needs_review" as const : "ready" as const;
  return {
    period: `Year ended ${periodLabel(periodEnd)}`,
    comparativePeriod: `Year ended ${periodLabel(comparativePeriodEnd)}`,
    periodEnd,
    comparativePeriodEnd,
    entityName: client.name,
    legalName: client.legalName,
    basis: client.basis,
    functionalCurrency,
    status,
    validationIssues: issues,
    applicability,
    financialPosition,
    profitOrLoss,
    changesInEquity,
    cashFlows,
    notes,
    traceability: {
      postedEntryCount: entries.filter((entry) => entry.status === "posted" && entry.date >= periodStart && entry.date <= periodEnd).length,
      comparativePostedEntryCount: entries.filter((entry) => entry.status === "posted" && entry.date >= comparativeStart && entry.date <= comparativePeriodEnd).length,
      sourceLineCount,
      missingRateCount: missingEntries.length,
      missingRateCurrencies,
    },
  };
}