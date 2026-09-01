type ReportAmount = {
  label: string;
  current: number;
  comparative: number;
  noteRef: string;
  sourceEntryIds: number[];
  sourceLineIds: number[];
  children?: ReportAmount[];
};

export const EQUITY_MATRIX_KIND = {
  opening: "opening",
  profit: "profit",
  oci: "oci",
  dividends: "dividends",
  capital: "capital",
  other: "other",
  closing: "closing",
} as const;

export type EquityMatrixKind = (typeof EQUITY_MATRIX_KIND)[keyof typeof EQUITY_MATRIX_KIND];

export type EquitySlice = {
  shareCapital: number;
  otherReserves: number;
  dividends: number;
  netIncome: number;
  oci: number;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NIL = 0.005;

export function isEquityMatrix(rows: ReportAmount[]) {
  return rows.length > 0 && rows.every((row) => /^Year ended /.test(row.label) && Boolean(row.children?.some((child) => child.children?.length)));
}

export function isShareCapitalEquityAccount(account: string) {
  return /share capital|issued capital|paid[ -]?up capital/i.test(account);
}

export function isDividendEquityAccount(account: string, displayName = account) {
  return /distribution|dividend/i.test(`${account} ${displayName}`);
}

export function retainedEarningsOf(slice: EquitySlice) {
  return slice.dividends + slice.netIncome + slice.oci;
}

export function totalEquityOf(slice: EquitySlice) {
  return slice.shareCapital + slice.otherReserves + retainedEarningsOf(slice);
}

export function formatStatementDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function nearlyZero(value: number) {
  return Math.abs(value) < NIL;
}

function cell(label: string, amount: number, noteRef: string): ReportAmount {
  return {
    label,
    current: amount,
    comparative: 0,
    noteRef,
    sourceEntryIds: [],
    sourceLineIds: [],
  };
}

function movementRow(label: string, kind: EquityMatrixKind, columns: string[], amounts: Record<string, number>, notes: Record<string, string>): ReportAmount | null {
  const values = columns.map((column) => amounts[column] ?? 0);
  if (kind !== EQUITY_MATRIX_KIND.opening && kind !== EQUITY_MATRIX_KIND.closing && values.every(nearlyZero)) return null;
  return {
    label,
    current: amounts.Total ?? 0,
    comparative: 0,
    noteRef: kind,
    sourceEntryIds: [],
    sourceLineIds: [],
    children: columns.map((column) => cell(column, amounts[column] ?? 0, notes[column] ?? "—")),
  };
}

function amountsFor(slice: EquitySlice, columns: string[]) {
  const retained = retainedEarningsOf(slice);
  const total = totalEquityOf(slice);
  const byLabel: Record<string, number> = {
    "Share capital": slice.shareCapital,
    "Other reserves": slice.otherReserves,
    "Retained earnings": retained,
    Total: total,
  };
  return Object.fromEntries(columns.map((column) => [column, byLabel[column] ?? 0]));
}

function periodTable(input: {
  heading: string;
  openingDate: string;
  closingDate: string;
  opening: EquitySlice;
  closing: EquitySlice;
  includeOci: boolean;
  columns: string[];
  notes: Record<string, string>;
}): ReportAmount {
  const openingAmounts = amountsFor(input.opening, input.columns);
  const closingAmounts = amountsFor(input.closing, input.columns);
  const periodProfit = input.closing.netIncome - input.opening.netIncome;
  const periodOci = input.closing.oci - input.opening.oci;
  const profit = input.includeOci ? periodProfit : periodProfit + periodOci;
  const oci = periodOci;
  const dividends = input.closing.dividends - input.opening.dividends;
  const capital = input.closing.shareCapital - input.opening.shareCapital;
  const other = input.closing.otherReserves - input.opening.otherReserves;
  const rows = [
    movementRow(`Balance at ${input.openingDate}`, EQUITY_MATRIX_KIND.opening, input.columns, openingAmounts, input.notes),
    movementRow("Profit for the year", EQUITY_MATRIX_KIND.profit, input.columns, { "Retained earnings": profit, Total: profit }, input.notes),
    input.includeOci
      ? movementRow("Other comprehensive income", EQUITY_MATRIX_KIND.oci, input.columns, { "Retained earnings": oci, Total: oci }, input.notes)
      : null,
    movementRow("Dividends and distributions", EQUITY_MATRIX_KIND.dividends, input.columns, { "Retained earnings": dividends, Total: dividends }, input.notes),
    movementRow("Changes in share capital", EQUITY_MATRIX_KIND.capital, input.columns, { "Share capital": capital, Total: capital }, input.notes),
    input.columns.includes("Other reserves")
      ? movementRow("Other movements in reserves", EQUITY_MATRIX_KIND.other, input.columns, { "Other reserves": other, Total: other }, input.notes)
      : null,
    movementRow(`Balance at ${input.closingDate}`, EQUITY_MATRIX_KIND.closing, input.columns, closingAmounts, input.notes),
  ].filter((row): row is ReportAmount => Boolean(row));
  return {
    label: input.heading,
    current: closingAmounts.Total ?? 0,
    comparative: 0,
    noteRef: "—",
    sourceEntryIds: [],
    sourceLineIds: [],
    children: rows,
  };
}

export function buildEquityStatement(input: {
  current: EquitySlice;
  comparative: EquitySlice;
  preComparative: EquitySlice;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  comparativePeriodStart: string;
  comparativePeriodEnd: string;
  includeOci: boolean;
}): ReportAmount[] {
  const hasOther = [input.current, input.comparative, input.preComparative]
    .some((slice) => !nearlyZero(slice.otherReserves));
  const columns = hasOther
    ? ["Share capital", "Other reserves", "Retained earnings", "Total"]
    : ["Share capital", "Retained earnings", "Total"];
  const notes = {
    "Share capital": "8",
    "Other reserves": "1",
    "Retained earnings": "1",
    Total: "1",
  };
  return [
    periodTable({
      heading: `Year ended ${formatStatementDate(input.currentPeriodEnd)}`,
      openingDate: formatStatementDate(input.currentPeriodStart),
      closingDate: formatStatementDate(input.currentPeriodEnd),
      opening: input.comparative,
      closing: input.current,
      includeOci: input.includeOci,
      columns,
      notes,
    }),
    periodTable({
      heading: `Year ended ${formatStatementDate(input.comparativePeriodEnd)}`,
      openingDate: formatStatementDate(input.comparativePeriodStart),
      closingDate: formatStatementDate(input.comparativePeriodEnd),
      opening: input.preComparative,
      closing: input.comparative,
      includeOci: input.includeOci,
      columns,
      notes,
    }),
  ];
}

function periodTieOut(period: ReportAmount | undefined, sofpEquity: number | undefined, heading: string) {
  const movementRows = period?.children ?? [];
  const columns = movementRows[0]?.children?.map((cell) => cell.label) ?? ["Total"];
  const opening = movementRows.find((row) => row.noteRef === EQUITY_MATRIX_KIND.opening);
  const closing = movementRows.find((row) => row.noteRef === EQUITY_MATRIX_KIND.closing);
  const movements = movementRows.filter((row) => row.noteRef !== EQUITY_MATRIX_KIND.opening && row.noteRef !== EQUITY_MATRIX_KIND.closing);
  const mismatches: string[] = [];
  for (const column of columns) {
    const start = opening?.children?.find((cell) => cell.label === column)?.current ?? 0;
    const end = closing?.children?.find((cell) => cell.label === column)?.current ?? 0;
    const change = movements.reduce((sum, row) => sum + (row.children?.find((cell) => cell.label === column)?.current ?? 0), 0);
    if (Math.abs(start + change - end) > NIL) {
      mismatches.push(`${heading} ${column} ${start.toFixed(2)} + ${change.toFixed(2)} != ${end.toFixed(2)}`);
    }
  }
  const closingTotal = closing?.current ?? 0;
  if (sofpEquity != null && Math.abs(closingTotal - sofpEquity) > NIL) {
    mismatches.push(`${heading} closing ${closingTotal.toFixed(2)} does not equal SOFP equity ${sofpEquity.toFixed(2)}`);
  }
  return { mismatches, closingTotal };
}

export function equityMatrixTieOut(rows: ReportAmount[], sofpEquity: number, comparativeSofpEquity?: number) {
  const current = periodTieOut(rows[0], sofpEquity, rows[0]?.label ?? "Current year");
  const comparative = rows[1]
    ? periodTieOut(rows[1], comparativeSofpEquity, rows[1].label)
    : { mismatches: [], closingTotal: 0 };
  const mismatches = [...current.mismatches, ...comparative.mismatches];
  return {
    ok: mismatches.length === 0,
    detail: mismatches.length
      ? mismatches.join("; ")
      : `Closing equity ${current.closingTotal.toFixed(2)} agrees with the statement of financial position.`,
    closingTotal: current.closingTotal,
  };
}

function tableAmount(value: number) {
  if (nearlyZero(value)) return "-";
  const display = Math.round(value).toLocaleString("en-US");
  return value < 0 ? `(${Math.abs(Math.round(value)).toLocaleString("en-US")})` : display;
}

export function equityMatrixLines(rows: ReportAmount[], showComparatives = true) {
  const periods = showComparatives ? rows : rows.slice(0, 1);
  const labelWidth = 32;
  const columnWidth = 20;
  return periods.flatMap((period, index) => {
    const movementRows = period.children ?? [];
    const columns = movementRows[0]?.children?.map((cell) => cell.label) ?? ["Total"];
    const header = `${"Movement".padEnd(labelWidth)}${columns.map((column) => column.slice(0, columnWidth - 1).padStart(columnWidth)).join("")}`;
    const body = movementRows.map((row) => {
      const cells = columns.map((column) => tableAmount(row.children?.find((cell) => cell.label === column)?.current ?? 0).padStart(columnWidth));
      return `${row.label.slice(0, labelWidth).padEnd(labelWidth)}${cells.join("")}`;
    });
    return [period.label, header, ...body, ...(index < periods.length - 1 ? [""] : [])];
  });
}
