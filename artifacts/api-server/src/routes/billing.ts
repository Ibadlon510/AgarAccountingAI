import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  CreateBillingCheckoutBody,
  CreateBillingCheckoutResponse,
  CreateBillingPortalBody,
  CreateBillingPortalResponse,
  GetBillingMeResponse,
  SimulateBillingDevBody,
  SimulateBillingDevResponse,
} from "@workspace/api-zod";
import {
  billingAccountsTable,
  billingSubscriptionsTable,
  clientWorkspacesTable,
  clientsTable,
  db,
  firmMembershipsTable,
  firmProfilesTable,
} from "@workspace/db";
import {
  currentPriceCatalog,
  ensureLocalCompanyTrial,
  ensureLocalFirmTrial,
  ensureBillingAccount,
  resolveBilling,
  resolveCompanyBilling,
  resolveFirmBilling,
} from "../lib/billing";
import { createCheckoutSession, createPortalSession, publicAppUrl, stripeClient } from "../lib/stripeBilling";

const router: IRouter = Router();

function currentUserId(req: Request) {
  if (!req.dbUser) throw new Error("Authenticated user is required.");
  return req.dbUser.id;
}

async function requireFirmManager(req: Request, res: Response, firmId: number) {
  const [row] = await db.select().from(firmMembershipsTable).where(and(
    eq(firmMembershipsTable.firmId, firmId),
    eq(firmMembershipsTable.userId, currentUserId(req)),
    eq(firmMembershipsTable.status, "active"),
  )).limit(1);
  if (!row || (row.role !== "owner" && row.role !== "admin")) {
    res.status(403).json({ error: "Only firm owners or admins can manage firm billing." });
    return null;
  }
  return row;
}

async function requireCompanyBillingManager(req: Request, res: Response, clientId: number) {
  const userId = currentUserId(req);
  const [client] = await db.select({
    ownerUserId: clientsTable.ownerUserId,
    subscriptionLiableParty: clientsTable.subscriptionLiableParty,
  }).from(clientsTable).where(eq(clientsTable.id, clientId)).limit(1);
  if (!client) {
    res.status(404).json({ error: "Company workspace not found." });
    return null;
  }
  if (client.ownerUserId !== userId) {
    const [membership] = await db.select({ role: clientWorkspacesTable.role })
      .from(clientWorkspacesTable)
      .where(and(
        eq(clientWorkspacesTable.clientId, clientId),
        eq(clientWorkspacesTable.userId, userId),
      ))
      .limit(1);
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      res.status(403).json({ error: "Only the company owner or a workspace admin can manage company billing." });
      return null;
    }
  }
  if (client.subscriptionLiableParty !== "company") {
    res.status(400).json({ error: "This workspace is billed to a firm." });
    return null;
  }
  return client;
}

router.get("/billing/me", async (req, res) => {
  const userId = currentUserId(req);
  const firms = await db.select({ firm: firmProfilesTable }).from(firmMembershipsTable)
    .innerJoin(firmProfilesTable, eq(firmProfilesTable.id, firmMembershipsTable.firmId))
    .where(and(
      eq(firmMembershipsTable.userId, userId),
      eq(firmMembershipsTable.status, "active"),
      eq(firmProfilesTable.profileKind, "accounting_firm"),
    ));
  const ownedCompanies = await db.select().from(clientsTable).where(and(
    eq(clientsTable.ownerUserId, userId),
    eq(clientsTable.subscriptionLiableParty, "company"),
  ));
  const firmBilling = [];
  for (const { firm } of firms) {
    await ensureLocalFirmTrial(firm.id, req.dbUser?.email);
    const billing = await resolveFirmBilling(firm.id);
    if (billing) firmBilling.push(billing);
  }
  const companyBilling = [];
  for (const client of ownedCompanies) {
    await ensureLocalCompanyTrial(client.id, req.dbUser?.email);
    companyBilling.push(await resolveCompanyBilling(client));
  }
  res.json(GetBillingMeResponse.parse({
    prices: currentPriceCatalog(),
    stripeEnabled: Boolean(stripeClient()),
    firms: firmBilling,
    companies: companyBilling,
  }));
});

router.post("/billing/checkout", async (req, res) => {
  const parsed = CreateBillingCheckoutBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a firm or company workspace to upgrade." });
  const body = parsed.data;
  if (body.payerType === "firm") {
    if (!body.firmId) return res.status(400).json({ error: "A firm is required." });
    if (!await requireFirmManager(req, res, body.firmId)) return;
    if (!stripeClient()) return res.status(501).json({ error: "Billing checkout is not configured yet." });
    const origin = publicAppUrl(req);
    const session = await createCheckoutSession({
      payerType: "firm",
      firmId: body.firmId,
      email: req.dbUser?.email,
      clerkUserId: currentUserId(req),
      successUrl: `${origin}/firm-settings?billing=success`,
      cancelUrl: `${origin}/billing/firm?billing=cancel`,
    });
    return res.json(CreateBillingCheckoutResponse.parse({ url: session.url }));
  }
  if (!body.clientId) return res.status(400).json({ error: "A company workspace is required." });
  if (!await requireCompanyBillingManager(req, res, body.clientId)) return;
  const billing = await resolveBilling(body.clientId);
  if (!billing || billing.payer !== "company") {
    return res.status(400).json({ error: "This workspace is billed to a firm." });
  }
  if (!stripeClient()) return res.status(501).json({ error: "Billing checkout is not configured yet." });
  const origin = publicAppUrl(req);
  const session = await createCheckoutSession({
    payerType: "company",
    clientId: body.clientId,
    email: req.dbUser?.email,
    clerkUserId: currentUserId(req),
    successUrl: `${origin}/client-settings?billing=success`,
    cancelUrl: `${origin}/client-settings?billing=cancel`,
  });
  return res.json(CreateBillingCheckoutResponse.parse({ url: session.url }));
});

router.post("/billing/portal", async (req, res) => {
  const parsed = CreateBillingPortalBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a firm or company workspace." });
  const body = parsed.data;
  if (body.payerType === "firm") {
    if (!body.firmId) return res.status(400).json({ error: "A firm is required." });
    if (!await requireFirmManager(req, res, body.firmId)) return;
  } else {
    if (!body.clientId) return res.status(400).json({ error: "A company workspace is required." });
    if (!await requireCompanyBillingManager(req, res, body.clientId)) return;
  }
  if (!stripeClient()) return res.status(501).json({ error: "Billing portal is not configured yet." });
  const account = body.payerType === "firm" && body.firmId
    ? (await db.select().from(billingAccountsTable).where(and(eq(billingAccountsTable.payerType, "firm"), eq(billingAccountsTable.firmId, body.firmId))).limit(1))[0]
    : body.clientId
      ? (await db.select().from(billingAccountsTable).where(and(eq(billingAccountsTable.payerType, "company"), eq(billingAccountsTable.clientId, body.clientId))).limit(1))[0]
      : null;
  if (!account?.stripeCustomerId) return res.status(404).json({ error: "No billing customer exists yet. Upgrade first." });
  const origin = publicAppUrl(req);
  const session = await createPortalSession(
    account.stripeCustomerId,
    body.payerType === "firm" ? `${origin}/firm-settings` : `${origin}/client-settings`,
  );
  return res.json(CreateBillingPortalResponse.parse({ url: session.url }));
});

router.post("/billing/dev-simulate", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Development billing simulation is disabled." });
  }
  const parsed = SimulateBillingDevBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid billing state and workspace." });
  const body = parsed.data;
  const firmStates = ["trialing", "active", "past_due", "lapsed_readonly", "locked"] as const;
  const companyStates = ["trialing", "pro", "free"] as const;
  if (body.payerType === "firm") {
    if (!body.firmId || !firmStates.includes(body.state as typeof firmStates[number])) {
      return res.status(400).json({ error: "Choose a valid firm billing state." });
    }
    if (!await requireFirmManager(req, res, body.firmId)) return;
  } else {
    if (!body.clientId || !companyStates.includes(body.state as typeof companyStates[number])) {
      return res.status(400).json({ error: "Choose a valid company billing state." });
    }
    if (!await requireCompanyBillingManager(req, res, body.clientId)) return;
  }

  const account = await ensureBillingAccount({
    payerType: body.payerType,
    firmId: body.payerType === "firm" ? body.firmId : undefined,
    clientId: body.payerType === "company" ? body.clientId : undefined,
    email: req.dbUser?.email,
  });
  const [existing] = await db.select().from(billingSubscriptionsTable)
    .where(eq(billingSubscriptionsTable.billingAccountId, account.id))
    .orderBy(desc(billingSubscriptionsTable.updatedAt), desc(billingSubscriptionsTable.id))
    .limit(1);
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  const isFirm = body.payerType === "firm";
  const isActive = body.state === "active" || body.state === "past_due" || body.state === "pro";
  const planKey = isFirm
    ? "firm"
    : "company_pro";
  const status = body.state === "trialing"
    ? "trialing"
    : body.state === "past_due"
      ? "past_due"
      : isActive
        ? "active"
        : "canceled";
  const trialEndsAt = body.state === "lapsed_readonly"
    ? new Date(now.getTime() - day)
    : body.state === "locked" || body.state === "free"
      ? new Date(now.getTime() - 60 * day)
      : new Date(now.getTime() + (isFirm ? 15 : 14) * day);
  const stripeSubscriptionId = isActive ? `dev_sub_${body.payerType}_${account.id}` : null;
  const stripePriceId = isActive ? `dev_price_${planKey}` : null;
  const values = {
    stripeSubscriptionId,
    stripePriceId,
    stripeScheduleId: null,
    planKey,
    status,
    trialEndsAt,
    currentPeriodEnd: isActive ? new Date(now.getTime() + 30 * day) : null,
    cancelAtPeriodEnd: false,
    sourceEventCreatedAt: null,
    updatedAt: now,
  } as const;
  if (existing) {
    await db.update(billingSubscriptionsTable).set(values).where(eq(billingSubscriptionsTable.id, existing.id));
  } else {
    await db.insert(billingSubscriptionsTable).values({ billingAccountId: account.id, ...values });
  }
  return res.json(SimulateBillingDevResponse.parse({ payerType: body.payerType, state: body.state }));
});

export default router;
