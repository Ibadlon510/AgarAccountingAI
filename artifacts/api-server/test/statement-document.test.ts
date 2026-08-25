import assert from "node:assert/strict";
import test from "node:test";
import { hasPdfBankStatementTable, parsePdfBankStatementRows } from "../src/lib/statementDocument";

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