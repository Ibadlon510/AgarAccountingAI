import { useState } from "react";
import { Link, Redirect, useLocation, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetFirmClientPracticeOverviewQueryKey,
  getGetFirmOverviewQueryKey,
  useConfirmEngagementOnboarding,
  useGetBillingMe,
  useGetFirmClientPracticeOverview,
  useResendEngagementOnboarding,
  useRevokeEngagementOnboarding,
} from "@workspace/api-client-react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Metric, PageHeading, QueryState } from "@/components/page-chrome";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { primaryFirmBilling } from "@/lib/billing-ui";
import { daysLeft, ENGAGEMENT_SERVICE_OPTIONS, ownershipLabel, practiceStatusLabel, readEngagementInviteLink, showsFirmNavigation, storeEngagementInviteLink } from "@/lib/firm-landing";
import { notify } from "@/lib/notify";
import { useClientWorkspace, useOrgContext } from "@/lib/workspace-context";

const money = (value: number, currency = "AED") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);

export default function FirmClientDashboardPage() {
  const [, params] = useRoute("/firm-clients/:id");
  const clientId = Number(params?.id ?? 0);
  const orgContext = useOrgContext();
  const firm = orgContext?.firms[0];
  const firmId = firm?.firmId ?? 0;
  const billingQuery = useGetBillingMe();
  const firmBilling = primaryFirmBilling(billingQuery.data, firm?.firmId);
  const { setActiveClientId } = useClientWorkspace();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const query = useGetFirmClientPracticeOverview(clientId, { firmId }, {
    query: { queryKey: getGetFirmClientPracticeOverviewQueryKey(clientId, { firmId }), enabled: firmId > 0 && clientId > 0 },
  });
  const confirm = useConfirmEngagementOnboarding();
  const revoke = useRevokeEngagementOnboarding();
  const resend = useResendEngagementOnboarding();
  const [pending, setPending] = useState<"confirm" | "discard" | "resend" | null>(null);
  const [inviteLink, setInviteLink] = useState(() => readEngagementInviteLink(clientId));
  const data = query.data;
  if (!showsFirmNavigation(orgContext?.mode, firmBilling?.fullAccess ?? true)) {
    if (firmBilling && !firmBilling.fullAccess) return <Redirect to="/billing/firm" />;
    return <Redirect to="/user-portal" />;
  }
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetFirmClientPracticeOverviewQueryKey(clientId, { firmId }) });
    queryClient.invalidateQueries({ queryKey: getGetFirmOverviewQueryKey({ firmId }) });
  };
  const runPending = () => {
    if (!data?.onboardingId || !pending) return;
    const action = pending;
    setPending(null);
    if (action === "confirm") {
      confirm.mutate({ id: data.onboardingId }, { onSuccess: () => { refresh(); notify.success("Engagement confirmed"); } });
    } else if (action === "discard") {
      revoke.mutate({ id: data.onboardingId }, { onSuccess: () => { refresh(); notify.success("Onboarding discarded"); } });
    } else {
      resend.mutate({ id: data.onboardingId }, {
        onSuccess: (onboarding) => {
          if (onboarding.inviteLink) {
            storeEngagementInviteLink(onboarding.clientId, onboarding.inviteLink);
            setInviteLink(onboarding.inviteLink);
          }
          refresh();
          notify.success(onboarding.emailDeliveryStatus === "failed" ? "Invite link ready" : "Contract resent", {
            description: onboarding.emailDeliveryStatus === "failed" ? "Email was not sent. Copy the link below." : `Sent to ${onboarding.signerEmail}.`,
          });
        },
      });
    }
  };

  return (
    <div data-testid="firm-client-dashboard">
      <PageHeading
        eyebrow={`${firm?.firmName ?? "Firm"} · Practice`}
        title={data?.clientName ?? "Client engagement"}
        description="How this engagement is tracking against the signed terms."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/firm-dashboard" data-testid="link-back-to-firm-dashboard" className="text-xs font-semibold text-primary">Back to firm dashboard</Link>
            {data?.workspaceAccessible && (
              <button data-testid="button-open-close-desk" onClick={() => { setActiveClientId(data.clientId); setLocation("/user-portal"); }} className="inline-flex items-center rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground">Open close desk</button>
            )}
          </div>
        }
      />
      <QueryState loading={query.isLoading} error={query.isError} empty={!data} onRetry={() => query.refetch()}>
        {data && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full bg-secondary px-2 py-1">{practiceStatusLabel(data.onboardingStatus, data.engagementStatus)}</span>
              <span className="rounded-full border border-border px-2 py-1">{ownershipLabel(data.ownershipStatus)}</span>
              {(data.services ?? []).map((service) => (
                <span key={service} className="rounded-full border border-border px-2 py-1">{ENGAGEMENT_SERVICE_OPTIONS.find((option) => option.id === service)?.label ?? service}</span>
              ))}
              {data.startDate && <span className="rounded-full border border-border px-2 py-1">{data.startDate}{data.endDate ? ` → ${data.endDate}` : " · ongoing"}</span>}
            </div>
            {data.feeNote && <p className="text-xs text-muted-foreground">Fee: {data.feeNote}</p>}
            {inviteLink && data.canResend && (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-xs" data-testid="banner-invite-link">
                <div className="font-semibold">Signing link</div>
                <p className="mt-1 break-all text-muted-foreground">{inviteLink}</p>
                <button type="button" className="mt-2 font-semibold text-primary" onClick={() => void navigator.clipboard.writeText(inviteLink).then(() => notify.success("Invite link copied"))}>Copy link</button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {data.onboardingStatus === "signed" && data.onboardingId && (
                <button data-testid="button-confirm-engagement" onClick={() => setPending("confirm")} className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">
                  Confirm{daysLeft(data.confirmBy) != null ? ` · ${daysLeft(data.confirmBy)} days left` : ""}
                </button>
              )}
              {data.canResend && data.onboardingId && (
                <button data-testid="button-resend-engagement" onClick={() => setPending("resend")} className="rounded-md border border-border px-3 py-2 text-xs font-semibold">Resend</button>
              )}
              {(data.onboardingStatus === "sent" || data.onboardingStatus === "expired") && data.onboardingId && (
                <button data-testid="button-discard-engagement" onClick={() => setPending("discard")} className="rounded-md border border-border px-3 py-2 text-xs font-semibold">Discard</button>
              )}
            </div>
            {!data.ledgerActualsHidden && (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Close progress" value={`${data.closeSnapshot.completionPercent}%`} note={`${data.closeSnapshot.pendingReview} drafts`} accent />
                <Metric label="Journals" value={String(data.closeSnapshot.journalCount)} note={data.closeSnapshot.period} />
                <Metric label="Missing rates" value={String(data.closeSnapshot.missingRateCount)} note={data.closeSnapshot.missingRateCurrencies.join(" · ") || "Covered"} />
                <Metric label="Posted amount" value={money(data.closeSnapshot.postedAmountFunctional, data.closeSnapshot.functionalCurrency)} note="Functional currency" />
              </div>
            )}
            {data.ledgerActualsHidden ? (
              <p className="rounded-lg border border-accent/30 bg-accent/10 p-4 text-xs" data-testid="status-actuals-hidden">Ledger actuals are hidden because this engagement expired.</p>
            ) : (
              <div className="grid gap-6 xl:grid-cols-2">
                <section className="rounded-lg border border-card-border bg-card p-5">
                  <div className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Agreed vs actual</div>
                  <h2 className="mt-2 text-base font-semibold">Posted journals / month</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{data.currentMonthPostedJournals} posted journals this month vs {data.agreedTransactionsPerMonth ?? "—"} agreed.</p>
                  <div className="mt-4 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.monthlyPostedJournals}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Bar dataKey="postedCount" fill="hsl(var(--primary))" name="Posted journals" />
                        {data.agreedTransactionsPerMonth != null && <ReferenceLine y={data.agreedTransactionsPerMonth} stroke="hsl(var(--accent-foreground))" strokeDasharray="4 4" label="Agreed" />}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
                <section className="rounded-lg border border-card-border bg-card p-5">
                  <div className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Agreed vs actual</div>
                  <h2 className="mt-2 text-base font-semibold">IFRS revenue / year</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {data.actualRevenuePerYear != null ? money(data.actualRevenuePerYear, data.agreedRevenueCurrency ?? data.closeSnapshot.functionalCurrency) : "No IFRS revenue yet"}
                    {" vs "}
                    {data.agreedRevenuePerYear != null ? money(data.agreedRevenuePerYear, data.agreedRevenueCurrency ?? data.closeSnapshot.functionalCurrency) : "—"} agreed
                    {data.agreedRevenuePerYear && data.actualRevenuePerYear != null ? ` · ${Math.round((data.actualRevenuePerYear / data.agreedRevenuePerYear) * 100)}%` : ""}
                  </p>
                  {data.revenueSource === "report_pack" && <p className="mt-2 text-[11px] text-muted-foreground">Revenue source: latest report pack.</p>}
                  {data.revenueSource === "live_statements" && <p className="mt-2 text-[11px] text-muted-foreground">Revenue source: live financial statements.</p>}
                  {data.revenueSource === "unavailable" && <p className="mt-2 text-[11px] text-muted-foreground">Statements are empty or not yet available.</p>}
                  {(data.missingRateCount ?? 0) > 0 && <p className="mt-2 text-[11px] text-accent-foreground">Missing FX rates may understate revenue.</p>}
                  <div className="mt-4 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[
                        { label: "Agreed", amount: data.agreedRevenuePerYear ?? 0 },
                        { label: "Actual", amount: data.actualRevenuePerYear ?? 0 },
                      ]}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Bar dataKey="amount" fill="hsl(var(--primary))" name="Revenue" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              </div>
            )}
          </div>
        )}
      </QueryState>
      <AlertDialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending === "confirm" ? "Confirm this engagement?" : pending === "resend" ? "Resend the contract?" : "Discard this onboarding?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending === "confirm"
                ? "This activates the firm connection."
                : pending === "resend"
                  ? "A new signing link will be emailed to the signer."
                  : "This cancels the engagement onboarding."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runPending}>{pending === "discard" ? "Discard" : pending === "resend" ? "Resend" : "Confirm"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
