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

const pdfRecordStart = /^(\d{4}-\d{2}-\d{2})(?:\s+(.*))?$/;
const monetaryToken = /\(?-?(?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2}\)?/g;

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
  const headerWindow = lines.slice(0, 100).join(" ").toLowerCase();
  const hasTransactionHeaders = ["date", "transaction", "debit", "credit", "balance"]
    .every((header) => new RegExp(`\\b${header}\\b`).test(headerWindow));
  const hasBankProvenance = /\b(iban|swift|bic|routing number|sort code)\b/i.test(lines.slice(0, 100).join(" "));
  return hasTransactionHeaders && hasBankProvenance;
}

export function parsePdfBankStatementRows(text: string, currency: string): ParsedPdfStatementLine[] {
  if (!hasPdfBankStatementTable(text)) return [];
  const lines = pdfStatementLines(text);
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
    if (!description) continue;

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
  return rows;
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