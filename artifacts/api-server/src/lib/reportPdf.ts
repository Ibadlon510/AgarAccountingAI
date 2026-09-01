import { PDFDocument, type CanvasRenderingContext2D } from "@napi-rs/canvas";
import { isEquityMatrix } from "./equityStatement";
import type { ReportAmount, ReportNote, ReportSnapshot, ReportSignatory } from "./reportPack";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_X = 54;
const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN_X * 2);
const COLORS = {
  paper: "#fbfaf5",
  ink: "#20272b",
  muted: "#687176",
  rule: "#d8d4c8",
  strongRule: "#697074",
  primary: "#265c43",
};

type PdfContext = CanvasRenderingContext2D;

function setFont(ctx: PdfContext, size: number, family: "sans" | "serif" | "mono" = "sans", weight = 400) {
  const fontFamily = family === "serif"
    ? "Georgia"
    : family === "mono"
      ? "DejaVu Sans Mono"
      : "DejaVu Sans";
  ctx.font = `${weight} ${size}px "${fontFamily}"`;
}

function money(value: number) {
  if (Math.abs(value) < 0.005) return "—";
  const display = Math.abs(Math.round(value)).toLocaleString("en-US");
  return value < 0 ? `(${display})` : display;
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function startPage(document: PDFDocument) {
  const ctx = document.beginPage(PAGE_WIDTH, PAGE_HEIGHT);
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  ctx.fillStyle = COLORS.ink;
  ctx.textBaseline = "alphabetic";
  return ctx;
}

function centeredText(ctx: PdfContext, text: string, y: number) {
  ctx.fillText(text, (PAGE_WIDTH - ctx.measureText(text).width) / 2, y);
}

function line(ctx: PdfContext, x1: number, y1: number, x2: number, y2: number, color = COLORS.rule, width = 0.65) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function wrapText(ctx: PdfContext, text: string, maxWidth: number) {
  const paragraphs = text.split(/\n/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let current = words[0];
    for (const word of words.slice(1)) {
      const candidate = `${current} ${word}`;
      if (ctx.measureText(candidate).width <= maxWidth) current = candidate;
      else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines;
}

function drawWrappedText(ctx: PdfContext, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const lines = wrapText(ctx, text, maxWidth);
  lines.forEach((value, index) => ctx.fillText(value, x, y + (index * lineHeight)));
  return y + (lines.length * lineHeight);
}

function drawFooter(ctx: PdfContext, pageNumber: number, legalName: string) {
  line(ctx, MARGIN_X, 805, PAGE_WIDTH - MARGIN_X, 805, COLORS.rule);
  setFont(ctx, 7.5, "sans", 400);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(legalName, MARGIN_X, 821);
  const label = `AgarAccounting AI System · ${pageNumber}`;
  ctx.fillText(label, PAGE_WIDTH - MARGIN_X - ctx.measureText(label).width, 821);
}

function drawSignature(ctx: PdfContext, y: number) {
  const firstWidth = 246;
  const secondX = MARGIN_X + 286;
  line(ctx, MARGIN_X, y, MARGIN_X + firstWidth, y, COLORS.strongRule, 0.8);
  line(ctx, secondX, y, PAGE_WIDTH - MARGIN_X, y, COLORS.strongRule, 0.8);
  setFont(ctx, 7.5, "sans", 500);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText("AUTHORIZED SIGNATORY", MARGIN_X, y + 13);
  ctx.fillText("DATE", secondX, y + 13);
  line(ctx, MARGIN_X, y + 49, MARGIN_X + 176, y + 49, COLORS.strongRule, 0.8);
  ctx.fillText("NAME", MARGIN_X, y + 62);
}

function drawPageHeading(ctx: PdfContext, title: string, subtitle: string) {
  let titleSize = 22;
  setFont(ctx, titleSize, "serif", 500);
  while (ctx.measureText(title).width > CONTENT_WIDTH && titleSize > 15) {
    titleSize -= 1;
    setFont(ctx, titleSize, "serif", 500);
  }
  ctx.fillStyle = COLORS.ink;
  centeredText(ctx, title, 76);
  setFont(ctx, 7.5, "mono", 600);
  ctx.fillStyle = COLORS.muted;
  centeredText(ctx, subtitle.toUpperCase(), 96);
}

function flattenRows(rows: ReportAmount[], level = 0): Array<{ row: ReportAmount; level: number }> {
  return rows.flatMap((row) => [
    { row, level },
    ...(row.children ? flattenRows(row.children, level + 1) : []),
  ]);
}

function isTotalRow(row: ReportAmount, level: number) {
  return level === 0 && /^(Total|Profit for the year|Total comprehensive income|Closing equity|Cash at end of year)/i.test(row.label);
}

function drawStatementPage(
  document: PDFDocument,
  pageNumber: number,
  legalName: string,
  title: string,
  rows: ReportAmount[],
  currency: string,
  showComparatives: boolean,
) {
  const ctx = startPage(document);
  drawPageHeading(ctx, title, `${currency} · ${showComparatives ? "Current year / comparative year" : "Current year"}`);
  const currentX = showComparatives ? 427 : 520;
  const comparativeX = 541;
  let y = 130;
  line(ctx, MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y, COLORS.strongRule, 0.7);
  setFont(ctx, 7.5, "mono", 600);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText("STATEMENT LINE", MARGIN_X, y + 15);
  ctx.textAlign = "right";
  ctx.fillText(showComparatives ? "CURRENT" : currency, currentX, y + 15);
  if (showComparatives) ctx.fillText("COMPARATIVE", comparativeX, y + 15);
  ctx.textAlign = "left";
  line(ctx, MARGIN_X, y + 24, PAGE_WIDTH - MARGIN_X, y + 24, COLORS.strongRule, 0.7);
  y += 25;

  for (const { row, level } of flattenRows(rows)) {
    const total = isTotalRow(row, level);
    const height = 24;
    if (total) line(ctx, MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y, COLORS.strongRule, 0.65);
    setFont(ctx, level ? 8.5 : 9.5, "sans", level ? 400 : 600);
    ctx.fillStyle = level ? COLORS.muted : COLORS.ink;
    const labelX = MARGIN_X + Math.min(level, 4) * 16;
    const noteSuffix = row.noteRef !== "—" ? `   Note ${row.noteRef}` : "";
    ctx.fillText(`${row.label}${noteSuffix}`, labelX, y + 15);
    setFont(ctx, 8.5, "mono", row.children?.length ? 600 : 400);
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = "right";
    ctx.fillText(money(row.current), currentX, y + 15);
    if (showComparatives) {
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(money(row.comparative), comparativeX, y + 15);
    }
    ctx.textAlign = "left";
    line(ctx, MARGIN_X, y + height, PAGE_WIDTH - MARGIN_X, y + height, COLORS.rule, 0.45);
    y += height;
  }
  drawSignature(ctx, Math.max(690, y + 54));
  drawFooter(ctx, pageNumber, legalName);
  document.endPage();
}

function drawEquityPage(
  document: PDFDocument,
  pageNumber: number,
  snapshot: ReportSnapshot,
  showComparatives: boolean,
) {
  if (!isEquityMatrix(snapshot.changesInEquity)) {
    drawStatementPage(
      document,
      pageNumber,
      snapshot.legalName,
      "Statement of changes in equity",
      snapshot.changesInEquity,
      snapshot.presentationCurrency,
      showComparatives,
    );
    return;
  }
  const ctx = startPage(document);
  drawPageHeading(
    ctx,
    "Statement of changes in equity",
    `${snapshot.presentationCurrency} · ${showComparatives ? "Current year and comparative year" : "Current year"}`,
  );
  const periods = showComparatives ? snapshot.changesInEquity : snapshot.changesInEquity.slice(0, 1);
  let y = 132;
  for (const period of periods) {
    setFont(ctx, 9.5, "sans", 600);
    ctx.fillStyle = COLORS.ink;
    centeredText(ctx, period.label, y);
    y += 20;
    const movementRows = period.children ?? [];
    const columns = movementRows[0]?.children?.map((cell) => cell.label) ?? ["Total"];
    const movementWidth = 205;
    const cellWidth = (CONTENT_WIDTH - movementWidth) / columns.length;
    setFont(ctx, 6.8, "mono", 600);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(snapshot.presentationCurrency, MARGIN_X, y + 12);
    ctx.textAlign = "right";
    columns.forEach((column, index) => {
      const x = MARGIN_X + movementWidth + ((index + 1) * cellWidth);
      ctx.fillText(column.toUpperCase(), x, y + 12);
    });
    ctx.textAlign = "left";
    line(ctx, MARGIN_X, y + 19, PAGE_WIDTH - MARGIN_X, y + 19, COLORS.strongRule, 0.65);
    y += 20;
    for (const row of movementRows) {
      const emphasized = row.noteRef === "opening" || row.noteRef === "closing";
      if (row.noteRef === "closing") line(ctx, MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y, COLORS.strongRule, 0.65);
      setFont(ctx, 8, "sans", emphasized ? 600 : 400);
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(row.label, MARGIN_X, y + 14);
      setFont(ctx, 7.6, "mono", emphasized ? 600 : 400);
      ctx.textAlign = "right";
      columns.forEach((column, index) => {
        const value = row.children?.find((cell) => cell.label === column)?.current ?? 0;
        const x = MARGIN_X + movementWidth + ((index + 1) * cellWidth);
        ctx.fillText(money(value), x, y + 14);
      });
      ctx.textAlign = "left";
      line(ctx, MARGIN_X, y + 21, PAGE_WIDTH - MARGIN_X, y + 21, COLORS.rule, 0.45);
      if (row.noteRef === "closing") line(ctx, MARGIN_X, y + 24, PAGE_WIDTH - MARGIN_X, y + 24, COLORS.strongRule, 0.65);
      y += 25;
    }
    y += 25;
  }
  drawSignature(ctx, Math.max(690, y + 30));
  drawFooter(ctx, pageNumber, snapshot.legalName);
  document.endPage();
}

function noteHeight(note: ReportNote, ctx: PdfContext, showComparatives: boolean) {
  setFont(ctx, 8.5, "sans", 400);
  const narrativeLines = wrapText(ctx, note.narrative, CONTENT_WIDTH).length;
  const tableHeight = note.tables.length ? 22 + (note.tables.length * 18) : 0;
  const shareholdingHeight = note.shareholding?.rows.length ? 28 + ((note.shareholding.rows.length + 1) * 18) : 0;
  return 26 + (narrativeLines * 13) + tableHeight + shareholdingHeight + (showComparatives ? 0 : 0) + 18;
}

function drawNote(ctx: PdfContext, note: ReportNote, y: number, currency: string, showComparatives: boolean) {
  setFont(ctx, 9.5, "sans", 600);
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(`Note ${note.number} — ${note.title}`, MARGIN_X, y);
  y += 18;
  setFont(ctx, 8.5, "sans", 400);
  ctx.fillStyle = COLORS.muted;
  y = drawWrappedText(ctx, note.narrative, MARGIN_X, y, CONTENT_WIDTH, 13) + 6;

  if (note.tables.length) {
    const currentX = showComparatives ? 430 : 541;
    const comparativeX = 541;
    line(ctx, MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y, COLORS.rule);
    y += 14;
    setFont(ctx, 7, "mono", 600);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText("GENERATED TABLE", MARGIN_X, y);
    ctx.textAlign = "right";
    ctx.fillText(showComparatives ? "CURRENT" : currency, currentX, y);
    if (showComparatives) ctx.fillText("COMPARATIVE", comparativeX, y);
    ctx.textAlign = "left";
    y += 9;
    for (const row of note.tables) {
      line(ctx, MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y, COLORS.rule, 0.4);
      setFont(ctx, 8, "sans", 400);
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(row.label, MARGIN_X, y + 13);
      setFont(ctx, 7.8, "mono", 400);
      ctx.textAlign = "right";
      ctx.fillText(money(row.current), currentX, y + 13);
      if (showComparatives) {
        ctx.fillStyle = COLORS.muted;
        ctx.fillText(money(row.comparative), comparativeX, y + 13);
      }
      ctx.textAlign = "left";
      y += 18;
    }
  }

  if (note.shareholding?.rows.length) {
    y += 5;
    const x = [MARGIN_X, 270, 332, 407, 478, 541];
    const headers = ["NAME", "% AGE", "NATIONALITY", "SHARES", `VALUE (${currency})`];
    line(ctx, MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y, COLORS.rule);
    setFont(ctx, 6.6, "mono", 600);
    ctx.fillStyle = COLORS.muted;
    headers.forEach((header, index) => {
      ctx.textAlign = index === 0 ? "left" : "right";
      ctx.fillText(header, x[index === 0 ? 0 : index + 1], y + 13);
    });
    ctx.textAlign = "left";
    y += 19;
    const rows = note.shareholding.rows;
    const totalShares = rows.reduce((total, row) => total + row.numberOfShares, 0);
    const totalValue = rows.reduce((total, row) => total + row.value, 0);
    const totalPercentage = rows.reduce((total, row) => total + row.percentage, 0);
    for (const row of [...rows, { name: "Total", percentage: totalPercentage, nationality: "", numberOfShares: totalShares, value: totalValue }]) {
      const total = row.name === "Total";
      if (total) line(ctx, MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y, COLORS.strongRule, 0.65);
      setFont(ctx, 7.6, "sans", total ? 600 : 400);
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(row.name, x[0], y + 13);
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(row.percentage)}%`, x[2], y + 13);
      ctx.fillText(row.nationality ?? "", x[3], y + 13);
      ctx.fillText(Math.round(row.numberOfShares).toLocaleString("en-US"), x[4], y + 13);
      ctx.fillText(Math.round(row.value).toLocaleString("en-US"), x[5], y + 13);
      ctx.textAlign = "left";
      y += 18;
    }
    line(ctx, MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y, COLORS.strongRule, 1.2);
  }
  return y + 18;
}

function drawNotesPages(
  document: PDFDocument,
  startPageNumber: number,
  snapshot: ReportSnapshot,
  showComparatives: boolean,
) {
  let pageNumber = startPageNumber;
  let ctx = startPage(document);
  drawPageHeading(ctx, "Notes to the financial statements", showComparatives ? "Current year / comparative year" : "Current year");
  let y = 130;

  for (const note of snapshot.notes) {
    const required = noteHeight(note, ctx, showComparatives);
    if (y + required > 665) {
      drawFooter(ctx, pageNumber, snapshot.legalName);
      document.endPage();
      pageNumber += 1;
      ctx = startPage(document);
      drawPageHeading(ctx, "Notes to the financial statements", "Continued");
      y = 130;
    }
    y = drawNote(ctx, note, y, snapshot.presentationCurrency, showComparatives);
  }

  if (y + 125 > 760) {
    drawFooter(ctx, pageNumber, snapshot.legalName);
    document.endPage();
    pageNumber += 1;
    ctx = startPage(document);
    drawPageHeading(ctx, "Notes to the financial statements", "Traceability and authorization");
    y = 145;
  }
  line(ctx, MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y, COLORS.strongRule, 0.65);
  setFont(ctx, 7.8, "sans", 400);
  ctx.fillStyle = COLORS.muted;
  const traceability = `Traceability: ${snapshot.traceability.postedEntryCount} posted journal entries · ${snapshot.traceability.postedLineCount} linked statement lines · ${snapshot.traceability.sourceImportCount} source imports in the client workspace.`;
  y = drawWrappedText(ctx, traceability, MARGIN_X, y + 18, CONTENT_WIDTH, 12) + 16;
  drawSignature(ctx, Math.max(y + 28, 690));
  drawFooter(ctx, pageNumber, snapshot.legalName);
  document.endPage();
  return pageNumber;
}

export function buildReportPdf(
  snapshot: ReportSnapshot,
  signatory: ReportSignatory,
  options: { showComparatives?: boolean } = {},
) {
  const showComparatives = options.showComparatives ?? true;
  const document = new PDFDocument({
    title: `${snapshot.legalName} financial statements`,
    author: "AgarAccounting AI System",
    subject: `Financial statements for the year ended ${snapshot.periodEnd}`,
    creator: "AgarAccounting AI System",
    keywords: "financial statements, accounting, IFRS",
  });

  let pageNumber = 1;
  const cover = startPage(document);
  cover.fillStyle = COLORS.primary;
  cover.fillRect(0, 0, PAGE_WIDTH, 8);
  setFont(cover, 7.5, "mono", 600);
  cover.fillStyle = COLORS.muted;
  cover.fillText("AGARACCOUNTING AI SYSTEM / GENERATED ACCOUNTING OUTPUT", MARGIN_X, 64);
  setFont(cover, 37, "serif", 500);
  cover.fillStyle = COLORS.ink;
  drawWrappedText(cover, snapshot.legalName, MARGIN_X, 174, CONTENT_WIDTH, 43);
  if (snapshot.firmAttribution?.enabled && snapshot.firmAttribution.firmName) {
    setFont(cover, 9.5, "sans", 600);
    cover.fillText(`Prepared by firm: ${snapshot.firmAttribution.firmName}`, MARGIN_X, 235);
  }
  line(cover, MARGIN_X, 264, MARGIN_X + 64, 264, COLORS.strongRule, 0.8);
  setFont(cover, 25, "serif", 500);
  cover.fillText("Financial statements", MARGIN_X, 318);
  setFont(cover, 10, "sans", 400);
  cover.fillText(`For the year ended ${formatDate(snapshot.periodEnd)}`, MARGIN_X, 350);
  setFont(cover, 8.5, "sans", 400);
  cover.fillStyle = COLORS.muted;
  cover.fillText(
    showComparatives
      ? `Comparative period ended ${formatDate(snapshot.comparativePeriodEnd)} · ${snapshot.presentationCurrency}`
      : `${snapshot.presentationCurrency} · Current period only`,
    MARGIN_X,
    369,
  );
  line(cover, MARGIN_X, 692, PAGE_WIDTH - MARGIN_X, 692, COLORS.rule);
  setFont(cover, 8.2, "sans", 400);
  const disclaimer = `Prepared under ${snapshot.reportingBasis} using the ${snapshot.presentationProfile} presentation profile. This document is generated accounting output for human review. It is not an audit opinion, statutory filing, tax return, or assurance conclusion.`;
  drawWrappedText(cover, disclaimer, MARGIN_X, 713, CONTENT_WIDTH, 13);
  drawFooter(cover, pageNumber, snapshot.legalName);
  document.endPage();

  pageNumber += 1;
  drawStatementPage(document, pageNumber, snapshot.legalName, "Statement of financial position", snapshot.statementOfFinancialPosition, snapshot.presentationCurrency, showComparatives);
  pageNumber += 1;
  drawStatementPage(document, pageNumber, snapshot.legalName, "Statement of profit or loss and other comprehensive income", snapshot.profitOrLossAndOci, snapshot.presentationCurrency, showComparatives);
  pageNumber += 1;
  drawEquityPage(document, pageNumber, snapshot, showComparatives);
  pageNumber += 1;
  drawStatementPage(document, pageNumber, snapshot.legalName, "Statement of cash flows — indirect method", snapshot.cashFlows, snapshot.presentationCurrency, showComparatives);
  pageNumber += 1;
  drawNotesPages(document, pageNumber, snapshot, showComparatives);

  void signatory;
  return document.close();
}