import { extname } from "node:path";

export const MAX_STATEMENT_FILE_SIZE = 50 * 1024 * 1024;
const MAX_XLSX_ARCHIVE_ENTRIES = 250;
const MAX_XLSX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_XLSX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_XLSX_COMPRESSION_RATIO = 50;

const supportedExtensions = new Set([".pdf", ".csv", ".xls", ".xlsx"]);
const supportedMimeTypes = new Set([
  "application/pdf",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);

const statementMimeTypesByExtension = new Map([
  [".pdf", "application/pdf"],
  [".csv", "text/csv"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
]);

export type ParsedPdfStatementLine = {
  date: string;
  description: string;
  amount: number;
  direction: "inflow" | "outflow";
  currency: string;
};

export type ParsedStatementDocument = {
  lines: ParsedPdfStatementLine[];
  openingBalance: number | null;
  closingBalance: number | null;
};

export type ParsedStatementAccountIdentity = {
  name: string | null;
  bankName: string | null;
  accountNumberLast4: string | null;
  currency: string;
};

export type ParsedStatementAccountGroup = {
  id: string;
  identity: ParsedStatementAccountIdentity;
  evidenceStatus: "identified" | "ambiguous";
  lines: ParsedPdfStatementLine[];
  openingBalance: number | null;
  closingBalance: number | null;
};

type DelimitedStatementColumns = {
  headerRowIndex: number;
  date: number;
  description: number;
  amount: number;
  debit: number;
  credit: number;
  balance: number;
};

const pdfRecordStart = /^(\d{4}-\d{2}-\d{2})(?:\s+(.*))?$/;
const monetaryToken = /\(?-?(?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2}\)?/g;
const signedStatementNumber = "-?(?:\\d{1,3}(?:,\\d{3})*|\\d+)(?:\\.\\d{1,2})?";
const wioRecord = new RegExp(`^(\\d{2}\\/\\d{2}\\/\\d{4})\\s+([A-Z0-9-]{5,})\\s+(.+?)\\s+(${signedStatementNumber})\\s+(${signedStatementNumber})$`, "i");

function monetaryValue(value: string) {
  const normalized = value.trim();
  const negative = normalized.startsWith("-") || (normalized.startsWith("(") && normalized.endsWith(")"));
  const amount = Number(normalized.replace(/[(),]/g, ""));
  return Number.isFinite(amount) ? (negative ? -Math.abs(amount) : amount) : null;
}

function monetaryValuesInLine(line: string) {
  return [...line.matchAll(monetaryToken)]
    .map((match) => monetaryValue(match[0]))
    .filter((value): value is number => value !== null);
}

function isLikelyReference(value: string) {
  return /^[A-Z0-9]{10,}$/i.test(value.trim());
}

function roundMoney(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function signedLineAmount(direction: "inflow" | "outflow", amount: number) {
  return direction === "inflow" ? amount : -amount;
}

function isOpeningBalanceDescription(value: string) {
  return /\bopening\s+balance\b/i.test(value);
}

function pdfStatementLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Parses bank-statement PDFs whose text extractor writes each printed column on
 * its own line (date, narrative, reference, amount, balance). The table header
 * and IBAN requirement keep this format-specific parser from treating generic
 * financial reports as transaction statements.
 */
export function hasPdfBankStatementTable(text: string) {
  const lines = pdfStatementLines(text);
  const fullText = lines.join(" ");
  const headerWindow = lines.slice(0, 100).join(" ").toLowerCase();
  const hasTransactionHeaders = ["date", "transaction", "debit", "credit", "balance"]
    .every((header) => new RegExp(`\\b${header}\\b`).test(headerWindow));
  const hasSignedAmountTable = /\bdate\b[\s\S]{0,80}\bref\.?\s*number\b[\s\S]{0,80}\bdescription\b[\s\S]{0,80}\bamount\b[\s\S]{0,80}\bbalance\b/i.test(text);
  const hasAccountProvenance = /\b(iban|swift|bic|routing number|sort code)\b/i.test(fullText);
  const hasNamedBankStatement = /\b(bank|account statement)\b/i.test(fullText);
  return hasTransactionHeaders && hasAccountProvenance
    || hasSignedAmountTable && hasAccountProvenance && hasNamedBankStatement;
}

export function parsePdfBankStatementDocument(text: string, currency: string): ParsedStatementDocument {
  const empty: ParsedStatementDocument = { lines: [], openingBalance: null, closingBalance: null };
  if (!hasPdfBankStatementTable(text)) return empty;
  const lines = pdfStatementLines(text);
  const signedAmountRows = lines.flatMap((line): Array<ParsedPdfStatementLine & { balance: number }> => {
    const match = line.match(wioRecord);
    if (!match) return [];
    const date = normalizeStatementDate(match[1], "day-first");
    const amount = monetaryValue(match[4]);
    const balance = monetaryValue(match[5]);
    if (!date || amount == null || amount === 0 || balance == null) return [];
    return [{
      date,
      description: match[3].replace(/\s+/g, " ").trim(),
      amount: Math.abs(amount),
      direction: amount < 0 ? "outflow" : "inflow",
      currency,
      balance,
    }];
  });
  if (signedAmountRows.length) {
    const first = signedAmountRows[0];
    return {
      lines: signedAmountRows.map(({ balance: _balance, ...line }) => line),
      openingBalance: roundMoney(first.balance - signedLineAmount(first.direction, first.amount)),
      closingBalance: roundMoney(signedAmountRows.at(-1)?.balance),
    };
  }
  const dateIndexes = lines
    .map((line, index) => (pdfRecordStart.test(line) ? index : -1))
    .filter((index) => index >= 0);
  const openingBalanceIndex = lines.findIndex((line) => /^opening balance\b/i.test(line));
  let previousBalance: number | null = null;
  if (openingBalanceIndex >= 0) {
    previousBalance = monetaryValuesInLine(lines[openingBalanceIndex]).at(-1)
      ?? lines.slice(openingBalanceIndex + 1).flatMap(monetaryValuesInLine).at(0)
      ?? null;
  }
  const openingBalance = roundMoney(previousBalance);

  const rows: ParsedPdfStatementLine[] = [];
  for (let index = 0; index < dateIndexes.length; index += 1) {
    const start = dateIndexes[index];
    const end = dateIndexes[index + 1] ?? lines.length;
    const startMatch = lines[start].match(pdfRecordStart);
    if (!startMatch) continue;
    const record = [startMatch[2] ?? "", ...lines.slice(start + 1, end)];
    const monetaryValues = record.flatMap((line, recordIndex) =>
      monetaryValuesInLine(line).map((value) => ({ recordIndex, value })),
    );
    if (monetaryValues.length < 2) continue;

    const transactionValueCells = record
      .map((line, recordIndex) => ({ recordIndex, values: monetaryValuesInLine(line) }))
      .find((item) => item.values.length >= 2);
    const amountCell = transactionValueCells
      ? { recordIndex: transactionValueCells.recordIndex, value: transactionValueCells.values.at(-2)! }
      : monetaryValues.at(-2);
    const balanceCell = transactionValueCells
      ? { recordIndex: transactionValueCells.recordIndex, value: transactionValueCells.values.at(-1)! }
      : monetaryValues.at(-1);
    if (!amountCell || !balanceCell) continue;
    const description = record
      .slice(0, amountCell.recordIndex)
      .filter((line) => !/^page \d+ of \d+$/i.test(line) && !isLikelyReference(line))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!description || isOpeningBalanceDescription(description)) continue;

    const balanceChange = previousBalance == null ? null : balanceCell.value - previousBalance;
    const amount = Math.abs(amountCell.value);
    const direction = balanceChange != null && balanceChange > 0 ? "inflow" : "outflow";
    if (amount <= 0) continue;

    rows.push({
      date: startMatch[1],
      description,
      amount,
      direction,
      currency,
    });
    previousBalance = balanceCell.value;
  }
  return {
    lines: rows,
    openingBalance,
    closingBalance: rows.length ? roundMoney(previousBalance) : openingBalance,
  };
}

export function parsePdfBankStatementRows(text: string, currency: string): ParsedPdfStatementLine[] {
  return parsePdfBankStatementDocument(text, currency).lines;
}

export function delimitedRows(text: string, sampleLines = 20) {
  const normalizedText = text.replace(/^\uFEFF/, "");
  const delimiterSample = normalizedText.split(/\r?\n/).slice(0, sampleLines).join("\n");
  const delimiter = [",", ";", "\t"].reduce((best, candidate) => {
    const count = [...delimiterSample].filter((character) => character === candidate).length;
    return count > best.count ? { value: candidate, count } : best;
  }, { value: ",", count: -1 }).value;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < normalizedText.length; index += 1) {
    const character = normalizedText[index];
    const next = normalizedText[index + 1];
    if (character === "\"") {
      if (quoted && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function delimitedStatementColumns(rows: string[][]): DelimitedStatementColumns | null {
  for (let headerRowIndex = 0; headerRowIndex < Math.min(rows.length, 30); headerRowIndex += 1) {
    const headers = rows[headerRowIndex].map((cell) => cell.trim().toLowerCase());
    const date = headers.findIndex((header) => /\b(date|transaction date|value date)\b/.test(header));
    const descriptionColumn = headers.findIndex((header) => /\b(description|narration|narrative|details|transaction|memo|remarks|particulars)\b/.test(header));
    const referenceColumn = headers.findIndex((header) => /\breference\b/.test(header));
    const description = descriptionColumn >= 0 ? descriptionColumn : referenceColumn;
    const debit = headers.findIndex((header) => /\b(debit|withdrawal|paid out)\b/.test(header));
    const credit = headers.findIndex((header) => /\b(credit|deposit|paid in)\b/.test(header));
    const amount = headers.findIndex((header) => /\b(amount|transaction amount|value)\b/.test(header));
    const balance = headers.findIndex((header) => /\bbalance\b/.test(header));
    if (date >= 0 && description >= 0 && (amount >= 0 || debit >= 0 || credit >= 0)) {
      return { headerRowIndex, date, description, amount, debit, credit, balance };
    }
  }
  return null;
}

function labeledValue(rows: string[][], labels: RegExp) {
  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const row = rows[rowIndex] ?? [];
    for (let index = row.length - 1; index >= 0; index -= 1) {
      const cell = row[index]?.trim() ?? "";
      if (!labels.test(cell)) continue;
      const inline = cell.match(/[:#-]\s*(.+)$/)?.[1]?.trim();
      const next = row[index + 1]?.trim();
      if (inline) return inline;
      if (next && !labels.test(next)) return next;
    }
  }
  return null;
}

function statementCurrencyFromSectionText(text: string, fallbackCurrency: string) {
  const labeled = text.match(/\b(?:account\s+currency|currency|currency\s+code|ccy)\b\s*[:#-]?\s*([A-Z]{3})\b/i)?.[1]?.toUpperCase();
  if (labeled) return labeled;
  const explicit = [...text.matchAll(/\b(AED|USD|EUR|GBP|CAD|AUD|CHF|JPY|SAR|QAR|KWD|BHD|OMR)\b/gi)]
    .map((match) => match[1]?.toUpperCase())
    .filter((value): value is string => Boolean(value));
  return new Set(explicit).size === 1 ? explicit[0] : fallbackCurrency;
}

function parsedDelimitedDocument(rows: string[][], currency: string): ParsedStatementDocument {
  const empty: ParsedStatementDocument = { lines: [], openingBalance: null, closingBalance: null };
  const columns = delimitedStatementColumns(rows);
  if (!columns) return empty;
  const bodyRows = rows.slice(columns.headerRowIndex + 1);
  const numericDateOrder = inferNumericDateOrder(bodyRows.map((row) => row[columns.date] ?? ""));
  let labeledOpening: number | null = null;
  let firstBalance: number | null = null;
  let firstSignedAmount: number | null = null;
  let lastBalance: number | null = null;

  const lines = bodyRows.flatMap((cells): ParsedPdfStatementLine[] => {
    const description = (cells[columns.description] ?? "").replace(/\s+/g, " ").trim() || "Imported bank activity";
    const rowBalanceCell = columns.balance >= 0 ? (cells[columns.balance] ?? "").trim() : "";
    const rowBalance = rowBalanceCell ? numericCell(rowBalanceCell) : null;
    if (isOpeningBalanceDescription(description) || isOpeningBalanceDescription(cells.join(" "))) {
      const opening = rowBalance ?? numericCell(cells.at(-1) ?? "");
      if (opening) labeledOpening = opening;
      return [];
    }
    const date = normalizeStatementDate(cells[columns.date] ?? "", numericDateOrder);
    if (!date) return [];
    const debit = columns.debit >= 0 ? Math.abs(numericCell(cells[columns.debit] ?? "")) : 0;
    const credit = columns.credit >= 0 ? Math.abs(numericCell(cells[columns.credit] ?? "")) : 0;
    const amountValue = columns.amount >= 0 ? numericCell(cells[columns.amount] ?? "") : 0;
    const hasDebitCreditColumns = columns.debit >= 0 || columns.credit >= 0;
    if (hasDebitCreditColumns && debit > 0 && credit > 0) return [];
    const amount = hasDebitCreditColumns ? debit || credit : Math.abs(amountValue);
    if (amount <= 0) return [];
    const direction = hasDebitCreditColumns
      ? (debit > 0 ? "outflow" : "inflow")
      : (amountValue < 0 ? "outflow" : "inflow");
    if (rowBalance != null) {
      lastBalance = rowBalance;
      if (firstBalance == null) {
        firstBalance = rowBalance;
        firstSignedAmount = signedLineAmount(direction, amount);
      }
    }
    return [{ date, description, amount, direction, currency }];
  });

  const inferredOpening = firstBalance != null && firstSignedAmount != null
    ? firstBalance - firstSignedAmount
    : null;
  return {
    lines,
    openingBalance: roundMoney(labeledOpening ?? inferredOpening),
    closingBalance: roundMoney(lastBalance ?? labeledOpening),
  };
}

const statementMonths = new Map([
  ["jan", 1], ["january", 1],
  ["feb", 2], ["february", 2],
  ["mar", 3], ["march", 3],
  ["apr", 4], ["april", 4],
  ["may", 5],
  ["jun", 6], ["june", 6],
  ["jul", 7], ["july", 7],
  ["aug", 8], ["august", 8],
  ["sep", 9], ["sept", 9], ["september", 9],
  ["oct", 10], ["october", 10],
  ["nov", 11], ["november", 11],
  ["dec", 12], ["december", 12],
]);

function isoDate(year: number, month: number, day: number) {
  const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day
    ? candidate
    : null;
}

type NumericDateOrder = "day-first" | "month-first" | null;

function inferNumericDateOrder(values: string[]): NumericDateOrder {
  let foundDayFirst = false;
  let foundMonthFirst = false;
  for (const value of values) {
    const match = value.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (!match) continue;
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first > 12 && second <= 12) foundDayFirst = true;
    if (second > 12 && first <= 12) foundMonthFirst = true;
  }
  if (foundDayFirst && foundMonthFirst) return null;
  if (!foundDayFirst && !foundMonthFirst) return "day-first";
  return foundDayFirst ? "day-first" : "month-first";
}

export function normalizeStatementDate(value: string, numericDateOrder: NumericDateOrder = null) {
  const trimmed = value.trim().replace(/^"|"$/g, "");
  const yearFirst = trimmed.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (yearFirst) return isoDate(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]));

  const dayMonthName = trimmed.match(/^(\d{1,2})[\s./-]+([a-z]{3,9})[\s,./-]+(\d{4})$/i);
  if (dayMonthName) {
    const month = statementMonths.get(dayMonthName[2].toLowerCase());
    return month ? isoDate(Number(dayMonthName[3]), month, Number(dayMonthName[1])) : null;
  }

  const monthNameDay = trimmed.match(/^([a-z]{3,9})[\s./-]+(\d{1,2}),?[\s./-]+(\d{4})$/i);
  if (monthNameDay) {
    const month = statementMonths.get(monthNameDay[1].toLowerCase());
    return month ? isoDate(Number(monthNameDay[3]), month, Number(monthNameDay[2])) : null;
  }

  const numeric = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!numeric) return null;
  const first = Number(numeric[1]);
  const second = Number(numeric[2]);
  const year = Number(numeric[3]);
  const order = first > 12
    ? "day-first"
    : second > 12
      ? "month-first"
      : numericDateOrder;
  if (!order) return null;
  return order === "day-first"
    ? isoDate(year, second, first)
    : isoDate(year, first, second);
}

function numericCell(value: string) {
  const normalized = value.trim();
  const negative = normalized.startsWith("-") || (normalized.startsWith("(") && normalized.endsWith(")"));
  const numeric = Number(normalized.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  return negative ? -Math.abs(numeric) : numeric;
}

export function parseDelimitedBankStatementRows(text: string, currency: string): ParsedPdfStatementLine[] {
  return parseDelimitedBankStatementDocument(text, currency).lines;
}

export function parseDelimitedBankStatementDocument(text: string, currency: string): ParsedStatementDocument {
  return parsedDelimitedDocument(delimitedRows(text), currency);
}

export function parseDelimitedBankStatementSections(
  text: string,
  fallbackCurrency: string,
): ParsedStatementAccountGroup[] {
  const rows = delimitedRows(text);
  const headerRows = rows
    .map((row, index) => delimitedStatementColumns([row]) ? index : -1)
    .filter((index) => index >= 0);
  if (!headerRows.length) return [];
  return headerRows.flatMap((headerRowIndex, sectionIndex) => {
    const sectionRows = rows.slice(headerRowIndex, headerRows[sectionIndex + 1] ?? rows.length);
    const metadataRows = rows.slice(Math.max(0, headerRowIndex - 12), headerRowIndex + 1);
    const metadata = metadataRows.flat().join(" ");
    const accountNumber = labeledValue(metadataRows, /account\s*(?:number|no\.?|#)|iban/i);
    const accountNumberLast4 = accountNumber ? accountNumber.replace(/\D/g, "").slice(-4) || null : null;
    const holder = labeledValue(metadataRows, /account\s*(?:holder|name|title)|account\s*holder\s*name/i);
    const bankName = labeledValue(metadataRows, /^(?:bank\s+(?:name|title)|financial\s+institution)$/i);
    const currency = labeledValue(metadataRows, /account\s+currency|currency\s+code|^currency$|^ccy$/i)?.toUpperCase()
      ?? statementCurrencyFromSectionText(metadata, fallbackCurrency);
    const name = holder || (accountNumberLast4 ? `Account ending ${accountNumberLast4}` : null);
    const document = parsedDelimitedDocument(sectionRows, currency);
    if (!document.lines.length) return [];
    return [{
      id: `section-${sectionIndex + 1}`,
      identity: { name, bankName, accountNumberLast4, currency },
      evidenceStatus: name || bankName || accountNumberLast4 ? "identified" : "ambiguous",
      lines: document.lines,
      openingBalance: document.openingBalance,
      closingBalance: document.closingBalance,
    }];
  });
}

export function parsePdfBankStatementSections(
  text: string,
  fallbackCurrency: string,
): ParsedStatementAccountGroup[] {
  const lines = pdfStatementLines(text);
  const usesHolderBoundaries = lines.filter((line) => /^account\s+holder\s+name\b/i.test(line)).length > 1;
  const accountStarts = lines
    .map((line, index) => ((usesHolderBoundaries
      ? /^account\s+holder\s+name\b/i
      : /^account\s+(?:number|no\.?|#)\b/i).test(line) ? index : -1))
    .filter((index) => index >= 0);
  const boundaries = accountStarts.length > 1 ? accountStarts : [0];
  return boundaries.flatMap((start, sectionIndex) => {
    const end = accountStarts[sectionIndex + 1] ?? lines.length;
    const sectionLines = lines.slice(start, end);
    const sectionText = sectionLines.join("\n");
    const valueAfter = (label: RegExp) => {
      const labelIndex = sectionLines.findIndex((line) => label.test(line));
      return labelIndex >= 0 ? sectionLines[labelIndex + 1]?.trim() ?? null : null;
    };
    const accountNumber = valueAfter(/^account\s+(?:number|no\.?|#)$/i)
      ?? valueAfter(/^iban$/i)
      ?? sectionText.match(/\b(?:account\s+(?:number|no\.?|#)|iban)\b\s*[:#-]?\s*([A-Z0-9 -]{4,})/i)?.[1]?.trim()
      ?? null;
    const accountNumberLast4 = accountNumber?.replace(/\D/g, "").slice(-4) || null;
    const holder = valueAfter(/^account\s+name$/i)
      ?? valueAfter(/^account\s+holder(?:\s+name)?$/i)
      ?? valueAfter(/^account\s+title$/i)
      ?? sectionText.match(/\b(?:account\s+holder(?:\s+name)?|account\s+name|account\s+title)\b\s*[:#-]\s*(.+)/i)?.[1]?.trim()
      ?? null;
    const bankName = valueAfter(/^bank\s+name$/i)
      ?? (/\bwio\s+(?:bank|business)\b/i.test(sectionText) ? "Wio Bank" : null);
    const currency = valueAfter(/^currency$/i)?.toUpperCase()
      ?? valueAfter(/^account\s+currency$/i)?.toUpperCase()
      ?? statementCurrencyFromSectionText(sectionText, fallbackCurrency);
    const parsed = parsePdfBankStatementDocument(sectionText, currency);
    if (!parsed.lines.length) return [];
    const name = holder || (accountNumberLast4 ? `Account ending ${accountNumberLast4}` : null);
    return [{
      id: `section-${sectionIndex + 1}`,
      identity: { name, bankName, accountNumberLast4, currency },
      evidenceStatus: name || bankName || accountNumberLast4 ? "identified" : "ambiguous",
      lines: parsed.lines,
      openingBalance: parsed.openingBalance,
      closingBalance: parsed.closingBalance,
    }];
  });
}

export function hasDelimitedBankStatementStructure(
  text: string,
  parsedRows: ParsedPdfStatementLine[],
  hasSelectedBankAccount: boolean,
) {
  const rows = delimitedRows(text);
  const columns = delimitedStatementColumns(rows);
  if (!columns) return false;
  const hasExplicitTransactionColumns = columns.debit >= 0 || columns.credit >= 0 || columns.balance >= 0;
  const hasMixedTransactionDirections = parsedRows.length >= 2
    && new Set(parsedRows.map((line) => line.direction)).size > 1;
  const accountSummary = rows
    .slice(0, columns.headerRowIndex + 1)
    .flat()
    .join(" ");
  const hasBankStatementTitle = /\b(?:bank statement|account transactions? statement(?: report)?|account statement)\b/i.test(accountSummary);
  const hasBankAccountIdentifier = /\b(iban|swift|bic|routing number|sort code)\b[\s:#-]*[a-z0-9]/i.test(accountSummary);
  const hasBankProvenance = hasBankStatementTitle || hasBankAccountIdentifier;
  return (hasExplicitTransactionColumns || hasMixedTransactionDirections)
    && (hasBankProvenance || hasSelectedBankAccount);
}

export function validateStatementMetadata(fileName: string, mimeType: string, size: number) {
  const extension = extname(fileName).toLocaleLowerCase();
  if (!supportedExtensions.has(extension)) {
    return "Statement files must be PDF, CSV, XLS, or XLSX.";
  }
  if (!Number.isInteger(size) || size <= 0 || size > MAX_STATEMENT_FILE_SIZE) {
    return `Statement files must be between 1 byte and ${Math.round(MAX_STATEMENT_FILE_SIZE / 1024 / 1024)} MB.`;
  }
  if (!supportedMimeTypes.has(mimeType.toLocaleLowerCase())) {
    return "The statement file type is not supported.";
  }
  if (extension === ".pdf" && mimeType !== "application/pdf" && mimeType !== "application/octet-stream") {
    return "The statement file type does not match its .pdf extension.";
  }
  if (extension === ".csv" && !["text/csv", "application/csv", "application/octet-stream"].includes(mimeType)) {
    return "The statement file type does not match its .csv extension.";
  }
  if ([".xls", ".xlsx"].includes(extension) && ![
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
  ].includes(mimeType)) {
    return "The statement file type does not match its Excel extension.";
  }
  return null;
}

export function statementSourceContentType(fileName: string, mimeType: string) {
  const extensionType = statementMimeTypesByExtension.get(extname(fileName).toLocaleLowerCase());
  if (extensionType) return extensionType;
  return supportedMimeTypes.has(mimeType.toLocaleLowerCase())
    ? mimeType.toLocaleLowerCase()
    : "application/octet-stream";
}

export function safeStatementFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_") || "statement-source";
}

export function scopedStatementObjectPath(userId: string, clientId: number, objectPath: string) {
  return objectPath === `/objects/uploads/${encodeURIComponent(userId)}/${clientId}/${objectPath.split("/").at(-1)}`;
}

export function statementObjectPathForClient(clientId: number, objectPath: string) {
  return new RegExp(`^/objects/uploads/[^/]+/${clientId}/[^/]+$`).test(objectPath);
}

export function validateStatementContents(fileName: string, buffer: Buffer) {
  const extension = extname(fileName).toLocaleLowerCase();
  if (extension === ".pdf") {
    return buffer.subarray(0, 5).toString("ascii") === "%PDF-" ? null : "The uploaded file is not a valid PDF statement.";
  }
  if (extension === ".xlsx") {
    return buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
      ? null
      : "The uploaded file is not a valid XLSX statement.";
  }
  if (extension === ".xls") {
    return buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
      ? null
      : "The uploaded file is not a valid XLS statement.";
  }
  if (buffer.includes(0)) return "The uploaded file is not a valid CSV statement.";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return null;
  } catch {
    return "The uploaded file is not a valid UTF-8 CSV statement.";
  }
}

export function validateXlsxArchive(buffer: Buffer) {
  const endOfCentralDirectory = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOfCentralDirectory < 0 || endOfCentralDirectory + 22 > buffer.length) {
    return "The uploaded XLSX statement has an invalid archive structure.";
  }
  const entryCount = buffer.readUInt16LE(endOfCentralDirectory + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(endOfCentralDirectory + 16);
  if (entryCount > MAX_XLSX_ARCHIVE_ENTRIES || centralDirectoryOffset >= buffer.length) {
    return "The uploaded XLSX statement exceeds safe archive limits.";
  }
  let cursor = centralDirectoryOffset;
  let uncompressedTotal = 0;
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      return "The uploaded XLSX statement has an invalid archive structure.";
    }
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    if (uncompressedSize > MAX_XLSX_ENTRY_BYTES
      || uncompressedSize > MAX_XLSX_UNCOMPRESSED_BYTES
      || (compressedSize > 0 && uncompressedSize / compressedSize > MAX_XLSX_COMPRESSION_RATIO)) {
      return "The uploaded XLSX statement exceeds safe archive limits.";
    }
    uncompressedTotal += uncompressedSize;
    if (uncompressedTotal > MAX_XLSX_UNCOMPRESSED_BYTES) {
      return "The uploaded XLSX statement exceeds safe archive limits.";
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

export function statementSourceUrl(importId: number) {
  return `/api/agaraccounting/statement-imports/${importId}/source`;
}