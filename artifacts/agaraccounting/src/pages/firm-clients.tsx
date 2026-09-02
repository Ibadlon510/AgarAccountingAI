import { Link, Redirect, useLocation } from "wouter";
import { getGetFirmOverviewQueryKey, useGetBillingMe, useGetFirmOverview } from "@workspace/api-client-react";
import { Building2, Plus } from "lucide-react";
import { Metric, PageHeading, QueryState } from "@/components/page-chrome";
import { primaryFirmBilling } from "@/lib/billing-ui";
import { ownershipLabel, practiceStatusLabel, showsFirmNavigation } from "@/lib/firm-landing";
import { useOrgContext } from "@/lib/workspace-context";

const money = (value: number, currency = "AED") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);

export default function FirmClientsPage() {
  const orgContext = useOrgContext();
  const firm = orgContext?.firms[0];
  const firmId = firm?.firmId ?? 0;
  const billingQuery = useGetBillingMe();
  const firmBilling = primaryFirmBilling(billingQuery.data, firm?.firmId);
  const [, setLocation] = useLocation();
  const overviewQuery = useGetFirmOverview({ firmId }, {
    query: { queryKey: getGetFirmOverviewQueryKey({ firmId }), enabled: firmId > 0 },
  });
  const overview = overviewQuery.data;

  if (!showsFirmNavigation(orgContext?.mode, firmBilling?.fullAccess ?? true)) {
    if (firmBilling && !firmBilling.fullAccess) return <Redirect to="/billing/firm" />;
    return <Redirect to="/user-portal" />;
  }
  if (!firm) return <Redirect to="/firm-dashboard" />;

  return (
    <div data-testid="firm-clients-page">
      <PageHeading
        eyebrow={`${firm.firmName} · Practice`}
        title="Clients"
        description="Review every client engagement, close signal, and commercial term in your firm portfolio."
        action={<Link href="/firm-onboard" data-testid="link-onboard-client" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"><Plus size={14} /> Onboard a client</Link>}
      />
      <QueryState loading={overviewQuery.isLoading} error={overviewQuery.isError} empty={!overview} onRetry={() => overviewQuery.refetch()}>
        {overview && (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Active clients" value={String(overview.totals.clientCount)} note="Confirmed engagements" accent />
              <Metric label="Pending review" value={String(overview.totals.pendingReviewLines)} note={`${overview.totals.pendingReviewClients} clients with drafts`} />
              <Metric label="Awaiting signature" value={String(overview.totals.awaitingSignatureCount)} note={`${overview.totals.awaitingConfirmationCount} waiting for firm confirm`} />
              <Metric label="Missing rates" value={String(overview.totals.missingRateClients)} note="Clients needing FX coverage" />
            </div>
            {overview.clients.length === 0 ? (
              <section className="rounded-lg border border-card-border bg-card p-6" data-testid="firm-clients-empty">
                <div className="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary"><Building2 size={21} /></div>
                <h2 className="mt-5 font-display text-[29px] leading-none">Start with your first client</h2>
                <p className="mt-3 max-w-2xl text-[13px] leading-6 text-muted-foreground">Define the engagement, send a contract, and confirm the connection after the client signs.</p>
                <Link href="/firm-onboard" data-testid="link-onboard-empty-clients" className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"><Plus size={14} /> Onboard a client</Link>
              </section>
            ) : (
              <section className="rounded-lg border border-card-border bg-card p-5 md:p-6">
                <div className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Portfolio</div>
                <h2 className="mt-2 text-base font-semibold">All clients</h2>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[960px] text-left text-xs">
                    <thead className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2">Client</th>
                        <th className="px-2 py-2">Status</th>
                        <th className="px-2 py-2">Close</th>
                        <th className="px-2 py-2">Journals</th>
                        <th className="px-2 py-2">Missing FX</th>
                        <th className="px-2 py-2">Posted</th>
                        <th className="px-2 py-2">Agreed volume</th>
                        <th className="px-2 py-2">Agreed revenue</th>
                        <th className="px-2 py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {overview.clients.map((client) => (
                        <tr key={client.id} data-testid={`row-firm-client-${client.id}`} className="cursor-pointer hover:bg-muted/40" onClick={() => setLocation(`/firm-clients/${client.id}`)}>
                          <td className="px-2 py-3 font-semibold">{client.name}<div className="font-normal text-muted-foreground">{client.period} · {ownershipLabel(client.ownershipStatus)}</div></td>
                          <td className="px-2 py-3">{practiceStatusLabel(client.onboardingStatus, client.engagementStatus)}</td>
                          <td className="px-2 py-3">{client.completionPercent}% · {client.pendingReview} drafts</td>
                          <td className="px-2 py-3">{client.journalCount}</td>
                          <td className="px-2 py-3">{client.missingRateCount}</td>
                          <td className="px-2 py-3">{money(client.postedAmountFunctional, client.functionalCurrency)}</td>
                          <td className="px-2 py-3">{client.agreedTransactionsPerMonth ?? "—"} / month</td>
                          <td className="px-2 py-3">{client.agreedRevenuePerYear != null ? <>{money(client.agreedRevenuePerYear, client.agreedRevenueCurrency ?? client.functionalCurrency)}<div className="font-normal text-muted-foreground">{client.revenueCoverageStartDate && client.revenueCoverageEndDate ? `${client.revenueCoverageStartDate.slice(0, 10)} → ${client.revenueCoverageEndDate.slice(0, 10)}` : "Coverage not specified"}</div></> : "—"}</td>
                          <td className="px-2 py-3">
                            {(client.engagementStatus === "provisional" || client.engagementStatus === "active") && !client.onboardingId
                              ? <Link href={`/firm-onboard?clientId=${client.id}`} onClick={(event) => event.stopPropagation()} className="text-[11px] font-semibold text-primary">Complete onboarding</Link>
                              : <span className="text-muted-foreground">Open</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}
      </QueryState>
    </div>
  );
}