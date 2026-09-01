import { equityMatrixLines, isEquityMatrix } from "./equityStatement";
import type { ReportAmount, ReportNote, ReportSnapshot, ReportSignatory } from "./reportPack";

function pdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7E]/g, "?");
}

function money(value: number, currency: string) {
  const display = Math.round(value).toLocaleString("en-US");
  return value < 0 ? `(${Math.abs(Math.round(value)).toLocaleString("en-US")}) ${currency}` : `${display} ${currency}`;
}

function rowLines(rows: ReportAmount[], currency: string, indent = ""): string[] {
  return rows.flatMap((row) => [
    `${indent}${row.label} ${row.noteRef !== "—" ? `(${row.noteRef})` : ""}`.trim(),
    `${indent}  ${money(row.current, currency)}     ${money(row.comparative, currency)}`,
    ...(row.children ? rowLines(row.children, currency, `${indent}    `) : []),
  ]);
}

function equityStatementPdfLines(rows: ReportAmount[], currency: string) {
  if (isEquityMatrix(rows)) return equityMatrixLines(rows, true);
  return ["Current period | Comparative period", "", ...rowLines(rows, currency)];
}

function shareholdingLines(note: ReportNote) {
  if (!note.shareholding?.rows.length) return [];
  const header = "  Name  % age  Nationality  Number of Shares  Value";
  const rows = note.shareholding.rows.map((row) => {
    const percentage = `${Math.round(row.percentage)}%`;
    const value = Math.round(row.value).toLocaleString("en-US");
    return `  ${row.name}  ${percentage}  ${row.nationality ?? ""}  ${Math.round(row.numberOfShares).toLocaleString("en-US")}  ${value}`;
  });
  const totalShares = note.shareholding.rows.reduce((total, row) => total + row.numberOfShares, 0);
  const totalValue = note.shareholding.rows.reduce((total, row) => total + row.value, 0);
  const totalPercentage = note.shareholding.rows.reduce((total, row) => total + row.percentage, 0);
  return [
    header,
    ...rows,
    `  Total  ${Math.round(totalPercentage)}%    ${Math.round(totalShares).toLocaleString("en-US")}  ${Math.round(totalValue).toLocaleString("en-US")}`,
  ];
}

function noteLines(notes: ReportNote[], currency: string) {
  return notes.flatMap((note) => [
    `Note ${note.number}: ${note.title}`,
    note.narrative,
    ...note.tables.flatMap((row) => [`  ${row.label}: ${money(row.current, currency)} | ${money(row.comparative, currency)}`]),
    ...shareholdingLines(note),
    "",
  ]);
}

const PDF_BODY_LINES_PER_PAGE = 58;

function signaturePlaceholderLines() {
  return [
    "",
    "",
    "______________________________          ____________________",
    "Authorized signatory                    Date",
    "",
    "______________________________",
    "Name",
  ];
}

function withSignaturePlaceholder(lines: string[]) {
  return [...lines, ...signaturePlaceholderLines()];
}

function appendSignaturePlaceholder(pages: string[][]) {
  const last = pages[pages.length - 1] ?? [];
  const signature = signaturePlaceholderLines();
  if (last.length + signature.length <= PDF_BODY_LINES_PER_PAGE) {
    pages[pages.length - 1] = [...last, ...signature];
    return pages;
  }
  return [...pages, ["Notes to the financial statements", "", ...signature]];
}

function wrapPdfLines(lines: string[]) {
  return lines.flatMap((line) => {
    if (!line) return [""];
    return (line.match(/.{1,92}(?:\s|$)|.{1,92}/g) ?? [line]).map((part) => part.trim());
  });
}

function paginatePdfLines(lines: string[]) {
  const wrapped = wrapPdfLines(lines);
  const pages: string[][] = [];
  for (let index = 0; index < wrapped.length; index += PDF_BODY_LINES_PER_PAGE) {
    pages.push(wrapped.slice(index, index + PDF_BODY_LINES_PER_PAGE));
  }
  return pages.length ? pages : [[]];
}

function pageContent(lines: string[], page: number, title: string) {
  const content = [
    "BT",
    "/F2 10 Tf",
    "54 800 Td",
    `(${pdfText(title)}) Tj`,
    "/F1 8 Tf",
    "0 -18 Td",
  ];
  let remaining = 720;
  for (const line of wrapPdfLines(lines)) {
    if (remaining < 22) break;
    content.push(`(${pdfText(line)}) Tj`, "0 -12 Td");
    remaining -= 12;
  }
  content.push("0 -8 Td", `/F1 7 Tf`, `(AgarAccounting AI System report snapshot · page ${page}) Tj`, "ET");
  return content.join("\n");
}

export function buildReportPdf(snapshot: ReportSnapshot, signatory: ReportSignatory) {
  const currency = snapshot.presentationCurrency;
  const pageLines = [
    [
      snapshot.legalName,
      ...(snapshot.firmAttribution?.enabled && snapshot.firmAttribution.firmName
        ? [`Prepared by firm: ${snapshot.firmAttribution.firmName}`]
        : []),
      "",
      "Financial statements",
      `For the year ended ${snapshot.periodEnd}`,
      `Comparative period ended ${snapshot.comparativePeriodEnd}`,
      "",
      `${snapshot.reportingBasis} · ${snapshot.presentationProfile}`,
      `Presentation currency: ${currency}`,
      "",
      "Generated accounting output for human review only.",
      "This is not an audit opinion, statutory filing, tax return, or assurance conclusion.",
      "",
      `Prepared by: ${signatory.preparedBy || "Pending human review"}`,
      `Reviewed by: ${signatory.reviewedBy || "Pending human review"}`,
      `Authorized by: ${signatory.authorizedBy || "Pending human review"}`,
    ],
    withSignaturePlaceholder(["Statement of financial position", "Current period | Comparative period", "", ...rowLines(snapshot.statementOfFinancialPosition, currency)]),
    withSignaturePlaceholder(["Statement of profit or loss and other comprehensive income", "Current period | Comparative period", "", ...rowLines(snapshot.profitOrLossAndOci, currency)]),
    withSignaturePlaceholder(["Statement of changes in equity", "", ...equityStatementPdfLines(snapshot.changesInEquity, currency)]),
    withSignaturePlaceholder(["Statement of cash flows — indirect method", "Current period | Comparative period", "", ...rowLines(snapshot.cashFlows, currency)]),
    ...appendSignaturePlaceholder(paginatePdfLines(["Notes to the financial statements", "Current period | Comparative period", "", ...noteLines(snapshot.notes, currency)])),
    [
      "Authorization and source traceability",
      "",
      `Posted journal entries included: ${snapshot.traceability.postedEntryCount}`,
      `Linked statement lines included: ${snapshot.traceability.postedLineCount}`,
      `Source imports in client workspace: ${snapshot.traceability.sourceImportCount}`,
      "",
      "Each statement line stores source account, journal-entry, and evidence linkage in AgarAccounting AI System.",
      "",
      `Prepared by: ${signatory.preparedBy || "Pending"}`,
      `Reviewed by: ${signatory.reviewedBy || "Pending"}`,
      `Authorized by: ${signatory.authorizedBy || "Pending"}`,
      `Authorization date: ${signatory.authorizationDate || "Pending"}`,
    ],
  ];

  const objects: string[] = [];
  const add = (value: string) => {
    objects.push(value);
    return objects.length;
  };
  const catalog = add("");
  const pages = add("");
  const fontRegular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>");
  const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>");
  const pageObjectIds: number[] = [];
  for (let index = 0; index < pageLines.length; index += 1) {
    const stream = pageContent(pageLines[index], index + 1, snapshot.legalName);
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
    pageObjectIds.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objects[pages - 1] = `<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

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