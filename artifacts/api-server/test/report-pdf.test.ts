import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEquityStatement } from "../src/lib/equityStatement";
import { buildReportPdf } from "../src/lib/reportPdf";
import type { ReportSnapshot } from "../src/lib/reportPack";
import { PDFParse } from "pdf-parse";

const amount = (label: string, current: number) => ({
  label,
  current,
  comparative: 0,
  noteRef: "—",
  sourceEntryIds: [],
  sourceLineIds: [],
});

async function extractPdfText(pdf: Buffer) {
  const parser = new PDFParse({ data: pdf });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

test("puts a handwritten signature placeholder on each primary statement and the notes", async () => {
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
  });
  const text = await extractPdfText(pdf);
  assert.equal((text.match(/AUTHORIZED SIGNATORY/g) ?? []).length, 5);
  const titles = [
    "Statement of financial position",
    "Statement of profit or loss and other comprehensive income",
    "Statement of changes in equity",
    "Statement of cash flows",
    "Notes to the financial statements",
  ];
  for (const [index, title] of titles.entries()) {
    const start = text.indexOf(title);
    assert.ok(start >= 0, title);
    const nextTitle = titles[index + 1];
    const end = nextTitle ? text.indexOf(nextTitle, start + title.length) : text.length;
    const slice = text.slice(start, end === -1 ? undefined : end);
    assert.match(slice, /AUTHORIZED SIGNATORY/, `${title} should include a signature line`);
  }
});

test("renders the equity matrix columns in the report PDF", async () => {
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
  });
  const text = await extractPdfText(pdf);
  const start = text.indexOf("Statement of changes in equity");
  const end = text.indexOf("Statement of cash flows", start + 1);
  const slice = text.slice(start, end === -1 ? undefined : end);
  assert.match(slice, /Year ended 31 December 2026/);
  assert.match(slice, /SHARE CAPITAL/);
  assert.match(slice, /RETAINED EARNINGS/);
  assert.match(slice, /Profit for the year/);
  assert.match(slice, /AUTHORIZED SIGNATORY/);
  assert.doesNotMatch(slice, /Opening retained earnings/);
});
