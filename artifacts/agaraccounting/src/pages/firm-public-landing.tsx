import { Link, useRoute } from "wouter";
import { useAuth } from "@clerk/react";
import { getGetPublicFirmLandingQueryKey, useGetPublicFirmLanding } from "@workspace/api-client-react";
import { ArrowRight } from "lucide-react";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "F";
}

export function FirmPublicLandingPage({ slug, params }: { slug?: string; params?: { slug?: string } }) {
  const [, routeParams] = useRoute("/f/:slug");
  const resolved = (slug ?? params?.slug ?? routeParams?.slug ?? "").trim().toLowerCase();
  const landing = useGetPublicFirmLanding(resolved, {
    query: { queryKey: getGetPublicFirmLandingQueryKey(resolved), enabled: Boolean(resolved) },
  });
  const { isSignedIn } = useAuth();

  if (!resolved) {
    return <UnavailableLanding />;
  }
  if (landing.isLoading) {
    return <div className="grid min-h-[100dvh] place-items-center bg-background text-xs text-muted-foreground">Loading practice page…</div>;
  }
  if (landing.isError || !landing.data) {
    return <UnavailableLanding />;
  }

  const firm = landing.data;
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background px-5 py-10" data-testid="firm-public-landing">
      <div className="w-full max-w-[420px]">
        <div className="rounded-lg border border-card-border bg-card p-7 shadow-md sm:p-9">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center overflow-hidden rounded-lg bg-muted">
              {firm.logoUrl
                ? <img src={firm.logoUrl} alt="" className="size-10 object-cover" />
                : <span className="font-display text-sm font-semibold">{initials(firm.name)}</span>}
            </div>
            <div>
              <div className="font-display text-[22px] leading-none tracking-tight">{firm.name}</div>
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[.2em] text-muted-foreground">{firm.legalName}</div>
            </div>
          </div>
          <div className="mt-10">
            <div className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Secure access</div>
            <h1 className="mt-3 font-display text-[36px] leading-[.98] tracking-tight">{firm.headline}</h1>
            {firm.tagline && <p className="mt-4 text-[13px] leading-6 text-muted-foreground">{firm.tagline}</p>}
            {!firm.tagline && (
              <p className="mt-4 text-[13px] leading-6 text-muted-foreground">
                Sign in to open your private bookkeeping review desk with {firm.name}.
              </p>
            )}
            <Link
              data-testid="button-firm-landing-login"
              href="/sign-in"
              className="focus-ring mt-7 flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5"
            >
              Sign in or create account
            </Link>
            {isSignedIn && (
              <Link href="/" className="mt-4 flex w-full items-center justify-center gap-1 text-[12px] font-semibold text-primary underline-offset-2 hover:underline">
                Continue to workspace <ArrowRight size={12} />
              </Link>
            )}
          </div>
        </div>
        <p className="mt-5 text-center font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground/70">
          Powered by AgarAccounting AI
        </p>
      </div>
    </main>
  );
}

function UnavailableLanding() {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background px-5 py-10" data-testid="firm-public-landing-unavailable">
      <div className="w-full max-w-[420px] rounded-lg border border-card-border bg-card p-7 text-center shadow-md sm:p-9">
        <h1 className="font-display text-[28px] leading-tight tracking-tight">This practice page is not available</h1>
        <p className="mt-3 text-[13px] leading-6 text-muted-foreground">The firm landing is unpublished, or this address is not in use.</p>
        <Link href="/sign-in" className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground">Sign in to AgarAccounting AI</Link>
      </div>
    </main>
  );
}

export default FirmPublicLandingPage;
