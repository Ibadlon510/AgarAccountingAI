import { Readable } from "node:stream";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, gt, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import * as XLSX from "xlsx";
import {
  ApproveJournalEntryParams,
  ApproveJournalEntryBody,
  AskLedgerflowAIBody,
  AskLedgerflowAIResponse,
  ConfirmAICopilotActionBody,
  ConfirmAICopilotActionResponse,
  AcceptWorkspaceInvitationParams,
  AcceptWorkspaceInvitationResponse,
  CreateWorkspaceInvitationBody,
  CreateWorkspaceInvitationResponse,
  CreateBankAccountBody,
  CreateBankAccountResponse,
  CreateExchangeRateBody,
  CreateExchangeRateResponse,
  CreateReportPackBody,
  CreateReportPackResponse,
  DeleteExchangeRateParams,
  GetBankAccountsQueryParams,
  GetBankAccountsResponse,
  GetBulkTransitionAuditsQueryParams,
  GetBulkTransitionAuditsResponse,
  GetExchangeRatesResponse,
  ImportExchangeRatesBody,
  ImportExchangeRatesResponse,
  ApproveJournalEntryResponse,
  GetLedgerflowUsageResponse,
  UpdateClientParams,
  UpdateClientBody,
  UpdateClientResponse,
  UpdateExchangeRateBody,
  UpdateExchangeRateParams,
  UpdateExchangeRateResponse,
  CreateStatementLineBody,
  CreateStatementLineResponse,
  GetFinancialStatementsQueryParams,
  GetFinancialStatementsResponse,
  GetReportPackParams,
  GetReportPackResponse,
  GetReportPacksQueryParams,
  GetReportPacksResponse,
  GetLedgerflowAISettingsQueryParams,
  GetLedgerflowAISettingsResponse,
  GetJournalEntriesResponse,
  GetLedgerOverviewResponse,
  GetStatementLinesQueryParams,
  GetStatementLinesResponse,
  GetTrialBalanceResponse,
  PostJournalEntryBody,
  ImportStatementBody,
  ImportStatementResponse,
  RemoveLedgerflowAICredentialBody,
  RemoveLedgerflowAICredentialResponse,
  TestLedgerflowAISettingsBody,
  TestLedgerflowAISettingsResponse,
  UpdateLedgerflowAccountProfileBody,
  UpdateLedgerflowAccountProfileResponse,
  UpdateLedgerflowAISettingsBody,
  UpdateLedgerflowAISettingsResponse,
  UpdateReportPackBody,
  UpdateReportPackParams,
  UpdateReportPackResponse,
  GetWorkspaceMembersResponse,
  RemoveWorkspaceMemberParams,
  ResendWorkspaceInvitationParams,
  ResendWorkspaceInvitationResponse,
  RevokeWorkspaceInvitationParams,
  UpdateWorkspaceMemberBody,
  UpdateWorkspaceMemberParams,
  UpdateWorkspaceMemberResponse,
} from "@workspace/api-zod";
import {
  accountClassificationsTable,
  aiProviderConfigsTable,
  bankAccountsTable,
  bulkTransitionAuditsTable,
  aiActivityTable,
  classificationPatternsTable,
  clientWorkspacesTable,
  clientsTable,
  db,
  exchangeRatesTable,
  journalEntriesTable,
  reportPacksTable,
  statementImportsTable,
  statementLinesTable,
  usersTable,
  workspaceInvitationsTable,
} from "@workspace/db";
import {
  AIProviderError,
  completeAI,
  getAIModelCatalog,
  getAIProviderConfig,
  isAIModel,
  isAIProvider,
  removeAIProviderCredential,
  saveAIProviderConfig,
  testAIProvider,
} from "../lib/ai-provider";
import { ObjectNotFoundError } from "../lib/objectStorage";
import { objectStorageService } from "./storage";
import {
  hasPdfBankStatementTable,
  MAX_STATEMENT_FILE_SIZE,
  parsePdfBankStatementRows,
  scopedStatementObjectPath,
  statementObjectPathForClient,
  statementSourceUrl,
  validateStatementContents,
  validateXlsxArchive,
  validateStatementMetadata,
} from "../lib/statementDocument";
import {
  buildReportPack,
  finalizationValidation,
  inferredClassifications,
  type ReportChecklistItem,
  type ReportNote,
  type ReportSignatory,
  type ReportSnapshot,
  type ReportValidation,
  eligibleReportProfiles,
} from "../lib/reportPack";
import { buildReportPdf } from "../lib/reportPdf";

const router: IRouter = Router();
type LedgerflowTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const WORKSPACE_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function journalEntryResponse(entry: typeof journalEntriesTable.$inferSelect) {
  return {
    id: entry.id,
    statementLineId: entry.statementLineId,
    date: calendarDate(entry.date),
    memo: entry.memo,
    currency: entry.currency,
    status: entry.status,
    confidence: number(entry.confidence),
    functionalCurrency: entry.functionalCurrency,
    functionalAmount: entry.functionalAmount == null ? null : number(entry.functionalAmount),
    exchangeRate: entry.exchangeRate == null ? null : number(entry.exchangeRate),
    exchangeRateEffectiveDate: calendarDate(entry.exchangeRateEffectiveDate),
    exchangeRateStatus: entry.exchangeRateStatus,
    lines: [
      { account: entry.debitAccount, debit: number(entry.amount), credit: 0 },
      { account: entry.creditAccount, debit: 0, credit: number(entry.amount) },
    ],
  };
}
function number(value: string | null | undefined) {
  return Number(value ?? 0);
}

const legacyDemoRows = [
  { date: "2026-08-03", description: "EMIRATES AIRLINES", currency: "AED", amount: "1840.00", direction: "outflow", status: "posted", accountSuggestion: "Travel & entertainment", confidence: "0.98" },
  { date: "2026-08-05", description: "STRIPE PAYOUT 8472", currency: "USD", amount: "12450.00", direction: "inflow", status: "posted", accountSuggestion: "Revenue", confidence: "0.99" },
  { date: "2026-08-07", description: "AWS EMEA", currency: "USD", amount: "624.50", direction: "outflow", status: "needs_review", accountSuggestion: "Software & subscriptions", confidence: "0.91" },
  { date: "2026-08-10", description: "AL FARAJ OFFICE SUPPLIES", currency: "AED", amount: "389.00", direction: "outflow", status: "needs_review", accountSuggestion: "Office expenses", confidence: "0.87" },
  { date: "2026-08-12", description: "CLIENT RETAINER — NORTHSTAR", currency: "AED", amount: "28750.00", direction: "inflow", status: "posted", accountSuggestion: "Revenue", confidence: "0.97" },
  { date: "2026-08-15", description: "GULF TELECOM", currency: "AED", amount: "475.00", direction: "outflow", status: "needs_review", accountSuggestion: "Communication expenses", confidence: "0.84" },
] as const;

type WorkspaceState = "starter" | "configured" | "legacy_demo";

function isPlaceholderStarterWorkspace(client: typeof clientsTable.$inferSelect) {
  return client.legalName === "Legal entity to be configured"
    && client.functionalCurrency === "AED"
    && client.basis === "IFRS"
    && client.period === "August 2026"
    && (
      /private workspace$/i.test(client.name)
      || /ledgerflow workspace$/i.test(client.name)
      || /(?:'s|’s) workspace$/i.test(client.name)
    );
}

function clientResponse(
  client: typeof clientsTable.$inferSelect,
  legacyDemo = false,
  workspaceState?: WorkspaceState,
) {
  return {
    id: client.id,
    name: client.name,
    legalName: client.legalName,
    functionalCurrency: client.functionalCurrency,
    basis: client.basis,
    period: client.period,
    legacyDemo,
    workspaceState: workspaceState ?? (legacyDemo ? "legacy_demo" : isPlaceholderStarterWorkspace(client) ? "starter" : "configured"),
  };
}
function aiSettingsResponse(
  config: Awaited<ReturnType<typeof getAIProviderConfig>>,
  availableModels: Awaited<ReturnType<typeof getAIModelCatalog>>,
) {
  return {
    clientId: config.clientId,
    provider: config.provider,
    model: config.model,
    credentialStatus: config.credentialStatus,
    credentialLast4: config.credentialLast4,
    credentialUpdatedAt: config.credentialUpdatedAt,
    lastTestedAt: config.lastTestedAt,
    availableModels,
  };
}

function calendarDate(value: string | Date | null | undefined) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function normalizeCurrency(value: string) {
  return value.trim().toUpperCase();
}

function normalizeRateInput(input: {
  sourceCurrency: string;
  functionalCurrency: string;
  effectiveDate: string | Date;
  rate: number;
  source?: string | null;
  note?: string | null;
}) {
  const sourceCurrency = normalizeCurrency(input.sourceCurrency);
  const functionalCurrency = normalizeCurrency(input.functionalCurrency);
  if (!/^[A-Z]{3}$/.test(sourceCurrency) || !/^[A-Z]{3}$/.test(functionalCurrency)) {
    throw new Error("Currencies must use three-letter ISO codes.");
  }
  if (sourceCurrency === functionalCurrency) {
    throw new Error("A rate must convert between two different currencies.");
  }
  const effectiveDate = calendarDate(input.effectiveDate);
  if (!effectiveDate || !isIsoDate(effectiveDate)) throw new Error("Effective date must use YYYY-MM-DD.");
  if (!Number.isFinite(input.rate) || input.rate <= 0) throw new Error("Exchange rate must be greater than zero.");
  return {
    sourceCurrency,
    functionalCurrency,
    effectiveDate,
    rate: input.rate.toFixed(10),
    source: input.source?.trim().slice(0, 120) || "Manual",
    note: input.note?.trim().slice(0, 500) || null,
  };
}

function exchangeRateResponse(rate: typeof exchangeRatesTable.$inferSelect) {
  return {
    id: rate.id,
    sourceCurrency: rate.sourceCurrency,
    functionalCurrency: rate.functionalCurrency,
    effectiveDate: calendarDate(rate.effectiveDate),
    rate: number(rate.rate),
    source: rate.source,
    note: rate.note,
  };
}

type RateResolution = {
  functionalCurrency: string;
  functionalAmount: string | null;
  exchangeRate: string | null;
  exchangeRateEffectiveDate: string | null;
  exchangeRateStatus: "not_required" | "exact" | "prior" | "missing";
};

async function resolveExchangeRate(userId: string, sourceCurrency: string, functionalCurrency: string, transactionDate: string, amount: string | number): Promise<RateResolution> {
  const source = normalizeCurrency(sourceCurrency);
  const functional = normalizeCurrency(functionalCurrency);
  if (source === functional) {
    return {
      functionalCurrency: functional,
      functionalAmount: Number(amount).toFixed(2),
      exchangeRate: "1.0000000000",
      exchangeRateEffectiveDate: transactionDate,
      exchangeRateStatus: "not_required",
    };
  }
  const [rate] = await db.select().from(exchangeRatesTable).where(and(
    eq(exchangeRatesTable.userId, userId),
    eq(exchangeRatesTable.sourceCurrency, source),
    eq(exchangeRatesTable.functionalCurrency, functional),
    lte(exchangeRatesTable.effectiveDate, transactionDate),
  )).orderBy(desc(exchangeRatesTable.effectiveDate)).limit(1);
  if (!rate) {
    return {
      functionalCurrency: functional,
      functionalAmount: null,
      exchangeRate: null,
      exchangeRateEffectiveDate: null,
      exchangeRateStatus: "missing",
    };
  }
  return {
    functionalCurrency: functional,
    functionalAmount: (Number(amount) * number(rate.rate)).toFixed(2),
    exchangeRate: rate.rate,
    exchangeRateEffectiveDate: calendarDate(rate.effectiveDate),
    exchangeRateStatus: calendarDate(rate.effectiveDate) === transactionDate ? "exact" : "prior",
  };
}

async function refreshWorkspaceRateConversions(userId: string) {
  const lines = await db.select({
    line: statementLinesTable,
    functionalCurrency: clientsTable.functionalCurrency,
  }).from(statementLinesTable)
    .innerJoin(clientWorkspacesTable, and(
      eq(clientWorkspacesTable.clientId, statementLinesTable.clientId),
      eq(clientWorkspacesTable.userId, userId),
    ))
    .innerJoin(clientsTable, eq(clientsTable.id, statementLinesTable.clientId));

  await Promise.all(lines.map(async ({ line, functionalCurrency }) => {
    const conversion = await resolveExchangeRate(userId, line.currency, functionalCurrency, calendarDate(line.date) ?? "", line.amount);
    const values = {
      functionalCurrency: conversion.functionalCurrency,
      functionalAmount: conversion.functionalAmount,
      exchangeRate: conversion.exchangeRate,
      exchangeRateEffectiveDate: conversion.exchangeRateEffectiveDate,
      exchangeRateStatus: conversion.exchangeRateStatus,
    };
    await db.transaction(async (tx) => {
      await tx.update(statementLinesTable).set(values).where(eq(statementLinesTable.id, line.id));
      await tx.update(journalEntriesTable).set(values).where(eq(journalEntriesTable.statementLineId, line.id));
    });
  }));
}

function reportingAmount(entry: typeof journalEntriesTable.$inferSelect, functionalCurrency: string) {
  if (entry.functionalAmount != null && entry.functionalCurrency === functionalCurrency) return number(entry.functionalAmount);
  if (normalizeCurrency(entry.currency) === functionalCurrency) return number(entry.amount);
  return null;
}

function reportPackResponse(pack: typeof reportPacksTable.$inferSelect) {
  return {
    id: pack.id,
    clientId: pack.clientId,
    periodStart: calendarDate(pack.periodStart),
    periodEnd: calendarDate(pack.periodEnd),
    comparativePeriodStart: calendarDate(pack.comparativePeriodStart),
    comparativePeriodEnd: calendarDate(pack.comparativePeriodEnd),
    reportingBasis: pack.reportingBasis,
    presentationProfile: pack.presentationProfile,
    presentationCurrency: pack.presentationCurrency,
    roundingPolicy: pack.roundingPolicy,
    status: pack.status,
    snapshot: pack.snapshot as ReportSnapshot,
    validation: pack.validation as ReportValidation,
    notes: pack.notes as ReportNote[],
    checklist: pack.checklist as ReportChecklistItem[],
    signatory: pack.signatory as ReportSignatory,
    createdAt: pack.createdAt,
    updatedAt: pack.updatedAt,
    finalizedAt: pack.finalizedAt,
  };
}

function reportPackSummary(pack: typeof reportPacksTable.$inferSelect) {
  const validation = pack.validation as ReportValidation;
  return {
    id: pack.id,
    clientId: pack.clientId,
    periodEnd: calendarDate(pack.periodEnd),
    comparativePeriodEnd: calendarDate(pack.comparativePeriodEnd),
    reportingBasis: pack.reportingBasis,
    presentationProfile: pack.presentationProfile,
    presentationCurrency: pack.presentationCurrency,
    status: pack.status,
    validationErrorCount: validation.errorCount,
    createdAt: pack.createdAt,
  };
}

function mergeReportNotes(existing: ReportNote[], updates: ReportNote[] | undefined) {
  if (!updates) return existing;
  const supplied = new Map(updates.map((note) => [note.number, note]));
  return existing.map((note) => {
    const update = supplied.get(note.number);
    if (!update) return note;
    return {
      ...note,
      narrative: update.narrative.trim().slice(0, 8_000),
      requiresInput: update.requiresInput,
    };
  });
}

function mergeReportChecklist(existing: ReportChecklistItem[], updates: ReportChecklistItem[] | undefined) {
  if (!updates) return existing;
  const supplied = new Map(updates.map((item) => [item.standard, item]));
  return existing.map((item) => {
    const update = supplied.get(item.standard);
    return update ? { ...item, status: update.status, prompt: update.prompt.trim().slice(0, 2_000) } : item;
  });
}

function normalizedSignatory(signatory: ReportSignatory | undefined, fallback: ReportSignatory) {
  if (!signatory) return fallback;
  return {
    preparedBy: signatory.preparedBy.trim().slice(0, 160),
    reviewedBy: signatory.reviewedBy.trim().slice(0, 160),
    authorizedBy: signatory.authorizedBy.trim().slice(0, 160),
    authorizationDate: calendarDate(signatory.authorizationDate),
  };
}

function currentUserId(req: Request) {
  if (!req.dbUser) throw new Error("Authenticated user is required.");
  return req.dbUser.id;
}

const USAGE_PLAN = {
  name: "Starter",
  statementImportsPerMonth: 100,
  storedEvidenceBytes: 5 * 1024 * 1024 * 1024,
  aiActivityPerMonth: 1000,
  clientWorkspaces: 5,
} as const;
const RETENTION_POLICY = {
  statementEvidenceDays: 365,
  aiActivityDays: 90,
  ledgerDataDescription: "Ledger entries remain available while the workspace is active.",
} as const;

function retentionExpiresAt(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function usageStatus(used: number, limit: number): "healthy" | "approaching" | "at_limit" {
  if (used >= limit) return "at_limit";
  if (used >= limit * 0.8) return "approaching";
  return "healthy";
}

function usageMetric(used: number, limit: number) {
  return {
    used,
    limit,
    percentage: Math.min(100, Math.round((used / limit) * 1000) / 10),
    status: usageStatus(used, limit),
  };
}

type UsageAICostActivity = {
  clientId: number;
  clientName: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: string | null;
  billingSource: string;
};

function completedAIActivityValues(completion: Awaited<ReturnType<typeof completeAI>>) {
  return {
    status: "completed",
    provider: completion.provider,
    model: completion.model,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
    estimatedCostUsd: completion.estimatedCostUsd == null ? null : completion.estimatedCostUsd.toFixed(8),
    billingSource: completion.billingSource,
  } as const;
}

function roundedUsd(value: number) {
  return Math.round(value * 100_000_000) / 100_000_000;
}

function aiCostSummary(activity: UsageAICostActivity[]) {
  const models = new Map<string, {
    provider: string;
    model: string;
    activityCount: number;
    estimatedCostUsd: number;
  }>();
  let inputTokens = 0;
  let outputTokens = 0;
  let activitiesWithEstimate = 0;
  let replitPricedActivities = 0;
  let providerDirectPricedActivities = 0;
  let estimatedReplitCreditsUsd = 0;
  let estimatedProviderDirectUsd = 0;

  for (const item of activity) {
    inputTokens += item.inputTokens ?? 0;
    outputTokens += item.outputTokens ?? 0;
    const modelKey = `${item.provider}:${item.model}`;
    const model = models.get(modelKey) ?? {
      provider: item.provider,
      model: item.model,
      activityCount: 0,
      estimatedCostUsd: 0,
    };
    model.activityCount += 1;

    const estimatedCost = item.estimatedCostUsd == null ? null : Number(item.estimatedCostUsd);
    if (estimatedCost != null && Number.isFinite(estimatedCost)) {
      activitiesWithEstimate += 1;
      model.estimatedCostUsd += estimatedCost;
      if (item.billingSource === "replit_credits") {
        estimatedReplitCreditsUsd += estimatedCost;
        replitPricedActivities += 1;
      }
      if (item.billingSource === "provider_direct") {
        estimatedProviderDirectUsd += estimatedCost;
        providerDirectPricedActivities += 1;
      }
    }
    models.set(modelKey, model);
  }

  return {
    completedActivities: activity.length,
    activitiesWithEstimate,
    activitiesWithoutEstimate: activity.length - activitiesWithEstimate,
    replitPricedActivities,
    providerDirectPricedActivities,
    inputTokens,
    outputTokens,
    estimatedReplitCreditsUsd: roundedUsd(estimatedReplitCreditsUsd),
    estimatedProviderDirectUsd: roundedUsd(estimatedProviderDirectUsd),
    estimatedTotalProviderCostUsd: roundedUsd(estimatedReplitCreditsUsd + estimatedProviderDirectUsd),
    models: [...models.values()]
      .map((model) => ({ ...model, estimatedCostUsd: roundedUsd(model.estimatedCostUsd) }))
      .sort((left, right) => left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model)),
  };
}

async function getUserClientIds(userId: string) {
  const memberships = await db.select({ clientId: clientWorkspacesTable.clientId })
    .from(clientWorkspacesTable)
    .where(eq(clientWorkspacesTable.userId, userId));
  return [...new Set(memberships.map((membership) => membership.clientId))];
}

async function purgeExpiredWorkspaceEvidence(clientIds: number[]) {
  if (!clientIds.length) return;
  const expiredEvidence = await db.select({
    id: statementImportsTable.id,
    objectPath: statementImportsTable.objectPath,
  }).from(statementImportsTable).where(and(
    inArray(statementImportsTable.clientId, clientIds),
    isNotNull(statementImportsTable.objectPath),
    lte(statementImportsTable.evidenceExpiresAt, new Date()),
  ));
  const removedIds: number[] = [];
  for (const evidence of expiredEvidence) {
    if (!evidence.objectPath) continue;
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(evidence.objectPath);
      await objectFile.delete({ ignoreNotFound: true });
      removedIds.push(evidence.id);
    } catch (error) {
      console.error("Unable to purge expired statement evidence", error);
    }
  }
  if (removedIds.length) {
    await db.update(statementImportsTable).set({
      objectPath: null,
      evidenceExpiresAt: null,
      fileSize: 0,
    }).where(inArray(statementImportsTable.id, removedIds));
  }
}

async function getOwnedClient(req: Request, requestedClientId?: number) {
  const conditions = [eq(clientWorkspacesTable.userId, currentUserId(req))];
  if (requestedClientId !== undefined) {
    conditions.push(eq(clientWorkspacesTable.clientId, requestedClientId));
  }
  const [membership] = await db.select({ clientId: clientWorkspacesTable.clientId })
    .from(clientWorkspacesTable)
    .where(and(...conditions))
    .limit(1);
  if (!membership) return null;
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, membership.clientId));
  return client ?? null;
}

async function requireOwnedClient(req: Request, res: Response, requestedClientId?: number) {
  const client = await getOwnedClient(req, requestedClientId);
  if (!client) {
    res.status(403).json({ error: "You do not have access to this client workspace." });
    return null;
  }
  return client;
}

type WorkspaceRole = "admin" | "bookkeeper";

function clientSummary(client: typeof clientsTable.$inferSelect) {
  return { id: client.id, name: client.name };
}

function displayName(user: Pick<typeof usersTable.$inferSelect, "email" | "firstName" | "lastName">) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email || "Team member";
}

async function getWorkspaceClientIds(userId: string) {
  const memberships = await db.select({ clientId: clientWorkspacesTable.clientId })
    .from(clientWorkspacesTable)
    .where(eq(clientWorkspacesTable.userId, userId));
  return [...new Set(memberships.map((membership) => membership.clientId))];
}

async function getManageableWorkspaceClientIds(userId: string) {
  const memberships = await db.select({ clientId: clientWorkspacesTable.clientId })
    .from(clientWorkspacesTable)
    .where(and(eq(clientWorkspacesTable.userId, userId), eq(clientWorkspacesTable.role, "admin")));
  return [...new Set(memberships.map((membership) => membership.clientId))];
}

async function getWorkspaceRole(userId: string): Promise<WorkspaceRole | null> {
  const memberships = await db.select({ role: clientWorkspacesTable.role })
    .from(clientWorkspacesTable)
    .where(eq(clientWorkspacesTable.userId, userId));
  if (!memberships.length) return null;
  return memberships.some((membership) => membership.role === "admin") ? "admin" : "bookkeeper";
}

async function requireWorkspaceAdmin(req: Request, res: Response) {
  const role = await getWorkspaceRole(currentUserId(req));
  if (role !== "admin") {
    res.status(403).json({ error: "Only workspace admins can manage settings and team access." });
    return null;
  }
  return role;
}

async function requireClientAdmin(req: Request, res: Response, clientId: number) {
  const [membership] = await db.select({ role: clientWorkspacesTable.role })
    .from(clientWorkspacesTable)
    .where(and(eq(clientWorkspacesTable.clientId, clientId), eq(clientWorkspacesTable.userId, currentUserId(req))))
    .limit(1);
  if (!membership) {
    res.status(403).json({ error: "You do not have access to this client workspace." });
    return null;
  }
  if (membership.role !== "admin") {
    res.status(403).json({ error: "Only workspace admins can manage client settings." });
    return null;
  }
  return membership;
}

async function preserveClientAdminCoverage(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  targetUserId: string,
  clientIds: number[],
) {
  if (!clientIds.length) return true;
  const lockedMemberships = await tx.select({
    clientId: clientWorkspacesTable.clientId,
    userId: clientWorkspacesTable.userId,
    role: clientWorkspacesTable.role,
  }).from(clientWorkspacesTable)
    .where(inArray(clientWorkspacesTable.clientId, clientIds))
    .for("update");
  return clientIds.every((clientId) => lockedMemberships.some((membership) =>
    membership.clientId === clientId
    && membership.userId !== targetUserId
    && membership.role === "admin",
  ));
}

function invitationResponse(
  invitation: typeof workspaceInvitationsTable.$inferSelect,
  clientsById: Map<number, typeof clientsTable.$inferSelect>,
  invitedBy: string,
  inviteLink?: string,
) {
  const roleLabel = invitation.role === "admin" ? "an admin" : "a bookkeeper";
  const clients = invitation.clientIds
    .map((id) => clientsById.get(id))
    .filter((client): client is typeof clientsTable.$inferSelect => Boolean(client));
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role as WorkspaceRole,
    status: invitation.status as "pending" | "accepted" | "revoked" | "expired",
    clients: clients.map(clientSummary),
    invitedBy,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    ...(inviteLink ? { inviteLink } : {}),
    ...(inviteLink ? {
      emailSubject: "You’re invited to LedgerFlow",
      emailBody: [
        `Hello,`,
        ``,
        `${invitedBy} invited you to LedgerFlow as ${roleLabel}.`,
        ``,
        `You’ll have access to these client workspaces:`,
        ...clients.map((client) => `- ${client.name}`),
        ``,
        `This invitation expires on ${invitation.expiresAt.toLocaleString("en-US", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: "UTC",
        })} UTC.`,
        `Use the secure link below to join:`,
        inviteLink,
        ``,
        `If you were not expecting this invitation, you can ignore this email.`,
      ].join("\n"),
    } : {}),
  };
}

function invitationLink(req: Request, token: string) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = typeof forwardedProto === "string" ? forwardedProto : req.protocol;
  const forwardedHost = req.headers["x-forwarded-host"];
  const host = typeof forwardedHost === "string" ? forwardedHost : req.get("host");
  if (!host) throw new Error("Unable to determine the invitation host.");
  return `${protocol}://${host}/?invite=${encodeURIComponent(token)}`;
}

async function invitationEmailResponse(
  req: Request,
  invitation: typeof workspaceInvitationsTable.$inferSelect,
) {
  const clients = await db.select().from(clientsTable).where(inArray(clientsTable.id, invitation.clientIds));
  const [actor] = await db.select().from(usersTable).where(eq(usersTable.id, invitation.invitedByUserId)).limit(1);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [rotated] = await db.update(workspaceInvitationsTable)
    .set({
      tokenHash,
      expiresAt: new Date(Date.now() + WORKSPACE_INVITATION_TTL_MS),
    })
    .where(and(
      eq(workspaceInvitationsTable.id, invitation.id),
      eq(workspaceInvitationsTable.status, "pending"),
    ))
    .returning();
  if (!rotated) return null;
  return invitationResponse(
    rotated,
    new Map(clients.map((client) => [client.id, client])),
    actor ? displayName(actor) : "Workspace admin",
    invitationLink(req, token),
  );
}

async function workspaceMemberResponse(userId: string, clientIds: number[], currentUserId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) throw new Error("Workspace member account was not found.");
  const memberships = await db.select({
    clientId: clientWorkspacesTable.clientId,
    role: clientWorkspacesTable.role,
    client: clientsTable,
  }).from(clientWorkspacesTable)
    .innerJoin(clientsTable, eq(clientsTable.id, clientWorkspacesTable.clientId))
    .where(and(eq(clientWorkspacesTable.userId, userId), inArray(clientWorkspacesTable.clientId, clientIds)));
  return {
    userId,
    email: user.email ?? "",
    name: displayName(user),
    role: (memberships.some((membership) => membership.role === "admin") ? "admin" : "bookkeeper") as WorkspaceRole,
    status: "active" as const,
    clients: memberships.map((membership) => clientSummary(membership.client)),
    isCurrentUser: userId === currentUserId,
  };
}

export async function ensureUserWorkspace(userId: string) {
  await db.transaction(async (tx) => {
    const [user] = await tx.select({
      starterClientId: usersTable.starterClientId,
      remediatedLegacyClientId: usersTable.remediatedLegacyClientId,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
    })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .for("update");
    if (!user) throw new Error("Cannot create a workspace for an unknown user.");
    const [existingWorkspace] = await tx.select({ clientId: clientWorkspacesTable.clientId })
      .from(clientWorkspacesTable)
      .where(eq(clientWorkspacesTable.userId, userId))
      .orderBy(asc(clientWorkspacesTable.createdAt))
      .limit(1);
    const existingClientId = user.starterClientId ?? existingWorkspace?.clientId;
    const remediatingLegacyDemo = existingClientId
      ? await isUntouchedLegacyDemoWorkspace(tx, userId, existingClientId)
      : false;
    if (existingClientId && !remediatingLegacyDemo) {
      if (!user.starterClientId) {
        await tx.update(usersTable)
          .set({ starterClientId: existingClientId })
          .where(eq(usersTable.id, userId));
      }
      return;
    }
    if (user.email) {
      const [pendingInvitation] = await tx.select({ id: workspaceInvitationsTable.id })
        .from(workspaceInvitationsTable)
        .where(and(
          eq(workspaceInvitationsTable.email, user.email.toLowerCase()),
          eq(workspaceInvitationsTable.status, "pending"),
        ))
        .limit(1);
      if (pendingInvitation) return;
    }
    const accountName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
      || user.email?.split("@")[0]?.trim()
      || "New";
    const workspaceName = accountName === "New"
      ? "New LedgerFlow private workspace"
      : `${accountName}'s private workspace`;
    const [client] = await tx.insert(clientsTable).values({
      name: workspaceName,
      legalName: "Legal entity to be configured",
      functionalCurrency: "AED",
      basis: "IFRS",
      period: "August 2026",
    }).returning();
    await tx.insert(clientWorkspacesTable).values({ clientId: client.id, userId });
    await tx.update(usersTable)
      .set({
        starterClientId: client.id,
        remediatedLegacyClientId: remediatingLegacyDemo ? existingClientId : user.remediatedLegacyClientId,
      })
      .where(eq(usersTable.id, userId));
  });
}

async function isUntouchedLegacyDemoWorkspace(
  tx: LedgerflowTransaction,
  userId: string,
  clientId: number,
) {
  const [client] = await tx.select().from(clientsTable).where(eq(clientsTable.id, clientId)).limit(1);
  if (
    !client
    || client.name !== "Northstar Advisory"
    || client.legalName !== "Northstar Advisory FZ-LLC"
    || client.functionalCurrency !== "AED"
    || client.basis !== "IFRS"
    || client.period !== "August 2026"
  ) return false;

  const memberships = await tx.select({ userId: clientWorkspacesTable.userId })
    .from(clientWorkspacesTable)
    .where(eq(clientWorkspacesTable.clientId, clientId));
  if (memberships.length !== 1 || memberships[0].userId !== userId) return false;
  const userWorkspaces = await tx.select({ clientId: clientWorkspacesTable.clientId })
    .from(clientWorkspacesTable)
    .where(eq(clientWorkspacesTable.userId, userId));
  if (userWorkspaces.length !== 1 || userWorkspaces[0].clientId !== clientId) return false;

  const lines = await tx.select().from(statementLinesTable).where(eq(statementLinesTable.clientId, clientId));
  const entries = await tx.select().from(journalEntriesTable).where(eq(journalEntriesTable.clientId, clientId));
  const imports = await tx.select({ id: statementImportsTable.id }).from(statementImportsTable).where(eq(statementImportsTable.clientId, clientId)).limit(1);
  const accounts = await tx.select({ id: bankAccountsTable.id }).from(bankAccountsTable).where(eq(bankAccountsTable.clientId, clientId)).limit(1);
  const packs = await tx.select({ id: reportPacksTable.id }).from(reportPacksTable).where(eq(reportPacksTable.clientId, clientId)).limit(1);
  const exchangeRates = await tx.select({ id: exchangeRatesTable.id }).from(exchangeRatesTable).where(eq(exchangeRatesTable.userId, userId)).limit(1);
  const aiProviderConfig = await tx.select({ id: aiProviderConfigsTable.id }).from(aiProviderConfigsTable).where(eq(aiProviderConfigsTable.clientId, clientId)).limit(1);
  const classifications = await tx.select({ id: accountClassificationsTable.id }).from(accountClassificationsTable).where(eq(accountClassificationsTable.clientId, clientId)).limit(1);
  const audits = await tx.select({ id: bulkTransitionAuditsTable.id }).from(bulkTransitionAuditsTable).where(eq(bulkTransitionAuditsTable.clientId, clientId)).limit(1);
  if (
    lines.length !== legacyDemoRows.length
    || entries.length !== legacyDemoRows.length
    || imports.length
    || accounts.length
    || packs.length
    || exchangeRates.length
    || aiProviderConfig.length
    || classifications.length
    || audits.length
  ) {
    return false;
  }

  return legacyDemoRows.every((seed) => {
    const line = lines.find((candidate) =>
      candidate.date === seed.date
      && candidate.description === seed.description
      && candidate.currency === seed.currency
      && number(candidate.amount).toFixed(2) === seed.amount
      && candidate.direction === seed.direction
      && candidate.status === seed.status
      && candidate.source === "Bank statement"
      && candidate.accountSuggestion === seed.accountSuggestion
      && number(candidate.confidence).toFixed(2) === seed.confidence,
    );
    if (!line) return false;
    const entry = entries.find((candidate) => candidate.statementLineId === line.id);
    const expectedStatus = seed.status === "posted" ? "posted" : "suggested";
    const expectedDebit = seed.direction === "inflow" ? "Bank / cash" : seed.accountSuggestion;
    const expectedCredit = seed.direction === "inflow" ? seed.accountSuggestion : "Bank / cash";
    return entry?.date === seed.date
      && entry.memo === seed.description
      && entry.currency === seed.currency
      && entry.status === expectedStatus
      && entry.debitAccount === expectedDebit
      && entry.creditAccount === expectedCredit
      && number(entry.amount).toFixed(2) === seed.amount
      && number(entry.confidence).toFixed(2) === seed.confidence;
  });
}

function normalizeDescription(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase();
}

function importDedupeKey(line: {
  clientId: number;
  bankAccountId?: number | null;
  date: string;
  description: string;
  amount: number | string;
  direction: string;
  currency: string;
}) {
  return [
    line.clientId,
    line.bankAccountId ?? "none",
    line.date.trim(),
    normalizeDescription(line.description),
    Number(line.amount).toFixed(2),
    line.direction.trim().toLocaleLowerCase(),
    line.currency.trim().toLocaleUpperCase(),
  ].join("|");
}

function clientIdFrom(value: unknown) {
  const parsed = Number(value ?? 1);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

const interAccountTransferAccount = "Inter-account transfer";

function isInterAccountTransferAccount(account: string) {
  return account === interAccountTransferAccount;
}

function ledgerAccountCategory(account: string, side: "debit" | "credit") {
  if (account === "Bank / cash" || isInterAccountTransferAccount(account)) return "Assets";
  if (side === "credit" && (account === "Revenue" || account === "Other income")) return "Revenue";
  return "Expenses";
}

function suggestAccount(description: string, direction: string) {
  const text = description.toLowerCase();
  if (/\b(?:internal|inter[\s-]?account|own[-\s]?account)\s+transfer\b|\b(?:transfer|xfer).*\b(?:savings|current|operating|reserve|wallet|own account)\b/.test(text)) {
    return interAccountTransferAccount;
  }
  if (direction === "inflow") {
    if (/stripe|retainer|client|invoice|sale|sales|payment|payout|customer/.test(text)) return "Revenue";
    return "Other income";
  }
  if (/emirates|airline|flight|hotel|taxi|uber|careem|travel/.test(text)) return "Travel & entertainment";
  if (/aws|azure|google cloud|software|subscription|saas|adobe|microsoft|hosting/.test(text)) return "Software & subscriptions";
  if (/office|stationery|supplies|printer/.test(text)) return "Office expenses";
  if (/telecom|etisalat|du\\b|internet|phone|mobile/.test(text)) return "Communication expenses";
  if (/rent|lease/.test(text)) return "Rent expense";
  if (/salary|payroll|wages/.test(text)) return "Payroll";
  if (/fee|charge|commission/.test(text)) return "Bank charges";
  return "General expenses";
}

const classificationAccounts = new Set([
  "Revenue",
  "Other income",
  "Travel & entertainment",
  "Software & subscriptions",
  "Office expenses",
  "Communication expenses",
  "Rent expense",
  "Payroll",
  "Bank charges",
  "General expenses",
  interAccountTransferAccount,
]);

function journalAccountsForSuggestion(direction: string, accountSuggestion: string) {
  return direction === "inflow"
    ? { debitAccount: "Bank / cash", creditAccount: accountSuggestion }
    : { debitAccount: accountSuggestion, creditAccount: "Bank / cash" };
}

function isInterAccountTransferEntry(entry: Pick<typeof journalEntriesTable.$inferSelect, "debitAccount" | "creditAccount">) {
  return isInterAccountTransferAccount(entry.debitAccount) || isInterAccountTransferAccount(entry.creditAccount);
}
const vendorNoiseWords = new Set([
  "account", "ae", "bank", "charge", "charges", "co", "company", "credit",
  "debit", "fee", "fees", "fze", "fz", "inc", "invoice", "ltd", "llc",
  "payout", "payment", "payments", "ref", "reference", "transaction", "uae",
]);

function normalizeVendor(description: string) {
  return description
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !/^\d+$/.test(token) && !vendorNoiseWords.has(token))
    .join(" ")
    .slice(0, 160);
}

type SuggestionSource = "ai" | "heuristic" | "workspace_learning";
type ClassificationSuggestion = {
  accountSuggestion: string;
  confidence: number;
  suggestionSource: SuggestionSource;
  supportingPatternCount: number;
};

class RecodeConflictError extends Error {}

async function getWorkspacePatterns(userId: string) {
  return db.select().from(classificationPatternsTable).where(eq(classificationPatternsTable.userId, userId));
}

function findWorkspaceSuggestion(
  patterns: Array<typeof classificationPatternsTable.$inferSelect>,
  description: string,
): ClassificationSuggestion | null {
  const normalized = normalizeVendor(description);
  if (!normalized) return null;
  const tokens = new Set(normalized.split(" "));
  const candidates = patterns.map((pattern) => {
    const patternTokens = new Set(pattern.normalizedVendor.split(" "));
    const overlap = [...tokens].filter((token) => patternTokens.has(token)).length;
    const union = new Set([...tokens, ...patternTokens]).size;
    const similarity = normalized === pattern.normalizedVendor
      ? 1
      : union === 0 ? 0 : overlap / union;
    return { pattern, similarity };
  }).filter(({ similarity }) => similarity >= 0.62)
    .sort((a, b) => b.similarity - a.similarity
      || b.pattern.confirmationCount - a.pattern.confirmationCount
      || Number(b.pattern.confidence) - Number(a.pattern.confidence));
  const best = candidates[0];
  if (!best) return null;

  // Do not choose between equally plausible confirmed accounts. Falling back to
  // the normal heuristic is safer than crossing a client's classification.
  const competingAccount = candidates.find(({ pattern, similarity }) =>
    pattern.accountSuggestion !== best.pattern.accountSuggestion
      && similarity >= best.similarity - 0.08,
  );
  if (competingAccount) return null;

  const confidence = Math.min(
    0.99,
    Math.max(0.85, Number(best.pattern.confidence)) * (0.92 + best.similarity * 0.08),
  );
  return {
    accountSuggestion: best.pattern.accountSuggestion,
    confidence,
    suggestionSource: "workspace_learning",
    supportingPatternCount: best.pattern.confirmationCount,
  };
}

async function recordClassificationPattern(
  userId: string,
  description: string,
  accountSuggestion: string,
  confidence: number | string | null | undefined,
  executor: Pick<typeof db, "insert"> = db,
) {
  const normalizedVendor = normalizeVendor(description);
  const normalizedAccount = accountSuggestion.trim().slice(0, 160);
  if (!normalizedVendor || !classificationAccounts.has(normalizedAccount)) return;
  const confirmedConfidence = Math.min(0.99, Math.max(0.85, Number(confidence) || 0.85));
  await executor.insert(classificationPatternsTable).values({
    userId,
    normalizedVendor,
    accountSuggestion: normalizedAccount,
    confidence: confirmedConfidence.toFixed(2),
    confirmationCount: 1,
  }).onConflictDoUpdate({
    target: [
      classificationPatternsTable.userId,
      classificationPatternsTable.normalizedVendor,
      classificationPatternsTable.accountSuggestion,
    ],
    set: {
      confirmationCount: sql`${classificationPatternsTable.confirmationCount} + 1`,
      confidence: sql`GREATEST(${classificationPatternsTable.confidence}, ${confirmedConfidence.toFixed(2)})`,
      updatedAt: new Date(),
    },
  });
}

function lineSuggestion(
  line: { description: string; direction: string; accountSuggestion?: string | null; confidence?: string | number | null },
  patterns: Array<typeof classificationPatternsTable.$inferSelect>,
): ClassificationSuggestion {
  const learned = findWorkspaceSuggestion(patterns, line.description);
  if (learned) return learned;
  const accountSuggestion = line.accountSuggestion?.trim() || suggestAccount(line.description, line.direction);
  const confidence = Number(line.confidence);
  return {
    accountSuggestion,
    confidence: Number.isFinite(confidence) ? confidence : 0.75,
    suggestionSource: line.accountSuggestion ? "ai" : "heuristic",
    supportingPatternCount: 0,
  };
}

function statementLineResponse(
  line: typeof statementLinesTable.$inferSelect,
  patterns: Array<typeof classificationPatternsTable.$inferSelect>,
) {
  const suggestion = lineSuggestion(line, patterns);
  return {
    ...line,
    date: calendarDate(line.date),
    amount: number(line.amount),
    accountSuggestion: suggestion.accountSuggestion,
    confidence: suggestion.confidence,
    suggestionSource: suggestion.suggestionSource,
    supportingPatternCount: suggestion.supportingPatternCount,
    functionalAmount: line.functionalAmount == null ? null : number(line.functionalAmount),
    exchangeRate: line.exchangeRate == null ? null : number(line.exchangeRate),
    exchangeRateEffectiveDate: calendarDate(line.exchangeRateEffectiveDate),
  };
}

async function ensureSuggestedAccounts() {
  const lines = await db.select().from(statementLinesTable);
  for (const line of lines.filter((item) => !item.accountSuggestion)) {
    const accountSuggestion = suggestAccount(line.description, line.direction);
    const confidence = "0.75";
    await db.update(statementLinesTable)
      .set({ accountSuggestion, confidence })
      .where(eq(statementLinesTable.id, line.id));

    await db.update(journalEntriesTable)
      .set({
        confidence,
        ...journalAccountsForSuggestion(line.direction, accountSuggestion),
      })
      .where(eq(journalEntriesTable.statementLineId, line.id));
  }
}

async function createSuggestedEntry(tx: LedgerflowTransaction, line: {
  id: number;
  clientId: number;
  date: string;
  description: string;
  currency: string;
  amount: string;
  direction: string;
  accountSuggestion?: string | null;
  confidence?: string | null;
  functionalCurrency?: string | null;
  functionalAmount?: string | null;
  exchangeRate?: string | null;
  exchangeRateEffectiveDate?: string | null;
  exchangeRateStatus?: string | null;
}) {
  const account = line.accountSuggestion || suggestAccount(line.description, line.direction);
  await tx.insert(journalEntriesTable).values({
    statementLineId: line.id,
    clientId: line.clientId,
    date: line.date,
    memo: line.description,
    currency: line.currency,
    status: "suggested",
    confidence: line.confidence ?? "0.80",
    ...journalAccountsForSuggestion(line.direction, account),
    amount: line.amount,
    functionalCurrency: line.functionalCurrency,
    functionalAmount: line.functionalAmount,
    exchangeRate: line.exchangeRate,
    exchangeRateEffectiveDate: line.exchangeRateEffectiveDate,
    exchangeRateStatus: line.exchangeRateStatus ?? "not_required",
  });
}

async function createStatementLineAndJournal(
  tx: LedgerflowTransaction,
  draft: typeof statementLinesTable.$inferInsert,
  options?: { ignoreExistingImportDedupeKey?: boolean },
) {
  const insert = tx.insert(statementLinesTable).values(draft);
  const [line] = options?.ignoreExistingImportDedupeKey
    ? await insert.onConflictDoNothing({ target: statementLinesTable.importDedupeKey }).returning()
    : await insert.returning();
  if (!line) return null;
  await createSuggestedEntry(tx, line);
  return line;
}

async function recordFailedStatementImport(details: {
  clientId: number;
  bankAccountId?: number | null;
  fileName: string;
  mimeType: string;
  objectPath: string;
  fileSize: number;
  fileHash: string;
  errorMessage: string;
}) {
  try {
    await db.insert(statementImportsTable).values({
      clientId: details.clientId,
      bankAccountId: details.bankAccountId ?? null,
      fileName: details.fileName,
      mimeType: details.mimeType,
      objectPath: details.objectPath,
      fileSize: details.fileSize,
      fileHash: details.fileHash,
      outcome: "failed",
      errorMessage: details.errorMessage.slice(0, 500),
      importedLineCount: 0,
    });
  } catch (recordError) {
    // Preserve the original import failure if the audit record cannot be written.
    // The original import error is already returned to the caller.
  }
}

type ParsedBankLine = {
  date: string;
  description: string;
  amount: number;
  direction: "inflow" | "outflow";
  currency: string;
  accountSuggestion?: string;
  confidence?: number | string;
};

type BankAccountDraft = {
  name?: string | null;
  bankName?: string | null;
  accountNumberLast4?: string | null;
  currency?: string | null;
};

type AICopilotRecommendation = {
  id: string;
  clientId: number;
  type: "next_step" | "review_group" | "recode_lines" | "create_bank_account" | "bulk_approve_entries" | "bulk_post_entries";
  title: string;
  summary: string;
  lineIds?: number[];
  entryIds?: number[];
  statementLineIds?: number[];
  entryCount?: number;
  lineCount?: number;
  fromStatus?: string;
  toStatus?: string;
  statusTransition?: { from: string; to: string };
  accountSuggestion?: string | null;
  confidence?: number | null;
  suggestionSource?: SuggestionSource;
  supportingPatternCount?: number;
  bankAccount?: { name: string; bankName: string | null; accountNumberLast4: string | null; currency: string } | null;
  requiresConfirmation: boolean;
};

const suggestedAccounts = [
  "Revenue",
  "Other income",
  "Travel & entertainment",
  "Software & subscriptions",
  "Office expenses",
  "Communication expenses",
  "Rent expense",
  "Payroll",
  "Bank charges",
  "General expenses",
  interAccountTransferAccount,
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function descriptionScopeFromMessage(message: string) {
  const quoted = message.match(/\b(?:description|memo|narration)\b[^"'“”]*["“]([^"”]+)["”]/i)?.[1];
  const unquoted = message.match(/\b(?:description|memo|narration)(?:\s+(?:is|contains|matching|matches|like|of|with))?\s+(.+?)(?=\s+\b(?:must|should|need(?:s)?|as|to|be|classified|recorded|set|approve|approved|post|posted|posting)\b|[.!?]|$)/i)?.[1];
  const batchMatch = message.match(/\b(?:transactions?|lines?)\s+matching\s+["“']?(.+?)["”']?\s+(?:as|to|into)\b/i)?.[1];
  const scope = normalizeDescription(quoted ?? batchMatch ?? unquoted ?? "");
  return scope.length >= 3 ? scope : null;
}

function classificationAccountFromMessage(message: string) {
  const normalized = message.toLowerCase();
  return [...classificationAccounts]
    .sort((left, right) => right.length - left.length)
    .find((account) => new RegExp(`\\b${escapeRegExp(account.toLowerCase())}\\b`, "i").test(normalized))
    ?? null;
}

function asksForDescriptionClassification(message: string) {
  return /\b(?:classify|categorize|recode|reclassify)\b/i.test(message)
    || /\b(?:must|should|need(?:s)?)\s+be\s+(?:classified|recorded|posted)\s+as\b/i.test(message);
}

function asksForLedgerTransition(message: string) {
  const accountNames = [...classificationAccounts].map(escapeRegExp).join("|");
  const withoutClassificationClause = message.replace(
    new RegExp(`\\b(?:must|should|need(?:s)?)\\s+be\\s+posted\\s+as\\s+(?:an?\\s+)?(?:${accountNames})\\b`, "gi"),
    "",
  );
  return /\b(?:approve|approval|approving|post|posted|posting)\b/i.test(withoutClassificationClause);
}

function prepareDescriptionRecodeRecommendation(
  message: string,
  clientId: number,
  entries: Array<typeof journalEntriesTable.$inferSelect>,
  lines: Array<typeof statementLinesTable.$inferSelect>,
): { recommendation?: AICopilotRecommendation; error?: string } | null {
  if (!asksForDescriptionClassification(message)) return null;
  const descriptionScope = descriptionScopeFromMessage(message);
  const accountSuggestion = classificationAccountFromMessage(message);
  if (!descriptionScope || !accountSuggestion) return null;

  const matchingLines = lines.filter((line) =>
    line.clientId === clientId
      && line.status !== "posted"
      && normalizeDescription(line.description).includes(descriptionScope),
  );
  if (!matchingLines.length) {
    return { error: `I could not find any unposted statement lines with a description matching “${descriptionScope}” in this client workspace.` };
  }

  const suggestedEntryLineIds = new Set(entries
    .filter((entry) => entry.clientId === clientId && entry.status === "suggested")
    .map((entry) => entry.statementLineId));
  const eligibleLines = matchingLines.filter((line) => suggestedEntryLineIds.has(line.id));
  if (eligibleLines.length !== matchingLines.length) {
    return { error: `I found ${matchingLines.length} matching transaction${matchingLines.length === 1 ? "" : "s"}, but only ${eligibleLines.length} are still suggested and eligible to recode. Review approved or posted items separately.` };
  }

  const lineIds = eligibleLines.map((line) => line.id);
  const postingRequested = /\b(?:post|posted|posting)\b/.test(message);
  return {
    recommendation: {
      id: `recode-description-${lineIds.join("-")}-${accountSuggestion.toLowerCase().replace(/\W+/g, "-")}`,
      clientId,
      type: "recode_lines",
      title: `Classify ${lineIds.length} transaction${lineIds.length === 1 ? "" : "s"} as ${accountSuggestion}`,
      summary: `Apply ${accountSuggestion} to still-suggested transactions whose description contains “${descriptionScope}”.${postingRequested ? " Confirm this classification first; approval and posting must be requested and confirmed separately." : ""}`,
      lineIds,
      accountSuggestion,
      confidence: 0.9,
      requiresConfirmation: true,
    },
  };
}

function cleanBankAccountDraft(draft: BankAccountDraft | undefined | null, fallbackCurrency: string) {
  const name = draft?.name?.trim();
  if (!name) return null;
  const digits = (draft?.accountNumberLast4 ?? "").replace(/\D/g, "");
  return {
    name: name.slice(0, 120),
    bankName: draft?.bankName?.trim().slice(0, 120) || null,
    accountNumberLast4: digits.length >= 4 ? digits.slice(-4) : null,
    currency: (draft?.currency?.trim() || fallbackCurrency).toUpperCase().slice(0, 3),
  };
}

function bankAccountIdentityKey(clientId: number, account: NonNullable<ReturnType<typeof cleanBankAccountDraft>>) {
  return [
    clientId,
    `bank:${normalizeDescription(account.bankName ?? "")}`,
    `name:${normalizeDescription(account.name)}`,
    `currency:${account.currency}`,
    `last4:${account.accountNumberLast4 ?? ""}`,
  ].join("|");
}

function matchesBankAccountDraft(
  account: typeof bankAccountsTable.$inferSelect,
  draft: NonNullable<ReturnType<typeof cleanBankAccountDraft>>,
  identityKey: string,
) {
  return account.identityKey === identityKey
    || (
      normalizeDescription(account.name) === normalizeDescription(draft.name)
      && normalizeDescription(account.bankName ?? "") === normalizeDescription(draft.bankName ?? "")
      && account.currency === draft.currency
      && account.accountNumberLast4 === draft.accountNumberLast4
    );
}

function bankAccountResponse(account: typeof bankAccountsTable.$inferSelect) {
  return {
    id: account.id,
    clientId: account.clientId,
    name: account.name,
    bankName: account.bankName,
    accountNumberLast4: account.accountNumberLast4,
    currency: account.currency,
  };
}

async function findOrCreateBankAccount(clientId: number, draft: BankAccountDraft | undefined | null, fallbackCurrency: string) {
  const clean = cleanBankAccountDraft(draft, fallbackCurrency);
  if (!clean) return null;
  const identityKey = bankAccountIdentityKey(clientId, clean);
  const existingAccounts = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.clientId, clientId));
  const existing = existingAccounts.find((account) => matchesBankAccountDraft(account, clean, identityKey));
  if (existing) return existing;
  const [created] = await db.insert(bankAccountsTable).values({ clientId, ...clean, identityKey }).onConflictDoNothing({
    target: bankAccountsTable.identityKey,
  }).returning();
  if (created) return created;
  return (await db.select().from(bankAccountsTable).where(and(
    eq(bankAccountsTable.clientId, clientId),
    eq(bankAccountsTable.identityKey, identityKey),
  )))[0] ?? null;
}

function safeText(value: unknown, fallback: string, maxLength = 160) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}

function collectAICopilotRecommendations(
  rawRecommendations: unknown,
  pendingLines: Array<typeof statementLinesTable.$inferSelect>,
  clientId: number,
): AICopilotRecommendation[] {
  const validLineIds = new Set(pendingLines.map((line) => line.id));
  if (!Array.isArray(rawRecommendations)) return [];
  const recommendations: AICopilotRecommendation[] = [];

  for (const raw of rawRecommendations.slice(0, 3)) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Record<string, unknown>;
    const type = candidate.type;
    const lineIds = Array.isArray(candidate.lineIds)
      ? [...new Set(candidate.lineIds.filter((id): id is number => typeof id === "number" && validLineIds.has(id)))].slice(0, 100)
      : [];

    if (type === "recode_lines") {
      const accountSuggestion = safeText(candidate.accountSuggestion, "");
      if (!accountSuggestion || !classificationAccounts.has(accountSuggestion) || lineIds.length === 0) continue;
      const confidence = Number(candidate.confidence);
      recommendations.push({
        id: `recode-${lineIds.join("-")}-${accountSuggestion.toLowerCase().replace(/\W+/g, "-")}`,
        clientId,
        type,
        title: safeText(candidate.title, `Recode ${lineIds.length} transactions`),
        summary: safeText(candidate.summary, `Apply ${accountSuggestion} to the selected review lines.`),
        lineIds,
        accountSuggestion,
        confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0.75,
        requiresConfirmation: true,
      });
    }

    if (type === "review_group" && lineIds.length > 1) {
      recommendations.push({
        id: `group-${lineIds.join("-")}`,
        clientId,
        type,
        title: safeText(candidate.title, `Review ${lineIds.length} similar transactions together`),
        summary: safeText(candidate.summary, "These transactions share a recurring pattern and can be checked as a group."),
        lineIds,
        accountSuggestion: typeof candidate.accountSuggestion === "string" ? candidate.accountSuggestion : null,
        requiresConfirmation: false,
      });
    }

    if (type === "create_bank_account") {
      const bankAccount = cleanBankAccountDraft(candidate.bankAccount as BankAccountDraft | undefined, "AED");
      if (!bankAccount) continue;
      recommendations.push({
        id: `bank-${bankAccount.name.toLowerCase().replace(/\W+/g, "-")}-${bankAccount.accountNumberLast4 ?? "new"}`,
        clientId,
        type,
        title: safeText(candidate.title, `Create bank account: ${bankAccount.name}`),
        summary: safeText(candidate.summary, "Keep this statement stream separate from the client’s other bank activity."),
        bankAccount,
        requiresConfirmation: true,
      });
    }
  }
  return recommendations;
}

function defaultAICopilotRecommendations(
  pendingLines: Array<typeof statementLinesTable.$inferSelect>,
  bankAccounts: Array<typeof bankAccountsTable.$inferSelect>,
  clientId: number,
  lineSuggestions: Map<number, ClassificationSuggestion>,
): AICopilotRecommendation[] {
  const recommendations: AICopilotRecommendation[] = [];
  const learnedLines = pendingLines.filter((line) =>
    lineSuggestions.get(line.id)?.suggestionSource === "workspace_learning",
  );
  if (learnedLines.length) {
    const firstSuggestion = lineSuggestions.get(learnedLines[0].id)!;
    const matchingAccountLines = learnedLines.filter((line) =>
      lineSuggestions.get(line.id)?.accountSuggestion === firstSuggestion.accountSuggestion,
    ).slice(0, 20);
    recommendations.push({
      id: `workspace-learning-${matchingAccountLines.map((line) => line.id).join("-")}`,
      clientId,
      type: "recode_lines",
      title: `Confirm ${firstSuggestion.accountSuggestion} learned from this workspace`,
      summary: `${matchingAccountLines.length} pending transaction${matchingAccountLines.length === 1 ? "" : "s"} match a confirmed workspace pattern. Confirm or override the suggested account before approval. Supporting confirmations: ${firstSuggestion.supportingPatternCount}.`,
      lineIds: matchingAccountLines.map((line) => line.id),
      accountSuggestion: firstSuggestion.accountSuggestion,
      confidence: firstSuggestion.confidence,
      suggestionSource: "workspace_learning",
      supportingPatternCount: firstSuggestion.supportingPatternCount,
      requiresConfirmation: true,
    });
  }
  const groups = new Map<string, Array<typeof statementLinesTable.$inferSelect>>();
  for (const line of pendingLines) {
    const account = line.accountSuggestion || suggestAccount(line.description, line.direction);
    const members = groups.get(account) ?? [];
    members.push(line);
    groups.set(account, members);
  }
  const recurringGroup = [...groups.entries()].find(([, members]) => members.length >= 2);
  if (recurringGroup) {
    const [accountSuggestion, members] = recurringGroup;
    recommendations.push({
      id: `group-${members.slice(0, 20).map((line) => line.id).join("-")}`,
      clientId,
      type: "review_group",
      title: `Review ${members.length} ${accountSuggestion} suggestions together`,
      summary: "These transactions already share the same proposed counter-account. Inspect one pattern before approving any of them.",
      lineIds: members.slice(0, 20).map((line) => line.id),
      accountSuggestion,
      requiresConfirmation: false,
    });
  }
  if (pendingLines.length) {
    recommendations.push({
      id: "next-review-step",
      clientId,
      type: "next_step",
      title: `${pendingLines.length} lines are waiting for review`,
      summary: "Confirm the suggested accounts, then approve the journal entries you stand behind. AI will never post them for you.",
      requiresConfirmation: false,
    });
  }
  if (bankAccounts.length === 0) {
    recommendations.push({
      id: "next-bank-account-step",
      clientId,
      type: "next_step",
      title: "Set up the first bank account",
      summary: "Upload a statement with a visible account header or ask me to prepare a bank-account setup card.",
      requiresConfirmation: false,
    });
  }
  return recommendations.slice(0, 3);
}

type BulkActionType = "bulk_approve_entries" | "bulk_post_entries";

class BulkActionValidationError extends Error {
  constructor(readonly kind: "not_found" | "invalid_scope" | "invalid_status") {
    super(kind);
  }
}

function prepareBulkActionRecommendation(
  message: string,
  clientId: number,
  entries: Array<typeof journalEntriesTable.$inferSelect>,
  lines: Array<typeof statementLinesTable.$inferSelect>,
): { recommendation?: AICopilotRecommendation; error?: string } | null {
  const normalized = message.toLowerCase();
  const asksToApprove = /\b(?:approve|approval|approving)\b/.test(normalized);
  const asksToPost = /\b(?:post|posted|posting)\b/.test(normalized);
  if (!asksToApprove && !asksToPost) return null;
  if (asksToApprove && asksToPost) {
    return { error: "Please choose one transition at a time: approve the entries first, or post entries that are already approved." };
  }

  const type: BulkActionType = asksToApprove ? "bulk_approve_entries" : "bulk_post_entries";
  const expectedStatus = asksToApprove ? "suggested" : "approved";
  const targetStatus = asksToApprove ? "approved" : "posted";
  const allRequested = /\b(?:all|every|each)\b/.test(normalized);
  const pendingRequested = /\b(?:pending|review|reviewing|suggested|eligible)\b/.test(normalized);
  const approvedRequested = /\bapproved\b/.test(normalized);
  const descriptionScope = descriptionScopeFromMessage(message);
  const idMatches = normalized.match(/(?:\bje\b|\bjournal entries?\b|\bentries?\b)\s*(?:ids?\s*)?#?\s*\d+(?:\s*(?:,|and)\s*#?\s*\d+)*/g) ?? [];
  const requestedIds = [...new Set(idMatches.flatMap((match) => {
    const numbers = match.match(/\d+/g) ?? [];
    return numbers.map(Number);
  }))];

  let selectedEntries: Array<typeof journalEntriesTable.$inferSelect>;
  let scopeDescription: string;
  if (allRequested) {
    if (requestedIds.length || /\ball\s+clients?\b|\bother\s+client\b/.test(normalized)) {
      return { error: "I cannot safely infer a qualified bulk scope. Use “approve all pending entries”, “post all approved entries”, or list specific journal entry IDs." };
    }
    if (type === "bulk_approve_entries") {
      if (!pendingRequested || approvedRequested) {
        return { error: "For bulk approval, specify all pending or suggested entries. Entries that are already approved or posted need a separate scope." };
      }
      selectedEntries = entries.filter((entry) =>
        entry.status === "suggested"
          && (!descriptionScope || Boolean(lines.find((line) =>
            line.id === entry.statementLineId && normalizeDescription(line.description).includes(descriptionScope),
          ))),
      );
      scopeDescription = descriptionScope ? `suggested entries whose statement description contains “${descriptionScope}”` : "all suggested entries";
    } else {
      if (!approvedRequested || pendingRequested) {
        return { error: "For bulk posting, specify all approved entries. Suggested entries must be approved first." };
      }
      selectedEntries = entries.filter((entry) =>
        entry.status === "approved"
          && (!descriptionScope || Boolean(lines.find((line) =>
            line.id === entry.statementLineId && normalizeDescription(line.description).includes(descriptionScope),
          ))),
      );
      scopeDescription = descriptionScope ? `approved entries whose statement description contains “${descriptionScope}”` : "all approved entries";
    }
    if (!descriptionScope) {
      const tokens = normalized.match(/[a-z]+/g) ?? [];
      const supportedScopeWords = new Set([
        "please", "can", "could", "would", "you", "approve", "approval", "approving", "post", "posted", "posting",
        "all", "every", "each", "pending", "review", "reviewing", "suggested", "eligible", "approved",
        "journal", "entry", "entries", "the", "these", "those", "to", "now", "currently", "available",
        "in", "this", "workspace", "for", "me",
      ]);
      if (tokens.some((token) => !supportedScopeWords.has(token))) {
        return { error: "I cannot safely infer a qualified bulk scope. Use “approve all pending entries”, “post all approved entries”, or say which statement description the entries must match." };
      }
    }
  } else if (requestedIds.length) {
    selectedEntries = entries.filter((entry) => requestedIds.includes(entry.id));
    if (selectedEntries.length !== requestedIds.length) {
      return { error: "One or more requested journal entries are not available in this client workspace." };
    }
    scopeDescription = `the ${requestedIds.length} requested journal ${requestedIds.length === 1 ? "entry" : "entries"}`;
  } else {
    const matchingEntries = entries.filter((entry) => {
      const entryMemo = entry.memo.toLowerCase();
      const line = lines.find((candidate) => candidate.id === entry.statementLineId);
      return normalized.includes(entryMemo) || Boolean(line && normalized.includes(line.description.toLowerCase()));
    });
    if (matchingEntries.length !== 1) {
      return { error: "I need a clear scope. Say “approve all pending entries”, “post all approved entries”, or name specific journal entry IDs." };
    }
    selectedEntries = matchingEntries;
    scopeDescription = "the requested journal entry";
  }

  if (!selectedEntries.length) {
    return { error: `There are no eligible entries to ${asksToApprove ? "approve" : "post"} in that scope.` };
  }
  if (selectedEntries.some((entry) => entry.status !== expectedStatus)) {
    const invalidLabel = asksToApprove ? "already approved or posted" : "not already approved";
    return { error: `That scope includes entries that are ${invalidLabel}. Narrow the request to one eligible status before confirming.` };
  }

  const selectedLineIds = [...new Set(selectedEntries.map((entry) => entry.statementLineId))];
  const selectedLines = lines.filter((line) => selectedLineIds.includes(line.id));
  if (selectedLines.length !== selectedLineIds.length || selectedLines.some((line) => line.clientId !== clientId)) {
    return { error: "The requested entries do not have a complete statement-line scope in this client workspace." };
  }
  const entryIds = selectedEntries.map((entry) => entry.id);
  const titleVerb = asksToApprove ? "Approve" : "Post";
  return {
    recommendation: {
      id: `${type}-${entryIds.join("-")}`,
      clientId,
      type,
      title: `${titleVerb} ${selectedEntries.length} journal ${selectedEntries.length === 1 ? "entry" : "entries"}`,
      summary: `${titleVerb} ${scopeDescription}: ${selectedEntries.map((entry) => `JE-${String(entry.id).padStart(4, "0")} · ${entry.memo}`).join("; ")}. This moves ${selectedLines.length} statement ${selectedLines.length === 1 ? "line" : "lines"} from ${expectedStatus} to ${targetStatus}.`,
      entryIds,
      statementLineIds: selectedLineIds,
      entryCount: selectedEntries.length,
      lineCount: selectedLines.length,
      fromStatus: expectedStatus,
      toStatus: targetStatus,
      statusTransition: { from: expectedStatus, to: targetStatus },
      requiresConfirmation: true,
    },
  };
}

type StatementColumns = {
  headerRowIndex: number;
  date: number;
  description: number;
  amount: number;
  debit: number;
  credit: number;
  balance: number;
};

function statementColumns(text: string): StatementColumns | null {
  const rows = text.split(/\r?\n/);
  for (let headerRowIndex = 0; headerRowIndex < Math.min(rows.length, 20); headerRowIndex += 1) {
    const headers = rows[headerRowIndex].split(/,|\t|;/).map((cell) => cell.trim().toLowerCase());
    const date = headers.findIndex((header) => /\b(date|transaction date|value date)\b/.test(header));
    const description = headers.findIndex((header) => /\b(description|narration|narrative|details|transaction|memo|reference|remarks|particulars)\b/.test(header));
    const debit = headers.findIndex((header) => /\b(debit|withdrawal|paid out)\b/.test(header));
    const credit = headers.findIndex((header) => /\b(credit|deposit|paid in)\b/.test(header));
    const amount = headers.findIndex((header) => /\b(amount|transaction amount|value)\b/.test(header));
    const balance = headers.findIndex((header) => /\bbalance\b/.test(header));
    if (date >= 0 && description >= 0 && (amount >= 0 || debit >= 0 || credit >= 0)) {
      return { headerRowIndex, date, description, amount, debit, credit, balance };
    }
  }
  return null;
}

function numericCell(value: string) {
  const numeric = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeRows(text: string, currency: string): ParsedBankLine[] {
  const columns = statementColumns(text);
  if (!columns) return [];
  const rows = text.split(/\r?\n/).slice(columns.headerRowIndex + 1);
  const parsedRows: Array<ParsedBankLine | null> = rows.map((row): ParsedBankLine | null => {
    const cells = row.split(/,|\t|;/).map((cell) => cell.trim().replace(/^"|"$/g, ""));
    const date = cells[columns.date] ?? "";
    if (!isIsoDate(date)) return null;
    const description = cells[columns.description]?.trim() || "Imported bank activity";
    const debit = columns.debit >= 0 ? Math.abs(numericCell(cells[columns.debit] ?? "")) : 0;
    const credit = columns.credit >= 0 ? Math.abs(numericCell(cells[columns.credit] ?? "")) : 0;
    const amountValue = columns.amount >= 0 ? numericCell(cells[columns.amount] ?? "") : 0;
    const hasDebitCreditColumns = columns.debit >= 0 || columns.credit >= 0;
    if (hasDebitCreditColumns && debit > 0 && credit > 0) return null;
    const amount = hasDebitCreditColumns ? debit || credit : Math.abs(amountValue);
    if (amount <= 0) return null;
    const direction = hasDebitCreditColumns
      ? (debit > 0 ? "outflow" : "inflow")
      : (/^-/.test(cells[columns.amount] ?? "") || /^\(.*\)$/.test(cells[columns.amount] ?? "") ? "outflow" : "inflow");
    return {
      date,
      description,
      amount,
      direction,
      currency,
      accountSuggestion: suggestAccount(description, direction),
      confidence: 0.75,
    };
  });
  return parsedRows.filter((line): line is ParsedBankLine => line !== null);
}

function hasBankStatementStructure(text: string, parsedRows: ParsedBankLine[], hasSelectedBankAccount: boolean) {
  const columns = statementColumns(text);
  if (!columns) return false;
  const hasExplicitTransactionColumns = columns.debit >= 0 || columns.credit >= 0 || columns.balance >= 0;
  const hasMixedTransactionDirections = parsedRows.length >= 2
    && new Set(parsedRows.map((line) => line.direction)).size > 1;
  const accountSummary = text
    .split(/\r?\n/)
    .slice(0, columns.headerRowIndex + 1)
    .join(" ");
  const hasBankStatementTitle = /\bbank statement\b/i.test(accountSummary);
  const hasBankAccountIdentifier = /\b(iban|swift|bic|routing number|sort code)\b[\s:#-]*[a-z0-9]/i.test(accountSummary);
  const hasBankProvenance = hasBankStatementTitle || hasBankAccountIdentifier;
  return (hasExplicitTransactionColumns || hasMixedTransactionDirections)
    && (hasBankProvenance || hasSelectedBankAccount);
}

router.post("/ledgerflow/import-statement", async (req, res) => {
  const parsed = ImportStatementBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A verified statement upload is required." });
  const { clientId, bankAccountId, fileName, mimeType, objectPath, currency = "AED" } = parsed.data as typeof parsed.data & { objectPath?: string };
  if (!objectPath) return res.status(400).json({ error: "A verified statement upload is required." });
  let activeClientId: number | undefined;
  let failedBankAccountId: number | null = null;
  let uploadedFileSize = 0;
  let fileHash: string | undefined;
  let aiActivityId: number | undefined;
  let aiCompletionRecorded = false;
  try {
    const client = await requireOwnedClient(req, res, typeof clientId === "number" ? clientId : undefined);
    if (!client) return;
    const scopedClientId = client.id;
    if (!req.dbUser || !scopedStatementObjectPath(req.dbUser.id, scopedClientId, objectPath)) {
      return res.status(403).json({ error: "This statement upload is not assigned to the selected client workspace." });
    }
    const metadataError = validateStatementMetadata(fileName, mimeType, 1);
    if (metadataError && !metadataError.includes("between 1 byte")) {
      return res.status(400).json({ error: metadataError });
    }
    let objectFile;
    try {
      objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    } catch {
      return res.status(422).json({ error: "The statement upload is no longer available. Please upload the file again." });
    }
    const [objectMetadata] = await objectFile.getMetadata();
    uploadedFileSize = Number(objectMetadata.size ?? 0);
    const sizeError = validateStatementMetadata(fileName, mimeType, uploadedFileSize);
    if (sizeError) return res.status(400).json({ error: sizeError });
    const storedContentType = String(objectMetadata.contentType ?? "").toLocaleLowerCase();
    if (storedContentType !== mimeType.toLocaleLowerCase()) {
      return res.status(422).json({ error: "The stored statement type does not match the verified upload metadata. Please upload it again." });
    }
    const [buffer] = await objectFile.download();
    const contentError = validateStatementContents(fileName, buffer);
    if (contentError) return res.status(422).json({ error: contentError });
    const scopedFileHash = createHash("sha256").update(buffer).digest("hex");
    activeClientId = scopedClientId;
    fileHash = scopedFileHash;
    const previousImport = (await db.select().from(statementImportsTable).where(and(
      eq(statementImportsTable.clientId, scopedClientId),
      eq(statementImportsTable.fileHash, scopedFileHash),
      eq(statementImportsTable.outcome, "completed"),
    )))[0];
    if (previousImport) {
      const previousBankAccount = previousImport.bankAccountId == null
        ? null
        : (await db.select().from(bankAccountsTable).where(and(
          eq(bankAccountsTable.id, previousImport.bankAccountId),
          eq(bankAccountsTable.clientId, scopedClientId),
        )))[0] ?? null;
      const [duplicateImport] = await db.insert(statementImportsTable).values({
        clientId: scopedClientId,
        bankAccountId: previousImport.bankAccountId,
        fileName,
        mimeType,
        objectPath,
        fileSize: uploadedFileSize,
        fileHash: scopedFileHash,
        outcome: "duplicate",
        importedLineCount: previousImport.importedLineCount,
      }).returning();
      return res.status(200).json(ImportStatementResponse.parse({
        fileName,
        importId: duplicateImport.id,
        importStatus: "duplicate_file",
        message: `This statement was already imported for this client. No new lines were added.`,
        importedCount: 0,
        duplicateCount: previousImport.importedLineCount,
        duplicateLines: [],
        lines: [],
        bankAccount: previousBankAccount ? bankAccountResponse(previousBankAccount) : null,
        sourceUrl: statementSourceUrl(duplicateImport.id),
      }));
    }
    let extractedText = "";

    if (mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      extractedText = (await parser.getText({ first: 100 })).text.slice(0, 55_000);
      await parser.destroy();
    } else if (fileName.toLowerCase().endsWith(".xls") || fileName.toLowerCase().endsWith(".xlsx")) {
      if (fileName.toLowerCase().endsWith(".xlsx")) {
        const archiveError = validateXlsxArchive(buffer);
        if (archiveError) return res.status(422).json({ error: archiveError });
      }
      const workbook = XLSX.read(buffer, { type: "buffer" });
      extractedText = workbook.SheetNames.slice(0, 20)
        .map((name) => XLSX.utils.sheet_to_csv(workbook.Sheets[name]))
        .join("\n")
        .slice(0, 55_000);
    } else {
      extractedText = buffer.toString("utf8");
    }
    const isPdfStatement = mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
    const delimitedFallback = normalizeRows(extractedText, currency);
    const pdfFallback = isPdfStatement
      ? parsePdfBankStatementRows(extractedText, currency).map((line) => ({
        ...line,
        accountSuggestion: suggestAccount(line.description, line.direction),
        confidence: 0.75,
      }))
      : [];
    const fallback = delimitedFallback.length ? delimitedFallback : pdfFallback;
    const hasRecognizedPdfTable = isPdfStatement
      && hasPdfBankStatementTable(extractedText)
      && pdfFallback.length > 0;
    if (!hasRecognizedPdfTable && !hasBankStatementStructure(extractedText, fallback, bankAccountId != null)) {
      await recordFailedStatementImport({
        clientId: scopedClientId,
        bankAccountId: null,
        fileName,
        mimeType,
        objectPath,
        fileSize: uploadedFileSize,
        fileHash: scopedFileHash,
        errorMessage: "No bank-statement transactions were found. Upload a bank statement PDF, CSV, XLS, or XLSX with dated transaction rows.",
      });
      return res.status(422).json({
        error: "No bank-statement transactions were found. Upload a bank statement PDF, CSV, XLS, or XLSX with dated transaction rows.",
      });
    }
    const aiConfig = await getAIProviderConfig(scopedClientId);
    const [aiActivity] = await db.insert(aiActivityTable).values({
      clientId: scopedClientId,
      userId: currentUserId(req),
      activityType: "statement_extraction",
      provider: aiConfig.provider,
      model: aiConfig.model,
      billingSource: aiConfig.provider === "managed_openai" ? "replit_credits" : "provider_direct",
      status: "started",
    }).returning({ id: aiActivityTable.id });
    aiActivityId = aiActivity?.id;
    let candidate: { lines?: ParsedBankLine[]; bankAccount?: BankAccountDraft | null };
    let usingDeterministicFallback = false;
    try {
      const completion = await completeAI(scopedClientId, [
          { role: "system", content: "Extract bank statement transactions, identify the statement's bank account when the document header supports it, and suggest the most likely counterpart account for each line. Return JSON only: {\"bankAccount\":{\"name\":\"string\",\"bankName\":\"string|null\",\"accountNumberLast4\":\"1234|null\",\"currency\":\"AED\"}|null,\"lines\":[{\"date\":\"YYYY-MM-DD\",\"description\":\"string\",\"amount\":123.45,\"direction\":\"inflow|outflow\",\"currency\":\"AED\",\"accountSuggestion\":\"Revenue|Other income|Travel & entertainment|Software & subscriptions|Office expenses|Communication expenses|Rent expense|Payroll|Bank charges|General expenses\",\"confidence\":0.0}]}. Never invent transactions or bank account numbers. Only return bankAccount when a name or bank header is visible; if an account number is visible, return only its last four digits. Use the statement's stated currency when available. For accountSuggestion, choose the closest account from the list and use General expenses or Other income when uncertain. Set confidence between 0 and 1." },
          { role: "user", content: `File: ${fileName}\nDefault currency: ${currency}\n\nStatement text:\n${extractedText.slice(0, 55000)}` },
        ], { json: true, maxTokens: 8192 });
      if (aiActivityId !== undefined) {
        await db.update(aiActivityTable).set(completedAIActivityValues(completion)).where(eq(aiActivityTable.id, aiActivityId));
        aiCompletionRecorded = true;
      }
      candidate = JSON.parse(completion.content) as { lines?: ParsedBankLine[]; bankAccount?: BankAccountDraft | null };
    } catch (error) {
      if (aiActivityId !== undefined && !aiCompletionRecorded) {
        await db.update(aiActivityTable).set({ status: "failed" }).where(eq(aiActivityTable.id, aiActivityId));
      }
      if (error instanceof AIProviderError) {
        req.log.warn({ err: error, clientId: scopedClientId }, "AI extraction unavailable; using deterministic statement fallback");
        candidate = { lines: fallback, bankAccount: null };
        usingDeterministicFallback = true;
      } else {
        throw error;
      }
    }
    const lines = (hasRecognizedPdfTable
      ? fallback
      : candidate.lines?.length
        ? candidate.lines
        : usingDeterministicFallback
          ? fallback
          : []).filter((line) =>
      isIsoDate(line.date)
      && line.description
      && Number.isFinite(Number(line.amount))
      && Number(line.amount) > 0,
    );
    if (!lines.length) {
      await recordFailedStatementImport({
        clientId: scopedClientId,
        bankAccountId: null,
        fileName,
        mimeType,
        objectPath,
        fileSize: uploadedFileSize,
        fileHash: scopedFileHash,
        errorMessage: "No bank-statement transactions were found. Upload a bank statement PDF, CSV, XLS, or XLSX with dated transaction rows.",
      });
      return res.status(422).json({
        error: "No bank-statement transactions were found. Upload a bank statement PDF, CSV, XLS, or XLSX with dated transaction rows.",
      });
    }
    const workspacePatterns = await getWorkspacePatterns(currentUserId(req));
    const selectedBankAccount = bankAccountId == null ? null : (await db.select().from(bankAccountsTable).where(and(
      eq(bankAccountsTable.id, Number(bankAccountId)),
      eq(bankAccountsTable.clientId, scopedClientId),
    )))[0];
    if (bankAccountId != null && !selectedBankAccount) {
      return res.status(400).json({ error: "Selected bank account was not found for this client." });
    }
    failedBankAccountId = selectedBankAccount?.id ?? null;
    const resolvedLines = await Promise.all(lines.map(async (line) => {
      const currencyValue = normalizeCurrency(line.currency || currency);
      return {
        line,
        currencyValue,
        conversion: await resolveExchangeRate(
          currentUserId(req),
          currencyValue,
          normalizeCurrency(client.functionalCurrency),
          line.date,
          Math.abs(line.amount),
        ),
      };
    }));
    const evidenceExpiresAt = retentionExpiresAt(RETENTION_POLICY.statementEvidenceDays);
    const importResult = await db.transaction(async (tx) => {
      const [createdImport] = await tx.insert(statementImportsTable).values({
        clientId: scopedClientId,
        bankAccountId: null,
        fileName,
        mimeType,
        objectPath,
        fileSize: uploadedFileSize,
        evidenceExpiresAt,
        fileHash: scopedFileHash,
        outcome: "completed",
        importedLineCount: 0,
      }).onConflictDoNothing({
        target: [statementImportsTable.clientId, statementImportsTable.fileHash],
        where: eq(statementImportsTable.outcome, "completed"),
      }).returning();
      if (!createdImport) {
        const [completedImport] = await tx.select().from(statementImportsTable).where(and(
          eq(statementImportsTable.clientId, scopedClientId),
          eq(statementImportsTable.fileHash, scopedFileHash),
          eq(statementImportsTable.outcome, "completed"),
        )).limit(1);
        const [duplicateImport] = await tx.insert(statementImportsTable).values({
          clientId: scopedClientId,
          bankAccountId: completedImport?.bankAccountId ?? selectedBankAccount?.id ?? null,
          fileName,
          mimeType,
          objectPath,
          fileSize: uploadedFileSize,
          fileHash: scopedFileHash,
          outcome: "duplicate",
          importedLineCount: completedImport?.importedLineCount ?? 0,
        }).returning();
        return { kind: "duplicate_file" as const, completedImport, duplicateImport };
      }

      let detectedBankAccount = selectedBankAccount;
      const cleanBankAccount = cleanBankAccountDraft(candidate.bankAccount, currency);
      if (!detectedBankAccount && cleanBankAccount) {
        const identityKey = bankAccountIdentityKey(scopedClientId, cleanBankAccount);
        const accounts = await tx.select().from(bankAccountsTable).where(eq(bankAccountsTable.clientId, scopedClientId));
        detectedBankAccount = accounts.find((account) => matchesBankAccountDraft(account, cleanBankAccount, identityKey)) ?? null;
        if (!detectedBankAccount) {
          const [createdBankAccount] = await tx.insert(bankAccountsTable).values({
            clientId: scopedClientId,
            ...cleanBankAccount,
            identityKey,
          }).onConflictDoNothing({
            target: bankAccountsTable.identityKey,
          }).returning();
          detectedBankAccount = createdBankAccount ?? (await tx.select().from(bankAccountsTable).where(and(
            eq(bankAccountsTable.clientId, scopedClientId),
            eq(bankAccountsTable.identityKey, identityKey),
          )))[0] ?? null;
        }
      }
      await tx.update(statementImportsTable).set({
        bankAccountId: detectedBankAccount?.id ?? null,
      }).where(eq(statementImportsTable.id, createdImport.id));
      const preparedLines = resolvedLines.map(({ line, currencyValue, conversion }) => {
        const workspaceSuggestion = findWorkspaceSuggestion(workspacePatterns, line.description);
        const accountSuggestion = workspaceSuggestion?.accountSuggestion
          || line.accountSuggestion?.trim()
          || suggestAccount(line.description, line.direction);
        const parsedConfidence = workspaceSuggestion?.confidence ?? Number(line.confidence);
        const confidence = Number.isFinite(parsedConfidence) && parsedConfidence >= 0 && parsedConfidence <= 1
          ? parsedConfidence.toFixed(2)
          : "0.75";
        const amount = String(Math.abs(line.amount));
        return {
          clientId: scopedClientId,
          bankAccountId: detectedBankAccount?.id ?? null,
          date: line.date,
          description: line.description.trim(),
          currency: currencyValue,
          amount,
          direction: line.direction,
          status: "needs_review" as const,
          source: `Imported: ${fileName}`,
          accountSuggestion,
          confidence,
          functionalCurrency: conversion.functionalCurrency,
          functionalAmount: conversion.functionalAmount,
          exchangeRate: conversion.exchangeRate,
          exchangeRateEffectiveDate: conversion.exchangeRateEffectiveDate,
          exchangeRateStatus: conversion.exchangeRateStatus,
          importDedupeKey: importDedupeKey({
            clientId: scopedClientId,
            bankAccountId: detectedBankAccount?.id ?? null,
            date: line.date,
            description: line.description,
            amount,
            direction: line.direction,
            currency: currencyValue,
          }),
        };
      });
      const existingLines = await tx.select().from(statementLinesTable).where(eq(statementLinesTable.clientId, scopedClientId));
      const seenKeys = new Set<string>();
      const duplicateLines: Array<{
        date: string;
        description: string;
        currency: string;
        amount: number;
        direction: string;
        existingLineId: number | null;
        reason: "already_imported" | "duplicate_in_file";
      }> = [];
      const inserted: Array<typeof statementLinesTable.$inferSelect> = [];
      for (const line of preparedLines) {
        const existingLine = existingLines.find((item) =>
          item.importDedupeKey === line.importDedupeKey
          || (!item.importDedupeKey
            && importDedupeKey({
              clientId: item.clientId,
              bankAccountId: item.bankAccountId,
              date: item.date,
              description: item.description,
              amount: item.amount,
              direction: item.direction,
              currency: item.currency,
            }) === line.importDedupeKey),
        );
        if (existingLine || seenKeys.has(line.importDedupeKey)) {
          duplicateLines.push({
            date: line.date,
            description: line.description,
            currency: line.currency,
            amount: Number(line.amount),
            direction: line.direction,
            existingLineId: existingLine?.id ?? null,
            reason: existingLine ? "already_imported" : "duplicate_in_file",
          });
          continue;
        }
        seenKeys.add(line.importDedupeKey);
        const insertedLine = await createStatementLineAndJournal(tx, line, {
          ignoreExistingImportDedupeKey: true,
        });
        if (!insertedLine) {
          const racedLine = (await tx.select().from(statementLinesTable).where(and(
            eq(statementLinesTable.clientId, scopedClientId),
            eq(statementLinesTable.importDedupeKey, line.importDedupeKey),
          )))[0];
          duplicateLines.push({
            date: line.date,
            description: line.description,
            currency: line.currency,
            amount: Number(line.amount),
            direction: line.direction,
            existingLineId: racedLine?.id ?? null,
            reason: "already_imported",
          });
          continue;
        }
        inserted.push(insertedLine);
      }
      await tx.update(statementImportsTable).set({ importedLineCount: inserted.length }).where(eq(statementImportsTable.id, createdImport.id));
      return { kind: "imported" as const, importId: createdImport.id, inserted, duplicateLines, detectedBankAccount };
    });
    if (importResult.kind === "duplicate_file") {
      return res.status(200).json(ImportStatementResponse.parse({
        fileName,
        importId: importResult.duplicateImport.id,
        importStatus: "duplicate_file",
        message: "This statement was already imported for this client. No new lines were added.",
        importedCount: 0,
        duplicateCount: lines.length,
        duplicateLines: [],
        lines: [],
        bankAccount: selectedBankAccount ? bankAccountResponse(selectedBankAccount) : null,
        sourceUrl: statementSourceUrl(importResult.duplicateImport.id),
      }));
    }
    const { importId, inserted, duplicateLines, detectedBankAccount } = importResult;
    const importStatus = inserted.length === 0 ? "duplicates_found" : duplicateLines.length ? "imported_with_duplicates" : "imported";
    const message = duplicateLines.length
      ? `${inserted.length} new line${inserted.length === 1 ? "" : "s"} imported. ${duplicateLines.length} duplicate line${duplicateLines.length === 1 ? "" : "s"} skipped.`
      : `${inserted.length} statement line${inserted.length === 1 ? "" : "s"} imported and ready for review.`;
    return res.status(201).json(ImportStatementResponse.parse({
      fileName,
      importId,
      importStatus,
      message,
      sourceUrl: statementSourceUrl(importId),
      importedCount: inserted.length,
      duplicateCount: duplicateLines.length,
      duplicateLines,
      lines: inserted.map((line) => statementLineResponse(line, workspacePatterns)),
      bankAccount: detectedBankAccount ? bankAccountResponse(detectedBankAccount) : null,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Statement import failed");
    if (activeClientId !== undefined && fileHash) {
      await recordFailedStatementImport({
        clientId: activeClientId,
        bankAccountId: failedBankAccountId,
        fileName,
        mimeType,
        objectPath,
        fileSize: uploadedFileSize,
        fileHash,
        errorMessage: error instanceof Error ? error.message : "Unknown statement import error",
      });
    }
    if (aiActivityId !== undefined && !aiCompletionRecorded) {
      await db.update(aiActivityTable).set({ status: "failed" }).where(eq(aiActivityTable.id, aiActivityId));
    }
    return res.status(422).json({ error: "We could not read this statement. Try a clearer PDF, CSV, or Excel file." });
  }
});

router.get("/ledgerflow/statement-imports", async (req, res) => {
  const requestedClientId = Number(req.query.clientId);
  const client = await requireOwnedClient(req, res, requestedClientId);
  if (!client) return;
  const imports = await db.select().from(statementImportsTable)
    .where(eq(statementImportsTable.clientId, client.id))
    .orderBy(desc(statementImportsTable.createdAt));
  return res.json(imports.map((statementImport) => ({
    id: statementImport.id,
    fileName: statementImport.fileName,
    mimeType: statementImport.mimeType,
     objectPath: statementImport.objectPath,
    outcome: statementImport.outcome,
    errorMessage: statementImport.errorMessage,
    importedLineCount: statementImport.importedLineCount,
    createdAt: statementImport.createdAt.toISOString(),
    sourceUrl: statementImport.objectPath ? statementSourceUrl(statementImport.id) : null,
  })));
});

router.get("/ledgerflow/statement-imports/:id/source", async (req, res) => {
  const importId = Number(req.params.id);
  if (!Number.isInteger(importId) || importId <= 0) {
    res.status(404).json({ error: "Source document not found" });
    return;
  }
  const [statementImport] = await db.select().from(statementImportsTable)
    .where(eq(statementImportsTable.id, importId))
    .limit(1);
  if (!statementImport) {
    res.status(404).json({ error: "Source document not found" });
    return;
  }
  const client = await requireOwnedClient(req, res, statementImport.clientId);
  if (!client) return;
  if (!statementImport.objectPath || !statementObjectPathForClient(client.id, statementImport.objectPath)) {
    res.status(403).json({ error: "You do not have access to this source document." });
    return;
  }
  try {
    const objectFile = await objectStorageService.getObjectEntityFile(statementImport.objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Content-Disposition", `attachment; filename="${statementImport.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"`);
    if (response.body) Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    else res.end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Source document not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving statement source");
    res.status(500).json({ error: "Could not retrieve the source document. Try again." });
  }
});

router.post("/ledgerflow/ai-chat", async (req, res) => {
  const { clientId, message } = AskLedgerflowAIBody.parse(req.body);
  const client = await requireOwnedClient(req, res, clientId);
  if (!client) return;
  const lines = await db.select().from(statementLinesTable).where(eq(statementLinesTable.clientId, client.id));
  const entries = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.clientId, client.id));
  const bankAccounts = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.clientId, client.id));
  const workspacePatterns = await getWorkspacePatterns(currentUserId(req));
  const lineSuggestions = new Map(lines.map((line) => [line.id, lineSuggestion(line, workspacePatterns)]));
  const pendingLines = lines.filter((line) => line.status !== "posted");
  const postedLines = lines.filter((line) => line.status === "posted");
  const context = { clientName: client.name, pendingLines: pendingLines.length, postedLines: postedLines.length };
  const descriptionRecode = prepareDescriptionRecodeRecommendation(message, clientId, entries, lines);
  const asksToClassify = asksForDescriptionClassification(message);
  const asksToTransition = asksForLedgerTransition(message);
  if (asksToClassify && asksToTransition) {
    res.json(AskLedgerflowAIResponse.parse({
      answer: "Classification and ledger posting are separate steps. Confirm the classification card first, then ask me to prepare either an approval or a posting confirmation for the eligible entries.",
      context,
      recommendations: [],
    }));
    return;
  }
  if (descriptionRecode?.error) {
    res.json(AskLedgerflowAIResponse.parse({
      answer: descriptionRecode.error,
      context,
      recommendations: [],
    }));
    return;
  }
  if (descriptionRecode?.recommendation) {
    res.json(AskLedgerflowAIResponse.parse({
      answer: "I prepared this client-scoped classification for your confirmation. Nothing has changed yet; approval and posting remain separate confirmations.",
      context,
      recommendations: [descriptionRecode.recommendation],
    }));
    return;
  }
  const bulkAction = prepareBulkActionRecommendation(message, clientId, entries, lines);
  if (bulkAction?.error) {
    res.json(AskLedgerflowAIResponse.parse({
      answer: bulkAction.error,
      context,
      recommendations: [],
    }));
    return;
  }
  if (bulkAction?.recommendation) {
    res.json(AskLedgerflowAIResponse.parse({
      answer: "I prepared this client-scoped ledger transition for your review. Nothing has changed yet.",
      context,
      recommendations: [bulkAction.recommendation],
    }));
    return;
  }
  const aiConfig = await getAIProviderConfig(client.id);
  const [aiActivity] = await db.insert(aiActivityTable).values({
    clientId: client.id,
    userId: currentUserId(req),
    activityType: "copilot_chat",
    provider: aiConfig.provider,
    model: aiConfig.model,
    billingSource: aiConfig.provider === "managed_openai" ? "replit_credits" : "provider_direct",
    status: "started",
  }).returning({ id: aiActivityTable.id });
  const aiActivityId = aiActivity?.id;
  let aiCompletionRecorded = false;
  try {
    const completion = await completeAI(client.id, [
        {
          role: "system",
          content: "You are LedgerFlow's bookkeeping copilot. Return JSON only: {\"answer\":\"string\",\"recommendations\":[{\"type\":\"next_step|review_group|recode_lines|create_bank_account|bulk_approve_entries|bulk_post_entries\",\"title\":\"string\",\"summary\":\"string\",\"lineIds\":[1],\"entryIds\":[1],\"statementLineIds\":[1],\"entryCount\":1,\"lineCount\":1,\"fromStatus\":\"suggested|approved\",\"toStatus\":\"approved|posted\",\"statusTransition\":{\"from\":\"suggested|approved\",\"to\":\"approved|posted\"},\"accountSuggestion\":\"string|null\",\"confidence\":0.0,\"bankAccount\":{\"name\":\"string\",\"bankName\":\"string|null\",\"accountNumberLast4\":\"1234|null\",\"currency\":\"AED\"}|null}]}. Be concise and use only supplied context. AI never approves or posts entries without a separate explicit confirmation. Only propose bulk_approve_entries or bulk_post_entries when the user explicitly requests that single transition and the scope is unambiguous. A bulk approval may include only suggested entries; bulk posting may include only approved entries. Use the supplied entry IDs and statement-line IDs exactly; never invent IDs. You may propose grouping similar pending transactions and recoding them to a counterpart account, but only when supplied line IDs support it. For a recode_lines proposal provide at least one valid line ID and an accountSuggestion. For create_bank_account, only propose a setup card when the user asks for it and the name is clear. Never invent account numbers; use only a supplied masked last four digits. Return at most 3 recommendations.",
        },
        {
          role: "user",
          content: JSON.stringify({
            client: { name: client.name, legalName: client.legalName, basis: client.basis, functionalCurrency: client.functionalCurrency, period: client.period },
            bankAccounts: bankAccounts.map(bankAccountResponse),
             reviewQueue: pendingLines.slice(0, 50).map((line) => {
               const suggestion = lineSuggestions.get(line.id);
               return { id: line.id, date: line.date, description: line.description, currency: line.currency, amount: line.amount, direction: line.direction, status: line.status, accountSuggestion: suggestion?.accountSuggestion, suggestionSource: suggestion?.suggestionSource, supportingPatternCount: suggestion?.supportingPatternCount };
             }),
             journalEntries: entries.filter((entry) => entry.status !== "posted").slice(0, 50).map((entry) => ({ id: entry.id, statementLineId: entry.statementLineId, date: entry.date, memo: entry.memo, currency: entry.currency, amount: entry.amount, status: entry.status, debit: entry.debitAccount, credit: entry.creditAccount })),
            question: message,
          }),
        },
      ], { json: true, maxTokens: 1200 });
    if (aiActivityId !== undefined) {
      await db.update(aiActivityTable).set(completedAIActivityValues(completion)).where(eq(aiActivityTable.id, aiActivityId));
      aiCompletionRecorded = true;
    }
    const raw = JSON.parse(completion.content ?? "{}") as { answer?: unknown; recommendations?: unknown };
      const recommendations = collectAICopilotRecommendations(raw.recommendations, pendingLines, clientId);
      const learnedRecommendation = defaultAICopilotRecommendations(pendingLines, [], clientId, lineSuggestions)
        .find((recommendation) => recommendation.suggestionSource === "workspace_learning");
      if (learnedRecommendation && !recommendations.some((recommendation) => recommendation.suggestionSource === "workspace_learning")) {
        recommendations.unshift(learnedRecommendation);
      }
      const fallbackRecommendations = defaultAICopilotRecommendations(pendingLines, bankAccounts, clientId, lineSuggestions);
    const answer = safeText(raw.answer, "I can help you review this queue, group recurring transactions, propose recodes, or prepare a bank account for your confirmation.", 1200);
    res.json(AskLedgerflowAIResponse.parse({ answer, context, recommendations: recommendations.length ? recommendations : fallbackRecommendations }));
  } catch (error) {
    if (aiActivityId !== undefined && !aiCompletionRecorded) {
      await db.update(aiActivityTable).set({ status: "failed" }).where(eq(aiActivityTable.id, aiActivityId));
    }
    req.log.error({ err: error }, "AI workspace chat failed");
    if (error instanceof AIProviderError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(502).json({ error: "The AI assistant is temporarily unavailable." });
  }
});

router.get("/ledgerflow/ai-settings", async (req, res) => {
  const { clientId } = GetLedgerflowAISettingsQueryParams.parse(req.query);
  const membership = await requireClientAdmin(req, res, clientId);
  if (!membership) return;
  const client = await getOwnedClient(req, clientId);
  if (!client) return;
  try {
    const config = await getAIProviderConfig(client.id);
    const availableModels = await getAIModelCatalog();
    res.json(GetLedgerflowAISettingsResponse.parse(aiSettingsResponse(config, availableModels)));
  } catch (error) {
    if (error instanceof AIProviderError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "AI provider settings could not be loaded. Try again." });
  }
});

router.put("/ledgerflow/ai-settings", async (req, res) => {
  const body = UpdateLedgerflowAISettingsBody.parse(req.body);
  const membership = await requireClientAdmin(req, res, body.clientId);
  if (!membership) return;
  const client = await getOwnedClient(req, body.clientId);
  if (!client) return;
  const availableModels = await getAIModelCatalog();
  if (!isAIProvider(body.provider) || !isAIModel(availableModels, body.provider, body.model)) {
    return res.status(400).json({ error: "Choose a supported model for the selected AI provider." });
  }
  const current = await getAIProviderConfig(client.id);
  if (
    body.provider !== "managed_openai"
    && !body.apiKey
    && (current.provider !== body.provider || current.credentialStatus === "not_configured")
  ) {
    return res.status(400).json({ error: `Add an API key before selecting workspace-owned ${body.provider === "anthropic" ? "Anthropic" : "OpenAI"}.` });
  }
  try {
    const config = await saveAIProviderConfig(client.id, body.provider, body.model, body.apiKey);
    return res.json(UpdateLedgerflowAISettingsResponse.parse(aiSettingsResponse(config, availableModels)));
  } catch {
    return res.status(500).json({ error: "AI settings could not be saved. Try again." });
  }
});

router.post("/ledgerflow/ai-settings/test", async (req, res) => {
  const body = TestLedgerflowAISettingsBody.parse(req.body);
  const membership = await requireClientAdmin(req, res, body.clientId);
  if (!membership) return;
  const client = await getOwnedClient(req, body.clientId);
  if (!client) return;
  let aiActivityId: number | undefined;
  try {
    const aiConfig = await getAIProviderConfig(client.id);
    const [aiActivity] = await db.insert(aiActivityTable).values({
      clientId: client.id,
      userId: currentUserId(req),
      activityType: "provider_test",
      provider: aiConfig.provider,
      model: aiConfig.model,
      billingSource: aiConfig.provider === "managed_openai" ? "replit_credits" : "provider_direct",
      status: "started",
    }).returning({ id: aiActivityTable.id });
    aiActivityId = aiActivity?.id;
    const { config, completion } = await testAIProvider(client.id);
    if (aiActivityId !== undefined) {
      await db.update(aiActivityTable).set(completedAIActivityValues(completion)).where(eq(aiActivityTable.id, aiActivityId));
    }
    const availableModels = await getAIModelCatalog();
    return res.json(TestLedgerflowAISettingsResponse.parse(aiSettingsResponse(config, availableModels)));
  } catch (error) {
    if (aiActivityId !== undefined) {
      await db.update(aiActivityTable).set({ status: "failed" }).where(eq(aiActivityTable.id, aiActivityId));
    }
    if (error instanceof AIProviderError) {
      return res.status(error.status).json({ error: error.message });
    }
    return res.status(502).json({ error: "The selected AI provider could not be tested right now." });
  }
});

router.delete("/ledgerflow/ai-settings/credential", async (req, res) => {
  const body = RemoveLedgerflowAICredentialBody.parse(req.body);
  const membership = await requireClientAdmin(req, res, body.clientId);
  if (!membership) return;
  const client = await getOwnedClient(req, body.clientId);
  if (!client) return;
  try {
    const config = await removeAIProviderCredential(client.id);
    const availableModels = await getAIModelCatalog();
    res.json(RemoveLedgerflowAICredentialResponse.parse(aiSettingsResponse(config, availableModels)));
  } catch (error) {
    if (error instanceof AIProviderError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "The workspace AI credential could not be removed. Try again." });
  }
});

router.get("/ledgerflow/bank-accounts", async (req, res) => {
  const { clientId } = GetBankAccountsQueryParams.parse(req.query);
  const client = await requireOwnedClient(req, res, clientId);
  if (!client) return;
  const accounts = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.clientId, client.id)).orderBy(asc(bankAccountsTable.name));
  res.json(GetBankAccountsResponse.parse(accounts.map(bankAccountResponse)));
});

router.post("/ledgerflow/bank-accounts", async (req, res) => {
  const body = CreateBankAccountBody.parse(req.body);
  const client = await requireOwnedClient(req, res, body.clientId);
  if (!client) return;
  const account = await findOrCreateBankAccount(client.id, body, body.currency);
  if (!account) return res.status(400).json({ error: "A bank account name is required." });
  return res.status(201).json(CreateBankAccountResponse.parse(bankAccountResponse(account)));
});

router.post("/ledgerflow/ai-actions/confirm", async (req, res) => {
  const body = ConfirmAICopilotActionBody.parse(req.body);
  const client = await requireOwnedClient(req, res, body.clientId);
  if (!client) return;

  if (body.type === "bulk_approve_entries" || body.type === "bulk_post_entries") {
    const entryIds = [...new Set(body.entryIds ?? [])];
    const statementLineIds = [...new Set(body.statementLineIds ?? [])];
    if (!entryIds.length || !statementLineIds.length || entryIds.length !== statementLineIds.length) {
      return res.status(400).json({ error: "A bulk action needs matching, non-empty journal-entry and statement-line selections." });
    }

    let result: { entries: Array<typeof journalEntriesTable.$inferSelect>; expectedStatus: string; resultingStatus: string };
    try {
      result = await db.transaction(async (tx) => {
        const entries = await tx.select().from(journalEntriesTable).where(and(
          eq(journalEntriesTable.clientId, body.clientId),
          inArray(journalEntriesTable.id, entryIds),
        ));
        if (entries.length !== entryIds.length) throw new BulkActionValidationError("not_found");

        const lines = await tx.select().from(statementLinesTable).where(and(
          eq(statementLinesTable.clientId, body.clientId),
          inArray(statementLinesTable.id, statementLineIds),
        ));
        if (lines.length !== statementLineIds.length) throw new BulkActionValidationError("not_found");

        const entryLineIds = entries.map((entry) => entry.statementLineId);
        if (new Set(entryLineIds).size !== entryLineIds.length
          || entryLineIds.some((lineId) => !statementLineIds.includes(lineId))
          || statementLineIds.some((lineId) => !entryLineIds.includes(lineId))) {
          throw new BulkActionValidationError("invalid_scope");
        }

        const expectedStatus = body.type === "bulk_approve_entries" ? "suggested" : "approved";
        const resultingStatus = body.type === "bulk_approve_entries" ? "approved" : "posted";
        if (entries.some((entry) => entry.status !== expectedStatus)
          || (body.type === "bulk_post_entries" && lines.some((line) => line.status === "posted"))) {
          throw new BulkActionValidationError("invalid_status");
        }

        const updatedEntries = await tx.update(journalEntriesTable)
          .set({ status: resultingStatus })
          .where(and(
            eq(journalEntriesTable.clientId, body.clientId),
            inArray(journalEntriesTable.id, entryIds),
            eq(journalEntriesTable.status, expectedStatus),
          ))
          .returning();
        if (updatedEntries.length !== entryIds.length) throw new BulkActionValidationError("invalid_status");

        if (body.type === "bulk_post_entries") {
          const updatedLines = await tx.update(statementLinesTable)
            .set({ status: "posted" })
            .where(and(
              eq(statementLinesTable.clientId, body.clientId),
              inArray(statementLinesTable.id, statementLineIds),
            ))
            .returning();
          if (updatedLines.length !== statementLineIds.length) throw new BulkActionValidationError("invalid_scope");
        }

        await tx.insert(bulkTransitionAuditsTable).values({
          clientId: body.clientId,
          actorUserId: currentUserId(req),
          actorName: displayName(req.dbUser!),
          actorEmail: req.dbUser!.email,
          transition: body.type,
          fromStatus: expectedStatus,
          toStatus: resultingStatus,
          entryIds,
          statementLineIds,
        });

        return { entries: updatedEntries, expectedStatus, resultingStatus };
      });
    } catch (error) {
      if (error instanceof BulkActionValidationError) {
        if (error.kind === "not_found") {
          return res.status(404).json({ error: "One or more selected journal entries or statement lines are not available in this client." });
        }
        if (error.kind === "invalid_scope") {
          return res.status(400).json({ error: "The selected journal entries and statement lines do not describe one matching client-scoped selection." });
        }
        const statusMessage = body.type === "bulk_approve_entries"
          ? "Only suggested entries can be bulk approved. Posted or already approved entries were rejected."
          : "Only approved entries can be bulk posted. Suggested or posted entries were rejected.";
        return res.status(409).json({ error: statusMessage });
      }
      throw error;
    }

    return res.json(ConfirmAICopilotActionResponse.parse({
      type: body.type,
      clientId: body.clientId,
      entryIds,
      statementLineIds,
      entryCount: result.entries.length,
      lineCount: statementLineIds.length,
      fromStatus: result.expectedStatus,
      toStatus: result.resultingStatus,
      entries: result.entries.map(journalEntryResponse),
      updatedLineCount: statementLineIds.length,
      bankAccount: null,
    }));
  }
  if (body.type === "create_bank_account") {
    const bankAccount = await findOrCreateBankAccount(client.id, body.bankAccount ?? undefined, body.bankAccount?.currency ?? "AED");
    if (!bankAccount) return res.status(400).json({ error: "The bank account proposal needs a name and currency." });
    return res.json(ConfirmAICopilotActionResponse.parse({
      type: body.type,
      updatedLineCount: 0,
      bankAccount: bankAccountResponse(bankAccount),
    }));
  }

  const lineIds = [...new Set(body.lineIds ?? [])];
  const accountSuggestion = body.accountSuggestion?.trim();
  if (!lineIds.length || !accountSuggestion) {
    return res.status(400).json({ error: "Select at least one line and a proposed account before confirming a recode." });
  }
  if (!classificationAccounts.has(accountSuggestion)) {
    return res.status(400).json({ error: "Choose one of LedgerFlow's supported accounts before confirming a classification." });
  }
  const confidence = Number.isFinite(Number(body.confidence)) && Number(body.confidence) >= 0 && Number(body.confidence) <= 1
    ? Number(body.confidence).toFixed(2)
    : "0.75";
  let selectedLines: Array<typeof statementLinesTable.$inferSelect>;
  try {
    selectedLines = await db.transaction(async (tx) => {
      const lockedLines = await tx.select().from(statementLinesTable).where(and(
        eq(statementLinesTable.clientId, client.id),
        inArray(statementLinesTable.id, lineIds),
      )).for("update");
      if (lockedLines.length !== lineIds.length) {
        throw new RecodeConflictError("One or more selected statement lines are not available in this client.");
      }
      if (lockedLines.some((line) => line.status === "posted")) {
        throw new RecodeConflictError("Posted statement lines cannot be recoded through the AI assistant.");
      }

      const lockedEntries = await tx.select().from(journalEntriesTable).where(and(
        eq(journalEntriesTable.clientId, client.id),
        inArray(journalEntriesTable.statementLineId, lineIds),
      )).for("update");
      const entryLineIds = new Set(lockedEntries.map((entry) => entry.statementLineId));
      if (
        lockedEntries.length !== lockedLines.length
        || entryLineIds.size !== lockedLines.length
        || lockedEntries.some((entry) => entry.status !== "suggested")
      ) {
        throw new RecodeConflictError("Only still-suggested journal entries can be recoded. Review approved entries individually.");
      }

      for (const line of lockedLines) {
        const [updatedEntry] = await tx.update(journalEntriesTable).set({
          confidence,
          ...journalAccountsForSuggestion(line.direction, accountSuggestion),
        }).where(and(
          eq(journalEntriesTable.clientId, client.id),
          eq(journalEntriesTable.statementLineId, line.id),
          eq(journalEntriesTable.status, "suggested"),
        )).returning({ id: journalEntriesTable.id });
        if (!updatedEntry) throw new RecodeConflictError("A selected journal entry changed while its classification was being confirmed.");
      }

      const updatedLines = await tx.update(statementLinesTable).set({ accountSuggestion, confidence }).where(and(
        eq(statementLinesTable.clientId, client.id),
        inArray(statementLinesTable.id, lineIds),
        ne(statementLinesTable.status, "posted"),
      )).returning({ id: statementLinesTable.id });
      if (updatedLines.length !== lockedLines.length) {
        throw new RecodeConflictError("A selected statement line changed while its classification was being confirmed.");
      }

      for (const line of lockedLines) {
        await recordClassificationPattern(currentUserId(req), line.description, accountSuggestion, confidence, tx);
      }
      return lockedLines;
    }
    );
  } catch (error) {
    if (error instanceof RecodeConflictError) {
      return res.status(409).json({ error: error.message });
    }
    throw error;
  }
  return res.json(ConfirmAICopilotActionResponse.parse({
    type: body.type,
    updatedLineCount: selectedLines.length,
    bankAccount: null,
  }));
});

router.get("/ledgerflow/usage", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const clientIds = await getUserClientIds(userId);
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const aiRetentionStart = new Date(now.getTime() - RETENTION_POLICY.aiActivityDays * 24 * 60 * 60 * 1000);
  await purgeExpiredWorkspaceEvidence(clientIds);
  if (clientIds.length) {
    await db.delete(aiActivityTable).where(and(
      inArray(aiActivityTable.clientId, clientIds),
      lte(aiActivityTable.createdAt, aiRetentionStart),
    ));
  }
  const [imports, aiActivity, workspaceClients] = clientIds.length
    ? await Promise.all([
      db.select({
        outcome: statementImportsTable.outcome,
        fileSize: statementImportsTable.fileSize,
        objectPath: statementImportsTable.objectPath,
        evidenceExpiresAt: statementImportsTable.evidenceExpiresAt,
        createdAt: statementImportsTable.createdAt,
      }).from(statementImportsTable).where(inArray(statementImportsTable.clientId, clientIds)),
      db.select({
        clientId: aiActivityTable.clientId,
        clientName: clientsTable.name,
        createdAt: aiActivityTable.createdAt,
        status: aiActivityTable.status,
        provider: aiActivityTable.provider,
        model: aiActivityTable.model,
        inputTokens: aiActivityTable.inputTokens,
        outputTokens: aiActivityTable.outputTokens,
        estimatedCostUsd: aiActivityTable.estimatedCostUsd,
        billingSource: aiActivityTable.billingSource,
      }).from(aiActivityTable)
        .innerJoin(clientsTable, eq(clientsTable.id, aiActivityTable.clientId))
        .where(inArray(aiActivityTable.clientId, clientIds)),
      db.select({
        id: clientsTable.id,
        name: clientsTable.name,
      }).from(clientsTable).where(inArray(clientsTable.id, clientIds)),
    ])
    : [[], [], []];
  const completedImports = imports.filter((item) => item.outcome === "completed");
  const retainedEvidence = completedImports.filter((item) => item.objectPath && item.evidenceExpiresAt && item.evidenceExpiresAt > now);
  const importsThisPeriod = completedImports.filter((item) => item.createdAt >= periodStart).length;
  const aiActivityThisPeriod = aiActivity.filter((item) => item.status === "completed" && item.createdAt >= periodStart).length;
  const completedAICostActivity = aiActivity
    .filter((item) => item.status === "completed" && item.createdAt >= periodStart)
    .map((item) => ({
      clientId: item.clientId,
      clientName: item.clientName,
      provider: item.provider,
      model: item.model,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      estimatedCostUsd: item.estimatedCostUsd,
      billingSource: item.billingSource,
    }));
  const clientAiCosts = workspaceClients
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((client) => ({
      clientId: client.id,
      clientName: client.name,
      usage: aiCostSummary(completedAICostActivity.filter((activity) => activity.clientId === client.id)),
    }));
  const evidenceBytes = retainedEvidence.reduce((total, item) => total + (item.fileSize ?? 0), 0);
  const evidenceMetric = usageMetric(evidenceBytes, USAGE_PLAN.storedEvidenceBytes);

  res.json(GetLedgerflowUsageResponse.parse({
    plan: USAGE_PLAN.name,
    asOf: now.toISOString(),
    billingPeriod: {
      label: now.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
      startsAt: periodStart.toISOString(),
    },
    statementImports: usageMetric(importsThisPeriod, USAGE_PLAN.statementImportsPerMonth),
    storedEvidence: {
      documents: retainedEvidence.length,
      bytes: evidenceBytes,
      limitBytes: USAGE_PLAN.storedEvidenceBytes,
      percentage: evidenceMetric.percentage,
      status: evidenceMetric.status,
    },
    aiActivity: usageMetric(aiActivityThisPeriod, USAGE_PLAN.aiActivityPerMonth),
    aiCost: aiCostSummary(completedAICostActivity),
    clientAiCosts,
    clientWorkspaces: usageMetric(clientIds.length, USAGE_PLAN.clientWorkspaces),
    retention: RETENTION_POLICY,
  }));
});

router.get("/clients", async (req, res) => {
  const clientIds = await getUserClientIds(currentUserId(req));
  const clients = clientIds.length
    ? await db.select().from(clientsTable).where(inArray(clientsTable.id, clientIds)).orderBy(asc(clientsTable.name))
    : [];
  const userId = currentUserId(req);
  const [user] = await db.select({ remediatedLegacyClientId: usersTable.remediatedLegacyClientId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  const legacyDemoClientIds = new Set(
    user?.remediatedLegacyClientId != null ? [user.remediatedLegacyClientId] : [],
  );
  res.json(clients.map((client) => {
    const legacyDemo = legacyDemoClientIds.has(client.id);
    return clientResponse(client, legacyDemo, legacyDemo ? "legacy_demo" : undefined);
  }));
});

router.patch("/ledgerflow/account-profile", async (req, res): Promise<void> => {
  const parsed = UpdateLedgerflowAccountProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your first and last name to continue." });
    return;
  }
  const firstName = parsed.data.firstName.trim();
  const lastName = parsed.data.lastName.trim();
  if (!firstName || !lastName) {
    res.status(400).json({ error: "Enter your first and last name to continue." });
    return;
  }
  const [user] = await db.update(usersTable)
    .set({ firstName, lastName })
    .where(eq(usersTable.id, currentUserId(req)))
    .returning();
  if (!user) {
    res.status(404).json({ error: "Account profile not found." });
    return;
  }
  req.dbUser = user;
  res.json(UpdateLedgerflowAccountProfileResponse.parse({
    email: user.email,
    firstName: user.firstName ?? firstName,
    lastName: user.lastName ?? lastName,
  }));
});

router.post("/clients", async (req, res) => {
  const admin = await requireWorkspaceAdmin(req, res);
  if (!admin) return;
  const body = req.body as {
    name?: string;
    legalName?: string;
    functionalCurrency?: string;
    basis?: string;
    period?: string;
  };
  if (!body.name || !body.legalName) return res.status(400).json({ error: "Client name and legal name are required" });
  const { name, legalName } = body;
  const client = await db.transaction(async (tx) => {
    const [created] = await tx.insert(clientsTable)
      .values({
        name,
        legalName,
        functionalCurrency: body.functionalCurrency || "AED",
        basis: body.basis || "IFRS",
        period: body.period || "August 2026",
      })
      .returning();
    await tx.insert(clientWorkspacesTable).values({ clientId: created.id, userId: currentUserId(req), role: "admin" });
    return created;
  });
  return res.status(201).json(clientResponse(client));
});

router.patch("/clients/:id", async (req, res) => {
  const { id } = UpdateClientParams.parse(req.params);
  const membership = await requireClientAdmin(req, res, id);
  if (!membership) return;
  const parsed = UpdateClientBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Complete the client identity and reporting settings before saving." });
  }
  const body = {
    name: parsed.data.name.trim(),
    legalName: parsed.data.legalName.trim(),
    functionalCurrency: parsed.data.functionalCurrency.trim(),
    basis: parsed.data.basis.trim(),
    period: parsed.data.period.trim(),
  };
  if (Object.values(body).some((value) => !value)) {
    return res.status(400).json({ error: "Complete the client identity and reporting settings before saving." });
  }
  const [client] = await db.update(clientsTable)
    .set(body)
    .where(eq(clientsTable.id, id))
    .returning();
  if (!client) {
    return res.status(404).json({ error: "Client workspace not found" });
  }
  return res.json(UpdateClientResponse.parse(clientResponse(client)));
});

router.get("/workspace/members", async (req, res) => {
  const actorUserId = currentUserId(req);
  const currentRole = await getWorkspaceRole(actorUserId);
  const clientIds = currentRole === "admin"
    ? await getManageableWorkspaceClientIds(actorUserId)
    : await getWorkspaceClientIds(actorUserId);
  if (!currentRole || !clientIds.length) {
    res.status(403).json({ error: "You do not have access to a workspace." });
    return;
  }
  const clients = await db.select().from(clientsTable).where(inArray(clientsTable.id, clientIds)).orderBy(asc(clientsTable.name));
  if (currentRole !== "admin") {
    const currentMember = await workspaceMemberResponse(actorUserId, clientIds, actorUserId);
    res.json(GetWorkspaceMembersResponse.parse({
      currentRole,
      canManage: false,
      clients: clients.map(clientSummary),
      members: [currentMember],
      invitations: [],
    }));
    return;
  }

  await db.update(workspaceInvitationsTable)
    .set({ status: "expired" })
    .where(and(eq(workspaceInvitationsTable.status, "pending"), lte(workspaceInvitationsTable.expiresAt, new Date())));

  const memberships = await db.select({ userId: clientWorkspacesTable.userId })
    .from(clientWorkspacesTable)
    .where(inArray(clientWorkspacesTable.clientId, clientIds));
  const memberIds = [...new Set(memberships.map((membership) => membership.userId))];
  const members = await Promise.all(memberIds.map((userId) => workspaceMemberResponse(userId, clientIds, actorUserId)));
  const invitations = (await db.select().from(workspaceInvitationsTable))
    .filter((invitation) => invitation.clientIds.every((clientId) => clientIds.includes(clientId)));
  const inviterIds = [...new Set(invitations.map((invitation) => invitation.invitedByUserId))];
  const inviters = inviterIds.length
    ? await db.select().from(usersTable).where(inArray(usersTable.id, inviterIds))
    : [];
  const inviterNames = new Map(inviters.map((user) => [user.id, displayName(user)]));
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  res.json(GetWorkspaceMembersResponse.parse({
    currentRole,
    canManage: true,
    clients: clients.map(clientSummary),
    members,
    invitations: invitations.map((invitation) => invitationResponse(
      invitation,
      clientsById,
      inviterNames.get(invitation.invitedByUserId) ?? "Workspace admin",
    )),
  }));
});

router.post("/workspace/invitations", async (req, res) => {
  const admin = await requireWorkspaceAdmin(req, res);
  if (!admin) return;
  const body = CreateWorkspaceInvitationBody.parse(req.body);
  const actorUserId = currentUserId(req);
  const clientIds = await getManageableWorkspaceClientIds(actorUserId);
  const selectedClientIds = [...new Set(body.clientIds)];
  if (!selectedClientIds.every((clientId) => clientIds.includes(clientId))) {
    res.status(400).json({ error: "Client access must be limited to workspaces you can manage." });
    return;
  }
  const email = body.email.trim().toLowerCase();
  const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existingUser) {
    const [existingMembership] = await db.select({ userId: clientWorkspacesTable.userId })
      .from(clientWorkspacesTable)
      .where(and(eq(clientWorkspacesTable.userId, existingUser.id), inArray(clientWorkspacesTable.clientId, selectedClientIds)))
      .limit(1);
    if (existingMembership) {
      res.status(409).json({ error: "This teammate already has access. Update their role or client access instead." });
      return;
    }
  }
  const pendingInvitations = await db.select().from(workspaceInvitationsTable)
    .where(and(eq(workspaceInvitationsTable.email, email), eq(workspaceInvitationsTable.status, "pending")));
  if (pendingInvitations.some((invitation) => invitation.clientIds.some((clientId) => clientIds.includes(clientId)))) {
    res.status(409).json({ error: "This teammate already has a pending invitation. Revoke it before sending a new one." });
    return;
  }
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [invitation] = await db.insert(workspaceInvitationsTable).values({
    email,
    role: body.role,
    clientIds: selectedClientIds,
    invitedByUserId: actorUserId,
    tokenHash,
    expiresAt: new Date(Date.now() + WORKSPACE_INVITATION_TTL_MS),
  }).returning();
  const clients = await db.select().from(clientsTable).where(inArray(clientsTable.id, selectedClientIds));
  const [actor] = await db.select().from(usersTable).where(eq(usersTable.id, actorUserId)).limit(1);
  const inviteLink = invitationLink(req, token);
  res.status(201).json(CreateWorkspaceInvitationResponse.parse(invitationResponse(
    invitation,
    new Map(clients.map((client) => [client.id, client])),
    actor ? displayName(actor) : "Workspace admin",
    inviteLink,
  )));
});

router.post("/workspace/invitations/:id/resend", async (req, res) => {
  const admin = await requireWorkspaceAdmin(req, res);
  if (!admin) return;
  const { id } = ResendWorkspaceInvitationParams.parse(req.params);
  const clientIds = await getManageableWorkspaceClientIds(currentUserId(req));
  const [invitation] = await db.select().from(workspaceInvitationsTable)
    .where(eq(workspaceInvitationsTable.id, id))
    .limit(1);
  if (!invitation || !invitation.clientIds.every((clientId) => clientIds.includes(clientId))) {
    res.status(404).json({ error: "Workspace invitation not found." });
    return;
  }
  if (invitation.status !== "pending") {
    res.status(409).json({ error: "Only pending invitations can be resent." });
    return;
  }
  const resent = await invitationEmailResponse(req, invitation);
  if (!resent) {
    res.status(409).json({ error: "This invitation is no longer pending." });
    return;
  }
  res.json(ResendWorkspaceInvitationResponse.parse(resent));
});

router.patch("/workspace/members/:userId", async (req, res) => {
  const admin = await requireWorkspaceAdmin(req, res);
  if (!admin) return;
  const { userId } = UpdateWorkspaceMemberParams.parse(req.params);
  const body = UpdateWorkspaceMemberBody.parse(req.body);
  const actorUserId = currentUserId(req);
  if (userId === actorUserId) {
    res.status(400).json({ error: "Use another workspace admin to change your own access." });
    return;
  }
  const workspaceClientIds = await getManageableWorkspaceClientIds(actorUserId);
  const selectedClientIds = [...new Set(body.clientIds)];
  if (!selectedClientIds.every((clientId) => workspaceClientIds.includes(clientId))) {
    res.status(400).json({ error: "Client access must be limited to workspaces you can manage." });
    return;
  }
  const targetMemberships = await db.select()
    .from(clientWorkspacesTable)
    .where(and(eq(clientWorkspacesTable.userId, userId), inArray(clientWorkspacesTable.clientId, workspaceClientIds)));
  if (!targetMemberships.length) {
    res.status(404).json({ error: "Workspace member not found." });
    return;
  }
  const adminMembershipsRemoved = targetMemberships.filter((membership) =>
    membership.role === "admin" && (body.role !== "admin" || !selectedClientIds.includes(membership.clientId)),
  );
  const updated = await db.transaction(async (tx) => {
    if (!await preserveClientAdminCoverage(tx, userId, adminMembershipsRemoved.map((membership) => membership.clientId))) {
      return false;
    }
    await tx.delete(clientWorkspacesTable).where(and(
      eq(clientWorkspacesTable.userId, userId),
      inArray(clientWorkspacesTable.clientId, workspaceClientIds),
    ));
    await tx.insert(clientWorkspacesTable).values(selectedClientIds.map((clientId) => ({
      clientId,
      userId,
      role: body.role,
    })));
    return true;
  });
  if (!updated) {
    res.status(400).json({ error: "Keep at least one admin for each affected client workspace." });
    return;
  }
  res.json(UpdateWorkspaceMemberResponse.parse(await workspaceMemberResponse(userId, workspaceClientIds, actorUserId)));
});

router.delete("/workspace/members/:userId", async (req, res) => {
  const admin = await requireWorkspaceAdmin(req, res);
  if (!admin) return;
  const { userId } = RemoveWorkspaceMemberParams.parse(req.params);
  const actorUserId = currentUserId(req);
  if (userId === actorUserId) {
    res.status(400).json({ error: "You cannot remove yourself from the workspace." });
    return;
  }
  const workspaceClientIds = await getManageableWorkspaceClientIds(actorUserId);
  const targetMemberships = await db.select()
    .from(clientWorkspacesTable)
    .where(and(eq(clientWorkspacesTable.userId, userId), inArray(clientWorkspacesTable.clientId, workspaceClientIds)));
  if (!targetMemberships.length) {
    res.status(404).json({ error: "Workspace member not found." });
    return;
  }
  const removed = await db.transaction(async (tx) => {
    const adminMemberships = targetMemberships.filter((membership) => membership.role === "admin");
    if (!await preserveClientAdminCoverage(tx, userId, adminMemberships.map((membership) => membership.clientId))) {
      return false;
    }
    await tx.delete(clientWorkspacesTable).where(and(
      eq(clientWorkspacesTable.userId, userId),
      inArray(clientWorkspacesTable.clientId, workspaceClientIds),
    ));
    return true;
  });
  if (!removed) {
    res.status(400).json({ error: "Keep at least one admin for each affected client workspace." });
    return;
  }
  res.sendStatus(204);
});

router.delete("/workspace/invitations/:id", async (req, res) => {
  const admin = await requireWorkspaceAdmin(req, res);
  if (!admin) return;
  const { id } = RevokeWorkspaceInvitationParams.parse(req.params);
  const clientIds = await getManageableWorkspaceClientIds(currentUserId(req));
  const [invitation] = await db.select().from(workspaceInvitationsTable).where(eq(workspaceInvitationsTable.id, id)).limit(1);
  if (!invitation || !invitation.clientIds.every((clientId) => clientIds.includes(clientId))) {
    res.status(404).json({ error: "Workspace invitation not found." });
    return;
  }
  const [revoked] = await db.update(workspaceInvitationsTable)
    .set({ status: "revoked" })
    .where(and(eq(workspaceInvitationsTable.id, id), eq(workspaceInvitationsTable.status, "pending")))
    .returning({ id: workspaceInvitationsTable.id });
  if (!revoked) {
    res.status(409).json({ error: "Only pending invitations can be revoked." });
    return;
  }
  res.sendStatus(204);
});

router.post("/workspace/invitations/:token/accept", async (req, res) => {
  const { token } = AcceptWorkspaceInvitationParams.parse(req.params);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [invitation] = await db.select().from(workspaceInvitationsTable)
    .where(eq(workspaceInvitationsTable.tokenHash, tokenHash))
    .limit(1);
  if (!invitation || invitation.status !== "pending") {
    res.status(404).json({ error: "This invitation is no longer available." });
    return;
  }
  if (invitation.expiresAt <= new Date()) {
    await db.update(workspaceInvitationsTable).set({ status: "expired" }).where(eq(workspaceInvitationsTable.id, invitation.id));
    res.status(410).json({ error: "This invitation has expired. Ask a workspace admin for a new one." });
    return;
  }
  const userId = currentUserId(req);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user?.email || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    res.status(403).json({ error: "Sign in with the email address that received this invitation." });
    return;
  }
  const clients = await db.select({ id: clientsTable.id })
    .from(clientsTable)
    .where(inArray(clientsTable.id, invitation.clientIds));
  if (clients.length !== invitation.clientIds.length) {
    res.status(409).json({ error: "One or more invited client workspaces are no longer available." });
    return;
  }
  const accepted = await db.transaction(async (tx) => {
    const [claimedInvitation] = await tx.update(workspaceInvitationsTable)
      .set({ status: "accepted", acceptedUserId: userId })
      .where(and(
        eq(workspaceInvitationsTable.id, invitation.id),
        eq(workspaceInvitationsTable.status, "pending"),
        gt(workspaceInvitationsTable.expiresAt, new Date()),
      ))
      .returning({ id: workspaceInvitationsTable.id });
    if (!claimedInvitation) return false;
    await tx.insert(clientWorkspacesTable).values(invitation.clientIds.map((clientId) => ({
      clientId,
      userId,
      role: invitation.role,
    }))).onConflictDoUpdate({
      target: [clientWorkspacesTable.clientId, clientWorkspacesTable.userId],
      set: { role: invitation.role },
    });
    await tx.update(usersTable).set({ starterClientId: invitation.clientIds[0] }).where(eq(usersTable.id, userId));
    return true;
  });
  if (!accepted) {
    res.status(409).json({ error: "This invitation was revoked or has expired." });
    return;
  }
  res.json(AcceptWorkspaceInvitationResponse.parse(
    await workspaceMemberResponse(userId, invitation.clientIds, userId),
  ));
});

router.get("/ledgerflow/exchange-rates", async (req, res) => {
  const rates = await db.select().from(exchangeRatesTable).where(eq(
    exchangeRatesTable.userId,
    currentUserId(req),
  )).orderBy(desc(exchangeRatesTable.effectiveDate), asc(exchangeRatesTable.sourceCurrency), asc(exchangeRatesTable.functionalCurrency));
  res.json(GetExchangeRatesResponse.parse(rates.map(exchangeRateResponse)));
});

router.get("/ledgerflow/bulk-transition-audits", async (req, res) => {
  const parsed = GetBulkTransitionAuditsQueryParams.parse(req.query);
  const client = await requireOwnedClient(req, res, parsed.clientId);
  if (!client) return;
  const audits = await db.select().from(bulkTransitionAuditsTable).where(eq(
    bulkTransitionAuditsTable.clientId,
    client.id,
  )).orderBy(desc(bulkTransitionAuditsTable.confirmedAt));
  res.json(GetBulkTransitionAuditsResponse.parse(audits.map((audit) => ({
    id: audit.id,
    clientId: audit.clientId,
    actor: {
      id: audit.actorUserId,
      name: audit.actorName ?? "Team member",
      email: audit.actorEmail,
    },
    transition: audit.transition,
    fromStatus: audit.fromStatus,
    toStatus: audit.toStatus,
    entryIds: audit.entryIds,
    statementLineIds: audit.statementLineIds,
    confirmedAt: audit.confirmedAt,
  }))));
});

router.post("/ledgerflow/exchange-rates", async (req, res) => {
  const admin = await requireWorkspaceAdmin(req, res);
  if (!admin) return;
  const parsed = CreateExchangeRateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A valid dated exchange rate is required." });
  let body: ReturnType<typeof normalizeRateInput>;
  try {
    body = normalizeRateInput(parsed.data);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid exchange rate." });
  }
  try {
    const [rate] = await db.insert(exchangeRatesTable).values({ ...body, userId: currentUserId(req) }).returning();
    await refreshWorkspaceRateConversions(currentUserId(req));
    return res.status(201).json(CreateExchangeRateResponse.parse(exchangeRateResponse(rate)));
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return res.status(409).json({ error: "A rate already exists for this currency pair and effective date." });
    }
    throw error;
  }
});

router.patch("/ledgerflow/exchange-rates/:id", async (req, res) => {
  const admin = await requireWorkspaceAdmin(req, res);
  if (!admin) return;
  const params = UpdateExchangeRateParams.safeParse(req.params);
  const parsed = UpdateExchangeRateBody.safeParse(req.body);
  if (!params.success || !parsed.success) return res.status(400).json({ error: "A valid dated exchange rate is required." });
  let body: ReturnType<typeof normalizeRateInput>;
  try {
    body = normalizeRateInput(parsed.data);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid exchange rate." });
  }
  try {
    const [rate] = await db.update(exchangeRatesTable).set(body).where(and(
      eq(exchangeRatesTable.id, params.data.id),
      eq(exchangeRatesTable.userId, currentUserId(req)),
    )).returning();
    if (!rate) return res.status(404).json({ error: "Exchange rate not found in this workspace." });
    await refreshWorkspaceRateConversions(currentUserId(req));
    return res.json(UpdateExchangeRateResponse.parse(exchangeRateResponse(rate)));
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return res.status(409).json({ error: "A rate already exists for this currency pair and effective date." });
    }
    throw error;
  }
});

router.delete("/ledgerflow/exchange-rates/:id", async (req, res) => {
  const admin = await requireWorkspaceAdmin(req, res);
  if (!admin) return;
  const params = DeleteExchangeRateParams.safeParse(req.params);
  if (!params.success) return res.status(400).json({ error: "Invalid exchange rate." });
  const [deleted] = await db.delete(exchangeRatesTable).where(and(
    eq(exchangeRatesTable.id, params.data.id),
    eq(exchangeRatesTable.userId, currentUserId(req)),
  )).returning({ id: exchangeRatesTable.id });
  if (!deleted) return res.status(404).json({ error: "Exchange rate not found in this workspace." });
  await refreshWorkspaceRateConversions(currentUserId(req));
  return res.status(204).send();
});

router.post("/ledgerflow/exchange-rates/import", async (req, res) => {
  const admin = await requireWorkspaceAdmin(req, res);
  if (!admin) return;
  const parsed = ImportExchangeRatesBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "At least one valid exchange rate is required." });
  let rates: Array<ReturnType<typeof normalizeRateInput>>;
  try {
    rates = parsed.data.rates.map(normalizeRateInput);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid exchange rate." });
  }
  const uniqueKeys = new Set<string>();
  if (rates.some((rate) => {
    const key = `${rate.sourceCurrency}|${rate.functionalCurrency}|${rate.effectiveDate}`;
    if (uniqueKeys.has(key)) return true;
    uniqueKeys.add(key);
    return false;
  })) return res.status(400).json({ error: "Each imported currency pair and effective date must appear once." });

  const result = await db.transaction(async (tx) => {
    const returned: Array<typeof exchangeRatesTable.$inferSelect> = [];
    let importedCount = 0;
    let updatedCount = 0;
    for (const rate of rates) {
      const [existing] = await tx.select().from(exchangeRatesTable).where(and(
        eq(exchangeRatesTable.userId, currentUserId(req)),
        eq(exchangeRatesTable.sourceCurrency, rate.sourceCurrency),
        eq(exchangeRatesTable.functionalCurrency, rate.functionalCurrency),
        eq(exchangeRatesTable.effectiveDate, rate.effectiveDate),
      ));
      if (existing) {
        const [updated] = await tx.update(exchangeRatesTable).set(rate).where(eq(exchangeRatesTable.id, existing.id)).returning();
        returned.push(updated);
        updatedCount += 1;
      } else {
        const [created] = await tx.insert(exchangeRatesTable).values({ ...rate, userId: currentUserId(req) }).returning();
        returned.push(created);
        importedCount += 1;
      }
    }
    return { importedCount, updatedCount, rates: returned };
  });
  await refreshWorkspaceRateConversions(currentUserId(req));
  return res.json(ImportExchangeRatesResponse.parse({
    ...result,
    rates: result.rates.map(exchangeRateResponse),
  }));
});

router.get("/ledgerflow/overview", async (req, res) => {
  const requestedClientId = req.query.clientId === undefined ? undefined : Number(req.query.clientId);
  const client = await requireOwnedClient(req, res, requestedClientId);
  if (!client) return;
  const lines = await db.select().from(statementLinesTable).where(eq(statementLinesTable.clientId, client.id));
  const pendingReview = lines.filter((line) => line.status !== "posted").length;
  const postedLines = lines.filter((line) => line.status === "posted");
  const missingRateLines = postedLines.filter((line) =>
    normalizeCurrency(line.currency) !== normalizeCurrency(client.functionalCurrency)
    && line.functionalAmount == null,
  );
  const postedAmountFunctional = postedLines.reduce((sum, line) => {
    if (normalizeCurrency(line.currency) === normalizeCurrency(client.functionalCurrency)) return sum + number(line.amount);
    return sum + (line.functionalAmount == null ? 0 : number(line.functionalAmount));
  }, 0);
  const data = GetLedgerOverviewResponse.parse({
    period: client.period,
    currencies: [...new Set(lines.map((line) => line.currency))],
    totalLines: lines.length,
    pendingReview,
    postedAmount: postedAmountFunctional,
    completionPercent: Math.round(((lines.length - pendingReview) / Math.max(lines.length, 1)) * 100),
    functionalCurrency: normalizeCurrency(client.functionalCurrency),
    postedAmountFunctional,
    missingRateCount: missingRateLines.length,
    missingRateCurrencies: [...new Set(missingRateLines.map((line) => line.currency))],
  });
  res.json(data);
});

router.get("/ledgerflow/statement-lines", async (req, res) => {
  const parsed = GetStatementLinesQueryParams.parse(req.query);
  const client = await requireOwnedClient(req, res, parsed.clientId);
  if (!client) return;
  const workspacePatterns = await getWorkspacePatterns(currentUserId(req));
  const lines = await db.select().from(statementLinesTable).where(and(
    eq(statementLinesTable.clientId, client.id),
    parsed.currency ? eq(statementLinesTable.currency, parsed.currency) : undefined,
    parsed.status ? eq(statementLinesTable.status, parsed.status) : undefined,
  )).orderBy(asc(statementLinesTable.date));
  res.json(GetStatementLinesResponse.parse(lines.map((line) => statementLineResponse(line, workspacePatterns))));
});

router.post("/ledgerflow/statement-lines", async (req, res) => {
  const body = CreateStatementLineBody.parse(req.body);
  const client = await requireOwnedClient(req, res, body.clientId);
  if (!client) return;
  if (body.bankAccountId != null) {
    const [bankAccount] = await db.select({ id: bankAccountsTable.id })
      .from(bankAccountsTable)
      .where(and(
        eq(bankAccountsTable.id, body.bankAccountId),
        eq(bankAccountsTable.clientId, client.id),
      ))
      .limit(1);
    if (!bankAccount) return res.status(400).json({ error: "Selected bank account was not found for this client." });
  }
  const workspacePatterns = await getWorkspacePatterns(currentUserId(req));
  const workspaceSuggestion = findWorkspaceSuggestion(workspacePatterns, body.description);
  const conversion = await resolveExchangeRate(
    currentUserId(req),
    body.currency,
    normalizeCurrency(client.functionalCurrency),
    body.date,
    body.amount,
  );
  const line = await db.transaction((tx) => createStatementLineAndJournal(tx, {
    ...body,
    clientId: client.id,
    amount: String(body.amount),
    status: "needs_review",
    source: "Manual entry",
    accountSuggestion: workspaceSuggestion?.accountSuggestion || suggestAccount(body.description, body.direction),
    confidence: (workspaceSuggestion?.confidence ?? 0.75).toFixed(2),
    functionalCurrency: conversion.functionalCurrency,
    functionalAmount: conversion.functionalAmount,
    exchangeRate: conversion.exchangeRate,
    exchangeRateEffectiveDate: conversion.exchangeRateEffectiveDate,
    exchangeRateStatus: conversion.exchangeRateStatus,
  }));
  if (!line) throw new Error("Manual statement line was not created.");
  return res.status(201).json(CreateStatementLineResponse.parse(statementLineResponse(line, workspacePatterns)));
});

router.get("/ledgerflow/journal-entries", async (req, res) => {
  const requestedClientId = req.query.clientId === undefined ? undefined : Number(req.query.clientId);
  const client = await requireOwnedClient(req, res, requestedClientId);
  if (!client) return;
  const entries = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.clientId, client.id)).orderBy(asc(journalEntriesTable.date));
  res.json(GetJournalEntriesResponse.parse(entries.map(journalEntryResponse)));
});

router.post("/ledgerflow/journal-entries/:id/approve", async (req, res) => {
  const { id } = ApproveJournalEntryParams.parse({ id: Number(req.params.id) });
  const { clientId } = ApproveJournalEntryBody.parse(req.body);
  const client = await requireOwnedClient(req, res, clientId);
  if (!client) return;

  const [entry] = await db.update(journalEntriesTable).set({ status: "approved" }).where(and(
    eq(journalEntriesTable.id, id),
    eq(journalEntriesTable.clientId, client.id),
    eq(journalEntriesTable.status, "suggested"),
  )).returning();
  if (!entry) {
    res.status(409).json({ error: "This journal entry is not available for approval for this client" });
    return;
  }
  const [line] = await db.select().from(statementLinesTable).where(and(
    eq(statementLinesTable.id, entry.statementLineId),
    eq(statementLinesTable.clientId, client.id),
  ));
  if (line) {
    const accountSuggestion = line.direction === "inflow" ? entry.creditAccount : entry.debitAccount;
    try {
      await recordClassificationPattern(currentUserId(req), line.description, accountSuggestion, entry.confidence);
    } catch (error) {
      req.log.warn({ err: error }, "Classification learning could not be recorded after approval");
    }
  }
  return res.json(ApproveJournalEntryResponse.parse(journalEntryResponse(entry)));
});

router.post("/ledgerflow/journal-entries/:id/post", async (req, res) => {
  const { id } = ApproveJournalEntryParams.parse({ id: Number(req.params.id) });
  const { clientId } = PostJournalEntryBody.parse(req.body);
  const client = await requireOwnedClient(req, res, clientId);
  if (!client) return;

  const result = await db.transaction(async (tx) => {
    const [entry] = await tx.select().from(journalEntriesTable).where(and(
      eq(journalEntriesTable.id, id),
      eq(journalEntriesTable.clientId, client.id),
    ));
    if (!entry) return { kind: "not_found" as const };
    if (entry.status !== "approved") return { kind: "not_approved" as const };

    const [line] = await tx.select().from(statementLinesTable).where(and(
      eq(statementLinesTable.id, entry.statementLineId),
      eq(statementLinesTable.clientId, client.id),
    ));
    if (!line) return { kind: "not_found" as const };

    const [postedEntry] = await tx.update(journalEntriesTable).set({ status: "posted" }).where(and(
      eq(journalEntriesTable.id, entry.id),
      eq(journalEntriesTable.status, "approved"),
    )).returning();
    if (!postedEntry) return { kind: "not_approved" as const };

    await tx.update(statementLinesTable).set({ status: "posted" }).where(eq(statementLinesTable.id, line.id));
    return { kind: "posted" as const, entry: postedEntry };
  });
  if (result.kind === "not_found") {
    res.status(404).json({ error: "Journal entry not found for this client" });
    return;
  }
  if (result.kind === "not_approved") {
    res.status(409).json({ error: "Journal entry must be approved before posting" });
    return;
  }
  return res.json(ApproveJournalEntryResponse.parse(journalEntryResponse(result.entry)));
});

router.get("/ledgerflow/trial-balance", async (req, res) => {
  const requestedClientId = req.query.clientId === undefined ? undefined : Number(req.query.clientId);
  const client = await requireOwnedClient(req, res, requestedClientId);
  if (!client) return;
  const entries = await db.select().from(journalEntriesTable).where(and(
    eq(journalEntriesTable.clientId, client.id),
    eq(journalEntriesTable.status, "posted"),
  ));
  const accounts = new Map<string, { debit: number; credit: number; category: string }>();
  const functionalCurrency = normalizeCurrency(client.functionalCurrency);
  const missingEntries = entries.filter((entry) => reportingAmount(entry, functionalCurrency) == null);
  const missingRateCurrencies = [...new Set(missingEntries.map((entry) => entry.currency))];
  for (const entry of entries) {
    const amount = reportingAmount(entry, functionalCurrency);
    if (amount == null) continue;
    const debit = accounts.get(entry.debitAccount) ?? { debit: 0, credit: 0, category: ledgerAccountCategory(entry.debitAccount, "debit") };
    debit.debit += amount;
    accounts.set(entry.debitAccount, debit);
    const credit = accounts.get(entry.creditAccount) ?? { debit: 0, credit: 0, category: ledgerAccountCategory(entry.creditAccount, "credit") };
    credit.credit += amount;
    accounts.set(entry.creditAccount, credit);
  }
  const rows = [...accounts.entries()].map(([account, values]) => ({
    account, category: values.category, debit: values.debit, credit: values.credit, balance: values.debit - values.credit,
    functionalCurrency,
    missingRateCount: missingEntries.length,
    missingRateCurrencies,
  }));
  if (missingEntries.length) {
    rows.push({
      account: "Rate coverage required",
      category: "Unconverted transactions",
      debit: 0,
      credit: 0,
      balance: 0,
      functionalCurrency,
      missingRateCount: missingEntries.length,
      missingRateCurrencies,
    });
  }
  res.json(GetTrialBalanceResponse.parse(rows));
});

router.get("/ledgerflow/financial-statements", async (req, res) => {
  const { period } = GetFinancialStatementsQueryParams.parse(req.query);
  const client = await requireOwnedClient(req, res, req.query.clientId === undefined ? undefined : Number(req.query.clientId));
  if (!client) return;
  const entries = await db.select().from(journalEntriesTable).where(and(
    eq(journalEntriesTable.clientId, client.id),
    eq(journalEntriesTable.status, "posted"),
  ));
  const expenseAccounts = new Map<string, number>();
  const revenueAccounts = new Map<string, number>();
  const functionalCurrency = normalizeCurrency(client.functionalCurrency);
  const missingEntries = entries.filter((entry) => reportingAmount(entry, functionalCurrency) == null);
  const missingRateCurrencies = [...new Set(missingEntries.map((entry) => entry.currency))];
  let cash = 0;
  let transferClearing = 0;
  let operatingCash = 0;
  for (const entry of entries) {
    const amount = reportingAmount(entry, functionalCurrency);
    if (amount == null) continue;
    if (entry.debitAccount === "Bank / cash") cash += amount;
    if (entry.creditAccount === "Bank / cash") cash -= amount;
    if (isInterAccountTransferAccount(entry.debitAccount)) transferClearing += amount;
    if (isInterAccountTransferAccount(entry.creditAccount)) transferClearing -= amount;
    if (isInterAccountTransferAccount(entry.debitAccount) || isInterAccountTransferAccount(entry.creditAccount)) continue;
    if (entry.debitAccount === "Bank / cash") operatingCash += amount;
    if (entry.creditAccount === "Bank / cash") operatingCash -= amount;
    if (entry.debitAccount !== "Bank / cash") expenseAccounts.set(entry.debitAccount, (expenseAccounts.get(entry.debitAccount) ?? 0) + amount);
    if (entry.creditAccount !== "Bank / cash") revenueAccounts.set(entry.creditAccount, (revenueAccounts.get(entry.creditAccount) ?? 0) + amount);
  }
  const totalExpenses = [...expenseAccounts.values()].reduce((sum, amount) => sum + amount, 0);
  const totalRevenue = [...revenueAccounts.values()].reduce((sum, amount) => sum + amount, 0);
  const netIncome = totalRevenue - totalExpenses;
  const report = {
    period: period ?? client.period,
    functionalCurrency,
    missingRateCount: missingEntries.length,
    missingRateCurrencies,
    incomeStatement: [
      { label: "Revenue", amount: totalRevenue, children: [...revenueAccounts.entries()].map(([label, amount]) => ({ label, amount })) },
      { label: "Operating expenses", amount: -totalExpenses, children: [...expenseAccounts.entries()].map(([label, amount]) => ({ label, amount: -amount })) },
      { label: "Net income", amount: netIncome },
    ],
    balanceSheet: [
      { label: "Assets", amount: cash + transferClearing, children: [{ label: "Bank / cash", amount: cash }, ...(transferClearing ? [{ label: interAccountTransferAccount, amount: transferClearing }] : [])] },
      { label: "Liabilities", amount: 0 },
      { label: "Equity", amount: cash + transferClearing },
    ],
    cashFlow: [
      { label: "Net income", amount: netIncome },
      { label: "Changes in working capital", amount: 0 },
      { label: "Net cash from operating activities", amount: operatingCash },
      { label: "Net increase in cash", amount: operatingCash },
    ],
  };
  res.json(GetFinancialStatementsResponse.parse(report));
});

router.get("/ledgerflow/report-packs", async (req, res) => {
  const { clientId } = GetReportPacksQueryParams.parse(req.query);
  const client = await requireOwnedClient(req, res, clientId);
  if (!client) return;
  const packs = await db.select().from(reportPacksTable)
    .where(eq(reportPacksTable.clientId, client.id))
    .orderBy(desc(reportPacksTable.createdAt));
  res.json(GetReportPacksResponse.parse(packs.map(reportPackSummary)));
});

router.post("/ledgerflow/report-packs", async (req, res) => {
  const body = CreateReportPackBody.parse(req.body);
  const client = await requireOwnedClient(req, res, body.clientId);
  if (!client) return;
  const periodEnd = calendarDate(body.periodEnd);
  if (!periodEnd || !periodEnd.endsWith("-12-31")) return res.status(422).json({ error: "Report packs require an annual reporting period ending on December 31." });
  const reportingBasis = body.reportingBasis ?? "IFRS";
  const eligibleProfiles = eligibleReportProfiles(periodEnd, client.basis);
  const presentationProfile = body.presentationProfile ?? (reportingBasis === "IFRS for SMEs" ? "IFRS for SMEs" : "IAS 1");
  if (reportingBasis !== client.basis || !eligibleProfiles.some((profile) => profile.profile === presentationProfile && profile.basis === reportingBasis)) {
    return res.status(422).json({ error: "The selected reporting basis and presentation profile are not eligible for this client and annual period." });
  }
  const presentationCurrency = normalizeCurrency(body.presentationCurrency ?? client.functionalCurrency);
  if (presentationCurrency !== normalizeCurrency(client.functionalCurrency)) {
    return res.status(422).json({ error: "This release presents only in the client's functional currency. Update the functional currency or add a future presentation-currency conversion workflow." });
  }

  const entries = await db.select().from(journalEntriesTable).where(and(
    eq(journalEntriesTable.clientId, client.id),
    eq(journalEntriesTable.status, "posted"),
    lte(journalEntriesTable.date, periodEnd),
  ));
  const missingRateEntries = entries.filter((entry) => reportingAmount(entry, presentationCurrency) == null);
  const convertedEntries = entries.filter((entry) => reportingAmount(entry, presentationCurrency) != null);
  const classifications = await db.select().from(accountClassificationsTable).where(eq(accountClassificationsTable.clientId, client.id));
  const inferred = inferredClassifications(convertedEntries, classifications);
  if (inferred.length) {
    await db.insert(accountClassificationsTable).values(inferred.map((classification) => ({
      clientId: client.id,
      ...classification,
    }))).onConflictDoNothing({
      target: [accountClassificationsTable.clientId, accountClassificationsTable.accountName],
    });
  }
  const effectiveClassifications = inferred.length
    ? await db.select().from(accountClassificationsTable).where(eq(accountClassificationsTable.clientId, client.id))
    : classifications;
  const sourceImports = await db.select({ id: statementImportsTable.id }).from(statementImportsTable)
    .where(and(eq(statementImportsTable.clientId, client.id), eq(statementImportsTable.outcome, "completed")));
  const generated = buildReportPack({
    client,
    entries: convertedEntries,
    classifications: effectiveClassifications,
    periodEnd,
    presentationCurrency,
    reportingBasis,
    presentationProfile,
    roundingPolicy: body.roundingPolicy ?? "Nearest whole unit",
    sourceImportCount: sourceImports.length,
    missingRateEntries,
  });
  const [pack] = await db.insert(reportPacksTable).values({
    clientId: client.id,
    createdBy: currentUserId(req),
    periodStart: generated.periods.periodStart,
    periodEnd: generated.periods.periodEnd,
    comparativePeriodStart: generated.periods.comparativePeriodStart,
    comparativePeriodEnd: generated.periods.comparativePeriodEnd,
    reportingBasis,
    presentationProfile,
    presentationCurrency,
    roundingPolicy: body.roundingPolicy ?? "Nearest whole unit",
    status: "draft",
    snapshot: generated.snapshot,
    validation: generated.validation,
    notes: generated.notes,
    checklist: generated.checklist,
    signatory: generated.signatory,
  }).returning();
  return res.status(201).json(CreateReportPackResponse.parse(reportPackResponse(pack)));
});

router.get("/ledgerflow/report-packs/:id", async (req, res) => {
  const { id } = GetReportPackParams.parse({ id: Number(req.params.id) });
  const [pack] = await db.select().from(reportPacksTable).where(eq(reportPacksTable.id, id)).limit(1);
  if (!pack) return res.status(404).json({ error: "Report pack not found." });
  const client = await requireOwnedClient(req, res, pack.clientId);
  if (!client) return;
  return res.json(GetReportPackResponse.parse(reportPackResponse(pack)));
});

router.patch("/ledgerflow/report-packs/:id", async (req, res) => {
  const { id } = UpdateReportPackParams.parse({ id: Number(req.params.id) });
  const body = UpdateReportPackBody.parse(req.body);
  const client = await requireOwnedClient(req, res, body.clientId);
  if (!client) return;
  const [pack] = await db.select().from(reportPacksTable).where(and(
    eq(reportPacksTable.id, id),
    eq(reportPacksTable.clientId, client.id),
  )).limit(1);
  if (!pack) return res.status(404).json({ error: "Report pack not found for this client." });
  if (pack.status === "finalized") {
    return res.status(409).json({ error: "Finalized report snapshots are immutable. Generate a new draft to make changes." });
  }
  const notes = mergeReportNotes(pack.notes as ReportNote[], body.notes);
  const checklist = mergeReportChecklist(pack.checklist as ReportChecklistItem[], body.checklist);
  const signatory = normalizedSignatory(body.signatory as ReportSignatory | undefined, pack.signatory as ReportSignatory);
  const validation = finalizationValidation(pack.validation as ReportValidation, notes, checklist);
  const snapshot = { ...(pack.snapshot as ReportSnapshot), notes };
  if (body.action === "finalize") {
    const missingSignatories = [signatory.preparedBy, signatory.reviewedBy, signatory.authorizedBy, signatory.authorizationDate].some((value) => !value);
    if (validation.status !== "pass" || missingSignatories) {
      return res.status(409).json({
        error: missingSignatories
          ? "Add prepared-by, reviewed-by, authorized-by, and authorization date before finalizing."
          : "Resolve every blocking reconciliation, note, and IFRS checklist item before finalizing.",
        validation,
      });
    }
  }
  const [updated] = await db.update(reportPacksTable).set({
    snapshot,
    validation,
    notes,
    checklist,
    signatory,
    status: body.action === "finalize" ? "finalized" : "draft",
    finalizedAt: body.action === "finalize" ? new Date() : null,
    updatedAt: new Date(),
  }).where(eq(reportPacksTable.id, pack.id)).returning();
  return res.json(UpdateReportPackResponse.parse(reportPackResponse(updated)));
});

router.get("/ledgerflow/report-packs/:id/pdf", async (req, res) => {
  const { id } = GetReportPackParams.parse({ id: Number(req.params.id) });
  const [pack] = await db.select().from(reportPacksTable).where(eq(reportPacksTable.id, id)).limit(1);
  if (!pack) return res.status(404).json({ error: "Report pack not found." });
  const client = await requireOwnedClient(req, res, pack.clientId);
  if (!client) return;
  if (pack.status !== "finalized") {
    return res.status(409).json({ error: "Finalize the reviewed report pack before downloading its PDF." });
  }
  const pdf = buildReportPdf(pack.snapshot as ReportSnapshot, pack.signatory as ReportSignatory);
  const filename = `${client.legalName.replace(/[^a-zA-Z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "ledgerflow"}-${calendarDate(pack.periodEnd)}-financial-statements.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(pdf);
});

export default router;
