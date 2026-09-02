import { useState } from "react";
import { Redirect, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetFirmOverviewQueryKey, getGetFirmProfileQueryKey, getGetOrganizationContextQueryKey, useCreateEngagementOnboarding, useGetBillingMe, useGetFirmProfile, type EngagementService } from "@workspace/api-client-react";
import { PageHeading } from "@/components/page-chrome";
import { primaryFirmBilling } from "@/lib/billing-ui";
import { currentClosePeriod, DEFAULT_ENGAGEMENT_TERMS, ENGAGEMENT_SERVICE_OPTIONS, monthInputToPeriod, periodToMonthInput, showsFirmNavigation, storeEngagementInviteLink } from "@/lib/firm-landing";
import { notify } from "@/lib/notify";
import { useOrgContext } from "@/lib/workspace-context";

export default function FirmClientOnboardingPage() {
  const orgContext = useOrgContext();
  const firm = orgContext?.firms[0];
  const billingQuery = useGetBillingMe();
  const firmBilling = primaryFirmBilling(billingQuery.data, firm?.firmId);
  const firmProfile = useGetFirmProfile({ query: { queryKey: getGetFirmProfileQueryKey(), enabled: Boolean(firm) } });
  const [, setLocation] = useLocation();
  const existingClientId = Number(new URLSearchParams(window.location.search).get("clientId") ?? 0);
  const invitedEngagement = orgContext?.engagements.find((engagement) =>
    engagement.clientId === existingClientId
    && engagement.firmId === firm?.firmId
    && engagement.status === "provisional"
    && engagement.canManageFirm
  );
  const queryClient = useQueryClient();
  const create = useCreateEngagementOnboarding();
  const [step, setStep] = useState<"form" | "preview">("form");
  const [form, setForm] = useState({
    name: invitedEngagement?.companyName ?? "",
    legalName: "",
    functionalCurrency: "AED",
    basis: "IFRS",
    period: currentClosePeriod(),
    services: ["bookkeeping"] as EngagementService[],
    agreedTransactionsPerMonth: "120",
    agreedRevenuePerYear: "",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "",
    feeNote: "",
    termsText: DEFAULT_ENGAGEMENT_TERMS,
    signerEmail: "",
  });
  if (!showsFirmNavigation(orgContext?.mode, firmBilling?.fullAccess ?? true)) {
    if (firmBilling && !firmBilling.fullAccess) return <Redirect to="/billing/firm" />;
    return <Redirect to="/user-portal" />;
  }

  const toggleService = (id: EngagementService) => {
    setForm((current) => ({
      ...current,
      services: current.services.includes(id)
        ? current.services.filter((service) => service !== id)
        : [...current.services, id],
    }));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!firm) return;
    if (step === "form") {
      if (!form.services.length) return;
      setStep("preview");
      return;
    }
    create.mutate({
      firmId: firm.firmId,
      data: {
        ...form,
        clientId: invitedEngagement?.clientId,
        agreedTransactionsPerMonth: Number(form.agreedTransactionsPerMonth),
        agreedRevenuePerYear: Number(form.agreedRevenuePerYear),
        endDate: form.endDate || null,
        feeNote: form.feeNote || null,
      },
    }, {
      onSuccess: (onboarding) => {
        if (onboarding.inviteLink) storeEngagementInviteLink(onboarding.clientId, onboarding.inviteLink);
        queryClient.invalidateQueries({ queryKey: getGetFirmOverviewQueryKey({ firmId: firm.firmId }) });
        queryClient.invalidateQueries({ queryKey: getGetOrganizationContextQueryKey() });
        notify.success(onboarding.emailDeliveryStatus === "failed" ? "Contract created" : "Contract sent", {
          description: onboarding.emailDeliveryStatus === "failed"
            ? `Email was not sent. Copy the signing link from ${onboarding.clientName}.`
            : `Sent to ${onboarding.signerEmail}.`,
        });
        setLocation(`/firm-clients/${onboarding.clientId}`);
      },
    });
  };

  const firmLegalName = firmProfile.data?.legalName ?? firm?.firmName ?? "Your firm";

  return (
    <div data-testid="firm-client-onboarding">
      <PageHeading eyebrow="Practice onboarding" title="Onboard a client" description="Define the engagement, freeze the agreed volume and revenue, then send the contract for in-app signature." />
      <form onSubmit={submit} className="mx-auto max-w-3xl space-y-6">
        {step === "form" ? (
          <>
              {invitedEngagement ? (
                <section className="rounded-lg border border-primary/20 bg-primary/5 p-5">
                  <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Client invitation accepted</div>
                  <h2 className="mt-2 text-base font-semibold">{invitedEngagement.companyName}</h2>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">Define the engagement terms below. The contract will be sent to the client’s registered owner email, and access remains provisional until signing and firm confirmation.</p>
                </section>
              ) : <section className="rounded-lg border border-card-border bg-card p-5 grid gap-4 sm:grid-cols-2">
              <h2 className="text-sm font-semibold sm:col-span-2">Client identity</h2>
              <label className="text-xs font-medium">Client name<input required data-testid="input-onboard-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" /></label>
              <label className="text-xs font-medium">Legal name<input required data-testid="input-onboard-legal-name" value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" /></label>
              <label className="text-xs font-medium">Functional currency<select value={form.functionalCurrency} onChange={(event) => setForm({ ...form, functionalCurrency: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="AED">AED</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option></select></label>
              <label className="text-xs font-medium">Reporting basis<select value={form.basis} onChange={(event) => setForm({ ...form, basis: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="IFRS">IFRS</option><option value="IFRS for SMEs">IFRS for SMEs</option></select></label>
              <label className="text-xs font-medium sm:col-span-2">Close period<input required data-testid="input-onboard-period" type="month" value={periodToMonthInput(form.period)} onChange={(event) => setForm({ ...form, period: monthInputToPeriod(event.target.value) })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" /></label>
              </section>}
            <section className="rounded-lg border border-card-border bg-card p-5 space-y-3">
              <h2 className="text-sm font-semibold">Services</h2>
              <div className="flex flex-wrap gap-2">
                {ENGAGEMENT_SERVICE_OPTIONS.map((service) => (
                  <label key={service.id} className={`rounded-full border px-3 py-1 text-[11px] ${form.services.includes(service.id) ? "border-primary bg-primary/10" : "border-border"}`}>
                    <input type="checkbox" className="sr-only" checked={form.services.includes(service.id)} onChange={() => toggleService(service.id)} />
                    {service.label}
                  </label>
                ))}
              </div>
            </section>
            <section className="rounded-lg border border-card-border bg-card p-5 grid gap-4 sm:grid-cols-2">
              <h2 className="text-sm font-semibold sm:col-span-2">Agreed commercial terms</h2>
              <label className="text-xs font-medium">Transactions / month<input required data-testid="input-onboard-transactions" type="number" min={1} value={form.agreedTransactionsPerMonth} onChange={(event) => setForm({ ...form, agreedTransactionsPerMonth: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" /></label>
              <label className="text-xs font-medium">Revenue / year ({form.functionalCurrency})<input required data-testid="input-onboard-revenue" type="number" min={1} step="0.01" value={form.agreedRevenuePerYear} onChange={(event) => setForm({ ...form, agreedRevenuePerYear: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" /></label>
              <label className="text-xs font-medium">Start date<input required type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" /></label>
              <label className="text-xs font-medium">End date<input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" /></label>
              <label className="text-xs font-medium sm:col-span-2">Fee note<input value={form.feeNote} onChange={(event) => setForm({ ...form, feeNote: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" /></label>
              <label className="text-xs font-medium sm:col-span-2">Terms<textarea required data-testid="input-onboard-terms" rows={8} value={form.termsText} onChange={(event) => setForm({ ...form, termsText: event.target.value })} className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>
              {invitedEngagement
                ? <p className="text-xs text-muted-foreground sm:col-span-2">Signer: the client’s registered owner email</p>
                : <label className="text-xs font-medium sm:col-span-2">Signer email<input required type="email" data-testid="input-onboard-signer" value={form.signerEmail} onChange={(event) => setForm({ ...form, signerEmail: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" /></label>}
            </section>
          </>
        ) : (
          <section className="rounded-lg border border-primary/20 bg-card p-5 space-y-4" data-testid="section-contract-preview">
            <h2 className="text-sm font-semibold">Confirm before send</h2>
            <p className="text-xs text-muted-foreground">These terms are frozen on send. The client signs this acknowledgement in the app.</p>
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              <div>Firm legal name: {firmLegalName}</div>
              <div>Client: {form.legalName || form.name}</div>
              <div>Services: {form.services.map((id) => ENGAGEMENT_SERVICE_OPTIONS.find((option) => option.id === id)?.label ?? id).join(", ")}</div>
              <div>Transactions / month: {form.agreedTransactionsPerMonth}</div>
              <div>Revenue / year: {form.agreedRevenuePerYear} {form.functionalCurrency}</div>
              <div>Dates: {form.startDate}{form.endDate ? ` → ${form.endDate}` : " · ongoing"}</div>
              <div className="sm:col-span-2">Fee: {form.feeNote || "As agreed separately"}</div>
              <div className="sm:col-span-2">Signer: {invitedEngagement ? "Client’s registered owner email" : form.signerEmail}</div>
            </dl>
            <div>
              <div className="text-[11px] font-semibold">Terms</div>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{form.termsText}</p>
            </div>
          </section>
        )}
        <div className="flex justify-end gap-2">
          {step === "preview" && <button type="button" data-testid="button-back-onboarding" onClick={() => setStep("form")} className="rounded-md border border-border px-4 py-2.5 text-xs font-semibold">Back</button>}
          <button data-testid="button-send-engagement-contract" disabled={create.isPending || !firm} className="rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
            {create.isPending ? "Sending…" : step === "form" ? "Review contract" : "Send contract"}
          </button>
        </div>
      </form>
    </div>
  );
}
