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
  return `/api/ledgerflow/statement-imports/${importId}/source`;
}