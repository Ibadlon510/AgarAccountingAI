import * as zod from "zod";

export const BillingPriceQuote = zod.object({
  intro: zod.number(),
  list: zod.number(),
  current: zod.number(),
});

export const BillingPriceCatalog = zod.object({
  currency: zod.literal("AED"),
  introActive: zod.boolean(),
  introEndsAt: zod.string(),
  companyPro: BillingPriceQuote,
  companyProFirmMember: BillingPriceQuote,
  firm: BillingPriceQuote,
});

export const BillingPlanLimits = zod.object({
  name: zod.string(),
  statementImportsPerMonth: zod.number(),
  storedEvidenceBytes: zod.number(),
  aiActivityPerMonth: zod.number(),
  clientWorkspaces: zod.number(),
});

export const FirmBilling = zod.object({
  payer: zod.literal("firm"),
  firmId: zod.number(),
  plan: zod.literal("firm"),
  planName: zod.string(),
  status: zod.enum(["trialing", "active", "past_due", "lapsed_readonly", "locked"]),
  fullAccess: zod.boolean(),
  writeAccess: zod.boolean(),
  readAccess: zod.boolean(),
  trialEndsAt: zod.string().nullable(),
  readonlyUntil: zod.string().nullable(),
  lockedAt: zod.string().nullable(),
  limits: BillingPlanLimits,
});

export const CompanyBilling = zod.object({
  payer: zod.literal("company"),
  clientId: zod.number(),
  plan: zod.enum(["trial", "free", "pro"]),
  planName: zod.string(),
  status: zod.enum(["trialing", "pro", "free", "requires_pro"]),
  writeAccess: zod.boolean(),
  trialEndsAt: zod.string().nullable(),
  isFirmMember: zod.boolean(),
  revenue: zod.number(),
  revenueThreshold: zod.number(),
  revenueCurrency: zod.string(),
  limits: BillingPlanLimits,
});

export const GetBillingMeResponse = zod.object({
  prices: BillingPriceCatalog,
  stripeEnabled: zod.boolean(),
  firms: zod.array(FirmBilling),
  companies: zod.array(CompanyBilling),
});

export const CreateBillingCheckoutBody = zod.object({
  payerType: zod.enum(["firm", "company"]),
  firmId: zod.number().optional(),
  clientId: zod.number().optional(),
});

export const CreateBillingCheckoutResponse = zod.object({
  url: zod.string().nullable(),
});

export const CreateBillingPortalBody = CreateBillingCheckoutBody;

export const CreateBillingPortalResponse = CreateBillingCheckoutResponse;

export type BillingMe = zod.infer<typeof GetBillingMeResponse>;
export type FirmBillingState = zod.infer<typeof FirmBilling>;
export type CompanyBillingState = zod.infer<typeof CompanyBilling>;
