import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import {
  ArrowDownLeft, ArrowRight, BarChart3, BookOpenCheck, Check, ChevronDown, ChevronRight,
  CircleAlert, CircleCheck, CircleHelp, FileCheck2, FileSpreadsheet, Filter, Landmark,
  LayoutDashboard, LoaderCircle, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw,
  Mail, RotateCw, Search, Settings2, Sparkles, Table2, Trash2, UploadCloud, UserPlus, Users, X
} from 'lucide-react';
import {
  getGetBankAccountsQueryKey, getGetBulkTransitionAuditsQueryKey, getGetClientsQueryKey, getGetFinancialStatementsQueryKey, getGetJournalEntriesQueryKey, getGetLedgerOverviewQueryKey, getGetReportPackQueryKey, getGetReportPacksQueryKey,
  getGetStatementLinesQueryKey, getGetTrialBalanceQueryKey, getGetExchangeRatesQueryKey, getGetLedgerflowUsageQueryKey, getGetFirmProfileQueryKey, useApproveJournalEntry,
  useCreateClient, useCreateReportPack, useCreateStatementLine, useGetClients, useGetJournalEntries, useGetLedgerOverview, useGetReportPack, useGetReportPacks,
  useConfirmAICopilotAction, useCreateExchangeRate, useDeleteExchangeRate, useGetBankAccounts, useGetExchangeRates, useGetLedgerflowAISettings, useGetLedgerflowUsage, useGetStatementLines, useGetTrialBalance, useImportStatement, useParseExchangeRates,
  getGetWorkspaceMembersQueryKey, useAcceptWorkspaceInvitation, useCreateWorkspaceInvitation, useImportExchangeRates, usePostJournalEntry, useRemoveLedgerflowAICredential, useRemoveWorkspaceMember, useResendWorkspaceInvitation, useRevokeWorkspaceInvitation, useTestLedgerflowAISettings, useUpdateClient, useUpdateExchangeRate, useUpdateLedgerflowAISettings, useUpdateLedgerflowAccountProfile, useUpdateFirmProfile, useUpdateReportPack, useUpdateWorkspaceMember, useGetWorkspaceMembers, useGetFirmProfile
} from '@workspace/api-client-react';
import type {
  Client, ClientUpdateInput, ExchangeRate, ExchangeRateInput, ExchangeRateParseResult, JournalEntry, ReportAmount, ReportChecklistItem, ReportNote, ReportPack, ReportSignatory, StatementImportResult, StatementLine, StatementLineInput, StatementSection, WorkspaceInvitation, WorkspaceMember
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { AssistantFAB } from './components/assistant-fab';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { useUpload } from '@workspace/object-storage-web';
import { clearUserScopedState, getActiveWorkspaceStorageKey, getWorkspaceLoadState, requiresWorkspaceOnboarding, selectWorkspaceForSession } from './lib/user-state';
const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const nav = [
  { href: '/', label: 'Close overview', icon: LayoutDashboard },
  { href: '/import-statement', label: 'Import statement', icon: UploadCloud },
  { href: '/statement-lines', label: 'Statement lines', icon: Table2 },
  { href: '/journal-entries', label: 'Journal entries', icon: BookOpenCheck },
  { href: '/trial-balance', label: 'Trial balance', icon: BarChart3 },
  { href: '/financial-statements', label: 'Financial statements', icon: FileSpreadsheet },
  { href: '/client-settings', label: 'Client settings', icon: Settings2 },
];

const classificationAccounts = [
  'Revenue', 'Other income', 'Travel & entertainment', 'Software & subscriptions',
  'Office expenses', 'Communication expenses', 'Rent expense', 'Payroll', 'Bank charges', 'General expenses',
  'Inter-account transfer',
];
const money = (value: number, currency = 'AED') => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
const MAX_IMPORT_FILE_SIZE = 50 * 1024 * 1024;
const FIRM_RATE_PAGE_SIZE = 25;
const shortDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const periodToMonthInput = (period: string) => {
  const numeric = period.match(/^(\d{4})-(\d{2})$/);
  if (numeric && Number(numeric[2]) >= 1 && Number(numeric[2]) <= 12) return period;
  const named = period.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!named) return '';
  const month = monthNames.findIndex((name) => name.toLowerCase() === named[1].toLowerCase()) + 1;
  return month ? `${named[2]}-${String(month).padStart(2, '0')}` : '';
};
const monthInputToPeriod = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  const month = match ? Number(match[2]) : 0;
  return match && month >= 1 && month <= 12 ? `${monthNames[month - 1]} ${match[1]}` : '';
};
const csvHeaderKey = (value: string) => value.replace(/^\uFEFF/, '').trim().toLowerCase().replaceAll(/[^a-z]/g, '');
function readCsvRecords(content: string) {
  const normalized = content.replace(/^\uFEFF/, '');
  const delimiterSample = normalized.split(/\r?\n/).slice(0, 12).join('\n');
  const delimiter = [',', ';', '\t'].reduce((best, candidate) => {
    const count = [...delimiterSample].filter((character) => character === candidate).length;
    return count > best.count ? { value: candidate, count } : best;
  }, { value: ',', count: -1 }).value;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    const next = normalized[index + 1];
    if (character === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
function deterministicExchangeRates(content: string): ExchangeRateInput[] {
  const rows = readCsvRecords(content);
  const headerIndex = rows.findIndex((row) => row.some((cell) => ['effectivedate', 'date', 'asof', 'valuedate', 'ratedate', 'sourcecurrency', 'fromcurrency', 'functionalcurrency', 'tocurrency', 'rate', 'exchangerate', 'closingrate'].includes(csvHeaderKey(cell))));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map(csvHeaderKey);
  const valueAt = (cells: string[], names: string[]) => {
    const index = headers.findIndex((header) => names.includes(header));
    return index < 0 ? '' : (cells[index] ?? '').trim();
  };
  return rows.slice(headerIndex + 1).map((cells) => ({
    effectiveDate: valueAt(cells, ['effectivedate', 'date', 'asof', 'valuedate', 'ratedate']),
    sourceCurrency: valueAt(cells, ['sourcecurrency', 'fromcurrency', 'basecurrency', 'currencyfrom']).toUpperCase(),
    functionalCurrency: valueAt(cells, ['functionalcurrency', 'tocurrency', 'targetcurrency', 'quotecurrency']).toUpperCase(),
    rate: Number(valueAt(cells, ['rate', 'exchangerate', 'closingrate', 'midrate']).replaceAll(',', '')),
    source: valueAt(cells, ['ratesource', 'provider', 'publisher', 'source']) || 'Imported CSV',
    note: valueAt(cells, ['note', 'memo', 'comment']) || null,
  })).filter((rate) => /^\d{4}-\d{2}-\d{2}$/.test(rate.effectiveDate)
    && /^[A-Z]{3}$/.test(rate.sourceCurrency)
    && /^[A-Z]{3}$/.test(rate.functionalCurrency)
    && Number.isFinite(rate.rate)
    && rate.rate > 0);
}

async function fileAsBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 0x6000;
  let base64 = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    base64 += btoa(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }
  return base64;
}

function openInvitationEmail(invitation: Pick<WorkspaceInvitation, 'email' | 'emailSubject' | 'emailBody'>) {
  if (!invitation.emailSubject || !invitation.emailBody) return;
  const mailto = `mailto:${encodeURIComponent(invitation.email)}?subject=${encodeURIComponent(invitation.emailSubject)}&body=${encodeURIComponent(invitation.emailBody)}`;
  window.location.assign(mailto);
}
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "hsl(var(--primary))",
    colorForeground: "hsl(var(--foreground))",
    colorMutedForeground: "hsl(var(--muted-foreground))",
    colorDanger: "hsl(var(--destructive))",
    colorBackground: "hsl(var(--card))",
    colorInput: "hsl(var(--background))",
    colorInputForeground: "hsl(var(--foreground))",
    colorNeutral: "hsl(var(--border))",
    fontFamily: "DM Sans, sans-serif",
    borderRadius: "0.65rem",
  },
};

function ClientSettingsPage() {
  const { activeClient } = useClientWorkspace();
  const [, setLocation] = useLocation();
  const mutation = useUpdateClient();
  const ratesQuery = useGetExchangeRates({ query: { queryKey: getGetExchangeRatesQueryKey() } });
  const createRate = useCreateExchangeRate();
  const updateRate = useUpdateExchangeRate();
  const deleteRate = useDeleteExchangeRate();
  const importRates = useImportExchangeRates();
  const parseRates = useParseExchangeRates();
  const bankAccountsQuery = useGetBankAccounts({ clientId: activeClient?.id ?? 0 });
  const [form, setForm] = useState({
    name: activeClient?.name ?? '',
    legalName: activeClient?.legalName ?? '',
    functionalCurrency: activeClient?.functionalCurrency ?? 'AED',
    basis: activeClient?.basis ?? 'IFRS',
    period: activeClient?.period ?? '',
  });
  const [editingRateId, setEditingRateId] = useState<number | null>(null);
  const [rateForm, setRateForm] = useState({ sourceCurrency: 'USD', functionalCurrency: activeClient?.functionalCurrency ?? 'AED', effectiveDate: '2026-08-01', rate: '', source: 'Manual', note: '' });
  const [rateImportError, setRateImportError] = useState('');
  const [rateImportNotice, setRateImportNotice] = useState('');
  const [ratePreview, setRatePreview] = useState<ExchangeRateParseResult | null>(null);
  const [saved, setSaved] = useState(false);

  if (!activeClient) return <WorkspaceRecoveryState onRetry={() => setLocation('/')} />;

  const resetRateForm = () => {
    setEditingRateId(null);
    setRateForm({ sourceCurrency: 'USD', functionalCurrency: activeClient.functionalCurrency, effectiveDate: new Date().toISOString().slice(0, 10), rate: '', source: 'Manual', note: '' });
  };
  const invalidateRates = () => {
    queryClient.invalidateQueries({ queryKey: getGetExchangeRatesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetLedgerOverviewQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey() });
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setSaved(false);
    mutation.mutate({ id: activeClient.id, data: form }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetClientsQueryKey() });
        setSaved(true);
      },
    });
  };
  const saveRate = (event: React.FormEvent) => {
    event.preventDefault();
    const data = { ...rateForm, sourceCurrency: rateForm.sourceCurrency.toUpperCase(), functionalCurrency: rateForm.functionalCurrency.toUpperCase(), rate: Number(rateForm.rate), note: rateForm.note || null };
    const options = { onSuccess: () => { invalidateRates(); resetRateForm(); } };
    if (editingRateId) updateRate.mutate({ id: editingRateId, data }, options);
    else createRate.mutate({ data }, options);
  };
  const editRate = (rate: ExchangeRate) => {
    setEditingRateId(rate.id);
    setRateForm({ sourceCurrency: rate.sourceCurrency, functionalCurrency: rate.functionalCurrency, effectiveDate: rate.effectiveDate, rate: String(rate.rate), source: rate.source, note: rate.note ?? '' });
  };
  const importParsedRates = async (rates: ExchangeRateInput[], source: 'csv' | 'ai') => {
    try {
      const result = await importRates.mutateAsync({ data: { rates } });
      invalidateRates();
      setRatePreview(null);
      setRateImportNotice(`${result.importedCount + result.updatedCount} rate${result.importedCount + result.updatedCount === 1 ? '' : 's'} ${source === 'ai' ? 'confirmed and ' : ''}imported (${result.updatedCount} updated).`);
    } catch (error) {
      setRateImportError(error instanceof Error ? error.message : 'The detected rates could not be imported. Check the preview and try again.');
    }
  };
  const importRateFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setRateImportError('');
      setRateImportNotice('');
      setRatePreview(null);
      const isWorkbook = file.name.toLowerCase().endsWith('.xlsx')
        || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      if (isWorkbook) {
        if (file.size > 15 * 1024 * 1024) throw new Error('This Excel workbook is too large. Choose a file smaller than 15 MB.');
        const preview = await parseRates.mutateAsync({
          data: { clientId: activeClient.id, fileBase64: await fileAsBase64(file), fileName: file.name },
        });
        if (!preview.rates.length) throw new Error('No safe exchange-rate rows were found. Add clear date, currency, and rate values, then try again.');
        setRatePreview(preview);
        return;
      }
      const content = await file.text();
      const rates = deterministicExchangeRates(content);
      if (rates.length) {
        await importParsedRates(rates, 'csv');
        return;
      }
      if (content.length > 120000) throw new Error('This CSV is too large for AI-assisted detection. Reduce it to 120 KB or use the standard template.');
      const preview = await parseRates.mutateAsync({ data: { clientId: activeClient.id, content, fileName: file.name } });
      if (!preview.rates.length) throw new Error('No safe exchange-rate rows were found. Add clear date, currency, and rate values, then try again.');
      setRatePreview(preview);
    } catch (error) {
      setRateImportError(error instanceof Error ? error.message : 'The rate file could not be read or mapped safely.');
    }
  };
  const update = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }));

  return <div>
    <PageHeading
      eyebrow="Client accounting settings"
      title="Client settings"
      description="Manage the selected client’s legal identity, reporting context, bank accounts, and AI configuration."
      action={<Link href="/" data-testid="link-settings-back-overview" className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-xs font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground"><ArrowRight className="rotate-180" size={14} /> Back to overview</Link>}
    />
    <div className="grid gap-6 xl:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="h-fit rounded-lg border border-card-border bg-card p-3 xl:sticky xl:top-[102px]">
        <div className="px-2 py-2 font-mono text-[9px] uppercase tracking-[.18em] text-muted-foreground">Settings index</div>
        <nav className="mt-2 space-y-1">
          {[
            ['#client-profile', 'Client profile'],
            ['#bank-accounts', 'Bank accounts'],
            ['#ai-connection', 'AI connection'],
          ].map(([href, label]) => <a key={href} href={href} data-testid={`link-settings-${label.toLowerCase().replace(/ & /g, '-').replace(/ /g, '-')}`} className="block rounded-md px-2 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">{label}</a>)}
        </nav>
        <div className="mt-4 rounded-md border border-primary/20 bg-primary/5 p-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-primary"><Settings2 size={14} /> Active client</div>
          <div data-testid="text-settings-active-client" className="mt-2 text-xs font-semibold">{activeClient.name}</div>
          <div className="mt-1 font-mono text-[10px] text-muted-foreground">{activeClient.functionalCurrency} · {activeClient.basis}</div>
        </div>
      </aside>
      <div className="min-w-0 space-y-6">
        <section id="client-profile" className="scroll-mt-24 rounded-lg border border-card-border bg-card p-5 md:p-6">
          <div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Landmark size={18} /></div><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Client profile</div><h2 className="mt-2 text-base font-semibold">Identity and reporting context</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">These values appear on close views and determine how imported activity is converted for reporting.</p></div></div>
          <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-medium">Client name<input data-testid="input-page-settings-client-name" required value={form.name} onChange={(event) => update('name', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label>
            <label className="block text-xs font-medium">Legal name<input data-testid="input-page-settings-legal-name" required value={form.legalName} onChange={(event) => update('legalName', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label>
            <label className="block text-xs font-medium">Functional currency<select data-testid="select-page-settings-currency" value={form.functionalCurrency} onChange={(event) => update('functionalCurrency', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option value="AED">AED — UAE dirham</option><option value="USD">USD — US dollar</option><option value="EUR">EUR — euro</option><option value="GBP">GBP — pound sterling</option></select></label>
            <label className="block text-xs font-medium">Reporting basis<select data-testid="select-page-settings-basis" value={form.basis} onChange={(event) => update('basis', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option value="IFRS">IFRS</option><option value="IFRS for SMEs">IFRS for SMEs</option></select></label>
            <label className="block text-xs font-medium sm:col-span-2">Close period<input data-testid="input-page-settings-period" type="month" required value={periodToMonthInput(form.period)} onChange={(event) => update('period', monthInputToPeriod(event.target.value))} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label>
            {(mutation.isError || saved) && <p data-testid={saved ? 'status-page-settings-saved' : 'status-page-settings-error'} className={`text-xs sm:col-span-2 ${saved ? 'text-primary' : 'text-destructive'}`}>{saved ? 'Workspace settings saved.' : 'Settings could not be saved. Check the details and try again.'}</p>}
            <div className="flex justify-end sm:col-span-2"><button data-testid="button-page-save-workspace-settings" disabled={mutation.isPending} className="rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{mutation.isPending ? 'Saving…' : 'Save profile settings'}</button></div>
          </form>
        </section>
        {ratePreview && <><section id="exchange-rates" className="scroll-mt-24 rounded-lg border border-card-border bg-card p-5 md:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Shared conversion library</div><h2 className="mt-2 text-base font-semibold">Exchange-rate schedule</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Enter functional-currency units for one source-currency unit. LedgerFlow uses the exact date first, then the latest prior rate. CSV and Excel layouts without standard headers are prepared for your review with AI.</p></div><label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-[11px] font-semibold hover:bg-muted"><UploadCloud size={14} /> {parseRates.isPending ? 'Detecting layout…' : importRates.isPending ? 'Importing…' : 'Import file'}<input data-testid="input-page-exchange-rate-import" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={parseRates.isPending || importRates.isPending} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; void importRateFile(file); }} /></label></div>
          <form onSubmit={saveRate} className="mt-5 grid gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 md:grid-cols-6">
            <label className="text-[10px] font-medium">Source<input data-testid="input-page-rate-source-currency" required maxLength={3} value={rateForm.sourceCurrency} onChange={(event) => setRateForm({ ...rateForm, sourceCurrency: event.target.value.toUpperCase() })} className="mt-1 h-9 w-full rounded border border-input bg-card px-2 font-mono text-xs" /></label>
            <label className="text-[10px] font-medium">Functional<input data-testid="input-page-rate-functional-currency" required maxLength={3} value={rateForm.functionalCurrency} onChange={(event) => setRateForm({ ...rateForm, functionalCurrency: event.target.value.toUpperCase() })} className="mt-1 h-9 w-full rounded border border-input bg-card px-2 font-mono text-xs" /></label>
            <label className="text-[10px] font-medium">Effective date<input data-testid="input-page-rate-effective-date" required type="date" value={rateForm.effectiveDate} onChange={(event) => setRateForm({ ...rateForm, effectiveDate: event.target.value })} className="mt-1 h-9 w-full rounded border border-input bg-card px-2 text-xs" /></label>
            <label className="text-[10px] font-medium">Rate<input data-testid="input-page-rate-value" required min="0.0000001" step="any" type="number" value={rateForm.rate} onChange={(event) => setRateForm({ ...rateForm, rate: event.target.value })} className="mt-1 h-9 w-full rounded border border-input bg-card px-2 font-mono text-xs" /></label>
            <label className="text-[10px] font-medium">Source note<input data-testid="input-page-rate-note" value={rateForm.note} onChange={(event) => setRateForm({ ...rateForm, note: event.target.value })} placeholder="e.g. Central bank" className="mt-1 h-9 w-full rounded border border-input bg-card px-2 text-xs" /></label>
            <div className="flex items-end gap-2"><button data-testid="button-page-save-exchange-rate" disabled={createRate.isPending || updateRate.isPending} className="h-9 rounded bg-primary px-3 text-[11px] font-semibold text-primary-foreground disabled:opacity-50">{editingRateId ? 'Update' : 'Add rate'}</button>{editingRateId && <button type="button" data-testid="button-page-cancel-exchange-rate" onClick={resetRateForm} className="h-9 rounded border border-border px-2 text-[11px] font-semibold">Cancel</button>}</div>
          </form>
          {(createRate.isError || updateRate.isError || importRates.isError || rateImportError) && <p data-testid="status-page-exchange-rate-error" className="mt-3 text-xs text-destructive">{rateImportError || 'The rate could not be saved. Use three-letter currency codes, a valid date, and a rate greater than zero.'}</p>}
          {rateImportNotice && <p data-testid="status-page-exchange-rate-success" className="mt-3 text-xs text-primary">{rateImportNotice}</p>}
          {ratePreview && <section data-testid="card-page-exchange-rate-ai-preview" className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-mono text-[9px] uppercase tracking-[.14em] text-primary">AI-assisted import preview</div><h3 className="mt-1 text-sm font-semibold">Confirm the detected rate mapping</h3><p className="mt-1 text-[11px] leading-5 text-muted-foreground">Nothing has been imported yet. Review the direction and sample rows before confirming.</p></div><span className="rounded-full bg-card px-2 py-1 font-mono text-[10px] text-primary">{Math.round(ratePreview.confidence * 100)}% confidence</span></div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{[['Date', ratePreview.mapping.effectiveDate], ['Source currency', ratePreview.mapping.sourceCurrency], ['Functional currency', ratePreview.mapping.functionalCurrency], ['Rate', ratePreview.mapping.rate], ['Source note', ratePreview.mapping.source]].map(([label, value]) => <div key={label} className="rounded border border-primary/15 bg-card px-3 py-2"><div className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">{label}</div><div className="mt-1 truncate text-[11px] font-semibold">{value || 'Not detected'}</div></div>)}</div>
            {ratePreview.warnings.length > 0 && <ul data-testid="list-page-exchange-rate-preview-warnings" className="mt-3 space-y-1 rounded border border-accent/25 bg-accent/10 p-3 text-[11px] text-accent-foreground">{ratePreview.warnings.map((warning, index) => <li key={`${warning}-${index}`}>• {warning}</li>)}</ul>}
            <div className="mt-4 overflow-x-auto rounded border border-primary/15 bg-card"><table className="w-full min-w-[560px] text-left text-[11px]"><thead className="bg-muted/55 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground"><tr><th className="px-3 py-2">Effective</th><th className="px-3 py-2">Direction</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2">Source</th></tr></thead><tbody className="divide-y divide-border">{ratePreview.rates.slice(0, 10).map((rate, index) => <tr key={`${rate.effectiveDate}-${rate.sourceCurrency}-${rate.functionalCurrency}-${index}`}><td className="px-3 py-2 font-mono">{shortDate(rate.effectiveDate)}</td><td className="px-3 py-2 font-semibold">{rate.sourceCurrency} → {rate.functionalCurrency}</td><td className="px-3 py-2 text-right font-mono">{rate.rate.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td><td className="px-3 py-2 text-muted-foreground">{rate.source || 'AI-assisted CSV'}</td></tr>)}</tbody></table></div>
            {ratePreview.rates.length > 10 && <p className="mt-2 text-[10px] text-muted-foreground">Showing 10 of {ratePreview.rates.length} detected rates.</p>}
            <div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" data-testid="button-page-cancel-exchange-rate-ai-preview" onClick={() => setRatePreview(null)} disabled={importRates.isPending} className="rounded border border-border px-3 py-2 text-[11px] font-semibold text-muted-foreground">Discard</button><button type="button" data-testid="button-page-confirm-exchange-rate-ai-preview" onClick={() => void importParsedRates(ratePreview.rates, 'ai')} disabled={importRates.isPending} className="rounded bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground disabled:opacity-50">{importRates.isPending ? 'Importing…' : `Confirm & import ${ratePreview.rates.length} rate${ratePreview.rates.length === 1 ? '' : 's'}`}</button></div>
          </section>}
        <div className="mt-4 overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[650px] text-left"><thead className="bg-muted/55 font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground"><tr><th className="px-3 py-2">Effective</th><th className="px-3 py-2">Direction</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2">Source / note</th><th className="px-3 py-2 text-right">Actions</th></tr></thead><tbody className="divide-y divide-border">{ratesQuery.isLoading ? <tr><td colSpan={5} className="px-3 py-5 text-center text-xs text-muted-foreground">Loading workspace rates…</td></tr> : ratesQuery.data?.length ? ratesQuery.data?.map((rate) => <tr data-testid={`row-page-exchange-rate-${rate.id}`} key={rate.id}><td className="px-3 py-3 font-mono text-[11px]">{shortDate(rate.effectiveDate)}</td><td className="px-3 py-3 text-xs font-semibold">{rate.sourceCurrency} → {rate.functionalCurrency}</td><td className="px-3 py-3 text-right font-mono text-xs">{rate.rate.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td><td className="px-3 py-3 text-[11px] text-muted-foreground">{rate.source}{rate.note ? ` · ${rate.note}` : ''}</td><td className="px-3 py-3 text-right"><button data-testid={`button-page-edit-exchange-rate-${rate.id}`} type="button" onClick={() => editRate(rate)} className="mr-2 text-[11px] font-semibold text-primary">Edit</button><button data-testid={`button-page-delete-exchange-rate-${rate.id}`} type="button" disabled={deleteRate.isPending} onClick={() => deleteRate.mutate({ id: rate.id }, { onSuccess: invalidateRates })} className="text-[11px] font-semibold text-destructive">Remove</button></td></tr>) : <tr><td colSpan={5} className="px-3 py-5 text-center text-xs text-muted-foreground">No workspace rates yet. AED-only clients do not need a rate.</td></tr>}</tbody></table></div>
        </section></>}
        <section id="bank-accounts" className="scroll-mt-24 rounded-lg border border-card-border bg-card p-5 md:p-6">
          <div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-primary"><Landmark size={18} /></div><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Evidence sources</div><h2 className="mt-2 text-base font-semibold">Connected bank accounts</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Accounts are detected from imported statements and kept separate per client. Import another statement to add a new account.</p></div></div>
          <div className="mt-5 overflow-hidden rounded-lg border border-border">{bankAccountsQuery.isLoading ? <div className="p-5 text-xs text-muted-foreground">Loading connected accounts…</div> : bankAccountsQuery.data?.length ? <div className="divide-y divide-border">{bankAccountsQuery.data.map((account) => <div data-testid={`row-page-bank-account-${account.id}`} key={account.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="text-xs font-semibold">{account.name}</div><div className="mt-1 text-[11px] text-muted-foreground">{account.bankName || 'Bank not identified'}{account.accountNumberLast4 ? ` · ending ${account.accountNumberLast4}` : ''}</div></div><span className="rounded-full bg-secondary px-2.5 py-1 font-mono text-[10px] text-primary">{account.currency}</span></div>)}</div> : <div data-testid="state-page-bank-accounts-empty" className="p-5 text-xs text-muted-foreground">No bank accounts detected yet. They will appear here after a statement import identifies an account.</div>}</div>
        </section>
        {false && <WorkspaceUsageSection />}
        <div id="ai-connection" className="scroll-mt-24 rounded-lg border border-card-border bg-card p-5 md:p-6">
          <AIProviderSettingsPanel clientId={activeClient.id} />
        </div>
        {false && <><section id="administration" className="scroll-mt-24 rounded-lg border border-card-border bg-card p-5 md:p-6">
          <div className="flex items-start justify-between gap-4"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Workspace administration</div><h2 className="mt-2 text-base font-semibold">More controls for your team</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">These are the next places to manage how your firm uses LedgerFlow. They are shown here so the workspace has one clear home for operational settings.</p></div><Settings2 className="shrink-0 text-muted-foreground" size={18} /></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              { id: 'users', title: 'Users & permissions', detail: 'Invite teammates, assign admin or bookkeeper access, and control which client workspaces each person can open.', status: 'Coming with team access', icon: CircleCheck },
              { id: 'billing', title: 'Billing & plan', detail: 'View the current plan, manage payment details, and see invoices or renewal information in one place.', status: 'Billing connection needed', icon: FileCheck2 },
               { id: 'usage', title: 'Usage & limits', detail: 'Track statement imports, stored evidence, AI activity, and workspace limits before they affect a close.', status: 'Available above', icon: BarChart3 },
              { id: 'security', title: 'Security & audit', detail: 'Review sign-in activity, retention controls, export history, and the audit trail for sensitive workspace actions.', status: 'Audit expansion planned', icon: CircleAlert },
            ].map(({ id, title, detail, status, icon: Icon }) => <div data-testid={`card-settings-${id}`} key={id} className="rounded-lg border border-border bg-background p-4"><div className="flex items-start gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><Icon size={16} /></div><div className="min-w-0"><h3 className="text-xs font-semibold">{title}</h3><p className="mt-2 text-[11px] leading-5 text-muted-foreground">{detail}</p><span data-testid={`status-settings-${id}`} className="mt-3 inline-flex rounded-full bg-muted px-2 py-1 font-mono text-[9px] uppercase tracking-[.08em] text-muted-foreground">{status}</span></div></div></div>)}
          </div>
        </section>
        <div id="team-access" className="scroll-mt-24 rounded-lg border border-card-border bg-card p-5 md:p-6">
          <TeamAccessSection />
        </div></>}
      </div>
    </div>
  </div>;
}

function FirmSettingsPage() {
  const firmQuery = useGetFirmProfile({ query: { queryKey: getGetFirmProfileQueryKey() } });
  const clientsQuery = useGetClients({ query: { queryKey: getGetClientsQueryKey() } });
  const saveFirm = useUpdateFirmProfile();
  const ratesQuery = useGetExchangeRates({ query: { queryKey: getGetExchangeRatesQueryKey() } });
  const createRate = useCreateExchangeRate();
  const deleteRate = useDeleteExchangeRate();
  const importRates = useImportExchangeRates();
  const parseRates = useParseExchangeRates();
  const { user } = useUser();
  const [form, setForm] = useState({ name: '', legalName: '' });
  const [rate, setRate] = useState({ sourceCurrency: 'USD', functionalCurrency: 'AED', effectiveDate: new Date().toISOString().slice(0, 10), rate: '' });
  const [rateImportError, setRateImportError] = useState('');
  const [rateImportNotice, setRateImportNotice] = useState('');
  const [ratePreview, setRatePreview] = useState<ExchangeRateParseResult | null>(null);
  const [ratePage, setRatePage] = useState(1);
  useEffect(() => {
    if (firmQuery.data) setForm({ name: firmQuery.data.name, legalName: firmQuery.data.legalName });
  }, [firmQuery.data?.id, firmQuery.data?.name, firmQuery.data?.legalName]);
  const refreshRates = () => {
    queryClient.invalidateQueries({ queryKey: getGetExchangeRatesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetLedgerOverviewQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey() });
  };
  const firmRates = ratesQuery.data ?? [];
  const firmRatePageCount = Math.max(1, Math.ceil(firmRates.length / FIRM_RATE_PAGE_SIZE));
  const currentFirmRatePage = Math.min(ratePage, firmRatePageCount);
  const visibleFirmRates = firmRates.slice(
    (currentFirmRatePage - 1) * FIRM_RATE_PAGE_SIZE,
    currentFirmRatePage * FIRM_RATE_PAGE_SIZE,
  );
  useEffect(() => {
    if (ratePage > firmRatePageCount) setRatePage(firmRatePageCount);
  }, [ratePage, firmRatePageCount]);
  const importParsedRates = async (rates: ExchangeRateInput[], source: 'csv' | 'ai') => {
    try {
      const result = await importRates.mutateAsync({ data: { rates } });
      refreshRates();
      setRatePage(1);
      setRatePreview(null);
      setRateImportNotice(`${result.importedCount + result.updatedCount} rate${result.importedCount + result.updatedCount === 1 ? '' : 's'} ${source === 'ai' ? 'confirmed and ' : ''}imported (${result.updatedCount} updated).`);
    } catch (error) {
      setRateImportError(error instanceof Error ? error.message : 'The detected rates could not be imported. Check the preview and try again.');
    }
  };
  const importRateFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setRateImportError('');
      setRateImportNotice('');
      setRatePreview(null);
      const isWorkbook = file.name.toLowerCase().endsWith('.xlsx')
        || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      if (isWorkbook) {
        if (file.size > 15 * 1024 * 1024) throw new Error('This Excel workbook is too large. Choose a file smaller than 15 MB.');
        const clientId = clientsQuery.data?.[0]?.id;
        if (!clientId) throw new Error('Add at least one client workspace before importing an Excel schedule.');
        const preview = await parseRates.mutateAsync({
          data: { clientId, fileBase64: await fileAsBase64(file), fileName: file.name },
        });
        if (!preview.rates.length) throw new Error('No safe exchange-rate rows were found. Add clear date, currency, and rate values, then try again.');
        setRatePreview(preview);
        return;
      }
      const content = await file.text();
      const rates = deterministicExchangeRates(content);
      if (rates.length) {
        await importParsedRates(rates, 'csv');
        return;
      }
      if (content.length > 120000) throw new Error('This CSV is too large for AI-assisted detection. Reduce it to 120 KB or use the standard template.');
      const clientId = clientsQuery.data?.[0]?.id;
      if (!clientId) throw new Error('Add at least one client workspace before importing an unstructured CSV.');
      const preview = await parseRates.mutateAsync({ data: { clientId, content, fileName: file.name } });
      if (!preview.rates.length) throw new Error('No safe exchange-rate rows were found. Add clear date, currency, and rate values, then try again.');
      setRatePreview(preview);
    } catch (error) {
      setRateImportError(error instanceof Error ? error.message : 'The rate file could not be read or mapped safely.');
    }
  };
  return <div>
    <PageHeading eyebrow="Bookkeeping firm administration" title="Firm settings" description="These controls belong to your bookkeeping firm and stay the same when you switch clients." action={<Link href="/client-settings" className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-xs font-semibold text-muted-foreground"><Settings2 size={14} /> Client settings</Link>} />
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="rounded-lg border border-card-border bg-card p-5 md:p-6">
        <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Firm identity & account owner</div>
        <h2 className="mt-2 text-base font-semibold">Your bookkeeping company</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">This identity and the account owner are shared across every client workspace.</p>
        <form onSubmit={(event) => { event.preventDefault(); saveFirm.mutate({ data: form }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetFirmProfileQueryKey() }) }); }} className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-medium">Firm name<input data-testid="input-firm-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" /></label>
          <label className="text-xs font-medium">Legal firm name<input data-testid="input-firm-legal-name" required value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" /></label>
          <div className="rounded-md bg-muted px-3 py-2 text-xs sm:col-span-2">Account owner: <strong>{user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Loading profile…'}</strong></div>
          <div className="flex justify-end sm:col-span-2"><button data-testid="button-save-firm-settings" disabled={saveFirm.isPending || firmQuery.isLoading} className="rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground">{saveFirm.isPending ? 'Saving…' : 'Save firm settings'}</button></div>
        </form>
      </section>
      <section className="rounded-lg border border-card-border bg-card p-5 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Shared conversion library</div>
            <h2 className="mt-2 text-base font-semibold">Firm exchange-rate schedule</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">One schedule is reused by all of this firm’s clients. Add a rate once; reporting conversions refresh across the firm.</p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-[11px] font-semibold hover:bg-muted">
            <UploadCloud size={14} />
            {parseRates.isPending ? 'Detecting layout…' : importRates.isPending ? 'Importing…' : 'Import CSV or Excel'}
            <input
              data-testid="input-firm-exchange-rate-import"
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={parseRates.isPending || importRates.isPending}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = '';
                void importRateFile(file);
              }}
            />
          </label>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); createRate.mutate({ data: { ...rate, sourceCurrency: rate.sourceCurrency.toUpperCase(), functionalCurrency: rate.functionalCurrency.toUpperCase(), rate: Number(rate.rate), source: 'Manual', note: null } }, { onSuccess: () => { refreshRates(); setRate({ ...rate, rate: '' }); setRatePage(1); } }); }} className="mt-5 grid gap-3 sm:grid-cols-5">
          <input aria-label="Source currency" value={rate.sourceCurrency} maxLength={3} onChange={(event) => setRate({ ...rate, sourceCurrency: event.target.value })} className="h-9 rounded border border-input bg-background px-2 text-xs" />
          <input aria-label="Functional currency" value={rate.functionalCurrency} maxLength={3} onChange={(event) => setRate({ ...rate, functionalCurrency: event.target.value })} className="h-9 rounded border border-input bg-background px-2 text-xs" />
          <input aria-label="Effective date" type="date" value={rate.effectiveDate} onChange={(event) => setRate({ ...rate, effectiveDate: event.target.value })} className="h-9 rounded border border-input bg-background px-2 text-xs" />
          <input aria-label="Exchange rate" required type="number" min="0.00000001" step="any" value={rate.rate} onChange={(event) => setRate({ ...rate, rate: event.target.value })} className="h-9 rounded border border-input bg-background px-2 text-xs" />
          <button data-testid="button-add-firm-exchange-rate" disabled={createRate.isPending} className="rounded bg-primary px-3 text-xs font-semibold text-primary-foreground">Add rate</button>
        </form>
        {(createRate.isError || importRates.isError || rateImportError) && <p data-testid="status-firm-exchange-rate-error" className="mt-3 text-xs text-destructive">{rateImportError || 'The rate could not be saved. Use three-letter currency codes, a valid date, and a rate greater than zero.'}</p>}
        {rateImportNotice && <p data-testid="status-firm-exchange-rate-success" className="mt-3 text-xs text-primary">{rateImportNotice}</p>}
        {ratePreview && <div data-testid="card-firm-exchange-rate-import-preview" className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-mono text-[9px] uppercase tracking-[.14em] text-primary">Import review</div>
              <h3 className="mt-1 text-sm font-semibold">Confirm the detected rate mapping</h3>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Nothing has been imported yet. Review the direction and sample rows before confirming.</p>
            </div>
            <span className="rounded-full bg-card px-2 py-1 font-mono text-[10px] text-primary">{Math.round(ratePreview.confidence * 100)}% confidence</span>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{[['Date', ratePreview.mapping.effectiveDate], ['Source currency', ratePreview.mapping.sourceCurrency], ['Functional currency', ratePreview.mapping.functionalCurrency], ['Rate', ratePreview.mapping.rate], ['Source note', ratePreview.mapping.source]].map(([label, value]) => <div key={label} className="rounded border border-primary/15 bg-card px-3 py-2"><div className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">{label}</div><div className="mt-1 truncate text-[11px] font-semibold">{value || 'Not detected'}</div></div>)}</div>
          {ratePreview.warnings.length > 0 && <ul data-testid="list-firm-exchange-rate-preview-warnings" className="mt-3 space-y-1 rounded border border-accent/25 bg-accent/10 p-3 text-[11px] text-accent-foreground">{ratePreview.warnings.map((warning, index) => <li key={`${warning}-${index}`}>• {warning}</li>)}</ul>}
          <div className="mt-4 overflow-x-auto rounded border border-primary/15 bg-card"><table className="w-full min-w-[560px] text-left text-[11px]"><thead className="bg-muted/55 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground"><tr><th className="px-3 py-2">Effective</th><th className="px-3 py-2">Direction</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2">Source</th></tr></thead><tbody className="divide-y divide-border">{ratePreview.rates.slice(0, 10).map((previewRate, index) => <tr key={`${previewRate.effectiveDate}-${previewRate.sourceCurrency}-${previewRate.functionalCurrency}-${index}`}><td className="px-3 py-2 font-mono">{shortDate(previewRate.effectiveDate)}</td><td className="px-3 py-2 font-semibold">{previewRate.sourceCurrency} → {previewRate.functionalCurrency}</td><td className="px-3 py-2 text-right font-mono">{previewRate.rate.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td><td className="px-3 py-2 text-muted-foreground">{previewRate.source || 'AI-assisted CSV'}</td></tr>)}</tbody></table></div>
          {ratePreview.rates.length > 10 && <p className="mt-2 text-[10px] text-muted-foreground">Showing 10 of {ratePreview.rates.length} detected rates.</p>}
          <div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" data-testid="button-discard-firm-exchange-rate-preview" onClick={() => setRatePreview(null)} disabled={importRates.isPending} className="rounded border border-border px-3 py-2 text-[11px] font-semibold text-muted-foreground">Discard</button><button type="button" data-testid="button-confirm-firm-exchange-rate-import" onClick={() => void importParsedRates(ratePreview.rates, 'ai')} disabled={importRates.isPending} className="rounded bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground disabled:opacity-50">{importRates.isPending ? 'Importing…' : `Confirm & import ${ratePreview.rates.length} rate${ratePreview.rates.length === 1 ? '' : 's'}`}</button></div>
        </div>}
        <div className="mt-5 divide-y rounded-md border border-border">{ratesQuery.isLoading ? <p className="p-3 text-xs text-muted-foreground">Loading firm schedule…</p> : firmRates.length ? visibleFirmRates.map((item) => <div key={item.id} data-testid={`row-firm-exchange-rate-${item.id}`} className="flex items-center justify-between gap-3 p-3 text-xs"><span><strong>{item.sourceCurrency} → {item.functionalCurrency}</strong> · {item.rate} · {shortDate(item.effectiveDate)}</span><button onClick={() => deleteRate.mutate({ id: item.id }, { onSuccess: refreshRates })} className="text-destructive">Remove</button></div>) : <p className="p-3 text-xs text-muted-foreground">No shared rates yet.</p>}</div>
        {firmRates.length > FIRM_RATE_PAGE_SIZE && <div data-testid="pagination-firm-exchange-rates" className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span>Showing {(currentFirmRatePage - 1) * FIRM_RATE_PAGE_SIZE + 1}–{Math.min(currentFirmRatePage * FIRM_RATE_PAGE_SIZE, firmRates.length)} of {firmRates.length} rates</span>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Previous exchange-rate page" onClick={() => setRatePage((page) => Math.max(1, page - 1))} disabled={currentFirmRatePage === 1} className="rounded border border-border px-2 py-1 font-semibold disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
            <span className="font-mono">Page {currentFirmRatePage} of {firmRatePageCount}</span>
            <button type="button" aria-label="Next exchange-rate page" onClick={() => setRatePage((page) => Math.min(firmRatePageCount, page + 1))} disabled={currentFirmRatePage === firmRatePageCount} className="rounded border border-border px-2 py-1 font-semibold disabled:cursor-not-allowed disabled:opacity-50">Next</button>
          </div>
        </div>}
      </section>
      <WorkspaceUsageSection />
      <section className="rounded-lg border border-card-border bg-card p-5 md:p-6"><TeamAccessSection /></section>
    </div>
  </div>;
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}
type LedgerFlowUser = {
  id: string;
  externalId?: string | null;
  primaryEmailAddress?: { emailAddress: string } | null;
  firstName: string | null;
  lastName: string | null;
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
  const [form, setForm] = useState({ name: '', legalName: '', functionalCurrency: 'AED', basis: 'IFRS', period: '' });
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
  return <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4 backdrop-blur-sm"><div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border border-card-border bg-card p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="add-client-title"><div className="flex items-start justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Client workspace setup</div><h2 id="add-client-title" className="mt-2 text-lg font-semibold">Add client</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">Create a separate client workspace and set its own reporting context.</p></div><button data-testid="button-close-add-client" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X size={17} /></button></div><form onSubmit={submit} className="mt-6 space-y-4"><label className="block text-xs font-medium">Client name<input data-testid="input-client-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Northstar Advisory" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Legal name<input data-testid="input-client-legal-name" required value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} placeholder="e.g. Northstar Advisory FZ-LLC" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Functional currency<select data-testid="select-client-currency" required value={form.functionalCurrency} onChange={(event) => setForm({ ...form, functionalCurrency: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 py-0 text-sm outline-none focus:border-primary"><option value="AED">AED — UAE dirham</option><option value="USD">USD — US dollar</option><option value="EUR">EUR — euro</option><option value="GBP">GBP — pound sterling</option></select></label><label className="block text-xs font-medium">Reporting basis<select data-testid="select-client-basis" required value={form.basis} onChange={(event) => setForm({ ...form, basis: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 py-0 text-sm outline-none focus:border-primary"><option value="IFRS">IFRS</option><option value="IFRS for SMEs">IFRS for SMEs</option></select></label><label className="block text-xs font-medium">Close period<input data-testid="input-client-period" type="month" required value={periodToMonthInput(form.period)} onChange={(event) => setForm({ ...form, period: monthInputToPeriod(event.target.value) })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label>{mutation.isError && <p className="text-xs text-destructive">This client could not be created. Check the details and try again.</p>}<button data-testid="button-submit-client" disabled={mutation.isPending} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-50">{mutation.isPending ? 'Creating workspace…' : <><Plus size={14} /> Create client workspace</>}</button></form></div></div>;
}

function TeamAccessSection() {
  const team = useGetWorkspaceMembers({ query: { queryKey: getGetWorkspaceMembersQueryKey() } });
  const invite = useCreateWorkspaceInvitation();
  const resend = useResendWorkspaceInvitation();
  const updateMember = useUpdateWorkspaceMember();
  const removeMember = useRemoveWorkspaceMember();
  const revoke = useRevokeWorkspaceInvitation();
  const [form, setForm] = useState({ email: '', role: 'bookkeeper' as 'admin' | 'bookkeeper', clientIds: [] as number[] });
  const [link, setLink] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetWorkspaceMembersQueryKey() });
  const toggle = (id: number) => setForm((current) => ({ ...current, clientIds: current.clientIds.includes(id) ? current.clientIds.filter((item) => item !== id) : [...current.clientIds, id] }));
  const toggleMemberClient = (member: WorkspaceMember, clientId: number) => {
    const clientIds = member.clients.some((client) => client.id === clientId)
      ? member.clients.filter((client) => client.id !== clientId).map((client) => client.id)
      : [...member.clients.map((client) => client.id), clientId];
    updateMember.mutate({ userId: member.userId, data: { role: member.role, clientIds } }, { onSuccess: refresh });
  };
  const data = team.data;
  return <section data-testid="card-settings-users" className="mt-8 border-t border-border pt-6">
    <div className="flex items-start gap-3"><Users className="text-primary" size={18} /><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Users & permissions</div><h3 className="mt-1 text-sm font-semibold">Teammate access</h3><p className="mt-1 text-[11px] text-muted-foreground">Roles and client access are enforced for this workspace.</p></div></div>
    {team.isLoading ? <p className="mt-4 text-xs text-muted-foreground">Loading team access…</p> : team.isError ? <p className="mt-4 text-xs text-destructive">Team access could not be loaded.</p> : <>
      <div className="mt-4 divide-y rounded border border-border">{data?.members.map((member: WorkspaceMember) => <div key={member.userId} data-testid={`row-workspace-member-${member.userId}`} className="flex flex-wrap items-center justify-between gap-3 p-3 text-xs">
        <div><strong>{member.name}</strong> · {member.role}<div className="mt-2 flex flex-wrap gap-3 text-[11px]">{data?.canManage && !member.isCurrentUser ? data.clients.map((client) => <label key={client.id}><input data-testid={`checkbox-member-client-${member.userId}-${client.id}`} type="checkbox" checked={member.clients.some((assigned) => assigned.id === client.id)} disabled={updateMember.isPending} onChange={() => toggleMemberClient(member, client.id)} /> {client.name}</label>) : member.clients.map((client) => <span key={client.id}>{client.name}</span>)}</div></div>
        {data?.canManage && !member.isCurrentUser && <span className="flex gap-2"><select value={member.role} disabled={updateMember.isPending} onChange={(event) => updateMember.mutate({ userId: member.userId, data: { role: event.target.value as 'admin' | 'bookkeeper', clientIds: member.clients.map((client) => client.id) } }, { onSuccess: refresh })} className="rounded border border-input bg-card px-1 text-[11px]"><option value="admin">Admin</option><option value="bookkeeper">Bookkeeper</option></select><button data-testid={`button-remove-member-${member.userId}`} onClick={() => removeMember.mutate({ userId: member.userId }, { onSuccess: refresh })} className="text-destructive"><Trash2 size={14} /></button></span>}
      </div>)}</div>
      {data?.canManage && <form onSubmit={(event) => {
        event.preventDefault();
        invite.mutate({ data: form }, {
          onSuccess: (result) => {
            setLink(result.inviteLink ?? '');
            setForm((current) => ({ ...current, email: '' }));
            refresh();
            openInvitationEmail(result);
          },
        });
      }} className="mt-4 rounded border border-primary/20 bg-primary/5 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold"><UserPlus size={14} /> Invite teammate</div>
        <div className="mt-3 flex flex-wrap gap-2"><input data-testid="input-invite-email" required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="teammate@firm.com" className="h-8 flex-1 rounded border border-input bg-card px-2 text-xs" /><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as 'admin' | 'bookkeeper' })} className="h-8 rounded border border-input bg-card px-2 text-xs"><option value="bookkeeper">Bookkeeper</option><option value="admin">Admin</option></select></div>
        <div className="mt-3 flex flex-wrap gap-3">{data.clients.map((client) => <label key={client.id} className="text-[11px]"><input data-testid={`checkbox-invite-client-${client.id}`} type="checkbox" checked={form.clientIds.includes(client.id)} onChange={() => toggle(client.id)} /> {client.name}</label>)}</div>
        <button data-testid="button-invite-teammate" disabled={invite.isPending || !form.clientIds.length} className="mt-3 inline-flex items-center gap-1.5 rounded bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground disabled:opacity-50">{invite.isPending ? 'Preparing email…' : <><Mail size={13} /> Email invitation</>}</button>
        {link && <><input data-testid="input-invite-link" readOnly value={link} className="mt-3 h-8 w-full rounded border border-input bg-card px-2 font-mono text-[10px]" /><p className="mt-2 text-[10px] leading-4 text-muted-foreground">Your email app opened with the role, client access, expiry, and secure link. If it did not open, use the invitation link above.</p></>}
        {invite.isError && <p data-testid="status-invite-error" className="mt-2 text-[10px] text-destructive">The invitation could not be prepared. Check the email and selected client access.</p>}
      </form>}
      {data?.canManage && data.invitations.map((invitation) => <div key={invitation.id} data-testid={`row-workspace-invitation-${invitation.id}`} className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2 text-[11px]"><span>{invitation.email} · {invitation.role} · {invitation.status}<small className="ml-2 text-muted-foreground">expires {shortDate(invitation.expiresAt)}</small></span>{invitation.status === 'pending' && <span className="flex gap-3"><button data-testid={`button-resend-invitation-${invitation.id}`} disabled={resend.isPending || revoke.isPending} onClick={() => resend.mutate({ id: invitation.id }, { onSuccess: (result) => { setLink(result.inviteLink ?? ''); openInvitationEmail(result); refresh(); } })} className="inline-flex items-center gap-1 text-primary disabled:opacity-50"><RotateCw size={12} /> {resend.isPending ? 'Preparing…' : 'Resend email'}</button><button data-testid={`button-revoke-invitation-${invitation.id}`} disabled={revoke.isPending} onClick={() => revoke.mutate({ id: invitation.id }, { onSuccess: refresh })} className="text-destructive disabled:opacity-50">Revoke</button></span>}</div>)}
      {resend.isError && <p data-testid="status-resend-invitation-error" className="mt-2 text-[10px] text-destructive">This invitation could not be resent. It may no longer be pending.</p>}
    </>}
  </section>;
}
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

type UsageMetricView = {
  used: number;
  limit: number;
  percentage: number;
  status: 'healthy' | 'approaching' | 'at_limit';
};
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
function Shell({ children, user, onLogout }: { children: React.ReactNode; user: LedgerFlowUser; onLogout: () => void }) {
  const { activeClient, clients, setActiveClientId } = useClientWorkspace();
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.primaryEmailAddress?.emailAddress || 'Account';
  const initials = [user.firstName?.[0], user.lastName?.[0]].filter(Boolean).join('').toUpperCase() || displayName.slice(0, 2).toUpperCase();
  const current = nav.find((item) => item.href === location)?.label ?? 'Close overview';
  useEffect(() => {
    if (!accountMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [accountMenuOpen]);
  return <div className="min-h-[100dvh] bg-background">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-300 md:translate-x-0 ${collapsed ? 'md:w-[76px]' : ''} ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex h-[78px] items-center border-b border-sidebar-border px-5"><div className="flex min-w-0 items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"><Landmark size={19} strokeWidth={2.2} /></div><div className={`${collapsed ? 'md:hidden' : ''}`}><div className="font-display text-[22px] leading-none tracking-tight text-sidebar-foreground">LedgerFlow</div><div className="mt-1 font-mono text-[9px] uppercase tracking-[.2em] text-sidebar-foreground/50">Review desk</div></div></div><button aria-label="Close navigation" data-testid="button-close-navigation" className="ml-auto rounded-md p-1.5 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground md:hidden" onClick={() => setMobileOpen(false)}><X size={17} /></button></div>
      <div className={`px-3 pt-6 ${collapsed ? 'md:px-2' : ''}`}><div className={`mb-3 px-3 font-mono text-[9px] font-medium uppercase tracking-[.18em] text-sidebar-foreground/40 ${collapsed ? 'md:hidden' : ''}`}>Workspace</div><nav className="space-y-1">{nav.map(({ href, label, icon: Icon }) => { const active = href === '/' ? location === '/' : location.startsWith(href); return <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`} onClick={() => setMobileOpen(false)} className={`group flex items-center gap-3 rounded-md px-3 py-2.5 text-[13px] font-medium transition-colors ${active ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground'} ${collapsed ? 'md:justify-center md:px-0' : ''}`}><Icon size={17} strokeWidth={active ? 2.2 : 1.8} /><span className={collapsed ? 'md:hidden' : ''}>{label}</span>{active && !collapsed && <ChevronRight className="ml-auto" size={14} />}</Link>; })}</nav></div>
       <div className={`mt-auto border-t border-sidebar-border p-4 ${collapsed ? 'md:px-2' : ''}`}><div className={`rounded-md border border-sidebar-border bg-sidebar-accent/40 p-3 ${collapsed ? 'md:hidden' : ''}`}><div className="flex items-center gap-2 text-[11px] font-semibold"><span className="size-1.5 rounded-full bg-sidebar-primary" /> {activeClient?.name ?? 'Client workspace'}</div><div className="mt-2 flex items-center justify-between font-mono text-[10px] text-sidebar-foreground/55"><span>{activeClient ? `${activeClient.basis} / ${activeClient.functionalCurrency}` : '—'}</span><span>{activeClient?.period ?? '—'}</span></div></div></div>
    </aside>
      <div className={`min-h-[100dvh] transition-[padding] duration-300 ${collapsed ? 'md:pl-[76px]' : 'md:pl-[248px]'}`}><header className="sticky top-0 z-30 flex h-[78px] items-center justify-between border-b border-border/80 bg-background/90 px-4 backdrop-blur-md md:px-8"><div className="flex items-center gap-3"><button data-testid="button-mobile-menu" aria-label="Open navigation" className="rounded-md p-2 hover:bg-muted md:hidden" onClick={() => setMobileOpen(true)}><Menu size={19} /></button><button data-testid="button-collapse-sidebar" aria-label="Toggle sidebar" className="hidden rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground md:block" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button><div className="hidden h-5 w-px bg-border md:block" /><div><div className="font-mono text-[9px] uppercase tracking-[.18em] text-muted-foreground">{activeClient?.name ?? 'Client'} / IFRS close</div><div className="mt-0.5 text-[13px] font-semibold">{current}</div></div></div><div className="flex items-center gap-2 md:gap-3"><select data-testid="select-client-workspace" value={activeClient?.id ?? ''} onChange={(event) => setActiveClientId(Number(event.target.value))} className="hidden h-9 max-w-[180px] rounded-md border border-input bg-card px-2 text-xs font-semibold md:block">{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select><button data-testid="button-add-client" onClick={() => setCreateClientOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"><Plus size={14} /><span className="hidden sm:inline">Add client</span></button><div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground lg:flex"><span className="size-1.5 rounded-full bg-primary" /> Books are in balance</div><button data-testid="button-help" onClick={() => setHelpOpen(true)} aria-label="Open help" className="grid size-8 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"><CircleHelp size={16} /></button><div ref={accountMenuRef} className="relative"><button data-testid="button-account-menu" type="button" onClick={() => setAccountMenuOpen((open) => !open)} aria-haspopup="menu" aria-expanded={accountMenuOpen} aria-label={`Open account menu for ${displayName}`} className="group flex items-center gap-2 rounded-full border border-border bg-card pl-1 pr-2.5 py-1 text-left hover:border-primary/40"><span className="grid size-7 place-items-center rounded-full bg-primary font-mono text-[10px] font-medium text-primary-foreground">{initials}</span><span className="hidden max-w-[120px] truncate text-[11px] font-semibold sm:inline">{displayName}</span><ChevronDown size={13} className={`text-muted-foreground transition-transform ${accountMenuOpen ? 'rotate-180' : ''}`} /></button>{accountMenuOpen && <div role="menu" aria-label="Account menu" className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-56 rounded-lg border border-border bg-card p-1.5 shadow-xl"><div className="border-b border-border px-3 py-2.5"><div className="truncate text-xs font-semibold">{displayName}</div><div className="mt-0.5 truncate text-[10px] text-muted-foreground">{user.primaryEmailAddress?.emailAddress ?? 'Account owner'}</div></div><Link data-testid="link-firm-settings-account-menu" href="/firm-settings" role="menuitem" onClick={() => setAccountMenuOpen(false)} className="mt-1 flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted"><Users size={14} className="text-primary" /> Firm settings</Link><button data-testid="button-logout" type="button" role="menuitem" onClick={onLogout} className="mt-0.5 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"><LogOut size={14} /> Sign out</button></div>}</div></div></header><main className="mx-auto max-w-[1500px] px-4 py-7 md:px-8 lg:px-10"><div className="page-enter">{children}</div></main>{createClientOpen && <AddClientDialog onClose={() => setCreateClientOpen(false)} />}{settingsOpen && activeClient && <WorkspaceSettingsDialog client={activeClient} onClose={() => setSettingsOpen(false)} />}{helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}</div>
     {settingsOpen && <div className="fixed inset-0 z-[60] overflow-y-auto bg-foreground/35 p-4 backdrop-blur-sm"><div className="mx-auto my-5 w-full max-w-3xl rounded-lg border border-card-border bg-card p-6 shadow-2xl"><div className="flex justify-end"><button data-testid="button-close-team-settings" onClick={() => setSettingsOpen(false)} className="text-xs text-muted-foreground">Close</button></div><TeamAccessSection /><WorkspaceUsageSection /></div></div>}
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

function ReportProfileControls() {
  const { activeClient } = useClientWorkspace();
  const basis = activeClient?.basis === 'IFRS for SMEs' ? 'IFRS for SMEs' : 'IFRS';
  const [selectedBasis, setSelectedBasis] = useState<'IFRS' | 'IFRS for SMEs'>(basis);
  const [selectedProfile, setSelectedProfile] = useState<'IAS 1' | 'IFRS 18' | 'IFRS for SMEs'>(basis === 'IFRS for SMEs' ? 'IFRS for SMEs' : 'IAS 1');
  const [periodYear, setPeriodYear] = useState(new Date().getFullYear());
  useEffect(() => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="input-report-period-end"]');
    const sync = () => setPeriodYear(Number(input?.value.slice(0, 4)) || new Date().getFullYear());
    input?.addEventListener('input', sync);
    sync();
    return () => input?.removeEventListener('input', sync);
  }, []);
  const ifrs18Eligible = selectedBasis === 'IFRS' && periodYear >= 2027;
  const changeBasis = (value: 'IFRS' | 'IFRS for SMEs') => { setSelectedBasis(value); const profile = value === 'IFRS for SMEs' ? 'IFRS for SMEs' : 'IAS 1'; setSelectedProfile(profile); window.dispatchEvent(new CustomEvent('ledgerflow:report-profile', { detail: { basis: value, profile } })); };
  return <div className="mb-5 rounded-lg border border-card-border bg-card p-4"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Presentation profile</div><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-[11px] font-semibold">Reporting basis<select data-testid="select-reporting-basis" value={selectedBasis} onChange={(event) => changeBasis(event.target.value as typeof selectedBasis)} className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary"><option value="IFRS" disabled={basis !== 'IFRS'}>Full IFRS</option><option value="IFRS for SMEs" disabled={basis !== 'IFRS for SMEs'}>IFRS for SMEs</option></select></label><label className="text-[11px] font-semibold">Format<select data-testid="select-presentation-profile" value={selectedProfile} onChange={(event) => { const profile = event.target.value as typeof selectedProfile; setSelectedProfile(profile); window.dispatchEvent(new CustomEvent('ledgerflow:report-profile', { detail: { basis: selectedBasis, profile } })); }} className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary"><option value="IAS 1">IAS 1</option>{ifrs18Eligible && <option value="IFRS 18">IFRS 18 (2027+)</option>}<option value="IFRS for SMEs" disabled={selectedBasis !== 'IFRS for SMEs'}>IFRS for SMEs</option></select></label></div><p className="mt-2 text-[10px] text-muted-foreground">Only the basis configured for this client is available. IFRS 18 is available for annual periods ending in 2027 or later.</p></div>;
}
function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <>{title === 'Financial statement pack' && <ReportProfileControls />}<div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="font-mono text-[10px] uppercase tracking-[.19em] text-primary">{eyebrow}</div><h1 className="mt-2 font-display text-[34px] leading-none tracking-tight text-foreground md:text-[42px]">{title}</h1><p className="mt-3 max-w-2xl text-[13px] leading-5 text-muted-foreground">{description}</p></div>{action}</div></>;
}
function Metric({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) {
  return <div className={`rounded-lg border p-5 ${accent ? 'border-primary/30 bg-primary text-primary-foreground' : 'border-card-border bg-card'} lift-hover`}><div className={`font-mono text-[10px] uppercase tracking-[.13em] ${accent ? 'text-primary-foreground/65' : 'text-muted-foreground'}`}>{label}</div><div className="mt-3 font-display text-[31px] leading-none">{value}</div><div className={`mt-3 text-[11px] ${accent ? 'text-primary-foreground/65' : 'text-muted-foreground'}`}>{note}</div></div>;
}

function Home() {
  const { activeClient, clients, setActiveClientId } = useClientWorkspace();
  const params = { clientId: activeClient?.id ?? 1 };
  const query = useGetLedgerOverview(params, { query: { queryKey: getGetLedgerOverviewQueryKey(params) } });
  const overview = query.data;
  const legacyDemoWorkspace = clients.find((client) => client.legacyDemo);
  const cleanWorkspace = clients.find((client) => !client.legacyDemo);
  if (legacyDemoWorkspace) {
    return <LegacyDemoWorkspaceHome
      activeClient={activeClient}
      legacyDemoWorkspace={legacyDemoWorkspace}
      cleanWorkspace={cleanWorkspace}
      onSelectWorkspace={setActiveClientId}
    />;
  }
  if (overview && overview.totalLines === 0) return <EmptyWorkspaceHome workspaceName={activeClient?.name ?? "Your private workspace"} />;
  return <div><PageHeading eyebrow="Monday, June 24 · Close control" title="Good morning, Alex." description="A clear view of what moved, what needs your judgment, and what is ready to stand behind." action={<Link href="/statement-lines" data-testid="link-review-lines" className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5">Review open lines <ArrowRight size={14} /></Link>} /><QueryState loading={query.isLoading} error={query.isError} empty={!overview} onRetry={() => query.refetch()}>{overview && <div className="space-y-6"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Close progress" value={`${overview.completionPercent}%`} note={`${overview.pendingReview} items still need review`} accent /><Metric label="Statement lines" value={overview.totalLines.toLocaleString()} note={`${overview.currencies.length} currencies in scope`} /><Metric label="Posted amount" value={money(overview.postedAmount)} note={`Through ${overview.period}`} /><Metric label="Currencies" value={overview.currencies.join(' · ')} note="Active bank feeds" /></div><div className="grid gap-6 xl:grid-cols-[1.35fr_.65fr]"><section className="rounded-lg border border-card-border bg-card p-5 md:p-6"><div className="flex items-start justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Close control / {overview.period}</div><h2 className="mt-2 text-base font-semibold">The desk at a glance</h2></div><span className="rounded-full bg-secondary px-2.5 py-1 font-mono text-[10px] text-primary">Active</span></div><div className="mt-6 flex items-end gap-5"><div className="relative size-[148px] shrink-0 rounded-full" style={{ background: `conic-gradient(hsl(var(--accent)) ${overview.completionPercent}%, hsl(var(--muted)) 0)` }}><div className="absolute inset-[10px] grid place-items-center rounded-full bg-card"><span className="font-display text-[34px]">{overview.completionPercent}<small className="text-lg">%</small></span></div></div><div className="pb-2"><p className="text-sm font-medium leading-6">Your review queue is moving well.</p><p className="mt-1 text-xs leading-5 text-muted-foreground">LedgerFlow has surfaced the evidence beside each suggestion so the final call stays yours.</p><Link href="/journal-entries" data-testid="link-view-suggestions" className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">Inspect AI suggestions <ChevronRight size={13} /></Link></div></div><div className="mt-7 grid grid-cols-3 border-t border-border pt-4"><div><div className="font-mono text-lg">{overview.pendingReview}</div><div className="mt-1 text-[10px] text-muted-foreground">Need judgment</div></div><div><div className="font-mono text-lg">{overview.totalLines - overview.pendingReview}</div><div className="mt-1 text-[10px] text-muted-foreground">Cleared lines</div></div><div><div className="font-mono text-lg">{overview.currencies.length}</div><div className="mt-1 text-[10px] text-muted-foreground">Currencies</div></div></div></section><section className="rounded-lg border border-accent/25 bg-accent/10 p-5 md:p-6"><div className="flex items-center gap-2 text-accent-foreground"><Sparkles size={16} /><span className="font-mono text-[10px] uppercase tracking-[.15em]">LedgerFlow note</span></div><h2 className="mt-5 font-display text-[27px] leading-[1.02]">A second pair of eyes, not another black box.</h2><p className="mt-4 text-[12px] leading-5 text-accent-foreground/70">Every suggestion is anchored to a bank line, a confidence score, and the accounts it touches. Approve only what you can explain.</p><div className="mt-8 flex items-center gap-2 border-t border-accent/20 pt-4 text-[11px] font-semibold text-accent-foreground"><CircleCheck size={15} /> Evidence attached to every decision</div></section></div><section className="rounded-lg border border-card-border bg-card p-5 md:p-6"><div className="flex items-center justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Next actions</div><h2 className="mt-2 text-base font-semibold">Keep the close moving</h2></div><span className="font-mono text-[10px] text-muted-foreground">3 lanes</span></div><div className="mt-5 grid gap-3 md:grid-cols-3"><ActionCard index="01" title="Review statement lines" detail={`${overview.pendingReview} lines are waiting for a call`} href="/statement-lines" icon={Table2} /><ActionCard index="02" title="Approve journal entries" detail="Confirm the postings LedgerFlow prepared" href="/journal-entries" icon={BookOpenCheck} /><ActionCard index="03" title="Check the trial balance" detail="Make sure debits and credits agree" href="/trial-balance" icon={BarChart3} /></div></section></div>}</QueryState></div>;
}
function LegacyDemoWorkspaceHome({ activeClient, legacyDemoWorkspace, cleanWorkspace, onSelectWorkspace }: { activeClient: Client | undefined; legacyDemoWorkspace: Client; cleanWorkspace: Client | undefined; onSelectWorkspace: (id: number) => void }) {
  const viewingLegacyWorkspace = activeClient?.id === legacyDemoWorkspace.id;
  return <div data-testid="legacy-demo-workspace-notice"><PageHeading eyebrow="Workspace restored" title={viewingLegacyWorkspace ? "You are viewing preserved demo data." : "Your clean workspace is ready."} description={viewingLegacyWorkspace ? "This older workspace is retained exactly as it was so no bookkeeping evidence is lost. It is not your active bookkeeping workspace." : "We found an untouched legacy demo workspace from an earlier LedgerFlow setup and created this private, empty workspace for your real books."} action={viewingLegacyWorkspace && cleanWorkspace ? <button data-testid="button-return-to-clean-workspace" onClick={() => onSelectWorkspace(cleanWorkspace.id)} className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground">Return to clean workspace <ArrowRight size={14} /></button> : <Link href="/import-statement" data-testid="link-import-clean-workspace" className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground">Import a statement <UploadCloud size={14} /></Link>} /><section className="rounded-lg border border-accent/25 bg-accent/10 p-6 md:p-8"><div className="flex items-start gap-3"><CircleAlert className="mt-0.5 shrink-0 text-accent-foreground" size={20} /><div><h2 className="text-base font-semibold text-accent-foreground">Your previous demo workspace is preserved.</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-accent-foreground/75">No statement lines, journals, uploads, or audit evidence were deleted. {viewingLegacyWorkspace ? "Use the workspace selector to return to your private workspace when you are ready to work with real data." : "You can inspect the preserved workspace at any time; select it below only if you need to review the old demo records."}</p></div></div><div className="mt-6 flex flex-wrap gap-3">{!viewingLegacyWorkspace && <button data-testid="button-view-preserved-demo-workspace" onClick={() => onSelectWorkspace(legacyDemoWorkspace.id)} className="rounded-md border border-accent/30 bg-card px-3 py-2 text-xs font-semibold text-accent-foreground hover:bg-accent/10">View preserved demo workspace</button>}<Link href="/import-statement" className="rounded-md border border-accent/30 bg-card px-3 py-2 text-xs font-semibold text-accent-foreground hover:bg-accent/10">Import real evidence</Link></div></section></div>;
}
function EmptyWorkspaceHome({ workspaceName }: { workspaceName: string }) {
  return <div data-testid="empty-workspace-onboarding"><PageHeading eyebrow="Private workspace" title="Start with your real bookkeeping." description={`${workspaceName} is ready for your first statement. No demo transactions or journal entries have been created.`} action={<Link href="/import-statement" data-testid="link-import-first-statement" className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground">Import a statement <UploadCloud size={14} /></Link>} /><section className="rounded-lg border border-card-border bg-card p-6"><div className="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary"><Landmark size={21} /></div><h2 className="mt-5 font-display text-[29px] leading-none">Your workspace is empty by design.</h2><p className="mt-3 max-w-2xl text-[13px] leading-6 text-muted-foreground">Import a PDF, CSV, XLS, or XLSX bank statement to begin review. LedgerFlow prepares suggestions, while you retain control over every approval and posting.</p></section></div>;
}
function ActionCard({ index, title, detail, href, icon: Icon }: { index: string; title: string; detail: string; href: string; icon: typeof Table2 }) {
  return <Link href={href} data-testid={`link-action-${index}`} className="group flex items-start gap-3 rounded-md border border-border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-secondary/40"><div className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-primary"><Icon size={16} /></div><div className="min-w-0"><div className="flex items-center gap-2"><span className="font-mono text-[9px] text-muted-foreground">{index}</span><h3 className="text-[12px] font-semibold">{title}</h3></div><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{detail}</p></div><ArrowRight className="ml-auto mt-1 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" size={14} /></Link>;
}

function ImportStatementPage() {
  const { activeClient } = useClientWorkspace();
  const importMutation = useImportStatement();
  const { uploadFile, isUploading } = useUpload();
  const [file, setFile] = useState<File | null>(null);
  const [currency, setCurrency] = useState('AED');
  const [state, setState] = useState<'idle' | 'reading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [importResult, setImportResult] = useState<StatementImportResult | null>(null);
  const submit = async () => {
    if (!file) return;
    if (file.size > MAX_IMPORT_FILE_SIZE) {
      setState('error');
      setMessage('Statement file is too large. Please choose a file no larger than 50 MB.');
      setImportResult(null);
      return;
    }
    setState('reading');
    setMessage('');
    setImportResult(null);
    try {
      if (!activeClient) throw new Error('Select a client workspace before importing a statement.');
      const uploaded = await uploadFile(file, { clientId: activeClient.id });
      if (!uploaded) throw new Error('The private statement upload did not complete. Please try again.');
      const data = await importMutation.mutateAsync({
        data: {
          clientId: activeClient.id,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          objectPath: uploaded.objectPath,
          currency,
        },
      });
      setState('done');
      setImportResult(data);
      setMessage(data.message ?? `${data.importedCount ?? 0} statement lines are ready for review.`);
      queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey({ clientId: activeClient.id }) });
      queryClient.invalidateQueries({ queryKey: getGetLedgerOverviewQueryKey({ clientId: activeClient.id }) });
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Import failed');
    }
  };
  return <div><PageHeading eyebrow="Client intake / source document" title="Import a bank statement" description={`Choose a PDF, CSV, or Excel statement for ${activeClient?.name ?? 'this client'}. LedgerFlow extracts the transactions with AI and sends every line to review before it can affect the books.`} /><div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]"><section className="rounded-lg border border-card-border bg-card p-6"><div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary"><UploadCloud size={21} /></div><h2 className="mt-5 text-lg font-semibold">Statement file</h2><p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">Accepted formats: PDF, CSV, XLS, and XLSX. Keep the original bank export intact—LedgerFlow will normalize date, description, amount, direction, and currency.</p><label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-primary/35 bg-secondary/30 px-6 py-10 text-center transition-colors hover:bg-secondary/60"><UploadCloud className="text-primary" size={24} /><span className="mt-3 text-sm font-semibold">{file ? file.name : 'Choose a bank statement'}</span><span className="mt-1 text-[11px] text-muted-foreground">{file ? `${Math.round(file.size / 1024).toLocaleString()} KB ready to parse` : 'PDF, CSV, XLS, or XLSX · one statement at a time'}</span><input data-testid="input-statement-file" type="file" accept=".pdf,.csv,.xls,.xlsx,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setState('idle'); setMessage(''); setImportResult(null); }} /></label><div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end"><label className="block text-xs font-medium">Default statement currency<select value={currency} onChange={(event) => setCurrency(event.target.value)} className="mt-1.5 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option>AED</option><option>USD</option><option>EUR</option><option>GBP</option></select></label><button data-testid="button-parse-statement" onClick={submit} disabled={!file || state === 'reading' || isUploading || importMutation.isPending} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">{state === 'reading' ? isUploading ? 'Uploading statement…' : 'Extracting statement lines…' : <><Sparkles size={14} /> Extract with AI</>}</button></div>{message && <div data-testid="import-statement-result" className={`mt-5 rounded-md border px-4 py-3 text-xs ${state === 'done' ? importResult?.duplicateCount ? 'border-accent/25 bg-accent/10 text-accent-foreground' : 'border-primary/25 bg-primary/5 text-primary' : 'border-destructive/25 bg-destructive/5 text-destructive'}`}>{message}{state === 'done' && importResult?.importedCount ? <Link href="/statement-lines" className="ml-2 font-semibold underline">Review imported lines</Link> : null}</div>}{importResult && importResult.duplicateCount > 0 && <section data-testid="import-duplicate-summary" className="mt-4 rounded-md border border-accent/25 bg-accent/5 p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-semibold">Duplicate review result</div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{importResult.importStatus === 'duplicate_file' ? 'The identical source file was previously imported for this client, so it was not queued again.' : 'Exact duplicate transaction keys were skipped. Existing review items remain unchanged.'}</p></div><span className="rounded-full bg-accent/15 px-2 py-1 font-mono text-[10px] text-accent-foreground">{importResult.duplicateCount} skipped</span></div>{importResult.duplicateLines.length > 0 && <ul className="mt-3 divide-y divide-accent/15 rounded border border-accent/15 bg-card">{importResult.duplicateLines.map((line, index) => <li key={`${line.date}-${line.description}-${index}`} className="px-3 py-2.5 text-[11px]"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{line.description}</span><span className="font-mono">{shortDate(line.date)} · {money(line.amount, line.currency)}</span></div><div className="mt-1 text-muted-foreground">{line.reason === 'already_imported' ? `Already in this client's review queue${line.existingLineId ? ` (line #${line.existingLineId})` : ''}.` : 'Repeated within this uploaded statement.'}</div></li>)}</ul>}</section>}</section><aside className="rounded-lg border border-accent/25 bg-accent/10 p-6"><div className="font-mono text-[10px] uppercase tracking-[.16em] text-accent-foreground">Review safeguard</div><h2 className="mt-3 font-display text-[28px] leading-[1.05]">AI recreates the lines. You decide what posts.</h2><div className="mt-6 space-y-4 text-xs leading-5 text-accent-foreground/75"><p><strong className="text-accent-foreground">1. Extract</strong><br />The system reads the source statement and proposes normalized bank movements.</p><p><strong className="text-accent-foreground">2. Verify</strong><br />Imported lines enter the review queue with the original file name retained as evidence.</p><p><strong className="text-accent-foreground">3. Post</strong><br />Only approved journal entries can move into the trial balance and financial statements.</p></div></aside></div></div>;
}

function AddLineDialog({ onClose }: { onClose: () => void }) {
  const { activeClient } = useClientWorkspace();
  const mutation = useCreateStatementLine();
  const [form, setForm] = useState<StatementLineInput>({ date: '2026-08-24', description: '', currency: 'AED', amount: 0, direction: 'outflow' });
  const set = (key: keyof StatementLineInput, value: string) => setForm((old) => ({ ...old, [key]: key === 'amount' ? Number(value) : value }));
  const submit = (event: React.FormEvent) => { event.preventDefault(); mutation.mutate({ data: { ...form, clientId: activeClient?.id ?? 1 } }, { onSuccess: onClose }); };
  return <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-lg border border-card-border bg-card p-6 shadow-2xl" role="dialog" aria-modal="true"><div className="flex items-start justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Manual adjustment / {activeClient?.name ?? 'client'}</div><h2 className="mt-2 text-lg font-semibold">Add statement line</h2></div><button data-testid="button-close-add-line" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X size={17} /></button></div><form onSubmit={submit} className="mt-6 space-y-4"><label className="block text-xs font-medium">Date<input data-testid="input-line-date" required type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Description<input data-testid="input-line-description" required value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. Cloud hosting invoice" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><div className="grid grid-cols-2 gap-3"><label className="block text-xs font-medium">Amount<input data-testid="input-line-amount" required min="0" step=".01" type="number" value={form.amount || ''} onChange={(e) => set('amount', e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Currency<select data-testid="select-line-currency" value={form.currency} onChange={(e) => set('currency', e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option>AED</option><option>USD</option><option>EUR</option><option>GBP</option><option>CAD</option></select></label></div><label className="block text-xs font-medium">Direction<select data-testid="select-line-direction" value={form.direction} onChange={(e) => set('direction', e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option value="outflow">Outflow / money out</option><option value="inflow">Inflow / money in</option></select></label>{mutation.isError && <p className="text-xs text-destructive">This line could not be added. Try again.</p>}<button data-testid="button-submit-line" disabled={mutation.isPending} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-50">{mutation.isPending ? 'Saving line…' : <><Plus size={14} /> Add to review queue</>}</button></form></div></div>;
}

type BulkStatementAction = {
  type: 'bulk_approve_entries' | 'bulk_post_entries' | 'recode_lines';
  lineIds: number[];
  entryIds: number[];
};
function StatementLinesPage() {
  const { activeClient } = useClientWorkspace();
  const [currency, setCurrency] = useState('all'); const [status, setStatus] = useState('all'); const [search, setSearch] = useState(''); const [addOpen, setAddOpen] = useState(false);
  const [expandedLineId, setExpandedLineId] = useState<number | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<number[]>([]);
  const [bulkAction, setBulkAction] = useState<BulkStatementAction | null>(null);
  const [bulkError, setBulkError] = useState<unknown>(null);
  const bulkActionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const params = useMemo(() => ({ clientId: activeClient?.id ?? 1, ...(currency !== 'all' ? { currency } : {}), ...(status !== 'all' ? { status } : {}) }), [activeClient?.id, currency, status]);
  const query = useGetStatementLines(params, { query: { queryKey: getGetStatementLinesQueryKey(params) } });
  const journalParams = { clientId: activeClient?.id ?? 1 };
  const journalQuery = useGetJournalEntries(journalParams, { query: { queryKey: getGetJournalEntriesQueryKey(journalParams) } });
  const bankAccountsQuery = useGetBankAccounts(journalParams);
  const approve = useApproveJournalEntry();
  const post = usePostJournalEntry();
  const confirmClassification = useConfirmAICopilotAction();
  const bulkMutation = useConfirmAICopilotAction();
  const entriesByLine = useMemo(() => new Map((journalQuery.data ?? []).map((entry) => [entry.statementLineId, entry])), [journalQuery.data]);
  const bankAccountsById = useMemo(() => new Map((bankAccountsQuery.data ?? []).map((account) => [account.id, account])), [bankAccountsQuery.data]);
  const rows = useMemo(() => (query.data ?? []).filter((line) => `${line.description} ${line.accountSuggestion ?? ''}`.toLowerCase().includes(search.toLowerCase())), [query.data, search]);
  const currencies = [...new Set((query.data ?? []).map((line) => line.currency))];
  const selectedLines = useMemo(() => rows.filter((line) => selectedLineIds.includes(line.id)), [rows, selectedLineIds]);
  const selectedEntries = useMemo(() => selectedLines.map((line) => entriesByLine.get(line.id)), [selectedLines, entriesByLine]);
  const hasMissingEntries = selectedLines.some((_, index) => !selectedEntries[index]);
  const hasPostedSelection = selectedLines.some((line, index) => line.status.toLowerCase() === 'posted' || selectedEntries[index]?.status.toLowerCase() === 'posted');
  const allSuggested = selectedLines.length > 0 && !hasMissingEntries && !hasPostedSelection && selectedEntries.every((entry) => entry?.status.toLowerCase() === 'suggested');
  const allApproved = selectedLines.length > 0 && !hasMissingEntries && !hasPostedSelection && selectedEntries.every((entry) => entry?.status.toLowerCase() === 'approved');
  const allSelected = rows.length > 0 && rows.every((line) => selectedLineIds.includes(line.id));
  const selectionIssue = hasMissingEntries
    ? 'Some selected lines have no available journal entry. Remove them or refresh before continuing.'
    : hasPostedSelection
      ? 'Posted lines cannot be changed in bulk. Remove posted selections.'
      : selectedLines.length > 0 && !allSuggested && !allApproved
        ? 'Select only suggested entries for approval/recode, or only approved entries for posting.'
        : null;
  const refreshPostedData = () => {
    queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetJournalEntriesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetLedgerOverviewQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTrialBalanceQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetFinancialStatementsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetReportPacksQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBankAccountsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBulkTransitionAuditsQueryKey() });
  };
  useEffect(() => {
    setSelectedLineIds((current) => {
      const visibleIds = new Set(rows.map((line) => line.id));
      const next = current.filter((id) => visibleIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [rows, activeClient?.id]);
  const postEntry = (entry: JournalEntry) => post.mutate({ id: entry.id, data: { clientId: journalParams.clientId } }, { onSuccess: refreshPostedData });
  const approveEntry = (entry: JournalEntry) => approve.mutate({ id: entry.id, data: { clientId: journalParams.clientId } }, { onSuccess: refreshPostedData });
  const confirmClassificationForLine = (line: StatementLine, accountSuggestion: string) => confirmClassification.mutate({
    data: { clientId: journalParams.clientId, type: 'recode_lines', lineIds: [line.id], accountSuggestion, confidence: line.confidence ?? 0.85 },
  }, { onSuccess: refreshPostedData });
  const openBulkAction = (type: BulkStatementAction['type'], trigger: HTMLButtonElement) => {
    const eligible = type === 'bulk_post_entries' ? allApproved : allSuggested;
    if (!eligible) return;
    bulkActionTriggerRef.current = trigger;
    setBulkError(null);
    setBulkAction({ type, lineIds: selectedLines.map((line) => line.id), entryIds: selectedEntries.flatMap((entry) => entry ? [entry.id] : []) });
  };
  const cancelBulkAction = () => {
    if (bulkMutation.isPending) return;
    setBulkAction(null);
    setBulkError(null);
    bulkMutation.reset();
    requestAnimationFrame(() => bulkActionTriggerRef.current?.focus());
  };
  const confirmBulkAction = (accountSuggestion?: string) => {
    if (!bulkAction) return;
    bulkMutation.mutate({
      data: {
        clientId: journalParams.clientId,
        type: bulkAction.type,
        lineIds: bulkAction.type === 'recode_lines' ? bulkAction.lineIds : undefined,
        entryIds: bulkAction.type === 'recode_lines' ? undefined : bulkAction.entryIds,
        statementLineIds: bulkAction.type === 'recode_lines' ? undefined : bulkAction.lineIds,
        accountSuggestion,
        confidence: accountSuggestion ? 0.85 : undefined,
      },
    }, {
      onSuccess: () => {
        setSelectedLineIds((current) => current.filter((id) => !bulkAction.lineIds.includes(id)));
        setBulkAction(null);
        setBulkError(null);
        refreshPostedData();
      },
      onError: (error) => {
        setBulkError(error);
        refreshPostedData();
      },
    });
  };
  const toggleLineSelection = (lineId: number) => setSelectedLineIds((current) => current.includes(lineId) ? current.filter((id) => id !== lineId) : [...current, lineId]);
  const approveAndPost = approveEntry;
  return <div><PageHeading eyebrow="Evidence review / bank activity" title="Statement lines" description="Start with the source. Review each movement, inspect its linked journal entry, then post only the entries you stand behind." action={<button data-testid="button-add-line" onClick={() => setAddOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-sm hover:-translate-y-0.5 transition-transform"><Plus size={14} /> Add line</button>} /><div className="mb-4 flex flex-col gap-3 rounded-lg border border-card-border bg-card p-3 md:flex-row md:items-center"><div className="relative flex-1"><Search className="absolute left-3 top-2.5 text-muted-foreground" size={15} /><input data-testid="input-search-lines" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search descriptions or account suggestions" className="h-9 w-full rounded-md border-0 bg-background pl-9 pr-3 text-xs outline-none ring-1 ring-border focus:ring-primary" /></div><div className="flex items-center gap-2"><Filter size={14} className="text-muted-foreground" /><select data-testid="select-currency-filter" value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-xs"><option value="all">All currencies</option>{currencies.map((item) => <option key={item}>{item}</option>)}</select><select data-testid="select-status-filter" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-xs"><option value="all">All statuses</option><option value="pending">Pending</option><option value="needs_review">Review</option><option value="posted">Posted</option></select></div></div><QueryState loading={query.isLoading} error={query.isError} empty={!rows.length} onRetry={() => query.refetch()}><div className="overflow-hidden rounded-lg border border-card-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><span className="text-sm font-semibold">Review queue</span><span data-testid="text-visible-line-count" className="ml-2 rounded-full bg-secondary px-2 py-1 font-mono text-[10px] text-primary">{rows.length} lines</span></div><span className="font-mono text-[10px] text-muted-foreground">Click a line to inspect · use the action to approve or post</span></div>{selectedLines.length > 0 && <div data-testid="bulk-action-toolbar" className="border-b border-primary/20 bg-primary/5 px-5 py-3"><div className="flex flex-wrap items-center gap-2"><span data-testid="text-selected-line-count" className="mr-2 text-xs font-semibold">{selectedLines.length} selected</span><button data-testid="button-bulk-approve" onClick={(event) => openBulkAction('bulk_approve_entries', event.currentTarget)} disabled={!allSuggested || bulkMutation.isPending} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"><Check size={13} /> Approve selected</button><button data-testid="button-bulk-post" onClick={(event) => openBulkAction('bulk_post_entries', event.currentTarget)} disabled={!allApproved || bulkMutation.isPending} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"><Check size={13} /> Post selected</button><button data-testid="button-bulk-recode" onClick={(event) => openBulkAction('recode_lines', event.currentTarget)} disabled={!allSuggested || bulkMutation.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-background px-2.5 py-1.5 text-[11px] font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-40">Recode selected</button></div><p data-testid="text-bulk-selection-guidance" className={`mt-2 text-[10px] ${selectionIssue ? 'text-destructive' : 'text-muted-foreground'}`}>{selectionIssue ?? (allSuggested ? 'Suggested entries selected · approval and recode are available.' : 'Approved entries selected · posting is available.')}</p></div>}<div className="overflow-x-auto"><table className="w-full min-w-[1010px] text-left"><thead className="bg-muted/55 font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground"><tr><th className="w-12 px-4 py-3"><input data-testid="checkbox-select-all-lines" type="checkbox" aria-label={allSelected ? 'Clear all visible statement lines' : 'Select all visible statement lines'} checked={allSelected} onChange={() => setSelectedLineIds(allSelected ? [] : rows.map((line) => line.id))} className="size-4 accent-primary" /></th><th className="px-3 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Source description</th><th className="px-4 py-3 font-medium">Suggested account</th><th className="px-4 py-3 font-medium">Amount</th><th className="px-4 py-3 font-medium">Confidence</th><th className="px-4 py-3 font-medium">Status</th><th className="px-5 py-3 text-right font-medium">Action</th></tr></thead><tbody className="divide-y divide-border">{rows.map((line) => <InlineStatementRow key={line.id} line={line} bankAccountName={line.bankAccountId == null ? undefined : bankAccountsById.get(line.bankAccountId)?.name} entry={entriesByLine.get(line.id)} expanded={expandedLineId === line.id} selected={selectedLineIds.includes(line.id)} journalLoading={journalQuery.isLoading} processing={Boolean(approve.isPending && approve.variables?.id === entriesByLine.get(line.id)?.id || post.isPending && post.variables?.id === entriesByLine.get(line.id)?.id || confirmClassification.isPending && confirmClassification.variables?.data.lineIds?.includes(line.id) || bulkMutation.isPending && bulkAction?.lineIds.includes(line.id))} actionError={approve.isError || post.isError || confirmClassification.isError || bulkMutation.isError} onToggle={() => setExpandedLineId(expandedLineId === line.id ? null : line.id)} onToggleSelected={() => toggleLineSelection(line.id)} onApproveAndPost={approveAndPost} onPost={postEntry} onConfirmClassification={confirmClassificationForLine} />)}</tbody></table></div></div></QueryState>{addOpen && <AddLineDialog onClose={() => { setAddOpen(false); queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetJournalEntriesQueryKey() }); }} />}{bulkAction && <BulkStatementActionDialog action={bulkAction} lines={rows.filter((line) => bulkAction.lineIds.includes(line.id))} pending={bulkMutation.isPending} error={bulkError} onCancel={cancelBulkAction} onConfirm={confirmBulkAction} />}</div>;
}
function StatementRow({ line }: { line: StatementLine }) {
  const positive = line.direction.toLowerCase().includes('credit') || line.direction.toLowerCase().includes('in'); const confidence = line.confidence == null ? null : Math.round(line.confidence * 100);
  return <tr data-testid={`row-statement-line-${line.id}`} className="group transition-colors hover:bg-secondary/30"><td className="whitespace-nowrap px-5 py-4 font-mono text-[11px] text-muted-foreground">{shortDate(line.date)}</td><td className="max-w-[250px] px-4 py-4"><div className="truncate text-[12px] font-semibold">{line.description}</div><div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className="rounded bg-muted px-1.5 py-0.5">{line.source}</span><span>· {line.currency}</span></div></td><td className="px-4 py-4"><div className="text-[12px]">{line.accountSuggestion || 'Needs account call'}</div><div className="mt-1 text-[10px] text-muted-foreground">AI suggestion</div></td><td className={`whitespace-nowrap px-4 py-4 font-mono text-[12px] font-medium ${positive ? 'text-primary' : 'text-foreground'}`}>{positive ? '+' : '−'}{money(Math.abs(line.amount), line.currency)}</td><td className="px-4 py-4">{confidence == null ? <span className="text-[11px] text-muted-foreground">Unscored</span> : <div className="flex items-center gap-2"><div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${confidence > 85 ? 'bg-primary' : 'bg-accent'}`} style={{ width: `${confidence}%` }} /></div><span className="font-mono text-[10px]">{confidence}%</span></div>}</td><td className="px-4 py-4"><StatusPill status={line.status} /></td></tr>;
}

function InlineStatementRow({ line, bankAccountName, entry, expanded, selected, journalLoading, processing, actionError, onToggle, onToggleSelected, onApproveAndPost, onPost, onConfirmClassification }: { line: StatementLine; bankAccountName?: string; entry: JournalEntry | undefined; expanded: boolean; selected: boolean; journalLoading: boolean; processing: boolean; actionError: boolean; onToggle: () => void; onToggleSelected: () => void; onApproveAndPost: (entry: JournalEntry) => void; onPost: (entry: JournalEntry) => void; onConfirmClassification: (line: StatementLine, accountSuggestion: string) => void }) {
  const positive = line.direction.toLowerCase().includes('credit') || line.direction.toLowerCase().includes('in');
  const confidence = line.confidence == null ? null : Math.round(line.confidence * 100);
  const approved = entry?.status.toLowerCase() === 'approved';
  const posted = line.status.toLowerCase() === 'posted';
  const canConfirmClassification = !posted && entry?.status.toLowerCase() === 'suggested';
  const [selectedAccount, setSelectedAccount] = useState(line.accountSuggestion && classificationAccounts.includes(line.accountSuggestion) ? line.accountSuggestion : 'General expenses');
  const debitLine = entry?.lines.find((item) => item.debit > 0);
  const creditLine = entry?.lines.find((item) => item.credit > 0);
  const sourceAmount = debitLine?.debit ?? creditLine?.credit ?? line.amount;
  const functionalCurrency = entry?.functionalCurrency ?? line.functionalCurrency;
  const functionalAmount = entry?.functionalAmount ?? line.functionalAmount;
  const exchangeRate = entry?.exchangeRate ?? line.exchangeRate;
  const exchangeRateEffectiveDate = entry?.exchangeRateEffectiveDate ?? line.exchangeRateEffectiveDate;
  const exchangeRateStatus = entry?.exchangeRateStatus ?? line.exchangeRateStatus;
  const baseCurrency = functionalCurrency ?? entry?.currency ?? line.currency;
  const isForeignCurrency = Boolean(entry && functionalCurrency && entry.currency !== functionalCurrency);

  const toggleFromRow = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle();
    }
  };
  const rowAction = posted
    ? <div data-testid={`posted-line-${line.id}`} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary"><CircleCheck size={14} /> Posted</div>
    : !entry
      ? <span className="text-[11px] text-muted-foreground">{journalLoading ? 'Loading…' : 'Unavailable'}</span>
      : approved
        ? <button data-testid={`button-post-line-${line.id}`} onClick={(event) => { event.stopPropagation(); onPost(entry); }} disabled={processing} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">{processing ? 'Posting…' : <><Check size={13} /> Post</>}</button>
        : <button data-testid={`button-approve-line-${line.id}`} onClick={(event) => { event.stopPropagation(); onApproveAndPost(entry); }} disabled={processing} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">{processing ? 'Approving…' : <><Check size={13} /> Approve</>}</button>;

  return <>
    <tr data-testid={`row-statement-line-${line.id}`} tabIndex={0} aria-expanded={expanded} aria-selected={selected} onClick={onToggle} onKeyDown={toggleFromRow} className={`group cursor-pointer transition-colors hover:bg-secondary/30 focus:outline-none focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${expanded ? 'bg-secondary/20' : ''}`}>
      <td className="w-12 px-4 py-4" onClick={(event) => event.stopPropagation()}><input data-testid={`checkbox-select-line-${line.id}`} type="checkbox" aria-label={`Select statement line ${line.description}`} checked={selected} onChange={onToggleSelected} className="size-4 accent-primary" /></td>
      <td className="whitespace-nowrap px-3 py-4 font-mono text-[11px] text-muted-foreground">{shortDate(line.date)}</td>
      <td className="max-w-[250px] px-4 py-4"><div className="truncate text-[12px] font-semibold">{line.description}</div><div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className="rounded bg-muted px-1.5 py-0.5">{line.source}</span><span>· {line.currency}</span>{bankAccountName && <span className="truncate">· {bankAccountName}</span>}</div></td>
      <td className="px-4 py-4"><div className="text-[12px]">{line.accountSuggestion || 'Needs account call'}</div><div data-testid={(line as any).suggestionSource === 'workspace_learning' ? `workspace-learning-line-${line.id}` : undefined} className={`mt-1 text-[10px] ${(line as any).suggestionSource === 'workspace_learning' ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>{(line as any).suggestionSource === 'workspace_learning' ? `Workspace learned · ${(line as any).supportingPatternCount} confirmed pattern${(line as any).supportingPatternCount === 1 ? '' : 's'}` : 'AI suggestion'}</div></td>
      <td className={`whitespace-nowrap px-4 py-4 font-mono text-[12px] font-medium ${positive ? 'text-primary' : 'text-foreground'}`}>{positive ? '+' : '−'}{money(Math.abs(line.amount), line.currency)}</td>
      <td className="px-4 py-4">{confidence == null ? <span className="text-[11px] text-muted-foreground">Unscored</span> : <div className="flex items-center gap-2"><div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${confidence > 85 ? 'bg-primary' : 'bg-accent'}`} style={{ width: `${confidence}%` }} /></div><span className="font-mono text-[10px]">{confidence}%</span></div>}</td>
      <td className="px-4 py-4"><StatusPill status={line.status} /></td>
      <td className="px-5 py-4 text-right" onClick={(event) => event.stopPropagation()}>{rowAction}</td>
    </tr>
    {expanded && <tr data-testid={`detail-statement-line-${line.id}`}><td colSpan={8} className="bg-secondary/25 px-5 py-5">
      {journalLoading ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><RefreshCw size={14} className="animate-spin" /> Loading linked journal entry…</div> : !entry ? <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive"><CircleAlert size={15} /> No journal entry is linked to this statement line yet.</div> : <section className="rounded-lg border border-card-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div><div className="font-mono text-[10px] uppercase tracking-[.14em] text-primary">Linked journal entry · JE-{String(entry.id).padStart(4, '0')}</div><p className="mt-1 text-xs text-muted-foreground">{entry.memo}</p></div>
          <StatusPill status={entry.status} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-md bg-muted/45 p-3"><div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Debit account</div><div data-testid={`journal-debit-${line.id}`} className="mt-1 text-xs font-semibold">{debitLine?.account ?? '—'}</div></div>
          <div className="rounded-md bg-muted/45 p-3"><div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Credit account</div><div data-testid={`journal-credit-${line.id}`} className="mt-1 text-xs font-semibold">{creditLine?.account ?? '—'}</div></div>
           <div className="rounded-md bg-muted/45 p-3"><div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Amount</div><div data-testid={`journal-amount-${line.id}`} className="mt-1 font-mono text-xs font-semibold">{money(sourceAmount, entry.currency)}</div></div>
          <div className="rounded-md bg-muted/45 p-3"><div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Confidence</div><div data-testid={`journal-confidence-${line.id}`} className="mt-1 text-xs font-semibold">{Math.round(entry.confidence * 100)}%</div></div>
        </div>
         {isForeignCurrency && <div data-testid={`currency-conversion-${line.id}`} className={`mt-4 rounded-md border p-4 ${exchangeRateStatus === 'missing' || functionalAmount == null ? 'border-destructive/20 bg-destructive/5' : 'border-primary/20 bg-primary/5'}`}>
           <div className="flex flex-wrap items-start justify-between gap-2">
             <div><div className="font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground">Currency conversion</div><p className="mt-1 text-[11px] text-muted-foreground">Recorded in foreign currency, converted for reporting in the client base currency.</p></div>
             <span className={`rounded-full px-2 py-1 font-mono text-[9px] uppercase tracking-[.08em] ${exchangeRateStatus === 'exact' ? 'bg-primary/10 text-primary' : exchangeRateStatus === 'prior' ? 'bg-accent/15 text-accent-foreground' : 'bg-destructive/10 text-destructive'}`}>{exchangeRateStatus === 'exact' ? 'Exact-date rate' : exchangeRateStatus === 'prior' ? 'Prior rate' : 'Rate missing'}</span>
           </div>
           <div className="mt-3 grid gap-3 md:grid-cols-3">
             <div className="rounded-md bg-card p-3"><div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Foreign currency (FCY)</div><div data-testid={`conversion-source-${line.id}`} className="mt-1 font-mono text-sm font-semibold">{money(sourceAmount, entry.currency)}</div></div>
             <div className="rounded-md bg-card p-3"><div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Exchange rate</div><div data-testid={`conversion-rate-${line.id}`} className="mt-1 font-mono text-xs font-semibold">{exchangeRate == null ? 'Unavailable' : `1 ${entry.currency} = ${exchangeRate.toFixed(6)} ${functionalCurrency}`}</div><div className="mt-1 text-[10px] text-muted-foreground">{exchangeRateEffectiveDate ? `Effective ${shortDate(exchangeRateEffectiveDate)}` : 'Add a rate on or before the transaction date'}</div></div>
             <div className="rounded-md bg-card p-3"><div className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Base currency (BCY)</div><div data-testid={`conversion-base-${line.id}`} className="mt-1 font-mono text-sm font-semibold">{functionalAmount == null ? 'Unconverted' : money(functionalAmount, baseCurrency)}</div></div>
           </div>
           {exchangeRateStatus === 'prior' && exchangeRateEffectiveDate && <p className="mt-3 text-[10px] text-accent-foreground">No rate was recorded on the transaction date, so the latest rate available before {shortDate(entry.date)} was used.</p>}
           {exchangeRateStatus === 'missing' && <p className="mt-3 text-[10px] text-destructive">This transaction is not included in base-currency reporting until a dated exchange rate is added.</p>}
         </div>}
        {canConfirmClassification && <div className="mt-4 rounded-md border border-primary/20 bg-primary/5 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <label className="block text-[11px] font-semibold">Classification decision
              <select data-testid={`select-account-suggestion-${line.id}`} value={selectedAccount} onChange={(event) => setSelectedAccount(event.target.value)} className="mt-1.5 block h-9 min-w-[230px] rounded-md border border-input bg-background px-2 text-xs font-normal outline-none focus:border-primary">
                {classificationAccounts.map((account) => <option key={account} value={account}>{account}</option>)}
              </select>
            </label>
            <button data-testid={`button-confirm-classification-${line.id}`} onClick={() => onConfirmClassification(line, selectedAccount)} disabled={processing} className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-primary/30 bg-background px-3 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-50">
              <Check size={13} /> {(line as any).suggestionSource === 'workspace_learning' && selectedAccount === line.accountSuggestion ? 'Confirm learned account' : 'Confirm account'}
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">{(line as any).suggestionSource === 'workspace_learning' ? `This match is based on ${(line as any).supportingPatternCount} confirmed workspace pattern${(line as any).supportingPatternCount === 1 ? '' : 's'}—not another client's transaction details.` : 'Confirm this account or choose another one to improve future workspace suggestions.'}</p>
        </div>}
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">{posted ? 'This reviewed line is posted and included in ledger reporting.' : approved ? 'This entry is approved and ready to post. Use the Post action in the row above.' : 'Approval is required before this line can be posted. Use the Approve action in the row above.'}</p>
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

function ReportRows({ rows, currency, level = 0 }: { rows: ReportAmount[]; currency: string; level?: number }) {
  return <>{rows.map((row) => <div key={`${level}-${row.label}`} className={`report-row ${row.children?.length ? 'report-row-total' : ''}`}><div className="min-w-0"><span className={level ? 'pl-4 text-[11px]' : 'text-[12px] font-semibold'}>{row.label}</span>{row.noteRef !== '—' && <span className="ml-1.5 font-mono text-[9px] text-muted-foreground">({row.noteRef})</span>}</div><div className="text-right font-mono text-[10px]">{money(row.current, currency)}</div><div className="text-right font-mono text-[10px] text-muted-foreground">{money(row.comparative, currency)}</div>{row.children?.length ? <div className="col-span-3 border-l border-border/60 pl-3"><ReportRows rows={row.children} currency={currency} level={level + 1} /></div> : null}</div>)}</>;
}

function ReportStatement({ title, rows, currency }: { title: string; rows: ReportAmount[]; currency: string }) {
  return <section className="report-statement"><div className="text-center"><h3 className="font-display text-[26px] leading-none">{title}</h3><p className="mt-2 font-mono text-[9px] uppercase tracking-[.15em] text-muted-foreground">{currency} · Current year / comparative year</p></div><div className="mt-6 border-y border-foreground/20 py-2"><div className="report-row font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground"><span>Statement line</span><span className="text-right">Current</span><span className="text-right">Comparative</span></div></div><div><ReportRows rows={rows} currency={currency} /></div></section>;
}

function ReportNotesEditor({ notes, onChange }: { notes: ReportNote[]; onChange: (notes: ReportNote[]) => void }) {
  return <section className="rounded-lg border border-card-border bg-card p-5 md:p-6"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Disclosure inputs</div><h2 className="mt-2 font-display text-[29px]">Notes for accountant review</h2><p className="mt-2 text-[11px] leading-5 text-muted-foreground">LedgerFlow preserves generated tables. Supply or confirm the narrative where bank activity cannot safely establish an IFRS disclosure.</p><div className="mt-5 space-y-4">{notes.map((note, index) => <article key={note.number} className="rounded-md border border-border bg-background p-4"><div className="flex items-start justify-between gap-4"><div><div className="font-mono text-[10px] text-primary">NOTE {note.number}</div><h3 className="mt-1 text-[13px] font-semibold">{note.title}</h3></div><label className="flex shrink-0 items-center gap-2 text-[10px] font-semibold text-muted-foreground"><input type="checkbox" checked={!note.requiresInput} onChange={(event) => onChange(notes.map((item, itemIndex) => itemIndex === index ? { ...item, requiresInput: !event.target.checked } : item))} /> Confirmed</label></div><textarea value={note.narrative} onChange={(event) => onChange(notes.map((item, itemIndex) => itemIndex === index ? { ...item, narrative: event.target.value } : item))} className="mt-3 min-h-20 w-full rounded-md border border-input bg-card p-3 text-[11px] leading-5 outline-none focus:border-primary" aria-label={`Note ${note.number} narrative`} />{note.tables.length > 0 && <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[440px] text-left text-[10px]"><thead className="font-mono uppercase tracking-[.1em] text-muted-foreground"><tr><th className="pb-2 font-medium">Generated table</th><th className="pb-2 text-right font-medium">Current</th><th className="pb-2 text-right font-medium">Comparative</th></tr></thead><tbody>{note.tables.map((row) => <tr key={row.label} className="border-t border-border/70"><td className="py-2">{row.label}</td><td className="py-2 text-right font-mono">{money(row.current)}</td><td className="py-2 text-right font-mono">{money(row.comparative)}</td></tr>)}</tbody></table></div>}</article>)}</div></section>;
}

function ChecklistEditor({ checklist, onChange }: { checklist: ReportChecklistItem[]; onChange: (items: ReportChecklistItem[]) => void }) {
  return <section className="rounded-lg border border-card-border bg-card p-5 md:p-6"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Applicability checklist</div><h2 className="mt-2 font-display text-[29px]">IFRS confirmation record</h2><p className="mt-2 text-[11px] leading-5 text-muted-foreground">An item must be marked satisfied, not applicable, or immaterial before finalization. “Applicable” means an accountant decision is still outstanding.</p><div className="mt-5 divide-y divide-border">{checklist.map((item, index) => <div key={item.standard} className="grid gap-3 py-4 md:grid-cols-[1fr_190px]"><div><div className="text-[12px] font-semibold">{item.standard} — {item.title}</div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{item.prompt}</p></div><select value={item.status} onChange={(event) => onChange(checklist.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, status: event.target.value as ReportChecklistItem['status'] } : candidate))} className="h-9 rounded-md border border-input bg-background px-2 text-[11px] outline-none focus:border-primary"><option value="requires_accountant_input">Requires accountant input</option><option value="applicable">Applicable — not yet confirmed</option><option value="satisfied">Satisfied</option><option value="immaterial">Immaterial</option><option value="not_applicable">Not applicable</option></select></div>)}</div></section>;
}

function SignatoryEditor({ signatory, onChange }: { signatory: ReportSignatory; onChange: (signatory: ReportSignatory) => void }) {
  const update = (field: keyof ReportSignatory, value: string) => onChange({ ...signatory, [field]: value || null } as ReportSignatory);
  return <section className="rounded-lg border border-card-border bg-card p-5 md:p-6"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Authorization</div><h2 className="mt-2 font-display text-[29px]">Human review and signatory area</h2><p className="mt-2 text-[11px] leading-5 text-muted-foreground">Finalization records the people who prepared, reviewed, and authorized this exact report snapshot. It is not an audit opinion.</p><div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-[11px] font-semibold">Prepared by<input value={signatory.preparedBy} onChange={(event) => update('preparedBy', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-xs font-normal outline-none focus:border-primary" /></label><label className="text-[11px] font-semibold">Reviewed by<input value={signatory.reviewedBy} onChange={(event) => update('reviewedBy', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-xs font-normal outline-none focus:border-primary" /></label><label className="text-[11px] font-semibold">Authorized by<input value={signatory.authorizedBy} onChange={(event) => update('authorizedBy', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-xs font-normal outline-none focus:border-primary" /></label><label className="text-[11px] font-semibold">Authorization date<input type="date" value={signatory.authorizationDate ?? ''} onChange={(event) => update('authorizationDate', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-xs font-normal outline-none focus:border-primary" /></label></div></section>;
}

function FinancialStatementsPage() {
  const { activeClient } = useClientWorkspace();
  const clientId = activeClient?.id ?? 1;
  const [periodEnd, setPeriodEnd] = useState(`${new Date().getFullYear()}-12-31`);
  const [reportingBasis, setReportingBasis] = useState<'IFRS' | 'IFRS for SMEs'>(activeClient?.basis === 'IFRS for SMEs' ? 'IFRS for SMEs' : 'IFRS');
  const [presentationProfile, setPresentationProfile] = useState<'IAS 1' | 'IFRS 18' | 'IFRS for SMEs'>(activeClient?.basis === 'IFRS for SMEs' ? 'IFRS for SMEs' : 'IAS 1');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [localPack, setLocalPack] = useState<ReportPack | null>(null);
  const [notes, setNotes] = useState<ReportNote[]>([]);
  const [checklist, setChecklist] = useState<ReportChecklistItem[]>([]);
  const [signatory, setSignatory] = useState<ReportSignatory>({ preparedBy: '', reviewedBy: '', authorizedBy: '', authorizationDate: null });
  const listParams = { clientId };
  const list = useGetReportPacks(listParams, { query: { queryKey: getGetReportPacksQueryKey(listParams) } });
  const detail = useGetReportPack(selectedId ?? 0, { query: { queryKey: getGetReportPackQueryKey(selectedId ?? 0), enabled: selectedId !== null } });
  const generate = useCreateReportPack();
  const update = useUpdateReportPack();
  const pack = localPack?.id === selectedId ? localPack : detail.data;
  useEffect(() => { if (!selectedId && list.data?.[0]) setSelectedId(list.data[0].id); }, [list.data, selectedId]);
  useEffect(() => { if (pack) { setNotes(pack.notes); setChecklist(pack.checklist); setSignatory(pack.signatory); } }, [pack?.id, pack?.updatedAt]);
  useEffect(() => { setSelectedId(null); setLocalPack(null); const basis = activeClient?.basis === 'IFRS for SMEs' ? 'IFRS for SMEs' : 'IFRS'; setReportingBasis(basis); setPresentationProfile(basis === 'IFRS for SMEs' ? 'IFRS for SMEs' : 'IAS 1'); }, [clientId, activeClient?.basis]);
  const annualPeriod = /^\d{4}-12-31$/.test(periodEnd);
  const ifrs18Eligible = annualPeriod && Number(periodEnd.slice(0, 4)) >= 2027 && reportingBasis === 'IFRS';
  useEffect(() => {
    const onProfileChange = (event: Event) => {
      const detail = (event as CustomEvent<{ basis: typeof reportingBasis; profile: typeof presentationProfile }>).detail;
      setReportingBasis(detail.basis);
      setPresentationProfile(detail.profile);
    };
    window.addEventListener('ledgerflow:report-profile', onProfileChange);
    return () => window.removeEventListener('ledgerflow:report-profile', onProfileChange);
  }, []);
  const handleGenerate = () => generate.mutate({ data: { clientId, periodEnd, reportingBasis, presentationProfile, presentationCurrency: activeClient?.functionalCurrency ?? 'AED', roundingPolicy: 'Nearest whole unit' } }, { onSuccess: (created) => { setLocalPack(created); setSelectedId(created.id); queryClient.invalidateQueries({ queryKey: getGetReportPacksQueryKey(listParams) }); } });
  const save = (action: 'update_inputs' | 'finalize') => { if (!pack) return; update.mutate({ id: pack.id, data: { clientId, action, notes, checklist, signatory } }, { onSuccess: (saved) => { setLocalPack(saved); queryClient.invalidateQueries({ queryKey: getGetReportPacksQueryKey(listParams) }); queryClient.invalidateQueries({ queryKey: getGetReportPackQueryKey(saved.id) }); } }); };
  const blocked = pack?.validation.status !== 'pass';
  const errorText = generate.error || update.error ? 'The report pack could not be saved. Review the visible requirements and try again.' : '';
  return <div><PageHeading eyebrow="Reporting / IFRS close" title="Financial statement pack" description="Generate a comparative, traceable report snapshot from posted ledger entries. LedgerFlow prepares accounting output for human review; it never provides an audit opinion, statutory filing, or tax return." action={<div className="flex flex-wrap items-end gap-2"><label className="text-[10px] font-semibold text-muted-foreground">Annual period end<input data-testid="input-report-period-end" type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} className="mt-1 block h-9 rounded-md border border-input bg-card px-2 text-xs text-foreground outline-none focus:border-primary" /></label><button data-testid="button-generate-report-pack" onClick={handleGenerate} disabled={generate.isPending} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">{generate.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}{generate.isPending ? 'Building snapshot…' : 'Generate report pack'}</button></div>} />{errorText && <div className="mb-5 rounded-md border border-destructive/25 bg-destructive/5 px-4 py-3 text-xs text-destructive">{errorText}</div>}<div className="mb-6 grid gap-3 md:grid-cols-[.8fr_1.2fr]"><section className="rounded-lg border border-card-border bg-card p-4"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Saved snapshots</div><div className="mt-3 space-y-2">{list.isLoading ? <div className="text-xs text-muted-foreground">Loading saved packs…</div> : list.data?.length ? list.data.map((item) => <button key={item.id} onClick={() => { setLocalPack(null); setSelectedId(item.id); }} className={`flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left ${selectedId === item.id ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-muted/50'}`}><div><div className="text-xs font-semibold">{item.periodEnd.slice(0, 10)} annual pack</div><div className="mt-1 font-mono text-[9px] text-muted-foreground">{item.status} · {item.validationErrorCount} blocking checks</div></div><ChevronRight size={14} className="text-muted-foreground" /></button>) : <div className="rounded-md border border-dashed border-border px-3 py-4 text-[11px] leading-5 text-muted-foreground">No report snapshot yet. Choose an annual period end and generate a review draft.</div>}</div></section><section className="rounded-lg border border-accent/25 bg-accent/10 p-4"><div className="flex gap-3"><CircleAlert className="mt-0.5 shrink-0 text-accent-foreground" size={17} /><div><div className="text-xs font-semibold text-accent-foreground">Finalization is deliberately gated</div><p className="mt-1 text-[11px] leading-5 text-accent-foreground/75">The pack includes posted entries only. Missing comparative evidence, FX coverage, reconciliations, disclosure inputs, checklist decisions, or signatories prevent the final PDF download.</p></div></div></section></div>{detail.isLoading && !localPack ? <LoadingRows /> : pack ? <div className="space-y-6"><section className={`rounded-lg border p-5 ${blocked ? 'border-destructive/30 bg-destructive/5' : 'border-primary/30 bg-primary/5'}`}><div className="flex flex-col justify-between gap-4 md:flex-row md:items-start"><div><div className="flex items-center gap-2 text-sm font-semibold">{blocked ? <CircleAlert className="text-destructive" size={17} /> : <CircleCheck className="text-primary" size={17} />}{blocked ? `${pack.validation.errorCount} finalization blocker${pack.validation.errorCount === 1 ? '' : 's'}` : 'All deterministic checks pass'}</div><p className="mt-2 text-[11px] leading-5 text-muted-foreground">Snapshot #{pack.id} · {pack.periodStart.slice(0, 10)} to {pack.periodEnd.slice(0, 10)} · comparative {pack.comparativePeriodStart.slice(0, 10)} to {pack.comparativePeriodEnd.slice(0, 10)}</p></div><div className="flex flex-wrap gap-2"><button data-testid="button-save-report-inputs" onClick={() => save('update_inputs')} disabled={update.isPending || pack.status === 'finalized'} className="rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50">Save review inputs</button>{pack.status === 'finalized' ? <a data-testid="link-download-report-pdf" href={`/api/ledgerflow/report-packs/${pack.id}/pdf`} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"><ArrowDownLeft size={14} /> Download final PDF</a> : <button data-testid="button-finalize-report-pack" onClick={() => save('finalize')} disabled={update.isPending} className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{update.isPending ? 'Checking finalization…' : 'Finalize & unlock PDF'}</button>}</div></div><div className="mt-4 grid gap-2 md:grid-cols-2">{pack.validation.checks.map((check) => <div key={check.id} className={`rounded-md border px-3 py-2 text-[11px] ${check.status === 'pass' ? 'border-primary/20 bg-card' : check.status === 'warning' ? 'border-accent/25 bg-accent/10' : 'border-destructive/25 bg-card'}`}><div className="flex items-center gap-2 font-semibold">{check.status === 'pass' ? <CircleCheck size={13} className="text-primary" /> : <CircleAlert size={13} className={check.status === 'error' ? 'text-destructive' : 'text-accent-foreground'} />}{check.label}</div><p className="mt-1 pl-5 text-muted-foreground">{check.detail}</p></div>)}</div></section><article className="report-sheet"><div className="report-cover"><div className="font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">LedgerFlow / generated accounting output</div><h2 className="mt-14 font-display text-5xl leading-none">{pack.snapshot.legalName}</h2><div className="mt-7 h-px w-20 bg-foreground/40" /><p className="mt-7 font-display text-3xl">Financial statements</p><p className="mt-3 text-[12px]">For the year ended {pack.snapshot.periodEnd.slice(0, 10)}</p><p className="mt-1 text-[11px] text-muted-foreground">Comparative period ended {pack.snapshot.comparativePeriodEnd.slice(0, 10)} · {pack.snapshot.presentationCurrency}</p><div className="mt-20 border-t border-foreground/20 pt-4 text-[10px] leading-5 text-muted-foreground">Prepared under {pack.snapshot.reportingBasis} using the {pack.snapshot.presentationProfile} presentation profile. This document is not an audit opinion, statutory filing, tax return, or assurance conclusion.</div></div><ReportStatement title="Statement of financial position" rows={pack.snapshot.statementOfFinancialPosition} currency={pack.snapshot.presentationCurrency} /><ReportStatement title="Statement of profit or loss and other comprehensive income" rows={pack.snapshot.profitOrLossAndOci} currency={pack.snapshot.presentationCurrency} /><ReportStatement title="Statement of changes in equity" rows={pack.snapshot.changesInEquity} currency={pack.snapshot.presentationCurrency} /><ReportStatement title="Statement of cash flows — indirect method" rows={pack.snapshot.cashFlows} currency={pack.snapshot.presentationCurrency} /><section className="report-statement"><h3 className="text-center font-display text-[26px]">Notes to the financial statements</h3><div className="mt-7 space-y-6">{pack.snapshot.notes.map((note) => <div key={note.number}><div className="font-semibold text-[12px]">Note {note.number} — {note.title}</div><p className="mt-2 whitespace-pre-line text-[11px] leading-5 text-muted-foreground">{note.narrative}</p>{note.tables.length ? <div className="mt-3 grid gap-x-4 gap-y-1 text-[10px]" style={{ gridTemplateColumns: '1fr auto auto' }}>{note.tables.map((row) => <><span key={`${note.number}-${row.label}`}>{row.label}</span><span className="text-right font-mono">{money(row.current, pack.snapshot.presentationCurrency)}</span><span className="text-right font-mono text-muted-foreground">{money(row.comparative, pack.snapshot.presentationCurrency)}</span></>)}</div> : null}</div>)}</div><div className="mt-10 border-t border-foreground/20 pt-4 text-[10px] leading-5 text-muted-foreground">Traceability: {pack.snapshot.traceability.postedEntryCount} posted journal entries · {pack.snapshot.traceability.postedLineCount} linked statement lines · {pack.snapshot.traceability.sourceImportCount} source imports in the client workspace.</div></section></article><div className="grid gap-6 xl:grid-cols-2"><ReportNotesEditor notes={notes} onChange={setNotes} /><ChecklistEditor checklist={checklist} onChange={setChecklist} /></div><SignatoryEditor signatory={signatory} onChange={setSignatory} /></div> : <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-14 text-center"><FileSpreadsheet className="mx-auto text-primary" size={24} /><h2 className="mt-4 text-sm font-semibold">Generate a controlled report snapshot</h2><p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted-foreground">Select a 31 December annual reporting period to derive statements, notes, comparative columns, controls, and ledger traceability from the client’s posted entries.</p></div>}</div>;
}
function Router() {
  return <Switch><Route path="/" component={Home} /><Route path="/user-portal" component={Home} /><Route path="/import-statement" component={ImportStatementPage} /><Route path="/statement-lines" component={StatementLinesPage} /><Route path="/journal-entries" component={JournalEntriesPage} /><Route path="/trial-balance" component={TrialBalancePage} /><Route path="/financial-statements" component={FinancialStatementsPage} /><Route path="/firm-settings" component={FirmSettingsPage} /><Route path="/client-settings" component={ClientSettingsPage} /><Route path="/workspace-settings" component={ClientSettingsPage} /><Route component={NotFound} /></Switch>;
}
function NotFound() {
  return <div className="grid min-h-[65vh] place-items-center text-center"><div><div className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">LedgerFlow / 404</div><h1 className="mt-3 font-display text-4xl">This page is not in the close.</h1><Link href="/" data-testid="link-back-overview" className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline">Return to overview <ArrowRight size={14} /></Link></div></div>;
}

function WorkspaceRecoveryState({ onRetry }: { onRetry: () => void }) {
  return <div className="grid min-h-[100dvh] place-items-center bg-background px-5"><div className="w-full max-w-md rounded-lg border border-destructive/25 bg-card p-6 text-center shadow-sm" role="alert"><div className="mx-auto grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive"><CircleAlert size={19} /></div><h1 className="mt-4 text-base font-semibold">We couldn’t load your workspaces</h1><p className="mt-2 text-xs leading-5 text-muted-foreground">LedgerFlow could not retrieve the client workspaces available to this account. Your bookkeeping data has not been opened.</p><button data-testid="button-retry-workspaces" onClick={onRetry} className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"><RefreshCw size={14} /> Try again</button></div></div>;
}

function WorkspaceOnboarding({ starterWorkspace, onComplete, onLogout }: { starterWorkspace?: Client; onComplete: (workspace: Client) => Promise<void> | void; onLogout: () => void }) {
  const create = useCreateClient();
  const update = useUpdateClient();
  const [form, setForm] = useState<ClientUpdateInput>(() => ({
    name: starterWorkspace?.name ?? '',
    legalName: starterWorkspace?.legalName === 'Legal entity to be configured' ? '' : starterWorkspace?.legalName ?? '',
    functionalCurrency: starterWorkspace?.functionalCurrency ?? 'AED',
    basis: starterWorkspace?.basis ?? 'IFRS',
    period: starterWorkspace?.period === 'August 2026' ? '' : starterWorkspace?.period ?? '',
  }));
  const [validationMessage, setValidationMessage] = useState('');
  const pending = create.isPending || update.isPending;
  const error = create.error || update.error;

  useEffect(() => {
    setForm({
      name: starterWorkspace?.name ?? '',
      legalName: starterWorkspace?.legalName === 'Legal entity to be configured' ? '' : starterWorkspace?.legalName ?? '',
      functionalCurrency: starterWorkspace?.functionalCurrency ?? 'AED',
      basis: starterWorkspace?.basis ?? 'IFRS',
      period: starterWorkspace?.period === 'August 2026' ? '' : starterWorkspace?.period ?? '',
    });
  }, [starterWorkspace?.id]);

  const set = (field: keyof ClientUpdateInput, value: string) => {
    setValidationMessage('');
    setForm((current) => ({ ...current, [field]: value }));
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const data = {
      ...form,
      name: form.name.trim(),
      legalName: form.legalName.trim(),
      period: form.period.trim(),
    };
    if (!data.name || !data.legalName || !data.period) {
      setValidationMessage('Add the client name, legal name, and close period to continue.');
      return;
    }
    setValidationMessage('');
    const onSuccess = (workspace: Client) => void onComplete(workspace);
    if (starterWorkspace) {
      update.mutate({ id: starterWorkspace.id, data }, { onSuccess });
    } else {
      create.mutate({ data }, { onSuccess });
    }
  };

  return <main className="grid min-h-[100dvh] place-items-center bg-background px-5 py-10" data-testid="workspace-onboarding"><div className="w-full max-w-2xl"><div className="mb-6 flex items-center justify-between"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm"><Landmark size={20} strokeWidth={2.2} /></div><div><div className="font-display text-[25px] leading-none tracking-tight">LedgerFlow</div><div className="mt-1 font-mono text-[9px] uppercase tracking-[.2em] text-muted-foreground">Private bookkeeping workspace</div></div></div><button data-testid="button-onboarding-logout" onClick={onLogout} className="rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted">Sign out</button></div><section className="rounded-lg border border-card-border bg-card p-6 shadow-md sm:p-9"><div className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">First-run setup</div><h1 className="mt-3 font-display text-[38px] leading-[.98] tracking-tight">Set up your private bookkeeping workspace.</h1><p className="mt-4 max-w-xl text-[13px] leading-6 text-muted-foreground">Before you open the close desk, tell LedgerFlow which client and reporting settings belong to this account. This creates a private workspace for your books—no demo transactions are added.</p><form onSubmit={submit} className="mt-8 grid gap-4 sm:grid-cols-2"><label className="block text-xs font-medium">Client name<input data-testid="input-onboarding-client-name" required minLength={1} value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="e.g. Northstar Advisory" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Legal name<input data-testid="input-onboarding-legal-name" required minLength={1} value={form.legalName} onChange={(event) => set('legalName', event.target.value)} placeholder="e.g. Northstar Advisory FZ-LLC" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Functional currency<select data-testid="select-onboarding-currency" value={form.functionalCurrency} onChange={(event) => set('functionalCurrency', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option value="AED">AED — UAE dirham</option><option value="USD">USD — US dollar</option><option value="EUR">EUR — euro</option><option value="GBP">GBP — pound sterling</option></select></label><label className="block text-xs font-medium">Reporting basis<select data-testid="select-onboarding-basis" value={form.basis} onChange={(event) => set('basis', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option value="IFRS">IFRS</option><option value="IFRS for SMEs">IFRS for SMEs</option></select></label><label className="block text-xs font-medium sm:col-span-2">Close period<input data-testid="input-onboarding-period" required minLength={1} value={form.period} onChange={(event) => set('period', event.target.value)} placeholder="e.g. August 2026" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label>{(validationMessage || error) && <div data-testid="onboarding-error" className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs leading-5 text-destructive"><CircleAlert className="mt-0.5 shrink-0" size={14} /><span>{validationMessage || 'Workspace setup could not be saved. Check the details and try again.'}</span></div>}<div className="flex flex-col-reverse gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between"><p className="text-[11px] leading-5 text-muted-foreground">You can change these settings later from Workspace settings.</p><button data-testid="button-submit-onboarding" disabled={pending} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50">{pending ? <><LoaderCircle size={14} className="animate-spin" /> Saving workspace…</> : <><Check size={14} /> Save and open close overview</>}</button></div></form></section></div></main>;
}

type CompanyOnboardingUser = {
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddress: { emailAddress: string } | null;
};

function CompanyOnboarding({ starterWorkspace, user, onComplete, onLogout }: { starterWorkspace?: Client; user: CompanyOnboardingUser; onComplete: (workspace: Client) => Promise<void> | void; onLogout: () => void }) {
  const create = useCreateClient();
  const update = useUpdateClient();
  const updateProfile = useUpdateLedgerflowAccountProfile();
  const [form, setForm] = useState<ClientUpdateInput>(() => ({
    name: starterWorkspace?.name ?? '',
    legalName: starterWorkspace?.legalName === 'Legal entity to be configured' ? '' : starterWorkspace?.legalName ?? '',
    functionalCurrency: starterWorkspace?.functionalCurrency ?? 'AED',
    basis: starterWorkspace?.basis ?? 'IFRS',
    period: starterWorkspace?.period === 'August 2026' ? '' : starterWorkspace?.period ?? '',
  }));
  const [validationMessage, setValidationMessage] = useState('');
  const [profile, setProfile] = useState({
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    workEmail: user.primaryEmailAddress?.emailAddress ?? '',
  });
  const pending = create.isPending || update.isPending || updateProfile.isPending;
  const error = create.error || update.error || updateProfile.error;

  useEffect(() => {
    setForm({
      name: starterWorkspace?.name ?? '',
      legalName: starterWorkspace?.legalName === 'Legal entity to be configured' ? '' : starterWorkspace?.legalName ?? '',
      functionalCurrency: starterWorkspace?.functionalCurrency ?? 'AED',
      basis: starterWorkspace?.basis ?? 'IFRS',
      period: starterWorkspace?.period === 'August 2026' ? '' : starterWorkspace?.period ?? '',
    });
  }, [starterWorkspace?.id]);

  const set = (field: keyof ClientUpdateInput, value: string) => {
    setValidationMessage('');
    setForm((current) => ({ ...current, [field]: value }));
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const data = { ...form, name: form.name.trim(), legalName: form.legalName.trim(), functionalCurrency: 'AED', basis: 'IFRS', period: 'August 2026' };
    const personal = {
      firstName: profile.firstName.trim(),
      lastName: profile.lastName.trim(),
      workEmail: profile.workEmail.trim(),
    };
    if (!personal.firstName || !personal.lastName || !personal.workEmail) {
      setValidationMessage('Add your full name and work email to continue.');
      return;
    }
    if (!data.name || !data.legalName) {
      setValidationMessage('Add your company name and legal name to continue.');
      return;
    }
    setValidationMessage('');
    try {
      await updateProfile.mutateAsync({
        data: { firstName: personal.firstName, lastName: personal.lastName },
      });
      const workspace = starterWorkspace
        ? await update.mutateAsync({ id: starterWorkspace.id, data })
        : await create.mutateAsync({ data });
      await onComplete(workspace);
    } catch {
      setValidationMessage('We couldn’t save your account details. Check your connection and try again.');
    }
  };

  return <main className="grid min-h-[100dvh] place-items-center bg-background px-5 py-10" data-testid="company-onboarding"><div className="w-full max-w-2xl"><div className="mb-6 flex items-center justify-between"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm"><Landmark size={20} strokeWidth={2.2} /></div><div><div className="font-display text-[25px] leading-none tracking-tight">LedgerFlow</div><div className="mt-1 font-mono text-[9px] uppercase tracking-[.2em] text-muted-foreground">Private bookkeeping workspace</div></div></div><button data-testid="button-onboarding-logout" onClick={onLogout} className="rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted">Sign out</button></div><section className="rounded-lg border border-card-border bg-card p-6 shadow-md sm:p-9"><div className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Personal details and company registration</div><h1 className="mt-3 font-display text-[38px] leading-[.98] tracking-tight">Set up your LedgerFlow account.</h1><p className="mt-4 max-w-xl text-[13px] leading-6 text-muted-foreground">First, confirm who you are and register your bookkeeping company. After you enter the workspace, you can add the clients you do bookkeeping for and set each client’s accounting details.</p><form onSubmit={submit} className="mt-8 grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><div className="text-xs font-semibold">Your details</div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">Your full name and work email identify the account owner. You can add more profile details later.</p></div><label className="block text-xs font-medium">First name<input data-testid="input-onboarding-first-name" required minLength={1} value={profile.firstName} onChange={(event) => setProfile({ ...profile, firstName: event.target.value })} placeholder="e.g. Aisha" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Last name<input data-testid="input-onboarding-last-name" required minLength={1} value={profile.lastName} onChange={(event) => setProfile({ ...profile, lastName: event.target.value })} placeholder="e.g. Rahman" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium sm:col-span-2">Work email<input data-testid="input-onboarding-work-email" type="email" readOnly required value={profile.workEmail} className="mt-1.5 h-10 w-full cursor-not-allowed rounded-md border border-input bg-muted px-3 text-sm outline-none" /><span className="mt-1 block text-[10px] font-normal leading-4 text-muted-foreground">This is the verified email on your LedgerFlow account.</span></label><div className="sm:col-span-2"><div className="text-xs font-semibold">Your company</div></div><label className="block text-xs font-medium">Company name<input data-testid="input-onboarding-company-name" required minLength={1} value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="e.g. Northstar Bookkeeping" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Legal company name<input data-testid="input-onboarding-legal-company-name" required minLength={1} value={form.legalName} onChange={(event) => set('legalName', event.target.value)} placeholder="e.g. Northstar Bookkeeping FZ-LLC" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label>{(validationMessage || error) && <div data-testid="onboarding-error" className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs leading-5 text-destructive sm:col-span-2"><CircleAlert className="mt-0.5 shrink-0" size={14} /><span>{validationMessage || 'Company setup could not be saved. Check the details and try again.'}</span></div>}<div className="flex flex-col-reverse gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between"><p className="text-[11px] leading-5 text-muted-foreground">Client currency, reporting basis, and close period are collected when you add each bookkeeping client.</p><button data-testid="button-submit-onboarding" disabled={pending} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50">{pending ? <><LoaderCircle size={14} className="animate-spin" /> Saving account…</> : <><Check size={14} /> Save and open workspace</>}</button></div></form></section></div></main>;
}

function LedgerFlowApp({ user, profileUser, onLogout }: { user: LedgerFlowUser; profileUser: CompanyOnboardingUser; onLogout: () => void }) {
  const clientsQuery = useGetClients({ query: { queryKey: getGetClientsQueryKey() } });
  const clients = clientsQuery.data ?? [];
  const workspaceLoadState = getWorkspaceLoadState(clientsQuery.isLoading, clientsQuery.isError, clientsQuery.data);
  const storageKey = getActiveWorkspaceStorageKey(user.externalId ?? user.id);
  const [activeClientId, setActiveClientId] = useState<number | null>(() => {
    const saved = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  });
  const [allowLegacyDemoSelection, setAllowLegacyDemoSelection] = useState(false);
  const [, setLocation] = useLocation();
  const selectedClient = selectWorkspaceForSession(clients, activeClientId, allowLegacyDemoSelection);
  useEffect(() => {
    if (!clients.length) return;
    if (selectedClient && activeClientId !== selectedClient.id) {
      setAllowLegacyDemoSelection(false);
      setActiveClientId(selectedClient.id);
    }
    if (selectedClient) window.localStorage.setItem(storageKey, String(selectedClient.id));
  }, [activeClientId, clients.length, selectedClient, storageKey]);
  const chooseClient = (id: number) => {
    const client = clients.find((candidate) => candidate.id === id);
    if (client) {
      setAllowLegacyDemoSelection(client.legacyDemo);
      setActiveClientId(client.id);
    }
  };
  if (workspaceLoadState === 'loading') return <AuthLoadingState label="Loading your workspaces" />;
  if (workspaceLoadState === 'failed') return <WorkspaceRecoveryState onRetry={() => clientsQuery.refetch()} />;
  const starterWorkspace = clients.find((client) => client.workspaceState === 'starter');
  if (workspaceLoadState === 'missing' || requiresWorkspaceOnboarding(clients)) {
    const completeOnboarding = async (workspace: Client) => {
      await queryClient.invalidateQueries({ queryKey: getGetClientsQueryKey() });
      setAllowLegacyDemoSelection(false);
      setActiveClientId(workspace.id);
      window.localStorage.setItem(storageKey, String(workspace.id));
      setLocation('/user-portal');
    };
    return <CompanyOnboarding starterWorkspace={starterWorkspace} user={profileUser} onComplete={completeOnboarding} onLogout={onLogout} />;
  }
  return <TooltipProvider><ClientContext.Provider value={{ activeClient: selectedClient, clients, setActiveClientId: chooseClient }}><ErrorBoundary><Shell user={user} onLogout={onLogout}><Router /></Shell></ErrorBoundary></ClientContext.Provider><Toaster /></TooltipProvider>;
}

function AuthBoundary() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [location] = useLocation();
  const inviteToken = new URLSearchParams(window.location.search).get("invite");
  const currentUserId = user ? user.externalId ?? user.id : null;
  const [cacheReadyForUserId, setCacheReadyForUserId] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (cacheReadyForUserId !== currentUserId) {
      clearUserScopedState(queryClient, cacheReadyForUserId, window.localStorage);
      setCacheReadyForUserId(currentUserId);
    }
  }, [cacheReadyForUserId, currentUserId]);

  if (!isLoaded) return <AuthLoadingState />;
  if (!isSignedIn || !user) return <AccessScreen />;
  if (cacheReadyForUserId !== currentUserId) return <AuthLoadingState label="Preparing your secure workspace" />;
  if (location === "/" && !inviteToken) return <Redirect to="/user-portal" />;

  const handleLogout = () => {
    clearUserScopedState(queryClient, currentUserId, window.localStorage);
    void signOut({ redirectUrl: basePath || "/" });
  };
  return <InviteAcceptanceGate><LedgerFlowApp key={currentUserId} user={user} profileUser={user} onLogout={handleLogout} /></InviteAcceptanceGate>;
}

function InviteAcceptanceGate({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const token = useMemo(() => new URLSearchParams(window.location.search).get("invite"), [location]);
  const accept = useAcceptWorkspaceInvitation();
  const [message, setMessage] = useState("");
  const clearToken = () => setLocation("/user-portal", { replace: true });
  useEffect(() => {
    if (!token) return;
    accept.mutate({ token }, {
      onSuccess: () => {
        clearToken();
        queryClient.invalidateQueries({ queryKey: getGetClientsQueryKey() });
      },
      onError: (error) => setMessage(error instanceof Error ? error.message : "This invitation could not be accepted."),
    });
  }, [token]);
  if (!token) return <>{children}</>;
  if (accept.isPending) return <AuthLoadingState label="Joining your invited workspace" />;
  if (!message) return <AuthLoadingState label="Joining your invited workspace" />;
  return <main className="grid min-h-[100dvh] place-items-center bg-background px-5"><div className="w-full max-w-md rounded-lg border border-destructive/25 bg-card p-6 text-center shadow-sm"><CircleAlert className="mx-auto text-destructive" size={20} /><h1 className="mt-3 text-base font-semibold">We couldn’t join that workspace</h1><p className="mt-2 text-xs leading-5 text-muted-foreground">{message}</p><div className="mt-5 flex justify-center gap-2"><button type="button" onClick={() => { setMessage(""); accept.reset(); accept.mutate({ token }, { onSuccess: () => { clearToken(); queryClient.invalidateQueries({ queryKey: getGetClientsQueryKey() }); }, onError: (error) => setMessage(error instanceof Error ? error.message : "This invitation could not be accepted.") }); }} className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Try again</button><button type="button" onClick={clearToken} className="rounded-md border border-border px-3 py-2 text-xs font-semibold">Continue without invite</button></div></div></main>;
}
function App() {
  return <WouterRouter base={basePath}><ClerkProviderWithRoutes /></WouterRouter>;
}
export default App;

function AuthRecoveryState({ onRetry }: { onRetry: () => void }) {
  return <div className="grid min-h-[100dvh] place-items-center bg-background px-5" data-testid="auth-recovery-state"><div className="w-full max-w-md rounded-lg border border-destructive/25 bg-card p-6 text-center shadow-sm" role="alert"><div className="mx-auto grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive"><CircleAlert size={19} /></div><h1 className="mt-4 text-base font-semibold">We couldn’t verify your access</h1><p className="mt-2 text-xs leading-5 text-muted-foreground">LedgerFlow could not reach the session service. Your bookkeeping data has not been opened.</p><button data-testid="button-retry-auth" onClick={onRetry} className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"><RefreshCw size={14} /> Try again</button></div></div>;
}

function AccessScreen() {
  return <main className="grid min-h-[100dvh] place-items-center bg-background px-5 py-10" data-testid="auth-access-screen"><div className="w-full max-w-[420px]"><div className="rounded-lg border border-card-border bg-card p-7 shadow-md sm:p-9"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm"><Landmark size={20} strokeWidth={2.2} /></div><div><div className="font-display text-[25px] leading-none tracking-tight">LedgerFlow</div><div className="mt-1 font-mono text-[9px] uppercase tracking-[.2em] text-muted-foreground">Review desk</div></div></div><div className="mt-10"><div className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Secure access</div><h1 className="mt-3 font-display text-[36px] leading-[.98] tracking-tight">Your close, ready for review.</h1><p className="mt-4 text-[13px] leading-6 text-muted-foreground">Sign in to open your private bookkeeping review desk. New to LedgerFlow? The same secure flow lets you create an account.</p><Link data-testid="button-login" href="/sign-in" className="focus-ring mt-7 flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5">Sign in or create account</Link></div></div><p className="mt-5 text-center font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground/70">Secure session · Human approval stays in control</p></div></main>;
}

function SignInPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}
function SignUpPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user ? user.externalId ?? user.id : null;
      if (previousUserId.current !== undefined && previousUserId.current !== userId) queryClient.clear();
      previousUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener]);
  return null;
}
function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}>
      <ClerkQueryClientCacheInvalidator />
      <Switch>
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route component={AuthBoundary} />
      </Switch>
    </QueryClientProvider>
  </ClerkProvider>;
}

type AIProviderName = 'managed_openai' | 'openai' | 'anthropic';

function AIProviderSettingsPanel({ clientId }: { clientId: number }) {
  const params = { clientId };
  const settings = useGetLedgerflowAISettings(params);
  const save = useUpdateLedgerflowAISettings();
  const test = useTestLedgerflowAISettings();
  const remove = useRemoveLedgerflowAICredential();
  const [provider, setProvider] = useState<AIProviderName>('managed_openai');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!settings.data) return;
    const nextProvider = settings.data.provider as AIProviderName;
    setProvider(nextProvider);
    setModel(settings.data.model);
  }, [clientId, settings.data?.provider, settings.data?.model]);
  const modelsForProvider = settings.data?.availableModels.filter((option) => option.provider === provider) ?? [];
  const activeModels = modelsForProvider.filter((option) => option.status === 'active');
  const selectedModel = modelsForProvider.find((option) => option.model === model);
  const selectedModelIsUnavailable = Boolean(model) && selectedModel?.status !== 'active';
  const chooseProvider = (nextProvider: AIProviderName) => {
    setProvider(nextProvider);
    setModel(settings.data?.availableModels.find((option) => option.provider === nextProvider && option.status === 'active')?.model ?? '');
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
  return <section className="mt-6 border-t border-border pt-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">AI provider</div><h3 className="mt-1 text-sm font-semibold">AI connection</h3><p className="mt-1 max-w-xl text-[11px] leading-5 text-muted-foreground">Choose Replit-managed OpenAI or use a workspace-owned OpenAI or Anthropic API key. Approved models are updated by your workspace without requiring a LedgerFlow update.</p></div>{settings.data && <span className={`rounded-full px-2 py-1 font-mono text-[9px] ${status === 'configured' || settings.data.provider === 'managed_openai' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>{settings.data.provider === 'managed_openai' ? 'Managed connection' : status === 'configured' ? 'Key configured' : status?.replaceAll('_', ' ')}</span>}</div><form onSubmit={saveSettings} className="mt-4 grid gap-3 sm:grid-cols-2"><label className="block text-xs font-medium">Provider<select data-testid="select-ai-provider" value={provider} onChange={(event) => chooseProvider(event.target.value as AIProviderName)} disabled={settings.isLoading} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary disabled:opacity-50"><option value="managed_openai">Replit-managed OpenAI</option><option value="openai">Workspace-owned OpenAI</option><option value="anthropic">Workspace-owned Anthropic</option></select></label><label className="block text-xs font-medium">Model<select data-testid="select-ai-model" value={model} onChange={(event) => setModel(event.target.value)} disabled={settings.isLoading || !activeModels.length} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary disabled:opacity-50">{selectedModelIsUnavailable && <option value={model} disabled>{selectedModel ? `${selectedModel.displayName} — retired` : `${model} — unavailable`}</option>}{activeModels.length ? activeModels.map((item) => <option key={item.model} value={item.model}>{item.displayName} ({item.model})</option>) : <option value="">No active approved models</option>}</select><span className="mt-1 block text-[10px] font-normal leading-4 text-muted-foreground">Only active models can be selected for new configurations.</span></label>{selectedModelIsUnavailable && <p data-testid="ai-model-recovery-guidance" role="alert" className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-[11px] leading-5 text-destructive sm:col-span-2">This workspace is configured with a model that is no longer available. Select an active replacement above, then save before testing or using the AI assistant.</p>}{provider !== 'managed_openai' && <label className="block text-xs font-medium sm:col-span-2">API key<input data-testid="input-ai-provider-key" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.data?.provider === provider && settings.data.credentialLast4 ? `Stored key ends in ${settings.data.credentialLast4}; enter a key only to replace it` : 'Paste the workspace API key'} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /><span className="mt-1 block text-[10px] font-normal leading-4 text-muted-foreground">{provider === 'anthropic' ? 'A Claude Pro or Max subscription is not an Anthropic API credential; API billing is separate.' : 'Use an API key created for this workspace. The full key is never returned to your browser.'}</span></label>}<div className="flex flex-wrap items-center gap-2 sm:col-span-2"><button data-testid="button-save-ai-settings" disabled={save.isPending || settings.isLoading || selectedModelIsUnavailable || !model} className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{save.isPending ? 'Saving…' : provider === 'managed_openai' ? 'Use managed OpenAI' : apiKey ? 'Save & rotate key' : 'Save provider'}</button><button data-testid="button-test-ai-provider" type="button" onClick={testSettings} disabled={test.isPending || save.isPending || settings.isLoading || selectedModelIsUnavailable || !model} className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50">{test.isPending ? 'Testing…' : 'Test connection'}</button>{settings.data?.provider !== 'managed_openai' && <button data-testid="button-remove-ai-provider-key" type="button" onClick={removeCredential} disabled={remove.isPending} className="rounded-md px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50">{remove.isPending ? 'Removing…' : 'Remove key'}</button>}</div></form>{settings.isLoading && <p className="mt-3 text-[11px] text-muted-foreground">Loading AI connection…</p>}{notice && <p data-testid="ai-settings-notice" className="mt-3 text-[11px] font-medium text-primary">{notice}</p>}{error && <p data-testid="ai-settings-error" className="mt-3 text-[11px] font-medium text-destructive">{error instanceof Error ? error.message : 'AI provider settings could not be updated. Try again.'}</p>}</section>;
}

function MetricCard({ title, metric, formatValue, description }: { title: string; metric: UsageMetricView; formatValue: (v: number) => string; description: string }) {
  const isApproaching = metric.status === 'approaching';
  const isAtLimit = metric.status === 'at_limit';

  return (
    <div className="rounded-lg border border-card-border p-4">
       <div className="flex items-start justify-between gap-2">
         <h4 className="text-sm font-medium">{title}</h4>
         <div className="text-right">
           <div className="text-xs font-mono font-semibold text-foreground">{formatValue(metric.used)} <span className="text-muted-foreground font-normal">/ {formatValue(metric.limit)}</span></div>
         </div>
       </div>

       <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className={`h-full rounded-full transition-all duration-500 ${isAtLimit ? 'bg-destructive' : isApproaching ? 'bg-[#f59e0b]' : 'bg-primary'}`}
            style={{ width: `${Math.min(100, metric.percentage)}%` }}
         />
       </div>

       <div className="mt-3 flex items-start justify-between gap-2">
         <div className="text-[11px] leading-snug text-muted-foreground">{description}</div>
         {isAtLimit ? (
           <span className="inline-flex shrink-0 items-center rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">Limit reached</span>
         ) : isApproaching ? (
           <span className="inline-flex shrink-0 items-center rounded bg-[#f59e0b]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#d97706]">Nearing limit</span>
         ) : null}
       </div>
        {isAtLimit && (
         <div className="mt-2 text-[10px] font-medium text-destructive leading-tight border-t border-destructive/10 pt-2">
            This has reached the current plan allowance. Existing close data remains available; this release does not automatically block bookkeeping actions.
         </div>
       )}
       {isApproaching && !isAtLimit && (
         <div className="mt-2 text-[10px] font-medium text-[#d97706] leading-tight border-t border-[#f59e0b]/10 pt-2">
           Heads up: Approaching your current limit. Review your usage to avoid interruptions.
         </div>
       )}
    </div>
  );
}

function WorkspaceUsageSection() {
  const usageQuery = useGetLedgerflowUsage({
    query: {
      queryKey: getGetLedgerflowUsageQueryKey(),
      staleTime: 5 * 60 * 1000,
      refetchOnMount: true,
    }
  });

  const refresh = () => {
    void usageQuery.refetch();
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };
  const providerActivityCount = (models: Array<{ provider: string; activityCount: number }>, provider: string) => {
    return models.filter((model) => model.provider === provider).reduce((total, model) => total + model.activityCount, 0);
  };
  const estimatedUsd = (amount: number, meteredActivities: number, categoryActivities: number, pendingLabel: string) => {
    if (meteredActivities > 0) return money(amount, 'USD');
    return categoryActivities === 0 ? 'No activity' : pendingLabel;
  };
  const totalEstimatedUsd = (summary: { estimatedTotalProviderCostUsd: number; activitiesWithEstimate: number; completedActivities: number }) => {
    if (summary.activitiesWithEstimate > 0) return money(summary.estimatedTotalProviderCostUsd, 'USD');
    return summary.completedActivities === 0 ? 'No activity' : 'Needs usage data';
  };
  const providerLabel = (provider: string) => {
    if (provider === 'managed_openai') return 'Replit-managed OpenAI';
    if (provider === 'openai') return 'Workspace-owned OpenAI';
    if (provider === 'anthropic') return 'Workspace-owned Anthropic';
    return provider.replaceAll('_', ' ');
  };
  const managedActivityCount = usageQuery.data ? providerActivityCount(usageQuery.data.aiCost.models, 'managed_openai') : 0;
  const directProviderActivityCount = usageQuery.data
    ? providerActivityCount(usageQuery.data.aiCost.models, 'openai') + providerActivityCount(usageQuery.data.aiCost.models, 'anthropic')
    : 0;

  if (usageQuery.isError) {
    return (
      <section id="usage-limits" className="scroll-mt-24 rounded-lg border border-card-border bg-card p-5 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Resource allocation</div>
            <h2 className="mt-2 text-base font-semibold">Usage & limits</h2>
            <p className="mt-1 text-xs text-destructive">Could not load usage data. Please try again later.</p>
          </div>
          <button onClick={refresh} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[11px] font-semibold hover:bg-muted">
             <RefreshCw size={14} className={usageQuery.isFetching ? "animate-spin" : ""} /> Retry
          </button>
        </div>
      </section>
    );
  }

  return (
    <section id="usage-limits" data-testid="section-page-usage-limits" className="scroll-mt-24 rounded-lg border border-card-border bg-card p-5 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Resource allocation</div>
          <h2 className="mt-2 text-base font-semibold">Usage & limits</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Keep track of retained statement evidence, successful AI activity, and retention policies. Data reflects activity in the current billing cycle.</p>
        </div>
        <button data-testid="button-refresh-usage" onClick={refresh} disabled={usageQuery.isFetching} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[11px] font-semibold hover:bg-muted disabled:opacity-50">
           <RefreshCw size={14} className={usageQuery.isFetching ? "animate-spin" : ""} /> Refresh usage
        </button>
      </div>

      {usageQuery.isLoading || !usageQuery.data ? (
        <div className="mt-6 space-y-4">
           <div className="h-24 w-full rounded-md skeleton"></div>
           <div className="h-24 w-full rounded-md skeleton"></div>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-primary/20 bg-primary/5 px-4 py-3">
             <div className="flex items-center gap-4">
                <div className="grid size-8 place-items-center rounded bg-primary/20 text-primary">
                  <Sparkles size={14} />
                </div>
                <div>
                   <div className="text-xs font-semibold text-foreground">{usageQuery.data.plan} plan</div>
                   <div className="text-[11px] text-muted-foreground">Cycle: {usageQuery.data.billingPeriod.label} (started {shortDate(usageQuery.data.billingPeriod.startsAt)})</div>
                </div>
             </div>
             {usageQuery.data.asOf && (
                <div className="text-right text-[10px] text-muted-foreground">
                   Last updated: {new Date(usageQuery.data.asOf).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
             )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
             <MetricCard
              title="Statement imports"
              metric={usageQuery.data.statementImports}
              formatValue={(v) => v.toLocaleString()}
              description="Bank statement files parsed this cycle."
            />
             <MetricCard
              title="AI activity"
              metric={usageQuery.data.aiActivity}
              formatValue={(v) => v.toLocaleString()}
               description="Successful provider-backed AI completions, including connection tests, this cycle."
            />
             <MetricCard
              title="Client workspaces"
              metric={usageQuery.data.clientWorkspaces}
              formatValue={(v) => v.toLocaleString()}
              description="Active client ledgers in this account."
            />
             <MetricCard
              title="Stored evidence"
              metric={{ ...usageQuery.data.storedEvidence, limit: usageQuery.data.storedEvidence.limitBytes, used: usageQuery.data.storedEvidence.bytes }}
              formatValue={formatBytes}
              description={`${usageQuery.data.storedEvidence.documents.toLocaleString()} documents currently stored.`}
            />
          </div>

           <section data-testid="card-estimated-ai-cost" className="rounded-lg border border-primary/20 bg-primary/5 p-5">
             <div className="flex flex-wrap items-start justify-between gap-4">
               <div>
                 <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">AI spend estimate</div>
                 <h3 className="mt-2 text-base font-semibold">AI cost by client</h3>
                 <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Provider-reported tokens are priced using the approved model catalog at the time each successful activity completes.</p>
               </div>
               <div className="rounded-md border border-primary/20 bg-card px-4 py-3 text-right">
                 <div className="text-[10px] font-semibold uppercase tracking-[.1em] text-muted-foreground">Estimated Replit credits</div>
                 <div data-testid="text-estimated-replit-ai-cost" className="mt-1 text-lg font-semibold text-primary">{estimatedUsd(usageQuery.data.aiCost.estimatedReplitCreditsUsd, usageQuery.data.aiCost.replitPricedActivities, managedActivityCount, 'See Replit usage')}</div>
                 <div className="mt-1 text-[10px] text-muted-foreground">{usageQuery.data.aiCost.completedActivities.toLocaleString()} successful activities</div>
               </div>
             </div>

             <div className="mt-5 grid gap-3 sm:grid-cols-3">
               <div className="rounded-md border border-border bg-card p-3">
                 <div className="text-[10px] font-semibold uppercase tracking-[.1em] text-muted-foreground">Replit-managed AI</div>
                  <div data-testid="text-managed-ai-cost" className="mt-1 text-sm font-semibold">{estimatedUsd(usageQuery.data.aiCost.estimatedReplitCreditsUsd, usageQuery.data.aiCost.replitPricedActivities, managedActivityCount, 'See Replit usage')}</div>
                  <div className="mt-1 text-[10px] leading-4 text-muted-foreground">{managedActivityCount > 0 && usageQuery.data.aiCost.replitPricedActivities === 0 ? 'This model has no local pricing estimate; review the authoritative charge in Replit usage.' : 'Estimated deduction from Replit credits.'}</div>
               </div>
               <div className="rounded-md border border-border bg-card p-3">
                 <div className="text-[10px] font-semibold uppercase tracking-[.1em] text-muted-foreground">Workspace-owned keys</div>
                  <div data-testid="text-direct-ai-cost" className="mt-1 text-sm font-semibold">{estimatedUsd(usageQuery.data.aiCost.estimatedProviderDirectUsd, usageQuery.data.aiCost.providerDirectPricedActivities, directProviderActivityCount, 'Needs usage data')}</div>
                  <div className="mt-1 text-[10px] leading-4 text-muted-foreground">{directProviderActivityCount > 0 && usageQuery.data.aiCost.providerDirectPricedActivities === 0 ? 'The provider did not supply enough usage or price data to estimate this cost.' : 'Billed directly by OpenAI or Anthropic, not by Replit.'}</div>
               </div>
               <div className="rounded-md border border-border bg-card p-3">
                 <div className="text-[10px] font-semibold uppercase tracking-[.1em] text-muted-foreground">Usage captured</div>
                 <div className="mt-1 text-sm font-semibold">{usageQuery.data.aiCost.inputTokens.toLocaleString()} in · {usageQuery.data.aiCost.outputTokens.toLocaleString()} out</div>
                 <div className="mt-1 text-[10px] leading-4 text-muted-foreground">{usageQuery.data.aiCost.activitiesWithEstimate.toLocaleString()} priced · {usageQuery.data.aiCost.activitiesWithoutEstimate.toLocaleString()} unavailable</div>
               </div>
             </div>

             <div className="mt-5 overflow-hidden rounded-md border border-border bg-card">
               <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border bg-muted/45 px-4 py-2 font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">
                 <span>Client workspace and model</span>
                 <span>Estimated cost</span>
               </div>
               <div className="divide-y divide-border">
                 {usageQuery.data.clientAiCosts.map((clientCost) => (
                   <div data-testid={`row-estimated-ai-cost-${clientCost.clientId}`} key={clientCost.clientId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3">
                     <div className="min-w-0">
                       <div className="text-xs font-semibold">{clientCost.clientName}</div>
                       {clientCost.usage.models.length ? (
                         <div className="mt-1 flex flex-wrap gap-1.5">
                           {clientCost.usage.models.map((model) => (
                             <span key={`${model.provider}-${model.model}`} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                               {providerLabel(model.provider)} · {model.model} · {model.activityCount} call{model.activityCount === 1 ? '' : 's'}
                             </span>
                           ))}
                         </div>
                       ) : <div className="mt-1 text-[10px] text-muted-foreground">No successful AI activity this cycle.</div>}
                       {clientCost.usage.activitiesWithoutEstimate > 0 && <div className="mt-1 text-[10px] text-muted-foreground">{clientCost.usage.activitiesWithoutEstimate} activity{clientCost.usage.activitiesWithoutEstimate === 1 ? '' : 'ies'} without token or price metadata.</div>}
                     </div>
                     <div className="text-right">
                        <div className="text-xs font-semibold">{totalEstimatedUsd(clientCost.usage)}</div>
                       {clientCost.usage.providerDirectPricedActivities > 0 && <div className="mt-1 text-[10px] text-muted-foreground">+ {money(clientCost.usage.estimatedProviderDirectUsd, 'USD')} direct provider</div>}
                     </div>
                   </div>
                 ))}
               </div>
             </div>
             <p data-testid="text-ai-cost-disclaimer" className="mt-4 text-[10px] leading-5 text-muted-foreground">This is an estimate, not an invoice. Replit-managed AI follows provider public pricing and is deducted from Replit credits; the Replit usage page is the final source of truth. Models without configured pricing or token metadata are shown as unavailable and excluded from totals.</p>
           </section>

          <div className="rounded-md border border-border px-5 py-5">
            <h3 className="text-sm font-semibold">Data retention</h3>
            <p className="mt-1 text-xs text-muted-foreground">Your workspace adheres to the following data retention policies:</p>

            <div className="mt-5 grid gap-4 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <div className="pt-4 sm:pt-0 sm:pr-4">
                 <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Source Evidence</div>
                 <div className="mt-2 text-sm font-semibold">{usageQuery.data.retention.statementEvidenceDays} days</div>
                 <div className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">This report measures retained statement evidence against this workspace policy.</div>
              </div>
              <div className="pt-4 sm:px-4 sm:pt-0">
                 <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">AI Activity Logs</div>
                 <div className="mt-2 text-sm font-semibold">{usageQuery.data.retention.aiActivityDays} days</div>
                 <div className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">Usage tracking records activity events, not chat content, for this rolling window.</div>
              </div>
              <div className="pt-4 sm:pl-4 sm:pt-0">
                 <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Ledger Data</div>
                 <div className="mt-2 text-sm font-semibold">While active</div>
                 <div className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{usageQuery.data.retention.ledgerDataDescription}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function BulkStatementActionDialog({ action, lines, pending, error, onCancel, onConfirm }: {
  action: BulkStatementAction;
  lines: StatementLine[];
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: (accountSuggestion?: string) => void;
}) {
  const isRecode = action.type === 'recode_lines';
  const [accountSuggestion, setAccountSuggestion] = useState(classificationAccounts[0]);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const transition = action.type === 'bulk_approve_entries'
    ? { from: 'suggested', to: 'approved', verb: 'approve', label: 'approval' }
    : action.type === 'bulk_post_entries'
      ? { from: 'approved', to: 'posted', verb: 'post', label: 'posting' }
      : { from: 'suggested', to: 'reclassified', verb: 'recode', label: 'recode' };

  return <AlertDialog open onOpenChange={(open) => { if (!open && !pending) onCancel(); }}>
    <AlertDialogContent onOpenAutoFocus={(event) => { event.preventDefault(); requestAnimationFrame(() => cancelButtonRef.current?.focus()); }} className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-card-border bg-card">
      <AlertDialogHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="text-left">
          <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Confirm bulk action</div>
          <AlertDialogTitle data-testid="text-bulk-confirm-title" className="mt-2">{isRecode ? 'Recode selected lines' : `${transition.verb[0].toUpperCase()}${transition.verb.slice(1)} selected entries`}</AlertDialogTitle>
        </div>
        <button ref={cancelButtonRef} data-testid="button-cancel-bulk-action" onClick={onCancel} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Cancel bulk action"><X size={17} /></button>
      </AlertDialogHeader>
      <AlertDialogDescription data-testid="text-bulk-confirm-description" className="text-xs leading-5">
        {isRecode
          ? `You are about to recode ${lines.length} suggested ${lines.length === 1 ? 'line' : 'lines'} to one account. This updates the suggestions but does not approve or post them.`
          : `Confirm ${transition.label} for ${lines.length} ${lines.length === 1 ? 'entry' : 'entries'}: ${transition.from} → ${transition.to}. This cannot include entries that have changed status.`}
      </AlertDialogDescription>
      {isRecode && <label className="block text-xs font-semibold">Supported account
        <select data-testid="select-bulk-recode-account" value={accountSuggestion} onChange={(event) => setAccountSuggestion(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus:border-primary">
          {classificationAccounts.map((account) => <option key={account} value={account}>{account}</option>)}
        </select>
      </label>}
      <div className="mt-4 rounded-md border border-border bg-muted/35 p-3">
        <div className="font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">Selected lines · {lines.length}</div>
        <div className="mt-2 space-y-1.5">
          {lines.slice(0, 5).map((line) => <div data-testid={`bulk-confirm-line-${line.id}`} key={line.id} className="flex items-center justify-between gap-3 text-xs">
            <span className="truncate">{line.description}</span><span className="shrink-0 font-mono text-muted-foreground">{money(Math.abs(line.amount), line.currency)}</span>
          </div>)}
          {lines.length > 5 && <div className="pt-1 font-mono text-[10px] text-muted-foreground">+ {lines.length - 5} more selected</div>}
        </div>
      </div>
      {error != null && <div data-testid="status-bulk-action-error" className="mt-4 flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive"><CircleAlert size={15} className="mt-0.5 shrink-0" /><span>{mutationErrorMessage(error)}</span></div>}
      <AlertDialogFooter className="mt-2 gap-2 sm:space-x-0">
        <button data-testid="button-cancel-bulk-action-footer" onClick={onCancel} disabled={pending} className="rounded-md border border-input bg-background px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50">Cancel</button>
        <button data-testid={`button-confirm-${isRecode ? 'bulk-recode' : transition.verb === 'approve' ? 'bulk-approval' : 'bulk-posting'}`} onClick={() => onConfirm(isRecode ? accountSuggestion : undefined)} disabled={pending} className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
          {pending && <LoaderCircle size={13} className="animate-spin" />}{pending ? 'Applying…' : `Confirm ${transition.verb}`}
        </button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

function mutationErrorMessage(error: unknown) {
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (typeof data === 'object' && data !== null && 'error' in data && typeof (data as { error?: unknown }).error === 'string') {
      return (data as { error: string }).error;
    }
  }
  return error instanceof Error ? error.message : 'The bulk action could not be applied. Refresh the queue and try again.';
}
