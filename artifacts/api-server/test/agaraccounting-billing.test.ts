import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  COMPANY_TRIAL_DAYS,
  ensureLocalCompanyTrial,
  resolveCompanyBilling,
  upsertStripeSubscription,
} from "../src/lib/billing";

let server: Server | undefined;
let baseUrl = "";
let database: typeof import("@workspace/db") | undefined;
const userIds = [
  `billing-firm-${randomUUID()}`,
  `billing-company-${randomUUID()}`,
  `billing-dual-${randomUUID()}`,
  `billing-transfer-firm-${randomUUID()}`,
  `billing-transfer-owner-${randomUUID()}`,
  `billing-white-label-${randomUUID()}`,
  `billing-auth-owner-${randomUUID()}`,
  `billing-auth-outsider-${randomUUID()}`,
  `billing-dev-simulator-${randomUUID()}`,
];
const clientIds: number[] = [];
const firmIds: number[] = [];

function testDatabaseUrl() {
  const value = process.env.AGARACCOUNTING_TEST_DATABASE_URL;
  if (!value) throw new Error("AGARACCOUNTING_TEST_DATABASE_URL is required for AgarAccounting AI System integration tests.");
  const databaseName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
  if (!/(^|[_-])test(?:[_-]|$)/i.test(databaseName)) {
    throw new Error("The AgarAccounting AI System integration test database name must contain 'test'.");
  }
  return value;
}

async function request<T>(path: string, userId: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-user-id": userId,
      ...init?.headers,
    },
  });
  return { response, body: await response.json() as T };
}

async function postJournal(userId: string, clientId: number) {
  return request<{ code?: string; error?: string }>("/agaraccounting/journal-entries", userId, {
    method: "POST",
    body: JSON.stringify({
      clientId,
      date: "2026-08-31",
      memo: "Billing gate probe",
      currency: "AED",
      lines: [
        { description: "Office rent", account: "Rent expense", debit: 100, credit: 0 },
        { description: "August accrual", account: "Accrued expenses", debit: 0, credit: 100 },
      ],
    }),
  });
}

async function onboard(userId: string, mode: "firm" | "company" | "both") {
  await request<unknown[]>("/clients", userId);
  return request<{
    firms: Array<{ firmId: number }>;
    companies: Array<{ id: number }>;
  }>("/organizations/onboarding", userId, {
    method: "POST",
    body: JSON.stringify({
      mode,
      firstName: "Billing",
      lastName: "Tester",
      companyName: mode === "firm" ? undefined : "Billing Co",
      companyLegalName: mode === "firm" ? undefined : "Billing Co LLC",
      firmName: mode === "company" ? undefined : "Billing Firm",
      firmLegalName: mode === "company" ? undefined : "Billing Firm LLC",
      functionalCurrency: "AED",
      basis: "IFRS",
      period: "December 2026",
    }),
  });
}

before(async () => {
  process.env.DATABASE_URL = testDatabaseUrl();
  const { createApp } = await import("../src/app");
  const { createRequireAuth } = await import("../src/middlewares/authMiddleware");
  database = await import("@workspace/db");
  const app = createApp({
    clerkAuthMiddleware: (_req, _res, next) => next(),
    requireAuthMiddleware: createRequireAuth((req) => ({
      sessionClaims: { userId: req.headers["x-test-user-id"] },
    })),
  });
  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, () => resolve(listener));
    listener.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}/api`;
});

after(async () => {
  try {
    if (database) {
      if (clientIds.length) {
        const accounts = await database.db.select({ id: database.billingAccountsTable.id }).from(database.billingAccountsTable).where(inArray(database.billingAccountsTable.clientId, clientIds));
        const accountIds = accounts.map((account) => account.id);
        if (accountIds.length) {
          await database.db.delete(database.billingSubscriptionsTable).where(inArray(database.billingSubscriptionsTable.billingAccountId, accountIds));
          await database.db.delete(database.billingAccountsTable).where(inArray(database.billingAccountsTable.id, accountIds));
        }
        await database.db.delete(database.reportPacksTable).where(inArray(database.reportPacksTable.clientId, clientIds));
        await database.db.delete(database.firmCompanyEngagementsTable).where(inArray(database.firmCompanyEngagementsTable.clientId, clientIds));
        await database.db.delete(database.journalEntriesTable).where(inArray(database.journalEntriesTable.clientId, clientIds));
        await database.db.delete(database.clientWorkspacesTable).where(inArray(database.clientWorkspacesTable.clientId, clientIds));
        await database.db.delete(database.clientsTable).where(inArray(database.clientsTable.id, clientIds));
      }
      if (firmIds.length) {
        const accounts = await database.db.select({ id: database.billingAccountsTable.id }).from(database.billingAccountsTable).where(inArray(database.billingAccountsTable.firmId, firmIds));
        const accountIds = accounts.map((account) => account.id);
        if (accountIds.length) {
          await database.db.delete(database.billingSubscriptionsTable).where(inArray(database.billingSubscriptionsTable.billingAccountId, accountIds));
          await database.db.delete(database.billingAccountsTable).where(inArray(database.billingAccountsTable.id, accountIds));
        }
        await database.db.delete(database.firmMembershipsTable).where(inArray(database.firmMembershipsTable.firmId, firmIds));
        await database.db.delete(database.firmProfilesTable).where(inArray(database.firmProfilesTable.id, firmIds));
      }
      await database.db.delete(database.usersTable).where(inArray(database.usersTable.id, userIds));
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("starts a firm trial, then read-only, then locks firm-liable reads", async () => {
  assert.ok(database);
  const userId = userIds[0]!;
  const onboarded = await onboard(userId, "firm");
  assert.equal(onboarded.response.status, 200);
  const firmId = onboarded.body.firms[0]?.firmId;
  assert.ok(firmId);
  firmIds.push(firmId);

  const billing = await request<{
    firms: Array<{ status: string; fullAccess: boolean }>;
    stripeEnabled: boolean;
    prices: { introActive: boolean; firm: { current: number; list: number } };
  }>("/billing/me", userId);
  assert.equal(billing.response.status, 200);
  assert.equal(billing.body.firms[0]?.status, "trialing");
  assert.equal(billing.body.firms[0]?.fullAccess, true);

  const created = await request<{ id: number }>("/clients", userId, {
    method: "POST",
    body: JSON.stringify({
      name: "Firm Client Books",
      legalName: "Firm Client Books LLC",
      creationMode: "firm_client",
      firmId,
      functionalCurrency: "AED",
      basis: "IFRS",
      period: "December 2026",
    }),
  });
  assert.equal(created.response.status, 201);
  clientIds.push(created.body.id);

  const overview = await request<unknown>(`/agaraccounting/firm-overview?firmId=${firmId}`, userId);
  assert.equal(overview.response.status, 200);

  const [account] = await database.db.select().from(database.billingAccountsTable).where(and(
    eq(database.billingAccountsTable.payerType, "firm"),
    eq(database.billingAccountsTable.firmId, firmId),
  ));
  assert.ok(account);
  await database.db.update(database.billingSubscriptionsTable).set({
    trialEndsAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000),
  }).where(eq(database.billingSubscriptionsTable.billingAccountId, account.id));

  const readonlyOverview = await request<{ code?: string }>(`/agaraccounting/firm-overview?firmId=${firmId}`, userId);
  assert.equal(readonlyOverview.response.status, 402);
  assert.equal(readonlyOverview.body.code, "firm_lapsed");
  const readonlyRead = await request<unknown[]>(`/agaraccounting/journal-entries?clientId=${created.body.id}`, userId);
  assert.equal(readonlyRead.response.status, 200);
  const readonlyWrite = await postJournal(userId, created.body.id);
  assert.equal(readonlyWrite.response.status, 402);
  assert.equal(readonlyWrite.body.code, "firm_readonly");

  await database.db.update(database.billingSubscriptionsTable).set({
    trialEndsAt: new Date(Date.now() - 46 * 24 * 60 * 60 * 1000),
  }).where(eq(database.billingSubscriptionsTable.billingAccountId, account.id));

  const lockedOverview = await request<{ code?: string }>(`/agaraccounting/firm-overview?firmId=${firmId}`, userId);
  assert.equal(lockedOverview.response.status, 402);
  assert.equal(lockedOverview.body.code, "firm_locked");
  const lockedRead = await request<{ code?: string }>(`/agaraccounting/journal-entries?clientId=${created.body.id}`, userId);
  assert.equal(lockedRead.response.status, 402);
  assert.equal(lockedRead.body.code, "firm_locked");

  const checkout = await request<{ error: string }>("/billing/checkout", userId, {
    method: "POST",
    body: JSON.stringify({ payerType: "firm", firmId }),
  });
  assert.equal(checkout.response.status, 501);
});

test("simulates firm and company subscription states without Stripe", async () => {
  const userId = userIds[8]!;
  const onboarded = await onboard(userId, "both");
  assert.equal(onboarded.response.status, 200);
  const firmId = onboarded.body.firms[0]?.firmId;
  const clientId = onboarded.body.companies[0]?.id;
  assert.ok(firmId);
  assert.ok(clientId);
  firmIds.push(firmId);
  clientIds.push(clientId);

  const activeFirm = await request<{ state: string }>("/billing/dev-simulate", userId, {
    method: "POST",
    body: JSON.stringify({ payerType: "firm", firmId, state: "active" }),
  });
  assert.equal(activeFirm.response.status, 200);
  assert.equal(activeFirm.body.state, "active");
  const proCompany = await request<{ state: string }>("/billing/dev-simulate", userId, {
    method: "POST",
    body: JSON.stringify({ payerType: "company", clientId, state: "pro" }),
  });
  assert.equal(proCompany.response.status, 200);

  const active = await request<{
    firms: Array<{ firmId: number; status: string }>;
    companies: Array<{ clientId: number; status: string; plan: string }>;
  }>("/billing/me", userId);
  assert.equal(active.body.firms.find((firm) => firm.firmId === firmId)?.status, "active");
  assert.equal(active.body.companies.find((company) => company.clientId === clientId)?.status, "pro");
  assert.equal(active.body.companies.find((company) => company.clientId === clientId)?.plan, "pro");

  const lockedFirm = await request<{ state: string }>("/billing/dev-simulate", userId, {
    method: "POST",
    body: JSON.stringify({ payerType: "firm", firmId, state: "locked" }),
  });
  assert.equal(lockedFirm.response.status, 200);
  const freeCompany = await request<{ state: string }>("/billing/dev-simulate", userId, {
    method: "POST",
    body: JSON.stringify({ payerType: "company", clientId, state: "free" }),
  });
  assert.equal(freeCompany.response.status, 200);

  const inactive = await request<{
    firms: Array<{ firmId: number; status: string }>;
    companies: Array<{ clientId: number; status: string; plan: string }>;
  }>("/billing/me", userId);
  assert.equal(inactive.body.firms.find((firm) => firm.firmId === firmId)?.status, "locked");
  assert.equal(inactive.body.companies.find((company) => company.clientId === clientId)?.status, "free");
  assert.equal(inactive.body.companies.find((company) => company.clientId === clientId)?.plan, "free");
});

test("gives each company-liable workspace its own 14-day trial, then Free, and locks writes over the revenue threshold", async () => {
  assert.ok(database);
  const userId = userIds[1]!;
  await request<unknown[]>("/clients", userId);
  const first = await request<Array<{ id: number }>>("/clients", userId);
  const firstId = first.body[0]?.id;
  assert.ok(firstId);
  clientIds.push(firstId);
  const second = await request<{ id: number }>("/clients", userId, {
    method: "POST",
    body: JSON.stringify({
      name: "Second Books",
      legalName: "Second Books LLC",
      creationMode: "own_company",
      functionalCurrency: "AED",
      basis: "IFRS",
      period: "December 2026",
    }),
  });
  assert.equal(second.response.status, 201);
  clientIds.push(second.body.id);

  const me = await request<{
    companies: Array<{ clientId: number; status: string; plan: string; trialEndsAt: string | null }>;
  }>("/billing/me", userId);
  assert.equal(me.response.status, 200);
  const firstBilling = me.body.companies.find((company) => company.clientId === firstId);
  const secondBilling = me.body.companies.find((company) => company.clientId === second.body.id);
  assert.equal(firstBilling?.status, "trialing");
  assert.equal(secondBilling?.status, "trialing");
  assert.ok(firstBilling?.trialEndsAt);
  assert.ok(secondBilling?.trialEndsAt);

  const [firstAccount] = await database.db.select().from(database.billingAccountsTable).where(and(
    eq(database.billingAccountsTable.payerType, "company"),
    eq(database.billingAccountsTable.clientId, firstId),
  ));
  assert.ok(firstAccount);
  await database.db.update(database.billingSubscriptionsTable).set({
    trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  }).where(eq(database.billingSubscriptionsTable.billingAccountId, firstAccount.id));

  const afterExpiry = await request<{
    companies: Array<{ clientId: number; status: string; plan: string }>;
  }>("/billing/me", userId);
  assert.equal(afterExpiry.body.companies.find((company) => company.clientId === firstId)?.status, "free");
  assert.equal(afterExpiry.body.companies.find((company) => company.clientId === second.body.id)?.status, "trialing");

  await database.db.insert(database.reportPacksTable).values({
    clientId: firstId,
    createdBy: userId,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    comparativePeriodStart: "2025-01-01",
    comparativePeriodEnd: "2025-12-31",
    presentationCurrency: "AED",
    snapshot: { profitOrLossAndOci: [{ label: "Revenue", current: 400_000 }] },
    validation: {},
    notes: [],
    checklist: [],
    signatory: { preparedBy: "A", reviewedBy: "B", authorizedBy: "C", authorizationDate: "2026-12-31" },
  });
  const gated = await request<{
    companies: Array<{ clientId: number; status: string }>;
  }>("/billing/me", userId);
  assert.equal(gated.body.companies.find((company) => company.clientId === firstId)?.status, "requires_pro");
  const blocked = await postJournal(userId, firstId);
  assert.equal(blocked.response.status, 402);
  assert.equal(blocked.body.code, "requires_pro");
});

test("lets a dual-mode user keep company-owned books after the firm locks", async () => {
  assert.ok(database);
  const userId = userIds[2]!;
  const onboarded = await onboard(userId, "both");
  assert.equal(onboarded.response.status, 200);
  const firmId = onboarded.body.firms[0]?.firmId;
  assert.ok(firmId);
  firmIds.push(firmId);
  const companyId = onboarded.body.companies?.[0]?.id;
  const clients = await request<Array<{ id: number; subscriptionLiableParty: string }>>("/clients", userId);
  const own = clients.body.find((client) => client.subscriptionLiableParty === "company");
  assert.ok(own);
  clientIds.push(own.id);
  if (companyId && companyId !== own.id) clientIds.push(companyId);

  const [account] = await database.db.select().from(database.billingAccountsTable).where(and(
    eq(database.billingAccountsTable.payerType, "firm"),
    eq(database.billingAccountsTable.firmId, firmId),
  ));
  assert.ok(account);
  await database.db.update(database.billingSubscriptionsTable).set({
    trialEndsAt: new Date(Date.now() - 46 * 24 * 60 * 60 * 1000),
  }).where(eq(database.billingSubscriptionsTable.billingAccountId, account.id));

  const locked = await request<{ code?: string }>(`/agaraccounting/firm-overview?firmId=${firmId}`, userId);
  assert.equal(locked.response.status, 402);
  assert.equal(locked.body.code, "firm_locked");
  const ownBooks = await request<unknown[]>(`/agaraccounting/journal-entries?clientId=${own.id}`, userId);
  assert.equal(ownBooks.response.status, 200);
});

test("derives dual mode from active firm and company memberships instead of a stale onboarding choice", async () => {
  assert.ok(database);
  const staleModeUserId = `billing-stale-mode-${randomUUID()}`;
  userIds.push(staleModeUserId);

  const companyOnboarding = await onboard(staleModeUserId, "company");
  assert.equal(companyOnboarding.response.status, 200);
  const clientId = companyOnboarding.body.companies[0]?.id;
  assert.ok(clientId);
  clientIds.push(clientId);

  const [firm] = await database.db.insert(database.firmProfilesTable).values({
    ownerUserId: staleModeUserId,
    name: "Later Registered Firm",
    legalName: "Later Registered Firm LLC",
    profileKind: "accounting_firm",
  }).returning();
  assert.ok(firm);
  firmIds.push(firm.id);
  await database.db.insert(database.firmMembershipsTable).values({
    firmId: firm.id,
    userId: staleModeUserId,
    role: "owner",
    status: "active",
  });

  const context = await request<{ mode: string; firms: Array<{ firmId: number }> }>("/organizations/context", staleModeUserId);
  assert.equal(context.response.status, 200);
  assert.equal(context.body.mode, "both");
  assert.equal(context.body.firms[0]?.firmId, firm.id);
});

test("starts a fresh 14-day company trial when liability transfers to the company", async () => {
  assert.ok(database);
  const firmUser = userIds[3]!;
  const onboarded = await onboard(firmUser, "firm");
  assert.equal(onboarded.response.status, 200);
  const firmId = onboarded.body.firms[0]?.firmId;
  assert.ok(firmId);
  firmIds.push(firmId);
  const created = await request<{ id: number }>("/clients", firmUser, {
    method: "POST",
    body: JSON.stringify({
      name: "Transferred Books",
      legalName: "Transferred Books LLC",
      creationMode: "firm_client",
      firmId,
      functionalCurrency: "AED",
      basis: "IFRS",
      period: "December 2026",
    }),
  });
  assert.equal(created.response.status, 201);
  clientIds.push(created.body.id);
  await database.db.update(database.clientsTable).set({
    ownerUserId: firmUser,
    ownershipStatus: "company_owned",
    subscriptionLiableParty: "company",
    transferredAt: new Date(),
  }).where(eq(database.clientsTable.id, created.body.id));
  await ensureLocalCompanyTrial(created.body.id, null, { restart: true });
  const [client] = await database.db.select().from(database.clientsTable).where(eq(database.clientsTable.id, created.body.id));
  assert.ok(client);
  const billing = await resolveCompanyBilling(client);
  assert.equal(billing.status, "trialing");
  assert.ok(billing.trialEndsAt);
  const remainingMs = new Date(billing.trialEndsAt).getTime() - Date.now();
  assert.ok(remainingMs > (COMPANY_TRIAL_DAYS - 1) * 24 * 60 * 60 * 1000);
});

test("publishes a white-label landing during the firm trial and hides it after lapse", async () => {
  assert.ok(database);
  const userId = userIds[5]!;
  await request<unknown[]>("/clients", userId);
  const onboarded = await request<{ firms: Array<{ firmId: number }> }>("/organizations/onboarding", userId, {
    method: "POST",
    body: JSON.stringify({
      mode: "firm",
      firstName: "White",
      lastName: "Label",
      firmName: "North Star Partners",
      firmLegalName: "North Star Partners LLC",
    }),
  });
  assert.equal(onboarded.response.status, 200);
  const firmId = onboarded.body.firms[0]?.firmId;
  assert.ok(firmId);
  firmIds.push(firmId);

  const branding = await request<{
    slug: string;
    available: boolean;
    publicHost: string;
    pathFallback: string;
  }>("/workspace/firm-branding", userId);
  assert.equal(branding.response.status, 200);
  assert.equal(branding.body.available, true);
  assert.equal(branding.body.slug, "north-star-partners");
  assert.equal(branding.body.publicHost, "north-star-partners.agaraccounting.com");
  assert.equal(branding.body.pathFallback, "/f/north-star-partners");

  const saved = await request<{ landingHeadline: string; slug: string }>("/workspace/firm-branding", userId, {
    method: "PATCH",
    body: JSON.stringify({ landingHeadline: "Books, ready for your review." }),
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.landingHeadline, "Books, ready for your review.");

  const publicLanding = await fetch(`${baseUrl}/public/firm-landing/north-star-partners`);
  const publicBody = await publicLanding.json() as { headline: string; name: string };
  assert.equal(publicLanding.status, 200);
  assert.equal(publicBody.name, "North Star Partners");
  assert.equal(publicBody.headline, "Books, ready for your review.");

  const reserved = await fetch(`${baseUrl}/public/firm-landing/www`);
  assert.equal(reserved.status, 404);

  const [account] = await database.db.select().from(database.billingAccountsTable).where(and(
    eq(database.billingAccountsTable.payerType, "firm"),
    eq(database.billingAccountsTable.firmId, firmId),
  ));
  assert.ok(account);
  await database.db.update(database.billingSubscriptionsTable).set({
    trialEndsAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000),
  }).where(eq(database.billingSubscriptionsTable.billingAccountId, account.id));

  const hidden = await fetch(`${baseUrl}/public/firm-landing/north-star-partners`);
  assert.equal(hidden.status, 404);
  const blocked = await request<{ code?: string }>("/workspace/firm-branding", userId, {
    method: "PATCH",
    body: JSON.stringify({ landingHeadline: "Should not save" }),
  });
  assert.equal(blocked.response.status, 402);
});

test("rejects company checkout and portal for non-managers before contacting Stripe", async () => {
  assert.ok(database);
  const ownerUserId = userIds[6]!;
  const outsiderUserId = userIds[7]!;
  const onboarded = await onboard(ownerUserId, "company");
  assert.equal(onboarded.response.status, 200);
  const clientId = onboarded.body.companies[0]?.id;
  assert.ok(clientId);
  clientIds.push(clientId);
  const checkout = await request<{ error: string }>("/billing/checkout", outsiderUserId, {
    method: "POST",
    body: JSON.stringify({ payerType: "company", clientId }),
  });
  assert.equal(checkout.response.status, 403);
  assert.match(checkout.body.error, /owner|admin/i);

  const portal = await request<{ error: string }>("/billing/portal", outsiderUserId, {
    method: "POST",
    body: JSON.stringify({ payerType: "company", clientId }),
  });
  assert.equal(portal.response.status, 403);
  assert.match(portal.body.error, /owner|admin/i);
  const [outsider] = await database.db.select({ starterClientId: database.usersTable.starterClientId })
    .from(database.usersTable)
    .where(eq(database.usersTable.id, outsiderUserId))
    .limit(1);
  if (outsider?.starterClientId) clientIds.push(outsider.starterClientId);

  const stripeSubscriptionId = `sub_ordering_${randomUUID()}`;
  const stripeCustomerId = `cus_${randomUUID()}`;
  const newer = new Date("2026-06-02T00:00:00Z");
  const older = new Date("2026-06-01T00:00:00Z");
  await upsertStripeSubscription({
    payerType: "company",
    clientId,
    stripeCustomerId,
    stripeSubscriptionId,
    stripePriceId: "price_newer",
    planKey: "company_pro",
    status: "active",
    sourceEventCreatedAt: newer,
  });
  const afterOlderEvent = await upsertStripeSubscription({
    payerType: "company",
    clientId,
    stripeCustomerId,
    stripeSubscriptionId,
    stripePriceId: "price_older",
    planKey: "company_pro",
    status: "canceled",
    sourceEventCreatedAt: older,
  });
  assert.equal(afterOlderEvent.status, "active");
  assert.equal(afterOlderEvent.stripePriceId, "price_newer");
  assert.equal(afterOlderEvent.sourceEventCreatedAt?.toISOString(), newer.toISOString());

  await assert.rejects(
    () => database!.db.insert(database!.billingAccountsTable).values({
      payerType: "company",
    }),
    (error: unknown) => {
      const candidate = error as {
        message?: string;
        cause?: { constraint?: string; message?: string };
      };
      return candidate.cause?.constraint === "agaraccounting_billing_accounts_payer_target_check"
        || /payer_target|check constraint/i.test(`${candidate.message ?? ""} ${candidate.cause?.message ?? ""}`);
    },
  );
});

test("atomically claims a valid Stripe event and acknowledges its replay", async () => {
  assert.ok(database);
  const eventId = `evt_${randomUUID()}`;
  const secret = "whsec_billing_replay_test";
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  const created = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    id: eventId,
    created,
    type: "product.updated",
    data: { object: { id: "prod_test" } },
  });
  const digest = createHmac("sha256", secret).update(`${created}.${payload}`).digest("hex");
  const send = () => fetch(`${baseUrl}/billing/webhooks/stripe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${created},v1=${digest}`,
    },
    body: payload,
  });
  try {
    const first = await send();
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { received: true });
    const replay = await send();
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { received: true, duplicate: true });
    const rows = await database.db.select().from(database.billingWebhookEventsTable)
      .where(eq(database.billingWebhookEventsTable.eventId, eventId));
    assert.equal(rows.length, 1);
    assert.ok(rows[0]?.processedAt);
  } finally {
    await database.db.delete(database.billingWebhookEventsTable)
      .where(eq(database.billingWebhookEventsTable.eventId, eventId));
  }
});

