import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetOrganizationContextQueryKey, useGetEngagementContractInvitation, useSignEngagementContractInvitation } from "@workspace/api-client-react";
import { PageHeading, QueryState } from "@/components/page-chrome";
import { ENGAGEMENT_SERVICE_OPTIONS } from "@/lib/firm-landing";
import { notify } from "@/lib/notify";

const money = (value: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);

export default function EngagementContractSignPage({ token, onSigned }: { token: string; onSigned: () => void }) {
  const queryClient = useQueryClient();
  const preview = useGetEngagementContractInvitation(token);
  const sign = useSignEngagementContractInvitation();
  const [signerName, setSignerName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const contract = preview.data;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10" data-testid="engagement-contract-sign">
      <PageHeading eyebrow="Engagement contract" title="Review and sign" description="This is an in-app acknowledgement stored on the engagement. It is not a qualified electronic signature." />
      <QueryState loading={preview.isLoading} error={preview.isError} empty={!contract} onRetry={() => preview.refetch()}>
        {contract && (
          <div className="space-y-5">
            <section className="rounded-lg border border-card-border bg-card p-5 text-sm">
              <div className="font-semibold">{contract.firmName}</div>
              <p className="mt-1 text-xs text-muted-foreground">and {contract.clientName}</p>
              <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
                <div>Services: {contract.terms.services.map((service) => ENGAGEMENT_SERVICE_OPTIONS.find((option) => option.id === service)?.label ?? service).join(", ")}</div>
                <div>Transactions / month: {contract.terms.agreedTransactionsPerMonth}</div>
                <div>Revenue / year: {money(contract.terms.agreedRevenuePerYear, contract.terms.agreedRevenueCurrency)}</div>
                <div>Dates: {contract.terms.startDate}{contract.terms.endDate ? ` → ${contract.terms.endDate}` : " · ongoing"}</div>
              </dl>
              <p className="mt-4 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{contract.terms.termsText}</p>
            </section>
            {contract.pdfBase64 && (
              <iframe title="Engagement contract PDF" className="h-[420px] w-full rounded-md border border-border" src={`data:application/pdf;base64,${contract.pdfBase64}`} />
            )}
            <form className="rounded-lg border border-card-border bg-card p-5 space-y-3" onSubmit={(event) => {
              event.preventDefault();
              sign.mutate({ token, data: { signerName, accepted } }, {
                onSuccess: () => {
                  queryClient.invalidateQueries({ queryKey: getGetOrganizationContextQueryKey() });
                  notify.success("Contract signed", { description: "The firm has five days to confirm the engagement." });
                  onSigned();
                },
              });
            }}>
              <label className="block text-xs font-medium">Typed legal name<input required data-testid="input-contract-signer-name" value={signerName} onChange={(event) => setSignerName(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" /></label>
              <label className="flex items-start gap-2 text-xs"><input required data-testid="checkbox-contract-accept" type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>I agree to these terms of engagement.</span></label>
              <button data-testid="button-sign-engagement-contract" disabled={sign.isPending || contract.status !== "sent"} className="rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{sign.isPending ? "Signing…" : "Sign contract"}</button>
            </form>
          </div>
        )}
      </QueryState>
    </main>
  );
}
