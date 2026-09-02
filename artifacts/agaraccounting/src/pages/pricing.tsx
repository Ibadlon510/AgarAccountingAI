import { useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { Link } from "wouter";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const brandMarkUrl = `${basePath}/mark.svg`;
const INTRO_PRICING_ENDS_AT = new Date("2026-12-31T23:59:59+04:00").getTime();

function IntroPricingCountdown({ now }: { now: number }) {
  const remaining = Math.max(0, INTRO_PRICING_ENDS_AT - now);

  if (remaining === 0) {
    return <p className="mt-4 text-[11px] font-semibold text-muted-foreground">Standard list pricing is now active.</p>;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return (
    <p data-testid="pricing-intro-countdown" className="mt-4 text-[11px] font-semibold text-primary">
      Standard list pricing begins in {days}d {String(hours).padStart(2, "0")}h {String(minutes).padStart(2, "0")}m {String(seconds).padStart(2, "0")}
    </p>
  );
}

const companyPlans = [
  {
    name: "Company Free",
    price: "AED 0",
    detail: "For getting a bookkeeping workspace ready for review.",
    features: ["5 statement imports each month", "10 AI review actions", "0.5 GB of evidence storage"],
  },
  {
    name: "Company Pro",
    price: "AED 29",
    listPrice: "AED 99",
    detail: "For companies that need more room to close and report.",
    features: ["100 statement imports each month", "1,000 AI review actions", "5 GB of evidence storage", "Optional system branding on new reports"],
    featured: true,
  },
];

export default function PricingPage() {
  const [view, setView] = useState<"company" | "firm">("company");
  const [now, setNow] = useState(() => Date.now());
  const isFirmView = view === "firm";
  const introActive = now < INTRO_PRICING_ENDS_AT;
  const plans = isFirmView
    ? [{
      name: "Firm Pro",
      price: "AED 149",
      listPrice: "AED 479",
      detail: "For bookkeeping firms managing client engagements.",
      features: ["Practice dashboard and client workspaces", "Engagement onboarding and contracts", "White-labelled firm landing page", "Up to 5 firm-managed workspaces"],
      benefits: ["Your engaged clients receive discounted Company Pro rates: AED 19/mo introductory and AED 69/mo standard"],
      featured: true,
    }]
    : companyPlans;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="min-h-[100dvh] bg-background px-5 py-8 sm:py-12" data-testid="pricing-page">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <img src={brandMarkUrl} alt="" className="size-9 rounded-lg" />
            <span className="font-display text-xl tracking-tight">AgarAccounting AI</span>
          </Link>
          <Link href="/sign-in" className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground">
            Sign in <ArrowRight size={13} />
          </Link>
        </header>

        <section className="mx-auto max-w-2xl py-16 text-center sm:py-20">
          <div className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Simple plans for clearer closes</div>
          <h1 className="mt-4 font-display text-[42px] leading-[.98] tracking-tight sm:text-[56px]">Pricing that grows with your practice.</h1>
          <p className="mt-5 text-sm leading-6 text-muted-foreground">{isFirmView ? "Manage client engagements with a practice workspace built for bookkeeping firms." : "Start with the essentials for free and upgrade when your company needs more imports, AI review capacity, and evidence storage."}</p>
          <p className="mt-4 text-[11px] leading-5 text-muted-foreground">Introductory rates are shown below and end 31 December 2026. Standard list prices resume on 1 January 2027.</p>
          <IntroPricingCountdown now={now} />
        </section>

        <div className="mx-auto mb-6 flex w-fit rounded-md border border-border bg-card p-1" role="tablist" aria-label="Pricing audience">
          <button type="button" role="tab" aria-selected={!isFirmView} onClick={() => setView("company")} className={`rounded px-4 py-2 text-xs font-semibold ${!isFirmView ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            Company pricing
          </button>
          <button type="button" role="tab" aria-selected={isFirmView} onClick={() => setView("firm")} className={`rounded px-4 py-2 text-xs font-semibold ${isFirmView ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            Firm pricing
          </button>
        </div>

        <section aria-label={`${isFirmView ? "Firm" : "Company"} pricing plans`} className={`mx-auto grid gap-4 ${isFirmView ? "max-w-2xl" : "max-w-4xl lg:grid-cols-2"}`}>
          {plans.map((plan) => (
            <article key={plan.name} className={`flex flex-col rounded-lg border p-5 md:p-6 ${plan.featured ? "border-primary/50 bg-primary/[.04] shadow-md" : "border-card-border bg-card"}`}>
              {plan.featured && <div className="mb-4 self-start rounded-full bg-primary px-2.5 py-1 font-mono text-[9px] uppercase tracking-[.1em] text-primary-foreground">Most popular</div>}
              <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">{plan.name}</div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-display text-3xl tracking-tight">{introActive || !plan.listPrice ? plan.price : plan.listPrice}</span>
                {plan.listPrice && <span className="text-xs text-muted-foreground">{introActive ? `/mo intro · ${plan.listPrice}/mo list` : "/mo"}</span>}
              </div>
              {!plan.listPrice && <div className="mt-1 text-xs text-muted-foreground">Forever free</div>}
              <p className="mt-4 min-h-12 text-xs leading-5 text-muted-foreground">{plan.detail}</p>
              <ul className="mt-5 space-y-3 border-t border-border pt-5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2 text-xs leading-5">
                    <Check size={14} className="mt-0.5 shrink-0 text-primary" />
                    <span>{feature}</span>
                  </li>
                ))}
                {"benefits" in plan && plan.benefits.map((benefit) => (
                  <li key={benefit} className="flex gap-2 border-t border-primary/15 pt-3 text-xs font-semibold leading-5 text-primary">
                    <Check size={14} className="mt-0.5 shrink-0" />
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
              <Link href="/sign-in" className={`mt-7 inline-flex h-10 items-center justify-center rounded-md px-4 text-xs font-semibold ${plan.featured ? "bg-primary text-primary-foreground" : "border border-border text-foreground hover:border-primary/40"}`}>
                Get started <ArrowRight size={13} className="ml-1.5" />
              </Link>
            </article>
          ))}
        </section>

        {!isFirmView && <p className="mx-auto mt-6 max-w-3xl text-center text-[11px] leading-5 text-muted-foreground">Companies working with a subscribed firm may receive the Company Pro firm-member rate of AED 19/mo introductory pricing and AED 69/mo standard pricing.</p>}

        <footer className="mt-14 border-t border-border pt-5 text-center text-[10px] uppercase tracking-[.14em] text-muted-foreground/70">
          Secure session · Human posting control
        </footer>
      </div>
    </main>
  );
}