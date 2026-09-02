import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  aiActivityTable,
  billingAccountsTable,
  billingSubscriptionsTable,
  clientsTable,
  db,
  exchangeRatesTable,
  firmCompanyEngagementsTable,
  firmProfilesTable,
  statementImportsTable,
  type BillingSubscription,
  type Client,
} from "@workspace/db";
import { resolveIfrsRevenue } from "./firmPractice";

export const FIRM_TRIAL_DAYS = 15;
export const FIRM_READONLY_DAYS = 45;
export const COMPANY_TRIAL_DAYS = 14;
export const PAST_DUE_GRACE_DAYS = 3;
export const FIRM_MANAGED_WORKSPACE_LIMIT = 5;
export const REVENUE_THRESHOLD_USD = 100_000;
export const AED_PER_USD_FALLBACK = 3.6725;

export const INTRO_RATES_END_AT = process.env.INTRO_RATES_END_AT
  ? new Date(process.env.INTRO_RATES_END_AT)
  : new Date("2026-12-31T23:59:59+04:00");

export const LIST_PRICES_AED = {
  companyPro: 99,
  companyProFirmMember: 69,
  firm: 479,
} as const;

export const INTRO_PRICES_AED = {
  companyPro: 29,
  companyProFirmMember: 19,
  firm: 149,
} as const;

export const PLAN_LIMITS = {
  free: {
    name: "Company Free",
    statementImportsPerMonth: 5,
    storedEvidenceBytes: Math.round(0.5 * 1024 * 1024 * 1024),
    aiActivityPerMonth: 10,
    clientWorkspaces: Number.MAX_SAFE_INTEGER,
  },
  pro: {
    name: "Company Pro",
    statementImportsPerMonth: 100,
    storedEvidenceBytes: 5 * 1024 * 1024 * 1024,
    aiActivityPerMonth: 1000,
    clientWorkspaces: Number.MAX_SAFE_INTEGER,
  },
  firm: {
    name: "Firm Pro",
    statementImportsPerMonth: 100,
    storedEvidenceBytes: 5 * 1024 * 1024 * 1024,
    aiActivityPerMonth: 1000,
    clientWorkspaces: FIRM_MANAGED_WORKSPACE_LIMIT,
  },
} as const;

export const RETENTION_POLICY = {
  statementEvidenceDays: 365,
  aiActivityDays: 90,
  ledgerDataDescription: "Ledger entries remain available while the workspace is active.",
} as const;

export type FirmBillingStatus = "trialing" | "active" | "past_due" | "lapsed_readonly" | "locked";
export type CompanyBillingStatus = "trialing" | "pro" | "free" | "requires_pro";
export type BillingDenialCode = "firm_locked" | "firm_readonly" | "firm_lapsed" | "requires_pro" | "at_limit";

export type BillingDenial = {
  error: string;
  code: BillingDenialCode;
};

export type PlanLimits = {
  name: string;
  statementImportsPerMonth: number;
  storedEvidenceBytes: number;
  aiActivityPerMonth: number;
  clientWorkspaces: number;
};

export type FirmBilling = {
  payer: "firm";
  firmId: number;
  plan: "firm";
  planName: string;
  status: FirmBillingStatus;
  fullAccess: boolean;
  writeAccess: boolean;
  readAccess: boolean;
  trialEndsAt: string | null;
  readonlyUntil: string | null;
  lockedAt: string | null;
  limits: PlanLimits;
};

export type CompanyBilling = {
  payer: "company";
  clientId: number;
  plan: "trial" | "free" | "pro";
  planName: string;
  status: CompanyBillingStatus;
  writeAccess: boolean;
  trialEndsAt: string | null;
  isFirmMember: boolean;
  revenue: number;
  revenueThreshold: number;
  revenueCurrency: string;
  limits: PlanLimits;
};

export type WorkspaceBilling = FirmBilling | CompanyBilling;

function addDays(from: Date, days: number) {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export function introRatesActive(now = new Date()) {
  return now.getTime() < INTRO_RATES_END_AT.getTime();
}

export function currentPriceCatalog(now = new Date()) {
  const intro = introRatesActive(now);
  return {
    currency: "AED" as const,
    introActive: intro,
    introEndsAt: INTRO_RATES_END_AT.toISOString(),
    companyPro: { intro: INTRO_PRICES_AED.companyPro, list: LIST_PRICES_AED.companyPro, current: intro ? INTRO_PRICES_AED.companyPro : LIST_PRICES_AED.companyPro },
    companyProFirmMember: { intro: INTRO_PRICES_AED.companyProFirmMember, list: LIST_PRICES_AED.companyProFirmMember, current: intro ? INTRO_PRICES_AED.companyProFirmMember : LIST_PRICES_AED.companyProFirmMember },
    firm: { intro: INTRO_PRICES_AED.firm, list: LIST_PRICES_AED.firm, current: intro ? INTRO_PRICES_AED.firm : LIST_PRICES_AED.firm },
  };
}

export function stripePriceEnv(kind: "firm" | "company_pro" | "company_pro_firm_member", intro = introRatesActive()) {
  if (kind === "firm") return intro ? process.env.STRIPE_FIRM_INTRO_PRICE_ID : process.env.STRIPE_FIRM_PRICE_ID;
  if (kind === "company_pro_firm_member") {
    return intro ? process.env.STRIPE_COMPANY_PRO_FIRM_MEMBER_INTRO_PRICE_ID : process.env.STRIPE_COMPANY_PRO_FIRM_MEMBER_PRICE_ID;
  }
  return intro ? process.env.STRIPE_COMPANY_PRO_INTRO_PRICE_ID : process.env.STRIPE_COMPANY_PRO_PRICE_ID;
}

export function listPriceEnv(kind: "firm" | "company_pro" | "company_pro_firm_member") {
  if (kind === "firm") return process.env.STRIPE_FIRM_PRICE_ID;
  if (kind === "company_pro_firm_member") return process.env.STRIPE_COMPANY_PRO_FIRM_MEMBER_PRICE_ID;
  return process.env.STRIPE_COMPANY_PRO_PRICE_ID;
}

async function latestSubscription(accountId: number) {
  const [row] = await db.select().from(billingSubscriptionsTable)
    .where(eq(billingSubscriptionsTable.billingAccountId, accountId))
    .orderBy(desc(billingSubscriptionsTable.updatedAt), desc(billingSubscriptionsTable.id))
    .limit(1);
  return row ?? null;
}

async function accountForFirm(firmId: number) {
  const [account] = await db.select().from(billingAccountsTable)
    .where(and(eq(billingAccountsTable.payerType, "firm"), eq(billingAccountsTable.firmId, firmId)))
    .limit(1);
  return account ?? null;
}

async function accountForClient(clientId: number) {
  const [account] = await db.select().from(billingAccountsTable)
    .where(and(eq(billingAccountsTable.payerType, "company"), eq(billingAccountsTable.clientId, clientId)))
    .limit(1);
  return account ?? null;
}

export async function ensureBillingAccount(input: {
  payerType: "firm" | "company";
  firmId?: number | null;
  clientId?: number | null;
  email?: string | null;
}) {
  const existing = input.payerType === "firm" && input.firmId
    ? await accountForFirm(input.firmId)
    : input.clientId
      ? await accountForClient(input.clientId)
      : null;
  if (existing) {
    if (input.email && existing.email !== input.email) {
      const [updated] = await db.update(billingAccountsTable)
        .set({ email: input.email })
        .where(eq(billingAccountsTable.id, existing.id))
        .returning();
      return updated ?? existing;
    }
    return existing;
  }
  const [created] = await db.insert(billingAccountsTable).values({
    payerType: input.payerType,
    firmId: input.firmId ?? null,
    clientId: input.clientId ?? null,
    email: input.email ?? null,
  }).returning();
  return created;
}

export async function ensureLocalFirmTrial(firmId: number, email?: string | null) {
  const account = await ensureBillingAccount({ payerType: "firm", firmId, email });
  const existing = await latestSubscription(account.id);
  if (existing) return { account, subscription: existing };
  const now = new Date();
  const [subscription] = await db.insert(billingSubscriptionsTable).values({
    billingAccountId: account.id,
    planKey: "firm",
    status: "trialing",
    trialEndsAt: addDays(now, FIRM_TRIAL_DAYS),
  }).returning();
  return { account, subscription };
}

export async function ensureLocalCompanyTrial(clientId: number, email?: string | null, options?: { restart?: boolean }) {
  const account = await ensureBillingAccount({ payerType: "company", clientId, email });
  const existing = await latestSubscription(account.id);
  if (existing) {
    if (options?.restart && !existing.stripeSubscriptionId) {
      const [updated] = await db.update(billingSubscriptionsTable).set({
        status: "trialing",
        planKey: "company_pro",
        trialEndsAt: addDays(new Date(), COMPANY_TRIAL_DAYS),
      }).where(eq(billingSubscriptionsTable.id, existing.id)).returning();
      return { account, subscription: updated ?? existing };
    }
    return { account, subscription: existing };
  }
  const now = new Date();
  const [subscription] = await db.insert(billingSubscriptionsTable).values({
    billingAccountId: account.id,
    planKey: "company_pro",
    status: "trialing",
    trialEndsAt: addDays(now, COMPANY_TRIAL_DAYS),
  }).returning();
  return { account, subscription };
}

export function resolveCheckoutPrice(
  payerType: "firm" | "company",
  options: { isFirmMember?: boolean; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const intro = introRatesActive(now);
  const kind = payerType === "firm"
    ? "firm" as const
    : options.isFirmMember
      ? "company_pro_firm_member" as const
      : "company_pro" as const;
  const introAmount = kind === "firm"
    ? INTRO_PRICES_AED.firm
    : kind === "company_pro_firm_member"
      ? INTRO_PRICES_AED.companyProFirmMember
      : INTRO_PRICES_AED.companyPro;
  const listAmount = kind === "firm"
    ? LIST_PRICES_AED.firm
    : kind === "company_pro_firm_member"
      ? LIST_PRICES_AED.companyProFirmMember
      : LIST_PRICES_AED.companyPro;
  return {
    kind,
    intro,
    priceId: stripePriceEnv(kind, intro),
    listPriceId: listPriceEnv(kind),
    amount: intro ? introAmount : listAmount,
    listAmount,
    scheduleToListAt: intro ? INTRO_RATES_END_AT.toISOString() : null,
  };
}

function stripeEntitled(subscription: BillingSubscription | null, now: Date) {
  if (!subscription?.stripeSubscriptionId) return null;
  if (subscription.status === "active" || subscription.status === "trialing") return subscription.status === "trialing" ? "trialing" : "active";
  if (subscription.status === "past_due") {
    const graceEnd = addDays(subscription.updatedAt, PAST_DUE_GRACE_DAYS);
    return now < graceEnd ? "past_due" : null;
  }
  return null;
}

function firmClock(trialEndsAt: Date, now: Date): Pick<FirmBilling, "status" | "trialEndsAt" | "readonlyUntil" | "lockedAt"> {
  const readonlyUntil = addDays(trialEndsAt, FIRM_READONLY_DAYS);
  if (now < trialEndsAt) {
    return { status: "trialing", trialEndsAt: trialEndsAt.toISOString(), readonlyUntil: readonlyUntil.toISOString(), lockedAt: readonlyUntil.toISOString() };
  }
  if (now < readonlyUntil) {
    return { status: "lapsed_readonly", trialEndsAt: trialEndsAt.toISOString(), readonlyUntil: readonlyUntil.toISOString(), lockedAt: readonlyUntil.toISOString() };
  }
  return { status: "locked", trialEndsAt: trialEndsAt.toISOString(), readonlyUntil: readonlyUntil.toISOString(), lockedAt: readonlyUntil.toISOString() };
}

export async function resolveFirmBilling(firmId: number, now = new Date()): Promise<FirmBilling | null> {
  const [firm] = await db.select().from(firmProfilesTable).where(eq(firmProfilesTable.id, firmId)).limit(1);
  if (!firm || firm.profileKind !== "accounting_firm") return null;
  const account = await accountForFirm(firmId);
  const subscription = account ? await latestSubscription(account.id) : null;
  const stripeStatus = stripeEntitled(subscription, now);
  const trialEndsAt = subscription?.trialEndsAt ?? addDays(firm.createdAt, FIRM_TRIAL_DAYS);
  const clock = firmClock(trialEndsAt, now);
  const status: FirmBillingStatus = stripeStatus ?? clock.status;
  const fullAccess = status === "trialing" || status === "active" || status === "past_due";
  return {
    payer: "firm",
    firmId,
    plan: "firm",
    planName: status === "trialing" ? "Firm trial" : PLAN_LIMITS.firm.name,
    status,
    fullAccess,
    writeAccess: fullAccess,
    readAccess: fullAccess || status === "lapsed_readonly",
    trialEndsAt: clock.trialEndsAt,
    readonlyUntil: clock.readonlyUntil,
    lockedAt: clock.lockedAt,
    limits: PLAN_LIMITS.firm,
  };
}

export async function isCompanyFirmMember(clientId: number) {
  const engagements = await db.select({
    status: firmCompanyEngagementsTable.status,
    firmId: firmCompanyEngagementsTable.firmId,
  }).from(firmCompanyEngagementsTable).where(and(
    eq(firmCompanyEngagementsTable.clientId, clientId),
    eq(firmCompanyEngagementsTable.status, "active"),
  ));
  for (const engagement of engagements) {
    const firm = await resolveFirmBilling(engagement.firmId);
    if (firm?.fullAccess) return true;
  }
  return false;
}

export async function revenueThresholdInCurrency(currency: string) {
  const code = currency.trim().toUpperCase() || "AED";
  if (code === "USD") return REVENUE_THRESHOLD_USD;
  const [rate] = await db.select().from(exchangeRatesTable)
    .where(and(
      eq(exchangeRatesTable.sourceCurrency, "USD"),
      eq(exchangeRatesTable.functionalCurrency, code),
    ))
    .orderBy(desc(exchangeRatesTable.effectiveDate))
    .limit(1);
  if (rate) return REVENUE_THRESHOLD_USD * Number(rate.rate);
  if (code === "AED") return REVENUE_THRESHOLD_USD * AED_PER_USD_FALLBACK;
  return REVENUE_THRESHOLD_USD;
}

export async function resolveCompanyBilling(client: Client, now = new Date()): Promise<CompanyBilling> {
  const account = await accountForClient(client.id);
  const subscription = account ? await latestSubscription(account.id) : null;
  const stripeActive = Boolean(subscription?.stripeSubscriptionId && (subscription.status === "active" || subscription.status === "trialing" || (
    subscription.status === "past_due" && now < addDays(subscription.updatedAt, PAST_DUE_GRACE_DAYS)
  )));
  const liableStart = client.transferredAt ?? client.createdAt;
  const trialEndsAt = subscription?.trialEndsAt ?? addDays(liableStart, COMPANY_TRIAL_DAYS);
  const inLocalTrial = !stripeActive && now < trialEndsAt;
  const isFirmMember = await isCompanyFirmMember(client.id);
  const revenue = (await resolveIfrsRevenue(client)).amount ?? 0;
  const revenueThreshold = await revenueThresholdInCurrency(client.functionalCurrency);
  let status: CompanyBillingStatus;
  let plan: CompanyBilling["plan"];
  let limits: PlanLimits;
  if (stripeActive) {
    status = "pro";
    plan = "pro";
    limits = PLAN_LIMITS.pro;
  } else if (inLocalTrial) {
    status = "trialing";
    plan = "trial";
    limits = PLAN_LIMITS.pro;
  } else if (revenue >= revenueThreshold) {
    status = "requires_pro";
    plan = "free";
    limits = PLAN_LIMITS.free;
  } else {
    status = "free";
    plan = "free";
    limits = PLAN_LIMITS.free;
  }
  return {
    payer: "company",
    clientId: client.id,
    plan,
    planName: plan === "trial" ? "Company trial" : plan === "pro" ? PLAN_LIMITS.pro.name : PLAN_LIMITS.free.name,
    status,
    writeAccess: status !== "requires_pro",
    trialEndsAt: trialEndsAt.toISOString(),
    isFirmMember,
    revenue,
    revenueThreshold,
    revenueCurrency: client.functionalCurrency.toUpperCase(),
    limits,
  };
}

export async function resolveBilling(clientId: number, now = new Date()): Promise<WorkspaceBilling | null> {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId)).limit(1);
  if (!client) return null;
  if (client.subscriptionLiableParty === "firm" && client.firmId) {
    return resolveFirmBilling(client.firmId, now);
  }
  return resolveCompanyBilling(client, now);
}

export async function firmManagedWorkspaceCount(firmId: number) {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(clientsTable).where(and(
    eq(clientsTable.firmId, firmId),
    eq(clientsTable.subscriptionLiableParty, "firm"),
  ));
  return Number(row?.count ?? 0);
}

export async function periodUsage(clientIds: number[], now = new Date()) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (!clientIds.length) {
    return { importsThisPeriod: 0, aiThisPeriod: 0, evidenceBytes: 0, periodStart };
  }
  const imports = await db.select({
    outcome: statementImportsTable.outcome,
    fileSize: statementImportsTable.fileSize,
    objectPath: statementImportsTable.objectPath,
    evidenceExpiresAt: statementImportsTable.evidenceExpiresAt,
    createdAt: statementImportsTable.createdAt,
  }).from(statementImportsTable).where(inArray(statementImportsTable.clientId, clientIds));
  const completed = imports.filter((item) => item.outcome === "completed");
  const importsThisPeriod = completed.filter((item) => item.createdAt >= periodStart).length;
  const evidenceBytes = completed
    .filter((item) => item.objectPath && item.evidenceExpiresAt && item.evidenceExpiresAt > now)
    .reduce((total, item) => total + (item.fileSize ?? 0), 0);
  const [ai] = await db.select({ count: sql<number>`count(*)::int` }).from(aiActivityTable).where(and(
    inArray(aiActivityTable.clientId, clientIds),
    eq(aiActivityTable.status, "completed"),
    gte(aiActivityTable.createdAt, periodStart),
  ));
  return { importsThisPeriod, aiThisPeriod: Number(ai?.count ?? 0), evidenceBytes, periodStart };
}

export async function usageClientIdsForBilling(billing: WorkspaceBilling) {
  if (billing.payer === "firm") {
    const rows = await db.select({ id: clientsTable.id }).from(clientsTable).where(and(
      eq(clientsTable.firmId, billing.firmId),
      eq(clientsTable.subscriptionLiableParty, "firm"),
    ));
    return rows.map((row) => row.id);
  }
  return [billing.clientId];
}

export function billingDenial(billing: WorkspaceBilling, access: "read" | "write"): BillingDenial | null {
  if (billing.payer === "firm") {
    if (billing.status === "locked") {
      return { code: "firm_locked", error: "This firm is locked. Subscribe to Firm Pro to continue." };
    }
    if (access === "write" && !billing.writeAccess) {
      return { code: "firm_readonly", error: "Firm Pro has lapsed. Existing books are read-only until you subscribe." };
    }
    if (access === "read" && !billing.readAccess) {
      return { code: "firm_locked", error: "This firm is locked. Subscribe to Firm Pro to continue." };
    }
    return null;
  }
  if (access === "write" && billing.status === "requires_pro") {
    return {
      code: "requires_pro",
      error: `Posted revenue has reached the Company Pro threshold (${billing.revenueThreshold.toLocaleString()} ${billing.revenueCurrency}). Upgrade this workspace to continue.`,
    };
  }
  return null;
}

export async function limitDenial(billing: WorkspaceBilling, kind: "import" | "ai" | "evidence" | "workspace"): Promise<BillingDenial | null> {
  if (billing.payer === "firm" && !billing.writeAccess) return billingDenial(billing, "write");
  if (billing.payer === "company" && !billing.writeAccess) return billingDenial(billing, "write");
  const clientIds = await usageClientIdsForBilling(billing);
  const usage = await periodUsage(clientIds);
  if (kind === "import" && usage.importsThisPeriod >= billing.limits.statementImportsPerMonth) {
    return { code: "at_limit", error: `This plan allows ${billing.limits.statementImportsPerMonth} statement imports per month.` };
  }
  if (kind === "ai" && usage.aiThisPeriod >= billing.limits.aiActivityPerMonth) {
    return { code: "at_limit", error: `This plan allows ${billing.limits.aiActivityPerMonth} AI activities per month.` };
  }
  if (kind === "evidence" && usage.evidenceBytes >= billing.limits.storedEvidenceBytes) {
    return { code: "at_limit", error: "Stored statement evidence is at the plan limit." };
  }
  if (kind === "workspace" && billing.payer === "firm") {
    const used = await firmManagedWorkspaceCount(billing.firmId);
    if (used >= billing.limits.clientWorkspaces) {
      return { code: "at_limit", error: `Firm Pro includes ${billing.limits.clientWorkspaces} firm-managed client workspaces.` };
    }
  }
  return null;
}

export async function assertFirmProductAccess(firmId: number): Promise<BillingDenial | FirmBilling> {
  const billing = await resolveFirmBilling(firmId);
  if (!billing) return { code: "firm_lapsed", error: "This accounting firm is not available." };
  if (!billing.fullAccess) {
    return billing.status === "locked"
      ? { code: "firm_locked", error: "Subscribe to Firm Pro to open the practice dashboard and onboard clients." }
      : { code: "firm_lapsed", error: "Subscribe to Firm Pro to open the practice dashboard and onboard clients." };
  }
  return billing;
}

export function isBillingDenial(value: BillingDenial | FirmBilling | WorkspaceBilling | null): value is BillingDenial {
  return Boolean(value && "code" in value && "error" in value && !("payer" in value));
}

export async function upsertStripeSubscription(input: {
  payerType: "firm" | "company";
  firmId?: number | null;
  clientId?: number | null;
  email?: string | null;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId?: string | null;
  stripeScheduleId?: string | null;
  planKey: "firm" | "company_pro" | "company_pro_firm_member";
  status: "trialing" | "active" | "past_due" | "canceled";
  trialEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
}) {
  const account = await ensureBillingAccount({
    payerType: input.payerType,
    firmId: input.firmId,
    clientId: input.clientId,
    email: input.email,
  });
  if (account.stripeCustomerId !== input.stripeCustomerId) {
    await db.update(billingAccountsTable)
      .set({ stripeCustomerId: input.stripeCustomerId, email: input.email ?? account.email })
      .where(eq(billingAccountsTable.id, account.id));
  }
  const [existing] = await db.select().from(billingSubscriptionsTable)
    .where(eq(billingSubscriptionsTable.stripeSubscriptionId, input.stripeSubscriptionId))
    .limit(1);
  const values = {
    billingAccountId: account.id,
    stripeSubscriptionId: input.stripeSubscriptionId,
    stripePriceId: input.stripePriceId ?? null,
    stripeScheduleId: input.stripeScheduleId ?? existing?.stripeScheduleId ?? null,
    planKey: input.planKey,
    status: input.status,
    trialEndsAt: input.trialEndsAt ?? existing?.trialEndsAt ?? null,
    currentPeriodEnd: input.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
  };
  if (existing) {
    const [updated] = await db.update(billingSubscriptionsTable).set(values).where(eq(billingSubscriptionsTable.id, existing.id)).returning();
    return updated;
  }
  const [created] = await db.insert(billingSubscriptionsTable).values(values).returning();
  return created;
}
