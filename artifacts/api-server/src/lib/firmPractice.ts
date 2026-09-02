import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  accountClassificationsTable,
  clientWorkspacesTable,
  clientsTable,
  db,
  engagementContractsTable,
  firmCompanyEngagementsTable,
  firmMembershipsTable,
  journalEntriesTable,
  organizationInvitationsTable,
  reportPacksTable,
  statementLinesTable,
  type Client,
} from "@workspace/db";
import { ENGAGEMENT_CONFIRM_TTL_MS } from "./engagementContract";

export const emptyLedgerOverview = (client: Pick<Client, "period" | "functionalCurrency">) => ({
  period: client.period,
  currencies: [] as string[],
  totalLines: 0,
  pendingReview: 0,
  postedAmount: 0,
  completionPercent: 0,
  functionalCurrency: client.functionalCurrency.toUpperCase(),
  postedAmountFunctional: 0,
  missingRateCount: 0,
  missingRateCurrencies: [] as string[],
  journalCount: 0,
});

export function isFirmManagerRole(role: string) {
  return role === "owner" || role === "admin";
}

export function numberValue(value: string | number | null | undefined) {
  return Number(value ?? 0);
}

export async function expireStaleEngagementContracts(now = new Date()) {
  const pending = await db.select().from(engagementContractsTable).where(
    inArray(engagementContractsTable.status, ["sent", "signed"]),
  );
  for (const contract of pending) {
    const inviteExpired = contract.invitationId
      ? (await db.select({ expiresAt: organizationInvitationsTable.expiresAt, status: organizationInvitationsTable.status })
        .from(organizationInvitationsTable)
        .where(eq(organizationInvitationsTable.id, contract.invitationId))
        .limit(1))[0]
      : null;
    const signatureWindowClosed = contract.status === "sent" && inviteExpired && (inviteExpired.status !== "pending" || inviteExpired.expiresAt <= now);
    const confirmWindowClosed = contract.status === "signed" && contract.confirmBy != null && contract.confirmBy <= now;
    if (!signatureWindowClosed && !confirmWindowClosed) continue;
    await expireEngagementContract(contract.id);
  }
}

async function expireEngagementContract(contractId: number) {
  await db.transaction(async (tx) => {
    await tx.update(engagementContractsTable).set({ status: "expired" }).where(eq(engagementContractsTable.id, contractId));
    const invitation = await tx.select({ id: engagementContractsTable.invitationId })
      .from(engagementContractsTable)
      .where(eq(engagementContractsTable.id, contractId))
      .limit(1);
    if (invitation[0]?.id) {
      await tx.update(organizationInvitationsTable).set({ status: "expired" })
        .where(and(eq(organizationInvitationsTable.id, invitation[0].id), eq(organizationInvitationsTable.status, "pending")));
    }
  });
}

export async function visibleFirmClientIds(userId: string, firmId: number, role: string) {
  const [byFirm, byEngagement] = await Promise.all([
    db.select({ id: clientsTable.id }).from(clientsTable).where(eq(clientsTable.firmId, firmId)),
    db.select({ clientId: firmCompanyEngagementsTable.clientId }).from(firmCompanyEngagementsTable)
      .where(eq(firmCompanyEngagementsTable.firmId, firmId)),
  ]);
  const associated = new Set<number>([
    ...byFirm.map((row) => row.id),
    ...byEngagement.map((row) => row.clientId),
  ]);
  if (isFirmManagerRole(role)) return [...associated];
  const memberships = await db.select({ clientId: clientWorkspacesTable.clientId })
    .from(clientWorkspacesTable)
    .where(eq(clientWorkspacesTable.userId, userId));
  return memberships.map((row) => row.clientId).filter((clientId) => associated.has(clientId));
}

export async function loadClientCloseSnapshots(clientIds: number[]) {
  if (!clientIds.length) return new Map<number, ReturnType<typeof emptyLedgerOverview>>();
  const clients = await db.select().from(clientsTable).where(inArray(clientsTable.id, clientIds));
  const lineStats = await db.select({
    clientId: statementLinesTable.clientId,
    totalLines: sql<number>`count(*)::int`,
    pendingReview: sql<number>`count(*) filter (where ${statementLinesTable.status} <> 'posted')::int`,
    postedAmountFunctional: sql<string>`coalesce(sum(case
      when ${statementLinesTable.status} <> 'posted' then 0
      when upper(${statementLinesTable.currency}) = upper(${clientsTable.functionalCurrency}) then ${statementLinesTable.amount}
      else ${statementLinesTable.functionalAmount}
    end), 0)`,
    missingRateCount: sql<number>`count(*) filter (where ${statementLinesTable.status} = 'posted'
      and upper(${statementLinesTable.currency}) <> upper(${clientsTable.functionalCurrency})
      and ${statementLinesTable.functionalAmount} is null)::int`,
  }).from(statementLinesTable)
    .innerJoin(clientsTable, eq(clientsTable.id, statementLinesTable.clientId))
    .where(inArray(statementLinesTable.clientId, clientIds))
    .groupBy(statementLinesTable.clientId);

  const journalStats = await db.select({
    clientId: journalEntriesTable.clientId,
    journalCount: sql<number>`count(*)::int`,
  }).from(journalEntriesTable)
    .where(inArray(journalEntriesTable.clientId, clientIds))
    .groupBy(journalEntriesTable.clientId);

  const currencyRows = await db.selectDistinct({
    clientId: statementLinesTable.clientId,
    currency: statementLinesTable.currency,
  }).from(statementLinesTable)
    .where(inArray(statementLinesTable.clientId, clientIds))
    .orderBy(asc(statementLinesTable.clientId), asc(statementLinesTable.currency));

  const missingRateCurrencyRows = await db.selectDistinct({
    clientId: statementLinesTable.clientId,
    currency: statementLinesTable.currency,
  }).from(statementLinesTable)
    .innerJoin(clientsTable, eq(clientsTable.id, statementLinesTable.clientId))
    .where(and(
      inArray(statementLinesTable.clientId, clientIds),
      eq(statementLinesTable.status, "posted"),
      sql`upper(${statementLinesTable.currency}) <> upper(${clientsTable.functionalCurrency})`,
      sql`${statementLinesTable.functionalAmount} is null`,
    ));

  const byClient = new Map<number, ReturnType<typeof emptyLedgerOverview>>();
  for (const client of clients) {
    const stats = lineStats.find((row) => row.clientId === client.id);
    const journals = journalStats.find((row) => row.clientId === client.id);
    const totalLines = Number(stats?.totalLines ?? 0);
    const pendingReview = Number(stats?.pendingReview ?? 0);
    const postedAmountFunctional = numberValue(stats?.postedAmountFunctional);
    byClient.set(client.id, {
      period: client.period,
      currencies: currencyRows.filter((row) => row.clientId === client.id).map((row) => row.currency),
      totalLines,
      pendingReview,
      postedAmount: postedAmountFunctional,
      completionPercent: Math.round(((totalLines - pendingReview) / Math.max(totalLines, 1)) * 100),
      functionalCurrency: client.functionalCurrency.toUpperCase(),
      postedAmountFunctional,
      missingRateCount: Number(stats?.missingRateCount ?? 0),
      missingRateCurrencies: missingRateCurrencyRows.filter((row) => row.clientId === client.id).map((row) => row.currency),
      journalCount: Number(journals?.journalCount ?? 0),
    });
  }
  return byClient;
}

export function lastTwelveMonthKeys(now = new Date()) {
  const months: string[] = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export async function postedJournalCountsByMonth(clientId: number, now = new Date()) {
  const months = lastTwelveMonthKeys(now);
  const rows = await db.select({
    month: sql<string>`to_char(${journalEntriesTable.date}::date, 'YYYY-MM')`,
    postedCount: sql<number>`count(*)::int`,
  }).from(journalEntriesTable)
    .where(and(
      eq(journalEntriesTable.clientId, clientId),
      eq(journalEntriesTable.status, "posted"),
      sql`${journalEntriesTable.date} >= ${`${months[0]}-01`}`,
    ))
    .groupBy(sql`to_char(${journalEntriesTable.date}::date, 'YYYY-MM')`);
  const byMonth = new Map(rows.map((row) => [row.month, Number(row.postedCount)]));
  return months.map((month) => ({ month, postedCount: byMonth.get(month) ?? 0 }));
}

function reportPackRevenue(snapshot: unknown): number | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const rows = (snapshot as { profitOrLossAndOci?: Array<{ label?: string; current?: number }> }).profitOrLossAndOci;
  const revenue = rows?.find((row) => row.label === "Revenue");
  return typeof revenue?.current === "number" ? revenue.current : null;
}

export async function resolveIfrsRevenue(client: Client) {
  const [pack] = await db.select().from(reportPacksTable)
    .where(eq(reportPacksTable.clientId, client.id))
    .orderBy(desc(reportPacksTable.updatedAt))
    .limit(1);
  const packRevenue = pack ? reportPackRevenue(pack.snapshot) : null;
  if (pack && packRevenue != null) {
    return {
      amount: packRevenue,
      period: pack.periodEnd,
      source: "report_pack" as const,
      missingRateCount: 0,
    };
  }

  const entries = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.clientId, client.id));
  const classifications = await db.select().from(accountClassificationsTable)
    .where(eq(accountClassificationsTable.clientId, client.id));
  const revenueNames = new Set(classifications.filter((row) => row.statementSection === "revenue").map((row) => row.accountName));
  const functionalCurrency = client.functionalCurrency.toUpperCase();
  let totalRevenue = 0;
  let missingRateCount = 0;
  for (const entry of entries) {
    if (entry.status !== "posted") continue;
    const amount = entry.functionalAmount != null
      ? numberValue(entry.functionalAmount)
      : entry.currency.toUpperCase() === functionalCurrency
        ? numberValue(entry.amount)
        : null;
    if (amount == null) {
      missingRateCount += 1;
      continue;
    }
    const lines: Array<{ account: string; debit: number; credit: number }> = Array.isArray(entry.lines) && entry.lines.length >= 2
      ? entry.lines.map((line) => ({ account: String(line.account), debit: Number(line.debit ?? 0), credit: Number(line.credit ?? 0) }))
      : [
        { account: entry.debitAccount, debit: numberValue(entry.amount), credit: 0 },
        { account: entry.creditAccount, debit: 0, credit: numberValue(entry.amount) },
      ];
    const sourceTotal = lines.reduce((sum, line) => sum + line.debit, 0);
    const factor = sourceTotal > 0 ? amount / sourceTotal : 1;
    for (const line of lines) {
      if (!revenueNames.has(String(line.account))) continue;
      totalRevenue += (Number(line.credit ?? 0) - Number(line.debit ?? 0)) * factor;
    }
  }
  if (!revenueNames.size && !entries.some((entry) => entry.status === "posted")) {
    return { amount: null, period: client.period, source: "unavailable" as const, missingRateCount };
  }
  return { amount: totalRevenue, period: client.period, source: "live_statements" as const, missingRateCount };
}

export function contractConfirmBy(signedAt: Date) {
  return new Date(signedAt.getTime() + ENGAGEMENT_CONFIRM_TTL_MS);
}
