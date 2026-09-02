import { PDFDocument, type CanvasRenderingContext2D } from "@napi-rs/canvas";

export const ENGAGEMENT_SERVICES = [
  { id: "bookkeeping", label: "Bookkeeping" },
  { id: "statement_review", label: "Statement review" },
  { id: "journals", label: "Journals" },
  { id: "ifrs_pack", label: "IFRS pack" },
  { id: "uae_tax_estimate", label: "UAE tax estimate" },
] as const;

export type EngagementServiceId = (typeof ENGAGEMENT_SERVICES)[number]["id"];

export const ENGAGEMENT_CONFIRM_TTL_MS = 5 * 24 * 60 * 60 * 1000;

export const DEFAULT_ENGAGEMENT_TERMS = `This terms of engagement records that the accounting firm will provide the listed services for the named client on the agreed dates, transaction volume, and annual revenue.

The figures for transactions per month and revenue per year are the contracted scope. They are not a live measurement and do not automatically change billing or posting rights.

The client reviews these terms in AgarAccounting AI and acknowledges them by typing their name. That acknowledgement is stored on the engagement. It is not a qualified electronic signature, audit opinion, or statutory filing.

The firm must confirm the engagement within five days of the client acknowledgement. If the firm does not confirm in time, the connection expires and firm access to the client workspace is removed.`;

export function engagementServiceLabel(id: string) {
  return ENGAGEMENT_SERVICES.find((service) => service.id === id)?.label ?? id;
}

export function normalizeEngagementServices(values: unknown): EngagementServiceId[] {
  if (!Array.isArray(values)) return [];
  const allowed = new Set(ENGAGEMENT_SERVICES.map((service) => service.id));
  return [...new Set(values.filter((value): value is EngagementServiceId => typeof value === "string" && allowed.has(value as EngagementServiceId)))];
}

export type EngagementContractTermsInput = {
  services: string[];
  agreedTransactionsPerMonth: number;
  agreedRevenuePerYear: number;
  agreedRevenueCurrency: string;
  startDate: string;
  endDate: string | null;
  feeNote: string | null;
  termsText: string;
  firmLegalName: string;
  clientLegalName: string;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_X = 54;
const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN_X * 2);
const COLORS = {
  paper: "#fbfaf5",
  ink: "#20272b",
  muted: "#687176",
  rule: "#d8d4c8",
  primary: "#265c43",
};

function setFont(ctx: CanvasRenderingContext2D, size: number, family: "sans" | "serif" | "mono" = "sans", weight = 400) {
  const fontFamily = family === "serif" ? "Georgia" : family === "mono" ? "DejaVu Sans Mono" : "DejaVu Sans";
  ctx.font = `${weight} ${size}px "${fontFamily}"`;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
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

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

export function buildEngagementContractPdf(input: EngagementContractTermsInput & {
  signerName?: string | null;
  signedAt?: Date | null;
}) {
  const document = new PDFDocument();
  const ctx = document.beginPage(PAGE_WIDTH, PAGE_HEIGHT);
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = COLORS.primary;
  ctx.fillRect(0, 0, PAGE_WIDTH, 8);
  setFont(ctx, 7.5, "mono", 600);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText("AGARACCOUNTING AI SYSTEM / ENGAGEMENT ACKNOWLEDGEMENT", MARGIN_X, 48);

  setFont(ctx, 26, "serif", 500);
  ctx.fillStyle = COLORS.ink;
  ctx.fillText("Terms of engagement", MARGIN_X, 92);

  setFont(ctx, 10, "sans", 400);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText("In-app acknowledgement stored on the engagement. Not a qualified e-signature.", MARGIN_X, 114);

  const rows: Array<[string, string]> = [
    ["Firm", input.firmLegalName],
    ["Client", input.clientLegalName],
    ["Services", input.services.map(engagementServiceLabel).join(", ") || "None selected"],
    ["Transactions / month", String(input.agreedTransactionsPerMonth)],
    ["Revenue / year", money(input.agreedRevenuePerYear, input.agreedRevenueCurrency)],
    ["Start date", input.startDate],
    ["End date", input.endDate || "Ongoing"],
    ["Fee", input.feeNote?.trim() || "As agreed separately"],
  ];

  let y = 148;
  setFont(ctx, 9, "sans", 400);
  for (const [label, value] of rows) {
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(label.toUpperCase(), MARGIN_X, y);
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(value, MARGIN_X + 160, y);
    y += 18;
  }

  y += 12;
  ctx.strokeStyle = COLORS.rule;
  ctx.beginPath();
  ctx.moveTo(MARGIN_X, y);
  ctx.lineTo(PAGE_WIDTH - MARGIN_X, y);
  ctx.stroke();
  y += 28;

  setFont(ctx, 11, "serif", 500);
  ctx.fillStyle = COLORS.ink;
  ctx.fillText("Agreed terms", MARGIN_X, y);
  y += 20;
  setFont(ctx, 9, "sans", 400);
  const termLines = wrapText(ctx, input.termsText, CONTENT_WIDTH);
  for (const line of termLines.slice(0, 22)) {
    ctx.fillText(line, MARGIN_X, y);
    y += 13;
  }

  y = Math.max(y + 24, 690);
  ctx.strokeStyle = COLORS.rule;
  ctx.beginPath();
  ctx.moveTo(MARGIN_X, y);
  ctx.lineTo(PAGE_WIDTH - MARGIN_X, y);
  ctx.stroke();
  y += 28;
  setFont(ctx, 9, "sans", 500);
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(input.signerName ? `Acknowledged by ${input.signerName}` : "Awaiting client acknowledgement", MARGIN_X, y);
  setFont(ctx, 8, "sans", 400);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(input.signedAt ? input.signedAt.toISOString() : "Not yet signed", MARGIN_X, y + 16);

  document.endPage();
  return document.close();
}

export function engagementContractPdfBase64(input: EngagementContractTermsInput & {
  signerName?: string | null;
  signedAt?: Date | null;
}) {
  try {
    return Buffer.from(buildEngagementContractPdf(input)).toString("base64");
  } catch {
    return undefined;
  }
}

export function engagementContractEmail(input: {
  firmName: string;
  clientName: string;
  inviteLink: string;
  expiresAt: Date;
}) {
  const expires = input.expiresAt.toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  });
  return {
    subject: `${input.firmName} sent you an engagement contract`,
    text: [
      `Hello,`,
      ``,
      `${input.firmName} prepared terms of engagement for ${input.clientName} in AgarAccounting AI.`,
      ``,
      `Review the agreed services, transaction volume, and annual revenue, then sign in with this email address to acknowledge the terms.`,
      `This is an in-app acknowledgement stored on the engagement. It is not a qualified electronic signature.`,
      ``,
      `This invitation expires on ${expires} UTC.`,
      `Use the secure link below:`,
      input.inviteLink,
      ``,
      `If you were not expecting this invitation, you can ignore this email.`,
    ].join("\n"),
  };
}

export function firmEngagementInvitationEmail(input: {
  clientName: string;
  firmName: string;
  inviteLink: string;
  expiresAt: Date;
}) {
  const expires = input.expiresAt.toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  });
  return {
    subject: `${input.clientName} invited ${input.firmName} in AgarAccounting AI`,
    text: [
      "Hello,",
      "",
      `${input.clientName} invited ${input.firmName} to become its accounting firm in AgarAccounting AI.`,
      "",
      "Accept this invitation using your registered firm administrator email. After accepting, complete the engagement onboarding in the firm Clients page to define services and terms.",
      "The firm-client connection remains provisional until the client acknowledges those terms and the firm confirms the engagement.",
      "",
      `This invitation expires on ${expires} UTC.`,
      "Use the secure link below:",
      input.inviteLink,
      "",
      "If you were not expecting this invitation, you can ignore this email.",
    ].join("\n"),
  };
}

export function canResendEngagementContract(status: string, signedAt: Date | null | undefined) {
  return status === "sent" || (status === "expired" && !signedAt);
}
