export type BankStatementDisplayLine = {
  id: string | number;
  date: string;
  description: string;
  amount: number;
  direction: string;
  currency?: string;
};

export type BankStatementDisplayRow = {
  kind: "opening" | "transaction" | "closing";
  date: string;
  description: string;
  moneyOut: number | null;
  moneyIn: number | null;
  balance: number;
  lineId?: string | number;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function signedAmount(line: BankStatementDisplayLine) {
  return line.direction === "inflow" ? line.amount : -line.amount;
}

export function sortBankStatementLines<T extends BankStatementDisplayLine>(lines: T[]): T[] {
  return [...lines].sort((left, right) => {
    const dateCompare = left.date.localeCompare(right.date);
    if (dateCompare !== 0) return dateCompare;
    return String(left.id).localeCompare(String(right.id), undefined, { numeric: true });
  });
}

export function statementPeriod(lines: BankStatementDisplayLine[]) {
  const dates = lines.map((line) => line.date.slice(0, 10)).filter(Boolean).sort();
  if (!dates.length) return null;
  return { from: dates[0], to: dates.at(-1)! };
}

export function buildBankStatementRows(
  lines: BankStatementDisplayLine[],
  openingBalance: number,
): BankStatementDisplayRow[] {
  const ordered = sortBankStatementLines(lines);
  const opening = roundMoney(openingBalance);
  const firstDate = ordered[0]?.date ?? "";
  const lastDate = ordered.at(-1)?.date ?? firstDate;
  const rows: BankStatementDisplayRow[] = [{
    kind: "opening",
    date: firstDate,
    description: "Opening balance",
    moneyOut: null,
    moneyIn: null,
    balance: opening,
  }];
  let running = opening;
  for (const line of ordered) {
    running = roundMoney(running + signedAmount(line));
    rows.push({
      kind: "transaction",
      date: line.date,
      description: line.description,
      moneyOut: line.direction === "outflow" ? line.amount : null,
      moneyIn: line.direction === "inflow" ? line.amount : null,
      balance: running,
      lineId: line.id,
    });
  }
  rows.push({
    kind: "closing",
    date: lastDate,
    description: "Closing balance",
    moneyOut: null,
    moneyIn: null,
    balance: running,
  });
  return rows;
}
