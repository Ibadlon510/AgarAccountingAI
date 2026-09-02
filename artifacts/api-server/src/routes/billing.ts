import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  CreateBillingCheckoutBody,
  CreateBillingCheckoutResponse,
  CreateBillingPortalBody,
  CreateBillingPortalResponse,
  GetBillingMeResponse,
} from "@workspace/api-zod";
import {
  billingAccountsTable,
  clientsTable,
  db,
  firmMembershipsTable,
  firmProfilesTable,
} from "@workspace/db";
import {
  currentPriceCatalog,
  ensureLocalCompanyTrial,
  ensureLocalFirmTrial,
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
  if (!stripeClient()) return res.status(501).json({ error: "Billing checkout is not configured yet." });
  const body = parsed.data;
  const origin = publicAppUrl(req);
  if (body.payerType === "firm") {
    if (!body.firmId) return res.status(400).json({ error: "A firm is required." });
    if (!await requireFirmManager(req, res, body.firmId)) return;
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
  const billing = await resolveBilling(body.clientId);
  if (!billing || billing.payer !== "company") {
    return res.status(400).json({ error: "This workspace is billed to a firm." });
  }
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
  if (!stripeClient()) return res.status(501).json({ error: "Billing portal is not configured yet." });
  const body = parsed.data;
  const account = body.payerType === "firm" && body.firmId
    ? (await db.select().from(billingAccountsTable).where(and(eq(billingAccountsTable.payerType, "firm"), eq(billingAccountsTable.firmId, body.firmId))).limit(1))[0]
    : body.clientId
      ? (await db.select().from(billingAccountsTable).where(and(eq(billingAccountsTable.payerType, "company"), eq(billingAccountsTable.clientId, body.clientId))).limit(1))[0]
      : null;
  if (body.payerType === "firm" && body.firmId && !await requireFirmManager(req, res, body.firmId)) return;
  if (!account?.stripeCustomerId) return res.status(404).json({ error: "No billing customer exists yet. Upgrade first." });
  const origin = publicAppUrl(req);
  const session = await createPortalSession(
    account.stripeCustomerId,
    body.payerType === "firm" ? `${origin}/firm-settings` : `${origin}/client-settings`,
  );
  res.json(CreateBillingPortalResponse.parse({ url: session.url }));
});

export default router;
