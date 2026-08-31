import * as XLSX from "xlsx";

export const STATEMENT_LINE_EXPORT_MAX_IDS = 1000;

export type StatementLineExportRow = {
  date: string;
  description: string;
  direction: string;
  currency: string;
  amount: number;
  contactName: string;
  account: string;
  status: string;
  confidence: number | null;
  source: string;
  bankAccountName: string;
  functionalCurrency: string;
  functionalAmount: number | null;
};

export type StatementLineExportDocument = {
  clientName: string;
  generatedAt: string;
  rows: StatementLineExportRow[];
};

const EXCEL_HEADERS = [
  "Date",
  "Description",
  "Type",
  "Currency",
  "Amount",
  "Contact",
  "Account",
  "Status",
  "Confidence",
  "Source",
  "Bank account",
  "Functional currency",
  "Functional amount",
] as const;

function pdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7E]/g, "?");
}

function directionLabel(direction: string) {
  const value = direction.toLowerCase();
  if (value.includes("in") || value.includes("credit")) return "Receipt";
  if (value.includes("out") || value.includes("debit")) return "Payment";
  return direction;
}

function formatAmount(value: number, currency: string) {
  const absolute = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? "-" : ""}${absolute} ${currency}`;
}

function formatConfidence(value: number | null) {
  return value == null ? "" : `${Math.round(value * 100)}%`;
}

export function sanitizeExportFilename(clientName: string, format: "xlsx" | "pdf") {
  const slug = clientName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agaraccounting-ai";
  return `${slug}-statement-lines.${format}`;
}

export function statementLineExportWorkbook(document: StatementLineExportDocument) {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Client", document.clientName],
    ["Report", "Selected statement lines"],
    ["Generated", document.generatedAt],
    ["Lines", document.rows.length],
    [],
    [...EXCEL_HEADERS],
    ...document.rows.map((row) => [
      row.date,
      row.description,
      directionLabel(row.direction),
      row.currency,
      Number(row.amount.toFixed(2)),
      row.contactName,
      row.account,
      row.status,
      formatConfidence(row.confidence),
      row.source,
      row.bankAccountName,
      row.functionalCurrency,
      row.functionalAmount == null ? "" : Number(row.functionalAmount.toFixed(2)),
    ]),
  ]);
  sheet["!cols"] = [
    { wch: 12 },
    { wch: 42 },
    { wch: 10 },
    { wch: 10 },
    { wch: 14 },
    { wch: 24 },
    { wch: 24 },
    { wch: 10 },
    { wch: 12 },
    { wch: 16 },
    { wch: 22 },
    { wch: 16 },
    { wch: 16 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Statement lines");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function pageContent(lines: string[], page: number, pageCount: number, title: string) {
  const content = [
    "BT",
    "/F2 11 Tf",
    "36 560 Td",
    `(${pdfText(title)}) Tj`,
    "/F1 8 Tf",
    "0 -16 Td",
  ];
  let remaining = 500;
  for (const line of lines) {
    const wrapped = line.match(/.{1,118}(?:\s|$)|.{1,118}/g) ?? [line];
    for (const part of wrapped) {
      if (remaining < 18) break;
      content.push(`(${pdfText(part.trim())}) Tj`, "0 -11 Td");
      remaining -= 11;
    }
  }
  content.push("0 -10 Td", `/F1 7 Tf`, `(AgarAccounting AI System · selected statement lines · page ${page} of ${pageCount}) Tj`, "ET");
  return content.join("\n");
}

function assemblePdf(pages: string[][], title: string) {
  const objects: string[] = [];
  const add = (value: string) => {
    objects.push(value);
    return objects.length;
  };
  const catalog = add("");
  const pagesId = add("");
  const fontRegular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>");
  const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>");
  const pageObjectIds: number[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    const stream = pageContent(pages[index] ?? [], index + 1, pages.length, title);
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
    pageObjectIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function rowLine(row: StatementLineExportRow) {
  return [
    row.date,
    directionLabel(row.direction).padEnd(8),
    formatAmount(row.amount, row.currency).padStart(18),
    (row.contactName || "—").slice(0, 22).padEnd(22),
    (row.account || "—").slice(0, 22).padEnd(22),
    row.status.padEnd(8),
    row.description,
  ].join("  ");
}

export function statementLineExportPdf(document: StatementLineExportDocument) {
  const header = [
    document.clientName,
    `Selected statement lines · ${document.rows.length} line${document.rows.length === 1 ? "" : "s"}`,
    `Generated ${document.generatedAt}`,
    "",
    "Date        Type      Amount              Contact                 Account                 Status    Description",
  ];
  const body = document.rows.map(rowLine);
  const pages: string[][] = [];
  const perPage = 32;
  if (!body.length) {
    pages.push([...header, "No statement lines were included."]);
  } else {
    for (let index = 0; index < body.length; index += perPage) {
      pages.push(index === 0 ? [...header, ...body.slice(index, index + perPage)] : [
        `${document.clientName} · selected statement lines (continued)`,
        "",
        ...body.slice(index, index + perPage),
      ]);
    }
  }
  return assemblePdf(pages, "Selected statement lines");
}
