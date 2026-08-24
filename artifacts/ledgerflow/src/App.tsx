import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation } from 'wouter';
import {
  ArrowDownLeft, ArrowRight, BarChart3, BookOpenCheck, Check, ChevronDown, ChevronRight, History,
  CircleAlert, CircleCheck, CircleHelp, FileCheck2, FileSpreadsheet, Filter, Landmark,
  LayoutDashboard, LoaderCircle, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw,
  Search, Settings2, Sparkles, Table2, UploadCloud, X
} from 'lucide-react';
import {
  getGetClientsQueryKey, getGetFinancialStatementsQueryKey, getGetJournalEntriesQueryKey, getGetLedgerOverviewQueryKey,
  getGetStatementLinesQueryKey, getGetTrialBalanceQueryKey, getGetBulkTransitionAuditsQueryKey, useApproveJournalEntry,
  useCreateClient, useCreateStatementLine, useGetClients, useGetFinancialStatements, useGetJournalEntries, useGetLedgerOverview,
  useConfirmAICopilotAction, useGetBankAccounts, useGetLedgerflowAISettings, useGetStatementLines, useGetTrialBalance,
  useGetBulkTransitionAudits, usePostJournalEntry, useRemoveLedgerflowAICredential, useTestLedgerflowAISettings,
  useUpdateClient, useUpdateLedgerflowAISettings
} from '@workspace/api-client-react';
import type {
  Client, FinancialStatements, JournalEntry, StatementImportResult, StatementLine, StatementLineInput, StatementSection
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  clearUserScopedState,
  getActiveWorkspaceStorageKey,
  useAuth,
  type AuthUser,
} from '@workspace/replit-auth-web';
import { AssistantFAB } from './components/assistant-fab';
const queryClient = new QueryClient();
const nav = [
  { href: '/', label: 'Close overview', icon: LayoutDashboard },
  { href: '/import-statement', label: 'Import statement', icon: UploadCloud },
  { href: '/statement-lines', label: 'Statement lines', icon: Table2 },
  { href: '/journal-entries', label: 'Journal entries', icon: BookOpenCheck },
  { href: '/trial-balance', label: 'Trial balance', icon: BarChart3 },
  { href: '/financial-statements', label: 'Financial statements', icon: FileSpreadsheet },
];

const classificationAccounts = [
  'Revenue', 'Other income', 'Travel & entertainment', 'Software & subscriptions',
  'Office expenses', 'Communication expenses', 'Rent expense', 'Payroll', 'Bank charges', 'General expenses',
];
const money = (value: number, currency = 'AED') => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
const MAX_IMPORT_FILE_SIZE = 15 * 1024 * 1024;
const shortDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
export type ClientWorkspace = { activeClient: Client | undefined; clients: Client[]; setActiveClientId: (id: number) => void };
export const ClientContext = createContext<ClientWorkspace | null>(null);
export function useClientWorkspace() {
  const context = useContext(ClientContext);
  if (!context) throw new Error('Client workspace is not available');
  return context;
}

function AddClientDialog({ onClose }: { onClose: () => void }) {
  const { setActiveClientId } = useClientWorkspace();
  const mutation = useCreateClient();
  const [form, setForm] = useState({ name: '', legalName: '' });
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    mutation.mutate({ data: form }, {
      onSuccess: (client) => {
        queryClient.invalidateQueries({ queryKey: getGetClientsQueryKey() });
        setActiveClientId(client.id);
        onClose();
      },
    });
  };
  return <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-lg border border-card-border bg-card p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="add-client-title"><div className="flex items-start justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Workspace setup</div><h2 id="add-client-title" className="mt-2 text-lg font-semibold">Add client</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">Create a separate IFRS / AED workspace for a new client.</p></div><button data-testid="button-close-add-client" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X size={17} /></button></div><form onSubmit={submit} className="mt-6 space-y-4"><label className="block text-xs font-medium">Client name<input data-testid="input-client-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Northstar Advisory" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Legal name<input data-testid="input-client-legal-name" required value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} placeholder="e.g. Northstar Advisory FZ-LLC" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label>{mutation.isError && <p className="text-xs text-destructive">This client could not be created. Check the details and try again.</p>}<button data-testid="button-submit-client" disabled={mutation.isPending} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-50">{mutation.isPending ? 'Creating workspace…' : <><Plus size={14} /> Create client workspace</>}</button></form></div></div>;
}

const aiModels = {
  managed_openai: ['gpt-5.6-luna'],
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  anthropic: ['claude-3-5-sonnet-latest', 'claude-3-7-sonnet-latest', 'claude-sonnet-4-20250514'],
} as const;
function WorkspaceSettingsDialog({ client, onClose }: { client: Client; onClose: () => void }) {
  const mutation = useUpdateClient();
  const [form, setForm] = useState({
    name: client.name,
    legalName: client.legalName,
    functionalCurrency: client.functionalCurrency,
    basis: client.basis,
    period: client.period,
  });
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    mutation.mutate({ id: client.id, data: form }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetClientsQueryKey() });
        onClose();
      },
    });
  };
  const update = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }));
  return <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4 backdrop-blur-sm"><div className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-lg border border-card-border bg-card p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="workspace-settings-title"><div className="flex items-start justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Workspace configuration</div><h2 id="workspace-settings-title" className="mt-2 text-lg font-semibold">Workspace settings</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">Keep the client profile, reporting basis, currency, and close period aligned.</p></div><button data-testid="button-close-workspace-settings" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X size={17} /></button></div><form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2"><label className="block text-xs font-medium">Client name<input data-testid="input-settings-client-name" required value={form.name} onChange={(event) => update('name', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Legal name<input data-testid="input-settings-legal-name" required value={form.legalName} onChange={(event) => update('legalName', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Functional currency<select data-testid="select-settings-currency" value={form.functionalCurrency} onChange={(event) => update('functionalCurrency', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option value="AED">AED — UAE dirham</option><option value="USD">USD — US dollar</option><option value="EUR">EUR — euro</option><option value="GBP">GBP — pound sterling</option></select></label><label className="block text-xs font-medium">Reporting basis<select data-testid="select-settings-basis" value={form.basis} onChange={(event) => update('basis', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option value="IFRS">IFRS</option><option value="IFRS for SMEs">IFRS for SMEs</option></select></label><label className="block text-xs font-medium sm:col-span-2">Close period<input data-testid="input-settings-period" required value={form.period} onChange={(event) => update('period', event.target.value)} placeholder="e.g. August 2026" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label>{mutation.isError && <p className="text-xs text-destructive sm:col-span-2">Settings could not be saved. Check the details and try again.</p>}<div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted">Cancel</button><button data-testid="button-save-workspace-settings" disabled={mutation.isPending} className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{mutation.isPending ? 'Saving…' : 'Save settings'}</button></div></form><AIProviderSettingsPanel clientId={client.id} /></div></div>;
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  const steps = [
    ['01', 'Import evidence', 'Upload a PDF, CSV, XLS, or XLSX statement. LedgerFlow turns it into reviewable bank lines.'],
    ['02', 'Review suggestions', 'Expand a line to inspect the proposed debit and credit accounts. AI suggestions stay unposted until approved.'],
    ['03', 'Approve and post', 'Use Approve & post only after the journal entry makes sense. Posted entries flow into the trial balance and statements.'],
  ];
  return <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-lg border border-card-border bg-card p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="help-title"><div className="flex items-start justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">LedgerFlow guide</div><h2 id="help-title" className="mt-2 text-lg font-semibold">How the review desk works</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">LedgerFlow keeps a human approval step between AI suggestions and the ledger.</p></div><button data-testid="button-close-help" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X size={17} /></button></div><div className="mt-6 space-y-3">{steps.map(([number, title, description]) => <div key={number} className="flex gap-3 rounded-md border border-border bg-muted/20 p-3"><div className="font-mono text-[10px] text-primary">{number}</div><div><div className="text-xs font-semibold">{title}</div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{description}</p></div></div>)}</div><div className="mt-5 rounded-md border border-accent/25 bg-accent/10 p-3 text-[11px] leading-5 text-accent-foreground"><strong className="font-semibold">Need a quick answer?</strong> Open LedgerFlow AI from the sparkle button to ask about the selected client’s queue, entries, or reports.</div></div></div>;
}

function AuthLoadingState({ label = 'Checking your LedgerFlow session' }: { label?: string }) {
  return <div className="grid min-h-[100dvh] place-items-center bg-background px-5"><div className="flex items-center gap-3 rounded-lg border border-card-border bg-card px-5 py-4 text-sm shadow-sm" role="status" aria-live="polite"><LoaderCircle className="animate-spin text-primary" size={18} /><span>{label}…</span></div></div>;
}
function Shell({ children, user, onLogout }: { children: React.ReactNode; user: AuthUser; onLogout: () => void }) {
  const { activeClient, clients, setActiveClientId } = useClientWorkspace();
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'Account';
  const initials = [user.firstName?.[0], user.lastName?.[0]].filter(Boolean).join('').toUpperCase() || displayName.slice(0, 2).toUpperCase();
  const current = nav.find((item) => item.href === location)?.label ?? 'Close overview';
  return <div className="min-h-[100dvh] bg-background">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-300 md:translate-x-0 ${collapsed ? 'md:w-[76px]' : ''} ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex h-[78px] items-center border-b border-sidebar-border px-5"><div className="flex min-w-0 items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"><Landmark size={19} strokeWidth={2.2} /></div><div className={`${collapsed ? 'md:hidden' : ''}`}><div className="font-display text-[22px] leading-none tracking-tight text-sidebar-foreground">LedgerFlow</div><div className="mt-1 font-mono text-[9px] uppercase tracking-[.2em] text-sidebar-foreground/50">Review desk</div></div></div><button aria-label="Close navigation" data-testid="button-close-navigation" className="ml-auto rounded-md p-1.5 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground md:hidden" onClick={() => setMobileOpen(false)}><X size={17} /></button></div>
      <div className={`px-3 pt-6 ${collapsed ? 'md:px-2' : ''}`}><div className={`mb-3 px-3 font-mono text-[9px] font-medium uppercase tracking-[.18em] text-sidebar-foreground/40 ${collapsed ? 'md:hidden' : ''}`}>Workspace</div><nav className="space-y-1">{nav.map(({ href, label, icon: Icon }) => { const active = href === '/' ? location === '/' : location.startsWith(href); return <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`} onClick={() => setMobileOpen(false)} className={`group flex items-center gap-3 rounded-md px-3 py-2.5 text-[13px] font-medium transition-colors ${active ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground'} ${collapsed ? 'md:justify-center md:px-0' : ''}`}><Icon size={17} strokeWidth={active ? 2.2 : 1.8} /><span className={collapsed ? 'md:hidden' : ''}>{label}</span>{active && !collapsed && <ChevronRight className="ml-auto" size={14} />}</Link>; })}</nav></div>
       <div className={`mt-auto border-t border-sidebar-border p-4 ${collapsed ? 'md:px-2' : ''}`}><div className={`mb-4 rounded-md border border-sidebar-border bg-sidebar-accent/40 p-3 ${collapsed ? 'md:hidden' : ''}`}><div className="flex items-center gap-2 text-[11px] font-semibold"><span className="size-1.5 rounded-full bg-sidebar-primary" /> {activeClient?.name ?? 'Client workspace'}</div><div className="mt-2 flex items-center justify-between font-mono text-[10px] text-sidebar-foreground/55"><span>IFRS / AED</span><span>{activeClient?.period ?? '—'}</span></div></div><button data-testid="button-settings" onClick={() => setSettingsOpen(true)} className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-[12px] text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground ${collapsed ? 'md:justify-center md:px-0' : ''}`}><Settings2 size={16} /><span className={collapsed ? 'md:hidden' : ''}>Workspace settings</span></button></div>
    </aside>
     <div className={`min-h-[100dvh] transition-[padding] duration-300 ${collapsed ? 'md:pl-[76px]' : 'md:pl-[248px]'}`}><header className="sticky top-0 z-30 flex h-[78px] items-center justify-between border-b border-border/80 bg-background/90 px-4 backdrop-blur-md md:px-8"><div className="flex items-center gap-3"><button data-testid="button-mobile-menu" aria-label="Open navigation" className="rounded-md p-2 hover:bg-muted md:hidden" onClick={() => setMobileOpen(true)}><Menu size={19} /></button><button data-testid="button-collapse-sidebar" aria-label="Toggle sidebar" className="hidden rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground md:block" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button><div className="hidden h-5 w-px bg-border md:block" /><div><div className="font-mono text-[9px] uppercase tracking-[.18em] text-muted-foreground">{activeClient?.name ?? 'Client'} / IFRS close</div><div className="mt-0.5 text-[13px] font-semibold">{current}</div></div></div><div className="flex items-center gap-2 md:gap-3"><select data-testid="select-client-workspace" value={activeClient?.id ?? ''} onChange={(event) => setActiveClientId(Number(event.target.value))} className="hidden h-9 max-w-[180px] rounded-md border border-input bg-card px-2 text-xs font-semibold md:block">{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select><button data-testid="button-add-client" onClick={() => setCreateClientOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"><Plus size={14} /><span className="hidden sm:inline">Add client</span></button><div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground lg:flex"><span className="size-1.5 rounded-full bg-primary" /> Books are in balance</div><button data-testid="button-help" onClick={() => setHelpOpen(true)} aria-label="Open help" className="grid size-8 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"><CircleHelp size={16} /></button><button data-testid="button-logout" onClick={onLogout} aria-label={`Sign out ${displayName}`} className="group flex items-center gap-2 rounded-full border border-border bg-card pl-1 pr-2.5 py-1 text-left hover:border-primary/40"><span className="grid size-7 place-items-center rounded-full bg-primary font-mono text-[10px] font-medium text-primary-foreground">{initials}</span><span className="hidden max-w-[120px] truncate text-[11px] font-semibold sm:inline">{displayName}</span><LogOut size={13} className="text-muted-foreground transition-colors group-hover:text-foreground" /></button></div></header><main className="mx-auto max-w-[1500px] px-4 py-7 md:px-8 lg:px-10"><div className="page-enter">{children}</div></main>{createClientOpen && <AddClientDialog onClose={() => setCreateClientOpen(false)} />}{settingsOpen && activeClient && <WorkspaceSettingsDialog client={activeClient} onClose={() => setSettingsOpen(false)} />}{helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}</div>
    <AssistantFAB />
  </div>;
}

function LoadingRows({ count = 4, cols = 4 }: { count?: number; cols?: number }) {
  return <div className="space-y-2" data-testid="state-loading">{Array.from({ length: count }).map((_, row) => <div key={row} className="flex gap-4 rounded-md border border-border/50 bg-card/60 p-4">{Array.from({ length: cols }).map((__, col) => <div key={col} className={`skeleton h-3 rounded ${col === 0 ? 'w-1/4' : 'w-1/6'}`} />)}</div>)}</div>;
}
function QueryState({ loading, error, empty, children, onRetry }: { loading: boolean; error: boolean; empty: boolean; children: React.ReactNode; onRetry: () => void }) {
  if (loading) return <LoadingRows />;
  if (error) return <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-14 text-center" data-testid="state-error"><CircleAlert className="mb-3 text-destructive" size={23} /><h3 className="text-sm font-semibold">We couldn't load this view</h3><p className="mt-1 max-w-sm text-xs text-muted-foreground">The ledger service did not return a usable response. Your work is safe.</p><button data-testid="button-retry" onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-md bg-card px-3 py-2 text-xs font-semibold shadow-sm hover:bg-muted"><RefreshCw size={13} /> Try again</button></div>;
  if (empty) return <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 py-14 text-center" data-testid="state-empty"><div className="mb-3 grid size-10 place-items-center rounded-full bg-secondary text-primary"><FileCheck2 size={18} /></div><h3 className="text-sm font-semibold">Nothing to review yet</h3><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">When the service sends records for this period, they will appear here with their source and review trail.</p></div>;
  return <>{children}</>;
}
function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="font-mono text-[10px] uppercase tracking-[.19em] text-primary">{eyebrow}</div><h1 className="mt-2 font-display text-[34px] leading-none tracking-tight text-foreground md:text-[42px]">{title}</h1><p className="mt-3 max-w-2xl text-[13px] leading-5 text-muted-foreground">{description}</p></div>{action}</div>;
}
function Metric({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) {
  return <div className={`rounded-lg border p-5 ${accent ? 'border-primary/30 bg-primary text-primary-foreground' : 'border-card-border bg-card'} lift-hover`}><div className={`font-mono text-[10px] uppercase tracking-[.13em] ${accent ? 'text-primary-foreground/65' : 'text-muted-foreground'}`}>{label}</div><div className="mt-3 font-display text-[31px] leading-none">{value}</div><div className={`mt-3 text-[11px] ${accent ? 'text-primary-foreground/65' : 'text-muted-foreground'}`}>{note}</div></div>;
}

function Home() {
  const { activeClient } = useClientWorkspace();
  const params = { clientId: activeClient?.id ?? 1 };
  const query = useGetLedgerOverview(params, { query: { queryKey: getGetLedgerOverviewQueryKey(params) } });
  const overview = query.data;
  return <div><PageHeading eyebrow="Monday, June 24 · Close control" title="Good morning, Alex." description="A clear view of what moved, what needs your judgment, and what is ready to stand behind." action={<Link href="/statement-lines" data-testid="link-review-lines" className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5">Review open lines <ArrowRight size={14} /></Link>} /><QueryState loading={query.isLoading} error={query.isError} empty={!overview} onRetry={() => query.refetch()}>{overview && <div className="space-y-6"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Close progress" value={`${overview.completionPercent}%`} note={`${overview.pendingReview} items still need review`} accent /><Metric label="Statement lines" value={overview.totalLines.toLocaleString()} note={`${overview.currencies.length} currencies in scope`} /><Metric label="Posted amount" value={money(overview.postedAmount)} note={`Through ${overview.period}`} /><Metric label="Currencies" value={overview.currencies.join(' · ')} note="Active bank feeds" /></div><div className="grid gap-6 xl:grid-cols-[1.35fr_.65fr]"><section className="rounded-lg border border-card-border bg-card p-5 md:p-6"><div className="flex items-start justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Close control / {overview.period}</div><h2 className="mt-2 text-base font-semibold">The desk at a glance</h2></div><span className="rounded-full bg-secondary px-2.5 py-1 font-mono text-[10px] text-primary">Active</span></div><div className="mt-6 flex items-end gap-5"><div className="relative size-[148px] shrink-0 rounded-full" style={{ background: `conic-gradient(hsl(var(--accent)) ${overview.completionPercent}%, hsl(var(--muted)) 0)` }}><div className="absolute inset-[10px] grid place-items-center rounded-full bg-card"><span className="font-display text-[34px]">{overview.completionPercent}<small className="text-lg">%</small></span></div></div><div className="pb-2"><p className="text-sm font-medium leading-6">Your review queue is moving well.</p><p className="mt-1 text-xs leading-5 text-muted-foreground">LedgerFlow has surfaced the evidence beside each suggestion so the final call stays yours.</p><Link href="/journal-entries" data-testid="link-view-suggestions" className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">Inspect AI suggestions <ChevronRight size={13} /></Link></div></div><div className="mt-7 grid grid-cols-3 border-t border-border pt-4"><div><div className="font-mono text-lg">{overview.pendingReview}</div><div className="mt-1 text-[10px] text-muted-foreground">Need judgment</div></div><div><div className="font-mono text-lg">{overview.totalLines - overview.pendingReview}</div><div className="mt-1 text-[10px] text-muted-foreground">Cleared lines</div></div><div><div className="font-mono text-lg">{overview.currencies.length}</div><div className="mt-1 text-[10px] text-muted-foreground">Currencies</div></div></div></section><section className="rounded-lg border border-accent/25 bg-accent/10 p-5 md:p-6"><div className="flex items-center gap-2 text-accent-foreground"><Sparkles size={16} /><span className="font-mono text-[10px] uppercase tracking-[.15em]">LedgerFlow note</span></div><h2 className="mt-5 font-display text-[27px] leading-[1.02]">A second pair of eyes, not another black box.</h2><p className="mt-4 text-[12px] leading-5 text-accent-foreground/70">Every suggestion is anchored to a bank line, a confidence score, and the accounts it touches. Approve only what you can explain.</p><div className="mt-8 flex items-center gap-2 border-t border-accent/20 pt-4 text-[11px] font-semibold text-accent-foreground"><CircleCheck size={15} /> Evidence attached to every decision</div></section></div><section className="rounded-lg border border-card-border bg-card p-5 md:p-6"><div className="flex items-center justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Next actions</div><h2 className="mt-2 text-base font-semibold">Keep the close moving</h2></div><span className="font-mono text-[10px] text-muted-foreground">3 lanes</span></div><div className="mt-5 grid gap-3 md:grid-cols-3"><ActionCard index="01" title="Review statement lines" detail={`${overview.pendingReview} lines are waiting for a call`} href="/statement-lines" icon={Table2} /><ActionCard index="02" title="Approve journal entries" detail="Confirm the postings LedgerFlow prepared" href="/journal-entries" icon={BookOpenCheck} /><ActionCard index="03" title="Check the trial balance" detail="Make sure debits and credits agree" href="/trial-balance" icon={BarChart3} /></div></section></div>}</QueryState></div>;
}
function ActionCard({ index, title, detail, href, icon: Icon }: { index: string; title: string; detail: string; href: string; icon: typeof Table2 }) {
  return <Link href={href} data-testid={`link-action-${index}`} className="group flex items-start gap-3 rounded-md border border-border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-secondary/40"><div className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-primary"><Icon size={16} /></div><div className="min-w-0"><div className="flex items-center gap-2"><span className="font-mono text-[9px] text-muted-foreground">{index}</span><h3 className="text-[12px] font-semibold">{title}</h3></div><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{detail}</p></div><ArrowRight className="ml-auto mt-1 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" size={14} /></Link>;
}

function ImportStatementPage() {
  const { activeClient } = useClientWorkspace();
  const [file, setFile] = useState<File | null>(null);
  const [currency, setCurrency] = useState('AED');
  const [state, setState] = useState<'idle' | 'reading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [importResult, setImportResult] = useState<StatementImportResult | null>(null);
  const submit = async () => {
    if (!file) return;
    if (file.size > MAX_IMPORT_FILE_SIZE) {
      setState('error');
      setMessage('Statement file is too large. Please choose a file smaller than 15 MB.');
      setImportResult(null);
      return;
    }
    setState('reading');
    setMessage('');
    setImportResult(null);
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
      const response = await fetch('/api/ledgerflow/import-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: activeClient?.id ?? 1, fileName: file.name, mimeType: file.type || 'application/octet-stream', contentBase64, currency }),
      });
      const data = await response.json().catch(() => ({})) as Partial<StatementImportResult> & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Import failed');
      setState('done');
      setImportResult(data as StatementImportResult);
      setMessage(data.message ?? `${data.importedCount ?? 0} statement lines are ready for review.`);
      queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey({ clientId: activeClient?.id ?? 1 }) });
      queryClient.invalidateQueries({ queryKey: getGetLedgerOverviewQueryKey({ clientId: activeClient?.id ?? 1 }) });
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Import failed');
    }
  };
  return <div><PageHeading eyebrow="Client intake / source document" title="Import a bank statement" description={`Choose a PDF, CSV, or Excel statement for ${activeClient?.name ?? 'this client'}. LedgerFlow extracts the transactions with AI and sends every line to review before it can affect the books.`} /><div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]"><section className="rounded-lg border border-card-border bg-card p-6"><div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary"><UploadCloud size={21} /></div><h2 className="mt-5 text-lg font-semibold">Statement file</h2><p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">Accepted formats: PDF, CSV, XLS, and XLSX. Keep the original bank export intact—LedgerFlow will normalize date, description, amount, direction, and currency.</p><label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-primary/35 bg-secondary/30 px-6 py-10 text-center transition-colors hover:bg-secondary/60"><UploadCloud className="text-primary" size={24} /><span className="mt-3 text-sm font-semibold">{file ? file.name : 'Choose a bank statement'}</span><span className="mt-1 text-[11px] text-muted-foreground">{file ? `${Math.round(file.size / 1024).toLocaleString()} KB ready to parse` : 'PDF, CSV, XLS, or XLSX · one statement at a time'}</span><input data-testid="input-statement-file" type="file" accept=".pdf,.csv,.xls,.xlsx,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setState('idle'); setMessage(''); setImportResult(null); }} /></label><div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end"><label className="block text-xs font-medium">Default statement currency<select value={currency} onChange={(event) => setCurrency(event.target.value)} className="mt-1.5 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option>AED</option><option>USD</option><option>EUR</option><option>GBP</option></select></label><button data-testid="button-parse-statement" onClick={submit} disabled={!file || state === 'reading'} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">{state === 'reading' ? 'Extracting statement lines…' : <><Sparkles size={14} /> Extract with AI</>}</button></div>{message && <div data-testid="import-statement-result" className={`mt-5 rounded-md border px-4 py-3 text-xs ${state === 'done' ? importResult?.duplicateCount ? 'border-accent/25 bg-accent/10 text-accent-foreground' : 'border-primary/25 bg-primary/5 text-primary' : 'border-destructive/25 bg-destructive/5 text-destructive'}`}>{message}{state === 'done' && importResult?.importedCount ? <Link href="/statement-lines" className="ml-2 font-semibold underline">Review imported lines</Link> : null}</div>}{importResult && importResult.duplicateCount > 0 && <section data-testid="import-duplicate-summary" className="mt-4 rounded-md border border-accent/25 bg-accent/5 p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-semibold">Duplicate review result</div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{importResult.importStatus === 'duplicate_file' ? 'The identical source file was previously imported for this client, so it was not queued again.' : 'Exact duplicate transaction keys were skipped. Existing review items remain unchanged.'}</p></div><span className="rounded-full bg-accent/15 px-2 py-1 font-mono text-[10px] text-accent-foreground">{importResult.duplicateCount} skipped</span></div>{importResult.duplicateLines.length > 0 && <ul className="mt-3 divide-y divide-accent/15 rounded border border-accent/15 bg-card">{importResult.duplicateLines.map((line, index) => <li key={`${line.date}-${line.description}-${index}`} className="px-3 py-2.5 text-[11px]"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{line.description}</span><span className="font-mono">{shortDate(line.date)} · {money(line.amount, line.currency)}</span></div><div className="mt-1 text-muted-foreground">{line.reason === 'already_imported' ? `Already in this client's review queue${line.existingLineId ? ` (line #${line.existingLineId})` : ''}.` : 'Repeated within this uploaded statement.'}</div></li>)}</ul>}</section>}</section><aside className="rounded-lg border border-accent/25 bg-accent/10 p-6"><div className="font-mono text-[10px] uppercase tracking-[.16em] text-accent-foreground">Review safeguard</div><h2 className="mt-3 font-display text-[28px] leading-[1.05]">AI recreates the lines. You decide what posts.</h2><div className="mt-6 space-y-4 text-xs leading-5 text-accent-foreground/75"><p><strong className="text-accent-foreground">1. Extract</strong><br />The system reads the source statement and proposes normalized bank movements.</p><p><strong className="text-accent-foreground">2. Verify</strong><br />Imported lines enter the review queue with the original file name retained as evidence.</p><p><strong className="text-accent-foreground">3. Post</strong><br />Only approved journal entries can move into the trial balance and financial statements.</p></div></aside></div></div>;
}

function AddLineDialog({ onClose }: { onClose: () => void }) {
  const { activeClient } = useClientWorkspace();
  const mutation = useCreateStatementLine();
  const [form, setForm] = useState<StatementLineInput>({ date: '2026-08-24', description: '', currency: 'AED', amount: 0, direction: 'outflow' });
  const set = (key: keyof StatementLineInput, value: string) => setForm((old) => ({ ...old, [key]: key === 'amount' ? Number(value) : value }));
  const submit = (event: React.FormEvent) => { event.preventDefault(); mutation.mutate({ data: { ...form, clientId: activeClient?.id ?? 1 } }, { onSuccess: onClose }); };
  return <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-lg border border-card-border bg-card p-6 shadow-2xl" role="dialog" aria-modal="true"><div className="flex items-start justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Manual adjustment / {activeClient?.name ?? 'client'}</div><h2 className="mt-2 text-lg font-semibold">Add statement line</h2></div><button data-testid="button-close-add-line" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X size={17} /></button></div><form onSubmit={submit} className="mt-6 space-y-4"><label className="block text-xs font-medium">Date<input data-testid="input-line-date" required type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Description<input data-testid="input-line-description" required value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. Cloud hosting invoice" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><div className="grid grid-cols-2 gap-3"><label className="block text-xs font-medium">Amount<input data-testid="input-line-amount" required min="0" step=".01" type="number" value={form.amount || ''} onChange={(e) => set('amount', e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Currency<select data-testid="select-line-currency" value={form.currency} onChange={(e) => set('currency', e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option>AED</option><option>USD</option><option>EUR</option><option>GBP</option><option>CAD</option></select></label></div><label className="block text-xs font-medium">Direction<select data-testid="select-line-direction" value={form.direction} onChange={(e) => set('direction', e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option value="outflow">Outflow / money out</option><option value="inflow">Inflow / money in</option></select></label>{mutation.isError && <p className="text-xs text-destructive">This line could not be added. Try again.</p>}<button data-testid="button-submit-line" disabled={mutation.isPending} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-50">{mutation.isPending ? 'Saving line…' : <><Plus size={14} /> Add to review queue</>}</button></form></div></div>;
}

function BulkTransitionHistory({ clientId, clientName }: { clientId: number; clientName?: string }) {
  const params = { clientId };
  const query = useGetBulkTransitionAudits(params, { query: { queryKey: getGetBulkTransitionAuditsQueryKey(params) } });
  const audits = query.data ?? [];

  return <section data-testid="bulk-transition-history" className="mt-6 rounded-lg border border-card-border bg-card">
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold"><History size={16} className="text-primary" /> Confirmation history</div>
        <p className="mt-1 text-[11px] text-muted-foreground">Immutable record of bulk approvals and postings confirmed in this client workspace.</p>
      </div>
      <span className="rounded-full bg-secondary px-2 py-1 font-mono text-[10px] text-primary">{audits.length} {audits.length === 1 ? 'transition' : 'transitions'}</span>
    </div>
    {query.isLoading ? <div className="p-5 text-xs text-muted-foreground">Loading confirmation history…</div> : query.isError ? <div className="p-5 text-xs text-destructive">Confirmation history could not be loaded. Refresh to try again.</div> : audits.length === 0 ? <div className="p-5 text-xs text-muted-foreground">Confirmed bulk transitions will appear here with the reviewer and affected records.</div> : <div className="divide-y divide-border">{audits.map((audit) => {
      const actorName = audit.actor.name || audit.actor.email || audit.actor.id;
      return <article key={audit.id} data-testid={`bulk-transition-audit-${audit.id}`} className="px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-2 py-1 font-mono text-[10px] font-semibold text-primary">{audit.fromStatus} <ArrowRight className="mx-0.5 inline" size={11} /> {audit.toStatus}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{clientName ?? `Client #${audit.clientId}`}</span>
            </div>
            <div className="mt-2 text-xs font-semibold">Confirmed by {actorName}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{new Date(audit.confirmedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</div>
          </div>
          <div className="grid gap-2 text-[10px] font-mono text-muted-foreground sm:grid-cols-2 lg:min-w-[430px]">
            <div className="rounded-md bg-muted/45 px-3 py-2"><span className="text-foreground">Entries</span><div className="mt-1 truncate" title={audit.entryIds.join(', ')}>{audit.entryIds.map((id) => `JE-${String(id).padStart(4, '0')}`).join(' · ')}</div></div>
            <div className="rounded-md bg-muted/45 px-3 py-2"><span className="text-foreground">Statement lines</span><div className="mt-1 truncate" title={audit.statementLineIds.join(', ')}>{audit.statementLineIds.map((id) => `#${id}`).join(' · ')}</div></div>
          </div>
        </div>
      </article>;
    })}</div>}
  </section>;
}
function StatementLinesPage() {
  const { activeClient } = useClientWorkspace();
  const [currency, setCurrency] = useState('all'); const [status, setStatus] = useState('all'); const [search, setSearch] = useState(''); const [addOpen, setAddOpen] = useState(false);
  const params = useMemo(() => ({ clientId: activeClient?.id ?? 1, ...(currency !== 'all' ? { currency } : {}), ...(status !== 'all' ? { status } : {}) }), [activeClient?.id, currency, status]);
  const query = useGetStatementLines(params, { query: { queryKey: getGetStatementLinesQueryKey(params) } });
  const journalParams = { clientId: activeClient?.id ?? 1 };
  const journalQuery = useGetJournalEntries(journalParams, { query: { queryKey: getGetJournalEntriesQueryKey(journalParams) } });
  const bankAccountsQuery = useGetBankAccounts(journalParams);
  const approve = useApproveJournalEntry();
  const post = usePostJournalEntry();
  const confirmClassification = useConfirmAICopilotAction();
  const [expandedLineId, setExpandedLineId] = useState<number | null>(null);
  const entriesByLine = useMemo(() => new Map((journalQuery.data ?? []).map((entry) => [entry.statementLineId, entry])), [journalQuery.data]);
  const bankAccountsById = useMemo(() => new Map((bankAccountsQuery.data ?? []).map((account) => [account.id, account])), [bankAccountsQuery.data]);
  const refreshPostedData = () => {
    queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetJournalEntriesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetLedgerOverviewQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTrialBalanceQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetFinancialStatementsQueryKey() });
  };
  const postEntry = (entry: JournalEntry) => post.mutate({ id: entry.id, data: { clientId: journalParams.clientId } }, { onSuccess: refreshPostedData });
  const approveEntry = (entry: JournalEntry) => approve.mutate({ id: entry.id, data: { clientId: journalParams.clientId } }, { onSuccess: refreshPostedData });
  const confirmClassificationForLine = (line: StatementLine, accountSuggestion: string) => confirmClassification.mutate({
    data: {
      clientId: journalParams.clientId,
      type: 'recode_lines',
      lineIds: [line.id],
      accountSuggestion,
      confidence: line.confidence ?? 0.85,
    },
  }, { onSuccess: refreshPostedData });
  const approveAndPost = approveEntry;
  const rows = useMemo(() => (query.data ?? []).filter((line) => `${line.description} ${line.accountSuggestion ?? ''}`.toLowerCase().includes(search.toLowerCase())), [query.data, search]);
  const currencies = [...new Set((query.data ?? []).map((line) => line.currency))];
  return <div><PageHeading eyebrow="Evidence review / bank activity" title="Statement lines" description="Start with the source. Review each movement, inspect its linked journal entry, then post only the entries you stand behind." action={<button data-testid="button-add-line" onClick={() => setAddOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-sm hover:-translate-y-0.5 transition-transform"><Plus size={14} /> Add line</button>} /><div className="mb-4 flex flex-col gap-3 rounded-lg border border-card-border bg-card p-3 md:flex-row md:items-center"><div className="relative flex-1"><Search className="absolute left-3 top-2.5 text-muted-foreground" size={15} /><input data-testid="input-search-lines" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search descriptions or account suggestions" className="h-9 w-full rounded-md border-0 bg-background pl-9 pr-3 text-xs outline-none ring-1 ring-border focus:ring-primary" /></div><div className="flex items-center gap-2"><Filter size={14} className="text-muted-foreground" /><select data-testid="select-currency-filter" value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-xs"><option value="all">All currencies</option>{currencies.map((item) => <option key={item}>{item}</option>)}</select><select data-testid="select-status-filter" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-xs"><option value="all">All statuses</option><option value="pending">Pending</option><option value="review">Review</option><option value="posted">Posted</option></select></div></div><QueryState loading={query.isLoading} error={query.isError} empty={!rows.length} onRetry={() => query.refetch()}><div className="overflow-hidden rounded-lg border border-card-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><span className="text-sm font-semibold">Review queue</span><span className="ml-2 rounded-full bg-secondary px-2 py-1 font-mono text-[10px] text-primary">{rows.length} lines</span></div><span className="font-mono text-[10px] text-muted-foreground">Select a line to inspect and post</span></div><div className="overflow-x-auto"><table className="w-full min-w-[970px] text-left"><thead className="bg-muted/55 font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground"><tr><th className="px-5 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Source description</th><th className="px-4 py-3 font-medium">Suggested account</th><th className="px-4 py-3 font-medium">Amount</th><th className="px-4 py-3 font-medium">Confidence</th><th className="px-4 py-3 font-medium">Status</th><th className="px-5 py-3 text-right font-medium">Review</th></tr></thead><tbody className="divide-y divide-border">{rows.map((line) => <InlineStatementRow key={line.id} line={line} bankAccountName={line.bankAccountId == null ? undefined : bankAccountsById.get(line.bankAccountId)?.name} entry={entriesByLine.get(line.id)} expanded={expandedLineId === line.id} journalLoading={journalQuery.isLoading} processing={Boolean(approve.isPending && approve.variables?.id === entriesByLine.get(line.id)?.id || post.isPending && post.variables?.id === entriesByLine.get(line.id)?.id || confirmClassification.isPending && confirmClassification.variables?.data.lineIds?.includes(line.id))} actionError={approve.isError || post.isError || confirmClassification.isError} onToggle={() => setExpandedLineId(expandedLineId === line.id ? null : line.id)} onApproveAndPost={approveAndPost} onPost={postEntry} onConfirmClassification={confirmClassificationForLine} />)}</tbody></table></div></div></QueryState><BulkTransitionHistory clientId={journalParams.clientId} clientName={activeClient?.name} />{addOpen && <AddLineDialog onClose={() => { setAddOpen(false); queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetJournalEntriesQueryKey() }); }} />}</div>;
}
function StatementRow({ line }: { line: StatementLine }) {
  const positive = line.direction.toLowerCase().includes('credit') || line.direction.toLowerCase().includes('in'); const confidence = line.confidence == null ? null : Math.round(line.confidence * 100);
  return <tr data-testid={`row-statement-line-${line.id}`} className="group transition-colors hover:bg-secondary/30"><td className="whitespace-nowrap px-5 py-4 font-mono text-[11px] text-muted-foreground">{shortDate(line.date)}</td><td className="max-w-[250px] px-4 py-4"><div className="truncate text-[12px] font-semibold">{line.description}</div><div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className="rounded bg-muted px-1.5 py-0.5">{line.source}</span><span>· {line.currency}</span></div></td><td className="px-4 py-4"><div className="text-[12px]">{line.accountSuggestion || 'Needs account call'}</div><div className="mt-1 text-[10px] text-muted-foreground">AI suggestion</div></td><td className={`whitespace-nowrap px-4 py-4 font-mono text-[12px] font-medium ${positive ? 'text-primary' : 'text-foreground'}`}>{positive ? '+' : '−'}{money(Math.abs(line.amount), line.currency)}</td><td className="px-4 py-4">{confidence == null ? <span className="text-[11px] text-muted-foreground">Unscored</span> : <div className="flex items-center gap-2"><div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${confidence > 85 ? 'bg-primary' : 'bg-accent'}`} style={{ width: `${confidence}%` }} /></div><span className="font-mono text-[10px]">{confidence}%</span></div>}</td><td className="px-4 py-4"><StatusPill status={line.status} /></td></tr>;
}

function InlineStatementRow({ line, bankAccountName, entry, expanded, journalLoading, processing, actionError, onToggle, onApproveAndPost, onPost, onConfirmClassification }: { line: StatementLine; bankAccountName?: string; entry: JournalEntry | undefined; expanded: boolean; journalLoading: boolean; processing: boolean; actionError: boolean; onToggle: () => void; onApproveAndPost: (entry: JournalEntry) => void; onPost: (entry: JournalEntry) => void; onConfirmClassification: (line: StatementLine, accountSuggestion: string) => void }) {
  const positive = line.direction.toLowerCase().includes('credit') || line.direction.toLowerCase().includes('in');
  const confidence = line.confidence == null ? null : Math.round(line.confidence * 100);
  const approved = entry?.status.toLowerCase() === 'approved';
  const posted = line.status.toLowerCase() === 'posted';
  const canConfirmClassification = !posted && entry?.status.toLowerCase() === 'suggested';
  const [selectedAccount, setSelectedAccount] = useState(line.accountSuggestion && classificationAccounts.includes(line.accountSuggestion) ? line.accountSuggestion : 'General expenses');
  const debitLine = entry?.lines.find((item) => item.debit > 0);
  const creditLine = entry?.lines.find((item) => item.credit > 0);

  return <>
    <tr data-testid={`row-statement-line-${line.id}`} className={`group transition-colors hover:bg-secondary/30 ${expanded ? 'bg-secondary/20' : ''}`}>
      <td className="whitespace-nowrap px-5 py-4 font-mono text-[11px] text-muted-foreground">{shortDate(line.date)}</td>
      <td className="max-w-[250px] px-4 py-4"><div className="truncate text-[12px] font-semibold">{line.description}</div><div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className="rounded bg-muted px-1.5 py-0.5">{line.source}</span><span>· {line.currency}</span>{bankAccountName && <span className="truncate">· {bankAccountName}</span>}</div></td>
      <td className="px-4 py-4"><div className="text-[12px]">{line.accountSuggestion || 'Needs account call'}</div><div data-testid={line.suggestionSource === 'workspace_learning' ? `workspace-learning-line-${line.id}` : undefined} className={`mt-1 text-[10px] ${line.suggestionSource === 'workspace_learning' ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>{line.suggestionSource === 'workspace_learning' ? `Workspace learned · ${line.supportingPatternCount} confirmed pattern${line.supportingPatternCount === 1 ? '' : 's'}` : 'AI suggestion'}</div></td>
      <td className={`whitespace-nowrap px-4 py-4 font-mono text-[12px] font-medium ${positive ? 'text-primary' : 'text-foreground'}`}>{positive ? '+' : '−'}{money(Math.abs(line.amount), line.currency)}</td>
      <td className="px-4 py-4">{confidence == null ? <span className="text-[11px] text-muted-foreground">Unscored</span> : <div className="flex items-center gap-2"><div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${confidence > 85 ? 'bg-primary' : 'bg-accent'}`} style={{ width: `${confidence}%` }} /></div><span className="font-mono text-[10px]">{confidence}%</span></div>}</td>
      <td className="px-4 py-4"><StatusPill status={line.status} /></td>
      <td className="px-5 py-4 text-right"><button data-testid={`button-expand-line-${line.id}`} onClick={onToggle} aria-expanded={expanded} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/5"><span>{expanded ? 'Hide entry' : 'Review entry'}</span><ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} /></button></td>
    </tr>
    {expanded && <tr data-testid={`detail-statement-line-${line.id}`}><td colSpan={7} className="bg-secondary/25 px-5 py-5">
      {journalLoading ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><RefreshCw size={14} className="animate-spin" /> Loading linked journal entry…</div> : !entry ? <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive"><CircleAlert size={15} /> No journal entry is linked to this statement line yet.</div> : <section className="rounded-lg border border-card-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div><div className="font-mono text-[10px] uppercase tracking-[.14em] text-primary">Linked journal entry · JE-{String(entry.id).padStart(4, '0')}</div><p className="mt-1 text-xs text-muted-foreground">{entry.memo}</p></div>
          <StatusPill status={entry.status} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-md bg-muted/45 p-3"><div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Debit account</div><div data-testid={`journal-debit-${line.id}`} className="mt-1 text-xs font-semibold">{debitLine?.account ?? '—'}</div></div>
          <div className="rounded-md bg-muted/45 p-3"><div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Credit account</div><div data-testid={`journal-credit-${line.id}`} className="mt-1 text-xs font-semibold">{creditLine?.account ?? '—'}</div></div>
          <div className="rounded-md bg-muted/45 p-3"><div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Amount</div><div data-testid={`journal-amount-${line.id}`} className="mt-1 font-mono text-xs font-semibold">{money(debitLine?.debit ?? creditLine?.credit ?? 0, entry.currency)}</div></div>
          <div className="rounded-md bg-muted/45 p-3"><div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Confidence</div><div data-testid={`journal-confidence-${line.id}`} className="mt-1 text-xs font-semibold">{Math.round(entry.confidence * 100)}%</div></div>
        </div>
        {canConfirmClassification && <div className="mt-4 rounded-md border border-primary/20 bg-primary/5 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <label className="block text-[11px] font-semibold">Classification decision
              <select data-testid={`select-account-suggestion-${line.id}`} value={selectedAccount} onChange={(event) => setSelectedAccount(event.target.value)} className="mt-1.5 block h-9 min-w-[230px] rounded-md border border-input bg-background px-2 text-xs font-normal outline-none focus:border-primary">
                {classificationAccounts.map((account) => <option key={account} value={account}>{account}</option>)}
              </select>
            </label>
            <button data-testid={`button-confirm-classification-${line.id}`} onClick={() => onConfirmClassification(line, selectedAccount)} disabled={processing} className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-primary/30 bg-background px-3 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-50">
              <Check size={13} /> {line.suggestionSource === 'workspace_learning' && selectedAccount === line.accountSuggestion ? 'Confirm learned account' : 'Confirm account'}
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">{line.suggestionSource === 'workspace_learning' ? `This match is based on ${line.supportingPatternCount} confirmed workspace pattern${line.supportingPatternCount === 1 ? '' : 's'}—not another client's transaction details.` : 'Confirm this account or choose another one to improve future workspace suggestions.'}</p>
        </div>}
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">{posted ? 'This reviewed line is posted and included in ledger reporting.' : approved ? 'This entry is approved and ready to post to the ledger.' : 'Approval is required before this line can be posted.'}</p>
          {posted ? <div data-testid={`posted-line-${line.id}`} className="inline-flex items-center gap-2 text-xs font-semibold text-primary"><CircleCheck size={15} /> Posted to ledger</div> : approved ? <button data-testid={`button-post-line-${line.id}`} onClick={() => onPost(entry)} disabled={processing} className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">{processing ? 'Posting to ledger…' : <><Check size={14} /> Post to ledger</>}</button> : <button data-testid={`button-approve-line-${line.id}`} onClick={() => onApproveAndPost(entry)} disabled={processing} className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">{processing ? 'Approving…' : <><Check size={14} /> Approve entry</>}</button>}
        </div>
        {actionError && <p className="mt-3 text-xs text-destructive">The journal entry could not be updated. Refresh this line and try again.</p>}
      </section>}
    </td></tr>}
  </>;
}
function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase(); const posted = normalized === 'posted' || normalized === 'approved';
  return <span data-testid={`status-${normalized}`} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[10px] capitalize ${posted ? 'bg-primary/10 text-primary' : normalized === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-accent/15 text-accent-foreground'}`}><span className={`size-1.5 rounded-full ${posted ? 'bg-primary' : normalized === 'error' ? 'bg-destructive' : 'bg-accent'}`} />{status}</span>;
}

function JournalEntriesPage() {
  const { activeClient } = useClientWorkspace(); const params = { clientId: activeClient?.id ?? 1 };
  const query = useGetJournalEntries(params, { query: { queryKey: getGetJournalEntriesQueryKey(params) } }); const approve = useApproveJournalEntry(); const entries = query.data ?? []; const [selected, setSelected] = useState<number | null>(null); const [filter, setFilter] = useState('all'); const filtered = entries.filter((item) => filter === 'all' || item.status.toLowerCase() === filter);
  const approveEntry = (entry: JournalEntry) => approve.mutate({ id: entry.id, data: { clientId: activeClient?.id ?? 1 } }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetJournalEntriesQueryKey() }) });
  return <div><PageHeading eyebrow="Decision layer / AI proposals" title="Journal entries" description="Review the proposed double-entry, trace it back to its source line, and approve only the postings that make sense." action={<div className="flex items-center gap-2 rounded-md border border-accent/25 bg-accent/10 px-3 py-2 text-[11px] text-accent-foreground"><Sparkles size={14} /> AI prepared · human approved</div>} /><div className="mb-4 flex items-center justify-between rounded-lg border border-card-border bg-card px-4 py-3"><div className="flex items-center gap-2"><button data-testid="button-filter-all-entries" onClick={() => setFilter('all')} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${filter === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>All <span className="ml-1 font-mono text-[10px]">{entries.length}</span></button><button data-testid="button-filter-pending-entries" onClick={() => setFilter('pending')} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${filter === 'pending' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>Needs approval</button></div><span className="font-mono text-[10px] text-muted-foreground">Source-linked postings</span></div><QueryState loading={query.isLoading} error={query.isError} empty={!filtered.length} onRetry={() => query.refetch()}><div className="grid gap-4 xl:grid-cols-2">{filtered.map((entry) => <JournalCard key={entry.id} entry={entry} selected={selected === entry.id} onSelect={() => setSelected(selected === entry.id ? null : entry.id)} onApprove={() => approveEntry(entry)} approving={approve.isPending && approve.variables?.id === entry.id} />)}</div></QueryState></div>;
}
function JournalCard({ entry, selected, onSelect, onApprove, approving }: { entry: JournalEntry; selected: boolean; onSelect: () => void; onApprove: () => void; approving: boolean }) {
  const approved = entry.status.toLowerCase() === 'approved' || entry.status.toLowerCase() === 'posted';
  return <article data-testid={`card-journal-entry-${entry.id}`} className={`rounded-lg border bg-card transition-all ${selected ? 'border-primary/50 shadow-md' : 'border-card-border hover:border-primary/30'}`}><button data-testid={`button-expand-entry-${entry.id}`} onClick={onSelect} className="flex w-full items-start gap-4 p-5 text-left"><div className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-md ${approved ? 'bg-primary/10 text-primary' : 'bg-accent/15 text-accent-foreground'}`}>{approved ? <Check size={17} /> : <Sparkles size={16} />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] text-muted-foreground">JE-{String(entry.id).padStart(4, '0')}</span><StatusPill status={entry.status} /></div><h2 className="mt-2 truncate text-[13px] font-semibold">{entry.memo}</h2><div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-muted-foreground"><span>{shortDate(entry.date)}</span><span>·</span><span>{entry.currency}</span><span>·</span><span>{Math.round(entry.confidence * 100)}% confidence</span></div></div><ChevronDown className={`mt-1 text-muted-foreground transition-transform ${selected ? 'rotate-180' : ''}`} size={16} /></button>{selected && <div className="border-t border-border px-5 pb-5 pt-4"><div className="mb-3 flex items-center gap-2 text-[10px] text-muted-foreground"><FileCheck2 size={13} className="text-primary" /> Linked to statement line #{entry.statementLineId}</div><div className="overflow-hidden rounded-md border border-border"><table className="w-full text-left text-[11px]"><thead className="bg-muted/55 font-mono text-[9px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Account</th><th className="px-3 py-2 text-right font-medium">Debit</th><th className="px-3 py-2 text-right font-medium">Credit</th></tr></thead><tbody className="divide-y divide-border">{entry.lines.map((line, index) => <tr key={`${entry.id}-${index}`}><td className="px-3 py-2.5">{line.account}</td><td className="px-3 py-2.5 text-right font-mono">{line.debit ? money(line.debit, entry.currency) : '—'}</td><td className="px-3 py-2.5 text-right font-mono">{line.credit ? money(line.credit, entry.currency) : '—'}</td></tr>)}</tbody></table></div><div className="mt-4 flex justify-end">{approved ? <div className="flex items-center gap-2 text-xs font-semibold text-primary"><CircleCheck size={15} /> Entry approved</div> : <button data-testid={`button-approve-entry-${entry.id}`} onClick={onApprove} disabled={approving} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{approving ? 'Approving…' : <><Check size={14} /> Approve entry</>}</button>}</div></div>}</article>;
}

function exportTrialBalance(rows: Array<{ account: string; category: string; debit: number; credit: number; balance: number }>, clientName: string, currency: string) {
  const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = [
    ['Client', clientName],
    ['Report', 'Trial balance'],
    ['Currency', currency],
    [],
    ['Account', 'Category', 'Debit', 'Credit', 'Balance'],
    ...rows.map((row) => [row.account, row.category, row.debit.toFixed(2), row.credit.toFixed(2), row.balance.toFixed(2)]),
  ].map((row) => row.map(escape).join(',')).join('\r\n');
  const fileName = `${clientName.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/(^-|-$)/g, '') || 'ledgerflow'}-trial-balance.csv`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function TrialBalancePage() {
  const { activeClient } = useClientWorkspace(); const params = { clientId: activeClient?.id ?? 1 };
  const query = useGetTrialBalance(params, { query: { queryKey: getGetTrialBalanceQueryKey(params) } }); const rows = query.data ?? []; const debit = rows.reduce((sum, row) => sum + row.debit, 0); const credit = rows.reduce((sum, row) => sum + row.credit, 0); const balanced = Math.abs(debit - credit) < 0.01;
  return <div><PageHeading eyebrow="Control check / double-entry" title="Trial balance" description="One place to see every account's movement and confirm the ledger is ready to become financial statements." action={<div className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold ${balanced ? 'bg-primary/10 text-primary' : 'bg-accent/15 text-accent-foreground'}`}>{balanced ? <CircleCheck size={15} /> : <CircleAlert size={15} />}{balanced ? 'In balance' : 'Review variance'}</div>} /><QueryState loading={query.isLoading} error={query.isError} empty={!rows.length} onRetry={() => query.refetch()}><div className="space-y-5"><div className="grid gap-3 sm:grid-cols-3"><Metric label="Total debits" value={money(debit)} note={`${rows.length} accounts in scope`} /><Metric label="Total credits" value={money(credit)} note="Across all categories" /><Metric label="Variance" value={money(Math.abs(debit - credit))} note={balanced ? 'Debits and credits agree' : 'Needs investigation'} accent={!balanced} /></div><div className="overflow-hidden rounded-lg border border-card-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><span className="text-sm font-semibold">Account balances</span><span className="ml-2 font-mono text-[10px] text-muted-foreground">as of close</span></div><button data-testid="button-export-trial-balance" onClick={() => exportTrialBalance(rows, activeClient?.name ?? 'LedgerFlow', activeClient?.functionalCurrency ?? 'AED')} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-muted"><ArrowDownLeft size={13} /> Export CSV</button></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left"><thead className="bg-muted/55 font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground"><tr><th className="px-5 py-3 font-medium">Account</th><th className="px-4 py-3 font-medium">Category</th><th className="px-4 py-3 text-right font-medium">Debit</th><th className="px-4 py-3 text-right font-medium">Credit</th><th className="px-5 py-3 text-right font-medium">Balance</th></tr></thead><tbody className="divide-y divide-border">{rows.map((row, index) => <tr data-testid={`row-trial-balance-${index}`} key={`${row.account}-${index}`} className="hover:bg-secondary/25"><td className="px-5 py-3.5 text-[12px] font-semibold">{row.account}</td><td className="px-4 py-3.5 text-[11px] text-muted-foreground">{row.category}</td><td className="px-4 py-3.5 text-right font-mono text-[11px]">{row.debit ? money(row.debit) : '—'}</td><td className="px-4 py-3.5 text-right font-mono text-[11px]">{row.credit ? money(row.credit) : '—'}</td><td className={`px-5 py-3.5 text-right font-mono text-[11px] font-medium ${row.balance < 0 ? 'text-destructive' : ''}`}>{money(row.balance)}</td></tr>)}</tbody><tfoot className="border-t-2 border-border bg-muted/35"><tr><td colSpan={2} className="px-5 py-3 text-[11px] font-semibold">Totals</td><td className="px-4 py-3 text-right font-mono text-[11px] font-semibold">{money(debit)}</td><td className="px-4 py-3 text-right font-mono text-[11px] font-semibold">{money(credit)}</td><td className="px-5 py-3 text-right font-mono text-[11px] font-semibold">{money(debit - credit)}</td></tr></tfoot></table></div></div></div></QueryState></div>;
}

function SectionTree({ sections, level = 0 }: { sections: StatementSection[]; level?: number }) {
  return <div className={level ? 'ml-4 border-l border-border pl-4' : ''}>{sections.map((section, index) => <div key={`${section.label}-${index}`} className={`${level ? 'py-2' : 'border-b border-border py-3.5 last:border-b-0'}`}><div className={`flex items-baseline justify-between gap-4 ${level === 0 ? 'font-semibold' : ''}`}><span className={`${level === 0 ? 'text-[12px]' : 'text-[11px] text-muted-foreground'}`}>{section.label}</span><span className={`shrink-0 font-mono ${level === 0 ? 'text-[12px]' : 'text-[11px]'}`}>{money(section.amount)}</span></div>{section.children && section.children.length > 0 && <SectionTree sections={section.children} level={level + 1} />}</div>)}</div>;
}
function FinancialStatementsPage() {
  const { activeClient } = useClientWorkspace(); const [period, setPeriod] = useState(''); const params = { clientId: activeClient?.id ?? 1, ...(period ? { period } : {}) }; const query = useGetFinancialStatements(params, { query: { queryKey: getGetFinancialStatementsQueryKey(params) } }); const report = query.data as FinancialStatements | undefined; const [active, setActive] = useState<'incomeStatement' | 'balanceSheet' | 'cashFlow'>('incomeStatement'); const tabs = [{ key: 'incomeStatement' as const, label: 'Income statement', note: 'Profit & loss' }, { key: 'balanceSheet' as const, label: 'Balance sheet', note: 'Position' }, { key: 'cashFlow' as const, label: 'Cash flow', note: 'Indirect method' }]; const sections = report?.[active] ?? [];
  return <div><PageHeading eyebrow="Reporting / period close" title="Financial statements" description="Read the finished story of the ledger. Switch between statements without losing the period context." action={<label className="flex items-center gap-2 text-xs font-medium"><span className="text-muted-foreground">Period</span><select data-testid="select-statement-period" value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9 rounded-md border border-input bg-card px-3 font-mono text-[11px] outline-none focus:border-primary"><option value="">Latest available</option><option value="2024-06">June 2024</option><option value="2024-05">May 2024</option><option value="2024-04">April 2024</option></select></label>} /><QueryState loading={query.isLoading} error={query.isError} empty={!report} onRetry={() => query.refetch()}>{report && <div className="grid gap-6 xl:grid-cols-[.7fr_1.3fr]"><div className="space-y-3">{tabs.map(({ key, label, note }) => <button key={key} data-testid={`button-statement-${key}`} onClick={() => setActive(key)} className={`flex w-full items-center justify-between rounded-lg border p-4 text-left transition-all ${active === key ? 'border-primary/40 bg-primary text-primary-foreground shadow-md' : 'border-card-border bg-card hover:border-primary/30'}`}><div><div className="text-[13px] font-semibold">{label}</div><div className={`mt-1 text-[11px] ${active === key ? 'text-primary-foreground/65' : 'text-muted-foreground'}`}>{note}</div></div><ArrowRight size={15} className={active === key ? 'text-primary-foreground' : 'text-muted-foreground'} /></button>)}<div className="rounded-lg border border-accent/25 bg-accent/10 p-4"><div className="flex gap-2 text-accent-foreground"><CircleCheck size={15} className="mt-0.5 shrink-0" /><p className="text-[11px] leading-5"><strong className="font-semibold">Statement integrity</strong><br />Built from approved journal entries and checked against the trial balance.</p></div></div></div><section className="rounded-lg border border-card-border bg-card"><div className="border-b border-border p-5 md:p-6"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">{report.period}</div><h2 className="mt-2 font-display text-[29px]">{tabs.find((tab) => tab.key === active)?.label}</h2><p className="mt-1 text-[11px] text-muted-foreground">Prepared from LedgerFlow's reviewed close</p></div><div className="p-5 md:p-6"><SectionTree sections={sections} /></div></section></div>}</QueryState></div>;
}
function Router() {
  return <Switch><Route path="/" component={Home} /><Route path="/import-statement" component={ImportStatementPage} /><Route path="/statement-lines" component={StatementLinesPage} /><Route path="/journal-entries" component={JournalEntriesPage} /><Route path="/trial-balance" component={TrialBalancePage} /><Route path="/financial-statements" component={FinancialStatementsPage} /><Route component={NotFound} /></Switch>;
}
function NotFound() {
  return <div className="grid min-h-[65vh] place-items-center text-center"><div><div className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">LedgerFlow / 404</div><h1 className="mt-3 font-display text-4xl">This page is not in the close.</h1><Link href="/" data-testid="link-back-overview" className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline">Return to overview <ArrowRight size={14} /></Link></div></div>;
}

function WorkspaceRecoveryState({ onRetry }: { onRetry: () => void }) {
  return <div className="grid min-h-[100dvh] place-items-center bg-background px-5"><div className="w-full max-w-md rounded-lg border border-destructive/25 bg-card p-6 text-center shadow-sm" role="alert"><div className="mx-auto grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive"><CircleAlert size={19} /></div><h1 className="mt-4 text-base font-semibold">We couldn’t load your workspaces</h1><p className="mt-2 text-xs leading-5 text-muted-foreground">LedgerFlow could not retrieve the client workspaces available to this account. Your bookkeeping data has not been opened.</p><button data-testid="button-retry-workspaces" onClick={onRetry} className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"><RefreshCw size={14} /> Try again</button></div></div>;
}
function LedgerFlowApp({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const clientsQuery = useGetClients({ query: { queryKey: getGetClientsQueryKey() } });
  const clients = clientsQuery.data ?? [];
  const storageKey = getActiveWorkspaceStorageKey(user.id);
  const [activeClientId, setActiveClientId] = useState<number | null>(() => {
    const saved = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  });
  const selectedClient = clients.find((client) => client.id === activeClientId) ?? clients[0];
  useEffect(() => {
    if (!clients.length) return;
    if (selectedClient && activeClientId !== selectedClient.id) setActiveClientId(selectedClient.id);
    if (selectedClient) window.localStorage.setItem(storageKey, String(selectedClient.id));
  }, [activeClientId, clients.length, selectedClient, storageKey]);
  const chooseClient = (id: number) => {
    if (clients.some((client) => client.id === id)) setActiveClientId(id);
  };
  if (clientsQuery.isLoading) return <AuthLoadingState label="Loading your workspaces" />;
  if (clientsQuery.isError) return <WorkspaceRecoveryState onRetry={() => clientsQuery.refetch()} />;
  if (!clients.length) return <WorkspaceRecoveryState onRetry={() => clientsQuery.refetch()} />;
  return <TooltipProvider><ClientContext.Provider value={{ activeClient: selectedClient, clients, setActiveClientId: chooseClient }}><ErrorBoundary><Shell user={user} onLogout={onLogout}><Router /></Shell></ErrorBoundary></ClientContext.Provider><Toaster /></TooltipProvider>;
}

function AuthBoundary() {
  const auth = useAuth();
  const [location] = useLocation();
  const currentUserId = auth.user?.id ?? null;
  const [cacheReadyForUserId, setCacheReadyForUserId] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (cacheReadyForUserId !== currentUserId) {
      clearUserScopedState(queryClient, cacheReadyForUserId, window.localStorage);
      setCacheReadyForUserId(currentUserId);
    }
  }, [cacheReadyForUserId, currentUserId]);

  if (auth.isLoading) return <AuthLoadingState />;
  if (auth.error) return <AuthRecoveryState onRetry={auth.retry} />;
  if (auth.user && cacheReadyForUserId !== auth.user.id) return <AuthLoadingState label="Preparing your secure workspace" />;
  if (!auth.user) return <AccessScreen onLogin={auth.login} returnTo={location} />;

  const handleLogout = () => {
    clearUserScopedState(queryClient, auth.user?.id ?? null, window.localStorage);
    auth.logout();
  };
  return <LedgerFlowApp key={auth.user.id} user={auth.user} onLogout={handleLogout} />;
}
function App() {
  return <QueryClientProvider client={queryClient}><AuthBoundary /></QueryClientProvider>;
}
export default App;

function AuthRecoveryState({ onRetry }: { onRetry: () => void }) {
  return <div className="grid min-h-[100dvh] place-items-center bg-background px-5" data-testid="auth-recovery-state"><div className="w-full max-w-md rounded-lg border border-destructive/25 bg-card p-6 text-center shadow-sm" role="alert"><div className="mx-auto grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive"><CircleAlert size={19} /></div><h1 className="mt-4 text-base font-semibold">We couldn’t verify your access</h1><p className="mt-2 text-xs leading-5 text-muted-foreground">LedgerFlow could not reach the session service. Your bookkeeping data has not been opened.</p><button data-testid="button-retry-auth" onClick={onRetry} className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"><RefreshCw size={14} /> Try again</button></div></div>;
}

function AccessScreen({ onLogin, returnTo }: { onLogin: (returnTo?: string) => void; returnTo: string }) {
  return <main className="grid min-h-[100dvh] place-items-center bg-background px-5 py-10" data-testid="auth-access-screen"><div className="w-full max-w-[420px]"><div className="rounded-lg border border-card-border bg-card p-7 shadow-md sm:p-9"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm"><Landmark size={20} strokeWidth={2.2} /></div><div><div className="font-display text-[25px] leading-none tracking-tight">LedgerFlow</div><div className="mt-1 font-mono text-[9px] uppercase tracking-[.2em] text-muted-foreground">Review desk</div></div></div><div className="mt-10"><div className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Secure access</div><h1 className="mt-3 font-display text-[36px] leading-[.98] tracking-tight">Your close, ready for review.</h1><p className="mt-4 text-[13px] leading-6 text-muted-foreground">Sign in to open your private bookkeeping review desk. New to LedgerFlow? The same secure flow lets you create an account.</p><button data-testid="button-login" onClick={() => onLogin(returnTo)} className="focus-ring mt-7 flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5">Sign in or create account</button></div></div><p className="mt-5 text-center font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground/70">Secure session · Human approval stays in control</p></div></main>;
}

function AIProviderSettingsPanel({ clientId }: { clientId: number }) {
  const params = { clientId };
  const settings = useGetLedgerflowAISettings(params);
  const save = useUpdateLedgerflowAISettings();
  const test = useTestLedgerflowAISettings();
  const remove = useRemoveLedgerflowAICredential();
  const [provider, setProvider] = useState<keyof typeof aiModels>('managed_openai');
  const [model, setModel] = useState<string>(aiModels.managed_openai[0]);
  const [apiKey, setApiKey] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!settings.data) return;
    const nextProvider = settings.data.provider as keyof typeof aiModels;
    setProvider(nextProvider);
    setModel(settings.data.model);
  }, [clientId, settings.data?.provider, settings.data?.model]);
  const chooseProvider = (nextProvider: keyof typeof aiModels) => {
    setProvider(nextProvider);
    setModel(aiModels[nextProvider][0]);
    setApiKey('');
    setNotice('');
  };
  const saveSettings = (event: React.FormEvent) => {
    event.preventDefault();
    setNotice('');
    save.mutate({ data: { clientId, provider, model, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) } }, {
      onSuccess: (result) => {
        setApiKey('');
        setNotice(result.provider === 'managed_openai' ? 'Replit-managed OpenAI is selected.' : 'AI provider settings saved. Test the connection before using it.');
        settings.refetch();
      },
    });
  };
  const testSettings = () => {
    setNotice('');
    test.mutate({ data: { clientId } }, {
      onSuccess: () => {
        setNotice('Connection test passed. This workspace can use the selected provider.');
        settings.refetch();
      },
    });
  };
  const removeCredential = () => {
    if (!window.confirm('Remove this workspace API key and switch back to Replit-managed OpenAI?')) return;
    setNotice('');
    remove.mutate({ data: { clientId } }, {
      onSuccess: () => {
        setApiKey('');
        setNotice('Workspace API key removed. Replit-managed OpenAI is selected.');
        settings.refetch();
      },
    });
  };
  const status = settings.data?.credentialStatus;
  const error = save.error ?? test.error ?? remove.error;
  return <section className="mt-6 border-t border-border pt-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">AI provider</div><h3 className="mt-1 text-sm font-semibold">AI connection</h3><p className="mt-1 max-w-xl text-[11px] leading-5 text-muted-foreground">Choose Replit-managed OpenAI or use a workspace-owned OpenAI or Anthropic API key. LedgerFlow stores only encrypted credential material and never shows the key again.</p></div>{settings.data && <span className={`rounded-full px-2 py-1 font-mono text-[9px] ${status === 'configured' || settings.data.provider === 'managed_openai' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>{settings.data.provider === 'managed_openai' ? 'Managed connection' : status === 'configured' ? 'Key configured' : status?.replaceAll('_', ' ')}</span>}</div><form onSubmit={saveSettings} className="mt-4 grid gap-3 sm:grid-cols-2"><label className="block text-xs font-medium">Provider<select data-testid="select-ai-provider" value={provider} onChange={(event) => chooseProvider(event.target.value as keyof typeof aiModels)} disabled={settings.isLoading} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary disabled:opacity-50"><option value="managed_openai">Replit-managed OpenAI</option><option value="openai">Workspace-owned OpenAI</option><option value="anthropic">Workspace-owned Anthropic</option></select></label><label className="block text-xs font-medium">Model<select data-testid="select-ai-model" value={model} onChange={(event) => setModel(event.target.value)} disabled={settings.isLoading} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary disabled:opacity-50">{aiModels[provider].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>{provider !== 'managed_openai' && <label className="block text-xs font-medium sm:col-span-2">API key<input data-testid="input-ai-provider-key" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.data?.provider === provider && settings.data.credentialLast4 ? `Stored key ends in ${settings.data.credentialLast4}; enter a key only to replace it` : 'Paste the workspace API key'} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /><span className="mt-1 block text-[10px] font-normal leading-4 text-muted-foreground">{provider === 'anthropic' ? 'A Claude Pro or Max subscription is not an Anthropic API credential; API billing is separate.' : 'Use an API key created for this workspace. The full key is never returned to your browser.'}</span></label>}<div className="flex flex-wrap items-center gap-2 sm:col-span-2"><button data-testid="button-save-ai-settings" disabled={save.isPending || settings.isLoading} className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{save.isPending ? 'Saving…' : provider === 'managed_openai' ? 'Use managed OpenAI' : apiKey ? 'Save & rotate key' : 'Save provider'}</button><button data-testid="button-test-ai-provider" type="button" onClick={testSettings} disabled={test.isPending || save.isPending || settings.isLoading} className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50">{test.isPending ? 'Testing…' : 'Test connection'}</button>{settings.data?.provider !== 'managed_openai' && <button data-testid="button-remove-ai-provider-key" type="button" onClick={removeCredential} disabled={remove.isPending} className="rounded-md px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50">{remove.isPending ? 'Removing…' : 'Remove key'}</button>}</div></form>{settings.isLoading && <p className="mt-3 text-[11px] text-muted-foreground">Loading AI connection…</p>}{notice && <p data-testid="ai-settings-notice" className="mt-3 text-[11px] font-medium text-primary">{notice}</p>}{error && <p data-testid="ai-settings-error" className="mt-3 text-[11px] font-medium text-destructive">{error instanceof Error ? error.message : 'AI provider settings could not be updated. Try again.'}</p>}</section>;
}
