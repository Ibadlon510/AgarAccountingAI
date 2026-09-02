import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { billingAccountsTable, billingSubscriptionsTable, db } from "@workspace/db";
import {
  INTRO_RATES_END_AT,
  isCompanyFirmMember,
  resolveCheckoutPrice,
  stripePriceEnv,
  upsertStripeSubscription,
} from "./billing";

type StripeSubscription = {
  id: string;
  customer: string | { id: string };
  status: string;
  cancel_at_period_end: boolean;
  trial_end: number | null;
  current_period_end?: number | null;
  items: { data: Array<{ id: string; price: { id: string }; current_period_end?: number }> };
  metadata?: Record<string, string>;
};

export type StripeEvent = {
  id: string;
  created: number;
  type: string;
  data: { object: Record<string, unknown> };
};

export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;

type StripeCheckoutSession = {
  id: string;
  url: string | null;
  subscription: string | { id: string } | null;
};

function stripeSecret() {
  return process.env.STRIPE_SECRET_KEY ?? null;
}

export function stripeClient() {
  return stripeSecret() ? { configured: true } : null;
}

async function stripeRequest<T>(path: string, init?: { method?: string; body?: URLSearchParams }): Promise<T> {
  const key = stripeSecret();
  if (!key) throw new Error("Stripe is not configured.");
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: init?.body,
  });
  const payload = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload.error?.message || `Stripe request failed (${response.status}).`);
  }
  return payload;
}

export function publicAppUrl(req: { protocol: string; get: (name: string) => string | undefined; headers: Record<string, unknown> }) {
  const configured = process.env.AGARACCOUNTING_PUBLIC_URL;
  if (configured) return configured.replace(/\/$/, "");
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = typeof forwardedProto === "string" ? forwardedProto : req.protocol;
  const host = typeof req.headers["x-forwarded-host"] === "string" ? req.headers["x-forwarded-host"] : req.get("host");
  return `${protocol}://${host}`;
}

export function planKeyFromPriceId(priceId: string | null | undefined): "firm" | "company_pro" | "company_pro_firm_member" {
  if (!priceId) return "company_pro";
  const member = [process.env.STRIPE_COMPANY_PRO_FIRM_MEMBER_PRICE_ID, process.env.STRIPE_COMPANY_PRO_FIRM_MEMBER_INTRO_PRICE_ID];
  const firm = [process.env.STRIPE_FIRM_PRICE_ID, process.env.STRIPE_FIRM_INTRO_PRICE_ID];
  if (member.includes(priceId)) return "company_pro_firm_member";
  if (firm.includes(priceId)) return "firm";
  return "company_pro";
}

export function listPriceForIntroPrice(priceId: string | null | undefined) {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_FIRM_INTRO_PRICE_ID) return process.env.STRIPE_FIRM_PRICE_ID ?? null;
  if (priceId === process.env.STRIPE_COMPANY_PRO_FIRM_MEMBER_INTRO_PRICE_ID) {
    return process.env.STRIPE_COMPANY_PRO_FIRM_MEMBER_PRICE_ID ?? null;
  }
  if (priceId === process.env.STRIPE_COMPANY_PRO_INTRO_PRICE_ID) return process.env.STRIPE_COMPANY_PRO_PRICE_ID ?? null;
  return null;
}

export function introListSchedulePlan(priceId: string, now = new Date()) {
  const listPriceId = listPriceForIntroPrice(priceId);
  const cutoff = Math.floor(INTRO_RATES_END_AT.getTime() / 1000);
  if (!listPriceId || listPriceId === priceId || Math.floor(now.getTime() / 1000) >= cutoff) return null;
  return { introPriceId: priceId, listPriceId, cutoff };
}

export async function ensureIntroListSchedule(subscription: StripeSubscription, now = new Date()) {
  const priceId = subscription.items.data[0]?.price.id;
  if (!priceId) return null;
  const plan = introListSchedulePlan(priceId, now);
  if (!plan) return null;
  const [local] = await db.select().from(billingSubscriptionsTable)
    .where(eq(billingSubscriptionsTable.stripeSubscriptionId, subscription.id))
    .limit(1);
  if (!local) return null;

  let scheduleId = local.stripeScheduleId;
  let start = Math.floor(now.getTime() / 1000);
  if (scheduleId) {
    const schedule = await stripeRequest<{ phases: Array<{ start_date: number }> }>(`/subscription_schedules/${scheduleId}`);
    start = schedule.phases[0]?.start_date ?? start;
  } else {
    const schedule = await stripeRequest<{ id: string; phases: Array<{ start_date: number }> }>("/subscription_schedules", {
      method: "POST",
      body: new URLSearchParams({ from_subscription: subscription.id }),
    });
    scheduleId = schedule.id;
    start = schedule.phases[0]?.start_date ?? start;
    await db.update(billingSubscriptionsTable)
      .set({ stripeScheduleId: scheduleId })
      .where(eq(billingSubscriptionsTable.id, local.id));
  }
  await stripeRequest(`/subscription_schedules/${scheduleId}`, {
    method: "POST",
    body: new URLSearchParams({
      "phases[0][items][0][price]": plan.introPriceId,
      "phases[0][items][0][quantity]": "1",
      "phases[0][start_date]": String(start),
      "phases[0][end_date]": String(plan.cutoff),
      "phases[1][items][0][price]": plan.listPriceId,
      "phases[1][items][0][quantity]": "1",
      "phases[1][start_date]": String(plan.cutoff),
    }),
  });
  await db.update(billingSubscriptionsTable)
    .set({ stripeScheduleId: scheduleId })
    .where(eq(billingSubscriptionsTable.id, local.id));
  return scheduleId;
}

export async function createCheckoutSession(input: {
  payerType: "firm" | "company";
  firmId?: number | null;
  clientId?: number | null;
  email?: string | null;
  clerkUserId: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const checkout = resolveCheckoutPrice(input.payerType, {
    isFirmMember: input.payerType === "company" ? await isCompanyFirmMember(input.clientId ?? 0) : false,
  });
  const kind = checkout.kind;
  const priceId = checkout.priceId;
  if (!priceId) throw new Error("Stripe price IDs are not configured.");

  const [existing] = input.payerType === "firm" && input.firmId
    ? await db.select().from(billingAccountsTable).where(and(eq(billingAccountsTable.payerType, "firm"), eq(billingAccountsTable.firmId, input.firmId))).limit(1)
    : input.clientId
      ? await db.select().from(billingAccountsTable).where(and(eq(billingAccountsTable.payerType, "company"), eq(billingAccountsTable.clientId, input.clientId))).limit(1)
      : [];

  const body = new URLSearchParams({
    mode: "subscription",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    client_reference_id: input.payerType === "firm" ? `firm:${input.firmId}` : `company:${input.clientId}`,
    "metadata[liableParty]": input.payerType === "firm" ? "firm" : "company",
    "metadata[firmId]": input.firmId ? String(input.firmId) : "",
    "metadata[clientId]": input.clientId ? String(input.clientId) : "",
    "metadata[clerkUserId]": input.clerkUserId,
    "metadata[planKey]": kind,
    "subscription_data[metadata][liableParty]": input.payerType === "firm" ? "firm" : "company",
    "subscription_data[metadata][firmId]": input.firmId ? String(input.firmId) : "",
    "subscription_data[metadata][clientId]": input.clientId ? String(input.clientId) : "",
    "subscription_data[metadata][clerkUserId]": input.clerkUserId,
    "subscription_data[metadata][planKey]": kind,
  });
  if (existing?.stripeCustomerId) body.set("customer", existing.stripeCustomerId);
  else if (input.email) body.set("customer_email", input.email);

  const session = await stripeRequest<StripeCheckoutSession>("/checkout/sessions", { method: "POST", body });
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (subscriptionId) {
    const subscription = await stripeRequest<StripeSubscription>(`/subscriptions/${subscriptionId}`);
    await applyStripeSubscription(subscription);
  }
  return session;
}

export async function createPortalSession(stripeCustomerId: string, returnUrl: string) {
  return stripeRequest<{ url: string }>("/billing_portal/sessions", {
    method: "POST",
    body: new URLSearchParams({ customer: stripeCustomerId, return_url: returnUrl }),
  });
}

export async function retrieveSubscription(subscriptionId: string) {
  return stripeRequest<StripeSubscription>(`/subscriptions/${subscriptionId}`);
}

export async function syncMemberPrice(clientId: number) {
  if (!stripeSecret()) return null;
  const [account] = await db.select().from(billingAccountsTable).where(and(
    eq(billingAccountsTable.payerType, "company"),
    eq(billingAccountsTable.clientId, clientId),
  )).limit(1);
  if (!account) return null;
  const [subscription] = await db.select().from(billingSubscriptionsTable)
    .where(eq(billingSubscriptionsTable.billingAccountId, account.id))
    .orderBy(desc(billingSubscriptionsTable.updatedAt), desc(billingSubscriptionsTable.id))
    .limit(1);
  if (!subscription?.stripeSubscriptionId) return null;
  const member = await isCompanyFirmMember(clientId);
  const targetPrice = stripePriceEnv(member ? "company_pro_firm_member" : "company_pro");
  if (!targetPrice || subscription.stripePriceId === targetPrice) return subscription;
  const remote = await retrieveSubscription(subscription.stripeSubscriptionId);
  const itemId = remote.items.data[0]?.id;
  if (!itemId) return subscription;
  await stripeRequest(`/subscriptions/${subscription.stripeSubscriptionId}`, {
    method: "POST",
    body: new URLSearchParams({
      "items[0][id]": itemId,
      "items[0][price]": targetPrice,
      proration_behavior: "create_prorations",
    }),
  });
  const updated = await upsertStripeSubscription({
    payerType: "company",
    clientId,
    email: account.email,
    stripeCustomerId: account.stripeCustomerId ?? (typeof remote.customer === "string" ? remote.customer : remote.customer.id),
    stripeSubscriptionId: subscription.stripeSubscriptionId,
    stripePriceId: targetPrice,
    planKey: member ? "company_pro_firm_member" : "company_pro",
    status: remote.status === "active" || remote.status === "trialing" || remote.status === "past_due" ? remote.status : "canceled",
  });
  remote.items.data[0]!.price.id = targetPrice;
  await ensureIntroListSchedule(remote);
  return updated;
}

export async function applyStripeSubscription(subscription: StripeSubscription, sourceEventCreatedAt?: Date | null) {
  const metadata = subscription.metadata ?? {};
  const payerType = metadata.liableParty === "firm" ? "firm" : "company";
  const firmId = metadata.firmId ? Number(metadata.firmId) : null;
  const clientId = metadata.clientId ? Number(metadata.clientId) : null;
  const priceId = subscription.items.data[0]?.price.id ?? null;
  const status = subscription.status === "active" || subscription.status === "trialing" || subscription.status === "past_due"
    ? subscription.status
    : "canceled";
  const periodEnd = subscription.current_period_end ?? subscription.items.data[0]?.current_period_end ?? null;
  const local = await upsertStripeSubscription({
    payerType,
    firmId,
    clientId,
    stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    planKey: planKeyFromPriceId(priceId),
    status,
    trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    sourceEventCreatedAt,
  });
  if (!sourceEventCreatedAt || !local.sourceEventCreatedAt || sourceEventCreatedAt >= local.sourceEventCreatedAt) {
    await ensureIntroListSchedule(subscription);
  }
  return local;
}

export async function constructStripeEvent(rawBody: Buffer, signature: string, now = new Date()) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("Stripe webhook is not configured.");
  const parts = signature.split(",").map((item) => {
    const [key, ...rest] = item.split("=");
    return [key, rest.join("=")];
  });
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const candidates = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !candidates.length || !/^\d+$/.test(timestamp)) throw new Error("Invalid Stripe signature.");
  const signedAt = Number(timestamp);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (Math.abs(nowSeconds - signedAt) > STRIPE_WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error("Stripe signature timestamp is outside the allowed tolerance.");
  }
  const signed = `${timestamp}.${rawBody.toString("utf8")}`;
  const digest = createHmac("sha256", secret).update(signed).digest("hex");
  const left = Buffer.from(digest);
  const matches = candidates.some((candidate) => {
    const right = Buffer.from(candidate);
    return left.length === right.length && timingSafeEqual(left, right);
  });
  if (!matches) {
    throw new Error("Stripe signature mismatch.");
  }
  const event = JSON.parse(rawBody.toString("utf8")) as Partial<StripeEvent>;
  if (
    typeof event.id !== "string"
    || typeof event.created !== "number"
    || !Number.isInteger(event.created)
    || typeof event.type !== "string"
    || !event.data
    || typeof event.data.object !== "object"
  ) throw new Error("Invalid Stripe event envelope.");
  return event as StripeEvent;
}
