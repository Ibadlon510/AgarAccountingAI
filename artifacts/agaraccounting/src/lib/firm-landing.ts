export function landingPathForMode(mode: string | null | undefined, firmStatus?: string | null) {
  if (mode === "firm") {
    if (firmStatus === "lapsed_readonly" || firmStatus === "locked") return "/billing/firm";
    return "/firm-dashboard";
  }
  if (mode === "both") {
    if (firmStatus === "lapsed_readonly" || firmStatus === "locked") return "/user-portal";
    return "/firm-dashboard";
  }
  return "/user-portal";
}

export function showsFirmNavigation(mode: string | null | undefined, firmFullAccess = true) {
  return (mode === "firm" || mode === "both") && firmFullAccess;
}

export function isFirmSubscribePath(path: string) {
  return path === "/billing/firm" || path === "/firm-settings";
}

export function isFirmPracticePath(path: string) {
  return path === "/firm-dashboard"
    || path === "/firm-clients"
    || path.startsWith("/firm-clients/")
    || path === "/firm-settings"
    || path === "/firm-onboard"
    || path === "/billing/firm";
}

export function shouldShowPersistentFirmWall(input: {
  path: string;
  mode: string | null | undefined;
  firmStatus?: string | null;
  liableParty?: string | null;
}) {
  if (input.firmStatus !== "locked") return false;
  if (isFirmSubscribePath(input.path)) return false;
  if (input.mode === "firm") return true;
  if (isFirmPracticePath(input.path)) return true;
  return input.liableParty === "firm";
}

export function daysLeft(confirmBy: Date | string | null | undefined, now = new Date()) {
  if (!confirmBy) return null;
  const deadline = typeof confirmBy === "string" ? new Date(confirmBy) : confirmBy;
  if (Number.isNaN(deadline.getTime())) return null;
  return Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
}

export const ENGAGEMENT_SERVICE_OPTIONS = [
  { id: "bookkeeping", label: "Bookkeeping" },
  { id: "statement_review", label: "Statement review" },
  { id: "journals", label: "Journals" },
  { id: "ifrs_pack", label: "IFRS pack" },
  { id: "uae_tax_estimate", label: "UAE tax estimate" },
] as const;

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function periodToMonthInput(period: string) {
  const numeric = period.match(/^(\d{4})-(\d{2})$/);
  if (numeric && Number(numeric[2]) >= 1 && Number(numeric[2]) <= 12) return period;
  const named = period.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!named) return "";
  const month = MONTH_NAMES.findIndex((name) => name.toLowerCase() === named[1].toLowerCase()) + 1;
  return month ? `${named[2]}-${String(month).padStart(2, "0")}` : "";
}

export function monthInputToPeriod(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  const month = match ? Number(match[2]) : 0;
  return match && month >= 1 && month <= 12 ? `${MONTH_NAMES[month - 1]} ${match[1]}` : "";
}

export function currentClosePeriod() {
  const now = new Date();
  return `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
}

export function onboardingStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "draft": return "Draft";
    case "sent": return "Awaiting signature";
    case "signed": return "Awaiting your confirmation";
    case "confirmed": return "Confirmed";
    case "expired": return "Expired";
    case "revoked": return "Discarded";
    default: return null;
  }
}

export function engagementStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "provisional": return "Provisional";
    case "active": return "Active";
    case "revoked": return "Revoked";
    case "expired": return "Expired";
    default: return null;
  }
}

export function ownershipLabel(status: string | null | undefined) {
  switch (status) {
    case "company_owned": return "Company owned";
    case "firm_provisional": return "Firm provisional";
    default: return status?.replaceAll("_", " ") ?? "—";
  }
}

export function practiceStatusLabel(onboardingStatus: string | null | undefined, engagementStatus: string | null | undefined) {
  return onboardingStatusLabel(onboardingStatus) ?? engagementStatusLabel(engagementStatus) ?? "No contract";
}

export function storeEngagementInviteLink(clientId: number, link: string) {
  sessionStorage.setItem(`agaraccounting:engagement-invite:${clientId}`, link);
}

export function readEngagementInviteLink(clientId: number) {
  return sessionStorage.getItem(`agaraccounting:engagement-invite:${clientId}`);
}

export const DEFAULT_ENGAGEMENT_TERMS = `This terms of engagement records that the accounting firm will provide the listed services for the named client on the agreed dates, transaction volume, and annual revenue for the specified revenue coverage period.

The figures for transactions per month and revenue per year, together with the stated revenue coverage period, are the contracted scope. The revenue coverage period is independent of the service period and the client's financial year. These figures are not a live measurement and do not automatically change billing or posting rights.

The client reviews these terms in AgarAccounting AI and acknowledges them by typing their name. That acknowledgement is stored on the engagement. It is not a qualified electronic signature, audit opinion, or statutory filing.

The firm must confirm the engagement within five days of the client acknowledgement. If the firm does not confirm in time, the connection expires and firm access to the client workspace is removed.`;

export const FIRM_HOST_SUFFIX = "agaraccounting.com";

export const RESERVED_FIRM_SLUGS = new Set([
  "www", "api", "app", "admin", "mail", "ftp", "cdn", "staging", "static", "assets",
  "help", "status", "billing", "clerk", "feedback", "signin", "signup", "sign-in", "sign-up",
  "www2", "dev", "test", "preview", "support", "docs", "blog",
]);

export function slugifyFirmName(name: string) {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : "";
}

export function firmSlugError(slug: string) {
  if (slug.length < 3 || slug.length > 32) return "Use 3 to 32 letters, numbers, or hyphens.";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return "Use lowercase letters, numbers, and hyphens only.";
  if (RESERVED_FIRM_SLUGS.has(slug)) return "That address is reserved. Choose another slug.";
  return null;
}

export function publicFirmHost(slug: string, suffix = FIRM_HOST_SUFFIX) {
  return `${slug}.${suffix}`;
}

export function firmLandingFallbackPath(slug: string) {
  return `/f/${slug}`;
}

export function firmSlugFromHost(hostname: string, suffix = FIRM_HOST_SUFFIX) {
  const host = hostname.split(":")[0]?.trim().toLowerCase() ?? "";
  if (!host || host === "localhost" || host === "127.0.0.1") return null;
  const local = host.match(/^([a-z0-9-]+)\.localhost$/);
  if (local?.[1] && !RESERVED_FIRM_SLUGS.has(local[1])) return local[1];
  const root = suffix.toLowerCase();
  if (host === root || host === `www.${root}`) return null;
  if (!host.endsWith(`.${root}`)) return null;
  const slug = host.slice(0, -(root.length + 1));
  if (!slug || slug.includes(".") || RESERVED_FIRM_SLUGS.has(slug)) return null;
  return slug;
}
