import { useState } from "react";
import { Link, Redirect, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetFirmOverviewQueryKey, useConfirmEngagementOnboarding, useGetBillingMe, useGetFirmOverview, useResendEngagementOnboarding, useRevokeEngagementOnboarding } from "@workspace/api-client-react";
import { Building2, Plus } from "lucide-react";
import { FirmEngagementsSection, FirmMembersSection, FirmUsageStrip } from "@/components/firm-admin";
import { Metric, PageHeading, QueryState } from "@/components/page-chrome";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { primaryFirmBilling } from "@/lib/billing-ui";
import { daysLeft, ownershipLabel, practiceStatusLabel, showsFirmNavigation, storeEngagementInviteLink } from "@/lib/firm-landing";
import { notify } from "@/lib/notify";
import { useOrgContext } from "@/lib/workspace-context";

const money = (value: number, currency = "AED") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);

type PendingAction = { type: "confirm" | "discard" | "resend"; id: number; name?: string };

export default function FirmDashboardPage() {
  const orgContext = useOrgContext();
  const firm = orgContext?.firms[0];
  const billingQuery = useGetBillingMe();
  const firmBilling = primaryFirmBilling(billingQuery.data, firm?.firmId);
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const overviewQuery = useGetFirmOverview({ firmId: firm?.firmId ?? 0 }, {
    query: { queryKey: getGetFirmOverviewQueryKey({ firmId: firm?.firmId }), enabled: Boolean(firm?.firmId) },
  });
  const confirm = useConfirmEngagementOnboarding();
  const revoke = useRevokeEngagementOnboarding();
  const resend = useResendEngagementOnboarding();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetFirmOverviewQueryKey({ firmId: firm?.firmId }) });
  const overview = overviewQuery.data;

  if (!showsFirmNavigation(orgContext?.mode, firmBilling?.fullAccess ?? true)) {
    if (firmBilling && !firmBilling.fullAccess) return <Redirect to="/billing/firm" />;
    return <Redirect to="/user-portal" />;
  }
  if (!firm) {
    return (
      <div data-testid="firm-dashboard-missing">
        <PageHeading eyebrow="Practice" title="No accounting firm yet." description="Register an accounting firm to open the practice dashboard." />
      </div>
    );
  }

  const runPending = () => {
    if (!pending) return;
    const { type, id } = pending;
    setPending(null);
    if (type === "confirm") {
      confirm.mutate({ id }, { onSuccess: () => { refresh(); notify.success("Engagement confirmed"); } });
    } else if (type === "discard") {
      revoke.mutate({ id }, { onSuccess: () => { refresh(); notify.success("Onboarding discarded"); } });
    } else {
      resend.mutate({ id }, {
        onSuccess: (onboarding) => {
          if (onboarding.inviteLink) storeEngagementInviteLink(onboarding.clientId, onboarding.inviteLink);
          refresh();
          notify.success(onboarding.emailDeliveryStatus === "failed" ? "Invite link ready" : "Contract resent", {
            description: onboarding.emailDeliveryStatus === "failed"
              ? `Email was not sent. Copy the link from ${onboarding.clientName}.`
              : `Sent to ${onboarding.signerEmail}.`,
          });
          setLocation(`/firm-clients/${onboarding.clientId}`);
        },
      });
    }
  };

  return (
    <div data-testid="firm-dashboard">
      <PageHeading
        eyebrow={`${firm.firmName} · Practice`}
        title="Firm dashboard"
        description="A book-of-clients view: close progress, signed terms, and engagements that still need a decision."
        action={<Link href="/firm-onboard" data-testid="link-onboard-client" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"><Plus size={14} /> Onboard a client</Link>}
      />
      <QueryState loading={overviewQuery.isLoading} error={overviewQuery.isError} empty={!overview} onRetry={() => overviewQuery.refetch()}>
        {overview && (
          <div className="space-y-6">
            {overview.clients.length === 0 && (
              <section className="rounded-lg border border-card-border bg-card p-6" data-testid="firm-dashboard-empty-book">
                <div className="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary"><Building2 size={21} /></div>
                <h2 className="mt-5 font-display text-[29px] leading-none">Start with your first client</h2>
                <p className="mt-3 max-w-2xl text-[13px] leading-6 text-muted-foreground">Define the engagement, send a contract, and confirm the connection after the client signs.</p>
                <Link href="/firm-onboard" data-testid="link-onboard-empty-book" className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"><Plus size={14} /> Onboard a client</Link>
              </section>
            )}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Active clients" value={String(overview.totals.clientCount)} note="Confirmed engagements" accent />
              <Metric label="Pending review" value={String(overview.totals.pendingReviewLines)} note={`${overview.totals.pendingReviewClients} clients with drafts · ${overview.totals.missingRateClients} missing FX`} />
              <Metric label="Awaiting signature" value={String(overview.totals.awaitingSignatureCount)} note={`${overview.totals.awaitingConfirmationCount} waiting for firm confirm`} />
              <Metric label="Expired" value={String(overview.totals.expiredOnboardingCount)} note={`${overview.totals.pendingInvitationCount} team invitations`} />
            </div>
            {overview.clients.length > 0 && <section className="rounded-lg border border-card-border bg-card p-5 md:p-6">
              <div className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Portfolio</div>
              <h2 className="mt-2 text-base font-semibold">Clients</h2>
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
                        <td className="px-2 py-3">{client.agreedRevenuePerYear != null ? money(client.agreedRevenuePerYear, client.agreedRevenueCurrency ?? client.functionalCurrency) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>}
            <section className="rounded-lg border border-card-border bg-card p-5 md:p-6">
              <div className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Attention</div>
              <h2 className="mt-2 text-base font-semibold">What needs a decision</h2>
              <div className="mt-4 space-y-2">
                {overview.attention.length === 0 && <p className="text-xs text-muted-foreground">Nothing waiting.</p>}
                {overview.attention.map((item, index) => {
                  const client = overview.clients.find((row) => row.id === item.clientId);
                  const left = item.kind === "awaiting_confirmation" ? daysLeft(client?.confirmBy) : null;
                  return (
                    <div key={`${item.kind}-${item.clientId}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs" data-testid={`row-attention-${item.kind}`}>
                      <span>{item.label}{left != null ? ` · ${left} day${left === 1 ? "" : "s"} left` : ""}</span>
                      <div className="flex gap-2">
                        {item.kind === "awaiting_confirmation" && item.onboardingId && (
                          <button data-testid={`button-confirm-onboarding-${item.onboardingId}`} onClick={() => setPending({ type: "confirm", id: item.onboardingId!, name: client?.name })} className="rounded bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground">Confirm</button>
                        )}
                        {item.onboardingId && client?.canResend && (item.kind === "expired_onboarding" || item.kind === "awaiting_signature") && (
                          <button data-testid={`button-resend-onboarding-${item.onboardingId}`} onClick={() => setPending({ type: "resend", id: item.onboardingId!, name: client?.name })} className="rounded border border-border px-2 py-1 text-[11px] font-semibold">Resend</button>
                        )}
                        {(item.kind === "expired_onboarding" || item.kind === "awaiting_signature") && item.onboardingId && (
                          <button data-testid={`button-discard-onboarding-${item.onboardingId}`} onClick={() => setPending({ type: "discard", id: item.onboardingId!, name: client?.name })} className="rounded border border-border px-2 py-1 text-[11px] font-semibold">Discard</button>
                        )}
                        {item.clientId && <Link href={`/firm-clients/${item.clientId}`} className="text-[11px] font-semibold text-primary">Open</Link>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            <FirmMembersSection firmId={firm.firmId} members={orgContext?.firmMembers.filter((member) => member.firmId === firm.firmId) ?? []} invitations={orgContext?.invitations ?? []} />
            <FirmEngagementsSection engagements={orgContext?.engagements ?? []} />
            <FirmUsageStrip />
          </div>
        )}
      </QueryState>
      <AlertDialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.type === "confirm" ? "Confirm this engagement?" : pending?.type === "resend" ? "Resend the contract?" : "Discard this onboarding?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.type === "confirm"
                ? `This activates the connection for ${pending.name ?? "this client"}.`
                : pending?.type === "resend"
                  ? `A new signing link will be emailed to the signer for ${pending.name ?? "this client"}.`
                  : `This cancels onboarding for ${pending?.name ?? "this client"}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runPending}>{pending?.type === "discard" ? "Discard" : pending?.type === "resend" ? "Resend" : "Confirm"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
