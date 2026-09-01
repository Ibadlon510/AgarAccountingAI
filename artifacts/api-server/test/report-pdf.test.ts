import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEquityStatement } from "../src/lib/equityStatement";
import { buildReportPdf } from "../src/lib/reportPdf";
import type { ReportSnapshot } from "../src/lib/reportPack";

const amount = (label: string, current: number) => ({
  label,
  current,
  comparative: 0,
  noteRef: "—",
  sourceEntryIds: [],
  sourceLineIds: [],
});

test("puts a handwritten signature placeholder on each primary statement and the notes", () => {
  const snapshot = {
    entityName: "Profile test entity",
    legalName: "Profile test entity LLC",
    periodEnd: "2027-12-31",
    comparativePeriodEnd: "2026-12-31",
    presentationCurrency: "AED",
    reportingBasis: "IFRS",
    presentationProfile: "IAS 1",
    statementOfFinancialPosition: [amount("Total assets", 100)],
    profitOrLossAndOci: [amount("Profit for the year", 20)],
    changesInEquity: [amount("Closing equity", 100)],
    cashFlows: [amount("Cash at end of year", 40)],
    notes: [{ number: 1, title: "Basis of preparation", narrative: "Draft note.", requiresInput: false, tables: [] }],
    traceability: { postedEntryCount: 0, postedLineCount: 0, sourceImportCount: 0 },
    taxSummary: {} as ReportSnapshot["taxSummary"],
  } satisfies ReportSnapshot;
  const pdf = buildReportPdf(snapshot, {
    preparedBy: "Report Preparer",
    reviewedBy: "Report Reviewer",
    authorizedBy: "Report Authorizer",
    authorizationDate: "2027-12-31",
  }).toString("utf8");
  assert.equal((pdf.match(/Authorized signatory/g) ?? []).length, 5);
  const titles = [
    "Statement of financial position",
    "Statement of profit or loss",
    "Statement of changes in equity",
    "Statement of cash flows",
    "Notes to the financial statements",
  ];
  for (const [index, title] of titles.entries()) {
    const start = pdf.indexOf(title);
    assert.ok(start >= 0, title);
    const nextTitle = titles[index + 1] ?? "Authorization and source traceability";
    const end = pdf.indexOf(nextTitle, start + title.length);
    const slice = pdf.slice(start, end === -1 ? undefined : end);
    assert.match(slice, /Authorized signatory/, `${title} should include a signature line`);
  }
});

test("renders the equity matrix columns in the report PDF", () => {
  const changesInEquity = buildEquityStatement({
    current: { shareCapital: 200000, otherReserves: 0, dividends: 0, netIncome: 80000, oci: 0 },
    comparative: { shareCapital: 200000, otherReserves: 0, dividends: 0, netIncome: 30000, oci: 0 },
    preComparative: { shareCapital: 0, otherReserves: 0, dividends: 0, netIncome: 0, oci: 0 },
    currentPeriodStart: "2026-01-01",
    currentPeriodEnd: "2026-12-31",
    comparativePeriodStart: "2025-01-01",
    comparativePeriodEnd: "2025-12-31",
    includeOci: true,
  });
  const snapshot = {
    entityName: "Profile test entity",
    legalName: "Profile test entity LLC",
    periodEnd: "2026-12-31",
    comparativePeriodEnd: "2025-12-31",
    presentationCurrency: "AED",
    reportingBasis: "IFRS",
    presentationProfile: "IAS 1",
    statementOfFinancialPosition: [amount("Equity", 280000)],
    profitOrLossAndOci: [amount("Profit for the year", 50000)],
    changesInEquity,
    cashFlows: [amount("Cash at end of year", 40)],
    notes: [{ number: 1, title: "Basis of preparation", narrative: "Draft note.", requiresInput: false, tables: [] }],
    traceability: { postedEntryCount: 0, postedLineCount: 0, sourceImportCount: 0 },
    taxSummary: {} as ReportSnapshot["taxSummary"],
  } satisfies ReportSnapshot;
  const pdf = buildReportPdf(snapshot, {
    preparedBy: "Preparer",
    reviewedBy: "Reviewer",
    authorizedBy: "Authorizer",
    authorizationDate: "2026-12-31",
  }).toString("utf8");
  const start = pdf.indexOf("Statement of changes in equity");
  const end = pdf.indexOf("Statement of cash flows", start + 1);
  const slice = pdf.slice(start, end === -1 ? undefined : end);
  assert.match(slice, /Year ended 31 December 2026/);
  assert.match(slice, /Share capital/);
  assert.match(slice, /Retained earnings/);
  assert.match(slice, /Profit for the year/);
  assert.match(slice, /Authorized signatory/);
  assert.doesNotMatch(slice, /Opening retained earnings/);
});
