import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import {
  sanitizeExportFilename,
  statementLineExportPdf,
  statementLineExportWorkbook,
  type StatementLineExportDocument,
} from "../src/lib/statementLineExport";

const document: StatementLineExportDocument = {
  clientName: "Acme Trading LLC",
  generatedAt: "2026-08-31",
  rows: [
    {
      date: "2026-09-15",
      description: "CARD FEE REF 1001",
      direction: "outflow",
      currency: "AED",
      amount: 25,
      contactName: "Mashreq Bank",
      account: "Bank charges",
      status: "draft",
      confidence: 0.91,
      source: "Bank statement",
      bankAccountName: "Operating AED",
      functionalCurrency: "AED",
      functionalAmount: 25,
    },
  ],
};

test("Excel export includes selected line fields and client heading", () => {
  const buffer = statementLineExportWorkbook(document);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
  assert.ok(sheet);
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, raw: false });
  assert.equal(rows[0]?.[0], "Client");
  assert.equal(rows[0]?.[1], "Acme Trading LLC");
  assert.ok(rows.some((row) => row.includes("CARD FEE REF 1001")));
  assert.ok(rows.some((row) => row.includes("Mashreq Bank")));
  assert.ok(rows.some((row) => row.includes("Bank charges")));
});

test("PDF export is a valid document containing the selected line", () => {
  const pdf = statementLineExportPdf(document).toString("utf8");
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /Acme Trading LLC/);
  assert.match(pdf, /CARD FEE REF 1001/);
  assert.match(pdf, /Mashreq Bank/);
  assert.match(pdf, /Bank charges/);
});

test("export filename is a safe client slug", () => {
  assert.equal(sanitizeExportFilename("Acme Trading LLC", "xlsx"), "acme-trading-llc-statement-lines.xlsx");
  assert.equal(sanitizeExportFilename("???", "pdf"), "agaraccounting-ai-statement-lines.pdf");
});
