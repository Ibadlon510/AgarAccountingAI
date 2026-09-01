import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountsForRegister,
  bankRegisterKey,
  groupBankRegisters,
  groupBankRegistersFromSummary,
  openingBalanceForRegister,
  registerHrefForImport,
} from "../src/lib/bank-register";
import { buildBankStatementRows } from "../src/lib/bank-statement-display";

test("groups loaded lines by created bank name and currency across files", () => {
  const mashreqOperating = { id: 1, name: "Operating", bankName: "Mashreq", accountNumberLast4: "1234", currency: "AED" };
  const mashreqSavings = { id: 2, name: "Savings", bankName: "Mashreq", accountNumberLast4: "5678", currency: "AED" };
  const mashreqUsd = { id: 3, name: "USD operating", bankName: "Mashreq", currency: "USD" };
  const alpha = { id: 4, name: "Operating", bankName: "Alpha Bank", currency: "AED" };

  const groups = groupBankRegisters([mashreqOperating, mashreqSavings, mashreqUsd, alpha], [
    { id: 11, date: "2026-01-05", description: "January receipt", amount: 100, direction: "inflow", currency: "AED", bankAccountId: 1, source: "Imported: jan.pdf" },
    { id: 12, date: "2026-02-03", description: "February payment", amount: 40, direction: "outflow", currency: "AED", bankAccountId: 2, source: "Imported: feb.pdf" },
    { id: 13, date: "2026-02-10", description: "USD transfer", amount: 20, direction: "outflow", currency: "USD", bankAccountId: 3, source: "Imported: usd.csv" },
    { id: 14, date: "2026-02-11", description: "Alpha payment", amount: 15, direction: "outflow", currency: "AED", bankAccountId: 4, source: "Imported: alpha.csv" },
  ]);

  const mashreqAed = groups.find((group) => group.currency === "AED" && group.bankName === "Mashreq");
  assert.ok(mashreqAed);
  assert.equal(mashreqAed.lines.length, 2);
  assert.deepEqual(mashreqAed.sourceLabels.sort(), ["feb.pdf", "jan.pdf"]);
  assert.equal(groups.find((group) => group.canonicalAccount.id === 3)?.lines.length, 1);
  assert.equal(groups.find((group) => group.canonicalAccount.id === 4)?.lines.length, 1);
});

test("keeps unnamed accounts on their created identity instead of mixing currencies", () => {
  const first = { id: 8, name: "Account 8", bankName: null, currency: "AED" };
  const second = { id: 9, name: "Account 9", bankName: null, currency: "AED" };
  assert.notEqual(bankRegisterKey(first.bankName, first.currency, first.id), bankRegisterKey(second.bankName, second.currency, second.id));
  assert.equal(accountsForRegister([first, second], 8).map((account) => account.id).join(","), "8");
});

test("uses the earliest statement opening and does not add later file openings", () => {
  const accounts = [{ id: 1, name: "Operating", bankName: "Mashreq", currency: "AED" }];
  const opening = openingBalanceForRegister([
    {
      outcome: "completed",
      bankAccountId: 1,
      fileName: "feb.pdf",
      preview: {
        openingBalance: 5000,
        lines: [{ date: "2026-02-01" }, { date: "2026-02-28" }],
      },
    },
    {
      outcome: "completed",
      bankAccountId: 1,
      fileName: "jan.pdf",
      preview: {
        openingBalance: 1000,
        lines: [{ date: "2026-01-02" }, { date: "2026-01-31" }],
      },
    },
  ], accounts);

  assert.equal(opening.value, 1000);
  assert.equal(opening.fileName, "jan.pdf");

  const lines = [
    { id: 1, date: "2026-01-02", description: "January receipt", amount: 200, direction: "inflow" as const },
    { id: 2, date: "2026-02-03", description: "February payment", amount: 50, direction: "outflow" as const },
  ];
  const rows = buildBankStatementRows(lines, opening.value ?? 0);
  assert.equal(rows[0]?.balance, 1000);
  assert.equal(rows[1]?.balance, 1200);
  assert.equal(rows[2]?.balance, 1150);
  assert.equal(rows.at(-1)?.balance, 1150);
});

test("does not use a later file opening when the earliest statement has none", () => {
  const accounts = [{ id: 1, name: "Operating", bankName: "Mashreq", currency: "AED" }];
  const opening = openingBalanceForRegister([
    {
      outcome: "completed",
      bankAccountId: 1,
      fileName: "feb.pdf",
      preview: {
        openingBalance: 5000,
        lines: [{ date: "2026-02-01" }],
      },
    },
    {
      outcome: "completed",
      bankAccountId: 1,
      fileName: "jan.pdf",
      preview: {
        openingBalance: null,
        lines: [{ date: "2026-01-02" }],
      },
    },
  ], accounts);

  assert.equal(opening.value, null);
  assert.equal(opening.fileName, "jan.pdf");
});

test("rolls up register cards from summary bank-account counts without loading lines", () => {
  const mashreqOperating = { id: 1, name: "Operating", bankName: "Mashreq", accountNumberLast4: "1234", currency: "AED" };
  const mashreqSavings = { id: 2, name: "Savings", bankName: "Mashreq", accountNumberLast4: "5678", currency: "AED" };
  const mashreqUsd = { id: 3, name: "USD operating", bankName: "Mashreq", currency: "USD" };
  const groups = groupBankRegistersFromSummary([mashreqOperating, mashreqSavings, mashreqUsd], [
    { bankAccountId: 1, lineCount: 4, dateFrom: "2026-01-05", dateTo: "2026-01-31", sourceLabels: ["jan.pdf"] },
    { bankAccountId: 2, lineCount: 2, dateFrom: "2026-02-03", dateTo: "2026-02-03", sourceLabels: ["feb.pdf"] },
    { bankAccountId: 3, lineCount: 1, dateFrom: "2026-02-10", dateTo: "2026-02-10", sourceLabels: ["usd.csv"] },
  ]);
  const mashreqAed = groups.find((group) => group.currency === "AED" && group.bankName === "Mashreq");
  assert.ok(mashreqAed);
  assert.equal(mashreqAed.lineCount, 6);
  assert.equal(mashreqAed.dateFrom, "2026-01-05");
  assert.equal(mashreqAed.dateTo, "2026-02-03");
  assert.deepEqual(mashreqAed.sourceLabels.sort(), ["feb.pdf", "jan.pdf"]);
  assert.equal(groups.find((group) => group.canonicalAccount.id === 3)?.lineCount, 1);
});

test("builds a register href from the created bank account, not the upload", () => {
  assert.equal(registerHrefForImport({ bankAccount: { id: 43 } }), "/bank-register/43");
  assert.equal(registerHrefForImport({
    bankAccountId: null,
    preview: { bankAccount: { id: 42 } },
  }), "/bank-register/42");
  assert.equal(registerHrefForImport({ bankAccountId: null, preview: { accountGroups: [] } }), "/bank-register");
});
