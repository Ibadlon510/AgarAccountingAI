import assert from "node:assert/strict";
import test from "node:test";
import {
  hasDelimitedBankStatementStructure,
  hasPdfBankStatementTable,
  normalizeStatementDate,
  parseDelimitedBankStatementRows,
  parsePdfBankStatementRows,
} from "../src/lib/statementDocument";

const mashreqMultiLinePdfText = `
Account Number
019101198068
IBAN
AE910330000019101198068
Statement for period 2024-10-01 to 2025-09-30
Date
Transaction
Reference No
Debit
Credit
Balance
Opening Balance
537,091.14
2024-10-04
Inward Remittance - FUND TRANSFER
/NL55RABO0107579146
1/SUNWEB GROUP GMBH
033IWCF242780065
53,331.50
590,422.64
2024-10-05
Value Added Tax - Output -
/CH410022022010663165U
033DBFC242790318
1.24
590,421.40
2024-10-05
Online International Money Transfer -
/CH410022022010663165U
033DBFC242790318
3,607.00
586,788.69
`;

test("parses a bank PDF whose extracted columns are emitted on separate lines", () => {
  assert.equal(hasPdfBankStatementTable(mashreqMultiLinePdfText), true);
  const rows = parsePdfBankStatementRows(mashreqMultiLinePdfText, "EUR");

  assert.deepEqual(rows, [
    {
      date: "2024-10-04",
      description: "Inward Remittance - FUND TRANSFER /NL55RABO0107579146 1/SUNWEB GROUP GMBH",
      amount: 53331.5,
      direction: "inflow",
      currency: "EUR",
    },
    {
      date: "2024-10-05",
      description: "Value Added Tax - Output - /CH410022022010663165U",
      amount: 1.24,
      direction: "outflow",
      currency: "EUR",
    },
    {
      date: "2024-10-05",
      description: "Online International Money Transfer - /CH410022022010663165U",
      amount: 3607,
      direction: "outflow",
      currency: "EUR",
    },
  ]);
});

test("parses the inline transaction rows emitted by pdf-parse for Mashreq statements", () => {
  const pdfParseText = `
Account Number 019101198068
IBAN AE910330000019101198068
Date Transaction Reference No Debit Credit Balance
Opening Balance 537,091.14
2024-10-04 Inward Remittance - FUND TRANSFER
/NL55RABO0107579146
1/SUNWEB GROUP GMBH
033IWCF242780065 53,331.50 590,422.64
2024-10-05 Corr.Bank.Charges -
/CH410022022010663165U
033DBFC242790318 25.71 590,396.93
`;
  const rows = parsePdfBankStatementRows(pdfParseText, "EUR");

  assert.deepEqual(rows, [
    {
      date: "2024-10-04",
      description: "Inward Remittance - FUND TRANSFER /NL55RABO0107579146 1/SUNWEB GROUP GMBH",
      amount: 53331.5,
      direction: "inflow",
      currency: "EUR",
    },
    {
      date: "2024-10-05",
      description: "Corr.Bank.Charges - /CH410022022010663165U",
      amount: 25.71,
      direction: "outflow",
      currency: "EUR",
    },
  ]);
});

test("does not recognize a financial report as a bank transaction PDF", () => {
  const financialReportText = `
Financial Statements
Statement of Financial Position
Revenue
General and administrative expenses
Cash and cash equivalents
`;
  assert.equal(hasPdfBankStatementTable(financialReportText), false);
  assert.deepEqual(parsePdfBankStatementRows(financialReportText, "AED"), []);
});

test("parses a Mashreq Excel export with month-name dates and multiline quoted descriptions", () => {
  const extractedWorkbookCsv = `
,Account transactions Statement Report,,,,,
Account Holder Name,Triwill Industrial Products Trading LTD,,,,,
Account Number,019101445593,,,,,
Account Currency,AED,,,,,
Account Transactions for the period,01 Jan 2026 to 17 Aug 2026,,,,,
Date,Value Date,Reference Number,Description,Credit,Debit,Balance
17 Jan 2026,17 Jan 2026,033AACT260174435,"Acct to Acct transfer FUND TRANSFER
TRIWILL INDUSTRIAL PRODUCTS TRADING SRN: M170126273128WYM","+20,000.00",,"20,683.95"
19 Jan 2026,19 Jan 2026,030POSB2601928Kh,Visa Purchase AD PORT MAQTA GATEWAY,,"-12,850.00","7,833.95"
`;
  const rows = parseDelimitedBankStatementRows(extractedWorkbookCsv, "AED");

  assert.equal(hasDelimitedBankStatementStructure(extractedWorkbookCsv, rows, false), true);
  assert.deepEqual(rows, [
    {
      date: "2026-01-17",
      description: "Acct to Acct transfer FUND TRANSFER TRIWILL INDUSTRIAL PRODUCTS TRADING SRN: M170126273128WYM",
      amount: 20_000,
      direction: "inflow",
      currency: "AED",
    },
    {
      date: "2026-01-19",
      description: "Visa Purchase AD PORT MAQTA GATEWAY",
      amount: 12_850,
      direction: "outflow",
      currency: "AED",
    },
  ]);
});

test("normalizes unambiguous bank-export dates without guessing ambiguous numeric dates", () => {
  assert.equal(normalizeStatementDate("17 Jan 2026"), "2026-01-17");
  assert.equal(normalizeStatementDate("January 19, 2026"), "2026-01-19");
  assert.equal(normalizeStatementDate("2026/02/06"), "2026-02-06");
  assert.equal(normalizeStatementDate("01/02/2026"), null);
  assert.equal(normalizeStatementDate("31/02/2026"), null);
});

test("keeps a general-ledger table outside the bank-statement fallback", () => {
  const generalLedger = `
Date,Description,Debit,Credit,Balance
2026-08-20,Office expense,18.50,,981.50
2026-08-21,Accrued revenue,,3000.00,3981.50
`;
  const rows = parseDelimitedBankStatementRows(generalLedger, "AED");

  assert.equal(rows.length, 2);
  assert.equal(hasDelimitedBankStatementStructure(generalLedger, rows, false), false);
});