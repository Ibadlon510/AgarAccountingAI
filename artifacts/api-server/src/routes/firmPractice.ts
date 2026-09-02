import { Router, type IRouter, type Request, type Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  ConfirmEngagementOnboardingParams,
  ConfirmEngagementOnboardingResponse,
  CreateEngagementOnboardingBody,
  CreateEngagementOnboardingParams,
  CreateEngagementOnboardingResponse,
  GetEngagementContractInvitationParams,
  GetEngagementContractInvitationResponse,
  GetEngagementOnboardingParams,
  GetEngagementOnboardingResponse,
  GetFirmClientPracticeOverviewParams,
  GetFirmClientPracticeOverviewQueryParams,
  GetFirmClientPracticeOverviewResponse,
  GetFirmOverviewQueryParams,
  GetFirmOverviewResponse,
  ResendEngagementOnboardingParams,
  ResendEngagementOnboardingResponse,
  RevokeEngagementOnboardingParams,
  RevokeEngagementOnboardingResponse,
  SignEngagementContractInvitationBody,
  SignEngagementContractInvitationParams,
  SignEngagementContractInvitationResponse,
} from "@workspace/api-zod";
import {
  clientWorkspacesTable,
  clientsTable,
  db,
  engagementContractsTable,
  firmCompanyEngagementsTable,
  firmMembershipsTable,
  firmProfilesTable,
  organizationInvitationsTable,
  usersTable,
} from "@workspace/db";
import { ensureClientChart } from "../lib/clientChart";
import {
  DEFAULT_ENGAGEMENT_TERMS,
  buildEngagementContractPdf,
  canResendEngagementContract,
  engagementContractEmail,
  engagementContractPdfBase64,
  normalizeEngagementServices,
  type EngagementContractTermsInput,
} from "../lib/engagementContract";
import { sendWorkspaceInvitationEmail } from "../lib/resend";
import { objectStorageService } from "./storage";
import {
  contractConfirmBy,
  emptyLedgerOverview,
  expireStaleEngagementContracts,
  isFirmManagerRole,
  loadClientCloseSnapshots,
  numberValue,
  postedJournalCountsByMonth,
  resolveIfrsRevenue,
  visibleFirmClientIds,
} from "../lib/firmPractice";
import { assertFirmProductAccess, isBillingDenial, limitDenial } from "../lib/billing";
import { syncMemberPrice } from "../lib/stripeBilling";

const router: IRouter = Router();
const WORKSPACE_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function currentUserId(req: Request) {
  if (!req.dbUser) throw new Error("Authenticated user is required.");
  return req.dbUser.id;
}

function organizationInviteLink(req: Request, token: string) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = typeof forwardedProto === "string" ? forwardedProto : req.protocol;
  const host = typeof req.headers["x-forwarded-host"] === "string" ? req.headers["x-forwarded-host"] : req.get("host");
  if (!host) throw new Error("Unable to determine the invitation host.");
  return `${protocol}://${host}/?organizationInvite=${encodeURIComponent(token)}`;
}

async function requireFirmMembership(req: Request, res: Response, firmId: number) {
  const [membership] = await db.select({
    membership: firmMembershipsTable,
    firm: firmProfilesTable,
  }).from(firmMembershipsTable)
    .innerJoin(firmProfilesTable, eq(firmProfilesTable.id, firmMembershipsTable.firmId))
    .where(and(
      eq(firmMembershipsTable.firmId, firmId),
      eq(firmMembershipsTable.userId, currentUserId(req)),
      eq(firmMembershipsTable.status, "active"),
    ))
    .limit(1);
  if (!membership) {
    res.status(403).json({ error: "You do not have access to this firm." });
    return null;
  }
  const access = await assertFirmProductAccess(firmId);
  if (isBillingDenial(access)) {
    res.status(402).json(access);
    return null;
  }
  return membership;
}

function contractTerms(row: typeof engagementContractsTable.$inferSelect): EngagementContractTermsInput {
  return {
    services: normalizeEngagementServices(row.services),
    agreedTransactionsPerMonth: row.agreedTransactionsPerMonth,
    agreedRevenuePerYear: numberValue(row.agreedRevenuePerYear),
    agreedRevenueCurrency: row.agreedRevenueCurrency,
    startDate: row.startDate,
    endDate: row.endDate,
    feeNote: row.feeNote,
    termsText: row.termsText,
    firmLegalName: row.firmLegalName,
    clientLegalName: row.clientLegalName,
  };
}

async function persistContractPdf(row: typeof engagementContractsTable.$inferSelect) {
  const pdf = buildStoredContractPdf(row);
  if (!pdf) return row;
  try {
    const pdfObjectPath = await objectStorageService.storePrivateObject(
      `engagement-contracts/${row.firmId}/${row.clientId}`,
      pdf,
      "application/pdf",
    );
    const [updated] = await db.update(engagementContractsTable)
      .set({ pdfObjectPath })
      .where(eq(engagementContractsTable.id, row.id))
      .returning();
    return updated ?? { ...row, pdfObjectPath };
  } catch {
    return row;
  }
}

function buildStoredContractPdf(row: typeof engagementContractsTable.$inferSelect) {
  try {
    return Buffer.from(buildEngagementContractPdf({ ...contractTerms(row), signerName: row.signerName, signedAt: row.signedAt }));
  } catch {
    return undefined;
  }
}

async function contractPdfBase64(row: typeof engagementContractsTable.$inferSelect) {
  if (row.pdfObjectPath) {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(row.pdfObjectPath);
      const [buffer] = await objectFile.download();
      return Buffer.from(buffer).toString("base64");
    } catch {
      // Fall through to a generated copy when storage is unavailable.
    }
  }
  return engagementContractPdfBase64({ ...contractTerms(row), signerName: row.signerName, signedAt: row.signedAt });
}

async function onboardingResponse(
  row: typeof engagementContractsTable.$inferSelect,
  clientName: string,
  extras?: { inviteLink?: string; inviteExpiresAt?: Date | null; includePdf?: boolean; emailDeliveryStatus?: "sent" | "failed" },
) {
  const terms = contractTerms(row);
  return {
    id: row.id,
    engagementId: row.engagementId,
    firmId: row.firmId,
    clientId: row.clientId,
    clientName,
    status: row.status as "draft" | "sent" | "signed" | "confirmed" | "expired" | "revoked",
    terms,
    signerEmail: row.signerEmail,
    signerName: row.signerName,
    signedAt: row.signedAt,
    sentAt: row.sentAt,
    confirmBy: row.confirmBy,
    confirmedAt: row.confirmedAt,
    inviteExpiresAt: extras?.inviteExpiresAt ?? null,
    ...(extras?.inviteLink ? { inviteLink: extras.inviteLink } : {}),
    ...(extras?.includePdf ? { pdfBase64: await contractPdfBase64(row) } : {}),
    ...(extras?.emailDeliveryStatus ? { emailDeliveryStatus: extras.emailDeliveryStatus } : {}),
  };
}

async function deliverEngagementInvite(input: {
  to: string;
  firmName: string;
  clientName: string;
  inviteLink: string;
  expiresAt: Date;
}) {
  const email = engagementContractEmail(input);
  try {
    await sendWorkspaceInvitationEmail({ to: input.to, subject: email.subject, text: email.text });
    return "sent" as const;
  } catch {
    return "failed" as const;
  }
}

router.get("/agaraccounting/firm-overview", async (req, res) => {
  const parsed = GetFirmOverviewQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "A firmId is required." });
  const membership = await requireFirmMembership(req, res, parsed.data.firmId);
  if (!membership) return;
  await expireStaleEngagementContracts();
  const clientIds = await visibleFirmClientIds(currentUserId(req), membership.firm.id, membership.membership.role);
  const clients = clientIds.length
    ? await db.select().from(clientsTable).where(inArray(clientsTable.id, clientIds)).orderBy(ascName())
    : [];
  const snapshots = await loadClientCloseSnapshots(clients.map((client) => client.id));
  const contracts = clientIds.length
    ? await db.select().from(engagementContractsTable).where(inArray(engagementContractsTable.clientId, clientIds))
    : [];
  const latestContract = new Map<number, typeof engagementContractsTable.$inferSelect>();
  for (const contract of contracts) {
    const current = latestContract.get(contract.clientId);
    if (!current || contract.id > current.id) latestContract.set(contract.clientId, contract);
  }
  const engagements = clientIds.length
    ? await db.select().from(firmCompanyEngagementsTable).where(and(
      eq(firmCompanyEngagementsTable.firmId, membership.firm.id),
      inArray(firmCompanyEngagementsTable.clientId, clientIds),
    ))
    : [];
  const engagementByClient = new Map(engagements.map((row) => [row.clientId, row]));
  const invitations = await db.select().from(organizationInvitationsTable).where(and(
    eq(organizationInvitationsTable.firmId, membership.firm.id),
    eq(organizationInvitationsTable.status, "pending"),
    eq(organizationInvitationsTable.kind, "firm_member"),
  ));

  const overviewClients = clients.map((client) => {
    const snapshot = snapshots.get(client.id) ?? emptyLedgerOverview(client);
    const contract = latestContract.get(client.id);
    return {
      id: client.id,
      name: client.name,
      period: client.period,
      ownershipStatus: client.ownershipStatus,
      functionalCurrency: client.functionalCurrency,
      completionPercent: snapshot.completionPercent,
      pendingReview: snapshot.pendingReview,
      totalLines: snapshot.totalLines,
      journalCount: snapshot.journalCount,
      missingRateCount: snapshot.missingRateCount,
      postedAmountFunctional: snapshot.postedAmountFunctional,
      onboardingStatus: contract?.status ?? null,
      engagementStatus: engagementByClient.get(client.id)?.status ?? null,
      agreedTransactionsPerMonth: contract?.agreedTransactionsPerMonth ?? null,
      agreedRevenuePerYear: contract ? numberValue(contract.agreedRevenuePerYear) : null,
      agreedRevenueCurrency: contract?.agreedRevenueCurrency ?? null,
      onboardingId: contract?.id ?? null,
      confirmBy: contract?.confirmBy ?? null,
      canResend: contract ? canResendEngagementContract(contract.status, contract.signedAt) : false,
    };
  });

  const attention: Array<{ kind: "pending_review" | "missing_rates" | "awaiting_signature" | "awaiting_confirmation" | "expired_onboarding" | "pending_invitation"; label: string; clientId: number | null; onboardingId: number | null }> = [];
  for (const client of overviewClients) {
    if (client.engagementStatus === "active" && client.pendingReview > 0) attention.push({ kind: "pending_review", label: `${client.name} has ${client.pendingReview} drafts waiting`, clientId: client.id, onboardingId: client.onboardingId });
    if (client.engagementStatus === "active" && client.missingRateCount > 0) attention.push({ kind: "missing_rates", label: `${client.name} is missing exchange rates`, clientId: client.id, onboardingId: client.onboardingId });
    if (client.onboardingStatus === "sent") attention.push({ kind: "awaiting_signature", label: `${client.name} is awaiting client signature`, clientId: client.id, onboardingId: client.onboardingId });
    if (client.onboardingStatus === "signed") attention.push({ kind: "awaiting_confirmation", label: `${client.name} is awaiting firm confirmation`, clientId: client.id, onboardingId: client.onboardingId });
    if (client.onboardingStatus === "expired") attention.push({ kind: "expired_onboarding", label: `${client.name} engagement expired`, clientId: client.id, onboardingId: client.onboardingId });
  }
  for (const invitation of invitations) {
    attention.push({ kind: "pending_invitation", label: `Firm invitation pending for ${invitation.email}`, clientId: invitation.clientId, onboardingId: null });
  }

  const activeClients = overviewClients.filter((client) => client.engagementStatus === "active");
  const totals = {
    clientCount: activeClients.length,
    pendingReviewClients: activeClients.filter((client) => client.pendingReview > 0).length,
    pendingReviewLines: activeClients.reduce((sum, client) => sum + client.pendingReview, 0),
    missingRateClients: activeClients.filter((client) => client.missingRateCount > 0).length,
    awaitingSignatureCount: overviewClients.filter((client) => client.onboardingStatus === "sent").length,
    awaitingConfirmationCount: overviewClients.filter((client) => client.onboardingStatus === "signed").length,
    expiredOnboardingCount: overviewClients.filter((client) => client.onboardingStatus === "expired").length,
    pendingInvitationCount: invitations.length,
  };

  return res.json(GetFirmOverviewResponse.parse({
    firmId: membership.firm.id,
    firmName: membership.firm.name,
    totals,
    clients: overviewClients,
    attention,
  }));
});

function ascName() {
  return clientsTable.name;
}

router.get("/agaraccounting/firm-clients/:clientId/practice-overview", async (req, res) => {
  const params = GetFirmClientPracticeOverviewParams.safeParse(req.params);
  const query = GetFirmClientPracticeOverviewQueryParams.safeParse(req.query);
  if (!params.success || !query.success) return res.status(400).json({ error: "A firm client is required." });
  const membership = await requireFirmMembership(req, res, query.data.firmId);
  if (!membership) return;
  await expireStaleEngagementContracts();
  const visible = await visibleFirmClientIds(currentUserId(req), membership.firm.id, membership.membership.role);
  if (!visible.includes(params.data.clientId)) {
    return res.status(403).json({ error: "You do not have access to this firm client." });
  }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, params.data.clientId)).limit(1);
  if (!client) return res.status(404).json({ error: "Client not found." });
  const [contract] = await db.select().from(engagementContractsTable)
    .where(eq(engagementContractsTable.clientId, client.id))
    .orderBy(desc(engagementContractsTable.id))
    .limit(1);
  const [engagement] = await db.select().from(firmCompanyEngagementsTable).where(and(
    eq(firmCompanyEngagementsTable.firmId, membership.firm.id),
    eq(firmCompanyEngagementsTable.clientId, client.id),
  )).limit(1);
  const hidden = contract?.status === "expired" || engagement?.status === "expired";
  const [workspace] = await db.select({ clientId: clientWorkspacesTable.clientId })
    .from(clientWorkspacesTable)
    .where(and(eq(clientWorkspacesTable.clientId, client.id), eq(clientWorkspacesTable.userId, currentUserId(req))))
    .limit(1);
  const snapshots = hidden ? new Map() : await loadClientCloseSnapshots([client.id]);
  const closeSnapshot = hidden ? emptyLedgerOverview(client) : (snapshots.get(client.id) ?? emptyLedgerOverview(client));
  const monthlyPostedJournals = hidden ? [] : await postedJournalCountsByMonth(client.id);
  const currentMonth = monthlyPostedJournals.at(-1)?.month;
  const revenue = hidden ? { amount: null, period: null, source: "unavailable" as const, missingRateCount: 0 } : await resolveIfrsRevenue(client);
  return res.json(GetFirmClientPracticeOverviewResponse.parse({
    clientId: client.id,
    clientName: client.name,
    firmId: membership.firm.id,
    ownershipStatus: client.ownershipStatus,
    engagementStatus: engagement?.status ?? null,
    onboardingStatus: contract?.status ?? null,
    onboardingId: contract?.id ?? null,
    confirmBy: contract?.confirmBy ?? null,
    signedAt: contract?.signedAt ?? null,
    canResend: contract ? canResendEngagementContract(contract.status, contract.signedAt) : false,
    workspaceAccessible: Boolean(workspace),
    services: contract ? normalizeEngagementServices(contract.services) : [],
    startDate: contract?.startDate ?? null,
    endDate: contract?.endDate ?? null,
    feeNote: contract?.feeNote ?? null,
    agreedTransactionsPerMonth: contract?.agreedTransactionsPerMonth ?? null,
    agreedRevenuePerYear: contract ? numberValue(contract.agreedRevenuePerYear) : null,
    agreedRevenueCurrency: contract?.agreedRevenueCurrency ?? null,
    ledgerActualsHidden: hidden,
    closeSnapshot,
    monthlyPostedJournals,
    currentMonthPostedJournals: currentMonth ? monthlyPostedJournals.find((row) => row.month === currentMonth)?.postedCount ?? 0 : 0,
    actualRevenuePerYear: hidden ? null : revenue.amount,
    revenuePeriod: hidden ? null : revenue.period,
    revenueSource: hidden ? "unavailable" : revenue.source,
    missingRateCount: hidden ? 0 : revenue.missingRateCount,
  }));
});

router.post("/firms/:firmId/engagement-onboardings", async (req, res) => {
  const params = CreateEngagementOnboardingParams.safeParse(req.params);
  const body = CreateEngagementOnboardingBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Enter the client identity, agreed volume, agreed revenue, and signer email." });
  const membership = await requireFirmMembership(req, res, params.data.firmId);
  if (!membership) return;
  if (!isFirmManagerRole(membership.membership.role)) {
    return res.status(403).json({ error: "Only firm owners or admins can onboard clients." });
  }
  const firmAccess = await assertFirmProductAccess(membership.firm.id);
  if (isBillingDenial(firmAccess)) return res.status(402).json(firmAccess);
  const workspaceLimit = await limitDenial(firmAccess, "workspace");
  if (workspaceLimit) return res.status(402).json(workspaceLimit);
  const services = normalizeEngagementServices(body.data.services);
  if (!services.length) return res.status(400).json({ error: "Select at least one service." });
  if (!Number.isInteger(body.data.agreedTransactionsPerMonth) || body.data.agreedTransactionsPerMonth < 1) {
    return res.status(400).json({ error: "Agreed transactions per month must be a positive whole number." });
  }
  if (!Number.isFinite(body.data.agreedRevenuePerYear) || body.data.agreedRevenuePerYear <= 0) {
    return res.status(400).json({ error: "Agreed revenue per year must be greater than zero." });
  }
  const signerEmail = body.data.signerEmail.trim().toLowerCase();
  if (!signerEmail.includes("@")) return res.status(400).json({ error: "Enter the client signer email." });
  const actorUserId = currentUserId(req);
  const token = randomBytes(32).toString("base64url");
  const created = await db.transaction(async (tx) => {
    const [client] = await tx.insert(clientsTable).values({
      firmId: membership.firm.id,
      rateProfileId: membership.firm.id,
      ownerUserId: null,
      ownershipStatus: "firm_provisional",
      subscriptionLiableParty: "firm",
      name: body.data.name.trim(),
      legalName: body.data.legalName.trim(),
      functionalCurrency: body.data.functionalCurrency.trim().toUpperCase() || "AED",
      basis: body.data.basis.trim() || "IFRS",
      period: body.data.period.trim(),
    }).returning();
    await tx.insert(clientWorkspacesTable).values({ clientId: client.id, userId: actorUserId, role: "admin" });
    const [engagement] = await tx.insert(firmCompanyEngagementsTable).values({
      firmId: membership.firm.id,
      clientId: client.id,
      status: "provisional",
      invitedByUserId: actorUserId,
    }).returning();
    const [invitation] = await tx.insert(organizationInvitationsTable).values({
      kind: "engagement_contract",
      firmId: membership.firm.id,
      clientId: client.id,
      email: signerEmail,
      invitedByUserId: actorUserId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + WORKSPACE_INVITATION_TTL_MS),
    }).returning();
    const contractValues: typeof engagementContractsTable.$inferInsert = {
      engagementId: engagement.id,
      firmId: membership.firm.id,
      clientId: client.id,
      invitationId: invitation.id,
      status: "sent",
      services,
      agreedTransactionsPerMonth: body.data.agreedTransactionsPerMonth,
      agreedRevenuePerYear: String(body.data.agreedRevenuePerYear),
      agreedRevenueCurrency: client.functionalCurrency.toUpperCase(),
      startDate: body.data.startDate.toISOString().slice(0, 10),
      endDate: body.data.endDate?.toISOString().slice(0, 10) ?? null,
      feeNote: body.data.feeNote?.trim() || null,
      termsText: body.data.termsText.trim() || DEFAULT_ENGAGEMENT_TERMS,
      firmLegalName: membership.firm.legalName,
      clientLegalName: client.legalName,
      signerEmail,
      sentAt: new Date(),
    };
    const [contract] = await tx.insert(engagementContractsTable).values(contractValues).returning();
    return { client, contract, invitation };
  });
  await ensureClientChart(created.client.id);
  const stored = await persistContractPdf(created.contract);
  const inviteLink = organizationInviteLink(req, token);
  const emailDeliveryStatus = await deliverEngagementInvite({
    to: stored.signerEmail,
    firmName: membership.firm.name,
    clientName: created.client.name,
    inviteLink,
    expiresAt: created.invitation.expiresAt,
  });
  return res.status(201).json(CreateEngagementOnboardingResponse.parse(await onboardingResponse(stored, created.client.name, {
    inviteLink,
    inviteExpiresAt: created.invitation.expiresAt,
    includePdf: true,
    emailDeliveryStatus,
  })));
});

router.get("/engagement-onboardings/:id", async (req, res) => {
  const params = GetEngagementOnboardingParams.safeParse(req.params);
  if (!params.success) return res.status(400).json({ error: "Onboarding id is required." });
  await expireStaleEngagementContracts();
  const [row] = await db.select({
    contract: engagementContractsTable,
    client: clientsTable,
    invitation: organizationInvitationsTable,
  }).from(engagementContractsTable)
    .innerJoin(clientsTable, eq(clientsTable.id, engagementContractsTable.clientId))
    .leftJoin(organizationInvitationsTable, eq(organizationInvitationsTable.id, engagementContractsTable.invitationId))
    .where(eq(engagementContractsTable.id, params.data.id))
    .limit(1);
  if (!row) return res.status(404).json({ error: "Engagement onboarding not found." });
  if (!await requireFirmMembership(req, res, row.contract.firmId)) return;
  return res.json(GetEngagementOnboardingResponse.parse(await onboardingResponse(row.contract, row.client.name, {
    inviteExpiresAt: row.invitation?.expiresAt ?? null,
    includePdf: true,
  })));
});

router.post("/engagement-onboardings/:id/confirm", async (req, res) => {
  const params = ConfirmEngagementOnboardingParams.safeParse(req.params);
  if (!params.success) return res.status(400).json({ error: "Onboarding id is required." });
  await expireStaleEngagementContracts();
  const [row] = await db.select({
    contract: engagementContractsTable,
    client: clientsTable,
  }).from(engagementContractsTable)
    .innerJoin(clientsTable, eq(clientsTable.id, engagementContractsTable.clientId))
    .where(eq(engagementContractsTable.id, params.data.id))
    .limit(1);
  if (!row) return res.status(404).json({ error: "Engagement onboarding not found." });
  const membership = await requireFirmMembership(req, res, row.contract.firmId);
  if (!membership) return;
  if (!isFirmManagerRole(membership.membership.role)) return res.status(403).json({ error: "Only firm owners or admins can confirm an engagement." });
  if (row.contract.status !== "signed" || !row.contract.confirmBy || row.contract.confirmBy <= new Date()) {
    return res.status(409).json({ error: "This engagement is no longer waiting for firm confirmation." });
  }
  const [updated] = await db.transaction(async (tx) => {
    await tx.update(firmCompanyEngagementsTable).set({
      status: "active",
      acceptedByUserId: currentUserId(req),
      acceptedAt: new Date(),
      revokedAt: null,
    }).where(eq(firmCompanyEngagementsTable.id, row.contract.engagementId));
    return tx.update(engagementContractsTable).set({
      status: "confirmed",
      confirmedAt: new Date(),
      confirmedByUserId: currentUserId(req),
    }).where(eq(engagementContractsTable.id, row.contract.id)).returning();
  });
  if (!updated) return res.status(500).json({ error: "The engagement could not be confirmed." });
  await syncMemberPrice(row.client.id);
  return res.json(ConfirmEngagementOnboardingResponse.parse(await onboardingResponse(updated, row.client.name, { includePdf: true })));
});

router.post("/engagement-onboardings/:id/revoke", async (req, res) => {
  const params = RevokeEngagementOnboardingParams.safeParse(req.params);
  if (!params.success) return res.status(400).json({ error: "Onboarding id is required." });
  const [row] = await db.select({
    contract: engagementContractsTable,
    client: clientsTable,
  }).from(engagementContractsTable)
    .innerJoin(clientsTable, eq(clientsTable.id, engagementContractsTable.clientId))
    .where(eq(engagementContractsTable.id, params.data.id))
    .limit(1);
  if (!row) return res.status(404).json({ error: "Engagement onboarding not found." });
  const membership = await requireFirmMembership(req, res, row.contract.firmId);
  if (!membership) return;
  if (!isFirmManagerRole(membership.membership.role)) return res.status(403).json({ error: "Only firm owners or admins can cancel onboarding." });
  if (row.contract.status === "confirmed") return res.status(409).json({ error: "A confirmed engagement cannot be discarded from onboarding." });
  const [updated] = await db.transaction(async (tx) => {
    if (row.contract.invitationId) {
      await tx.update(organizationInvitationsTable).set({ status: "revoked" })
        .where(and(eq(organizationInvitationsTable.id, row.contract.invitationId), eq(organizationInvitationsTable.status, "pending")));
    }
    await tx.update(firmCompanyEngagementsTable).set({ status: "revoked", revokedAt: new Date() })
      .where(eq(firmCompanyEngagementsTable.id, row.contract.engagementId));
    return tx.update(engagementContractsTable).set({ status: "revoked" })
      .where(eq(engagementContractsTable.id, row.contract.id)).returning();
  });
  if (!updated) return res.status(500).json({ error: "The engagement onboarding could not be discarded." });
  return res.json(RevokeEngagementOnboardingResponse.parse(await onboardingResponse(updated, row.client.name)));
});

router.post("/engagement-onboardings/:id/resend", async (req, res) => {
  const params = ResendEngagementOnboardingParams.safeParse(req.params);
  if (!params.success) return res.status(400).json({ error: "Onboarding id is required." });
  await expireStaleEngagementContracts();
  const [row] = await db.select({
    contract: engagementContractsTable,
    client: clientsTable,
    firm: firmProfilesTable,
    invitation: organizationInvitationsTable,
  }).from(engagementContractsTable)
    .innerJoin(clientsTable, eq(clientsTable.id, engagementContractsTable.clientId))
    .innerJoin(firmProfilesTable, eq(firmProfilesTable.id, engagementContractsTable.firmId))
    .leftJoin(organizationInvitationsTable, eq(organizationInvitationsTable.id, engagementContractsTable.invitationId))
    .where(eq(engagementContractsTable.id, params.data.id))
    .limit(1);
  if (!row) return res.status(404).json({ error: "Engagement onboarding not found." });
  const membership = await requireFirmMembership(req, res, row.contract.firmId);
  if (!membership) return;
  if (!isFirmManagerRole(membership.membership.role)) return res.status(403).json({ error: "Only firm owners or admins can resend a contract." });
  if (!canResendEngagementContract(row.contract.status, row.contract.signedAt)) {
    return res.status(409).json({ error: "This engagement can no longer be resent." });
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + WORKSPACE_INVITATION_TTL_MS);
  const actorUserId = currentUserId(req);
  const refreshed = await db.transaction(async (tx) => {
    const invitationValues = {
      kind: "engagement_contract" as const,
      firmId: row.contract.firmId,
      clientId: row.contract.clientId,
      email: row.contract.signerEmail,
      invitedByUserId: actorUserId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      status: "pending" as const,
      expiresAt,
      acceptedUserId: null,
    };
    const invitation = row.invitation
      ? (await tx.update(organizationInvitationsTable).set(invitationValues).where(eq(organizationInvitationsTable.id, row.invitation.id)).returning())[0]
      : (await tx.insert(organizationInvitationsTable).values(invitationValues).returning())[0];
    await tx.update(firmCompanyEngagementsTable).set({ status: "provisional", revokedAt: null })
      .where(eq(firmCompanyEngagementsTable.id, row.contract.engagementId));
    const [contract] = await tx.update(engagementContractsTable).set({
      status: "sent",
      invitationId: invitation.id,
      sentAt: new Date(),
      confirmBy: null,
      signedAt: null,
      signerName: null,
    }).where(eq(engagementContractsTable.id, row.contract.id)).returning();
    return { contract, invitation };
  });
  if (!refreshed.contract) return res.status(500).json({ error: "The contract could not be resent." });
  const stored = await persistContractPdf(refreshed.contract);
  const inviteLink = organizationInviteLink(req, token);
  const emailDeliveryStatus = await deliverEngagementInvite({
    to: stored.signerEmail,
    firmName: row.firm.name,
    clientName: row.client.name,
    inviteLink,
    expiresAt: refreshed.invitation.expiresAt,
  });
  return res.json(ResendEngagementOnboardingResponse.parse(await onboardingResponse(stored, row.client.name, {
    inviteLink,
    inviteExpiresAt: refreshed.invitation.expiresAt,
    includePdf: true,
    emailDeliveryStatus,
  })));
});

router.get("/organization-invitations/:token/engagement-contract", async (req, res) => {
  const params = GetEngagementContractInvitationParams.safeParse(req.params);
  if (!params.success) return res.status(400).json({ error: "Invitation token is required." });
  await expireStaleEngagementContracts();
  const tokenHash = createHash("sha256").update(params.data.token).digest("hex");
  const [invite] = await db.select().from(organizationInvitationsTable).where(eq(organizationInvitationsTable.tokenHash, tokenHash)).limit(1);
  if (!invite || invite.kind !== "engagement_contract") return res.status(404).json({ error: "Engagement contract not found." });
  const [row] = await db.select({
    contract: engagementContractsTable,
    client: clientsTable,
    firm: firmProfilesTable,
  }).from(engagementContractsTable)
    .innerJoin(clientsTable, eq(clientsTable.id, engagementContractsTable.clientId))
    .innerJoin(firmProfilesTable, eq(firmProfilesTable.id, engagementContractsTable.firmId))
    .where(eq(engagementContractsTable.invitationId, invite.id))
    .limit(1);
  if (!row) return res.status(404).json({ error: "Engagement contract not found." });
  return res.json(GetEngagementContractInvitationResponse.parse({
    id: row.contract.id,
    firmName: row.firm.name,
    clientName: row.client.name,
    status: row.contract.status,
    terms: contractTerms(row.contract),
    signerEmail: row.contract.signerEmail,
    pdfBase64: await contractPdfBase64(row.contract),
  }));
});

router.post("/organization-invitations/:token/engagement-contract", async (req, res) => {
  const params = SignEngagementContractInvitationParams.safeParse(req.params);
  const body = SignEngagementContractInvitationBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Type your name and accept the terms to sign." });
  if (!body.data.accepted || !body.data.signerName.trim()) {
    return res.status(400).json({ error: "Type your name and accept the terms to sign." });
  }
  await expireStaleEngagementContracts();
  const userId = currentUserId(req);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const tokenHash = createHash("sha256").update(params.data.token).digest("hex");
  const result = await db.transaction(async (tx) => {
    const [invite] = await tx.select().from(organizationInvitationsTable).where(eq(organizationInvitationsTable.tokenHash, tokenHash)).for("update");
    if (!invite || invite.kind !== "engagement_contract" || invite.status !== "pending") return "unavailable" as const;
    if (invite.expiresAt <= new Date()) {
      await tx.update(organizationInvitationsTable).set({ status: "expired" }).where(eq(organizationInvitationsTable.id, invite.id));
      return "expired" as const;
    }
    if (!user?.email || user.email.toLowerCase() !== invite.email.toLowerCase()) return "email" as const;
    const [contract] = await tx.select().from(engagementContractsTable).where(eq(engagementContractsTable.invitationId, invite.id)).for("update");
    if (!contract || contract.status !== "sent") return "unavailable" as const;
    const signedAt = new Date();
    if (invite.clientId) {
      await tx.update(clientsTable).set({
        ownerUserId: userId,
        ownershipStatus: "company_owned",
        subscriptionLiableParty: "company",
        transferredAt: signedAt,
      }).where(eq(clientsTable.id, invite.clientId));
      await tx.insert(clientWorkspacesTable).values({ clientId: invite.clientId, userId, role: "owner" })
        .onConflictDoUpdate({ target: [clientWorkspacesTable.clientId, clientWorkspacesTable.userId], set: { role: "owner" } });
    }
    const [updated] = await tx.update(engagementContractsTable).set({
      status: "signed",
      signerName: body.data.signerName.trim(),
      signedAt,
      confirmBy: contractConfirmBy(signedAt),
    }).where(eq(engagementContractsTable.id, contract.id)).returning();
    await tx.update(organizationInvitationsTable).set({ status: "accepted", acceptedUserId: userId }).where(eq(organizationInvitationsTable.id, invite.id));
    return updated;
  });
  if (result === "email") return res.status(403).json({ error: "Sign in with the email address that received this invitation." });
  if (result === "expired") return res.status(410).json({ error: "This invitation has expired." });
  if (result === "unavailable") return res.status(409).json({ error: "This engagement contract is no longer available to sign." });
  const stored = await persistContractPdf(result);
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, stored.clientId)).limit(1);
  return res.json(SignEngagementContractInvitationResponse.parse(await onboardingResponse(stored, client?.name ?? stored.clientLegalName, { includePdf: true })));
});

export default router;
