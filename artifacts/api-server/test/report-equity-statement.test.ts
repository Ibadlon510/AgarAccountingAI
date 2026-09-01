import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEquityStatement,
  equityMatrixLines,
  equityMatrixTieOut,
  isEquityMatrix,
} from "../src/lib/equityStatement";

const empty = { shareCapital: 0, otherReserves: 0, dividends: 0, netIncome: 0, oci: 0 };

test("builds a current-year equity matrix that rolls share capital and retained earnings to closing", () => {
  const rows = buildEquityStatement({
    current: { shareCapital: 200000, otherReserves: 0, dividends: -10000, netIncome: 80000, oci: 0 },
    comparative: { shareCapital: 200000, otherReserves: 0, dividends: 0, netIncome: 30000, oci: 0 },
    preComparative: { shareCapital: 200000, otherReserves: 0, dividends: 0, netIncome: 0, oci: 0 },
    currentPeriodStart: "2026-01-01",
    currentPeriodEnd: "2026-12-31",
    comparativePeriodStart: "2025-01-01",
    comparativePeriodEnd: "2025-12-31",
    includeOci: true,
  });

  assert.equal(isEquityMatrix(rows), true);
  assert.equal(rows[0]?.label, "Year ended 31 December 2026");
  assert.equal(rows[1]?.label, "Year ended 31 December 2025");

  const currentRows = rows[0]?.children ?? [];
  const labels = currentRows.map((row) => row.label);
  assert.deepEqual(labels, [
    "Balance at 1 January 2026",
    "Profit for the year",
    "Dividends and distributions",
    "Balance at 31 December 2026",
  ]);
  assert.ok(!labels.includes("Other comprehensive income"));
  assert.ok(!labels.includes("Changes in share capital"));

  const columns = currentRows[0]?.children?.map((cell) => cell.label);
  assert.deepEqual(columns, ["Share capital", "Retained earnings", "Total"]);

  const profit = currentRows.find((row) => row.noteRef === "profit");
  assert.equal(profit?.children?.find((cell) => cell.label === "Retained earnings")?.current, 50000);
  assert.equal(profit?.children?.find((cell) => cell.label === "Share capital")?.current, 0);

  const dividends = currentRows.find((row) => row.noteRef === "dividends");
  assert.equal(dividends?.children?.find((cell) => cell.label === "Retained earnings")?.current, -10000);

  const closing = currentRows.find((row) => row.noteRef === "closing");
  assert.equal(closing?.children?.find((cell) => cell.label === "Share capital")?.current, 200000);
  assert.equal(closing?.children?.find((cell) => cell.label === "Retained earnings")?.current, 70000);
  assert.equal(closing?.current, 270000);

  const sofpEquity = 200000 + -10000 + 80000;
  const comparativeSofp = 200000 + 30000;
  const tie = equityMatrixTieOut(rows, sofpEquity, comparativeSofp);
  assert.equal(tie.ok, true);
  assert.equal(tie.closingTotal, 270000);
});

test("omits OCI from SME statements and keeps a comparative-year table", () => {
  const rows = buildEquityStatement({
    current: { ...empty, shareCapital: 100, netIncome: 40 },
    comparative: { ...empty, shareCapital: 100, netIncome: 15, oci: 5 },
    preComparative: { ...empty, shareCapital: 100 },
    currentPeriodStart: "2027-01-01",
    currentPeriodEnd: "2027-12-31",
    comparativePeriodStart: "2026-01-01",
    comparativePeriodEnd: "2026-12-31",
    includeOci: false,
  });
  const currentLabels = rows[0]?.children?.map((row) => row.label) ?? [];
  const comparativeLabels = rows[1]?.children?.map((row) => row.label) ?? [];
  assert.ok(!currentLabels.includes("Other comprehensive income"));
  assert.ok(!comparativeLabels.includes("Other comprehensive income"));
  assert.equal(equityMatrixTieOut(rows, 140, 120).ok, true);
  assert.ok(currentLabels.includes("Profit for the year"));
  assert.match(rows[1]?.label ?? "", /2026/);
});

test("renders padded equity-matrix lines for the PDF", () => {
  const rows = buildEquityStatement({
    current: { ...empty, shareCapital: 200000, netIncome: 80000 },
    comparative: { ...empty, shareCapital: 200000, netIncome: 30000 },
    preComparative: empty,
    currentPeriodStart: "2026-01-01",
    currentPeriodEnd: "2026-12-31",
    comparativePeriodStart: "2025-01-01",
    comparativePeriodEnd: "2025-12-31",
    includeOci: true,
  });
  const lines = equityMatrixLines(rows, true).join("\n");
  assert.match(lines, /Year ended 31 December 2026/);
  assert.match(lines, /Share capital/);
  assert.match(lines, /Retained earnings/);
  assert.match(lines, /Year ended 31 December 2025/);
});
