import { CircleAlert, Filter, RefreshCw, X } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[.19em] text-primary">{eyebrow}</div>
        <h1 className="mt-2 font-display text-[34px] leading-none tracking-tight text-foreground md:text-[42px]">{title}</h1>
        <p className="mt-3 max-w-2xl text-[13px] leading-5 text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function Metric({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-5 ${accent ? "border-primary/30 bg-primary text-primary-foreground" : "border-card-border bg-card"}`}>
      <div className={`font-mono text-[10px] uppercase tracking-[.13em] ${accent ? "text-primary-foreground/65" : "text-muted-foreground"}`}>{label}</div>
      <div className="mt-3 font-display text-[31px] leading-none">{value}</div>
      <div className={`mt-3 text-[11px] ${accent ? "text-primary-foreground/65" : "text-muted-foreground"}`}>{note}</div>
    </div>
  );
}

export function LoadingRows({ count = 4, cols = 4 }: { count?: number; cols?: number }) {
  return (
    <div className="space-y-2" data-testid="state-loading">
      {Array.from({ length: count }).map((_, row) => (
        <div key={row} className="flex gap-4 rounded-md border border-border/50 bg-card/60 p-4">
          {Array.from({ length: cols }).map((__, col) => (
            <div key={col} className={`skeleton h-3 rounded ${col === 0 ? "w-1/4" : "w-1/6"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function QueryState({
  loading,
  error,
  empty,
  children,
  onRetry,
  filtered,
  onClearFilters,
}: {
  loading: boolean;
  error: boolean;
  empty: boolean;
  children: ReactNode;
  onRetry: () => void;
  filtered?: boolean;
  onClearFilters?: () => void;
}) {
  if (loading) return <LoadingRows />;
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-14 text-center" data-testid="state-error">
        <CircleAlert className="mb-3 text-destructive" size={23} />
        <h3 className="text-sm font-semibold">We couldn't load this view</h3>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">The ledger service did not return a usable response. Your work is safe.</p>
        <button data-testid="button-retry" onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-md bg-card px-3 py-2 text-xs font-semibold shadow-sm hover:bg-muted">
          <RefreshCw size={13} /> Try again
        </button>
      </div>
    );
  }
  if (empty && filtered) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 py-14 text-center" data-testid="state-empty-filtered">
        <div className="mb-3 grid size-10 place-items-center rounded-full bg-secondary text-primary"><Filter size={18} /></div>
        <h3 className="text-sm font-semibold">No lines match your filters</h3>
        <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Nothing in this view fits the current search and filters. Loosen or clear them to see more.</p>
        {onClearFilters && (
          <button data-testid="button-clear-filters-empty-state" type="button" onClick={onClearFilters} className="mt-4 inline-flex items-center gap-2 rounded-md bg-card px-3 py-2 text-xs font-semibold shadow-sm hover:bg-muted">
            <X size={13} /> Clear filters
          </button>
        )}
      </div>
    );
  }
  if (empty) return <div data-testid="state-empty" className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-14 text-center text-sm text-muted-foreground">Nothing to show yet.</div>;
  return <>{children}</>;
}
