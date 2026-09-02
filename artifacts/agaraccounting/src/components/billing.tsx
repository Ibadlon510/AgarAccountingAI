import { useEffect, useState } from "react";
import { useCreateBillingCheckout, useCreateBillingPortal, useGetBillingMe, type BillingMe, type CompanyBillingState, type FirmBillingState } from "@workspace/api-client-react";
import { notify } from "@/lib/notify";
import { companyStatusLabel, firmStatusLabel, formatAed, remainingIntro } from "@/lib/billing-ui";

export function IntroCountdown({ introEndsAt, introActive }: { introEndsAt: string; introActive: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!introActive) return;
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [introActive]);
  if (!introActive) return null;
  const left = remainingIntro(introEndsAt, now);
  if (left.expired) return null;
  return (
    <div data-testid="intro-rate-countdown" className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 font-mono text-[11px] text-primary">
      Introductory rates end in {left.days}d {String(left.hours).padStart(2, "0")}h {String(left.minutes).padStart(2, "0")}m {String(left.seconds).padStart(2, "0")}s
    </div>
  );
}

export function PricePair({ current, list, introActive }: { current: number; list: number; introActive: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      {introActive && current !== list && <span className="text-xs text-muted-foreground line-through">{formatAed(list)}/mo</span>}
      <span className="text-lg font-semibold">{formatAed(current)}/mo</span>
      {introActive && current !== list && <span className="text-[10px] uppercase tracking-[.08em] text-primary">Introductory</span>}
    </div>
  );
}

async function openBillingUrl(url: string | null | undefined) {
  if (!url) {
    notify.error("Checkout is not available yet.");
    return;
  }
  window.location.assign(url);
}

export function FirmBillingCard({ firm, billing }: { firm: FirmBillingState; billing: BillingMe }) {
  const checkout = useCreateBillingCheckout();
  const portal = useCreateBillingPortal();
  const quote = billing.prices.firm;
  return (
    <section data-testid="card-firm-billing" className="rounded-lg border border-card-border bg-card p-5 md:p-6">
      <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Billing & plan</div>
      <h2 className="mt-2 text-base font-semibold">{firmStatusLabel(firm.status)}</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Firm Pro includes the practice dashboard, engagement onboarding, a white-labelled landing page, and {firm.limits.clientWorkspaces} firm-managed workspaces.
        {firm.trialEndsAt ? ` Trial ends ${new Date(firm.trialEndsAt).toLocaleDateString()}.` : ""}
      </p>
      <div className="mt-4"><PricePair current={quote.current} list={quote.list} introActive={billing.prices.introActive} /></div>
      {billing.prices.introActive && <p className="mt-1 text-[11px] text-muted-foreground">List price resumes 1 Jan 2027 at {formatAed(quote.list)}/mo.</p>}
      <div className="mt-4"><IntroCountdown introEndsAt={billing.prices.introEndsAt} introActive={billing.prices.introActive} /></div>
      <div className="mt-5 flex flex-wrap gap-2">
        {firm.status !== "active" && (
          <button
            data-testid="button-subscribe-firm-pro"
            type="button"
            disabled={checkout.isPending || !billing.stripeEnabled}
            onClick={() => checkout.mutate({ payerType: "firm", firmId: firm.firmId }, {
              onSuccess: (result) => void openBillingUrl(result.url),
              onError: () => notify.error("Firm Pro checkout could not be started."),
            })}
            className="rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {checkout.isPending ? "Opening checkout…" : "Subscribe to Firm Pro"}
          </button>
        )}
        {firm.status === "active" && (
          <button
            data-testid="button-manage-firm-billing"
            type="button"
            disabled={portal.isPending}
            onClick={() => portal.mutate({ payerType: "firm", firmId: firm.firmId }, {
              onSuccess: (result) => void openBillingUrl(result.url),
              onError: () => notify.error("The billing portal could not be opened."),
            })}
            className="rounded-md border border-border px-4 py-2.5 text-xs font-semibold"
          >
            Manage billing
          </button>
        )}
      </div>
    </section>
  );
}

export function CompanyBillingCard({ company, billing, liableFirmName }: { company?: CompanyBillingState; billing: BillingMe; liableFirmName?: string }) {
  const checkout = useCreateBillingCheckout();
  const portal = useCreateBillingPortal();
  if (liableFirmName) {
    return (
      <section data-testid="card-company-billing" className="rounded-lg border border-card-border bg-card p-5 md:p-6">
        <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Billing & plan</div>
        <h2 className="mt-2 text-base font-semibold">Billed to {liableFirmName}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">This workspace is included in the firm subscription until ownership is transferred.</p>
      </section>
    );
  }
  if (!company) return null;
  const quote = company.isFirmMember ? billing.prices.companyProFirmMember : billing.prices.companyPro;
  return (
    <section data-testid="card-company-billing" className="rounded-lg border border-card-border bg-card p-5 md:p-6">
      <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Billing & plan</div>
      <h2 className="mt-2 text-base font-semibold">{companyStatusLabel(company)}</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {company.plan === "free"
          ? `${company.limits.statementImportsPerMonth} imports, ${company.limits.aiActivityPerMonth} AI actions, and 0.5 GB evidence each month.`
          : `${company.limits.statementImportsPerMonth} imports, ${company.limits.aiActivityPerMonth} AI actions, and 5 GB evidence each month.`}
        {company.status === "requires_pro" ? ` Posted revenue ${company.revenue.toLocaleString()} ${company.revenueCurrency} has reached the ${company.revenueThreshold.toLocaleString()} ${company.revenueCurrency} Pro threshold.` : ""}
      </p>
      {company.isFirmMember && <p className="mt-2 text-[11px] text-primary">Firm rate — billed because you work with a subscribed firm.</p>}
      <div className="mt-4"><PricePair current={quote.current} list={quote.list} introActive={billing.prices.introActive} /></div>
      {billing.prices.introActive && <p className="mt-1 text-[11px] text-muted-foreground">List price resumes 1 Jan 2027 at {formatAed(quote.list)}/mo.</p>}
      <div className="mt-4"><IntroCountdown introEndsAt={billing.prices.introEndsAt} introActive={billing.prices.introActive} /></div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${Math.min(100, Math.round((company.revenue / Math.max(company.revenueThreshold, 1)) * 100))}%` }} />
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">Revenue {company.revenue.toLocaleString()} / {company.revenueThreshold.toLocaleString()} {company.revenueCurrency}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {company.plan !== "pro" && (
          <button
            data-testid="button-upgrade-company-pro"
            type="button"
            disabled={checkout.isPending || !billing.stripeEnabled}
            onClick={() => checkout.mutate({ payerType: "company", clientId: company.clientId }, {
              onSuccess: (result) => void openBillingUrl(result.url),
              onError: () => notify.error("Company Pro checkout could not be started."),
            })}
            className="rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {checkout.isPending ? "Opening checkout…" : "Upgrade to Pro"}
          </button>
        )}
        {company.plan === "pro" && (
          <button
            data-testid="button-manage-company-billing"
            type="button"
            disabled={portal.isPending}
            onClick={() => portal.mutate({ payerType: "company", clientId: company.clientId }, {
              onSuccess: (result) => void openBillingUrl(result.url),
              onError: () => notify.error("The billing portal could not be opened."),
            })}
            className="rounded-md border border-border px-4 py-2.5 text-xs font-semibold"
          >
            Manage billing
          </button>
        )}
      </div>
    </section>
  );
}

export function FirmSubscribeWall({ persistent, firm, billing }: { persistent: boolean; firm?: FirmBillingState; billing?: BillingMe }) {
  const checkout = useCreateBillingCheckout();
  const quote = billing?.prices.firm;
  return (
    <div data-testid="firm-subscribe-wall" className="grid min-h-[70vh] place-items-center px-5 py-10">
      <div className="w-full max-w-lg rounded-lg border border-card-border bg-card p-6 shadow-md">
        <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Firm Pro</div>
        <h1 className="mt-2 font-display text-[32px] leading-none">Subscribe to keep the practice open.</h1>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          {persistent
            ? "The 45-day read-only window has ended. Subscribe to Firm Pro to continue. This screen cannot be dismissed."
            : "The 15-day firm trial has ended. Existing books stay readable until the lock date. The practice dashboard stays off until you subscribe."}
        </p>
        {quote && <div className="mt-5"><PricePair current={quote.current} list={quote.list} introActive={Boolean(billing?.prices.introActive)} /></div>}
        {billing && <div className="mt-4"><IntroCountdown introEndsAt={billing.prices.introEndsAt} introActive={billing.prices.introActive} /></div>}
        <button
          data-testid="button-wall-subscribe-firm"
          type="button"
          disabled={checkout.isPending || !billing?.stripeEnabled || !firm}
          onClick={() => firm && checkout.mutate({ payerType: "firm", firmId: firm.firmId }, {
            onSuccess: (result) => void openBillingUrl(result.url),
            onError: () => notify.error("Firm Pro checkout could not be started."),
          })}
          className="mt-6 w-full rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          {checkout.isPending ? "Opening checkout…" : "Subscribe to Firm Pro"}
        </button>
      </div>
    </div>
  );
}

export function BillingStatusBanner({
  firm,
  company,
}: {
  firm?: FirmBillingState;
  company?: CompanyBillingState;
}) {
  const messages: string[] = [];
  const now = Date.now();
  const daysUntil = (iso: string | null | undefined) => {
    if (!iso) return null;
    return Math.ceil((new Date(iso).getTime() - now) / (24 * 60 * 60 * 1000));
  };
  const firmDays = daysUntil(firm?.trialEndsAt);
  if (firm?.status === "trialing" && firmDays != null && firmDays <= 5) {
    messages.push(`Firm trial ends in ${Math.max(0, firmDays)} day${firmDays === 1 ? "" : "s"}. Subscribe to keep the practice open.`);
  }
  if (firm?.status === "lapsed_readonly") {
    const lockDays = daysUntil(firm.lockedAt);
    messages.push(`Firm Pro has lapsed. Existing books are read-only${lockDays != null ? ` for ${Math.max(0, lockDays)} more day${lockDays === 1 ? "" : "s"}` : ""}.`);
  }
  const companyDays = daysUntil(company?.trialEndsAt);
  if (company?.status === "trialing" && companyDays != null && companyDays <= 5) {
    messages.push(`This workspace trial ends in ${Math.max(0, companyDays)} day${companyDays === 1 ? "" : "s"}, then Free limits apply.`);
  }
  if (company?.status === "requires_pro") {
    messages.push(`Posted revenue has reached the Company Pro threshold. Upgrade this workspace to keep importing, posting, and using AI.`);
  } else if (company?.plan === "free" && company.revenueThreshold > 0 && company.revenue / company.revenueThreshold >= 0.8) {
    messages.push(`Posted revenue is approaching the Company Pro threshold (${company.revenue.toLocaleString()} / ${company.revenueThreshold.toLocaleString()} ${company.revenueCurrency}).`);
  }
  if (!messages.length) return null;
  return (
    <div data-testid="billing-status-banner" role="status" className="border-b border-accent/25 bg-accent/10 px-4 py-2.5 md:px-8">
      <div className="mx-auto max-w-[1500px] text-xs leading-5">
        {messages.map((message) => <p key={message}>{message}</p>)}
      </div>
    </div>
  );
}

export function useBillingContext() {
  return useGetBillingMe();
}
