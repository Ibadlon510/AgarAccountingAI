import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBankStatementRows, statementPeriod } from "../src/lib/bank-statement-display";

const lines = [
  { id: 2, date: "2024-10-05", description: "VAT", amount: 1.24, direction: "outflow" },
  { id: 1, date: "2024-10-04", description: "Inward remittance", amount: 53331.5, direction: "inflow" },
  { id: 3, date: "2024-10-05", description: "Transfer", amount: 3607, direction: "outflow" },
];

test("builds opening, money-out, money-in, and running balance rows in date order", () => {
  const rows = buildBankStatementRows(lines, 537091.14);

  assert.equal(rows[0]?.kind, "opening");
  assert.equal(rows[0]?.balance, 537091.14);
  assert.deepEqual(rows.slice(1, -1).map((row) => ({
    description: row.description,
    moneyOut: row.moneyOut,
    moneyIn: row.moneyIn,
    balance: row.balance,
  })), [
    { description: "Inward remittance", moneyOut: null, moneyIn: 53331.5, balance: 590422.64 },
    { description: "VAT", moneyOut: 1.24, moneyIn: null, balance: 590421.4 },
    { description: "Transfer", moneyOut: 3607, moneyIn: null, balance: 586814.4 },
  ]);
  assert.equal(rows.at(-1)?.kind, "closing");
  assert.equal(rows.at(-1)?.balance, 586814.4);
});

test("starts running balances at zero when opening is missing", () => {
  const rows = buildBankStatementRows([
    { id: "a", date: "2026-01-17", description: "Receipt", amount: 20000, direction: "inflow" },
    { id: "b", date: "2026-01-19", description: "Purchase", amount: 12850, direction: "outflow" },
  ], 0);

  assert.equal(rows[0]?.balance, 0);
  assert.equal(rows[1]?.balance, 20000);
  assert.equal(rows[2]?.balance, 7150);
  assert.equal(rows[3]?.balance, 7150);
});

test("reports the statement period from first to last transaction date", () => {
  assert.deepEqual(statementPeriod(lines), { from: "2024-10-04", to: "2024-10-05" });
  assert.equal(statementPeriod([]), null);
});
