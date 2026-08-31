import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import {
  ArrowDownLeft, ArrowRight, BarChart3, BookOpenCheck, Check, ChevronDown, ChevronRight,
  CircleAlert, CircleCheck, CircleHelp, Download, FileCheck2, FileSpreadsheet, Filter, Landmark,
  LayoutDashboard, LoaderCircle, LogOut, Menu, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw,
  Mail, RotateCw, Search, Settings2, Sparkles, Table2, Trash2, UploadCloud, UserPlus, Users, X, CalendarDays
} from 'lucide-react';
import {
  getGetBankAccountsQueryKey, getGetBulkTransitionAuditsQueryKey, getGetClientsQueryKey, getGetFinancialStatementsQueryKey, getGetJournalEntriesQueryKey, getGetLedgerOverviewQueryKey, getGetLedgerflowAccountsQueryKey, getGetReportPackQueryKey, getGetReportPacksQueryKey, getGetUaeCorporateTaxSummaryQueryKey,
  getGetStatementLinesQueryKey, getGetTrialBalanceQueryKey, getGetTrialBalanceAccountTransactionsQueryKey, getGetExchangeRatesQueryKey, getGetAgarAccountingUsageQueryKey, getGetFirmProfileQueryKey,
  useArchiveLedgerflowAccount, useCreateClient, useCreateLedgerflowAccount, useCreateReportPack, useCreateStatementLine, useGetClients, useGetJournalEntries, useGetLedgerOverview, useGetLedgerflowAccounts, useGetReportPack, useGetReportPacks, useGetUaeCorporateTaxSummary,
  useConfirmAICopilotAction, useCreateExchangeRate, useDeleteExchangeRate, useDeleteReportPack, useGetBankAccounts, useGetExchangeRates, useGetAgarAccountingAISettings, useGetAgarAccountingUsage, useGetStatementLines, useGetTrialBalance, useGetTrialBalanceAccountTransactions, useImportStatement, useParseExchangeRates,
  getGetWorkspaceMembersQueryKey, useAcceptWorkspaceInvitation, useCreateWorkspaceInvitation, useImportExchangeRates, usePostJournalEntry, useUnpostJournalEntry, useRemoveAgarAccountingAICredential, useRemoveWorkspaceMember, useResendWorkspaceInvitation, useRevokeWorkspaceInvitation, useTestAgarAccountingAISettings, useUpdateClient, useUpdateExchangeRate, useUpdateAgarAccountingAISettings, useUpdateAgarAccountingAccountProfile, useUpdateFirmProfile, useUpdateLedgerflowAccount, useUpdateReportPack, useUpdateWorkspaceMember, useGetWorkspaceMembers, useGetFirmProfile,
  useGetOrganizationContext, getGetOrganizationContextQueryKey, useCompleteOrganizationOnboarding, useInviteFirmMember, useInviteAccountingFirm, useInviteCompanyOwnerTransfer, useAcceptOrganizationInvitation, useNominateFirmEngagementMember, useApproveFirmEngagementMember, useRevokeFirmEngagementMember, useRevokeFirmEngagement,
  useGetContacts, getGetContactsQueryKey, useCreateContact, useUpdateContact, useGetContactHistory, getGetContactHistoryQueryKey, usePreviewContactMerge, useMergeContacts
} from '@workspace/api-client-react';
import { getGetStatementImportsQueryKey, useGetStatementImports, useUndoStatementImport } from '@workspace/api-client-react';
import type {
  Client, ClientUpdateInput, ExchangeRate, ExchangeRateInput, ExchangeRateParseResult, JournalEntry, LedgerflowAccount, ReportAmount, ReportChecklistItem, ReportNote, ReportPack, ReportSignatory, StatementImport, StatementImportResult, StatementImportAccountGroupInput, StatementLine, StatementLineInput, StatementSection, WorkspaceInvitation, WorkspaceMember, OrganizationContext, OrganizationMode, FirmMembership, OrganizationInvitation, FirmEngagement,
  Contact, ContactHistory, ContactInput, ContactMergePreview
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as SonnerToaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { notify, readErrorMessage, isErrorHandled, markErrorHandled } from '@/lib/notify';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AssistantFAB } from './components/assistant-fab';
import FeedbackPage, { FeedbackPublicShell } from './pages/feedback';
import { AssistantPageContextProvider, usePublishAssistantPageContext } from './lib/assistant-page-context';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { useUpload } from '@workspace/object-storage-web';
import { clearUserScopedState, getActiveWorkspaceStorageKey, getWorkspaceLoadState, requiresWorkspaceOnboarding, selectWorkspaceForSession } from './lib/user-state';
import { appendUniqueStatementFiles, findNextStatementQueueIndex, type StatementImportQueueItem } from './lib/statement-import-queue';
import { buildSystemNoteDrafts, hydrateChecklistDefaults } from './lib/system-note-drafts';
import { ClientContext, OrgContext, useClientWorkspace, useOrgContext } from './lib/workspace-context';
import {
  advanceImportActivitySequence,
  getImportActivitySequenceKey,
  IMPORT_ACTIVITY_MESSAGE_DELAY_MS,
  importActivityCopy,
  resetImportActivitySequence,
  type ImportActivitySequenceState,
  type ImportActivityStage,
} from './lib/import-activity';
// Toast reporting for mutations is auto-on for errors: any mutation that
// throws will surface a generic toast unless one of these opt-outs applies:
//   - the mutation's onError explicitly called notify.error() (isErrorHandled)
//   - the hook was created with { mutation: { meta: { notify: false } } }
//   - the hook was created with { mutation: { meta: { notify: { silent: true } } } }
// Optional per-hook customization:
//   - meta.notify.title / meta.notify.error   → title for the auto error toast
//   - meta.notify.success                     → success toast text
// Queries are silent by default; opt in with the same meta.notify shape.
type NotifyMeta = boolean | { success?: string; error?: string; title?: string; silent?: boolean };
function readNotifyMeta(meta: unknown): NotifyMeta | null {
  if (!meta || typeof meta !== 'object') return null;
  const value = (meta as { notify?: unknown }).notify;
  if (typeof value === 'boolean' || (typeof value === 'object' && value !== null)) return value as NotifyMeta;
  return null;
}
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      const notifyMeta = readNotifyMeta(query.meta);
      if (notifyMeta === null || notifyMeta === false) return;
      if (typeof notifyMeta === 'object' && notifyMeta.silent) return;
      const title = typeof notifyMeta === 'object' ? notifyMeta.error ?? notifyMeta.title : undefined;
      notify.error(error, { title });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      // Contextual toast already fired via notify.error inside the mutation's
      // own onError handler — skip to avoid stacking two toasts.
      if (isErrorHandled(error)) return;
      const notifyMeta = readNotifyMeta(mutation.meta);
      if (notifyMeta === null || notifyMeta === false) return;
      if (typeof notifyMeta === 'object' && notifyMeta.silent) return;
      const title = typeof notifyMeta === 'object' ? notifyMeta.error ?? notifyMeta.title : undefined;
      notify.error(error, { title });
    },
    onSuccess: (_data, _variables, _context, mutation) => {
      const notifyMeta = readNotifyMeta(mutation.meta);
      if (notifyMeta !== null && typeof notifyMeta === 'object' && notifyMeta.success) notify.success(notifyMeta.success);
    },
  }),
});
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const brandMarkUrl = `${basePath}/mark.svg`;
const nav = [
  { href: '/', label: 'Close overview', icon: LayoutDashboard },
  { href: '/import-statement', label: 'Import statement', icon: UploadCloud },
  { href: '/statement-lines', label: 'Statement lines', icon: Table2 },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/journal-entries', label: 'Journal entries', icon: BookOpenCheck },
  { href: '/trial-balance', label: 'Trial balance', icon: BarChart3 },
  { href: '/financial-statements', label: 'Financial statements', icon: FileSpreadsheet },
  { href: '/client-settings', label: 'Client settings', icon: Settings2 },
];
const money = (value: number, currency = 'AED') => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
const reportMoney = (value: number) => {
  const absolute = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value));
  return value < 0 ? `(${absolute})` : absolute;
};
const MAX_IMPORT_FILE_SIZE = 50 * 1024 * 1024;
const FIRM_RATE_PAGE_SIZE = 25;
const STATEMENT_LINES_PAGE_SIZE = 25;
const shortDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const isDateInRange = (value: string, from: string, to: string) => {
  const day = value.slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
};
type SortDirection = 'asc' | 'desc';
type StatementSortKey = 'date' | 'description' | 'contact' | 'account' | 'amount' | 'confidence' | 'status';
type JournalSortKey = 'date' | 'memo' | 'currency' | 'amount' | 'confidence' | 'status';

function SortControl({ label, column, activeColumn, direction, onSort, testId }: { label: string; column: string; activeColumn: string; direction: SortDirection; onSort: (column: string) => void; testId: string }) {
  const active = column === activeColumn;
  return <button data-testid={testId} type="button" aria-label={`Sort by ${label}`} aria-sort={active ? direction === 'asc' ? 'ascending' : 'descending' : 'none'} onClick={() => onSort(column)} className={`inline-flex items-center gap-1 rounded px-1 py-1 text-left transition-colors hover:bg-muted hover:text-foreground ${active ? 'text-foreground' : ''}`}>
    <span>{label}</span><span aria-hidden="true" className="font-mono text-[10px] text-primary">{active ? direction === 'asc' ? '↑' : '↓' : '↕'}</span>
  </button>;
}
const dashboardGreeting = (date: Date) => {
  const hour = date.getHours();
  const options = hour < 5
    ? ['Working late', 'After-hours close control', 'The books never sleep']
    : hour < 12
      ? ['Good morning', 'Fresh start', 'Morning close check-in']
      : hour < 18
        ? ['Good afternoon', 'The close is moving', 'Afternoon close check-in']
        : ['Good evening', 'Tying up the loose ends', 'Evening close check-in'];
  return options[date.getDate() % options.length];
};
const dashboardDateLabel = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
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

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  layout: {
    logoImageUrl: brandMarkUrl,
  },
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


function ClientFirmAccessSection({ clientId, activeClient }: { clientId: number, activeClient: Client }) {
  const orgContext = useOrgContext();
  const canManageCompany = orgContext?.managedCompanyIds.includes(clientId) ?? false;
  const inviteFirm = useInviteAccountingFirm();
  const inviteTransfer = useInviteCompanyOwnerTransfer();
  const approveMember = useApproveFirmEngagementMember();
  const revokeMember = useRevokeFirmEngagementMember();
  const revokeEngagement = useRevokeFirmEngagement();

  const [email, setEmail] = useState('');
  const [firmId, setFirmId] = useState('');
  const [transferEmail, setTransferEmail] = useState('');

  const engagement = orgContext?.engagements?.find(e => e.clientId === clientId);
  const firmInvites = orgContext?.invitations?.filter(inv => inv.clientId === clientId && inv.kind === 'firm_engagement');
  const transferInvites = orgContext?.invitations?.filter(inv => inv.clientId === clientId && inv.kind === 'company_transfer');

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    inviteFirm.mutate({ id: clientId, data: { email, firmId: Number(firmId), role: 'admin' } }, {
      onSuccess: () => {
        const invited = email;
        setEmail('');
        queryClient.invalidateQueries({ queryKey: getGetOrganizationContextQueryKey() });
        notify.success('Firm invitation sent', { description: `${invited} will receive access to this company.` });
      }
    });
  };

  const handleTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    inviteTransfer.mutate({ id: clientId, data: { email: transferEmail } }, {
      onSuccess: () => {
        const invited = transferEmail;
        setTransferEmail('');
        queryClient.invalidateQueries({ queryKey: getGetOrganizationContextQueryKey() });
        notify.success('Ownership transfer invitation sent', { description: `${invited} was invited to take ownership.` });
      }
    });
  };

  return (
    <section id="firm-access" className="scroll-mt-24 rounded-lg border border-card-border bg-card p-5 md:p-6 mt-6">
      <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Delegation & Control</div>
      <h2 className="mt-2 text-base font-semibold">Firm access</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">Manage external accounting firms hired to work on this company.</p>

      {canManageCompany && activeClient.ownershipStatus === 'firm_provisional' ? (
        <div className="mt-5 rounded border border-[#f59e0b]/30 bg-[#f59e0b]/10 p-4 text-[11px] leading-5 text-[#d97706]">
          <strong>Firm Provisional Company:</strong> This company was created by a firm and the firm is liable for subscription costs. You can transfer ownership to a client.

          <form onSubmit={handleTransfer} className="mt-3 flex gap-2">
            <input required type="email" value={transferEmail} onChange={e => setTransferEmail(e.target.value)} placeholder="Client owner email" className="h-9 flex-1 rounded border border-[#f59e0b]/30 bg-background px-3 text-xs" />
            <button disabled={inviteTransfer.isPending} className="h-9 rounded bg-[#d97706] px-4 text-xs font-semibold text-[#fffbeb] disabled:opacity-50">Invite client to take ownership</button>
          </form>

          {transferInvites && transferInvites.length > 0 && (
            <div className="mt-3 divide-y divide-[#f59e0b]/20 border-t border-[#f59e0b]/20 pt-2">
              {transferInvites.map(inv => (
                <div key={inv.id} className="flex justify-between py-2">
                  <span><strong>{inv.email}</strong> · Invited</span>
                  <span className="font-mono text-[9px] uppercase">{inv.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {canManageCompany && !engagement && activeClient.ownershipStatus !== 'firm_provisional' && (
        <form onSubmit={handleInvite} className="mt-5 grid items-end gap-3 sm:grid-cols-[1fr_9rem_auto]">
          <label className="flex-1 text-xs font-medium">Accounting firm administrator email<input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" placeholder="admin@firm.com" /></label>
          <label className="text-xs font-medium">Firm ID<input required min="1" type="number" value={firmId} onChange={e => setFirmId(e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" /></label>
          <button disabled={inviteFirm.isPending} className="h-10 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50">Invite firm</button>
        </form>
      )}

      {firmInvites && firmInvites.length > 0 && !engagement && (
         <div className="mt-5 divide-y rounded-md border border-border">
          {firmInvites.map(inv => (
            <div key={inv.id} className="flex items-center justify-between p-3 text-xs bg-muted/50">
              <div><strong>{inv.email}</strong> · Firm invited</div>
              <div className="font-mono text-[10px] uppercase text-muted-foreground">{inv.status}</div>
            </div>
          ))}
        </div>
      )}

      {engagement && (
        <div className="mt-5 rounded-md border border-border p-4">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-semibold">{engagement.firmName}</h3>
              <div className="font-mono text-[10px] uppercase text-muted-foreground mt-1">{engagement.status}</div>
            </div>
            {engagement.canManageCompany && <button onClick={() => { if(confirm("Revoke this firm's access to your company?")) revokeEngagement.mutate({ id: engagement.id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetOrganizationContextQueryKey() }); notify.success(`${engagement.firmName} access revoked`); } }); }} className="text-[11px] font-semibold text-destructive hover:underline">Revoke Firm Access</button>}
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <h4 className="text-xs font-semibold">Firm Members Working on Your Account</h4>
            <div className="mt-2 space-y-2">
              {engagement.members.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No firm members nominated yet.</p>
              ) : engagement.members.map(m => (
                <div key={m.userId} className="flex items-center justify-between text-[11px]">
                  <span>{m.name} ({m.email}) - {m.role}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[9px] uppercase text-muted-foreground">{m.status}</span>
                    {engagement.canManageCompany && m.status === 'nominated' && (
                      <button onClick={() => approveMember.mutate({ id: engagement.id, userId: m.userId }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetOrganizationContextQueryKey() }); notify.success(`${m.name} approved`); } })} className="rounded bg-primary/10 px-2 py-1 text-primary hover:bg-primary/20">Approve</button>
                    )}
                    {engagement.canManageCompany && (m.status === 'nominated' || m.status === 'approved') && (
                      <button onClick={() => revokeMember.mutate({ id: engagement.id, userId: m.userId }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetOrganizationContextQueryKey() }); notify.success(`${m.name} access revoked`); } })} className="rounded bg-destructive/10 px-2 py-1 text-destructive hover:bg-destructive/20">Revoke</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

type ChartAccountForm = {
  accountCode: string;
  accountName: string;
  displayName: string;
  statementSection: LedgerflowAccount['statementSection'];
  currentNonCurrent: LedgerflowAccount['currentNonCurrent'];
  cashFlowCategory: LedgerflowAccount['cashFlowCategory'];
  taxTreatment: LedgerflowAccount['taxTreatment'];
  taxTreatmentReason: string;
  sortOrder: number;
};
function ClientSettingsPage() {
  const { activeClient } = useClientWorkspace();
  const [, setLocation] = useLocation();
  const mutation = useUpdateClient();
  const rateScope = { clientId: activeClient?.id };
  const ratesQuery = useGetExchangeRates(rateScope, { query: { queryKey: getGetExchangeRatesQueryKey(rateScope), enabled: !!activeClient } });
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
    systemRatesEnabled: activeClient?.systemRatesEnabled ?? true,
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
    queryClient.invalidateQueries({ queryKey: getGetExchangeRatesQueryKey(rateScope) });
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
        notify.success('Workspace settings saved');
      },
    });
  };
  const saveRate = (event: React.FormEvent) => {
    event.preventDefault();
    const data = { ...rateForm, sourceCurrency: rateForm.sourceCurrency.toUpperCase(), functionalCurrency: rateForm.functionalCurrency.toUpperCase(), rate: Number(rateForm.rate), note: rateForm.note || null };
    const pair = `${data.sourceCurrency} → ${data.functionalCurrency}`;
    const options = {
      onSuccess: () => {
        invalidateRates();
        const wasEditing = editingRateId !== null;
        resetRateForm();
        notify.success(wasEditing ? 'Exchange rate updated' : 'Exchange rate saved', { description: `${pair} @ ${data.rate} (${data.effectiveDate})` });
      },
    };
    if (editingRateId) updateRate.mutate({ id: editingRateId, data }, options);
    else createRate.mutate({ data, params: rateScope }, options);
  };
  const editRate = (rate: ExchangeRate) => {
    setEditingRateId(rate.id);
    setRateForm({ sourceCurrency: rate.sourceCurrency, functionalCurrency: rate.functionalCurrency, effectiveDate: rate.effectiveDate, rate: String(rate.rate), source: rate.source, note: rate.note ?? '' });
  };
  const importParsedRates = async (rates: ExchangeRateInput[], source: 'csv' | 'ai') => {
    try {
      const result = await importRates.mutateAsync({ data: { rates }, params: rateScope });
      invalidateRates();
      setRatePreview(null);
      const total = result.importedCount + result.updatedCount;
      const summary = `${total} rate${total === 1 ? '' : 's'} ${source === 'ai' ? 'confirmed and ' : ''}imported (${result.updatedCount} updated).`;
      setRateImportNotice(summary);
      notify.success('Exchange rates imported', { description: summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The detected rates could not be imported. Check the preview and try again.';
      setRateImportError(message);
      notify.error(error, { title: 'Rate import failed', description: message, fallback: message });
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
      const message = error instanceof Error ? error.message : 'The rate file could not be read or mapped safely.';
      setRateImportError(message);
      notify.error(error, { title: 'Rate file rejected', description: message, fallback: message });
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
            ['#firm-access', 'Firm access'],
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
            <label className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-3 text-xs sm:col-span-2"><input data-testid="checkbox-page-settings-system-rates" type="checkbox" checked={form.systemRatesEnabled} onChange={(event) => setForm((current) => ({ ...current, systemRatesEnabled: event.target.checked }))} className="mt-0.5" /><span><strong>Use system exchange rates as a fallback</strong><span className="mt-1 block text-[11px] leading-5 text-muted-foreground">Client and firm schedules remain higher priority. Turn this off to require an explicit client or firm rate.</span></span></label>
            {(mutation.isError || saved) && <p data-testid={saved ? 'status-page-settings-saved' : 'status-page-settings-error'} className={`text-xs sm:col-span-2 ${saved ? 'text-primary' : 'text-destructive'}`}>{saved ? 'Workspace settings saved.' : 'Settings could not be saved. Check the details and try again.'}</p>}
            <div className="flex justify-end sm:col-span-2"><button data-testid="button-page-save-workspace-settings" disabled={mutation.isPending} className="rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{mutation.isPending ? 'Saving…' : 'Save profile settings'}</button></div>
          </form>
        </section>
        <ClientFirmAccessSection clientId={activeClient.id} activeClient={activeClient} />
        {ratePreview && <><section id="exchange-rates" className="scroll-mt-24 rounded-lg border border-card-border bg-card p-5 md:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Shared conversion library</div><h2 className="mt-2 text-base font-semibold">Exchange-rate schedule</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Enter functional-currency units for one source-currency unit. AgarAccounting AI System uses the exact date first, then the latest prior rate. CSV and Excel layouts without standard headers are prepared for your review with AI.</p></div><label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-[11px] font-semibold hover:bg-muted"><UploadCloud size={14} /> {parseRates.isPending ? 'Detecting layout…' : importRates.isPending ? 'Importing…' : 'Import file'}<input data-testid="input-page-exchange-rate-import" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={parseRates.isPending || importRates.isPending} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; void importRateFile(file); }} /></label></div>
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
        <div className="mt-4 overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[650px] text-left"><thead className="bg-muted/55 font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground"><tr><th className="px-3 py-2">Effective</th><th className="px-3 py-2">Direction</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2">Source / note</th><th className="px-3 py-2 text-right">Actions</th></tr></thead><tbody className="divide-y divide-border">{ratesQuery.isLoading ? <tr><td colSpan={5} className="px-3 py-5 text-center text-xs text-muted-foreground">Loading workspace rates…</td></tr> : ratesQuery.data?.length ? ratesQuery.data?.map((rate) => <tr data-testid={`row-page-exchange-rate-${rate.id}`} key={rate.id}><td className="px-3 py-3 font-mono text-[11px]">{shortDate(rate.effectiveDate)}</td><td className="px-3 py-3 text-xs font-semibold">{rate.sourceCurrency} → {rate.functionalCurrency}</td><td className="px-3 py-3 text-right font-mono text-xs">{rate.rate.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td><td className="px-3 py-3 text-[11px] text-muted-foreground">{rate.source}{rate.note ? ` · ${rate.note}` : ''}</td><td className="px-3 py-3 text-right"><button data-testid={`button-page-edit-exchange-rate-${rate.id}`} type="button" onClick={() => editRate(rate)} className="mr-2 text-[11px] font-semibold text-primary">Edit</button><button data-testid={`button-page-delete-exchange-rate-${rate.id}`} type="button" disabled={deleteRate.isPending} onClick={() => deleteRate.mutate({ id: rate.id }, { onSuccess: () => { invalidateRates(); notify.success(`${rate.sourceCurrency} → ${rate.functionalCurrency} removed`); } })} className="text-[11px] font-semibold text-destructive">Remove</button></td></tr>) : <tr><td colSpan={5} className="px-3 py-5 text-center text-xs text-muted-foreground">No workspace rates yet. AED-only clients do not need a rate.</td></tr>}</tbody></table></div>
        </section></>}
        <section id="bank-accounts" className="scroll-mt-24 rounded-lg border border-card-border bg-card p-5 md:p-6">
          <div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-primary"><Landmark size={18} /></div><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Evidence sources</div><h2 className="mt-2 text-base font-semibold">Connected bank accounts</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Accounts are detected from imported statements and kept separate per client. Import another statement to add a new account.</p></div></div>
          <div className="mt-5 overflow-hidden rounded-lg border border-border">{bankAccountsQuery.isLoading ? <div className="p-5 text-xs text-muted-foreground">Loading connected accounts…</div> : bankAccountsQuery.data?.length ? <div className="divide-y divide-border">{bankAccountsQuery.data.map((account) => <div data-testid={`row-page-bank-account-${account.id}`} key={account.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="text-xs font-semibold">{account.name}</div><div className="mt-1 text-[11px] text-muted-foreground">{account.bankName || 'Bank not identified'}{account.accountNumberLast4 ? ` · ending ${account.accountNumberLast4}` : ''}</div></div><span className="rounded-full bg-secondary px-2.5 py-1 font-mono text-[10px] text-primary">{account.currency}</span></div>)}</div> : <div data-testid="state-page-bank-accounts-empty" className="p-5 text-xs text-muted-foreground">No bank accounts detected yet. They will appear here after a statement import identifies an account.</div>}</div>
        </section>
        {false && <WorkspaceUsageSection />}
        <div id="ai-connection" className="scroll-mt-24 rounded-lg border border-card-border bg-card p-5 md:p-6">
          <AIProviderSettingsPanel clientId={activeClient.id} />
        </div>
        <ChartAccountsSection clientId={activeClient.id} />
        {false && <><section id="administration" className="scroll-mt-24 rounded-lg border border-card-border bg-card p-5 md:p-6">
          <div className="flex items-start justify-between gap-4"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Workspace administration</div><h2 className="mt-2 text-base font-semibold">More controls for your team</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">These are the next places to manage how your firm uses AgarAccounting AI System. They are shown here so the workspace has one clear home for operational settings.</p></div><Settings2 className="shrink-0 text-muted-foreground" size={18} /></div>
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


function FirmMembersSection({ firmId, members, invitations }: { firmId: number, members: FirmMembership[], invitations: OrganizationInvitation[] }) {
  const [email, setEmail] = useState('');
  const invite = useInviteFirmMember();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const invited = email;
    invite.mutate({ id: firmId, data: { email, role: 'accountant' } }, {
      onSuccess: () => {
        setEmail('');
        queryClient.invalidateQueries({ queryKey: getGetOrganizationContextQueryKey() });
        notify.success('Firm member invited', { description: `Invitation sent to ${invited}.` });
      }
    });
  };

  const firmInvitations = invitations.filter(inv => inv.firmId === firmId && inv.kind === 'firm_member');

  return (
    <section className="rounded-lg border border-card-border bg-card p-5 md:p-6 mt-6">
      <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Firm Access</div>
      <h2 className="mt-2 text-base font-semibold">Firm Members</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">Manage accountants and bookkeepers in your firm.</p>

      <form onSubmit={submit} className="mt-5 flex items-end gap-3">
        <label className="flex-1 text-xs font-medium">Email address<input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" placeholder="colleague@firm.com" /></label>
        <button disabled={invite.isPending} className="h-10 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50">Invite member</button>
      </form>

      <div className="mt-5 divide-y rounded-md border border-border">
        {members.map(m => (
          <div key={m.userId} className="flex items-center justify-between p-3 text-xs">
            <div><strong>{m.name}</strong> · {m.email}</div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">{m.role}</div>
          </div>
        ))}
        {firmInvitations.map(inv => (
          <div key={inv.id} className="flex items-center justify-between p-3 text-xs bg-muted/50">
            <div><strong>{inv.email}</strong> · Invited</div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">{inv.status}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FirmEngagementsSection({ engagements }: { engagements: FirmEngagement[] }) {
  const nominate = useNominateFirmEngagementMember();
  const revoke = useRevokeFirmEngagement();

  return (
    <section className="rounded-lg border border-card-border bg-card p-5 md:p-6 mt-6">
      <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Client relationships</div>
      <h2 className="mt-2 text-base font-semibold">Firm Engagements</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">Companies that have hired your firm for bookkeeping.</p>

      {engagements.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">No active engagements.</p>
      ) : (
        <div className="mt-5 space-y-4">
          {engagements.map(eng => (
            <div key={eng.id} className="rounded-md border border-border p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold">{eng.companyName}</h3>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[.1em] text-muted-foreground">{eng.status} engagement</div>
                </div>
                {eng.canManageCompany && <button onClick={() => { if(confirm("Revoke engagement?")) revoke.mutate({ id: eng.id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetOrganizationContextQueryKey() }); notify.success(`${eng.companyName} engagement revoked`); } }); }} className="text-[11px] font-semibold text-destructive hover:underline">Revoke</button>}
              </div>

              <div className="mt-4 border-t border-border pt-4">
                <h4 className="text-xs font-semibold">Assigned team</h4>
                <div className="mt-2 space-y-2">
                  {eng.members.map(m => (
                    <div key={m.userId} className="flex items-center justify-between text-[11px]">
                      <span>{m.name} ({m.email}) - {m.role}</span>
                      <span className="font-mono text-[9px] uppercase text-muted-foreground">{m.status}</span>
                    </div>
                  ))}
                </div>

                {eng.canManageFirm && eng.status === 'active' && <form className="mt-3 flex gap-2" onSubmit={e => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  const nominatedEmail = form.get('email') as string;
                  nominate.mutate({ id: eng.id, data: { email: nominatedEmail, role: 'bookkeeper' } }, {
                    onSuccess: () => {
                      (e.target as HTMLFormElement).reset();
                      queryClient.invalidateQueries({ queryKey: getGetOrganizationContextQueryKey() });
                      notify.success('Member nominated', { description: `${nominatedEmail} is awaiting company approval.` });
                    }
                  });
                }}>
                  <input name="email" required type="email" placeholder="Assign firm member by email" className="h-8 flex-1 rounded border border-input bg-background px-2 text-xs" />
                  <button className="h-8 rounded bg-secondary px-3 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80">Nominate</button>
                </form>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FirmSettingsPage() {
  const orgContext = useOrgContext();
  const firmRateScope = { firmId: orgContext?.firms[0]?.firmId };
  const firmQuery = useGetFirmProfile({ query: { queryKey: getGetFirmProfileQueryKey() } });
  const clientsQuery = useGetClients({ query: { queryKey: getGetClientsQueryKey() } });
  const saveFirm = useUpdateFirmProfile();
  const ratesQuery = useGetExchangeRates(firmRateScope, { query: { queryKey: getGetExchangeRatesQueryKey(firmRateScope), enabled: !!firmRateScope.firmId } });
  const createRate = useCreateExchangeRate();
  const deleteRate = useDeleteExchangeRate();
  const importRates = useImportExchangeRates();
  const parseRates = useParseExchangeRates();
  const { user } = useUser();
  const [form, setForm] = useState({ name: '', legalName: '', systemRatesEnabled: true, reportAttributionEnabled: false });
  const [rate, setRate] = useState({ sourceCurrency: 'USD', functionalCurrency: 'AED', effectiveDate: new Date().toISOString().slice(0, 10), rate: '' });
  const [rateImportError, setRateImportError] = useState('');
  const [rateImportNotice, setRateImportNotice] = useState('');
  const [ratePreview, setRatePreview] = useState<ExchangeRateParseResult | null>(null);
  const [ratePage, setRatePage] = useState(1);
  useEffect(() => {
    if (firmQuery.data) setForm({ name: firmQuery.data.name, legalName: firmQuery.data.legalName, systemRatesEnabled: firmQuery.data.systemRatesEnabled, reportAttributionEnabled: firmQuery.data.reportAttributionEnabled });
  }, [firmQuery.data?.id, firmQuery.data?.name, firmQuery.data?.legalName, firmQuery.data?.systemRatesEnabled, firmQuery.data?.reportAttributionEnabled]);
  const refreshRates = () => {
    queryClient.invalidateQueries({ queryKey: getGetExchangeRatesQueryKey(firmRateScope) });
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
      const result = await importRates.mutateAsync({ data: { rates }, params: firmRateScope });
      refreshRates();
      setRatePage(1);
      setRatePreview(null);
      const total = result.importedCount + result.updatedCount;
      const summary = `${total} rate${total === 1 ? '' : 's'} ${source === 'ai' ? 'confirmed and ' : ''}imported (${result.updatedCount} updated).`;
      setRateImportNotice(summary);
      notify.success('Firm rates imported', { description: summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The detected rates could not be imported. Check the preview and try again.';
      setRateImportError(message);
      notify.error(error, { title: 'Firm rate import failed', description: message, fallback: message });
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
      const message = error instanceof Error ? error.message : 'The rate file could not be read or mapped safely.';
      setRateImportError(message);
      notify.error(error, { title: 'Rate file rejected', description: message, fallback: message });
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
          <label className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-3 text-xs sm:col-span-2"><input data-testid="checkbox-firm-system-rates" type="checkbox" checked={form.systemRatesEnabled} onChange={(event) => setForm({ ...form, systemRatesEnabled: event.target.checked })} className="mt-0.5" /><span><strong>Allow system exchange-rate fallback</strong><span className="mt-1 block text-[11px] leading-5 text-muted-foreground">Firm and client schedules remain authoritative. Disable this to keep every client on firm-controlled rates only.</span></span></label>
          <label className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-3 text-xs sm:col-span-2"><input data-testid="checkbox-firm-report-attribution" type="checkbox" checked={form.reportAttributionEnabled} onChange={(event) => setForm({ ...form, reportAttributionEnabled: event.target.checked })} className="mt-0.5" /><span><strong>Show firm name on generated reports</strong><span className="mt-1 block text-[11px] leading-5 text-muted-foreground">New report packs for active firm engagements will show the firm name on the browser cover and final PDF. Existing snapshots never change.</span></span></label>
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
        <form onSubmit={(event) => { event.preventDefault(); createRate.mutate({ data: { ...rate, sourceCurrency: rate.sourceCurrency.toUpperCase(), functionalCurrency: rate.functionalCurrency.toUpperCase(), rate: Number(rate.rate), source: 'Manual', note: null }, params: firmRateScope }, { onSuccess: () => { refreshRates(); setRate({ ...rate, rate: '' }); setRatePage(1); } }); }} className="mt-5 grid gap-3 sm:grid-cols-5">
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
        <div className="mt-5 divide-y rounded-md border border-border">{ratesQuery.isLoading ? <p className="p-3 text-xs text-muted-foreground">Loading firm schedule…</p> : firmRates.length ? visibleFirmRates.map((item) => <div key={item.id} data-testid={`row-firm-exchange-rate-${item.id}`} className="flex items-center justify-between gap-3 p-3 text-xs"><span><strong>{item.sourceCurrency} → {item.functionalCurrency}</strong> · {item.rate} · {shortDate(item.effectiveDate)}</span><button onClick={() => deleteRate.mutate({ id: item.id }, { onSuccess: () => { refreshRates(); notify.success(`${item.sourceCurrency} → ${item.functionalCurrency} removed`); } })} className="text-destructive">Remove</button></div>) : <p className="p-3 text-xs text-muted-foreground">No shared rates yet.</p>}</div>
        {firmRates.length > FIRM_RATE_PAGE_SIZE && <div data-testid="pagination-firm-exchange-rates" className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span>Showing {(currentFirmRatePage - 1) * FIRM_RATE_PAGE_SIZE + 1}–{Math.min(currentFirmRatePage * FIRM_RATE_PAGE_SIZE, firmRates.length)} of {firmRates.length} rates</span>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Previous exchange-rate page" onClick={() => setRatePage((page) => Math.max(1, page - 1))} disabled={currentFirmRatePage === 1} className="rounded border border-border px-2 py-1 font-semibold disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
            <span className="font-mono">Page {currentFirmRatePage} of {firmRatePageCount}</span>
            <button type="button" aria-label="Next exchange-rate page" onClick={() => setRatePage((page) => Math.min(firmRatePageCount, page + 1))} disabled={currentFirmRatePage === firmRatePageCount} className="rounded border border-border px-2 py-1 font-semibold disabled:cursor-not-allowed disabled:opacity-50">Next</button>
          </div>
        </div>}
      </section>
      {orgContext?.firms.length ? <FirmMembersSection firmId={orgContext.firms[0].firmId} members={orgContext.firmMembers.filter((member) => member.firmId === orgContext.firms[0].firmId)} invitations={orgContext.invitations} /> : null}
      {orgContext?.engagements ? <FirmEngagementsSection engagements={orgContext.engagements} /> : null}
      <WorkspaceUsageSection />
      <section className="rounded-lg border border-card-border bg-card p-5 md:p-6"><TeamAccessSection /></section>
    </div>
  </div>;
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

type AgarAccountingUser = {
  id: string;
  externalId?: string | null;
  primaryEmailAddress?: { emailAddress: string } | null;
  firstName: string | null;
  lastName: string | null;
};
function AddClientDialog({ onClose }: { onClose: () => void }) {
  const { setActiveClientId } = useClientWorkspace();
  const orgContext = useOrgContext();
  const mutation = useCreateClient();
  const [form, setForm] = useState({ name: '', legalName: '', functionalCurrency: 'AED', basis: 'IFRS', period: '' });

  const [creationMode, setCreationMode] = useState<'own_company' | 'firm_client'>(
    orgContext?.mode === 'firm' ? 'firm_client' : 'own_company'
  );
  const [firmId, setFirmId] = useState(orgContext?.firms[0]?.firmId ?? 0);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    mutation.mutate({ data: { ...form, creationMode, ...(creationMode === 'firm_client' ? { firmId } : {}) } }, {
      onSuccess: async (client) => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetClientsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetOrganizationContextQueryKey() }),
        ]);
        setActiveClientId(client.id);
        onClose();
        notify.success('Client workspace created', { description: `${client.name} is ready to use.` });
      },
    });
  };

  return <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4 backdrop-blur-sm"><div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border border-card-border bg-card p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="add-client-title"><div className="flex items-start justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Client workspace setup</div><h2 id="add-client-title" className="mt-2 text-lg font-semibold">Add client</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">Create a separate client workspace and set its own reporting context.</p></div><button data-testid="button-close-add-client" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X size={17} /></button></div>

  {orgContext?.mode === 'both' && (
    <div className="mt-5 flex gap-2 border-b border-border">
      <button type="button" onClick={() => setCreationMode('own_company')} className={`pb-2 text-sm font-semibold ${creationMode === 'own_company' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'}`}>Own Company</button>
      <button type="button" onClick={() => setCreationMode('firm_client')} className={`pb-2 ml-4 text-sm font-semibold ${creationMode === 'firm_client' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'}`}>Firm Client</button>
    </div>
  )}

  {creationMode === 'firm_client' && (
    <div className="mt-4 rounded border border-[#f59e0b]/30 bg-[#f59e0b]/10 p-3 text-[11px] leading-5 text-[#d97706]">
      <strong>Provisional Control:</strong> This company is created under firm control. The firm is liable for subscription costs until ownership is successfully transferred to the client.
      <label className="mt-3 block">Accounting firm<select required value={firmId} onChange={(event) => setFirmId(Number(event.target.value))} className="mt-1 h-9 w-full rounded border border-input bg-background px-2 text-xs text-foreground">{orgContext?.firms.map((firm) => <option key={firm.firmId} value={firm.firmId}>{firm.firmName}</option>)}</select></label>
    </div>
  )}

  <form onSubmit={submit} className="mt-6 space-y-4"><label className="block text-xs font-medium">Client name<input data-testid="input-client-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Northstar Advisory" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Legal name<input data-testid="input-client-legal-name" required value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} placeholder="e.g. Northstar Advisory FZ-LLC" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Functional currency<select data-testid="select-client-currency" required value={form.functionalCurrency} onChange={(event) => setForm({ ...form, functionalCurrency: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 py-0 text-sm outline-none focus:border-primary"><option value="AED">AED — UAE dirham</option><option value="USD">USD — US dollar</option><option value="EUR">EUR — euro</option><option value="GBP">GBP — pound sterling</option></select></label><label className="block text-xs font-medium">Reporting basis<select data-testid="select-client-basis" required value={form.basis} onChange={(event) => setForm({ ...form, basis: event.target.value })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 py-0 text-sm outline-none focus:border-primary"><option value="IFRS">IFRS</option><option value="IFRS for SMEs">IFRS for SMEs</option></select></label><label className="block text-xs font-medium">Close period<input data-testid="input-client-period" type="month" required value={periodToMonthInput(form.period)} onChange={(event) => setForm({ ...form, period: monthInputToPeriod(event.target.value) })} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label>{mutation.isError && <p className="text-xs text-destructive">This client could not be created. Check the details and try again.</p>}<button data-testid="button-submit-client" disabled={mutation.isPending} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-50">{mutation.isPending ? 'Creating workspace…' : <><Plus size={14} /> Create client workspace</>}</button></form></div></div>;
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
  const [deliveryMessage, setDeliveryMessage] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetWorkspaceMembersQueryKey() });
  const toggle = (id: number) => setForm((current) => ({ ...current, clientIds: current.clientIds.includes(id) ? current.clientIds.filter((item) => item !== id) : [...current.clientIds, id] }));
  const toggleMemberClient = (member: WorkspaceMember, clientId: number) => {
    if (member.role === 'owner') return;
    const clientIds = member.clients.some((client) => client.id === clientId)
      ? member.clients.filter((client) => client.id !== clientId).map((client) => client.id)
      : [...member.clients.map((client) => client.id), clientId];
    updateMember.mutate({ userId: member.userId, data: { role: member.role, clientIds } }, { onSuccess: () => { refresh(); notify.success('Client access updated', { description: `${member.name}'s access was saved.` }); } });
  };
  const data = team.data;
  return <section data-testid="card-settings-users" className="mt-8 border-t border-border pt-6">
    <div className="flex items-start gap-3"><Users className="text-primary" size={18} /><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Users & permissions</div><h3 className="mt-1 text-sm font-semibold">Teammate access</h3><p className="mt-1 text-[11px] text-muted-foreground">Roles and client access are enforced for this workspace.</p></div></div>
    {team.isLoading ? <p className="mt-4 text-xs text-muted-foreground">Loading team access…</p> : team.isError ? <p className="mt-4 text-xs text-destructive">Team access could not be loaded.</p> : <>
      <div className="mt-4 divide-y rounded border border-border">{data?.members.map((member: WorkspaceMember) => <div key={member.userId} data-testid={`row-workspace-member-${member.userId}`} className="flex flex-wrap items-center justify-between gap-3 p-3 text-xs">
        <div><strong>{member.name}</strong> · {member.role}<div className="mt-2 flex flex-wrap gap-3 text-[11px]">{data?.canManage && !member.isCurrentUser ? data.clients.map((client) => <label key={client.id}><input data-testid={`checkbox-member-client-${member.userId}-${client.id}`} type="checkbox" checked={member.clients.some((assigned) => assigned.id === client.id)} disabled={updateMember.isPending} onChange={() => toggleMemberClient(member, client.id)} /> {client.name}</label>) : member.clients.map((client) => <span key={client.id}>{client.name}</span>)}</div></div>
        {data?.canManage && !member.isCurrentUser && member.role !== 'owner' && <span className="flex gap-2"><select value={member.role} disabled={updateMember.isPending} onChange={(event) => { const newRole = event.target.value as 'admin' | 'bookkeeper'; updateMember.mutate({ userId: member.userId, data: { role: newRole, clientIds: member.clients.map((client) => client.id) } }, { onSuccess: () => { refresh(); notify.success('Role updated', { description: `${member.name} is now ${newRole}.` }); } }); }} className="rounded border border-input bg-card px-1 text-[11px]"><option value="admin">Admin</option><option value="bookkeeper">Bookkeeper</option></select><button data-testid={`button-remove-member-${member.userId}`} onClick={() => removeMember.mutate({ userId: member.userId }, { onSuccess: () => { refresh(); notify.success(`${member.name} removed from workspace`); } })} className="text-destructive"><Trash2 size={14} /></button></span>}
      </div>)}</div>
      {data?.canManage && <form onSubmit={(event) => {
        event.preventDefault();
        const invitedEmail = form.email;
        setDeliveryMessage('');
        setLink('');
        invite.mutate({ data: form }, {
          onSuccess: (result) => {
            setLink(result.inviteLink ?? '');
            setDeliveryMessage(`Invitation sent to ${result.email}.`);
            setForm((current) => ({ ...current, email: '' }));
            refresh();
            notify.success('Invitation sent', { description: `Email delivered to ${invitedEmail}.` });
          },
        });
      }} className="mt-4 rounded border border-primary/20 bg-primary/5 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold"><UserPlus size={14} /> Invite teammate</div>
        <div className="mt-3 flex flex-wrap gap-2"><input data-testid="input-invite-email" required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="teammate@firm.com" className="h-8 flex-1 rounded border border-input bg-card px-2 text-xs" /><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as 'admin' | 'bookkeeper' })} className="h-8 rounded border border-input bg-card px-2 text-xs"><option value="bookkeeper">Bookkeeper</option><option value="admin">Admin</option></select></div>
        <div className="mt-3 flex flex-wrap gap-3">{data.clients.map((client) => <label key={client.id} className="text-[11px]"><input data-testid={`checkbox-invite-client-${client.id}`} type="checkbox" checked={form.clientIds.includes(client.id)} onChange={() => toggle(client.id)} /> {client.name}</label>)}</div>
        <button data-testid="button-invite-teammate" disabled={invite.isPending || !form.clientIds.length} className="mt-3 inline-flex items-center gap-1.5 rounded bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground disabled:opacity-50">{invite.isPending ? 'Sending invitation…' : <><Mail size={13} /> Send invitation</>}</button>
        {deliveryMessage && <p data-testid="status-invite-sent" className="mt-2 inline-flex items-center gap-1 text-[10px] text-primary"><Check size={12} /> {deliveryMessage}</p>}
        {link && <><input data-testid="input-invite-link" readOnly value={link} className="mt-3 h-8 w-full rounded border border-input bg-card px-2 font-mono text-[10px]" /><p className="mt-2 text-[10px] leading-4 text-muted-foreground">Resend uses a new secure link each time. This link is also included in the email.</p></>}
        {invite.isError && <p data-testid="status-invite-error" className="mt-2 text-[10px] text-destructive">The invitation was not sent. Check the email delivery configuration and try again.</p>}
      </form>}
      {data?.canManage && data.invitations.map((invitation) => <div key={invitation.id} data-testid={`row-workspace-invitation-${invitation.id}`} className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2 text-[11px]"><span>{invitation.email} · {invitation.role} · {invitation.status}<small className="ml-2 text-muted-foreground">expires {shortDate(invitation.expiresAt)}</small></span>{invitation.status === 'pending' && <span className="flex gap-3"><button data-testid={`button-resend-invitation-${invitation.id}`} disabled={resend.isPending || revoke.isPending} onClick={() => { setDeliveryMessage(''); setLink(''); resend.mutate({ id: invitation.id }, { onSuccess: (result) => { setLink(result.inviteLink ?? ''); setDeliveryMessage(`Invitation resent to ${result.email}.`); refresh(); notify.success('Invitation resent', { description: `Email delivered to ${invitation.email}.` }); } }); }} className="inline-flex items-center gap-1 text-primary disabled:opacity-50"><RotateCw size={12} /> {resend.isPending ? 'Sending…' : 'Resend email'}</button><button data-testid={`button-revoke-invitation-${invitation.id}`} disabled={revoke.isPending} onClick={() => revoke.mutate({ id: invitation.id }, { onSuccess: () => { refresh(); notify.success(`Invitation to ${invitation.email} revoked`); } })} className="text-destructive disabled:opacity-50">Revoke</button></span>}</div>)}
      {resend.isError && <p data-testid="status-resend-invitation-error" className="mt-2 text-[10px] text-destructive">The invitation email was not sent. Its secure link was rotated; resend again to retry delivery.</p>}
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
    systemRatesEnabled: client.systemRatesEnabled,
  });
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    mutation.mutate({ id: client.id, data: form }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetClientsQueryKey() });
        onClose();
        notify.success('Workspace settings saved');
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
    ['01', 'Import evidence', 'Upload a PDF, CSV, XLS, or XLSX statement. AgarAccounting AI turns it into reviewable bank lines.'],
    ['02', 'Review drafts', 'Expand a line to inspect the proposed debit and credit accounts. AI-prepared drafts stay outside live reports.'],
    ['03', 'Post when ready', 'Post only after the journal entry makes sense. Posted entries flow into the trial balance and statements.'],
  ];
  return <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-lg border border-card-border bg-card p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="help-title"><div className="flex items-start justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">AgarAccounting AI System guide</div><h2 id="help-title" className="mt-2 text-lg font-semibold">How the review desk works</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">AgarAccounting AI prepares drafts; only your explicit posting confirmation moves them into live reports.</p></div><button data-testid="button-close-help" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X size={17} /></button></div><div className="mt-6 space-y-3">{steps.map(([number, title, description]) => <div key={number} className="flex gap-3 rounded-md border border-border bg-muted/20 p-3"><div className="font-mono text-[10px] text-primary">{number}</div><div><div className="text-xs font-semibold">{title}</div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{description}</p></div></div>)}</div><div className="mt-5 rounded-md border border-accent/25 bg-accent/10 p-3 text-[11px] leading-5 text-accent-foreground"><strong className="font-semibold">Need a quick answer?</strong> Open AgarAccounting AI from the sparkle button to ask about the selected client’s queue, entries, or reports.</div></div></div>;
}

function AuthLoadingState({ label = 'Checking your AgarAccounting AI System session' }: { label?: string }) {
  return <div className="grid min-h-[100dvh] place-items-center bg-background px-5"><div className="flex items-center gap-3 rounded-lg border border-card-border bg-card px-5 py-4 text-sm shadow-sm" role="status" aria-live="polite"><LoaderCircle className="animate-spin text-primary" size={18} /><span>{label}…</span></div></div>;
}
function StatementAnalysisBanner() {
  const { activeClient } = useClientWorkspace();
  const clientId = activeClient?.id ?? 0;
  const importsQuery = useGetStatementImports({ clientId }, {
    query: {
      queryKey: getGetStatementImportsQueryKey({ clientId }),
      enabled: Boolean(activeClient),
      refetchInterval: (query) => {
        const imports = query.state.data as StatementImport[] | undefined;
        return imports?.some((statementImport) => statementImport.outcome === 'analyzing') ? 2500 : false;
      },
    },
  });
  const imports = importsQuery.data ?? [];
  const analyzing = imports.find((statementImport) => statementImport.outcome === 'analyzing');
  const ready = imports.find((statementImport) => statementImport.outcome === 'pending_confirmation' && statementImport.preview);
  const recentFailure = imports.find((statementImport) => statementImport.outcome === 'failed'
    && Date.now() - new Date(statementImport.updatedAt).getTime() < 24 * 60 * 60 * 1000);
  const current = analyzing ?? ready ?? recentFailure;
  if (!current) return null;
  const isAnalyzing = current.outcome === 'analyzing';
  const isReady = current.outcome === 'pending_confirmation';
  return <div data-testid="statement-analysis-banner" role="status" aria-live="polite" className={`border-b px-4 py-2.5 md:px-8 ${isReady ? 'border-primary/20 bg-primary/5' : isAnalyzing ? 'border-accent/25 bg-accent/10' : 'border-destructive/20 bg-destructive/5'}`}>
    <div className="mx-auto flex max-w-[1500px] flex-col gap-2 text-xs sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2.5">
        {isAnalyzing ? <LoaderCircle size={14} className="shrink-0 animate-spin text-accent-foreground" /> : isReady ? <CircleCheck size={14} className="shrink-0 text-primary" /> : <CircleAlert size={14} className="shrink-0 text-destructive" />}
        <div className="min-w-0"><span className="font-semibold">{isAnalyzing ? 'Statement analysis is running in the background.' : isReady ? 'Statement analysis is ready for review.' : 'Statement analysis needs attention.'}</span> <span className="text-muted-foreground">{current.fileName}{isAnalyzing ? ' — you can keep working.' : ''}</span></div>
      </div>
      <Link data-testid="link-open-statement-analysis" href="/import-statement" className="shrink-0 font-semibold text-primary underline underline-offset-2">{isAnalyzing ? 'View progress' : isReady ? 'Review statement' : 'Review and retry'}</Link>
    </div>
  </div>;
}
function Shell({ children, user, onLogout }: { children: React.ReactNode; user: AgarAccountingUser; onLogout: () => void }) {
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
  const clientVisitStorageKey = `agaraccounting:frequent-clients:${user.externalId ?? user.id}`;
  const [clientVisitHistory, setClientVisitHistory] = useState<Array<{ id: number; count: number; lastVisited: number }>>(() => {
    try {
      const stored = window.localStorage.getItem(clientVisitStorageKey);
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? parsed.filter((entry): entry is { id: number; count: number; lastVisited: number } => (
        entry && Number.isInteger(entry.id) && entry.id > 0 && Number.isFinite(entry.count) && Number.isFinite(entry.lastVisited)
      )) : [];
    } catch {
      return [];
    }
  });
  const [showAllClients, setShowAllClients] = useState(false);
  const rankedClients = useMemo(() => {
    const visitByClient = new Map(clientVisitHistory.map((entry) => [entry.id, entry]));
    return [...clients].sort((left, right) => {
      const leftVisit = visitByClient.get(left.id);
      const rightVisit = visitByClient.get(right.id);
      if (leftVisit && rightVisit) return rightVisit.count - leftVisit.count || rightVisit.lastVisited - leftVisit.lastVisited;
      if (leftVisit) return -1;
      if (rightVisit) return 1;
      return 0;
    });
  }, [clients, clientVisitHistory]);
  const frequentClients = useMemo(() => {
    const topClients = rankedClients.slice(0, 5);
    if (activeClient && !topClients.some((client) => client.id === activeClient.id)) {
      return [activeClient, ...topClients.slice(0, 4)];
    }
    return topClients;
  }, [activeClient, rankedClients]);
  const visibleClients = showAllClients ? rankedClients : frequentClients;
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
  useEffect(() => {
    if (!accountMenuOpen) setShowAllClients(false);
  }, [accountMenuOpen]);
  useEffect(() => {
    if (!activeClient) return;
    setClientVisitHistory((currentHistory) => {
      const existing = currentHistory.find((entry) => entry.id === activeClient.id);
      const nextHistory = [
        ...currentHistory.filter((entry) => entry.id !== activeClient.id),
        { id: activeClient.id, count: (existing?.count ?? 0) + 1, lastVisited: Date.now() },
      ].sort((left, right) => right.count - left.count || right.lastVisited - left.lastVisited).slice(0, 50);
      window.localStorage.setItem(clientVisitStorageKey, JSON.stringify(nextHistory));
      return nextHistory;
    });
  }, [activeClient?.id, clientVisitStorageKey]);
  return <AssistantPageContextProvider><div className="min-h-[100dvh] bg-background">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-300 md:translate-x-0 ${collapsed ? 'md:w-[76px]' : ''} ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex h-[78px] items-center border-b border-sidebar-border px-5"><div className="flex min-w-0 items-center gap-3"><div className="grid size-9 shrink-0 place-items-center"><img src={brandMarkUrl} alt="" className="size-9 rounded-lg" /></div><div className={`${collapsed ? 'md:hidden' : ''}`}><div className="font-display text-[18px] leading-none tracking-tight text-sidebar-foreground">AgarAccounting AI</div><div className="mt-1 font-mono text-[9px] uppercase tracking-[.2em] text-sidebar-foreground/50">Review desk</div></div></div><button aria-label="Close navigation" data-testid="button-close-navigation" className="ml-auto rounded-md p-1.5 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground md:hidden" onClick={() => setMobileOpen(false)}><X size={17} /></button></div>
      <div className={`px-3 pt-6 ${collapsed ? 'md:px-2' : ''}`}><div className={`mb-3 px-3 font-mono text-[9px] font-medium uppercase tracking-[.18em] text-sidebar-foreground/40 ${collapsed ? 'md:hidden' : ''}`}>Workspace</div><nav className="space-y-1">{nav.map(({ href, label, icon: Icon }) => { const active = href === '/' ? location === '/' : location.startsWith(href); return <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`} onClick={() => setMobileOpen(false)} className={`group flex items-center gap-3 rounded-md px-3 py-2.5 text-[13px] font-medium transition-colors ${active ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground'} ${collapsed ? 'md:justify-center md:px-0' : ''}`}><Icon size={17} strokeWidth={active ? 2.2 : 1.8} /><span className={collapsed ? 'md:hidden' : ''}>{label}</span>{active && !collapsed && <ChevronRight className="ml-auto" size={14} />}</Link>; })}</nav></div>
       <div className={`mt-auto border-t border-sidebar-border p-4 ${collapsed ? 'md:px-2' : ''}`}><div className={`rounded-md border border-sidebar-border bg-sidebar-accent/40 p-3 ${collapsed ? 'md:hidden' : ''}`}><div className="flex items-center gap-2 text-[11px] font-semibold"><span className="size-1.5 rounded-full bg-sidebar-primary" /> {activeClient?.name ?? 'Client workspace'}</div><div className="mt-2 flex items-center justify-between font-mono text-[10px] text-sidebar-foreground/55"><span>{activeClient ? `${activeClient.basis} / ${activeClient.functionalCurrency}` : '—'}</span><span>{activeClient?.ownershipStatus === 'firm_provisional' ? 'Firm Provisional' : activeClient?.ownershipStatus === 'company_owned' ? 'Company Owned' : activeClient?.period ?? '—'}</span></div></div></div>
    </aside>
       <div className={`min-h-[100dvh] transition-[padding] duration-300 ${collapsed ? 'md:pl-[76px]' : 'md:pl-[248px]'}`}>
         <header className="sticky top-0 z-30 flex h-[78px] items-center justify-between border-b border-border/80 bg-background/90 px-4 backdrop-blur-md md:px-8">
           <div className="flex items-center gap-3">
             <button data-testid="button-mobile-menu" aria-label="Open navigation" className="rounded-md p-2 hover:bg-muted md:hidden" onClick={() => setMobileOpen(true)}><Menu size={19} /></button>
             <button data-testid="button-collapse-sidebar" aria-label="Toggle sidebar" className="hidden rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground md:block" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
             <div className="hidden h-5 w-px bg-border md:block" />
             <div><div className="font-mono text-[9px] uppercase tracking-[.18em] text-muted-foreground">{activeClient?.name ?? 'Client'} / IFRS close</div><div className="mt-0.5 text-[13px] font-semibold">{current}</div></div>
           </div>
           <div className="flex items-center gap-2 md:gap-3">
             <div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground lg:flex"><span className="size-1.5 rounded-full bg-primary" /> Books are in balance</div>
             <button data-testid="button-help" onClick={() => setHelpOpen(true)} aria-label="Open help" className="grid size-8 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"><CircleHelp size={16} /></button>
             <div ref={accountMenuRef} className="relative">
               <button data-testid="button-account-menu" type="button" onClick={() => setAccountMenuOpen((open) => !open)} aria-haspopup="menu" aria-expanded={accountMenuOpen} aria-label={`Open account menu for ${displayName}`} className="group flex items-center gap-2 rounded-full border border-border bg-card pl-1 pr-2.5 py-1 text-left hover:border-primary/40"><span className="grid size-7 place-items-center rounded-full bg-primary font-mono text-[10px] font-medium text-primary-foreground">{initials}</span><span className="hidden max-w-[120px] truncate text-[11px] font-semibold sm:inline">{displayName}</span><ChevronDown size={13} className={`text-muted-foreground transition-transform ${accountMenuOpen ? 'rotate-180' : ''}`} /></button>
               {accountMenuOpen && <div role="menu" aria-label="Account menu" className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-1.5 shadow-xl">
                 <div className="border-b border-border px-3 py-2.5"><div className="truncate text-xs font-semibold">{displayName}</div><div className="mt-0.5 truncate text-[10px] text-muted-foreground">{user.primaryEmailAddress?.emailAddress ?? 'Account owner'}</div></div>
                 <div className="border-b border-border px-3 py-3">
                   <div className="flex items-center justify-between"><div className="text-[10px] font-mono uppercase tracking-[.14em] text-muted-foreground">{showAllClients ? 'All client workspaces' : 'Frequent clients'}</div><div className="text-[10px] text-muted-foreground">{clients.length} total</div></div>
                   <div className={`mt-2 space-y-1 ${showAllClients ? 'max-h-56 overflow-y-auto pr-1' : ''}`} role="group" aria-label={showAllClients ? 'All clients' : 'Frequently visited clients'}>
                     {visibleClients.map((client) => <button key={client.id} data-testid={`button-client-workspace-${client.id}`} type="button" role="menuitemradio" aria-checked={activeClient?.id === client.id} onClick={() => { setActiveClientId(client.id); setAccountMenuOpen(false); }} className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs transition-colors ${activeClient?.id === client.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><span className="min-w-0 truncate font-semibold">{client.name}</span><span className="ml-2 shrink-0 font-mono text-[9px] text-muted-foreground">{client.functionalCurrency}</span></button>)}
                   </div>
                   {clients.length > 5 && <button data-testid="button-view-all-clients" type="button" onClick={() => setShowAllClients((visible) => !visible)} className="mt-2 w-full rounded-md px-2.5 py-1.5 text-left text-[11px] font-semibold text-primary hover:bg-secondary">{showAllClients ? 'Show frequent clients' : `View all ${clients.length} clients`}</button>}
                   <button data-testid="button-add-client" type="button" onClick={() => { setCreateClientOpen(true); setAccountMenuOpen(false); }} className="mt-2 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"><Plus size={14} />Add client</button>
                 </div>
                 <Link data-testid="link-firm-settings-account-menu" href="/firm-settings" role="menuitem" onClick={() => setAccountMenuOpen(false)} className="mt-1 flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted"><Users size={14} className="text-primary" /> Firm settings</Link>
                 <Link data-testid="link-feedback-account-menu" href="/feedback" role="menuitem" onClick={() => setAccountMenuOpen(false)} className="mt-0.5 flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted"><MessageSquarePlus size={14} className="text-primary" /> Feedback & reviews</Link>
                 <button data-testid="button-logout" type="button" role="menuitem" onClick={onLogout} className="mt-0.5 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"><LogOut size={14} /> Sign out</button>
               </div>}
             </div>
           </div>
         </header>
          <StatementAnalysisBanner />
         <main className="mx-auto max-w-[1500px] px-4 py-7 md:px-8 lg:px-10"><div className="page-enter">{children}</div></main>
         {createClientOpen && <AddClientDialog onClose={() => setCreateClientOpen(false)} />}
         {settingsOpen && activeClient && <WorkspaceSettingsDialog client={activeClient} onClose={() => setSettingsOpen(false)} />}
         {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
       </div>
     {settingsOpen && <div className="fixed inset-0 z-[60] overflow-y-auto bg-foreground/35 p-4 backdrop-blur-sm"><div className="mx-auto my-5 w-full max-w-3xl rounded-lg border border-card-border bg-card p-6 shadow-2xl"><div className="flex justify-end"><button data-testid="button-close-team-settings" onClick={() => setSettingsOpen(false)} className="text-xs text-muted-foreground">Close</button></div><TeamAccessSection /><WorkspaceUsageSection /></div></div>}
     <AssistantFAB />
  </div></AssistantPageContextProvider>;
}

function LoadingRows({ count = 4, cols = 4 }: { count?: number; cols?: number }) {
  return <div className="space-y-2" data-testid="state-loading">{Array.from({ length: count }).map((_, row) => <div key={row} className="flex gap-4 rounded-md border border-border/50 bg-card/60 p-4">{Array.from({ length: cols }).map((__, col) => <div key={col} className={`skeleton h-3 rounded ${col === 0 ? 'w-1/4' : 'w-1/6'}`} />)}</div>)}</div>;
}
function QueryState({ loading, error, empty, children, onRetry, filtered, onClearFilters }: { loading: boolean; error: boolean; empty: boolean; children: React.ReactNode; onRetry: () => void; filtered?: boolean; onClearFilters?: () => void }) {
  if (loading) return <LoadingRows />;
  if (error) return <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-14 text-center" data-testid="state-error"><CircleAlert className="mb-3 text-destructive" size={23} /><h3 className="text-sm font-semibold">We couldn't load this view</h3><p className="mt-1 max-w-sm text-xs text-muted-foreground">The ledger service did not return a usable response. Your work is safe.</p><button data-testid="button-retry" onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-md bg-card px-3 py-2 text-xs font-semibold shadow-sm hover:bg-muted"><RefreshCw size={13} /> Try again</button></div>;
  if (empty && filtered) return <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 py-14 text-center" data-testid="state-empty-filtered"><div className="mb-3 grid size-10 place-items-center rounded-full bg-secondary text-primary"><Filter size={18} /></div><h3 className="text-sm font-semibold">No lines match your filters</h3><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Nothing in this view fits the current search and filters. Loosen or clear them to see more.</p>{onClearFilters && <button data-testid="button-clear-filters-empty-state" type="button" onClick={onClearFilters} className="mt-4 inline-flex items-center gap-2 rounded-md bg-card px-3 py-2 text-xs font-semibold shadow-sm hover:bg-muted"><X size={13} /> Clear filters</button>}</div>;
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
  const changeBasis = (value: 'IFRS' | 'IFRS for SMEs') => { setSelectedBasis(value); const profile = value === 'IFRS for SMEs' ? 'IFRS for SMEs' : 'IAS 1'; setSelectedProfile(profile); window.dispatchEvent(new CustomEvent('agaraccounting:report-profile', { detail: { basis: value, profile } })); };
  return <div className="mb-5 rounded-lg border border-card-border bg-card p-4"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Presentation profile</div><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-[11px] font-semibold">Reporting basis<select data-testid="select-reporting-basis" value={selectedBasis} onChange={(event) => changeBasis(event.target.value as typeof selectedBasis)} className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary"><option value="IFRS" disabled={basis !== 'IFRS'}>Full IFRS</option><option value="IFRS for SMEs" disabled={basis !== 'IFRS for SMEs'}>IFRS for SMEs</option></select></label><label className="text-[11px] font-semibold">Format<select data-testid="select-presentation-profile" value={selectedProfile} onChange={(event) => { const profile = event.target.value as typeof selectedProfile; setSelectedProfile(profile); window.dispatchEvent(new CustomEvent('agaraccounting:report-profile', { detail: { basis: selectedBasis, profile } })); }} className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary"><option value="IAS 1">IAS 1</option>{ifrs18Eligible && <option value="IFRS 18">IFRS 18 (2027+)</option>}<option value="IFRS for SMEs" disabled={selectedBasis !== 'IFRS for SMEs'}>IFRS for SMEs</option></select></label></div><p className="mt-2 text-[10px] text-muted-foreground">Only the basis configured for this client is available. IFRS 18 is available for annual periods ending in 2027 or later.</p></div>;
}
function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <>{title === 'Financial statement pack' && <ReportProfileControls />}<div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="font-mono text-[10px] uppercase tracking-[.19em] text-primary">{eyebrow}</div><h1 className="mt-2 font-display text-[34px] leading-none tracking-tight text-foreground md:text-[42px]">{title}</h1><p className="mt-3 max-w-2xl text-[13px] leading-5 text-muted-foreground">{description}</p></div>{action}</div></>;
}
function Metric({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) {
  return <div className={`rounded-lg border p-5 ${accent ? 'border-primary/30 bg-primary text-primary-foreground' : 'border-card-border bg-card'} lift-hover`}><div className={`font-mono text-[10px] uppercase tracking-[.13em] ${accent ? 'text-primary-foreground/65' : 'text-muted-foreground'}`}>{label}</div><div className="mt-3 font-display text-[31px] leading-none">{value}</div><div className={`mt-3 text-[11px] ${accent ? 'text-primary-foreground/65' : 'text-muted-foreground'}`}>{note}</div></div>;
}

function ZeroClientsHome() {
  const orgContext = useOrgContext();
  return <div data-testid="zero-clients-home">
    <PageHeading eyebrow="Welcome to AgarAccounting AI System" title="Your workspace is ready." description={orgContext?.mode === 'firm' ? "Your firm does not have any active bookkeeping clients yet." : "You do not have any companies set up yet."} action={null} />
    <section className="rounded-lg border border-card-border bg-card p-6">
      <div className="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary">
        <Landmark size={21} />
      </div>
      <h2 className="mt-5 font-display text-[29px] leading-none">Start with your first client</h2>
      <p className="mt-3 max-w-2xl text-[13px] leading-6 text-muted-foreground">
        AgarAccounting AI System allows you to manage multiple companies. Add a client workspace to import statements and begin reviewing.
      </p>
      <div className="mt-5">
        <span className="text-sm font-medium">Use the "Add client" button in the navigation bar to begin.</span>
      </div>
    </section>
  </div>;
}

function Home() {
  const { activeClient, clients, setActiveClientId } = useClientWorkspace();
  const { user } = useUser();
  const params = { clientId: activeClient?.id ?? 0 };
  const query = useGetLedgerOverview(params, { query: { queryKey: getGetLedgerOverviewQueryKey(params), enabled: !!activeClient } });
  const [now, setNow] = useState(() => new Date());
  const greetingName = user?.firstName?.trim()
    || user?.fullName?.trim()
    || user?.primaryEmailAddress?.emailAddress?.split("@")[0]
    || "there";
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
  const greeting = dashboardGreeting(now);

  if (!activeClient && clients.length === 0) {
    return <ZeroClientsHome />;
  }

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
  return <div><PageHeading eyebrow={`${dashboardDateLabel(now)} · Close control`} title={`${greeting}, ${greetingName}.`} description="A clear view of what moved, what needs your judgment, and what is ready to stand behind." action={<Link href="/statement-lines" data-testid="link-review-lines" className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5">Review open lines <ArrowRight size={14} /></Link>} /><QueryState loading={query.isLoading} error={query.isError} empty={!overview} onRetry={() => query.refetch()}>{overview && <div className="space-y-6"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Close progress" value={`${overview.completionPercent}%`} note={`${overview.pendingReview} drafts still need review`} accent /><Metric label="Statement lines" value={overview.totalLines.toLocaleString()} note={`${overview.currencies.length} currencies in scope`} /><Metric label="Posted amount" value={money(overview.postedAmount)} note={`Through ${overview.period}`} /><Metric label="Currencies" value={overview.currencies.join(' · ')} note="Active bank feeds" /></div><div className="grid gap-6 xl:grid-cols-[1.35fr_.65fr]"><section className="rounded-lg border border-card-border bg-card p-5 md:p-6"><div className="flex items-start justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Close control / {overview.period}</div><h2 className="mt-2 text-base font-semibold">The desk at a glance</h2></div><span className="rounded-full bg-secondary px-2.5 py-1 font-mono text-[10px] text-primary">Active</span></div><div className="mt-6 flex items-end gap-5"><div className="relative size-[148px] shrink-0 rounded-full" style={{ background: `conic-gradient(hsl(var(--accent)) ${overview.completionPercent}%, hsl(var(--muted)) 0)` }}><div className="absolute inset-[10px] grid place-items-center rounded-full bg-card"><span className="font-display text-[34px]">{overview.completionPercent}<small className="text-lg">%</small></span></div></div><div className="pb-2"><p className="text-sm font-medium leading-6">Your review queue is moving well.</p><p className="mt-1 text-xs leading-5 text-muted-foreground">AgarAccounting AI System has surfaced the evidence beside each draft so the final posting decision stays yours.</p><Link href="/journal-entries" data-testid="link-view-drafts" className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">Inspect draft entries <ChevronRight size={13} /></Link></div></div><div className="mt-7 grid grid-cols-3 border-t border-border pt-4"><div><div className="font-mono text-lg">{overview.pendingReview}</div><div className="mt-1 text-[10px] text-muted-foreground">Drafts</div></div><div><div className="font-mono text-lg">{overview.totalLines - overview.pendingReview}</div><div className="mt-1 text-[10px] text-muted-foreground">Posted lines</div></div><div><div className="font-mono text-lg">{overview.currencies.length}</div><div className="mt-1 text-[10px] text-muted-foreground">Currencies</div></div></div></section><section className="flex flex-col justify-between rounded-lg border border-primary/20 bg-primary/5 p-5 md:p-6"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Assurance model</div><h2 className="mt-2 text-base font-semibold">Ready for audit</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">Every posted journal entry is backed by an append-only transition record and a link to the original bank statement line.</p><p className="mt-2 text-[11px] leading-5 text-muted-foreground">AI prepares drafts but cannot post them or modify the base reports. Post only what you can explain.</p><div className="mt-8 flex items-center gap-2 border-t border-accent/20 pt-4 text-[11px] font-semibold text-accent-foreground"><CircleCheck size={15} /> Evidence attached to every decision</div></div></section></div><section className="rounded-lg border border-card-border bg-card p-5 md:p-6"><div className="flex items-center justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Next actions</div><h2 className="mt-2 text-base font-semibold">Keep the close moving</h2></div><span className="font-mono text-[10px] text-muted-foreground">3 lanes</span></div><div className="mt-5 grid gap-3 md:grid-cols-3"><ActionCard index="01" title="Review statement lines" detail={`${overview.pendingReview} drafts are waiting for a call`} href="/statement-lines" icon={Table2} /><ActionCard index="02" title="Post draft entries" detail="Confirm the postings AgarAccounting AI System prepared" href="/journal-entries" icon={BookOpenCheck} /><ActionCard index="03" title="Check the trial balance" detail="Make sure debits and credits agree" href="/trial-balance" icon={BarChart3} /></div></section></div>}</QueryState></div>;
}

function LegacyDemoWorkspaceHome({ activeClient, legacyDemoWorkspace, cleanWorkspace, onSelectWorkspace }: { activeClient: Client | undefined; legacyDemoWorkspace: Client; cleanWorkspace: Client | undefined; onSelectWorkspace: (id: number) => void }) {
  const viewingLegacyWorkspace = activeClient?.id === legacyDemoWorkspace.id;
  return <div data-testid="legacy-demo-workspace-notice"><PageHeading eyebrow="Workspace restored" title={viewingLegacyWorkspace ? "You are viewing preserved demo data." : "Your clean workspace is ready."} description={viewingLegacyWorkspace ? "This older workspace is retained exactly as it was so no bookkeeping evidence is lost. It is not your active bookkeeping workspace." : "We found an untouched legacy demo workspace from an earlier AgarAccounting AI setup and created this private, empty workspace for your real books."} action={viewingLegacyWorkspace && cleanWorkspace ? <button data-testid="button-return-to-clean-workspace" onClick={() => onSelectWorkspace(cleanWorkspace.id)} className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground">Return to clean workspace <ArrowRight size={14} /></button> : <Link href="/import-statement" data-testid="link-import-clean-workspace" className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground">Import a statement <UploadCloud size={14} /></Link>} /><section className="rounded-lg border border-accent/25 bg-accent/10 p-6 md:p-8"><div className="flex items-start gap-3"><CircleAlert className="mt-0.5 shrink-0 text-accent-foreground" size={20} /><div><h2 className="text-base font-semibold text-accent-foreground">Your previous demo workspace is preserved.</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-accent-foreground/75">No statement lines, journals, uploads, or audit evidence were deleted. {viewingLegacyWorkspace ? "Use the workspace selector to return to your private workspace when you are ready to work with real data." : "You can inspect the preserved workspace at any time; select it below only if you need to review the old demo records."}</p></div></div><div className="mt-6 flex flex-wrap gap-3">{!viewingLegacyWorkspace && <button data-testid="button-view-preserved-demo-workspace" onClick={() => onSelectWorkspace(legacyDemoWorkspace.id)} className="rounded-md border border-accent/30 bg-card px-3 py-2 text-xs font-semibold text-accent-foreground hover:bg-accent/10">View preserved demo workspace</button>}<Link href="/import-statement" className="rounded-md border border-accent/30 bg-card px-3 py-2 text-xs font-semibold text-accent-foreground hover:bg-accent/10">Import real evidence</Link></div></section></div>;
}
function EmptyWorkspaceHome({ workspaceName }: { workspaceName: string }) {
  return <div data-testid="empty-workspace-onboarding"><PageHeading eyebrow="Private workspace" title="Start with your real bookkeeping." description={`${workspaceName} is ready for your first statement. No demo transactions or journal entries have been created.`} action={<Link href="/import-statement" data-testid="link-import-first-statement" className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground">Import a statement <UploadCloud size={14} /></Link>} /><section className="rounded-lg border border-card-border bg-card p-6"><div className="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary"><Landmark size={21} /></div><h2 className="mt-5 font-display text-[29px] leading-none">Your workspace is empty by design.</h2><p className="mt-3 max-w-2xl text-[13px] leading-6 text-muted-foreground">Import a PDF, CSV, XLS, or XLSX bank statement to begin review. AgarAccounting AI System prepares drafts, while you retain control over every posting.</p></section></div>;
}
function ActionCard({ index, title, detail, href, icon: Icon }: { index: string; title: string; detail: string; href: string; icon: typeof Table2 }) {
  return <Link href={href} data-testid={`link-action-${index}`} className="group flex items-start gap-3 rounded-md border border-border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-secondary/40"><div className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-primary"><Icon size={16} /></div><div className="min-w-0"><div className="flex items-center gap-2"><span className="font-mono text-[9px] text-muted-foreground">{index}</span><h3 className="text-[12px] font-semibold">{title}</h3></div><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{detail}</p></div><ArrowRight className="ml-auto mt-1 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" size={14} /></Link>;
}

function ImportActivity({
  stage,
  fileName,
  position,
  total,
  documentKey = fileName ?? 'unknown-document',
}: {
  stage: ImportActivityStage | null;
  fileName?: string;
  position?: number;
  total?: number;
  documentKey?: string;
}) {
  const sequenceKey = stage ? getImportActivitySequenceKey(stage, documentKey) : null;
  const [sequence, setSequence] = useState<ImportActivitySequenceState>(() => ({
    identity: sequenceKey ?? 'inactive',
    index: 0,
  }));

  useEffect(() => {
    if (!sequenceKey || !stage) return;
    setSequence((current) => resetImportActivitySequence(current, sequenceKey));
  }, [sequenceKey, stage]);

  const activity = stage ? importActivityCopy[stage] : null;
  const activeSequence = sequenceKey
    ? resetImportActivitySequence(sequence, sequenceKey)
    : sequence;
  const messageIndex = activeSequence.index;

  useEffect(() => {
    if (!sequenceKey || !activity || messageIndex >= activity.messages.length - 1) return;
    const timeout = window.setTimeout(() => {
      setSequence((current) => {
        const currentSequence = resetImportActivitySequence(current, sequenceKey);
        return advanceImportActivitySequence(currentSequence, activity.messages.length);
      });
    }, IMPORT_ACTIVITY_MESSAGE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [activity, messageIndex, sequenceKey]);

  if (!stage || !activity) return null;
  const message = activity.messages[messageIndex];
  const progressWidth = stage === 'uploading' ? 'w-1/4' : stage === 'analyzing' ? 'w-2/3' : 'w-[92%]';
  return <div data-testid="statement-import-activity" role="status" aria-live="polite" className="mb-5 rounded-md border border-primary/20 bg-primary/5 px-4 py-3">
    <div className="flex items-start gap-3">
      <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><LoaderCircle size={15} className="animate-spin" /></div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-semibold">{activity.title}</div><span className="font-mono text-[9px] uppercase tracking-[.12em] text-primary">{activity.step}</span></div>
        <p data-testid="statement-import-activity-message" className="mt-1 text-[11px] leading-5 text-muted-foreground">{message}</p>
        {fileName && <p className="mt-1 truncate font-mono text-[10px] text-primary/75">{fileName}{position != null && total != null ? ` · Document ${position} of ${total}` : ''}</p>}
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-secondary"><div className={`h-full ${progressWidth} animate-pulse rounded-full bg-primary transition-all duration-700`} /></div>
      </div>
    </div>
  </div>;
}

function reviewedStatementGroups(result: StatementImportResult): Record<string, StatementImportAccountGroupInput> {
  return Object.fromEntries((result.accountGroups ?? []).map((group) => [group.id, {
    id: group.id,
    bankAccountId: group.bankAccount?.id ?? null,
    name: group.identity.name,
    bankName: group.identity.bankName,
    accountNumberLast4: group.identity.accountNumberLast4,
    currency: group.identity.currency,
    lineIds: group.lineIds,
  }]));
}
function ImportStatementPage() {
  const { activeClient } = useClientWorkspace();
  const clientId = activeClient?.id ?? 0;
  const importMutation = useImportStatement();
  const bankAccountsQuery = useGetBankAccounts({ clientId });
  const { uploadFile, isUploading } = useUpload();
  const importsQuery = useGetStatementImports({ clientId }, {
    query: {
      queryKey: getGetStatementImportsQueryKey({ clientId }),
      enabled: Boolean(activeClient),
      refetchInterval: (query) => {
        const imports = query.state.data as StatementImport[] | undefined;
        return imports?.some((statementImport) => statementImport.outcome === 'analyzing') ? 2500 : false;
      },
    },
  });
  const [queue, setQueue] = useState<StatementImportQueueItem<File, StatementImportResult>[]>([]);
  const [preview, setPreview] = useState<{ clientId: number; clientName: string; fileName: string; mimeType: string; objectPath: string; result: StatementImportResult } | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState('');
  const [groupAssignments, setGroupAssignments] = useState<Record<string, StatementImportAccountGroupInput>>({});
  const [message, setMessage] = useState('');
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [activityStage, setActivityStage] = useState<ImportActivityStage | null>(null);
  const [activeQueueIndex, setActiveQueueIndex] = useState<number | null>(null);
  const [dismissedPreviewIds, setDismissedPreviewIds] = useState<Set<number>>(() => {
    try {
      const stored = sessionStorage.getItem('agaraccounting:dismissed-statement-preview-ids');
      return stored ? new Set(JSON.parse(stored) as number[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const activeClientIdRef = useRef(activeClient?.id);

  useEffect(() => {
    activeClientIdRef.current = activeClient?.id;
  }, [activeClient?.id]);
  useEffect(() => {
    try {
      sessionStorage.setItem('agaraccounting:dismissed-statement-preview-ids', JSON.stringify([...dismissedPreviewIds]));
    } catch {
      // sessionStorage unavailable (e.g. private browsing) — dismissal just won't survive navigation
    }
  }, [dismissedPreviewIds]);
  useEffect(() => {
    const pending = importsQuery.data?.find((statementImport) =>
      statementImport.outcome === 'pending_confirmation'
      && statementImport.preview
      && statementImport.objectPath
      && !dismissedPreviewIds.has(statementImport.id));
    if (!pending || !activeClient || preview) return;
    setSelectedCurrency(pending.preview?.detectedCurrency ?? activeClient.functionalCurrency);
    setGroupAssignments(reviewedStatementGroups(pending.preview as StatementImportResult));
    setPreview({
      clientId: activeClient.id,
      clientName: activeClient.name,
      fileName: pending.fileName,
      mimeType: pending.mimeType,
      objectPath: pending.objectPath as string,
      result: pending.preview as StatementImportResult,
    });
    setPreviewIndex(null);
    setQueue((current) => current.map((entry) => entry.result?.importId === pending.id
      ? { ...entry, status: 'ready', result: pending.preview as StatementImportResult }
      : entry));
    setActivityStage(null);
    setActiveQueueIndex(null);
    setIsProcessingQueue(false);
  }, [activeClient, dismissedPreviewIds, importsQuery.data, preview?.result.importId]);

  const addFiles = (selectedFiles: File[]) => {
    if (!selectedFiles.length || !activeClient) return;
    const existingClient = queue[0];
    if (existingClient && existingClient.clientId !== activeClient.id) {
      setMessage(`These files are assigned to ${existingClient.clientName}. Discard that queue or switch back before selecting files for ${activeClient.name}.`);
      return;
    }
    setQueue((current) => appendUniqueStatementFiles(current, selectedFiles, activeClient));
    setMessage('');
  };

  function continueQueue(currentIndex: number) {
    const nextIndex = findNextStatementQueueIndex(queue, currentIndex);
    if (nextIndex < 0) {
      setIsProcessingQueue(false);
      return;
    }
    window.setTimeout(() => {
      void analyzeQueueItem(nextIndex);
    }, 0);
  }

  async function analyzeQueueItem(index: number) {
    const item = queue[index];
    if (!item || !activeClient) return;
    if (activeClientIdRef.current !== item.clientId) {
      setMessage(`This statement queue belongs to ${item.clientName}. Switch back to that client before continuing.`);
      setIsProcessingQueue(false);
      return;
    }
    const file = item.file;
    setIsProcessingQueue(true);
    setActiveQueueIndex(index);
    setActivityStage('uploading');
    setMessage('');
    setQueue((current) => current.map((entry, entryIndex) => entryIndex === index
      ? { ...entry, status: 'analyzing', message: undefined }
      : entry));
    try {
      if (file.size > MAX_IMPORT_FILE_SIZE) {
        throw new Error('Statement file is too large. Please choose a file no larger than 50 MB.');
      }
      const uploaded = await uploadFile(file, { clientId: item.clientId });
      if (!uploaded) throw new Error('The private statement upload did not complete. Please try again.');
      setActivityStage('analyzing');
      const result = await importMutation.mutateAsync({
        data: {
          clientId: item.clientId,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          objectPath: uploaded.objectPath,
          confirmed: false,
          background: true,
        },
      });
      if (result.importStatus === 'analyzing') {
        setQueue((current) => current.map((entry, entryIndex) => entryIndex === index
          ? { ...entry, status: 'analyzing', message: result.message, result }
          : entry));
        setMessage(result.message ?? 'Statement analysis is continuing in the background. You can leave this page and keep working.');
        void queryClient.invalidateQueries({ queryKey: getGetStatementImportsQueryKey({ clientId: item.clientId }) });
        setIsProcessingQueue(false);
        setActivityStage(null);
        setActiveQueueIndex(null);
        continueQueue(index);
        return;
      }
      if (result.importStatus !== 'preview') {
        setQueue((current) => current.map((entry, entryIndex) => entryIndex === index
          ? { ...entry, status: 'loaded', message: result.message ?? 'This statement was not loaded again.', result }
          : entry));
        setMessage(result.message ?? 'This statement was not loaded again.');
        setActivityStage(null);
        setActiveQueueIndex(null);
        continueQueue(index);
        return;
      }
      setSelectedCurrency(result.detectedCurrency ?? item.functionalCurrency);
      setGroupAssignments(reviewedStatementGroups(result));
      setPreview({ clientId: item.clientId, clientName: item.clientName, fileName: file.name, mimeType: file.type || 'application/octet-stream', objectPath: uploaded.objectPath, result });
      setPreviewIndex(index);
      setQueue((current) => current.map((entry, entryIndex) => entryIndex === index
        ? { ...entry, status: 'ready', result }
        : entry));
      void queryClient.invalidateQueries({ queryKey: getGetStatementImportsQueryKey({ clientId: item.clientId }) });
      setIsProcessingQueue(false);
      setActivityStage(null);
      setActiveQueueIndex(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Statement preview failed.';
      setQueue((current) => current.map((entry, entryIndex) => entryIndex === index
        ? { ...entry, status: 'failed', message: errorMessage }
        : entry));
      setMessage(errorMessage);
      setIsProcessingQueue(false);
      setActivityStage(null);
      setActiveQueueIndex(null);
    }
  }

  const startQueue = () => {
    const firstQueued = findNextStatementQueueIndex(queue, -1, true);
    const item = firstQueued >= 0 ? queue[firstQueued] : undefined;
    if (item && activeClient?.id !== item.clientId) {
      setMessage(`This statement queue belongs to ${item.clientName}. Switch back to that client before analyzing it.`);
      return;
    }
    if (firstQueued >= 0) void analyzeQueueItem(firstQueued);
  };

  const confirmImport = async () => {
    if (!preview || !activeClient || (!selectedCurrency && !(preview.result.accountGroups?.length))) return;
    if (activeClient.id !== preview.clientId) {
      setMessage(`This preview belongs to ${preview.clientName}. Switch back to that client before loading any transactions.`);
      return;
    }
    const currentIndex = previewIndex;
    setMessage('');
    setActiveQueueIndex(currentIndex);
    setActivityStage('confirming');
    try {
      const result = await importMutation.mutateAsync({
        data: {
          importId: preview.result.importId,
          clientId: preview.clientId,
          fileName: preview.fileName,
          mimeType: preview.mimeType,
          objectPath: preview.objectPath,
          currency: selectedCurrency,
          accountGroups: (preview.result.accountGroups?.length ?? 0) > 1 ? Object.values(groupAssignments) : undefined,
          confirmed: true,
        },
      });
      setDismissedPreviewIds((current) => new Set(current).add(preview.result.importId));
      setPreview(null);
      setPreviewIndex(null);
      setMessage(result.message ?? `${result.importedCount} statement lines are ready for review.`);
      if (currentIndex != null) {
        setQueue((current) => current.map((entry, entryIndex) => entryIndex === currentIndex
          ? { ...entry, status: 'loaded', message: result.message ?? `${result.importedCount} statement lines are ready for review.`, result }
          : entry));
      }
      setActivityStage(null);
      setActiveQueueIndex(null);
      queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey({ clientId: preview.clientId }) });
      queryClient.invalidateQueries({ queryKey: getGetLedgerOverviewQueryKey({ clientId: preview.clientId }) });
      queryClient.invalidateQueries({ queryKey: getGetStatementImportsQueryKey({ clientId: preview.clientId }) });
      if (currentIndex != null) continueQueue(currentIndex);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Statement import failed.');
      setActivityStage(null);
      setActiveQueueIndex(null);
    }
  };

  const skipPreview = () => {
    if (!preview) return;
    const currentIndex = previewIndex;
    setDismissedPreviewIds((current) => new Set(current).add(preview.result.importId));
    setPreview(null);
    setGroupAssignments({});
    setPreviewIndex(null);
    if (currentIndex != null) {
      setQueue((current) => current.map((entry, entryIndex) => entryIndex === currentIndex
        ? { ...entry, status: 'skipped', message: 'Saved in Import history for later currency confirmation.' }
        : entry));
    }
    setMessage('This statement remains in Import history for later currency confirmation. Nothing was loaded into review.');
    if (currentIndex != null) continueQueue(currentIndex);
  };

  if (preview) {
    const hasGroupedAccounts = (preview.result.accountGroups?.length ?? 0) > 1;
    const isCurrencyUncertain = !preview.result.detectedCurrency && !hasGroupedAccounts;
    const isWrongClient = activeClient?.id !== preview.clientId;
    const hasUnassignedGroup = hasGroupedAccounts && (preview.result.accountGroups ?? []).some((group) => {
      const assignment = groupAssignments[group.id];
      return !assignment?.bankAccountId && !assignment?.name?.trim();
    });
    const queuePosition = previewIndex == null ? null : previewIndex + 1;
    return <div>
      <PageHeading eyebrow={queuePosition == null ? 'Saved analysis · review before load' : `Document ${queuePosition} of ${queue.length} · review before load`} title="Review parsed statement" description={`AgarAccounting AI has not loaded any rows for ${preview.clientName} yet. Confirm the interpreted currency and transactions before they enter that client’s review queue.`} />
      <ImportActivity stage={activityStage} documentKey={activeQueueIndex == null ? undefined : `${activeQueueIndex}:${queue[activeQueueIndex]?.file.name ?? ''}:${queue[activeQueueIndex]?.file.lastModified ?? ''}`} fileName={activeQueueIndex == null ? undefined : queue[activeQueueIndex]?.file.name} position={queuePosition ?? undefined} total={queue.length || undefined} />
      <section className="rounded-lg border border-card-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">AI extraction preview</div><h2 className="mt-2 text-lg font-semibold">{preview.fileName}</h2><p className="mt-1 text-xs text-muted-foreground">{preview.result.lines.length} proposed transaction{preview.result.lines.length === 1 ? '' : 's'} · source and preview saved, no statement lines loaded</p></div>
          <button type="button" onClick={skipPreview} className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted">Skip this document</button>
        </div>
        {isWrongClient && <div data-testid="statement-preview-client-mismatch" className="mt-5 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs leading-5 text-destructive">This preview is permanently assigned to <strong>{preview.clientName}</strong>. Switch back to that client before loading transactions. AgarAccounting AI will not move this file to the currently selected workspace.</div>}
        {!hasGroupedAccounts && <div className={`mt-5 rounded-md border px-4 py-3 ${isCurrencyUncertain ? 'border-accent/30 bg-accent/10' : 'border-primary/25 bg-primary/5'}`}>
          <div className="text-xs font-semibold">{isCurrencyUncertain ? 'Currency needs your confirmation' : `AI understood the statement currency as ${preview.result.detectedCurrency}`}</div>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{isCurrencyUncertain ? 'The source did not state one clear currency. Select the currency that applies to every row before loading.' : 'Check this against the original statement. You can correct it before the rows are loaded.'}</p>
          <label className="mt-3 block max-w-xs text-xs font-medium">Currency to load<select data-testid="select-confirm-statement-currency" value={selectedCurrency} onChange={(event) => setSelectedCurrency(event.target.value)} className="mt-1.5 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option value="AED">AED — UAE dirham</option><option value="USD">USD — US dollar</option><option value="EUR">EUR — euro</option><option value="GBP">GBP — pound sterling</option><option value="SAR">SAR — Saudi riyal</option><option value="QAR">QAR — Qatari riyal</option></select></label>
        </div>}
        {hasGroupedAccounts ? <div className="mt-5 space-y-4" data-testid="statement-account-groups">{preview.result.accountGroups?.map((group) => {
          const assignment = groupAssignments[group.id];
          return <section key={group.id} data-testid={`statement-account-group-${group.id}`} className={`rounded-md border p-4 ${group.status === 'ambiguous' ? 'border-accent/40 bg-accent/5' : 'border-border'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">{assignment?.name || group.identity.accountNumberLast4 && `Account ending ${group.identity.accountNumberLast4}` || 'Account assignment needed'}</h3><p className="mt-1 text-[11px] text-muted-foreground">{assignment?.bankName || 'Bank not identified'} · {assignment?.currency} · {group.lines.length} transaction{group.lines.length === 1 ? '' : 's'}</p></div>{group.status === 'ambiguous' ? <span className="rounded-full bg-accent/15 px-2 py-1 text-[10px] font-semibold text-accent-foreground">Needs assignment</span> : null}</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-[11px] font-medium">Existing client account<select aria-label={`Existing account for ${group.id}`} value={assignment?.bankAccountId ?? ''} onChange={(event) => setGroupAssignments((current) => ({ ...current, [group.id]: { ...current[group.id], bankAccountId: event.target.value ? Number(event.target.value) : null } }))} className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-xs"><option value="">Create or match from identity</option>{bankAccountsQuery.data?.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}{account.accountNumberLast4 ? ` · ••••${account.accountNumberLast4}` : ''}</option>)}</select></label>
              <label className="text-[11px] font-medium">Account name or identifier<input value={assignment?.name ?? ''} onChange={(event) => setGroupAssignments((current) => ({ ...current, [group.id]: { ...current[group.id], name: event.target.value } }))} className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-xs" /></label>
              <label className="text-[11px] font-medium">Bank<input value={assignment?.bankName ?? ''} onChange={(event) => setGroupAssignments((current) => ({ ...current, [group.id]: { ...current[group.id], bankName: event.target.value } }))} className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-xs" /></label>
              <label className="text-[11px] font-medium">Currency<select value={assignment?.currency ?? ''} onChange={(event) => setGroupAssignments((current) => ({ ...current, [group.id]: { ...current[group.id], currency: event.target.value } }))} className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-xs"><option value="AED">AED</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="SAR">SAR</option><option value="QAR">QAR</option></select></label>
            </div>
            <div className="mt-3 overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[560px] text-left text-xs"><thead className="bg-muted/60 font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Direction</th><th className="px-3 py-2 text-right">Amount</th></tr></thead><tbody className="divide-y divide-border">{group.lines.map((line) => <tr key={line.id}><td className="px-3 py-2 font-mono">{shortDate(line.date)}</td><td className="px-3 py-2 font-medium">{line.description}</td><td className="px-3 py-2 capitalize text-muted-foreground">{line.direction}</td><td className="px-3 py-2 text-right font-mono">{money(line.amount, assignment?.currency || line.currency)}</td></tr>)}</tbody></table></div>
          </section>;
        })}</div> : <><div className="mt-5 overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[660px] text-left text-xs"><thead className="bg-muted/60 font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Direction</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Suggested account</th></tr></thead><tbody className="divide-y divide-border">{preview.result.lines.slice(0, 25).map((line) => <tr key={line.id}><td className="px-3 py-2.5 font-mono">{shortDate(line.date)}</td><td className="px-3 py-2.5 font-medium">{line.description}</td><td className="px-3 py-2.5 capitalize text-muted-foreground">{line.direction}</td><td className="px-3 py-2.5 text-right font-mono">{money(line.amount, selectedCurrency || line.currency)}</td><td className="px-3 py-2.5 text-muted-foreground">{line.accountSuggestion ?? 'Review needed'}</td></tr>)}</tbody></table></div>{preview.result.lines.length > 25 && <p className="mt-3 text-[11px] text-muted-foreground">Showing the first 25 of {preview.result.lines.length} parsed transactions. All rows will be loaded only after you confirm.</p>}</>}
        {message && <p className="mt-4 text-xs text-destructive">{message}</p>}
         <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={skipPreview} className="h-10 rounded-md border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted">Skip this document</button><button data-testid="button-confirm-statement-import" type="button" onClick={confirmImport} disabled={isWrongClient || (!hasGroupedAccounts && !selectedCurrency) || hasUnassignedGroup || importMutation.isPending} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">{importMutation.isPending ? <><LoaderCircle size={14} className="animate-spin" /> Loading to review…</> : <><Check size={14} /> Load {preview.result.lines.length} transaction{preview.result.lines.length === 1 ? '' : 's'} to {preview.clientName}</>}</button></div>
      </section>
    </div>;
  }

  return <div>
    <PageHeading eyebrow="Client intake / source documents" title="Import bank statements" description={`Choose one or more PDF, CSV, or Excel statements for ${activeClient?.name ?? 'this client'}. AgarAccounting AI analyzes them one at a time and shows every parsed row for confirmation before it loads anything into review.`} />
     <ImportActivity stage={activityStage} documentKey={activeQueueIndex == null ? undefined : `${activeQueueIndex}:${queue[activeQueueIndex]?.file.name ?? ''}:${queue[activeQueueIndex]?.file.lastModified ?? ''}`} fileName={activeQueueIndex == null ? undefined : queue[activeQueueIndex]?.file.name} position={activeQueueIndex == null ? undefined : activeQueueIndex + 1} total={queue.length || undefined} />
    <section className="rounded-lg border border-card-border bg-card p-6">
      <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary"><UploadCloud size={21} /></div>
      <h2 className="mt-5 text-lg font-semibold">Statement files</h2>
      <p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">Accepted formats: PDF, CSV, XLS, and XLSX. Drop multiple documents here; each one keeps its own source evidence and review confirmation.</p>
      <label
        className={`mt-6 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-primary/35 bg-secondary/30 px-6 py-10 text-center transition-colors hover:bg-secondary/60 ${isProcessingQueue ? 'cursor-not-allowed opacity-60' : ''}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); if (!isProcessingQueue) addFiles(Array.from(event.dataTransfer.files)); }}
      >
        <UploadCloud className="text-primary" size={24} />
        <span className="mt-3 text-sm font-semibold">{queue.length ? `${queue.length} document${queue.length === 1 ? '' : 's'} selected` : 'Choose or drop bank statements'}</span>
        <span className="mt-1 text-[11px] text-muted-foreground">{isProcessingQueue ? 'Analyzing documents one at a time…' : 'PDF, CSV, XLS, or XLSX · select multiple documents'}</span>
        <input data-testid="input-statement-file" type="file" multiple accept=".pdf,.csv,.xls,.xlsx,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={isProcessingQueue} onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ''; }} />
      </label>
      {queue.length > 0 && <div data-testid="statement-import-queue" className="mt-5 divide-y divide-border rounded-md border border-border">
        {queue.map((item, index) => <div key={`${item.file.name}-${item.file.lastModified}-${index}`} className="flex flex-col gap-2 px-3 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><div className="truncate font-semibold">{item.file.name}</div><div className="mt-1 text-[10px] text-muted-foreground">{Math.round(item.file.size / 1024).toLocaleString()} KB · Document {index + 1} · {item.clientName}</div></div>
          <span className={`shrink-0 rounded-full px-2 py-1 font-mono text-[9px] uppercase tracking-[.08em] ${item.status === 'loaded' ? 'bg-primary/10 text-primary' : item.status === 'failed' ? 'bg-destructive/10 text-destructive' : item.status === 'ready' ? 'bg-accent/15 text-accent-foreground' : item.status === 'analyzing' ? 'bg-secondary text-primary' : 'bg-muted text-muted-foreground'}`}>{item.status === 'ready' ? 'Needs review' : item.status === 'loaded' ? 'Loaded to review' : item.status === 'analyzing' ? 'Analyzing' : item.status}{item.message && item.status === 'failed' ? ` · ${item.message}` : ''}</span>
        </div>)}
      </div>}
      {message && <div data-testid="import-statement-result" className="mt-5 rounded-md border border-primary/25 bg-primary/5 px-4 py-3 text-xs text-primary">{message}{queue.some((item) => item.clientId === activeClient?.id && item.status === 'loaded' && item.result?.importedCount) ? <Link href="/statement-lines" className="ml-2 font-semibold underline">Review imported lines</Link> : null}</div>}
      <div className="mt-5 flex justify-end">
        {queue.length > 0 && !isProcessingQueue && <button data-testid="button-discard-statement-queue" type="button" onClick={() => { setQueue([]); setMessage(''); }} className="mr-2 h-10 rounded-md border border-border px-4 text-xs font-semibold text-muted-foreground hover:bg-muted">Discard queue</button>}
        <button data-testid="button-parse-statement" type="button" onClick={startQueue} disabled={!queue.some((item) => item.status === 'queued' || item.status === 'failed') || isProcessingQueue || isUploading || importMutation.isPending} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
           {isProcessingQueue || isUploading || importMutation.isPending ? <><LoaderCircle size={14} className="animate-spin" /> {activityStage === 'uploading' ? 'Securing document…' : activityStage === 'confirming' ? 'Loading to review…' : 'Reading the statement…'}</> : <><Sparkles size={14} /> {queue.length > 1 ? `Analyze ${queue.filter((item) => item.status === 'queued' || item.status === 'failed').length} documents one at a time` : 'Analyze with AI'}</>}
        </button>
      </div>
    </section>
    <StatementImportHistory />
  </div>;
}

function StatementImportHistory() {
  const { activeClient } = useClientWorkspace();
  const clientId = activeClient?.id ?? 0;
  const importsQuery = useGetStatementImports({ clientId }, {
    query: {
      queryKey: getGetStatementImportsQueryKey({ clientId }),
      enabled: Boolean(activeClient),
    },
  });
  const undoMutation = useUndoStatementImport();
  const confirmMutation = useImportStatement();
  const retryMutation = useImportStatement();
  const [feedback, setFeedback] = useState('');
  const [pendingCurrencies, setPendingCurrencies] = useState<Record<number, string>>({});
  const [sourcePreview, setSourcePreview] = useState<StatementImport | null>(null);
  const sourceTriggerRef = useRef<HTMLButtonElement | null>(null);

  const closeSourcePreview = () => {
    setSourcePreview(null);
    requestAnimationFrame(() => sourceTriggerRef.current?.focus());
  };

  const confirmPendingImport = (statementImport: StatementImport) => {
    if (!activeClient || !statementImport.objectPath) return;
    const currency = pendingCurrencies[statementImport.id] ?? statementImport.detectedCurrency ?? '';
    if (!currency) {
      setFeedback('Choose the statement currency before loading this file into review.');
      return;
    }
    setFeedback('');
    confirmMutation.mutate({
      data: {
        importId: statementImport.id,
        clientId: activeClient.id,
        fileName: statementImport.fileName,
        mimeType: statementImport.mimeType,
        objectPath: statementImport.objectPath,
        currency,
        confirmed: true,
      },
    }, {
      onSuccess: (result) => {
        const summary = result.message ?? `${result.importedCount} statement lines are ready for review.`;
        setFeedback(summary);
        notify.success('Statement loaded to review', { description: summary });
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetStatementImportsQueryKey({ clientId: activeClient.id }) }),
          queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey({ clientId: activeClient.id }) }),
          queryClient.invalidateQueries({ queryKey: getGetJournalEntriesQueryKey({ clientId: activeClient.id }) }),
          queryClient.invalidateQueries({ queryKey: getGetLedgerOverviewQueryKey({ clientId: activeClient.id }) }),
        ]);
      },
      onError: (error) => {
        const message = mutationErrorMessage(error);
        setFeedback(message);
        notify.error(error, { title: 'Load to review failed', description: message, fallback: message });
      },
    });
  };
  const retryAnalysis = (statementImport: StatementImport) => {
    if (!activeClient || !statementImport.objectPath) return;
    setFeedback('');
    retryMutation.mutate({
      data: {
        clientId: activeClient.id,
        bankAccountId: statementImport.bankAccountId,
        fileName: statementImport.fileName,
        mimeType: statementImport.mimeType,
        objectPath: statementImport.objectPath,
        confirmed: false,
        background: true,
      },
    }, {
      onSuccess: (result) => {
        const summary = result.message ?? 'Statement analysis restarted in the background.';
        setFeedback(summary);
        notify.success('Analysis restarted', { description: summary });
        void queryClient.invalidateQueries({ queryKey: getGetStatementImportsQueryKey({ clientId: activeClient.id }) });
      },
      onError: (error) => {
        const message = mutationErrorMessage(error);
        setFeedback(message);
        notify.error(error, { title: 'Retry failed', description: message, fallback: message });
      },
    });
  };

  const undoImport = (importId: number, fileName: string) => {
    if (!activeClient || !window.confirm(`Undo "${fileName}"? This permanently removes its draft transactions and journals. The original statement document and audit trail will be kept.`)) return;
    setFeedback('');
    undoMutation.mutate({ id: importId, data: { clientId: activeClient.id } }, {
      onSuccess: (result) => {
        setFeedback(result.message);
        notify.success(`"${fileName}" undone`, { description: result.message });
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetStatementImportsQueryKey({ clientId: activeClient.id }) }),
          queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey({ clientId: activeClient.id }) }),
          queryClient.invalidateQueries({ queryKey: getGetJournalEntriesQueryKey({ clientId: activeClient.id }) }),
          queryClient.invalidateQueries({ queryKey: getGetLedgerOverviewQueryKey({ clientId: activeClient.id }) }),
        ]);
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'This import could not be undone. It may contain changed or posted work.';
        setFeedback(message);
        notify.error(error, { title: 'Undo failed', description: message, fallback: message });
      },
    });
  };

  if (!activeClient) return null;
  return <section className="mt-6 rounded-lg border border-card-border bg-card p-6" data-testid="statement-import-history">
    <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Import history</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Uploads waiting for currency confirmation create no statement lines. Undo is available only while every loaded transaction and journal is still draft and unchanged.</p></div><button type="button" onClick={() => void importsQuery.refetch()} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-muted"><RefreshCw size={13} /> Refresh</button></div>
    {feedback ? <div className="mt-4 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-primary" role="status">{feedback}</div> : null}
    {importsQuery.isLoading ? <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle size={14} className="animate-spin" /> Loading import history…</div> : null}
    {importsQuery.data?.length ? <div className="mt-4 divide-y divide-border rounded-md border border-border">{importsQuery.data.map((statementImport) => <div key={statementImport.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="truncate text-sm font-semibold">{statementImport.fileName}</div><div className="mt-1 text-xs text-muted-foreground">{statementImport.importedLineCount} loaded transaction{statementImport.importedLineCount === 1 ? '' : 's'} · {new Date(statementImport.createdAt).toLocaleString()} · <span className="capitalize">{statementImport.outcome.replaceAll('_', ' ')}</span></div>{statementImport.outcome === 'analyzing' ? <p className="mt-2 text-[11px] font-medium text-accent-foreground">Analysis is continuing in the background. You can leave this page.</p> : statementImport.outcome === 'pending_confirmation' ? <p className="mt-2 text-[11px] font-medium text-accent-foreground">Nothing has been loaded. Review the saved preview and confirm its currency first.</p> : statementImport.outcome === 'failed' ? <p className="mt-2 text-[11px] text-destructive">{statementImport.errorMessage ?? 'Analysis did not finish. The original upload remains available for retry.'}</p> : statementImport.outcome === 'completed' ? <p className="mt-2 text-[11px] text-muted-foreground">Undo remains available only until a draft transaction or journal is changed or posted.</p> : null}</div><div className="flex shrink-0 flex-wrap items-center gap-2">{statementImport.outcome === 'analyzing' ? <span className="inline-flex h-9 items-center gap-2 rounded-md border border-accent/25 bg-accent/10 px-3 text-xs font-semibold text-accent-foreground"><LoaderCircle size={13} className="animate-spin" /> Analyzing</span> : null}{statementImport.outcome === 'pending_confirmation' ? <><select data-testid={`select-pending-statement-currency-${statementImport.id}`} aria-label={`Currency for ${statementImport.fileName}`} value={pendingCurrencies[statementImport.id] ?? statementImport.detectedCurrency ?? ''} onChange={(event) => setPendingCurrencies((current) => ({ ...current, [statementImport.id]: event.target.value }))} className="h-9 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary"><option value="">Choose currency</option><option value="AED">AED</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="SAR">SAR</option><option value="QAR">QAR</option></select><button data-testid={`button-confirm-pending-statement-${statementImport.id}`} type="button" onClick={() => confirmPendingImport(statementImport)} disabled={confirmMutation.isPending || !statementImport.objectPath} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">{confirmMutation.isPending && confirmMutation.variables?.data.importId === statementImport.id ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />} Confirm & load</button></> : null}{statementImport.outcome === 'failed' && statementImport.objectPath ? <button data-testid={`button-retry-statement-analysis-${statementImport.id}`} type="button" onClick={() => retryAnalysis(statementImport)} disabled={retryMutation.isPending} className="inline-flex h-9 items-center gap-2 rounded-md border border-primary/30 px-3 text-xs font-semibold text-primary disabled:opacity-50">{retryMutation.isPending ? <LoaderCircle size={13} className="animate-spin" /> : <RotateCw size={13} />} Retry analysis</button> : null}{statementImport.sourceUrl ? <button data-testid={`button-preview-statement-source-${statementImport.id}`} type="button" onClick={(event) => { sourceTriggerRef.current = event.currentTarget; setSourcePreview(statementImport); }} aria-label={`Preview source ${statementImport.fileName}`} className="text-xs font-semibold text-primary underline">Source</button> : null}{statementImport.outcome === 'completed' ? <button data-testid={`button-undo-statement-import-${statementImport.id}`} type="button" onClick={() => undoImport(statementImport.id, statementImport.fileName)} disabled={undoMutation.isPending} className="inline-flex h-9 items-center gap-2 rounded-md border border-destructive/35 px-3 text-xs font-semibold text-destructive hover:bg-destructive/5 disabled:opacity-50">{undoMutation.isPending ? <LoaderCircle size={13} className="animate-spin" /> : <Trash2 size={13} />} Undo import</button> : null}</div></div>)}</div> : !importsQuery.isLoading ? <p className="mt-4 text-xs text-muted-foreground">No statement imports have been recorded for this client.</p> : null}
    <Dialog open={Boolean(sourcePreview)} onOpenChange={(open) => { if (!open) closeSourcePreview(); }}>
      {sourcePreview ? <StatementSourcePreview source={sourcePreview} onClose={closeSourcePreview} /> : null}
    </Dialog>
  </section>;
}

function isBrowserPreviewableStatement(statementImport: StatementImport) {
  return statementImport.mimeType.toLowerCase() === 'application/pdf'
    || statementImport.fileName.toLowerCase().endsWith('.pdf');
}
function LegacyImportStatementPage() {
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
          confirmed: true,
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
  return <div><PageHeading eyebrow="Client intake / source document" title="Import a bank statement" description={`Choose a PDF, CSV, or Excel statement for ${activeClient?.name ?? 'this client'}. AgarAccounting AI extracts the transactions with AI and sends every line to review before it can affect the books.`} /><div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]"><section className="rounded-lg border border-card-border bg-card p-6"><div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary"><UploadCloud size={21} /></div><h2 className="mt-5 text-lg font-semibold">Statement file</h2><p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">Accepted formats: PDF, CSV, XLS, and XLSX. Keep the original bank export intact—AgarAccounting AI will normalize date, description, amount, direction, and currency.</p><label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-primary/35 bg-secondary/30 px-6 py-10 text-center transition-colors hover:bg-secondary/60"><UploadCloud className="text-primary" size={24} /><span className="mt-3 text-sm font-semibold">{file ? file.name : 'Choose a bank statement'}</span><span className="mt-1 text-[11px] text-muted-foreground">{file ? `${Math.round(file.size / 1024).toLocaleString()} KB ready to parse` : 'PDF, CSV, XLS, or XLSX · one statement at a time'}</span><input data-testid="input-statement-file" type="file" accept=".pdf,.csv,.xls,.xlsx,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setState('idle'); setMessage(''); setImportResult(null); }} /></label><div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end"><label className="block text-xs font-medium">Default statement currency<select value={currency} onChange={(event) => setCurrency(event.target.value)} className="mt-1.5 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option>AED</option><option>USD</option><option>EUR</option><option>GBP</option></select></label><button data-testid="button-parse-statement" onClick={submit} disabled={!file || state === 'reading' || isUploading || importMutation.isPending} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">{state === 'reading' ? isUploading ? 'Uploading statement…' : 'Extracting statement lines…' : <><Sparkles size={14} /> Extract with AI</>}</button></div>{message && <div data-testid="import-statement-result" className={`mt-5 rounded-md border px-4 py-3 text-xs ${state === 'done' ? importResult?.duplicateCount ? 'border-accent/25 bg-accent/10 text-accent-foreground' : 'border-primary/25 bg-primary/5 text-primary' : 'border-destructive/25 bg-destructive/5 text-destructive'}`}>{message}{state === 'done' && importResult?.importedCount ? <Link href="/statement-lines" className="ml-2 font-semibold underline">Review imported lines</Link> : null}</div>}{importResult && importResult.duplicateCount > 0 && <section data-testid="import-duplicate-summary" className="mt-4 rounded-md border border-accent/25 bg-accent/5 p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-semibold">Duplicate review result</div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{importResult.importStatus === 'duplicate_file' ? 'The identical source file was previously imported for this client, so it was not queued again.' : 'Exact duplicate transaction keys were skipped. Existing review items remain unchanged.'}</p></div><span className="rounded-full bg-accent/15 px-2 py-1 font-mono text-[10px] text-accent-foreground">{importResult.duplicateCount} skipped</span></div>{importResult.duplicateLines.length > 0 && <ul className="mt-3 divide-y divide-accent/15 rounded border border-accent/15 bg-card">{importResult.duplicateLines.map((line, index) => <li key={`${line.date}-${line.description}-${index}`} className="px-3 py-2.5 text-[11px]"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{line.description}</span><span className="font-mono">{shortDate(line.date)} · {money(line.amount, line.currency)}</span></div><div className="mt-1 text-muted-foreground">{line.reason === 'already_imported' ? `Already in this client's review queue${line.existingLineId ? ` (line #${line.existingLineId})` : ''}.` : 'Repeated within this uploaded statement.'}</div></li>)}</ul>}</section>}</section><aside className="rounded-lg border border-accent/25 bg-accent/10 p-6"><div className="font-mono text-[10px] uppercase tracking-[.16em] text-accent-foreground">Review safeguard</div><h2 className="mt-3 font-display text-[28px] leading-[1.05]">AI recreates the lines. You decide what posts.</h2><div className="mt-6 space-y-4 text-xs leading-5 text-accent-foreground/75"><p><strong className="text-accent-foreground">1. Extract</strong><br />The system reads the source statement and proposes normalized bank movements.</p><p><strong className="text-accent-foreground">2. Verify</strong><br />Imported lines enter the review queue with the original file name retained as evidence.</p><p><strong className="text-accent-foreground">3. Post</strong><br />Only draft journal entries can be posted into the trial balance and financial statements.</p></div></aside></div></div>;
}

function AddLineDialog({ onClose }: { onClose: () => void }) {
  const { activeClient } = useClientWorkspace();
  const mutation = useCreateStatementLine();
  const [form, setForm] = useState<StatementLineInput>({ date: '2026-08-24', description: '', currency: 'AED', amount: 0, direction: 'outflow' });
  const set = (key: keyof StatementLineInput, value: string) => setForm((old) => ({ ...old, [key]: key === 'amount' ? Number(value) : value }));
  const submit = (event: React.FormEvent) => { event.preventDefault(); mutation.mutate({ data: { ...form, clientId: activeClient?.id ?? 1 } }, { onSuccess: () => { onClose(); notify.success('Statement line added', { description: `${form.description || 'New line'} · ${form.amount}` }); } }); };
  return <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-lg border border-card-border bg-card p-6 shadow-2xl" role="dialog" aria-modal="true"><div className="flex items-start justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Manual adjustment / {activeClient?.name ?? 'client'}</div><h2 className="mt-2 text-lg font-semibold">Add statement line</h2></div><button data-testid="button-close-add-line" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X size={17} /></button></div><form onSubmit={submit} className="mt-6 space-y-4"><label className="block text-xs font-medium">Date<input data-testid="input-line-date" required type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Description<input data-testid="input-line-description" required value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. Cloud hosting invoice" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><div className="grid grid-cols-2 gap-3"><label className="block text-xs font-medium">Amount<input data-testid="input-line-amount" required min="0" step=".01" type="number" value={form.amount || ''} onChange={(e) => set('amount', e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Currency<select data-testid="select-line-currency" value={form.currency} onChange={(e) => set('currency', e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option>AED</option><option>USD</option><option>EUR</option><option>GBP</option><option>CAD</option></select></label></div><label className="block text-xs font-medium">Direction<select data-testid="select-line-direction" value={form.direction} onChange={(e) => set('direction', e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option value="outflow">Outflow / money out</option><option value="inflow">Inflow / money in</option></select></label>{mutation.isError && <p className="text-xs text-destructive">This line could not be added. Try again.</p>}<button data-testid="button-submit-line" disabled={mutation.isPending} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-50">{mutation.isPending ? 'Saving line…' : <><Plus size={14} /> Add to review queue</>}</button></form></div></div>;
}

type BulkStatementAction = {
  type: 'bulk_post_entries' | 'recode_lines';
  lineIds: number[];
  entryIds: number[];
};
function ContactsPage() {
  const { activeClient } = useClientWorkspace();
  const clientId = activeClient?.id ?? 0;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [typeFilter, setTypeFilter] = useState<'customer' | 'supplier' | 'both' | 'all'>('all');

  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);
  const [mergeContactIds, setMergeContactIds] = useState<number[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);

  const contactsQuery = useGetContacts({ clientId }, { query: { queryKey: getGetContactsQueryKey({ clientId }), enabled: !!clientId } });

  const contacts = useMemo(() => {
    return (contactsQuery.data ?? []).filter(c => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (typeFilter !== 'all' && c.contactType !== typeFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        return c.displayName.toLowerCase().includes(s) || c.legalName.toLowerCase().includes(s) || c.aliases.some(a => a.toLowerCase().includes(s));
      }
      return true;
    });
  }, [contactsQuery.data, search, statusFilter, typeFilter]);

  const selectedContact = contactsQuery.data?.find(c => c.id === selectedContactId);
  const selectedMergeContacts = (contactsQuery.data ?? []).filter((contact) => mergeContactIds.includes(contact.id));
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => {
    setMergeContactIds([]);
    setMergeOpen(false);
  }, [clientId]);

  const toggleMergeContact = (contactId: number) => {
    setMergeContactIds((current) => current.includes(contactId)
      ? current.filter((id) => id !== contactId)
      : current.length < 2 ? [...current, contactId] : [current[1], contactId]);
  };
  const activeContactFilterCount = [search.trim() !== '', typeFilter !== 'all', statusFilter !== 'active'].filter(Boolean).length;
  const clearContactFilters = () => { setSearch(''); setTypeFilter('all'); setStatusFilter('active'); };

  return <div>
    <PageHeading
      eyebrow="Directory"
      title="Contacts"
      description="Manage customers and suppliers. Review confirmed accounting history for confident reconciliation."
      action={<div className="flex flex-wrap items-center gap-2">
        <button data-testid="button-open-merge-contacts" disabled={selectedMergeContacts.length !== 2} onClick={() => setMergeOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-background px-4 py-2.5 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-45"><Users size={14} /> Merge selected</button>
        <button data-testid="button-add-contact" onClick={() => setAddOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-sm hover:-translate-y-0.5 transition-transform"><UserPlus size={14} /> Add contact</button>
      </div>}
    />

    <FilterToolbar
      search={search}
      onSearchChange={setSearch}
      searchTestId="input-search-contacts"
      searchPlaceholder="Search names and aliases"
      activeCount={activeContactFilterCount}
      shownCount={contacts.length}
      totalCount={contactsQuery.data?.length ?? 0}
      noun="contacts"
      onClear={clearContactFilters}
      clearTestId="button-clear-contact-filters"
      countTestId="text-active-contact-filter-count"
    >
      <FilterPills<typeof typeFilter>
        compact
        label="Type"
        ariaLabel="Filter by contact type"
        testId="select-type-filter"
        value={typeFilter}
        onChange={setTypeFilter}
        options={[
          { value: 'all', label: 'All types' },
          { value: 'customer', label: 'Customers' },
          { value: 'supplier', label: 'Suppliers' },
          { value: 'both', label: 'Both' },
        ]}
      />
      <FilterPills<typeof statusFilter>
        compact
        label="Status"
        ariaLabel="Filter by contact status"
        testId="select-status-filter"
        value={statusFilter}
        onChange={setStatusFilter}
        options={[
          { value: 'active', label: 'Active' },
          { value: 'archived', label: 'Archived' },
          { value: 'all', label: 'All statuses' },
        ]}
      />
    </FilterToolbar>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px] items-start">
      <QueryState loading={contactsQuery.isLoading} error={contactsQuery.isError} empty={!contacts.length} filtered={activeContactFilterCount > 0} onClearFilters={clearContactFilters} onRetry={() => contactsQuery.refetch()}>
        <div className="overflow-hidden rounded-lg border border-card-border bg-card">
          <table className="w-full text-left">
            <thead className="bg-muted/55 font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground">
              <tr>
                <th className="w-12 px-4 py-3 font-medium"><span className="sr-only">Select for merge</span></th>
                <th className="px-4 py-3 font-medium">Display name</th>
                <th className="px-4 py-3 font-medium">Legal name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contacts.map((contact) => (
                <tr
                  key={contact.id}
                  data-testid={`row-contact-${contact.id}`}
                  onClick={() => setSelectedContactId(contact.id)}
                  className={`group cursor-pointer transition-colors hover:bg-secondary/30 ${selectedContactId === contact.id ? 'bg-secondary/40' : ''}`}
                >
                  <td className="px-4 py-4" onClick={(event) => event.stopPropagation()}>
                    <input
                      data-testid={`checkbox-merge-contact-${contact.id}`}
                      type="checkbox"
                      aria-label={`Select ${contact.displayName} for merge`}
                      disabled={contact.status !== 'active' || contact.mergedIntoContactId != null}
                      checked={mergeContactIds.includes(contact.id)}
                      onChange={() => toggleMergeContact(contact.id)}
                      className="size-4 accent-primary disabled:opacity-40"
                    />
                  </td>
                  <td className="px-4 py-4 text-xs font-semibold">{contact.displayName}</td>
                  <td className="px-4 py-4 text-xs">{contact.legalName}</td>
                  <td className="px-4 py-4 text-[11px] capitalize text-muted-foreground">{contact.contactType}</td>
                  <td className="px-4 py-4 text-right">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[9px] uppercase tracking-[.08em] ${contact.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{contact.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>

      <div className="xl:sticky xl:top-[102px]">
        {selectedContact ? (
          <ContactDetailsPanel contact={selectedContact} />
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-card/50 p-8 text-center">
            <Users className="mx-auto text-muted-foreground" size={24} />
            <h3 className="mt-4 text-sm font-semibold">No contact selected</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">Select a contact to view their ledger history and details.</p>
          </div>
        )}
      </div>
    </div>

    {addOpen && <ContactFormDialog onClose={() => setAddOpen(false)} clientId={clientId} />}
    {mergeOpen && selectedMergeContacts.length === 2 && <ContactMergeDialog contacts={selectedMergeContacts} clientId={clientId} onClose={() => setMergeOpen(false)} onMerged={(survivingContactId) => {
      setMergeOpen(false);
      setMergeContactIds([]);
      setSelectedContactId(survivingContactId);
    }} />}
  </div>;
}

function ContactDetailsPanel({ contact }: { contact: Contact }) {
  const { activeClient } = useClientWorkspace();
  const clientId = activeClient?.id ?? 0;

  const historyQuery = useGetContactHistory(clientId, contact.id, { query: { queryKey: getGetContactHistoryQueryKey(clientId, contact.id), enabled: !!contact.id } });
  const updateMutation = useUpdateContact();

  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return <div className="rounded-lg border border-card-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4 border-b border-border pb-4">
        <h3 className="text-sm font-semibold">Edit Contact</h3>
        <button data-testid="button-cancel-edit-contact" onClick={() => setIsEditing(false)} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X size={15} /></button>
      </div>
      <ContactForm contact={contact} clientId={clientId} onSaved={() => setIsEditing(false)} />
    </div>;
  }

  const toggleStatus = () => {
    const nextStatus = contact.status === 'active' ? 'archived' : 'active';
    updateMutation.mutate({
      id: contact.id,
      data: { clientId, status: nextStatus }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetContactsQueryKey({ clientId }) });
        notify.success(nextStatus === 'archived' ? `${contact.displayName} archived` : `${contact.displayName} reactivated`);
      }
    });
  };

  return <div className="rounded-lg border border-card-border bg-card shadow-sm">
    <div className="border-b border-border p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 data-testid="text-contact-display-name" className="text-base font-semibold">{contact.displayName}</h3>
            <span className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[.08em] ${contact.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{contact.status}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{contact.legalName}</div>
        </div>
        <div className="flex gap-2">
          {contact.mergedIntoContactId == null && <button data-testid="button-edit-contact" onClick={() => setIsEditing(true)} className="rounded border border-border bg-card px-2 py-1 text-[11px] font-medium hover:bg-muted">Edit</button>}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 rounded-md bg-muted/40 p-3">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">Type</div>
          <div className="mt-1 text-xs font-medium capitalize">{contact.contactType}</div>
        </div>
        <div>
           <div className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">Aliases</div>
           <div className="mt-1 text-[11px] text-muted-foreground">{contact.aliases.length ? contact.aliases.join(', ') : 'None'}</div>
        </div>
      </div>
      {contact.mergedIntoContactId != null && <div data-testid="contact-merge-audit-note" className="mt-4 rounded-md border border-primary/20 bg-primary/5 p-3 text-[11px] leading-5 text-muted-foreground">
        This record was merged into contact #{contact.mergedIntoContactId} on {contact.mergedAt ? shortDate(String(contact.mergedAt)) : 'an unknown date'}. It remains archived for audit and cannot be matched or restored.
      </div>}
      <div className="mt-3 text-right">
        {contact.mergedIntoContactId == null && <button
          data-testid="button-toggle-contact-status"
          disabled={updateMutation.isPending}
          onClick={toggleStatus}
          className={`text-[10px] font-semibold hover:underline ${contact.status === 'active' ? 'text-destructive' : 'text-primary'}`}
        >
          {contact.status === 'active' ? 'Archive contact' : 'Restore contact'}
        </button>}
      </div>
    </div>

    <div className="p-5">
      <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Ledger History</div>
      <div className="mt-4">
        <QueryState loading={historyQuery.isLoading} error={historyQuery.isError} empty={!historyQuery.data?.history.length} onRetry={() => historyQuery.refetch()}>
          <div className="space-y-3">
            {historyQuery.data?.history.map(item => (
              <div key={item.statementLineId} className="rounded-md border border-border p-3 text-[11px]">
                <div className="flex items-start justify-between">
                  <span className="font-mono text-muted-foreground">{shortDate(item.date)}</span>
                  <span className="font-mono font-medium">{item.direction === 'inflow' ? '+' : '−'}{money(item.amount, item.currency)}</span>
                </div>
                <div className="mt-1.5 font-semibold">{item.description}</div>
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="text-muted-foreground">{item.accountTreatment}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-[.05em] ${item.status === 'posted' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{item.status}</span>
                </div>
              </div>
            ))}
          </div>
        </QueryState>
      </div>
    </div>
  </div>;
}

function ContactForm({ contact, clientId, onSaved }: { contact?: Contact, clientId: number, onSaved: () => void }) {
  const createMutation = useCreateContact();
  const updateMutation = useUpdateContact();

  const [form, setForm] = useState<ContactInput>({
    clientId,
    displayName: contact?.displayName ?? '',
    legalName: contact?.legalName ?? '',
    contactType: contact?.contactType ?? 'customer',
    aliases: contact?.aliases ?? [],
  });
  const [aliasInput, setAliasInput] = useState('');

  const addAlias = () => {
    if (aliasInput.trim() && !form.aliases?.includes(aliasInput.trim())) {
      setForm(f => ({ ...f, aliases: [...(f.aliases ?? []), aliasInput.trim()] }));
      setAliasInput('');
    }
  };

  const removeAlias = (alias: string) => {
    setForm(f => ({ ...f, aliases: f.aliases?.filter(a => a !== alias) }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const displayName = form.displayName.trim() || 'Contact';
    if (contact) {
      updateMutation.mutate({ id: contact.id, data: form }, {
        onSuccess: (saved) => {
          queryClient.invalidateQueries({ queryKey: getGetContactsQueryKey({ clientId }) });
          notify.success('Contact updated', { description: `${saved?.displayName ?? displayName} is up to date.` });
          onSaved();
        },
        onError: (error) => notify.error(error, { title: 'Update failed', fallback: `${displayName} could not be updated.` }),
      });
    } else {
      createMutation.mutate({ data: form }, {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getGetContactsQueryKey({ clientId }) });
          notify.success('Contact created', { description: `${created?.displayName ?? displayName} is now in the directory.` });
          onSaved();
        },
        onError: (error) => notify.error(error, { title: 'Create failed', fallback: `${displayName} could not be created.` }),
      });
    }
  };

  const pending = createMutation.isPending || updateMutation.isPending;

  return <form onSubmit={submit} className="space-y-4 text-xs">
    <label className="block font-medium">Display name
      <input data-testid="input-contact-display" required value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 outline-none focus:border-primary" />
    </label>
    <label className="block font-medium">Legal name
      <input data-testid="input-contact-legal" required value={form.legalName} onChange={e => setForm(f => ({ ...f, legalName: e.target.value }))} className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 outline-none focus:border-primary" />
    </label>
    <label className="block font-medium">Type
      <select data-testid="select-contact-type" value={form.contactType} onChange={e => setForm(f => ({ ...f, contactType: e.target.value as 'customer' | 'supplier' | 'both' }))} className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 outline-none focus:border-primary">
        <option value="customer">Customer</option>
        <option value="supplier">Supplier</option>
        <option value="both">Both</option>
      </select>
    </label>

    <div>
      <label className="block font-medium">Aliases (match statement descriptions)</label>
      <div className="mt-1.5 flex gap-2">
        <input data-testid="input-contact-alias" value={aliasInput} onChange={e => setAliasInput(e.target.value)} onKeyDown={e => { if(e.key === 'Enter') { e.preventDefault(); addAlias(); } }} placeholder="e.g. AWS EMEA" className="h-9 flex-1 rounded-md border border-input bg-background px-3 outline-none focus:border-primary" />
        <button type="button" data-testid="button-add-alias" onClick={addAlias} className="rounded border border-border bg-card px-3 font-semibold hover:bg-muted">Add</button>
      </div>
      {form.aliases && form.aliases.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {form.aliases.map(alias => (
            <span key={alias} className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-1 text-[10px]">
              {alias}
              <button type="button" data-testid={`button-remove-alias-${alias}`} onClick={() => removeAlias(alias)} className="text-muted-foreground hover:text-foreground"><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
    </div>

    <div className="pt-2">
      <button data-testid="button-save-contact" disabled={pending} className="h-9 w-full rounded-md bg-primary font-semibold text-primary-foreground disabled:opacity-50">
        {pending ? 'Saving...' : 'Save contact'}
      </button>
    </div>
  </form>;
}

function ContactFormDialog({ onClose, clientId }: { onClose: () => void, clientId: number }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4 backdrop-blur-sm">
    <div className="w-full max-w-md rounded-lg border border-card-border bg-card p-6 shadow-2xl" role="dialog" aria-modal="true">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Directory</div>
          <h2 className="mt-2 text-lg font-semibold">Add Contact</h2>
        </div>
        <button data-testid="button-close-contact-dialog" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X size={17} /></button>
      </div>
      <div className="mt-6">
        <ContactForm clientId={clientId} onSaved={onClose} />
      </div>
    </div>
  </div>;
}

function ContactMergeDialog({ contacts, clientId, onClose, onMerged }: { contacts: Contact[], clientId: number, onClose: () => void, onMerged: (survivingContactId: number) => void }) {
  const previewMutation = usePreviewContactMerge();
  const mergeMutation = useMergeContacts();
  const [survivingContactId, setSurvivingContactId] = useState(contacts[0].id);
  const [preview, setPreview] = useState<ContactMergePreview | null>(null);
  const mergedContact = contacts.find((contact) => contact.id !== survivingContactId) ?? contacts[1];
  const survivingContact = contacts.find((contact) => contact.id === survivingContactId) ?? contacts[0];
  const input = { clientId, survivingContactId, mergedContactId: mergedContact.id };
  const blockingConflicts = preview?.conflicts.filter((conflict) => conflict.kind === 'belongs_to_other_contact') ?? [];

  const reviewMerge = () => {
    setPreview(null);
    previewMutation.mutate({ data: input }, {
      onSuccess: setPreview,
      onError: (error) => notify.error(error, { title: 'Merge preview failed', fallback: 'The merge preview could not be generated. Refresh the contacts and try again.' }),
    });
  };
  const confirmMerge = () => {
    if (!preview?.canMerge) return;
    mergeMutation.mutate({ data: input }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetContactsQueryKey({ clientId }) });
        queryClient.invalidateQueries({ queryKey: getGetContactHistoryQueryKey(clientId, survivingContactId) });
        queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetJournalEntriesQueryKey() });
        notify.success('Contacts merged', {
          description: `${mergedContact.displayName} was archived; ${survivingContact.displayName} kept as the active record.`,
        });
        onMerged(survivingContactId);
      },
      onError: (error) => notify.error(error, { title: 'Merge failed', fallback: 'The merge could not be completed. Refresh the contacts and review the merge again.' }),
    });
  };

  return <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4 backdrop-blur-sm">
    <div className="w-full max-w-xl rounded-lg border border-card-border bg-card p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="contact-merge-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Controlled merge</div>
          <h2 id="contact-merge-title" className="mt-2 text-lg font-semibold">Merge duplicate contacts</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose the record to keep, review every reassignment and alias conflict, then confirm once.</p>
        </div>
        <button data-testid="button-close-contact-merge" onClick={onClose} disabled={mergeMutation.isPending} className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"><X size={17} /></button>
      </div>

      <fieldset className="mt-6 grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-xs font-semibold">Surviving record</legend>
        {contacts.map((contact) => <label key={contact.id} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${survivingContactId === contact.id ? 'border-primary bg-primary/5' : 'border-border'}`}>
          <input data-testid={`radio-surviving-contact-${contact.id}`} type="radio" name="surviving-contact" checked={survivingContactId === contact.id} onChange={() => { setSurvivingContactId(contact.id); setPreview(null); previewMutation.reset(); mergeMutation.reset(); }} className="mt-0.5 accent-primary" />
          <span><span className="block text-xs font-semibold">{contact.displayName}</span><span className="mt-1 block text-[10px] text-muted-foreground">{contact.legalName}</span></span>
        </label>)}
      </fieldset>

      {!preview && <div className="mt-6 rounded-md border border-border bg-muted/30 p-4 text-xs leading-5 text-muted-foreground">
        <strong className="text-foreground">{survivingContact.displayName}</strong> will remain active. <strong className="text-foreground">{mergedContact.displayName}</strong> will be archived permanently and retained as a merge audit record.
      </div>}
      {preview && <div data-testid="contact-merge-preview" className="mt-6 space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Aliases', preview.counts.aliases],
            ['Review lines', preview.counts.statementLines],
            ['Journal links', preview.counts.journalEntries],
            ['Evidence records', preview.counts.evidenceRecords],
          ].map(([label, count]) => <div key={String(label)} className="rounded-md bg-muted/45 p-3"><div className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">{label}</div><div className="mt-1 text-lg font-semibold">{count}</div></div>)}
        </div>
        <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-[11px] leading-5 text-muted-foreground">
          Draft and posted debit/credit treatment will not change. Only the contact identity attached to the existing records is reassigned.
        </div>
        {preview.conflicts.length > 0 && <div className={`rounded-md border p-3 ${blockingConflicts.length ? 'border-destructive/25 bg-destructive/5' : 'border-accent/30 bg-accent/10'}`}>
          <div className="text-xs font-semibold">{blockingConflicts.length ? 'Resolve these alias conflicts first' : 'Alias handling'}</div>
          <ul className="mt-2 space-y-1.5 text-[11px] leading-5 text-muted-foreground">{preview.conflicts.map((conflict) => <li key={`${conflict.kind}-${conflict.alias}`}>• {conflict.message}</li>)}</ul>
        </div>}
      </div>}
      {(previewMutation.isError || mergeMutation.isError) && <p data-testid="contact-merge-error" className="mt-4 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">The merge could not be completed. Refresh the contacts and review the merge again.</p>}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} disabled={mergeMutation.isPending} className="rounded-md border border-border px-4 py-2.5 text-xs font-semibold disabled:opacity-50">Cancel</button>
        {!preview
          ? <button data-testid="button-review-contact-merge" type="button" onClick={reviewMerge} disabled={previewMutation.isPending} className="rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{previewMutation.isPending ? 'Reviewing…' : 'Review merge'}</button>
          : <button data-testid="button-confirm-contact-merge" type="button" onClick={confirmMerge} disabled={!preview.canMerge || mergeMutation.isPending} className="rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45">{mergeMutation.isPending ? 'Merging…' : `Keep ${survivingContact.displayName} and merge`}</button>}
      </div>
    </div>
  </div>;
}

function useHoverMenu(delay = 120) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openMenu = () => {
    cancelClose();
    setOpen(true);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), delay);
  };
  useEffect(() => () => cancelClose(), []);
  return { open, setOpen, openMenu, scheduleClose };
}

function FilterToolbar({
  search,
  onSearchChange,
  searchTestId,
  searchPlaceholder,
  children,
  activeCount,
  shownCount,
  totalCount,
  noun,
  onClear,
  clearTestId,
  countTestId,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  searchTestId: string;
  searchPlaceholder: string;
  children: ReactNode;
  activeCount: number;
  shownCount: number;
  totalCount: number;
  noun: string;
  onClear: () => void;
  clearTestId: string;
  countTestId: string;
}) {
  return (
    <div className="mb-4 rounded-lg border border-card-border bg-card px-4 py-3">
      <div className="relative flex flex-wrap items-center gap-1.5 rounded-md bg-background py-1 pl-9 pr-1.5 ring-1 ring-border focus-within:ring-1 focus-within:ring-primary">
        <Search className="pointer-events-none absolute left-3 top-2.5 text-muted-foreground" size={15} />
        <input data-testid={searchTestId} value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={searchPlaceholder} className="h-7 min-w-[12rem] flex-1 border-0 bg-transparent text-xs outline-none" />
        <div className="hidden h-5 w-px shrink-0 bg-border sm:block" />
        {children}
      </div>
      {activeCount > 0 && (
        <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
          <Filter size={12} className="text-muted-foreground" />
          <span data-testid={countTestId} className="text-[11px] text-muted-foreground">{activeCount} filter{activeCount === 1 ? '' : 's'} active · {shownCount} of {totalCount} {noun} shown</span>
          <button data-testid={clearTestId} type="button" onClick={onClear} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"><X size={12} /> Clear all</button>
        </div>
      )}
    </div>
  );
}

function FilterPills<const T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
  ariaLabel,
  compact = false,
  loading = false,
  loadingLabel,
}: {
  label: string;
  value: T;
  options: Array<{ value: NoInfer<T>; label: string; testId?: string }>;
  onChange: (value: T) => void;
  testId?: string;
  ariaLabel?: string;
  compact?: boolean;
  loading?: boolean;
  loadingLabel?: string;
}) {
  const { open, setOpen, openMenu, scheduleClose } = useHoverMenu();
  const selectedOption = options.find((option) => option.value === value) ?? options[0];
  if (compact && loading) {
    return (
      <span
        data-testid={testId}
        aria-label={ariaLabel ?? label}
        aria-busy="true"
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-muted/70 px-2 text-xs font-semibold text-muted-foreground"
      >
        <LoaderCircle size={12} className="animate-spin text-primary" />
        {loadingLabel ?? `Loading ${label.toLowerCase()}…`}
      </span>
    );
  }
  const select = (next: T) => {
    onChange(next);
    setOpen(false);
  };
  if (!compact) {
    return (
      <div className="flex min-w-0 items-center gap-1.5" role="group" aria-label={ariaLabel ?? label} data-testid={testId}>
        <span className="shrink-0 text-[10px] font-mono uppercase tracking-[.12em] text-muted-foreground">{label}</span>
        <div className="flex rounded-md bg-muted/70 p-0.5">
          {options.map((option) => {
            const selected = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                data-testid={option.testId}
                onClick={() => onChange(option.value)}
                className={`whitespace-nowrap rounded-[5px] px-2.5 py-1.5 text-xs font-semibold ${selected ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'}`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          aria-label={ariaLabel ?? label}
          aria-haspopup="listbox"
          aria-expanded={open}
          onMouseEnter={openMenu}
          onMouseLeave={scheduleClose}
          className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md bg-muted/70 px-2 text-xs font-semibold text-foreground outline-none hover:bg-muted"
        >
          {selectedOption.label}
          <ChevronDown size={12} className={`opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        collisionPadding={8}
        className="z-[80] w-auto min-w-[9.5rem] border bg-popover p-1 text-popover-foreground shadow-lg"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onMouseEnter={openMenu}
        onMouseLeave={scheduleClose}
      >
        <div role="listbox" aria-label={ariaLabel ?? label} className="flex flex-col">
          {options.map((option) => {
            const selected = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                data-testid={option.testId}
                onClick={() => select(option.value)}
                className={`rounded-md px-2.5 py-1.5 text-left text-xs font-semibold ${selected ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'}`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function parseLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toLocalISODate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatPickerDate(value: string) {
  const selected = parseLocalDate(value);
  return selected ? selected.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
}

function DatePickerField({
  value,
  onChange,
  label,
  placeholder,
  testId,
  compact = false,
  min,
  max,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  testId: string;
  compact?: boolean;
  min?: string;
  max?: string;
}) {
  const { open, setOpen, openMenu, scheduleClose } = useHoverMenu();
  const selected = parseLocalDate(value);
  const minDate = min ? parseLocalDate(min) : undefined;
  const maxDate = max ? parseLocalDate(max) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onMouseEnter={openMenu}
          onMouseLeave={scheduleClose}
          className={`inline-flex items-center justify-center px-1.5 text-left font-normal outline-none hover:bg-muted/80 ${compact ? 'h-7 text-[11px]' : 'h-9 px-2 text-xs'} ${value ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          <span className="whitespace-nowrap">{formatPickerDate(value) ?? placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" sideOffset={6} collisionPadding={8} className="z-[80] w-auto border bg-popover p-2 shadow-lg" onOpenAutoFocus={(event) => event.preventDefault()} onMouseEnter={openMenu} onMouseLeave={scheduleClose}>
        <Calendar
          key={`${value}-${min}-${max}`}
          mode="single"
          selected={selected}
          defaultMonth={selected ?? minDate ?? maxDate}
          disabled={(date) => {
            const day = toLocalISODate(date);
            return Boolean((min && day < min) || (max && day > max));
          }}
          onSelect={(date) => {
            onChange(date ? toLocalISODate(date) : '');
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function DateRangeFilter({ from, to, onFromChange, onToChange, fromTestId, toTestId, clearTestId, compact = false }: { from: string; to: string; onFromChange: (value: string) => void; onToChange: (value: string) => void; fromTestId: string; toTestId: string; clearTestId: string; compact?: boolean }) {
  const { open, setOpen, openMenu, scheduleClose } = useHoverMenu();
  const [activeField, setActiveField] = useState<'from' | 'to' | null>(null);
  const [fromDraft, setFromDraft] = useState(from);
  const [toDraft, setToDraft] = useState(to);
  const fromInputRef = useRef<HTMLInputElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const invalid = Boolean(from && to && from > to);
  const fromLabel = formatPickerDate(from);
  const toLabel = formatPickerDate(to);
  const triggerLabel = fromLabel && toLabel ? `${fromLabel} – ${toLabel}` : fromLabel ? `${fromLabel} – To` : toLabel ? `From – ${toLabel}` : 'Date';
  useEffect(() => { setFromDraft(from); }, [from]);
  useEffect(() => { setToDraft(to); }, [to]);
  useEffect(() => { if (!open) setActiveField(null); }, [open]);
  const applyTypedDate = (raw: string, field: 'from' | 'to') => {
    if (field === 'from') setFromDraft(raw); else setToDraft(raw);
    if (raw === '' || parseLocalDate(raw)) (field === 'from' ? onFromChange : onToChange)(raw);
  };
  if (!compact) {
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-1.5" data-testid={`${fromTestId}-group`}>
        <span className="text-[10px] font-mono uppercase tracking-[.12em] text-muted-foreground">Date range</span>
        <div className={`inline-flex items-center overflow-hidden rounded-md h-9 border bg-background pr-1 ${invalid ? 'border-destructive' : 'border-input'}`}>
          <CalendarDays size={14} className="ml-2 shrink-0 opacity-70" />
          <DatePickerField value={from} onChange={onFromChange} label="From date" placeholder="From" testId={fromTestId} max={to} />
          <span className="select-none px-0.5 text-[11px] text-muted-foreground">–</span>
          <DatePickerField value={to} onChange={onToChange} label="To date" placeholder="To" testId={toTestId} min={from} />
        </div>
        {(from || to) && <button data-testid={clearTestId} type="button" onClick={() => { onFromChange(''); onToChange(''); }} className="h-9 rounded-md px-2 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">Clear</button>}
        {invalid && <span data-testid={`${fromTestId}-error`} role="alert" className="basis-full text-[10px] font-semibold text-destructive">From date must be on or before the To date.</span>}
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-1.5" data-testid={`${fromTestId}-group`}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Date range"
            aria-haspopup="dialog"
            aria-expanded={open}
            onMouseEnter={openMenu}
            onMouseLeave={scheduleClose}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-muted/70 px-2 text-xs font-semibold text-foreground outline-none hover:bg-muted"
          >
            <CalendarDays size={12} className="opacity-70" />
            {triggerLabel}
            <ChevronDown size={12} className={`opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={6}
          collisionPadding={8}
          className="z-[80] w-[18rem] border bg-popover p-3 text-popover-foreground shadow-lg"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onMouseEnter={openMenu}
          onMouseLeave={(event) => {
            if (event.currentTarget.contains(document.activeElement)) return;
            scheduleClose();
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground">From</span>
              <input
                ref={fromInputRef}
                data-testid={fromTestId}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="YYYY-MM-DD"
                aria-label="From date"
                value={fromDraft}
                onFocus={() => setActiveField('from')}
                onChange={(event) => applyTypedDate(event.target.value, 'from')}
                className={`h-8 w-full rounded-md border bg-background px-2 font-mono text-[11px] outline-none focus:border-primary ${activeField === 'from' ? 'border-primary' : 'border-input'}`}
              />
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground">To</span>
              <input
                ref={toInputRef}
                data-testid={toTestId}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="YYYY-MM-DD"
                aria-label="To date"
                value={toDraft}
                onFocus={() => setActiveField('to')}
                onChange={(event) => applyTypedDate(event.target.value, 'to')}
                className={`h-8 w-full rounded-md border bg-background px-2 font-mono text-[11px] outline-none focus:border-primary ${activeField === 'to' ? 'border-primary' : 'border-input'}`}
              />
            </label>
          </div>
          <div className="mt-3" onMouseDown={(event) => event.preventDefault()}>
            <Calendar
              mode="range"
              selected={{ from: parseLocalDate(from), to: parseLocalDate(to) }}
              defaultMonth={parseLocalDate(from) ?? parseLocalDate(to)}
              onSelect={(range) => {
                onFromChange(range?.from ? toLocalISODate(range.from) : '');
                onToChange(range?.to ? toLocalISODate(range.to) : '');
                if (range?.from && !range.to) {
                  setActiveField('to');
                  window.setTimeout(() => toInputRef.current?.focus(), 0);
                }
              }}
              numberOfMonths={1}
              className="w-full bg-transparent p-0 [--cell-size:2.35rem]"
              classNames={{
                root: 'w-full',
                months: 'w-full',
                month: 'w-full',
                weekdays: 'grid w-full grid-cols-7',
                weekday: 'w-full text-center',
                week: 'mt-1 grid w-full grid-cols-7',
                day: 'w-full',
                today: 'rounded-md border border-primary/35 bg-transparent',
              }}
            />
          </div>
        </PopoverContent>
      </Popover>
      {(from || to) && <button data-testid={clearTestId} type="button" onClick={() => { onFromChange(''); onToChange(''); }} className="h-7 rounded-md px-2 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">Clear</button>}
      {invalid && <span data-testid={`${fromTestId}-error`} role="alert" className="text-[10px] font-semibold text-destructive">From date must be on or before the To date.</span>}
    </div>
  );
}

type PostLineDecision = {
  accountSuggestion: string | null;
  contactId: number | null;
  proposedContactName: string | null;
  proposedContactAlias: string | null;
  proposedContactType: 'customer' | 'supplier' | 'both' | null;
};

function StatementLinesPage() {
  const { activeClient } = useClientWorkspace();
  const [currency, setCurrency] = useState('all'); const [status, setStatus] = useState('all'); const [direction, setDirection] = useState<'all' | 'inflow' | 'outflow'>('all'); const [search, setSearch] = useState(''); const [addOpen, setAddOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState(''); const [dateTo, setDateTo] = useState('');
  const [sortKey, setSortKey] = useState<StatementSortKey>('date'); const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [linePage, setLinePage] = useState(1);
  const [expandedLineId, setExpandedLineId] = useState<number | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<number[]>([]);
  const [bulkAction, setBulkAction] = useState<BulkStatementAction | null>(null);
  const [bulkError, setBulkError] = useState<unknown>(null);
  const [lineActionError, setLineActionError] = useState<{ lineId: number; message: string } | null>(null);
  const [pendingPostLineIds, setPendingPostLineIds] = useState<number[]>([]);
  const [refreshingLines, setRefreshingLines] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const pendingPostLineIdsRef = useRef(new Set<number>());
  const bulkActionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const params = useMemo(() => ({ clientId: activeClient?.id ?? 1, ...(currency !== 'all' ? { currency } : {}), ...(status !== 'all' ? { status } : {}), ...(direction !== 'all' ? { direction } : {}) }), [activeClient?.id, currency, status, direction]);
  const catalogParams = useMemo(() => ({ clientId: activeClient?.id ?? 1 }), [activeClient?.id]);
  const query = useGetStatementLines(params, { query: { queryKey: getGetStatementLinesQueryKey(params) } });
  const catalogQuery = useGetStatementLines(catalogParams, { query: { queryKey: getGetStatementLinesQueryKey(catalogParams) } });
  const journalParams = { clientId: activeClient?.id ?? 1 };
  const journalQuery = useGetJournalEntries(journalParams, { query: { queryKey: getGetJournalEntriesQueryKey(journalParams) } });
  const bankAccountsQuery = useGetBankAccounts(journalParams);
  const post = usePostJournalEntry();
  const bulkMutation = useConfirmAICopilotAction();
  const entriesByLine = useMemo(() => new Map((journalQuery.data ?? []).map((entry) => [entry.statementLineId, entry])), [journalQuery.data]);
  const bankAccountsById = useMemo(() => new Map((bankAccountsQuery.data ?? []).map((account) => [account.id, account])), [bankAccountsQuery.data]);
  const rows = useMemo(() => {
    const filtered = (query.data ?? []).filter((line) => isDateInRange(line.date, dateFrom, dateTo) && `${line.description} ${line.accountSuggestion ?? ''} ${line.contactName ?? ''}`.toLowerCase().includes(search.toLowerCase()));
    return [...filtered].sort((left, right) => {
      const leftValue = sortKey === 'date' ? left.date
        : sortKey === 'description' ? left.description
          : sortKey === 'contact' ? left.contactName ?? ''
            : sortKey === 'account' ? left.accountSuggestion ?? ''
              : sortKey === 'amount' ? left.amount
                : sortKey === 'confidence' ? left.confidence ?? -1
                  : left.status;
      const rightValue = sortKey === 'date' ? right.date
        : sortKey === 'description' ? right.description
          : sortKey === 'contact' ? right.contactName ?? ''
            : sortKey === 'account' ? right.accountSuggestion ?? ''
              : sortKey === 'amount' ? right.amount
                : sortKey === 'confidence' ? right.confidence ?? -1
                  : right.status;
      const comparison = typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: 'base' });
      return (comparison || left.id - right.id) * (sortDirection === 'asc' ? 1 : -1);
    });
  }, [query.data, search, dateFrom, dateTo, sortKey, sortDirection]);
  const linePageCount = Math.max(1, Math.ceil(rows.length / STATEMENT_LINES_PAGE_SIZE));
  const currentLinePage = Math.min(linePage, linePageCount);
  const visibleRows = rows.slice((currentLinePage - 1) * STATEMENT_LINES_PAGE_SIZE, currentLinePage * STATEMENT_LINES_PAGE_SIZE);
  usePublishAssistantPageContext({
    route: '/statement-lines',
    selectedLineIds,
    visibleLineIds: visibleRows.map((line) => line.id),
    statementLineSearch: search.trim() || undefined,
  });
  const currencies = [...new Set((catalogQuery.data ?? []).map((line) => line.currency))].sort();
  const activeFilterCount = [search.trim() !== '', currency !== 'all', status !== 'all', direction !== 'all', Boolean(dateFrom || dateTo)].filter(Boolean).length;
  const clearAllFilters = () => { setSearch(''); setCurrency('all'); setStatus('all'); setDirection('all'); setDateFrom(''); setDateTo(''); };
  const selectedLines = useMemo(() => rows.filter((line) => selectedLineIds.includes(line.id)), [rows, selectedLineIds]);
  const selectedEntries = useMemo(() => selectedLines.map((line) => entriesByLine.get(line.id)), [selectedLines, entriesByLine]);
  const hasMissingEntries = selectedLines.some((_, index) => !selectedEntries[index]);
  const hasPostedSelection = selectedLines.some((line, index) => line.status.toLowerCase() === 'posted' || selectedEntries[index]?.status.toLowerCase() === 'posted');
  const allDraft = selectedLines.length > 0 && !hasMissingEntries && !hasPostedSelection && selectedEntries.every((entry) => entry?.status.toLowerCase() === 'draft');
  const allSelected = visibleRows.length > 0 && visibleRows.every((line) => selectedLineIds.includes(line.id));
  const selectionIssue = hasMissingEntries
    ? 'Some selected lines have no available journal entry. Remove them or refresh before continuing.'
    : hasPostedSelection
      ? 'Posted lines cannot be changed in bulk. Remove posted selections.'
      : selectedLines.length > 0 && !allDraft
        ? 'Select only draft entries for recoding or posting.'
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
    queryClient.invalidateQueries({ queryKey: getGetContactsQueryKey() });
  };
  useEffect(() => {
    setSelectedLineIds((current) => {
      const visibleIds = new Set(rows.map((line) => line.id));
      const next = current.filter((id) => visibleIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [rows, activeClient?.id]);
  useEffect(() => {
    setLinePage(1);
  }, [activeClient?.id, currency, status, direction, search, dateFrom, dateTo, sortKey, sortDirection]);
  useEffect(() => {
    if (linePage > linePageCount) setLinePage(linePageCount);
  }, [linePage, linePageCount]);
  useEffect(() => {
    if (!query.data) return;
    const byId = new Map(query.data.map((line) => [line.id, line]));
    setPendingPostLineIds((current) => {
      const next = current.filter((id) => {
        const line = byId.get(id);
        return Boolean(line && line.status.toLowerCase() !== 'posted');
      });
      pendingPostLineIdsRef.current = new Set(next);
      return next.length === current.length ? current : next;
    });
  }, [query.data]);
  const postEntry = (entry: JournalEntry, decision: PostLineDecision) => {
    if (pendingPostLineIdsRef.current.has(entry.statementLineId)) return;
    pendingPostLineIdsRef.current.add(entry.statementLineId);
    setLineActionError(null);
    setPendingPostLineIds((current) => current.includes(entry.statementLineId) ? current : [...current, entry.statementLineId]);
    post.mutate({ id: entry.id, data: { clientId: journalParams.clientId, ...decision } }, {
      onSuccess: () => {
        refreshPostedData();
        notify.success('Journal entry posted', {
          description: `Entry #${entry.id} is now live in reports.`,
        });
      },
      onError: (error) => {
        pendingPostLineIdsRef.current.delete(entry.statementLineId);
        setPendingPostLineIds((current) => current.filter((id) => id !== entry.statementLineId));
        const message = readErrorMessage(error, 'This entry could not be posted. Open the line and review the contact, account, and exchange rate.');
        setLineActionError({ lineId: entry.statementLineId, message });
        notify.error(error, { title: 'Post failed', description: message, fallback: message });
      },
    });
  };
  const unpost = useUnpostJournalEntry();
  const unpostEntry = (entry: JournalEntry) => {
    if (!window.confirm('Unpost this journal entry? It will leave live reports and return to draft.')) return;
    unpost.mutate({ id: entry.id, data: { clientId: journalParams.clientId } }, {
      onSuccess: () => {
        refreshPostedData();
        notify.success('Journal entry unposted', { description: `Entry #${entry.id} is back in draft.` });
      },
      onError: (error) => notify.error(error, { title: 'Unpost failed', fallback: 'This entry could not be unposted.' }),
    });
  };
  const openBulkAction = (type: BulkStatementAction['type'], trigger: HTMLButtonElement) => {
    const eligible = allDraft;
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
        const isRecode = bulkAction.type === 'recode_lines';
        const count = bulkAction.lineIds.length;
        setSelectedLineIds((current) => current.filter((id) => !bulkAction.lineIds.includes(id)));
        setBulkAction(null);
        setBulkError(null);
        refreshPostedData();
        notify.success(
          isRecode
            ? `${count} line${count === 1 ? '' : 's'} recoded`
            : `${count} entr${count === 1 ? 'y' : 'ies'} posted`,
          { description: isRecode ? `Applied ${accountSuggestion ?? 'the selected account'} to draft classification.` : 'Now live in reports.' },
        );
      },
      onError: (error) => {
        setBulkError(error);
        refreshPostedData();
        notify.error(error, {
          title: bulkAction.type === 'recode_lines' ? 'Bulk recode failed' : 'Bulk post failed',
          fallback: 'The bulk action could not be applied. Refresh the queue and try again.',
        });
      },
    });
  };
  const toggleLineSelection = (lineId: number) => setSelectedLineIds((current) => current.includes(lineId) ? current.filter((id) => id !== lineId) : [...current, lineId]);
  const sortStatementLines = (column: string) => {
    const nextColumn = column as StatementSortKey;
    if (nextColumn === sortKey) setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(nextColumn);
      setSortDirection('asc');
    }
  };
  const refreshingSuggestions = query.isFetching || catalogQuery.isFetching || journalQuery.isFetching || bankAccountsQuery.isFetching;
  const refreshSuggestions = async () => {
    if (refreshingSuggestions || refreshingLines) return;
    const refreshStartedAt = Date.now();
    setRefreshingLines(true);
    setLineActionError(null);
    // Statement-line GET recomputes learned account/contact suggestions from current
    // workspace patterns, so an explicit refetch is enough to surface new learning.
    try {
      await Promise.all([
        query.refetch(),
        catalogQuery.refetch(),
        journalQuery.refetch(),
        bankAccountsQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: getGetContactsQueryKey({ clientId: journalParams.clientId }) }),
        queryClient.invalidateQueries({ queryKey: getGetLedgerflowAccountsQueryKey({ clientId: journalParams.clientId }) }),
      ]);
      const elapsed = Date.now() - refreshStartedAt;
      if (elapsed < 500) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 500 - elapsed));
      }
      notify.success('Suggestions refreshed', {
        description: 'Draft accounts and contacts now reflect the latest learning.',
      });
      setLastRefreshAt(new Date());
    } catch (error) {
      notify.error(error, { title: 'Refresh failed', fallback: 'Some suggestions could not be reloaded. Try again in a moment.' });
    } finally {
      setRefreshingLines(false);
    }
  };
  return <div>
    <PageHeading
      eyebrow="Evidence review / bank activity"
      title="Statement lines"
      description="Start with the source. Review each movement, inspect its linked draft journal entry, then post only the entries you stand behind."
      action={<div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="button-refresh-statement-lines"
          title="Reload statement lines and refresh learned account and contact suggestions"
          onClick={() => { void refreshSuggestions(); }}
          disabled={refreshingSuggestions || refreshingLines}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-xs font-semibold text-muted-foreground shadow-sm transition-transform hover:-translate-y-0.5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
        >
          <RefreshCw size={14} className={refreshingSuggestions || refreshingLines ? 'animate-spin' : ''} />
          {refreshingSuggestions || refreshingLines ? 'Refreshing…' : 'Refresh suggestions'}
        </button>
        <button data-testid="button-add-line" onClick={() => setAddOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5"><Plus size={14} /> Add line</button>
      </div>}
    />
    <FilterToolbar
      search={search}
      onSearchChange={setSearch}
      searchTestId="input-search-lines"
      searchPlaceholder="Search descriptions, contacts, or accounts"
      activeCount={activeFilterCount}
      shownCount={rows.length}
      totalCount={query.data?.length ?? 0}
      noun="lines"
      onClear={clearAllFilters}
      clearTestId="button-clear-all-filters"
      countTestId="text-active-filter-count"
    >
        <FilterPills<typeof direction>
          compact
          label="Type"
          ariaLabel="Filter by statement type"
          testId="select-direction-filter"
          value={direction}
          onChange={setDirection}
          options={[{ value: 'all', label: 'All' }, { value: 'inflow', label: 'Receipts' }, { value: 'outflow', label: 'Payments' }]}
        />
        <FilterPills
          compact
          label="Status"
          testId="select-status-filter"
          value={status}
          onChange={setStatus}
          options={[{ value: 'all', label: 'All' }, { value: 'draft', label: 'Draft' }, { value: 'posted', label: 'Posted' }]}
        />
        <FilterPills
          compact
          label="Currency"
          ariaLabel="Filter by currency"
          testId="select-currency-filter"
          value={currency}
          onChange={setCurrency}
          options={[{ value: 'all', label: 'All currencies' }, ...currencies.map((item) => ({ value: item, label: item }))]}
          loading={catalogQuery.isLoading}
          loadingLabel="Detecting currencies…"
        />
        <DateRangeFilter compact from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} fromTestId="input-statement-lines-date-from" toTestId="input-statement-lines-date-to" clearTestId="button-clear-statement-lines-date-filter" />
    </FilterToolbar>
    <QueryState loading={query.isLoading} error={query.isError} empty={!rows.length} filtered={activeFilterCount > 0} onClearFilters={clearAllFilters} onRetry={() => query.refetch()}>
      <div
        data-testid="statement-lines-review-queue"
        aria-busy={refreshingLines}
        className="relative overflow-hidden rounded-lg border border-card-border bg-card"
      >
        {refreshingLines && <div data-testid="statement-lines-refresh-state" className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-card/75 p-6 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-full border border-primary/25 bg-background/95 px-4 py-2.5 text-xs font-semibold text-primary shadow-lg" role="status" aria-live="polite">
            <RefreshCw size={14} className="animate-spin" />
            Refreshing review queue…
          </div>
        </div>}
         <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><span className="text-sm font-semibold">Review queue</span><span data-testid="text-visible-line-count" className="ml-2 rounded-full bg-secondary px-2 py-1 font-mono text-[10px] text-primary">{rows.length} lines</span></div><div className="flex items-center gap-3">{lastRefreshAt && <span data-testid="statement-lines-refresh-success" title={`Last refreshed ${lastRefreshAt.toLocaleTimeString()}`} className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[.08em] text-primary"><Check size={12} /> Queue refreshed</span>}<span className="font-mono text-[10px] text-muted-foreground">Click a line to inspect · post an eligible draft when ready</span></div></div>
        {selectedLines.length > 0 && <div data-testid="bulk-action-toolbar" className="border-b border-primary/20 bg-primary/5 px-5 py-3"><div className="flex flex-wrap items-center gap-2"><span data-testid="text-selected-line-count" className="mr-2 text-xs font-semibold">{selectedLines.length} selected</span><button data-testid="button-bulk-post" onClick={(event) => openBulkAction('bulk_post_entries', event.currentTarget)} disabled={!allDraft || bulkMutation.isPending} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"><Check size={13} /> Post selected</button><button data-testid="button-bulk-recode" onClick={(event) => openBulkAction('recode_lines', event.currentTarget)} disabled={!allDraft || bulkMutation.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-background px-2.5 py-1.5 text-[11px] font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-40">Recode selected</button></div><p data-testid="text-bulk-selection-guidance" className={`mt-2 text-[10px] ${selectionIssue ? 'text-destructive' : 'text-muted-foreground'}`}>{selectionIssue ?? 'Draft entries selected · recoding and posting are available.'}</p></div>}
         <div className="overflow-x-auto"><table className="w-full min-w-[1220px] table-fixed text-left"><thead className="bg-muted/55 font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground"><tr><th className="w-12 px-4 py-3"><input data-testid="checkbox-select-all-lines" type="checkbox" aria-label={allSelected ? 'Clear all visible statement lines' : 'Select all visible statement lines'} checked={allSelected} onChange={() => setSelectedLineIds(allSelected ? [] : visibleRows.map((line) => line.id))} className="size-4 accent-primary" /></th><th className="w-[92px] px-3 py-3 font-medium"><SortControl label="Date" column="date" activeColumn={sortKey} direction={sortDirection} onSort={sortStatementLines} testId="button-sort-statement-lines-date" /></th><th className="w-[360px] px-4 py-3 font-medium"><SortControl label="Source description" column="description" activeColumn={sortKey} direction={sortDirection} onSort={sortStatementLines} testId="button-sort-statement-lines-description" /></th><th className="w-[160px] px-4 py-3 font-medium"><SortControl label="Contact" column="contact" activeColumn={sortKey} direction={sortDirection} onSort={sortStatementLines} testId="button-sort-statement-lines-contact" /></th><th className="w-[180px] px-4 py-3 font-medium"><SortControl label="Suggested account" column="account" activeColumn={sortKey} direction={sortDirection} onSort={sortStatementLines} testId="button-sort-statement-lines-account" /></th><th className="w-[130px] px-4 py-3 font-medium"><SortControl label="Amount" column="amount" activeColumn={sortKey} direction={sortDirection} onSort={sortStatementLines} testId="button-sort-statement-lines-amount" /></th><th className="w-[100px] px-4 py-3 font-medium"><SortControl label="Confidence" column="confidence" activeColumn={sortKey} direction={sortDirection} onSort={sortStatementLines} testId="button-sort-statement-lines-confidence" /></th><th className="w-[100px] px-4 py-3 font-medium"><SortControl label="Status" column="status" activeColumn={sortKey} direction={sortDirection} onSort={sortStatementLines} testId="button-sort-statement-lines-status" /></th><th className="w-[148px] px-3 py-3 text-right font-medium">Action</th></tr></thead><tbody className="divide-y divide-border">{visibleRows.map((line) => <InlineStatementRow key={line.id} line={line} bankAccountName={line.bankAccountId == null ? undefined : bankAccountsById.get(line.bankAccountId)?.name} entry={entriesByLine.get(line.id)} expanded={expandedLineId === line.id} selected={selectedLineIds.includes(line.id)} journalLoading={journalQuery.isLoading} processing={Boolean(pendingPostLineIds.includes(line.id) || post.isPending && post.variables?.id === entriesByLine.get(line.id)?.id || unpost.isPending && unpost.variables?.id === entriesByLine.get(line.id)?.id || bulkMutation.isPending && bulkAction?.lineIds.includes(line.id))} actionError={lineActionError?.lineId === line.id ? lineActionError.message : null} onToggle={() => setExpandedLineId(expandedLineId === line.id ? null : line.id)} onToggleSelected={() => toggleLineSelection(line.id)} onPost={postEntry} onUnpost={unpostEntry} />)}</tbody></table></div>
        {rows.length > STATEMENT_LINES_PAGE_SIZE && <div data-testid="pagination-statement-lines" className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-[11px] text-muted-foreground"><span>Showing {(currentLinePage - 1) * STATEMENT_LINES_PAGE_SIZE + 1}–{Math.min(currentLinePage * STATEMENT_LINES_PAGE_SIZE, rows.length)} of {rows.length} lines</span><div className="flex items-center gap-2"><button type="button" aria-label="Previous statement-lines page" onClick={() => setLinePage((page) => Math.max(1, page - 1))} disabled={currentLinePage === 1} className="rounded border border-border px-2 py-1 font-semibold disabled:cursor-not-allowed disabled:opacity-50">Previous</button><span className="font-mono">Page {currentLinePage} of {linePageCount}</span><button type="button" aria-label="Next statement-lines page" onClick={() => setLinePage((page) => Math.min(linePageCount, page + 1))} disabled={currentLinePage === linePageCount} className="rounded border border-border px-2 py-1 font-semibold disabled:cursor-not-allowed disabled:opacity-50">Next</button></div></div>}
      </div>
    </QueryState>
    {addOpen && <AddLineDialog onClose={() => { setAddOpen(false); queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetJournalEntriesQueryKey() }); }} />}
    {bulkAction && <BulkStatementActionDialog action={bulkAction} lines={rows.filter((line) => bulkAction.lineIds.includes(line.id))} pending={bulkMutation.isPending} error={bulkError} onCancel={cancelBulkAction} onConfirm={confirmBulkAction} />}
  </div>;
}
function StatementRow({ line }: { line: StatementLine }) {
  const positive = line.direction.toLowerCase().includes('credit') || line.direction.toLowerCase().includes('in'); const confidence = line.confidence == null ? null : Math.round(line.confidence * 100);
  return <tr data-testid={`row-statement-line-${line.id}`} className="group transition-colors hover:bg-secondary/30"><td className="whitespace-nowrap px-5 py-4 font-mono text-[11px] text-muted-foreground">{shortDate(line.date)}</td><td className="max-w-[250px] px-4 py-4"><div className="truncate text-[12px] font-semibold">{line.description}</div><div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className="rounded bg-muted px-1.5 py-0.5">{line.source}</span><span>· {line.currency}</span></div></td><td className="px-4 py-4"><div className="text-[12px]">{line.accountSuggestion || 'Needs account call'}</div><div className="mt-1 text-[10px] text-muted-foreground">AI suggestion</div></td><td className={`whitespace-nowrap px-4 py-4 font-mono text-[12px] font-medium ${positive ? 'text-primary' : 'text-foreground'}`}>{positive ? '+' : '−'}{money(Math.abs(line.amount), line.currency)}</td><td className="px-4 py-4">{confidence == null ? <span className="text-[11px] text-muted-foreground">Unscored</span> : <div className="flex items-center gap-2"><div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${confidence > 85 ? 'bg-primary' : 'bg-accent'}`} style={{ width: `${confidence}%` }} /></div><span className="font-mono text-[10px]">{confidence}%</span></div>}</td><td className="px-4 py-4"><StatusPill status={line.status} /></td></tr>;
}

function InlineStatementRow({ line, bankAccountName, entry, expanded, selected, journalLoading, processing, actionError, onToggle, onToggleSelected, onPost, onUnpost }: { line: StatementLine; bankAccountName?: string; entry: JournalEntry | undefined; expanded: boolean; selected: boolean; journalLoading: boolean; processing: boolean; actionError: string | null; onToggle: () => void; onToggleSelected: () => void; onPost: (entry: JournalEntry, decision: PostLineDecision) => void; onUnpost: (entry: JournalEntry) => void }) {
  const { activeClient } = useClientWorkspace();
  const accountParams = { clientId: activeClient?.id ?? 0 };
  const accountQuery = useGetLedgerflowAccounts(accountParams, { query: { queryKey: getGetLedgerflowAccountsQueryKey(accountParams) } });
  const accounts = accountQuery.data ?? [];
  const positive = line.direction.toLowerCase().includes('credit') || line.direction.toLowerCase().includes('in');
  const confidence = line.confidence == null ? null : Math.round(line.confidence * 100);
  const posted = line.status.toLowerCase() === 'posted';
  const canConfirmClassification = !posted && entry?.status.toLowerCase() === 'draft';
  const accountConfirmationRequired = line.accountConfirmationRequired;
  const journalClassifiedAccount = entry
    ? (line.direction === 'inflow'
      ? entry.lines.find((item) => item.credit > 0)?.account
      : entry.lines.find((item) => item.debit > 0)?.account)
    : undefined;
  const resolveSelectableAccount = (preferred?: string | null) => {
    if (preferred && accounts.some((account) => account.accountName === preferred)) return preferred;
    if (journalClassifiedAccount && accounts.some((account) => account.accountName === journalClassifiedAccount)) {
      return journalClassifiedAccount;
    }
    return accounts[0]?.accountName ?? preferred ?? '';
  };
  const [selectedAccount, setSelectedAccount] = useState(() => resolveSelectableAccount(line.accountSuggestion));
  const saveAccount = useConfirmAICopilotAction();
  const accountSelectionEditedRef = useRef(false);
  useEffect(() => {
    setSelectedAccount((current) => {
      if (accountSelectionEditedRef.current && accounts.some((account) => account.accountName === current)) {
        return current;
      }
      return resolveSelectableAccount(line.accountSuggestion);
    });
  }, [accounts, line.accountSuggestion, journalClassifiedAccount]);
  const debitLine = entry?.lines.find((item) => item.debit > 0);
  const creditLine = entry?.lines.find((item) => item.credit > 0);
  const previewLines = useMemo(() => {
    const rows = entry?.lines ?? [];
    if (!selectedAccount) return rows;
    const inflow = line.direction === 'inflow';
    return rows.map((journalLine) => {
      const classifiedLeg = inflow ? journalLine.credit > 0 : journalLine.debit > 0;
      return classifiedLeg ? { ...journalLine, account: selectedAccount } : journalLine;
    });
  }, [entry?.lines, selectedAccount, line.direction]);
  const sourceAmount = debitLine?.debit ?? creditLine?.credit ?? line.amount;
  const functionalCurrency = entry?.functionalCurrency ?? line.functionalCurrency;
  const functionalAmount = entry?.functionalAmount ?? line.functionalAmount;
  const exchangeRate = entry?.exchangeRate ?? line.exchangeRate;
  const exchangeRateEffectiveDate = entry?.exchangeRateEffectiveDate ?? line.exchangeRateEffectiveDate;
  const exchangeRateStatus = entry?.exchangeRateStatus ?? line.exchangeRateStatus;
  const exchangeRateSourceScope = entry?.exchangeRateSourceScope ?? line.exchangeRateSourceScope;
  const baseCurrency = functionalCurrency ?? entry?.currency ?? line.currency;
  const isForeignCurrency = Boolean(entry && functionalCurrency && entry.currency !== functionalCurrency);

  const contactsQuery = useGetContacts({ clientId: activeClient?.id ?? 0 }, { query: { queryKey: getGetContactsQueryKey({ clientId: activeClient?.id ?? 0 }), enabled: expanded } });
  const contacts = contactsQuery.data ?? [];
  const canEditContact = entry?.status.toLowerCase() === 'draft';
  const selectableContacts = contacts.filter((contact) => contact.status === 'active' || contact.id === line.contactId);
  const [selectedContactId, setSelectedContactId] = useState<string>(line.contactId ? String(line.contactId) : '');
  const contactSelectionEditedRef = useRef(false);
  const [proposedContactName, setProposedContactName] = useState(line.proposedContactName ?? '');
  const [proposedContactType, setProposedContactType] = useState<'customer' | 'supplier' | 'both'>(
    line.proposedContactType ?? (line.direction === 'inflow' ? 'customer' : 'supplier'),
  );
  const likelyContactType = line.direction === 'inflow' ? 'customer' : 'supplier';
  const hasTemporaryProposal = line.contactDecisionState === 'named_proposal';
  const needsIdentification = line.contactDecisionState === 'needs_identification';
  const contactProposalSource = line.proposedContactSource === 'ai_counterparty_extraction'
    ? 'AI grounded extraction'
    : line.proposedContactSource === 'heuristic_description'
      ? 'Narration fallback'
      : (line.proposedContactSource ?? 'Description').replaceAll('_', ' ');
  // Nothing here requires a separate confirm step anymore: whatever contact is
  // selected (or typed as a proposal) and whichever account is chosen below is
  // applied atomically when the line is posted.
  const showContactProposalEditor = selectedContactId === '';
  const willCreateContact = selectedContactId === '' && proposedContactName.trim() !== '';
  useEffect(() => {
    setSelectedContactId((current) => {
      if (contactSelectionEditedRef.current && contacts.some((contact) => contact.id === Number(current) && contact.status === 'active')) {
        return current;
      }
      return line.contactId ? String(line.contactId) : '';
    });
    setProposedContactName(line.proposedContactName ?? '');
    setProposedContactType(line.proposedContactType ?? (line.direction === 'inflow' ? 'customer' : 'supplier'));
  }, [contacts, line.contactId, line.proposedContactName, line.proposedContactType, line.direction]);

  const toggleFromRow = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle();
    }
  };
  const missingRate = Boolean(entry && functionalCurrency && entry.currency !== functionalCurrency && (exchangeRateStatus === 'missing' || functionalAmount == null));
  const knownAccount = accounts.some((account) => account.accountName === selectedAccount);
  const postBlocked = processing || missingRate || !entry;
  const clippedName = proposedContactName.trim().slice(0, 160) || null;
  const postDecision: PostLineDecision = {
    accountSuggestion: knownAccount ? selectedAccount : (resolveSelectableAccount(line.accountSuggestion) || null),
    contactId: selectedContactId ? Number(selectedContactId) : null,
    proposedContactName: selectedContactId ? null : clippedName,
    proposedContactAlias: selectedContactId ? null : clippedName,
    proposedContactType: selectedContactId || !clippedName ? null : proposedContactType,
  };
  const postLabel = willCreateContact ? 'Post & create' : 'Post';
  const postTitle = missingRate
    ? 'Add a dated exchange rate before posting this foreign-currency line.'
    : willCreateContact
      ? `Posts now and creates ${proposedContactName.trim()} as a contact`
      : selectedContactId
        ? 'Posts this journal entry now'
        : 'Posts this journal entry now, unlinked to a contact';
  const rowAction = posted
    ? <div data-testid={`posted-line-${line.id}`} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary"><CircleCheck size={14} /> Posted</div>
    : !entry
      ? <span className="text-[11px] text-muted-foreground">{journalLoading ? 'Loading…' : 'Unavailable'}</span>
      : <button
          type="button"
          data-testid={`button-post-line-${line.id}`}
          title={postTitle}
          aria-disabled={postBlocked}
          disabled={postBlocked}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (postBlocked) return;
            onPost(entry, postDecision);
          }}
          className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground ${postBlocked ? 'cursor-not-allowed opacity-50' : ''}`}
        >{processing ? 'Posting…' : <><Check size={13} /> {postLabel}</>}</button>;

  return <>
    <tr data-testid={`row-statement-line-${line.id}`} tabIndex={0} aria-expanded={expanded} aria-selected={selected} onClick={onToggle} onKeyDown={toggleFromRow} className={`group cursor-pointer transition-colors hover:bg-secondary/30 focus:outline-none focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${expanded ? 'bg-secondary/20' : ''}`}>
      <td className="w-12 px-4 py-4" onClick={(event) => event.stopPropagation()}><input data-testid={`checkbox-select-line-${line.id}`} type="checkbox" aria-label={`Select statement line ${line.description}`} checked={selected} onChange={onToggleSelected} className="size-4 accent-primary" /></td>
      <td className="whitespace-nowrap px-3 py-4 font-mono text-[11px] text-muted-foreground">{shortDate(line.date)}</td>
      <td className="w-[360px] max-w-[360px] px-4 py-4 align-top"><div className="w-full whitespace-normal break-words text-[12px] font-semibold [overflow-wrap:anywhere]">{line.description}</div><div className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden text-[9px] text-muted-foreground" title={[line.source, line.currency, bankAccountName].filter(Boolean).join(' · ')}><span className="shrink-0 rounded bg-muted px-1 py-0.5">{line.currency}</span><span className="min-w-0 truncate">{line.source.replace(/^Imported:\s+\d+\s+[A-Z]{3}\s+/i, '')}</span></div></td>
      <td className="px-4 py-4 align-middle">
        <div className="text-[12px] font-semibold">{line.contactName || (hasTemporaryProposal ? line.proposedContactName : needsIdentification ? <span data-testid={`unknown-contact-${line.id}`} className="text-destructive">Unknown {likelyContactType}</span> : <span className="font-normal text-muted-foreground">Keep unlinked</span>)}</div>
        {hasTemporaryProposal && <div data-testid={`temporary-contact-proposal-${line.id}`} className="mt-1 text-[9px] font-bold uppercase tracking-[.05em] text-accent-foreground">{line.contactReviewDisposition === 'accepted' ? 'Confirmed for posting' : 'Temporary proposal'}</div>}
        {hasTemporaryProposal && <div className="mt-1 text-[9px] leading-3 text-muted-foreground">{Math.round((line.proposedContactConfidence ?? 0) * 100)}% · {contactProposalSource} · creates on posting</div>}
        {needsIdentification && <div data-testid={`needs-contact-identification-${line.id}`} className="mt-1 text-[9px] font-bold uppercase tracking-[.05em] text-destructive">Needs identification</div>}
        {line.contactDecisionState === 'dismissed' && <div data-testid={`dismissed-contact-decision-${line.id}`} className="mt-1 text-[9px] font-bold uppercase tracking-[.05em] text-muted-foreground">Explicitly dismissed</div>}
        {line.contactName && line.contactSuggestionStatus && (
          <div className={`mt-1 text-[9px] uppercase tracking-[.05em] ${line.contactSuggestionStatus === 'supported' ? 'text-primary font-bold' : line.contactSuggestionStatus === 'conflicting' ? 'text-destructive font-bold' : 'text-muted-foreground'}`}>{line.contactSuggestionStatus.replace(/_/g, ' ')}</div>
        )}
      </td>
      <td className="px-4 py-4 align-middle"><div className="text-[12px]">{line.accountSuggestion || 'Needs account call'}</div><div data-testid={line.suggestionSource === 'workspace_learning' ? `workspace-learning-line-${line.id}` : undefined} className={`mt-1 text-[10px] ${line.suggestionSource === 'workspace_learning' ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>{line.suggestionSource === 'workspace_learning' ? `Account learned · ${line.supportingPatternCount} confirmed pattern${line.supportingPatternCount === 1 ? '' : 's'}` : 'AI suggestion'}</div>{accountConfirmationRequired && <div data-testid={`learned-account-not-applied-${line.id}`} className="mt-1 text-[9px] font-bold uppercase tracking-[.05em] text-accent-foreground">Optional suggestion · current draft uses {line.journalAccount}</div>}</td>
      <td className={`whitespace-nowrap px-4 py-4 font-mono text-[12px] font-medium ${positive ? 'text-primary' : 'text-foreground'}`}>{positive ? '+' : '−'}{money(Math.abs(line.amount), line.currency)}</td>
      <td className="px-4 py-4">{confidence == null ? <span className="text-[11px] text-muted-foreground">Unscored</span> : <div className="flex items-center gap-1.5" role="img" aria-label={`Confidence ${confidence}%`}><div className="grid size-7 place-items-center rounded-full" style={{ background: `conic-gradient(hsl(var(--primary)) ${confidence}%, hsl(var(--muted)) 0)` }}><div className="grid size-5 place-items-center rounded-full bg-card font-mono text-[8px]">{confidence}</div></div><span className="font-mono text-[10px]">%</span></div>}</td>
      <td className="px-4 py-4"><StatusPill status={line.status} /></td>
      <td className="px-3 py-4 text-right align-middle" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-col items-end gap-1">
          {rowAction}
          {missingRate && !posted && <p className="max-w-[11rem] text-left text-[10px] leading-3 text-destructive">Needs an exchange rate</p>}
          {actionError && <p data-testid={`post-error-${line.id}`} className="max-w-[11rem] text-left text-[10px] leading-3 text-destructive">{actionError}</p>}
        </div>
      </td>
    </tr>
    {expanded && <tr data-testid={`detail-statement-line-${line.id}`}><td colSpan={9} className="bg-secondary/25 px-4 py-3">
      {journalLoading ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><RefreshCw size={14} className="animate-spin" /> Loading linked journal entry…</div> : !entry ? <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive"><CircleAlert size={15} /> No journal entry is linked to this statement line yet.</div> : <section className="overflow-hidden rounded-lg border border-card-border bg-card">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[.12em] text-primary">JE-{String(entry.id).padStart(4, '0')}</span>
          <StatusPill status={entry.status} />
          <span data-testid={`journal-amount-${line.id}`} className="ml-auto font-mono text-xs font-semibold">{money(sourceAmount, entry.currency)}</span>
          <span data-testid={`journal-confidence-${line.id}`} className="font-mono text-[10px] text-muted-foreground">{Math.round(entry.confidence * 100)}%</span>
          {posted && <button data-testid={`button-unpost-line-${line.id}`} title="Return this entry to the review queue" onClick={(event) => { event.stopPropagation(); onUnpost(entry); }} disabled={processing} className="inline-flex items-center gap-1.5 rounded-md border border-accent/35 px-2 py-1 text-[11px] font-semibold text-accent-foreground hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50">{processing ? 'Unposting…' : 'Unpost'}</button>}
        </header>
        {entry.memo && <p className="line-clamp-2 border-b border-border/70 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground" title={entry.memo}>{entry.memo}</p>}
        <div className="grid gap-3 p-3 lg:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Review</div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex w-14 shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground">
                  Contact
                  {contactsQuery.isFetching && <LoaderCircle size={11} className="animate-spin text-primary" aria-label="Refreshing contacts" />}
                </span>
                <select
                  data-testid={`select-contact-${line.id}`}
                  aria-label="Contact"
                  aria-busy={contactsQuery.isLoading}
                  disabled={!canEditContact || contactsQuery.isLoading}
                  value={selectedContactId}
                  onChange={(event) => { contactSelectionEditedRef.current = true; setSelectedContactId(event.target.value); }}
                  className="h-8 min-w-[10rem] flex-1 rounded-md border border-input bg-background px-2 text-xs font-normal outline-none focus:border-primary disabled:opacity-50"
                >
                  {contactsQuery.isLoading
                    ? <option value="">Loading contacts…</option>
                    : <>
                      <option value="">{needsIdentification ? `Identify ${likelyContactType}` : 'No contact'}</option>
                      {selectableContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.displayName} ({contact.contactType}{contact.status === 'archived' ? ', archived' : ''})</option>)}
                    </>}
                </select>
              </div>
              {showContactProposalEditor && <div data-testid={`contact-proposal-editor-${line.id}`} className="flex flex-wrap items-center gap-2 pl-16">
                <input data-testid={`input-proposed-contact-name-${line.id}`} aria-label="Contact name" placeholder="Name" disabled={!canEditContact} value={proposedContactName} onChange={(event) => setProposedContactName(event.target.value)} className="h-8 min-w-[8rem] flex-1 rounded-md border border-input bg-background px-2 text-xs font-normal outline-none focus:border-primary disabled:opacity-50" />
                <select data-testid={`select-proposed-contact-type-${line.id}`} aria-label="Contact type" disabled={!canEditContact} value={proposedContactType} onChange={(event) => setProposedContactType(event.target.value as 'customer' | 'supplier' | 'both')} className="h-8 w-[8.75rem] rounded-md border border-input bg-background px-2 text-xs font-normal outline-none focus:border-primary disabled:opacity-50"><option value="customer">Customer</option><option value="supplier">Supplier</option><option value="both">Both</option></select>
              </div>}
              {(line.contactSuggestionReason || showContactProposalEditor) && <p className="pl-16 text-[10px] leading-4 text-muted-foreground">{line.contactSuggestionReason || 'Creates on post, or leave blank to post unlinked.'}</p>}
              {isForeignCurrency && <div data-testid={`currency-conversion-${line.id}`} className={`rounded-md border px-2.5 py-2 ${exchangeRateStatus === 'missing' || functionalAmount == null ? 'border-destructive/20 bg-destructive/5' : 'border-border bg-muted/20'}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span data-testid={`conversion-source-${line.id}`} className="font-mono text-[11px] font-semibold">{money(sourceAmount, entry.currency)}</span>
                  <span className="text-[10px] text-muted-foreground">→</span>
                  <span data-testid={`conversion-base-${line.id}`} className="font-mono text-[11px] font-semibold">{functionalAmount == null ? 'Unconverted' : money(functionalAmount, baseCurrency)}</span>
                  <span data-testid={`conversion-rate-${line.id}`} className="font-mono text-[10px] text-muted-foreground">{exchangeRate == null ? 'Rate unavailable' : `@ ${exchangeRate.toFixed(6)}`}</span>
                  <span className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[.06em] ${exchangeRateStatus === 'exact' ? 'bg-primary/10 text-primary' : exchangeRateStatus === 'prior' ? 'bg-accent/15 text-accent-foreground' : 'bg-destructive/10 text-destructive'}`}>{exchangeRateStatus === 'exact' ? 'Exact-date' : exchangeRateStatus === 'prior' ? 'Prior rate' : 'Missing'}</span>
                  {exchangeRateSourceScope === 'system' && <span data-testid={`system-rate-source-${line.id}`} className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[.06em] text-muted-foreground">System</span>}
                </div>
                {exchangeRateEffectiveDate && <p className="mt-1 text-[10px] text-muted-foreground">Effective {shortDate(exchangeRateEffectiveDate)}</p>}
                {exchangeRateStatus === 'prior' && exchangeRateEffectiveDate && <p className="mt-1 text-[10px] text-accent-foreground">Used the latest rate before {shortDate(entry.date)}.</p>}
                {exchangeRateStatus === 'missing' && <p className="mt-1 text-[10px] text-destructive">Add a dated exchange rate to include this in base-currency reporting.</p>}
              </div>}
            </div>
          </div>
          <div className="min-w-0">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Posting</div>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-muted/55 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-1.5 font-medium">Account</th>
                    <th className="w-[5.75rem] px-2.5 py-1.5 text-right font-medium">Debit</th>
                    <th className="w-[5.75rem] px-2.5 py-1.5 text-right font-medium">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {previewLines.map((journalLine, index) => {
                    const classifiedLeg = line.direction === 'inflow' ? journalLine.credit > 0 : journalLine.debit > 0;
                    return (
                      <tr key={`${entry.id}-${index}`}>
                        <td
                          data-testid={journalLine.debit > 0 ? `journal-debit-${line.id}` : journalLine.credit > 0 ? `journal-credit-${line.id}` : undefined}
                          className="px-2.5 py-1.5"
                        >
                          {classifiedLeg && canConfirmClassification ? (
                            <span className="flex items-center gap-1.5">
                              <select
                                data-testid={`select-account-suggestion-${line.id}`}
                                aria-label="Classification decision"
                                aria-busy={accountQuery.isLoading || saveAccount.isPending}
                                disabled={accountQuery.isLoading || saveAccount.isPending}
                                value={selectedAccount}
                                onChange={(event) => {
                                  const accountSuggestion = event.target.value;
                                  const previousAccount = selectedAccount;
                                  accountSelectionEditedRef.current = true;
                                  setSelectedAccount(accountSuggestion);
                                  if (!activeClient || !accountSuggestion || accountSuggestion === journalClassifiedAccount) return;
                                  saveAccount.mutate({
                                    data: {
                                      clientId: activeClient.id,
                                      type: 'recode_lines',
                                      lineIds: [line.id],
                                      accountSuggestion,
                                      confidence: 0.85,
                                    },
                                  }, {
                                    onSuccess: () => {
                                      queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey() });
                                      queryClient.invalidateQueries({ queryKey: getGetJournalEntriesQueryKey() });
                                      notify.success('Draft account updated', { description: `${accountSuggestion} will be used when this entry is posted.` });
                                    },
                                    onError: (error) => {
                                      accountSelectionEditedRef.current = false;
                                      setSelectedAccount(previousAccount);
                                      notify.error(error, { title: 'Account update failed', fallback: 'The draft account could not be updated. Refresh the queue and try again.' });
                                    },
                                  });
                                }}
                                onClick={(event) => event.stopPropagation()}
                                className="h-7 w-full rounded-md border border-input bg-background px-1.5 text-xs font-semibold outline-none focus:border-primary disabled:opacity-50"
                              >
                                {accountQuery.isLoading
                                  ? <option value="">Loading accounts…</option>
                                  : !accounts.length
                                    ? <option value="">No active accounts available</option>
                                    : accounts.map((account) => <option key={account.id} value={account.accountName}>{account.accountCode} · {account.displayName}</option>)}
                              </select>
                              {(saveAccount.isPending || (accountQuery.isFetching && !accountQuery.isLoading)) && <LoaderCircle size={12} className="shrink-0 animate-spin text-primary" aria-label={saveAccount.isPending ? 'Saving account' : 'Refreshing accounts'} />}
                            </span>
                          ) : <span className="font-semibold">{journalLine.account}</span>}
                        </td>
                        <td className="px-2.5 py-2 text-right font-mono tabular-nums">{journalLine.debit ? money(journalLine.debit, entry.currency) : ''}</td>
                        <td className="px-2.5 py-2 text-right font-mono tabular-nums">{journalLine.credit ? money(journalLine.credit, entry.currency) : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border bg-muted/35 font-mono text-[11px] font-semibold">
                    <td className="px-2.5 py-1.5 text-[10px] uppercase tracking-[.08em] text-muted-foreground">Total</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{money(entry.lines.reduce((sum, journalLine) => sum + journalLine.debit, 0), entry.currency)}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{money(entry.lines.reduce((sum, journalLine) => sum + journalLine.credit, 0), entry.currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
        {actionError && <p data-testid={`post-error-detail-${line.id}`} className="border-t border-border px-3 py-2 text-xs text-destructive">{actionError}</p>}
      </section>}
    </td></tr>}
  </>;
}
function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase(); const posted = normalized === 'posted';
  return <span data-testid={`status-${normalized}`} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[10px] capitalize ${posted ? 'bg-primary/10 text-primary' : normalized === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-accent/15 text-accent-foreground'}`}><span className={`size-1.5 rounded-full ${posted ? 'bg-primary' : normalized === 'error' ? 'bg-destructive' : 'bg-accent'}`} />{status}</span>;
}

function JournalEntriesPage() {
  const { activeClient } = useClientWorkspace();
  const params = { clientId: activeClient?.id ?? 1 };
  const query = useGetJournalEntries(params, { query: { queryKey: getGetJournalEntriesQueryKey(params) } });
  const post = usePostJournalEntry();
  const unpost = useUnpostJournalEntry();
  const entries = query.data ?? [];
  const [selected, setSelected] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'draft' | 'posted'>('all');
  const [search, setSearch] = useState('');
  const [currency, setCurrency] = useState('all');
  const [dateFrom, setDateFrom] = useState(''); const [dateTo, setDateTo] = useState('');
  const [sortKey, setSortKey] = useState<JournalSortKey>('date'); const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const currencies = [...new Set(entries.map((entry) => entry.currency))].sort();
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matching = entries.filter((item) =>
      (filter === 'all' || item.status.toLowerCase() === filter)
      && (currency === 'all' || item.currency === currency)
      && isDateInRange(item.date, dateFrom, dateTo)
      && (!needle || `${item.memo} ${item.currency} ${item.contactName ?? ''} ${item.status} JE-${String(item.id).padStart(4, '0')}`.toLowerCase().includes(needle))
    );
    return [...matching].sort((left, right) => {
      const leftAmount = left.lines.reduce((sum, line) => sum + Math.max(line.debit, line.credit), 0);
      const rightAmount = right.lines.reduce((sum, line) => sum + Math.max(line.debit, line.credit), 0);
      const leftValue = sortKey === 'date' ? left.date
        : sortKey === 'memo' ? left.memo
          : sortKey === 'currency' ? left.currency
            : sortKey === 'amount' ? leftAmount
              : sortKey === 'confidence' ? left.confidence
                : left.status;
      const rightValue = sortKey === 'date' ? right.date
        : sortKey === 'memo' ? right.memo
          : sortKey === 'currency' ? right.currency
            : sortKey === 'amount' ? rightAmount
              : sortKey === 'confidence' ? right.confidence
                : right.status;
      const comparison = typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: 'base' });
      return (comparison || left.id - right.id) * (sortDirection === 'asc' ? 1 : -1);
    });
  }, [entries, filter, currency, search, dateFrom, dateTo, sortKey, sortDirection]);
  const sortJournalEntries = (column: string) => {
    const nextColumn = column as JournalSortKey;
    if (nextColumn === sortKey) setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(nextColumn);
      setSortDirection('asc');
    }
  };
  const refreshJournalData = () => {
    queryClient.invalidateQueries({ queryKey: getGetJournalEntriesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetLedgerOverviewQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTrialBalanceQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetFinancialStatementsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetReportPacksQueryKey() });
  };
  const postEntry = (entry: JournalEntry) => post.mutate({ id: entry.id, data: { clientId: params.clientId } }, { onSuccess: () => { refreshJournalData(); notify.success('Journal entry posted', { description: `Entry #${entry.id} is now live in reports.` }); } });
  const unpostEntry = (entry: JournalEntry) => {
    if (!window.confirm('Unpost this journal entry? It will leave live reports and return to draft.')) return;
    unpost.mutate({ id: entry.id, data: { clientId: params.clientId } }, { onSuccess: () => { refreshJournalData(); notify.success('Journal entry unposted', { description: `Entry #${entry.id} is back to draft.` }); } });
  };
  const activeEntryFilterCount = [search.trim() !== '', filter !== 'all', currency !== 'all', Boolean(dateFrom || dateTo)].filter(Boolean).length;
  const clearEntryFilters = () => { setSearch(''); setFilter('all'); setCurrency('all'); setDateFrom(''); setDateTo(''); };
  const sortArrow = sortDirection === 'asc' ? '↑' : '↓';
  return <div>
    <PageHeading eyebrow="Decision layer / AI proposals" title="Journal entries" description="Review each draft double-entry, trace it back to its source line, and post only entries that make sense." action={<div className="flex items-center gap-2 rounded-md border border-accent/25 bg-accent/10 px-3 py-2 text-[11px] text-accent-foreground"><Sparkles size={14} /> AI prepared · human posted</div>} />
    <FilterToolbar
      search={search}
      onSearchChange={setSearch}
      searchTestId="input-search-entries"
      searchPlaceholder="Search memos, contacts, or currencies"
      activeCount={activeEntryFilterCount}
      shownCount={filtered.length}
      totalCount={entries.length}
      noun="entries"
      onClear={clearEntryFilters}
      clearTestId="button-clear-entry-filters"
      countTestId="text-active-entry-filter-count"
    >
      <FilterPills<typeof filter>
        compact
        label="Status"
        ariaLabel="Filter by journal status"
        testId="select-journal-status-filter"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All', testId: 'button-filter-all-entries' },
          { value: 'draft', label: 'Draft', testId: 'button-filter-draft-entries' },
          { value: 'posted', label: 'Posted', testId: 'button-filter-posted-entries' },
        ]}
      />
      <FilterPills
        compact
        label="Currency"
        ariaLabel="Filter by currency"
        testId="select-journal-currency-filter"
        value={currency}
        onChange={setCurrency}
        options={[{ value: 'all', label: 'All currencies' }, ...currencies.map((item) => ({ value: item, label: item }))]}
        loading={query.isLoading}
        loadingLabel="Detecting currencies…"
      />
      <DateRangeFilter compact from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} fromTestId="input-journal-entries-date-from" toTestId="input-journal-entries-date-to" clearTestId="button-clear-journal-entries-date-filter" />
      <FilterPills
        compact
        label="Sort"
        ariaLabel="Sort journal entries"
        testId="select-journal-sort"
        value={sortKey}
        onChange={sortJournalEntries}
        options={[
          { value: 'date', label: sortKey === 'date' ? `Date ${sortArrow}` : 'Date', testId: 'button-sort-journal-entries-date' },
          { value: 'memo', label: sortKey === 'memo' ? `Entry ${sortArrow}` : 'Entry', testId: 'button-sort-journal-entries-memo' },
          { value: 'currency', label: sortKey === 'currency' ? `Currency ${sortArrow}` : 'Currency', testId: 'button-sort-journal-entries-currency' },
          { value: 'amount', label: sortKey === 'amount' ? `Amount ${sortArrow}` : 'Amount', testId: 'button-sort-journal-entries-amount' },
          { value: 'confidence', label: sortKey === 'confidence' ? `Confidence ${sortArrow}` : 'Confidence', testId: 'button-sort-journal-entries-confidence' },
          { value: 'status', label: sortKey === 'status' ? `Status ${sortArrow}` : 'Status', testId: 'button-sort-journal-entries-status' },
        ]}
      />
    </FilterToolbar>
    <QueryState loading={query.isLoading} error={query.isError} empty={!filtered.length} filtered={activeEntryFilterCount > 0} onClearFilters={clearEntryFilters} onRetry={() => query.refetch()}><div className="grid gap-4 xl:grid-cols-2">{filtered.map((entry) => <JournalCard key={entry.id} entry={entry} selected={selected === entry.id} onSelect={() => setSelected(selected === entry.id ? null : entry.id)} onPost={() => postEntry(entry)} onUnpost={() => unpostEntry(entry)} posting={post.isPending && post.variables?.id === entry.id} unposting={unpost.isPending && unpost.variables?.id === entry.id} />)}</div></QueryState>
  </div>;
}
function JournalCard({ entry, selected, onSelect, onPost, onUnpost, posting, unposting }: { entry: JournalEntry; selected: boolean; onSelect: () => void; onPost: () => void; onUnpost: () => void; posting: boolean; unposting: boolean }) {
  const posted = entry.status.toLowerCase() === 'posted';
  return <article data-testid={`card-journal-entry-${entry.id}`} className={`rounded-lg border bg-card transition-all ${selected ? 'border-primary/50 shadow-md' : 'border-card-border hover:border-primary/30'}`}><button data-testid={`button-expand-entry-${entry.id}`} onClick={onSelect} className="flex w-full items-start gap-4 p-5 text-left"><div className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-md ${posted ? 'bg-primary/10 text-primary' : 'bg-accent/15 text-accent-foreground'}`}>{posted ? <Check size={17} /> : <Sparkles size={16} />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] text-muted-foreground">JE-{String(entry.id).padStart(4, '0')}</span><StatusPill status={entry.status} /></div><h2 className="mt-2 truncate text-[13px] font-semibold">{entry.memo}</h2><div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-muted-foreground"><span>{shortDate(entry.date)}</span><span>·</span><span>{entry.currency}</span><span>·</span><span>{Math.round(entry.confidence * 100)}% confidence</span></div></div><ChevronDown className={`mt-1 text-muted-foreground transition-transform ${selected ? 'rotate-180' : ''}`} size={16} /></button>{selected && <div className="border-t border-border px-5 pb-5 pt-4"><div className="mb-3 flex items-center gap-2 text-[10px] text-muted-foreground"><FileCheck2 size={13} className="text-primary" /> Linked to statement line #{entry.statementLineId}</div><div className="overflow-hidden rounded-md border border-border"><table className="w-full text-left text-[11px]"><thead className="bg-muted/55 font-mono text-[9px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Account</th><th className="px-3 py-2 text-right font-medium">Debit</th><th className="px-3 py-2 text-right font-medium">Credit</th></tr></thead><tbody className="divide-y divide-border">{entry.lines.map((line, index) => <tr key={`${entry.id}-${index}`}><td className="px-3 py-2.5">{line.account}</td><td className="px-3 py-2.5 text-right font-mono">{line.debit ? money(line.debit, entry.currency) : '—'}</td><td className="px-3 py-2.5 text-right font-mono">{line.credit ? money(line.credit, entry.currency) : '—'}</td></tr>)}</tbody></table></div><div className="mt-4 flex justify-end">{posted ? <button data-testid={`button-unpost-entry-${entry.id}`} onClick={onUnpost} disabled={unposting} className="inline-flex items-center gap-2 rounded-md border border-accent/35 px-3 py-2 text-xs font-semibold text-accent-foreground hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50">{unposting ? 'Unposting…' : 'Unpost to draft'}</button> : <button data-testid={`button-post-entry-${entry.id}`} onClick={onPost} disabled={posting} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{posting ? 'Posting…' : <><Check size={14} /> Post entry</>}</button>}</div></div>}</article>;
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
  const fileName = `${clientName.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/(^-|-$)/g, '') || 'agaraccounting-ai'}-trial-balance.csv`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function TrialBalanceTransactionsRow({ account, currency, colSpan }: { account: string; currency: string; colSpan: number }) {
  const { activeClient } = useClientWorkspace();
  const params = { clientId: activeClient?.id ?? 1, account };
  const query = useGetTrialBalanceAccountTransactions(params, { query: { queryKey: getGetTrialBalanceAccountTransactionsQueryKey(params) } });
  const transactions = query.data ?? [];
  return <tr data-testid={`row-trial-balance-transactions-${account}`}><td colSpan={colSpan} className="bg-secondary/20 px-5 py-4">
    {query.isLoading ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><RefreshCw size={13} className="animate-spin" /> Loading transactions…</div>
      : query.isError ? <div className="text-xs text-destructive">Transactions could not be loaded. <button type="button" onClick={() => query.refetch()} className="font-semibold underline">Retry</button></div>
      : !transactions.length ? <div className="text-xs text-muted-foreground">No posted transactions for this account.</div>
      : <div className="overflow-x-auto"><table className="w-full min-w-[660px] text-left text-[11px]"><thead className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground"><tr><th className="pb-2 pr-3 font-medium">Date</th><th className="pb-2 pr-3 font-medium">Description</th><th className="pb-2 pr-3 font-medium">Contact</th><th className="pb-2 pr-3 font-medium">Counter account</th><th className="pb-2 pr-3 text-right font-medium">Debit</th><th className="pb-2 text-right font-medium">Credit</th></tr></thead><tbody className="divide-y divide-border/60">{transactions.map((transaction) => <tr key={transaction.entryId} data-testid={`row-trial-balance-transaction-${transaction.entryId}`}><td className="py-2 pr-3 font-mono text-muted-foreground">{shortDate(transaction.date)}</td><td className="py-2 pr-3">{transaction.description}</td><td data-testid={`cell-trial-balance-transaction-contact-${transaction.entryId}`} className="py-2 pr-3 text-muted-foreground">{transaction.contactName ?? '—'}</td><td className="py-2 pr-3 text-muted-foreground">{transaction.counterAccount}</td><td className="py-2 pr-3 text-right font-mono">{transaction.side === 'debit' ? money(transaction.functionalAmount ?? transaction.amount, currency) : '—'}</td><td className="py-2 text-right font-mono">{transaction.side === 'credit' ? money(transaction.functionalAmount ?? transaction.amount, currency) : '—'}</td></tr>)}</tbody></table></div>}
  </td></tr>;
}

function TrialBalancePage() {
  const { activeClient } = useClientWorkspace(); const params = { clientId: activeClient?.id ?? 1 };
  const query = useGetTrialBalance(params, { query: { queryKey: getGetTrialBalanceQueryKey(params) } }); const rows = query.data ?? []; const debit = rows.reduce((sum, row) => sum + row.debit, 0); const credit = rows.reduce((sum, row) => sum + row.credit, 0); const balanced = Math.abs(debit - credit) < 0.01;
  const currency = activeClient?.functionalCurrency ?? 'AED';
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  return <div><PageHeading eyebrow="Control check / double-entry" title="Trial balance" description="One place to see every account's movement and confirm the ledger is ready to become financial statements." action={<div className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold ${balanced ? 'bg-primary/10 text-primary' : 'bg-accent/15 text-accent-foreground'}`}>{balanced ? <CircleCheck size={15} /> : <CircleAlert size={15} />}{balanced ? 'In balance' : 'Review variance'}</div>} /><QueryState loading={query.isLoading} error={query.isError} empty={!rows.length} onRetry={() => query.refetch()}><div className="space-y-5"><div className="grid gap-3 sm:grid-cols-3"><Metric label="Total debits" value={money(debit, currency)} note={`${rows.length} accounts in scope`} /><Metric label="Total credits" value={money(credit, currency)} note="Across all categories" /><Metric label="Variance" value={money(Math.abs(debit - credit), currency)} note={balanced ? 'Debits and credits agree' : 'Needs investigation'} accent={!balanced} /></div><div className="overflow-hidden rounded-lg border border-card-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><span className="text-sm font-semibold">Account balances</span><span className="ml-2 font-mono text-[10px] text-muted-foreground">as of close</span></div><button data-testid="button-export-trial-balance" onClick={() => exportTrialBalance(rows, activeClient?.name ?? 'AgarAccounting AI', currency)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-muted"><ArrowDownLeft size={13} /> Export CSV</button></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left"><thead className="bg-muted/55 font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground"><tr><th className="w-8 px-2 py-3"></th><th className="px-3 py-3 font-medium">Account</th><th className="px-4 py-3 font-medium">Category</th><th className="px-4 py-3 text-right font-medium">Debit</th><th className="px-4 py-3 text-right font-medium">Credit</th><th className="px-5 py-3 text-right font-medium">Balance</th></tr></thead><tbody className="divide-y divide-border">{rows.map((row, index) => {
    const expandable = row.account !== 'Rate coverage required';
    const expanded = expandedAccount === row.account;
    return <Fragment key={`${row.account}-${index}`}>
      <tr data-testid={`row-trial-balance-${index}`} className={`${expandable ? 'cursor-pointer' : ''} hover:bg-secondary/25`} onClick={() => expandable && setExpandedAccount(expanded ? null : row.account)}>
        <td className="px-2 py-3.5 text-muted-foreground">{expandable && (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}</td>
        <td className="px-3 py-3.5 text-[12px] font-semibold">{row.account}</td>
        <td className="px-4 py-3.5 text-[11px] text-muted-foreground">{row.category}</td>
        <td className="px-4 py-3.5 text-right font-mono text-[11px]">{row.debit ? money(row.debit, currency) : '—'}</td>
        <td className="px-4 py-3.5 text-right font-mono text-[11px]">{row.credit ? money(row.credit, currency) : '—'}</td>
        <td className={`px-5 py-3.5 text-right font-mono text-[11px] font-medium ${row.balance < 0 ? 'text-destructive' : ''}`}>{money(row.balance, currency)}</td>
      </tr>
      {expanded && <TrialBalanceTransactionsRow account={row.account} currency={currency} colSpan={6} />}
    </Fragment>;
  })}</tbody><tfoot className="border-t-2 border-border bg-muted/35"><tr><td colSpan={3} className="px-5 py-3 text-[11px] font-semibold">Totals</td><td className="px-4 py-3 text-right font-mono text-[11px] font-semibold">{money(debit, currency)}</td><td className="px-4 py-3 text-right font-mono text-[11px] font-semibold">{money(credit, currency)}</td><td className="px-5 py-3 text-right font-mono text-[11px] font-semibold">{money(debit - credit, currency)}</td></tr></tfoot></table></div></div></div></QueryState></div>;
}

function SectionTree({ sections, level = 0 }: { sections: StatementSection[]; level?: number }) {
  return <div className={level ? 'ml-4 border-l border-border pl-4' : ''}>{sections.map((section, index) => <div key={`${section.label}-${index}`} className={`${level ? 'py-2' : 'border-b border-border py-3.5 last:border-b-0'}`}><div className={`flex items-baseline justify-between gap-4 ${level === 0 ? 'font-semibold' : ''}`}><span className={`${level === 0 ? 'text-[12px]' : 'text-[11px] text-muted-foreground'}`}>{section.label}</span><span className={`shrink-0 font-mono ${level === 0 ? 'text-[12px]' : 'text-[11px]'}`}>{money(section.amount)}</span></div>{section.children && section.children.length > 0 && <SectionTree sections={section.children} level={level + 1} />}</div>)}</div>;
}

function ReportRows({ rows, currency, level = 0, showComparatives = true }: { rows: ReportAmount[]; currency: string; level?: number; showComparatives?: boolean }) {
  const rowStyle = showComparatives
    ? { gridTemplateColumns: 'minmax(0, 1fr) 7.5rem 7.5rem' }
    : { gridTemplateColumns: 'minmax(0, 1fr) 8.5rem' };
  return <>{rows.map((row) => <Fragment key={`${level}-${row.label}`}><div data-comparative={showComparatives ? 'true' : 'false'} style={rowStyle} className={`report-row${row.children?.length ? ' report-row-group' : ''}${level === 0 && /^(Total|Profit for the year|Total comprehensive income|Closing equity|Cash at end of year)/i.test(row.label) ? ' report-row-total' : ''}`}><div className="min-w-0" style={level ? { paddingLeft: `${Math.min(level, 4) * 1.1}rem` } : undefined}><span className={level ? 'text-[11px] text-muted-foreground' : 'text-[12px] font-semibold'}>{row.label}</span>{row.noteRef !== '—' && <span className="ml-1.5 font-mono text-[9px] text-muted-foreground">Note {row.noteRef}</span>}</div><div className="report-amount text-right font-mono text-[10px] tabular-nums">{reportMoney(row.current)}</div>{showComparatives ? <div className="report-amount text-right font-mono text-[10px] tabular-nums text-muted-foreground">{reportMoney(row.comparative)}</div> : null}</div>{row.children?.length ? <ReportRows rows={row.children} currency={currency} level={level + 1} showComparatives={showComparatives} /> : null}</Fragment>)}</>;
}

function UaeTaxSummaryPanel({ currency }: { currency: string }) {
  const { activeClient } = useClientWorkspace();
  const params = { clientId: activeClient?.id ?? 0, period: activeClient?.period };
  const query = useGetUaeCorporateTaxSummary(params, { query: { queryKey: getGetUaeCorporateTaxSummaryQueryKey(params), enabled: !!activeClient } });
  const summary = query.data;
  if (!summary) return <section className="report-statement"><p className="text-xs text-muted-foreground">{query.isLoading ? 'Calculating the UAE Corporate Tax estimate…' : 'The UAE Corporate Tax estimate is unavailable.'}</p></section>;
  return <section className="report-statement" data-testid="uae-corporate-tax-summary">
    <div className="text-center"><h3 className="font-display text-[26px] leading-none">Estimated UAE Corporate Tax summary</h3><p className="mt-2 text-[10px] text-muted-foreground">{summary.estimateLabel}</p></div>
    <div className="mt-6 grid gap-2 text-[11px] sm:grid-cols-2">
      {[['Accounting profit before tax', summary.accountingProfitBeforeTax], ['Mapped deductible expenses', summary.mappedDeductibleExpenses], ['Entertainment accounting cost', summary.entertainmentAccountingCost], ['Entertainment permitted deduction (50%)', summary.entertainmentPermittedDeduction], ['Entertainment add-back (50%)', summary.entertainmentAddBack], ['Other non-deductible add-backs', summary.addBacks - summary.entertainmentAddBack], ['Accountant-review amount', summary.reviewRequiredAmount], ['Estimated taxable income', summary.estimatedTaxableIncome], ['0% band', summary.thresholdAed], ['Standard 9% estimate on excess', summary.standardEstimatedLiability]].map(([label, amount]) => <div key={String(label)} className="flex items-center justify-between gap-4 border-b border-border/60 py-2"><span>{label}</span><span className="font-mono">{money(Number(amount), currency)}</span></div>)}
    </div>
    <div className="mt-5 rounded-md border border-accent/25 bg-accent/10 p-3 text-[10px] leading-5 text-accent-foreground"><strong>Assumptions and exclusions.</strong> {summary.assumptions.join(' ')} Excluded: {summary.excludedReliefs.join(', ')}.</div>
  </section>;
}
function ReportStatement({ title, rows, currency, id, showComparatives = true }: { title: string; rows: ReportAmount[]; currency: string; id?: string; showComparatives?: boolean }) {
  const headStyle = showComparatives
    ? { gridTemplateColumns: 'minmax(0, 1fr) 7.5rem 7.5rem' }
    : { gridTemplateColumns: 'minmax(0, 1fr) 8.5rem' };
  return <><section id={id} tabIndex={-1} className="report-statement scroll-mt-24 outline-none focus-visible:ring-2 focus-visible:ring-primary/30"><div className="text-center"><h3 className="font-display text-[26px] leading-none">{title}</h3><p className="mt-2 font-mono text-[9px] uppercase tracking-[.15em] text-muted-foreground">{currency} · {showComparatives ? 'Current year / comparative year' : 'Current year'}</p></div><div className="mt-6 border-y border-foreground/20 py-2"><div data-comparative={showComparatives ? 'true' : 'false'} style={headStyle} className="report-row report-row-head font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground"><span>Statement line</span><span className="report-amount text-right">{showComparatives ? 'Current' : currency}</span>{showComparatives ? <span className="report-amount text-right">Comparative</span> : null}</div></div><div className="report-body"><ReportRows rows={rows} currency={currency} showComparatives={showComparatives} /></div></section>{title.startsWith('Statement of cash flows') && <UaeTaxSummaryPanel currency={currency} />}</>;
}

function ReportNotesEditor({ notes, onChange, showComparatives = true }: { notes: ReportNote[]; onChange: (notes: ReportNote[]) => void; showComparatives?: boolean }) {
  const outstanding = notes.filter((note) => note.requiresInput || !note.narrative.trim()).length;
  return <section id="report-notes-inputs" tabIndex={-1} className="scroll-mt-24 rounded-lg border border-card-border bg-card p-5 outline-none focus-visible:ring-2 focus-visible:ring-primary/30 md:p-6">
    <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Disclosure inputs</div>
    <h2 className="mt-2 font-display text-[29px]">Notes for your financial statements</h2>
    <p className="mt-2 text-[11px] leading-5 text-muted-foreground">AgarAccounting AI drafts each disclosure from your entity profile, reporting basis, and posted ledger. Amount tables stay system-generated. Edit any wording that does not match how you run the business, then keep Confirmed ticked. Finalization only blocks empty or unconfirmed notes{outstanding ? ` (${outstanding} need attention)` : ''}.</p>
    <ol className="mt-3 list-decimal space-y-1 pl-4 text-[11px] leading-5 text-muted-foreground">
      <li>Read the system draft — it is meant to be usable without an external accountant.</li>
      <li>Change only what is wrong or incomplete for your business.</li>
      <li>Leave Confirmed on when the wording can go into the pack and PDF.</li>
      <li>Choose Save review inputs when you want edits stored on this snapshot.</li>
    </ol>
    <div className="mt-5 space-y-4">{notes.map((note, index) => {
      const needsAttention = note.requiresInput || !note.narrative.trim();
      const placeholder = note.tables.length
        ? 'System draft unavailable. Describe the disclosure that should accompany the generated table.'
        : 'System draft unavailable. Describe the disclosure an external reader should see.';
      return <article key={note.number} className={`rounded-md border p-4 ${needsAttention ? 'border-accent/40 bg-accent/5' : 'border-border bg-background'}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] text-primary">NOTE {note.number}</div>
            <h3 className="mt-1 text-[13px] font-semibold">{note.title}</h3>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{needsAttention ? 'Needs a short review before finalization.' : 'System draft ready — edit anytime.'}</p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-[10px] font-semibold text-muted-foreground">
            <input type="checkbox" checked={!note.requiresInput} onChange={(event) => onChange(notes.map((item, itemIndex) => itemIndex === index ? { ...item, requiresInput: !event.target.checked } : item))} />
            Confirmed
          </label>
        </div>
        <label className="mt-3 block text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground" htmlFor={`report-note-${note.number}`}>Disclosure narrative</label>
        <textarea id={`report-note-${note.number}`} value={note.narrative} placeholder={placeholder} onChange={(event) => onChange(notes.map((item, itemIndex) => itemIndex === index ? { ...item, narrative: event.target.value, requiresInput: event.target.value.trim() ? item.requiresInput : true } : item))} className="mt-1.5 min-h-24 w-full rounded-md border border-input bg-card p-3 text-[11px] leading-5 outline-none focus:border-primary" aria-label={`Note ${note.number} narrative`} />
        {note.tables.length > 0 && <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[440px] text-left text-[10px]"><thead className="font-mono uppercase tracking-[.1em] text-muted-foreground"><tr><th className="pb-2 font-medium">Generated table</th><th className="pb-2 text-right font-medium">Current</th>{showComparatives && <th className="pb-2 text-right font-medium">Comparative</th>}</tr></thead><tbody>{note.tables.map((row) => <tr key={row.label} className="border-t border-border/70"><td className="py-2">{row.label}</td><td className="py-2 text-right font-mono tabular-nums">{reportMoney(row.current)}</td>{showComparatives && <td className="py-2 text-right font-mono tabular-nums">{reportMoney(row.comparative)}</td>}</tr>)}</tbody></table></div>}
      </article>;
    })}</div>
  </section>;
}

function ChecklistEditor({ checklist, onChange }: { checklist: ReportChecklistItem[]; onChange: (items: ReportChecklistItem[]) => void }) {
  return <section id="report-ifrs-checklist" tabIndex={-1} className="scroll-mt-24 rounded-lg border border-card-border bg-card p-5 outline-none focus-visible:ring-2 focus-visible:ring-primary/30 md:p-6"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Applicability checklist</div><h2 className="mt-2 font-display text-[29px]">IFRS confirmation record</h2><p className="mt-2 text-[11px] leading-5 text-muted-foreground">AgarAccounting AI pre-fills each item from your ledger evidence (satisfied, immaterial, or not applicable). Change an item only if the default does not match your business. Finalization needs every item off “requires input” / “applicable — not yet confirmed”.</p><div className="mt-5 divide-y divide-border">{checklist.map((item, index) => <div key={item.standard} className="grid gap-3 py-4 md:grid-cols-[1fr_190px]"><div><div className="text-[12px] font-semibold">{item.standard} — {item.title}</div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{item.prompt}</p></div><select value={item.status} onChange={(event) => onChange(checklist.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, status: event.target.value as ReportChecklistItem['status'] } : candidate))} className="h-9 rounded-md border border-input bg-background px-2 text-[11px] outline-none focus:border-primary"><option value="requires_accountant_input">Needs review</option><option value="applicable">Applicable — not yet confirmed</option><option value="satisfied">Satisfied</option><option value="immaterial">Immaterial</option><option value="not_applicable">Not applicable</option></select></div>)}</div></section>;
}

function SignatoryEditor({ signatory, onChange }: { signatory: ReportSignatory; onChange: (signatory: ReportSignatory) => void }) {
  const update = (field: keyof ReportSignatory, value: string) => onChange({ ...signatory, [field]: value || null } as ReportSignatory);
  return <section id="report-signatory" tabIndex={-1} className="scroll-mt-24 rounded-lg border border-card-border bg-card p-5 outline-none focus-visible:ring-2 focus-visible:ring-primary/30 md:p-6"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Authorization</div><h2 className="mt-2 font-display text-[29px]">Human review and signatory area</h2><p className="mt-2 text-[11px] leading-5 text-muted-foreground">Finalization records the people who prepared, reviewed, and authorized this exact report snapshot. It is not an audit opinion.</p><div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-[11px] font-semibold">Prepared by<input value={signatory.preparedBy} onChange={(event) => update('preparedBy', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-xs font-normal outline-none focus:border-primary" /></label><label className="text-[11px] font-semibold">Reviewed by<input value={signatory.reviewedBy} onChange={(event) => update('reviewedBy', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-xs font-normal outline-none focus:border-primary" /></label><label className="text-[11px] font-semibold">Authorized by<input value={signatory.authorizedBy} onChange={(event) => update('authorizedBy', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-xs font-normal outline-none focus:border-primary" /></label><label className="text-[11px] font-semibold">Authorization date<input type="date" value={signatory.authorizationDate ?? ''} onChange={(event) => update('authorizationDate', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-xs font-normal outline-none focus:border-primary" /></label></div></section>;
}

const reportCheckGuidance: Record<string, { meaning: string; action: string }> = {
  'trial-balance': {
    meaning: 'Confirms that total posted debits equal total posted credits.',
    action: 'Open Trial balance from the left navigation, investigate the variance, and correct the underlying journal entry before generating a new snapshot.',
  },
  position: {
    meaning: 'Confirms that assets equal liabilities plus equity in the statement of financial position.',
    action: 'Review posted journal entries for missing or incorrect asset, liability, and equity classifications, correct them, then generate a new snapshot.',
  },
  'retained-earnings': {
    meaning: 'Confirms that current-period profit and other comprehensive income explain the movement in retained earnings.',
    action: 'Review opening equity, profit or loss, OCI, dividend, and distribution entries in Journal entries, correct any omission or classification, then regenerate.',
  },
  'cash-flow': {
    meaning: 'Confirms that opening cash plus the period’s cash movement equals closing cash.',
    action: 'Review posted bank and cash entries and their cash-flow classifications in Journal entries, correct them, then regenerate.',
  },
  'note-totals': {
    meaning: 'Confirms that the cash total shown in the primary statements agrees with the generated cash note.',
    action: 'Review cash-account postings and classifications in Journal entries. Correct the source entry rather than editing the generated total, then regenerate.',
  },
  'related-parties': {
    meaning: 'Confirms that the reported related-party balance agrees with its due-from and due-to components.',
    action: 'Review related-party account classifications in Client settings and the supporting posted entries, correct them, then regenerate.',
  },
  'foreign-currency': {
    meaning: 'Confirms that every posted foreign-currency entry has a dated rate for conversion into the client’s functional currency.',
    action: 'Open Firm settings, add a rate dated on or before each affected transaction in the exchange-rate schedule, then regenerate.',
  },
  comparatives: {
    meaning: 'Confirms that the prior comparable reporting period contains posted ledger evidence.',
    action: 'Import, review, and post the prior-period activity, or choose the correct annual period end, then regenerate.',
  },
  notes: {
    meaning: 'Confirms that every required disclosure note has system or owner wording ready for the pack.',
    action: 'Regenerate the pack for fresh system drafts, or edit any incomplete note below, keep Confirmed ticked, then choose Save review inputs.',
  },
  'ifrs-checklist': {
    meaning: 'Confirms that every relevant IFRS item has a final applicability status.',
    action: 'System defaults are filled from ledger evidence. Adjust only mismatched items to Satisfied, Immaterial, or Not applicable, then choose Save review inputs.',
  },
};

type ReportCheckFocusTarget =
  | { kind: 'section'; sectionId: string }
  | { kind: 'route'; href: string };

const reportCheckFocusTargets: Record<string, ReportCheckFocusTarget> = {
  'trial-balance': { kind: 'route', href: '/trial-balance' },
  position: { kind: 'section', sectionId: 'report-statement-financial-position' },
  'retained-earnings': { kind: 'section', sectionId: 'report-statement-equity' },
  'cash-flow': { kind: 'section', sectionId: 'report-statement-cash-flows' },
  'note-totals': { kind: 'section', sectionId: 'report-statement-notes' },
  'related-parties': { kind: 'route', href: '/client-settings' },
  'foreign-currency': { kind: 'route', href: '/firm-settings' },
  comparatives: { kind: 'section', sectionId: 'report-comparative-statements' },
  notes: { kind: 'section', sectionId: 'report-notes-inputs' },
  'ifrs-checklist': { kind: 'section', sectionId: 'report-ifrs-checklist' },
};

function focusReportSection(sectionId: string) {
  const element = document.getElementById(sectionId);
  if (!element) return false;
  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (element instanceof HTMLElement) {
    element.focus({ preventScroll: true });
  }
  element.classList.add('ring-2', 'ring-primary/40', 'ring-offset-2', 'ring-offset-background');
  window.setTimeout(() => {
    element.classList.remove('ring-2', 'ring-primary/40', 'ring-offset-2', 'ring-offset-background');
  }, 2200);
  return true;
}

function addReportCheckGuidance(pack: ReportPack | undefined) {
  if (!pack) return pack;
  return {
    ...pack,
    validation: {
      ...pack.validation,
      checks: pack.validation.checks.map((check) => {
        const guidance = reportCheckGuidance[check.id];
        if (!guidance) return check;
        const nextStep = check.status === 'pass' ? 'No action is needed for this check.' : `What to do: ${guidance.action}`;
        return { ...check, detail: `${check.detail} What this checks: ${guidance.meaning} ${nextStep}` };
      }),
    },
  };
}

function withLiveReviewValidation(pack: ReportPack, notes: ReportNote[], checklist: ReportChecklistItem[]): ReportPack {
  const notesOk = notes.length > 0 && notes.every((note) => !note.requiresInput && note.narrative.trim().length > 0);
  const checklistOk = checklist.length > 0 && checklist.every((item) => !['applicable', 'requires_accountant_input'].includes(item.status));
  const checks = pack.validation.checks.map((check) => {
    if (check.id === 'notes') {
      return {
        ...check,
        status: notesOk ? 'pass' as const : 'error' as const,
        detail: notesOk
          ? 'System-generated note wording is present for every required disclosure.'
          : 'One or more notes still need owner review or disclosure wording.',
      };
    }
    if (check.id === 'ifrs-checklist') {
      return {
        ...check,
        status: checklistOk ? 'pass' as const : 'error' as const,
        detail: checklistOk
          ? 'Checklist items are satisfied, immaterial, or not applicable based on ledger evidence and system defaults.'
          : 'One or more IFRS checklist items still need a final applicability decision.',
      };
    }
    return check;
  });
  const errorCount = checks.filter((check) => check.blocking && check.status !== 'pass').length;
  return {
    ...pack,
    notes,
    checklist,
    snapshot: { ...pack.snapshot, notes },
    validation: {
      ...pack.validation,
      status: errorCount ? 'blocked' : 'pass',
      errorCount,
      checks,
    },
  };
}

function FinancialStatementsPage() {
  const { activeClient } = useClientWorkspace();
  const [, setLocation] = useLocation();
  const clientId = activeClient?.id ?? 1;
  const [periodEnd, setPeriodEnd] = useState(`${new Date().getFullYear()}-12-31`);
  const [reportingBasis, setReportingBasis] = useState<'IFRS' | 'IFRS for SMEs'>(activeClient?.basis === 'IFRS for SMEs' ? 'IFRS for SMEs' : 'IFRS');
  const [presentationProfile, setPresentationProfile] = useState<'IAS 1' | 'IFRS 18' | 'IFRS for SMEs'>(activeClient?.basis === 'IFRS for SMEs' ? 'IFRS for SMEs' : 'IAS 1');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [localPack, setLocalPack] = useState<ReportPack | null>(null);
  const [notes, setNotes] = useState<ReportNote[]>([]);
  const [checklist, setChecklist] = useState<ReportChecklistItem[]>([]);
  const [signatory, setSignatory] = useState<ReportSignatory>({ preparedBy: '', reviewedBy: '', authorizedBy: '', authorizationDate: null });
  const [showComparatives, setShowComparatives] = useState(true);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const listParams = { clientId };
  const list = useGetReportPacks(listParams, { query: { queryKey: getGetReportPacksQueryKey(listParams) } });
  const detail = useGetReportPack(selectedId ?? 0, { query: { queryKey: getGetReportPackQueryKey(selectedId ?? 0), enabled: selectedId !== null } });
  const generate = useCreateReportPack();
  const update = useUpdateReportPack();
  const removePack = useDeleteReportPack();
  const rawPack = localPack?.id === selectedId ? localPack : detail.data;
  const hydratedSaveKeyRef = useRef<string | null>(null);
  const pack = useMemo(() => {
    if (!rawPack) return rawPack;
    const live = notes.length > 0 ? withLiveReviewValidation(rawPack, notes, checklist) : rawPack;
    return addReportCheckGuidance(live);
  }, [rawPack, notes, checklist]);
  useEffect(() => { if (!selectedId && list.data?.[0]) setSelectedId(list.data[0].id); }, [list.data, selectedId]);
  useEffect(() => {
    if (!rawPack) return;
    const hydratedNotes = buildSystemNoteDrafts(rawPack.snapshot, rawPack.notes);
    const hydratedChecklist = hydrateChecklistDefaults(rawPack.checklist, hydratedNotes);
    setNotes(hydratedNotes);
    setChecklist(hydratedChecklist);
    setSignatory(rawPack.signatory);
    const notesChanged = JSON.stringify(hydratedNotes) !== JSON.stringify(rawPack.notes);
    const checklistChanged = JSON.stringify(hydratedChecklist) !== JSON.stringify(rawPack.checklist);
    const saveKey = `${rawPack.id}:${rawPack.updatedAt}`;
    if (!(notesChanged || checklistChanged) || rawPack.status === 'finalized' || hydratedSaveKeyRef.current === saveKey) return;
    hydratedSaveKeyRef.current = saveKey;
    update.mutate(
      { id: rawPack.id, data: { clientId, action: 'update_inputs', notes: hydratedNotes, checklist: hydratedChecklist, signatory: rawPack.signatory } },
      {
        onSuccess: (saved) => {
          setLocalPack(saved);
          queryClient.invalidateQueries({ queryKey: getGetReportPacksQueryKey(listParams) });
          queryClient.invalidateQueries({ queryKey: getGetReportPackQueryKey(saved.id) });
        },
        // Background auto-hydration — errors should stay silent (user did not
        // click Save). Mark the error handled so the global toast skips it.
        onError: (err) => { markErrorHandled(err); },
      },
    );
  }, [rawPack?.id, rawPack?.updatedAt, clientId]);
  useEffect(() => {
    if (!pack) return;
    setShowComparatives(pack.validation.checks.find((check) => check.id === 'comparatives')?.status === 'pass');
  }, [pack?.id]);
  useEffect(() => { setSelectedId(null); setLocalPack(null); setShowComparatives(true); setPendingDeleteId(null); const basis = activeClient?.basis === 'IFRS for SMEs' ? 'IFRS for SMEs' : 'IFRS'; setReportingBasis(basis); setPresentationProfile(basis === 'IFRS for SMEs' ? 'IFRS for SMEs' : 'IAS 1'); }, [clientId, activeClient?.basis]);
  const annualPeriod = /^\d{4}-12-31$/.test(periodEnd);
  const ifrs18Eligible = annualPeriod && Number(periodEnd.slice(0, 4)) >= 2027 && reportingBasis === 'IFRS';
  useEffect(() => {
    const onProfileChange = (event: Event) => {
      const detail = (event as CustomEvent<{ basis: typeof reportingBasis; profile: typeof presentationProfile }>).detail;
      setReportingBasis(detail.basis);
      setPresentationProfile(detail.profile);
    };
    window.addEventListener('agaraccounting:report-profile', onProfileChange);
    return () => window.removeEventListener('agaraccounting:report-profile', onProfileChange);
  }, []);
  const handleGenerate = () => generate.mutate({ data: { clientId, periodEnd, reportingBasis, presentationProfile, presentationCurrency: activeClient?.functionalCurrency ?? 'AED', roundingPolicy: 'Nearest whole unit' } }, { onSuccess: (created) => { setLocalPack(created); setSelectedId(created.id); queryClient.invalidateQueries({ queryKey: getGetReportPacksQueryKey(listParams) }); notify.success('Report pack generated', { description: `Snapshot ready for ${created.periodEnd.slice(0, 10)}.` }); } });
  const save = (action: 'update_inputs' | 'finalize') => { if (!pack) return; update.mutate({ id: pack.id, data: { clientId, action, notes, checklist, signatory } }, { onSuccess: (saved) => { setLocalPack(saved); queryClient.invalidateQueries({ queryKey: getGetReportPacksQueryKey(listParams) }); queryClient.invalidateQueries({ queryKey: getGetReportPackQueryKey(saved.id) }); notify.success(action === 'finalize' ? 'Report pack finalized' : 'Report pack saved', { description: action === 'finalize' ? `Snapshot for ${saved.periodEnd.slice(0, 10)} is locked.` : 'Notes, checklist, and signatory saved.' }); } }); };
  const requestDeletePack = (id: number) => setPendingDeleteId(id);
  const cancelDeletePack = () => { if (!removePack.isPending) setPendingDeleteId(null); };
  const pendingDeletePack = pendingDeleteId ? list.data?.find((item) => item.id === pendingDeleteId) ?? null : null;
  const confirmDeletePack = () => {
    const id = pendingDeleteId;
    if (id == null) return;
    removePack.mutate({ id }, {
      onSuccess: async () => {
        setPendingDeleteId(null);
        queryClient.removeQueries({ queryKey: getGetReportPackQueryKey(id) });
        if (selectedId === id) {
          setLocalPack(null);
          setSelectedId(null);
        }
        await queryClient.invalidateQueries({ queryKey: getGetReportPacksQueryKey(listParams) });
        await list.refetch();
        notify.success('Report pack deleted', {
          description: pendingDeletePack ? `Snapshot for ${pendingDeletePack.periodEnd.slice(0, 10)} was removed.` : undefined,
        });
      },
      onError: (error) => {
        notify.error(error, { title: 'Delete failed', fallback: 'The report pack could not be deleted. Refresh and try again.' });
      },
    });
  };  const focusCheckTarget = (checkId: string) => {
    const target = reportCheckFocusTargets[checkId];
    if (!target) return;
    if (target.kind === 'route') {
      setLocation(target.href);
      return;
    }
    focusReportSection(target.sectionId);
  };
  useEffect(() => {
    const previous = document.querySelector('[data-report-firm-attribution="true"]');
    previous?.remove();
    const attribution = pack?.snapshot.firmAttribution;
    if (!attribution?.enabled || !attribution.firmName) return;
    const title = document.querySelector('#report-comparative-statements .report-cover h2');
    if (!title) return;
    const label = document.createElement('p');
    label.dataset.reportFirmAttribution = 'true';
    label.dataset.testid = 'report-firm-attribution';
    label.className = 'mt-3 text-[12px] font-semibold';
    label.textContent = `Prepared by firm: ${attribution.firmName}`;
    title.insertAdjacentElement('afterend', label);
    return () => label.remove();
  }, [pack?.id, pack?.snapshot.firmAttribution?.enabled, pack?.snapshot.firmAttribution?.firmName, showComparatives]);
  const blocked = pack?.validation.status !== 'pass';
  const errorText = generate.error || update.error
    ? 'The report pack could not be saved. Review the visible requirements and try again.'
    : '';
  return <div><PageHeading eyebrow="Reporting / IFRS close" title="Financial statement pack" description="Generate a comparative, traceable report snapshot from posted ledger entries. AgarAccounting AI System prepares accounting output for human review; it never provides an audit opinion, statutory filing, or tax return." action={<div id="report-period-controls" className="flex flex-wrap items-end gap-2"><label className="text-[10px] font-semibold text-muted-foreground">Annual period end<input data-testid="input-report-period-end" type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} className="mt-1 block h-9 rounded-md border border-input bg-card px-2 text-xs text-foreground outline-none focus:border-primary" /></label><button data-testid="button-generate-report-pack" onClick={handleGenerate} disabled={generate.isPending} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{generate.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}{generate.isPending ? 'Building snapshot…' : 'Generate report pack'}</button></div>} />{errorText && <div className="mb-5 rounded-md border border-destructive/25 bg-destructive/5 px-4 py-3 text-xs text-destructive">{errorText}</div>}<div className="mb-6 grid gap-3 md:grid-cols-[.8fr_1.2fr]"><section className="rounded-lg border border-card-border bg-card p-4"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Saved snapshots</div><div className="mt-3 space-y-2">{list.isLoading ? <div className="text-xs text-muted-foreground">Loading saved packs…</div> : list.data?.length ? list.data.map((item) => <div key={item.id} className={`flex items-stretch gap-1 rounded-md border ${selectedId === item.id ? 'border-primary/40 bg-primary/5' : 'border-border'}`}><button type="button" onClick={() => { setPendingDeleteId(null); setLocalPack(null); setSelectedId(item.id); }} className={`flex min-w-0 flex-1 items-center justify-between px-3 py-2.5 text-left ${selectedId === item.id ? '' : 'hover:bg-muted/50'}`}><div className="min-w-0"><div className="text-xs font-semibold">{item.periodEnd.slice(0, 10)} annual pack</div><div className="mt-1 font-mono text-[9px] text-muted-foreground">{item.status} · {item.validationErrorCount} blocking checks</div></div><ChevronRight size={14} className="shrink-0 text-muted-foreground" /></button><button type="button" data-testid={`button-delete-report-pack-${item.id}`} aria-label={`Delete ${item.periodEnd.slice(0, 10)} report pack`} disabled={removePack.isPending} title="Delete report pack" onClick={(event) => { event.preventDefault(); event.stopPropagation(); requestDeletePack(item.id); }} className="shrink-0 self-stretch rounded-r-md px-2.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"><Trash2 size={14} /></button></div>) : <div className="rounded-md border border-dashed border-border px-3 py-4 text-[11px] leading-5 text-muted-foreground">No report snapshot yet. Choose an annual period end and generate a review draft.</div>}</div></section><section className="rounded-lg border border-accent/25 bg-accent/10 p-4"><div className="flex gap-3"><CircleAlert className="mt-0.5 shrink-0 text-accent-foreground" size={17} /><div><div className="text-xs font-semibold text-accent-foreground">Finalization is deliberately gated</div><p className="mt-1 text-[11px] leading-5 text-accent-foreground/75">The pack includes posted entries only. Missing comparative evidence, FX coverage, reconciliations, disclosure inputs, checklist decisions, or signatories prevent the final PDF download.</p></div></div></section></div>{detail.isLoading && !localPack ? <LoadingRows /> : pack ? <div className="space-y-6"><section className={`rounded-lg border p-5 ${blocked ? 'border-destructive/30 bg-destructive/5' : 'border-primary/30 bg-primary/5'}`}><div className="flex flex-col justify-between gap-4 md:flex-row md:items-start"><div><div className="flex items-center gap-2 text-sm font-semibold">{blocked ? <CircleAlert className="text-destructive" size={17} /> : <CircleCheck className="text-primary" size={17} />}{blocked ? `${pack.validation.errorCount} finalization blocker${pack.validation.errorCount === 1 ? '' : 's'}` : 'All deterministic checks pass'}</div><p className="mt-2 text-[11px] leading-5 text-muted-foreground">Snapshot #{pack.id} · {pack.periodStart.slice(0, 10)} to {pack.periodEnd.slice(0, 10)} · comparative {pack.comparativePeriodStart.slice(0, 10)} to {pack.comparativePeriodEnd.slice(0, 10)}</p></div><div className="flex flex-wrap gap-2"><button data-testid="button-save-report-inputs" onClick={() => save('update_inputs')} disabled={update.isPending || pack.status === 'finalized'} className="rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50">Save review inputs</button>{pack.status === 'finalized' ? <a data-testid="link-download-report-pdf" href={`/api/agaraccounting/report-packs/${pack.id}/pdf`} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"><ArrowDownLeft size={14} /> Download final PDF</a> : <button data-testid="button-finalize-report-pack" onClick={() => save('finalize')} disabled={update.isPending} className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{update.isPending ? 'Checking finalization…' : 'Finalize & unlock PDF'}</button>}</div></div><div className="mt-4 grid gap-2 md:grid-cols-2">{pack.validation.checks.map((check) => {
    const focusable = check.status !== 'pass' && Boolean(reportCheckFocusTargets[check.id]);
    const cardClass = `rounded-md border px-3 py-3 text-left text-[11px] transition-colors ${check.status === 'pass' ? 'border-primary/20 bg-card' : check.status === 'warning' ? 'border-accent/35 bg-accent/10' : 'border-destructive/50 bg-destructive/10 shadow-sm ring-1 ring-destructive/15'} ${focusable ? 'cursor-pointer hover:border-primary/50 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40' : ''}`;
    const body = <><div className="flex items-start justify-between gap-3"><div className="flex items-start gap-2 font-semibold">{check.status === 'pass' ? <CircleCheck size={14} className="mt-0.5 shrink-0 text-primary" /> : <span className={`grid size-6 shrink-0 place-items-center rounded-full ${check.status === 'error' ? 'bg-destructive text-destructive-foreground' : 'bg-accent/20 text-accent-foreground'}`}><CircleAlert size={14} /></span>}<span className={check.status === 'error' ? 'pt-1 text-destructive' : check.status === 'warning' ? 'pt-1 text-accent-foreground' : ''}>{check.label}</span></div>{check.status !== 'pass' && <span className={`shrink-0 rounded-full px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[.08em] ${check.status === 'error' ? 'bg-destructive text-destructive-foreground' : 'bg-accent/20 text-accent-foreground'}`}>{check.status === 'error' ? 'Action required' : 'Review'}</span>}</div><p className={`mt-1.5 leading-5 ${check.status === 'pass' ? 'pl-[22px] text-muted-foreground' : 'pl-8'} ${check.status === 'error' ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{check.detail}</p>{focusable && <div className="mt-2 pl-8 font-mono text-[9px] font-semibold uppercase tracking-[.08em] text-primary">Jump to section</div>}</>;
    return focusable
      ? <button key={check.id} type="button" data-testid={`button-focus-report-check-${check.id}`} className={cardClass} onClick={() => focusCheckTarget(check.id)}>{body}</button>
      : <div key={check.id} className={cardClass}>{body}</div>;
  })}</div></section><div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-card-border bg-card px-4 py-3"><div><div className="text-xs font-semibold">Report presentation</div><p className="mt-0.5 text-[11px] text-muted-foreground">Choose whether statement and note tables include comparative-year columns.</p></div><label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-[11px] font-semibold"><input data-testid="checkbox-show-comparatives" type="checkbox" checked={showComparatives} onChange={(event) => setShowComparatives(event.target.checked)} className="size-3.5 accent-primary" />Show comparative figures</label></div><article key={showComparatives ? 'report-with-comparatives' : 'report-current-only'} id="report-comparative-statements" tabIndex={-1} data-show-comparatives={showComparatives ? 'true' : 'false'} className="report-sheet scroll-mt-24 outline-none focus-visible:ring-2 focus-visible:ring-primary/30"><div className="report-cover"><div className="font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">AgarAccounting AI System / generated accounting output</div><h2 className="mt-14 font-display text-5xl leading-none">{pack.snapshot.legalName}</h2><div className="mt-7 h-px w-20 bg-foreground/40" /><p className="mt-7 font-display text-3xl">Financial statements</p><p className="mt-3 text-[12px]">For the year ended {pack.snapshot.periodEnd.slice(0, 10)}</p>{showComparatives ? <p className="mt-1 text-[11px] text-muted-foreground">Comparative period ended {pack.snapshot.comparativePeriodEnd.slice(0, 10)} · {pack.snapshot.presentationCurrency}</p> : <p className="mt-1 text-[11px] text-muted-foreground">{pack.snapshot.presentationCurrency} · Current period only</p>}<div className="mt-20 border-t border-foreground/20 pt-4 text-[10px] leading-5 text-muted-foreground">Prepared under {pack.snapshot.reportingBasis} using the {pack.snapshot.presentationProfile} presentation profile. This document is not an audit opinion, statutory filing, tax return, or assurance conclusion.</div></div><ReportStatement id="report-statement-financial-position" title="Statement of financial position" rows={pack.snapshot.statementOfFinancialPosition} currency={pack.snapshot.presentationCurrency} showComparatives={showComparatives} /><ReportStatement id="report-statement-profit-or-loss" title="Statement of profit or loss and other comprehensive income" rows={pack.snapshot.profitOrLossAndOci} currency={pack.snapshot.presentationCurrency} showComparatives={showComparatives} /><ReportStatement id="report-statement-equity" title="Statement of changes in equity" rows={pack.snapshot.changesInEquity} currency={pack.snapshot.presentationCurrency} showComparatives={showComparatives} /><ReportStatement id="report-statement-cash-flows" title="Statement of cash flows — indirect method" rows={pack.snapshot.cashFlows} currency={pack.snapshot.presentationCurrency} showComparatives={showComparatives} /><section id="report-statement-notes" tabIndex={-1} className="report-statement scroll-mt-24 outline-none focus-visible:ring-2 focus-visible:ring-primary/30"><h3 className="text-center font-display text-[26px]">Notes to the financial statements</h3><div className="mt-7 space-y-6">{notes.map((note) => <div key={note.number}><div className="font-semibold text-[12px]">Note {note.number} — {note.title}</div><p className="mt-2 whitespace-pre-line text-[11px] leading-5 text-muted-foreground">{note.narrative}</p>{note.tables.length ? <div className="mt-3 grid gap-x-4 gap-y-1 text-[10px]" style={{ gridTemplateColumns: showComparatives ? '1fr auto auto' : '1fr auto' }}>{note.tables.map((row) => <Fragment key={`${note.number}-${row.label}`}><span>{row.label}</span><span className="text-right font-mono tabular-nums">{reportMoney(row.current)}</span>{showComparatives ? <span className="text-right font-mono tabular-nums text-muted-foreground">{reportMoney(row.comparative)}</span> : null}</Fragment>)}</div> : null}</div>)}</div><div className="mt-10 border-t border-foreground/20 pt-4 text-[10px] leading-5 text-muted-foreground">Traceability: {pack.snapshot.traceability.postedEntryCount} posted journal entries · {pack.snapshot.traceability.postedLineCount} linked statement lines · {pack.snapshot.traceability.sourceImportCount} source imports in the client workspace.</div></section></article><div className="grid gap-6 xl:grid-cols-2"><ReportNotesEditor notes={notes} onChange={setNotes} showComparatives={showComparatives} /><ChecklistEditor checklist={checklist} onChange={setChecklist} /></div><SignatoryEditor signatory={signatory} onChange={setSignatory} /></div> : <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-14 text-center"><FileSpreadsheet className="mx-auto text-primary" size={24} /><h2 className="mt-4 text-sm font-semibold">Generate a controlled report snapshot</h2><p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted-foreground">Select a 31 December annual reporting period to derive statements, notes, comparative columns, controls, and ledger traceability from the client’s posted entries.</p></div>}
    <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => { if (!open) cancelDeletePack(); }}>
      <AlertDialogContent data-testid="dialog-delete-report-pack">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this report pack?</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingDeletePack
              ? `Snapshot for ${pendingDeletePack.periodEnd.slice(0, 10)} (status: ${pendingDeletePack.status}) will be permanently removed. Posted journal entries and statement lines are not affected.`
              : 'The saved report snapshot will be permanently removed. Posted entries are not affected.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-delete-report-pack" disabled={removePack.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="button-confirm-delete-report-pack"
            disabled={removePack.isPending}
            onClick={(event) => { event.preventDefault(); confirmDeletePack(); }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus:ring-destructive"
          >
            {removePack.isPending ? 'Deleting…' : 'Delete report pack'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
function Router() {
  return <Switch><Route path="/" component={Home} /><Route path="/user-portal" component={Home} /><Route path="/import-statement" component={ImportStatementPage} /><Route path="/statement-lines" component={StatementLinesPage} /><Route path="/contacts" component={ContactsPage} /><Route path="/journal-entries" component={JournalEntriesPage} /><Route path="/trial-balance" component={TrialBalancePage} /><Route path="/financial-statements" component={FinancialStatementsPage} /><Route path="/firm-settings" component={FirmSettingsPage} /><Route path="/client-settings" component={ClientSettingsPage} /><Route path="/workspace-settings" component={ClientSettingsPage} /><Route component={NotFound} /></Switch>;
}
function NotFound() {
  return <div className="grid min-h-[65vh] place-items-center text-center"><div><div className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">AgarAccounting AI System / 404</div><h1 className="mt-3 font-display text-4xl">This page is not in the close.</h1><Link href="/" data-testid="link-back-overview" className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline">Return to overview <ArrowRight size={14} /></Link></div></div>;
}

function WorkspaceRecoveryState({ onRetry }: { onRetry: () => void }) {
  return <div className="grid min-h-[100dvh] place-items-center bg-background px-5"><div className="w-full max-w-md rounded-lg border border-destructive/25 bg-card p-6 text-center shadow-sm" role="alert"><div className="mx-auto grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive"><CircleAlert size={19} /></div><h1 className="mt-4 text-base font-semibold">We couldn’t load your workspaces</h1><p className="mt-2 text-xs leading-5 text-muted-foreground">AgarAccounting AI could not retrieve the client workspaces available to this account. Your bookkeeping data has not been opened.</p><button data-testid="button-retry-workspaces" onClick={onRetry} className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"><RefreshCw size={14} /> Try again</button></div></div>;
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
    const onSuccess = (workspace: Client) => {
      notify.success(starterWorkspace ? 'Workspace updated' : 'Workspace ready', { description: `${workspace.name} · ${workspace.functionalCurrency}` });
      return void onComplete(workspace);
    };
    if (starterWorkspace) {
      update.mutate({ id: starterWorkspace.id, data }, { onSuccess });
    } else {
      create.mutate({ data }, { onSuccess });
    }
  };

  return <main className="grid min-h-[100dvh] place-items-center bg-background px-5 py-10" data-testid="workspace-onboarding"><div className="w-full max-w-2xl"><div className="mb-6 flex items-center justify-between"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center"><img src={brandMarkUrl} alt="" className="size-10 rounded-lg" /></div><div><div className="font-display text-[22px] leading-none tracking-tight">AgarAccounting AI</div><div className="mt-1 font-mono text-[9px] uppercase tracking-[.2em] text-muted-foreground">Private bookkeeping workspace</div></div></div><button data-testid="button-onboarding-logout" onClick={onLogout} className="rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted">Sign out</button></div><section className="rounded-lg border border-card-border bg-card p-6 shadow-md sm:p-9"><div className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">First-run setup</div><h1 className="mt-3 font-display text-[38px] leading-[.98] tracking-tight">Set up your private bookkeeping workspace.</h1><p className="mt-4 max-w-xl text-[13px] leading-6 text-muted-foreground">Before you open the close desk, tell AgarAccounting AI which client and reporting settings belong to this account. This creates a private workspace for your books—no demo transactions are added.</p><form onSubmit={submit} className="mt-8 grid gap-4 sm:grid-cols-2"><label className="block text-xs font-medium">Client name<input data-testid="input-onboarding-client-name" required minLength={1} value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="e.g. Northstar Advisory" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Legal name<input data-testid="input-onboarding-legal-name" required minLength={1} value={form.legalName} onChange={(event) => set('legalName', event.target.value)} placeholder="e.g. Northstar Advisory FZ-LLC" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Functional currency<select data-testid="select-onboarding-currency" value={form.functionalCurrency} onChange={(event) => set('functionalCurrency', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option value="AED">AED — UAE dirham</option><option value="USD">USD — US dollar</option><option value="EUR">EUR — euro</option><option value="GBP">GBP — pound sterling</option></select></label><label className="block text-xs font-medium">Reporting basis<select data-testid="select-onboarding-basis" value={form.basis} onChange={(event) => set('basis', event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option value="IFRS">IFRS</option><option value="IFRS for SMEs">IFRS for SMEs</option></select></label><label className="block text-xs font-medium sm:col-span-2">Close period<input data-testid="input-onboarding-period" required minLength={1} value={form.period} onChange={(event) => set('period', event.target.value)} placeholder="e.g. August 2026" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label>{(validationMessage || error) && <div data-testid="onboarding-error" className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs leading-5 text-destructive"><CircleAlert className="mt-0.5 shrink-0" size={14} /><span>{validationMessage || 'Workspace setup could not be saved. Check the details and try again.'}</span></div>}<div className="flex flex-col-reverse gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between"><p className="text-[11px] leading-5 text-muted-foreground">You can change these settings later from Workspace settings.</p><button data-testid="button-submit-onboarding" disabled={pending} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50">{pending ? <><LoaderCircle size={14} className="animate-spin" /> Saving workspace…</> : <><Check size={14} /> Save and open close overview</>}</button></div></form></section></div></main>;
}

type CompanyOnboardingUser = {
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddress: { emailAddress: string } | null;
};

function CompanyOnboarding({ user, onComplete, onLogout }: { user: CompanyOnboardingUser; onComplete: () => Promise<void> | void; onLogout: () => void }) {
  const [mode, setMode] = useState<'company' | 'firm' | 'both'>('company');
  const create = useCompleteOrganizationOnboarding();
  const updateProfile = useUpdateAgarAccountingAccountProfile();

  const [profile, setProfile] = useState({
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    workEmail: user.primaryEmailAddress?.emailAddress ?? '',
  });

  const [form, setForm] = useState({
    companyName: '',
    companyLegalName: '',
    firmName: '',
    firmLegalName: '',
  });

  const [validationMessage, setValidationMessage] = useState('');
  const pending = create.isPending || updateProfile.isPending;
  const error = create.error || updateProfile.error;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const personal = {
      firstName: profile.firstName.trim(),
      lastName: profile.lastName.trim(),
    };
    if (!personal.firstName || !personal.lastName) {
      setValidationMessage('Add your full name to continue.');
      return;
    }
    if ((mode === 'company' || mode === 'both') && (!form.companyName.trim() || !form.companyLegalName.trim())) {
      setValidationMessage('Add your company name and legal name to continue.');
      return;
    }
    if ((mode === 'firm' || mode === 'both') && (!form.firmName.trim() || !form.firmLegalName.trim())) {
      setValidationMessage('Add your accounting firm name and legal name to continue.');
      return;
    }
    setValidationMessage('');
    try {
      await updateProfile.mutateAsync({
        data: personal,
      });
      await create.mutateAsync({
        data: {
          mode: mode as OrganizationMode,
          firstName: personal.firstName,
          lastName: personal.lastName,
          ...(mode === 'company' || mode === 'both' ? {
             companyName: form.companyName.trim(),
             companyLegalName: form.companyLegalName.trim(),
             functionalCurrency: 'AED',
             basis: 'IFRS',
             period: 'August 2026'
          } : {}),
          ...(mode === 'firm' || mode === 'both' ? {
             firmName: form.firmName.trim(),
             firmLegalName: form.firmLegalName.trim()
          } : {})
        }
      });
      await onComplete();
    } catch {
      setValidationMessage('We couldn’t save your account details. Check your connection and try again.');
    }
  };

  return <main className="grid min-h-[100dvh] place-items-center bg-background px-5 py-10" data-testid="company-onboarding"><div className="w-full max-w-2xl"><div className="mb-6 flex items-center justify-between"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center"><img src={brandMarkUrl} alt="" className="size-10 rounded-lg" /></div><div><div className="font-display text-[22px] leading-none tracking-tight">AgarAccounting AI</div><div className="mt-1 font-mono text-[9px] uppercase tracking-[.2em] text-muted-foreground">Private bookkeeping workspace</div></div></div><button data-testid="button-onboarding-logout" onClick={onLogout} className="rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted">Sign out</button></div><section className="rounded-lg border border-card-border bg-card p-6 shadow-md sm:p-9"><div className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Personal details and account setup</div><h1 className="mt-3 font-display text-[38px] leading-[.98] tracking-tight">Set up your AgarAccounting AI System account.</h1><p className="mt-4 max-w-xl text-[13px] leading-6 text-muted-foreground">First, tell us how you will use AgarAccounting AI. You can use it for your own company, for an accounting firm, or both.</p>

    <div className="mt-6 flex gap-2 border-b border-border">
      <button type="button" onClick={() => setMode('company')} className={`pb-2 text-sm font-semibold ${mode === 'company' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'}`}>Own Company</button>
      <button type="button" onClick={() => setMode('firm')} className={`pb-2 ml-4 text-sm font-semibold ${mode === 'firm' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'}`}>Accounting Firm</button>
      <button type="button" onClick={() => setMode('both')} className={`pb-2 ml-4 text-sm font-semibold ${mode === 'both' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'}`}>Both</button>
    </div>

    <form onSubmit={submit} className="mt-8 grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><div className="text-xs font-semibold">Your details</div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">Your full name and work email identify the account owner.</p></div><label className="block text-xs font-medium">First name<input data-testid="input-onboarding-first-name" required minLength={1} value={profile.firstName} onChange={(event) => setProfile({ ...profile, firstName: event.target.value })} placeholder="e.g. Aisha" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Last name<input data-testid="input-onboarding-last-name" required minLength={1} value={profile.lastName} onChange={(event) => setProfile({ ...profile, lastName: event.target.value })} placeholder="e.g. Rahman" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium sm:col-span-2">Work email<input data-testid="input-onboarding-work-email" type="email" readOnly required value={profile.workEmail} className="mt-1.5 h-10 w-full cursor-not-allowed rounded-md border border-input bg-muted px-3 text-sm outline-none" /><span className="mt-1 block text-[10px] font-normal leading-4 text-muted-foreground">This is the verified email on your AgarAccounting AI System account.</span></label>

    {(mode === 'company' || mode === 'both') && <>
      <div className="sm:col-span-2"><div className="text-xs font-semibold">Your company</div></div><label className="block text-xs font-medium">Company name<input data-testid="input-onboarding-company-name" required minLength={1} value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} placeholder="e.g. Northstar Bookkeeping" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Legal company name<input data-testid="input-onboarding-legal-company-name" required minLength={1} value={form.companyLegalName} onChange={(event) => setForm({ ...form, companyLegalName: event.target.value })} placeholder="e.g. Northstar Bookkeeping FZ-LLC" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label>
    </>}

    {(mode === 'firm' || mode === 'both') && <>
      <div className="sm:col-span-2"><div className="text-xs font-semibold">Your accounting firm</div></div><label className="block text-xs font-medium">Firm name<input data-testid="input-onboarding-firm-name" required minLength={1} value={form.firmName} onChange={(event) => setForm({ ...form, firmName: event.target.value })} placeholder="e.g. Northstar Bookkeeping" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">Legal firm name<input data-testid="input-onboarding-legal-firm-name" required minLength={1} value={form.firmLegalName} onChange={(event) => setForm({ ...form, firmLegalName: event.target.value })} placeholder="e.g. Northstar Bookkeeping FZ-LLC" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /></label>
    </>}

    {(validationMessage || error) && <div data-testid="onboarding-error" className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs leading-5 text-destructive sm:col-span-2"><CircleAlert className="mt-0.5 shrink-0" size={14} /><span>{validationMessage || 'Account setup could not be saved. Check the details and try again.'}</span></div>}<div className="flex flex-col-reverse gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between"><p className="text-[11px] leading-5 text-muted-foreground"></p><button data-testid="button-submit-onboarding" disabled={pending} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50">{pending ? <><LoaderCircle size={14} className="animate-spin" /> Saving account…</> : <><Check size={14} /> Save and open workspace</>}</button></div></form></section></div></main>;
}

function AgarAccountingApp({ user, profileUser, onLogout }: { user: AgarAccountingUser; profileUser: CompanyOnboardingUser; onLogout: () => void }) {
  const orgQuery = useGetOrganizationContext({ query: { queryKey: getGetOrganizationContextQueryKey() } });
  const clientsQuery = useGetClients({ query: { queryKey: getGetClientsQueryKey() } });

  const orgContext = orgQuery.data;
  const clients = orgContext?.companies ?? clientsQuery.data ?? [];

  const workspaceLoadState = getWorkspaceLoadState(orgQuery.isLoading || clientsQuery.isLoading, orgQuery.isError || clientsQuery.isError, clients);
  const storageKey = getActiveWorkspaceStorageKey(user.externalId ?? user.id);
  const workspaceQueriesReady = !orgQuery.isLoading
    && !clientsQuery.isLoading
    && !orgQuery.isFetching
    && !clientsQuery.isFetching;
  const [activeClientId, setActiveClientId] = useState<number | null>(() => {
    const saved = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  });
  const [allowLegacyDemoSelection, setAllowLegacyDemoSelection] = useState(false);
  const [location, setLocation] = useLocation();
  const selectedClient = selectWorkspaceForSession(clients, activeClientId, allowLegacyDemoSelection);
  useEffect(() => {
    if (!workspaceQueriesReady) return;
    if (!clients.length) {
      if (activeClientId !== null) setActiveClientId(null);
      return;
    }
    if (selectedClient && activeClientId !== selectedClient.id) {
      setAllowLegacyDemoSelection(false);
      setActiveClientId(selectedClient.id);
    }
    if (selectedClient) window.localStorage.setItem(storageKey, String(selectedClient.id));
  }, [activeClientId, clients.length, selectedClient, storageKey, workspaceQueriesReady]);

  const chooseClient = (id: number) => {
    const client = clients.find((candidate) => candidate.id === id);
    if (client) {
      setAllowLegacyDemoSelection(client.legacyDemo);
      setActiveClientId(client.id);
      window.localStorage.setItem(storageKey, String(client.id));
    }
  };

  if (workspaceLoadState === 'loading') return <AuthLoadingState label="Loading your workspaces" />;
  if (workspaceLoadState === 'failed') return <WorkspaceRecoveryState onRetry={() => { orgQuery.refetch(); clientsQuery.refetch(); }} />;

  if (orgContext?.onboardingRequired) {
    const completeOnboarding = async () => {
      await queryClient.invalidateQueries({ queryKey: getGetOrganizationContextQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getGetClientsQueryKey() });
      setAllowLegacyDemoSelection(false);
      setLocation('/user-portal');
    };
    return <CompanyOnboarding user={profileUser} onComplete={completeOnboarding} onLogout={onLogout} />;
  }

  return <TooltipProvider><OrgContext.Provider value={orgContext}><ClientContext.Provider value={{ activeClient: selectedClient, clients, setActiveClientId: chooseClient }}><ErrorBoundary resetKey={location}><Shell user={user} onLogout={onLogout}><Router /></Shell></ErrorBoundary></ClientContext.Provider></OrgContext.Provider><Toaster /><SonnerToaster /></TooltipProvider>;
}

function AuthBoundary() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [location] = useLocation();
  const inviteToken = new URLSearchParams(window.location.search).get("invite");
  const orgToken = new URLSearchParams(window.location.search).get("organizationInvite");
  const currentUserId = user ? user.externalId ?? user.id : null;
  const [cacheReadyForUserId, setCacheReadyForUserId] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (cacheReadyForUserId !== currentUserId) {
      clearUserScopedState(queryClient);
      setCacheReadyForUserId(currentUserId);
    }
  }, [cacheReadyForUserId, currentUserId]);

  if (!isLoaded) return <AuthLoadingState />;
  if (!isSignedIn || !user) return <AccessScreen />;
  if (cacheReadyForUserId !== currentUserId) return <AuthLoadingState label="Preparing your secure workspace" />;
  if (location === "/" && !inviteToken && !orgToken) return <Redirect to="/user-portal" />;

  const handleLogout = () => {
    clearUserScopedState(queryClient);
    void signOut({ redirectUrl: basePath || "/" });
  };
  return <InviteAcceptanceGate><AgarAccountingApp key={currentUserId} user={user} profileUser={user} onLogout={handleLogout} /></InviteAcceptanceGate>;
}

function InviteAcceptanceGate({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), [location]);
  const workspaceToken = searchParams.get("invite");
  const orgToken = searchParams.get("organizationInvite");

  const acceptWorkspace = useAcceptWorkspaceInvitation();
  const acceptOrg = useAcceptOrganizationInvitation();
  const [message, setMessage] = useState("");
  const clearToken = () => setLocation("/user-portal", { replace: true });

  useEffect(() => {
    if (workspaceToken) {
      acceptWorkspace.mutate({ token: workspaceToken }, {
        onSuccess: () => {
          clearToken();
          queryClient.invalidateQueries({ queryKey: getGetClientsQueryKey() });
          notify.success('Workspace invitation accepted');
        },
        onError: (error) => {
          const msg = error instanceof Error ? error.message : "This workspace invitation could not be accepted.";
          setMessage(msg);
          notify.error(error, { title: 'Workspace invite failed', description: msg, fallback: msg });
        },
      });
    } else if (orgToken) {
      acceptOrg.mutate({ token: orgToken }, {
        onSuccess: () => {
          clearToken();
          queryClient.invalidateQueries({ queryKey: getGetOrganizationContextQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetClientsQueryKey() });
          notify.success('Organization invitation accepted');
        },
        onError: (error) => {
          const msg = error instanceof Error ? error.message : "This organization invitation could not be accepted.";
          setMessage(msg);
          notify.error(error, { title: 'Organization invite failed', description: msg, fallback: msg });
        },
      });
    }
  }, [workspaceToken, orgToken]);

  if (!workspaceToken && !orgToken) return <>{children}</>;
  if (acceptWorkspace.isPending || acceptOrg.isPending) return <AuthLoadingState label="Joining your invited workspace" />;
  if (!message) return <AuthLoadingState label="Joining your invited workspace" />;

  const retry = () => {
    setMessage("");
    if (workspaceToken) {
      acceptWorkspace.reset();
      acceptWorkspace.mutate({ token: workspaceToken }, { onSuccess: () => { clearToken(); queryClient.invalidateQueries({ queryKey: getGetClientsQueryKey() }); }, onError: (error) => setMessage(error instanceof Error ? error.message : "This workspace invitation could not be accepted.") });
    } else if (orgToken) {
      acceptOrg.reset();
      acceptOrg.mutate({ token: orgToken }, { onSuccess: () => { clearToken(); queryClient.invalidateQueries({ queryKey: getGetOrganizationContextQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetClientsQueryKey() }); }, onError: (error) => setMessage(error instanceof Error ? error.message : "This organization invitation could not be accepted.") });
    }
  };

  return <main className="grid min-h-[100dvh] place-items-center bg-background px-5"><div className="w-full max-w-md rounded-lg border border-destructive/25 bg-card p-6 text-center shadow-sm"><CircleAlert className="mx-auto text-destructive" size={20} /><h1 className="mt-3 text-base font-semibold">We couldn’t join that workspace</h1><p className="mt-2 text-xs leading-5 text-muted-foreground">{message}</p><div className="mt-5 flex justify-center gap-2"><button type="button" onClick={retry} className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Try again</button><button type="button" onClick={clearToken} className="rounded-md border border-border px-3 py-2 text-xs font-semibold">Continue without invite</button></div></div></main>;
}

function App() {
  return <WouterRouter base={basePath}><ClerkProviderWithRoutes /></WouterRouter>;
}
export default App;

function AuthRecoveryState({ onRetry }: { onRetry: () => void }) {
  return <div className="grid min-h-[100dvh] place-items-center bg-background px-5" data-testid="auth-recovery-state"><div className="w-full max-w-md rounded-lg border border-destructive/25 bg-card p-6 text-center shadow-sm" role="alert"><div className="mx-auto grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive"><CircleAlert size={19} /></div><h1 className="mt-4 text-base font-semibold">We couldn’t verify your access</h1><p className="mt-2 text-xs leading-5 text-muted-foreground">AgarAccounting AI System could not reach the session service. Your bookkeeping data has not been opened.</p><button data-testid="button-retry-auth" onClick={onRetry} className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"><RefreshCw size={14} /> Try again</button></div></div>;
}

function AccessScreen() {
  return <main className="grid min-h-[100dvh] place-items-center bg-background px-5 py-10" data-testid="auth-access-screen"><div className="w-full max-w-[420px]"><div className="rounded-lg border border-card-border bg-card p-7 shadow-md sm:p-9"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center"><img src={brandMarkUrl} alt="" className="size-10 rounded-lg" /></div><div><div className="font-display text-[22px] leading-none tracking-tight">AgarAccounting AI</div><div className="mt-1 font-mono text-[9px] uppercase tracking-[.2em] text-muted-foreground">Review desk</div></div></div><div className="mt-10"><div className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Secure access</div><h1 className="mt-3 font-display text-[36px] leading-[.98] tracking-tight">Your close, ready for review.</h1><p className="mt-4 text-[13px] leading-6 text-muted-foreground">Sign in to open your private bookkeeping review desk. New to AgarAccounting AI System? The same secure flow lets you create an account.</p><Link data-testid="button-login" href="/sign-in" className="focus-ring mt-7 flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5">Sign in or create account</Link><Link data-testid="link-feedback-access-screen" href="/feedback" className="mt-4 flex w-full items-center justify-center gap-1 text-[12px] font-semibold text-primary underline-offset-2 hover:underline">See what others are saying <ArrowRight size={12} /></Link></div></div><p className="mt-5 text-center font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground/70">Secure session · Human posting control</p></div></main>;
}

function SignInPage() {
  const redirectTarget = safePostAuthRedirect(new URLSearchParams(window.location.search).get("redirect_url"));
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} forceRedirectUrl={redirectTarget} fallbackRedirectUrl={redirectTarget} /></div>;
}
function SignUpPage() {
  const redirectTarget = safePostAuthRedirect(new URLSearchParams(window.location.search).get("redirect_url"));
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} forceRedirectUrl={redirectTarget} fallbackRedirectUrl={redirectTarget} /></div>;
}

function safePostAuthRedirect(raw: string | null) {
  const fallback = `${window.location.origin}${basePath || ""}/` || `${window.location.origin}/`;
  if (!raw) return fallback;
  try {
    if (raw.startsWith("/") && !raw.startsWith("//")) {
      return `${window.location.origin}${basePath}${raw}`;
    }
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
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
        <Route path="/feedback">
          <PublicFeedbackEntry />
        </Route>
        <Route component={AuthBoundary} />
      </Switch>
    </QueryClientProvider>
  </ClerkProvider>;
}

function PublicFeedbackEntry() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  if (!isLoaded) return <div className="grid min-h-[100dvh] place-items-center text-xs text-muted-foreground">Loading feedback…</div>;
  if (isSignedIn && user) {
    const handleLogout = () => {
      clearUserScopedState(queryClient);
      void signOut({ redirectUrl: basePath || "/" });
    };
    return <InviteAcceptanceGate><FeedbackPublicShell signedIn onLogout={handleLogout}><FeedbackPage signedIn /></FeedbackPublicShell></InviteAcceptanceGate>;
  }
  return <FeedbackPublicShell><FeedbackPage signedIn={false} /></FeedbackPublicShell>;
}

type AIProviderName = 'managed_openai' | 'openai' | 'anthropic';

function AIProviderSettingsPanel({ clientId }: { clientId: number }) {
  const params = { clientId };
  const settings = useGetAgarAccountingAISettings(params);
  const save = useUpdateAgarAccountingAISettings();
  const test = useTestAgarAccountingAISettings();
  const remove = useRemoveAgarAccountingAICredential();
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
        const message = result.provider === 'managed_openai' ? 'Replit-managed OpenAI is selected.' : 'AI provider settings saved. Test the connection before using it.';
        setNotice(message);
        notify.success('AI provider saved', { description: message });
        settings.refetch();
      },
    });
  };
  const testSettings = () => {
    setNotice('');
    test.mutate({ data: { clientId } }, {
      onSuccess: () => {
        const message = 'Connection test passed. This workspace can use the selected provider.';
        setNotice(message);
        notify.success('AI connection healthy', { description: message });
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
        const message = 'Workspace API key removed. Replit-managed OpenAI is selected.';
        setNotice(message);
        notify.success('AI key removed', { description: message });
        settings.refetch();
      },
    });
  };
  const status = settings.data?.credentialStatus;
  const error = save.error ?? test.error ?? remove.error;
  return <section className="mt-6 border-t border-border pt-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">AI provider</div><h3 className="mt-1 text-sm font-semibold">AI connection</h3><p className="mt-1 max-w-xl text-[11px] leading-5 text-muted-foreground">Choose Replit-managed OpenAI or use a workspace-owned OpenAI or Anthropic API key. Approved models are updated by your workspace without requiring an AgarAccounting AI System update.</p></div>{settings.data && <span className={`rounded-full px-2 py-1 font-mono text-[9px] ${status === 'configured' || settings.data.provider === 'managed_openai' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>{settings.data.provider === 'managed_openai' ? 'Managed connection' : status === 'configured' ? 'Key configured' : status?.replaceAll('_', ' ')}</span>}</div><form onSubmit={saveSettings} className="mt-4 grid gap-3 sm:grid-cols-2"><label className="block text-xs font-medium">Provider<select data-testid="select-ai-provider" value={provider} onChange={(event) => chooseProvider(event.target.value as AIProviderName)} disabled={settings.isLoading} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary disabled:opacity-50"><option value="managed_openai">Replit-managed OpenAI</option><option value="openai">Workspace-owned OpenAI</option><option value="anthropic">Workspace-owned Anthropic</option></select></label><label className="block text-xs font-medium">Model<select data-testid="select-ai-model" value={model} onChange={(event) => setModel(event.target.value)} disabled={settings.isLoading || !activeModels.length} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary disabled:opacity-50">{selectedModelIsUnavailable && <option value={model} disabled>{selectedModel ? `${selectedModel.displayName} — retired` : `${model} — unavailable`}</option>}{activeModels.length ? activeModels.map((item) => <option key={item.model} value={item.model}>{item.displayName} ({item.model})</option>) : <option value="">No active approved models</option>}</select><span className="mt-1 block text-[10px] font-normal leading-4 text-muted-foreground">Only active models can be selected for new configurations.</span></label>{selectedModelIsUnavailable && <p data-testid="ai-model-recovery-guidance" role="alert" className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-[11px] leading-5 text-destructive sm:col-span-2">This workspace is configured with a model that is no longer available. Select an active replacement above, then save before testing or using the AI assistant.</p>}{provider !== 'managed_openai' && <label className="block text-xs font-medium sm:col-span-2">API key<input data-testid="input-ai-provider-key" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.data?.provider === provider && settings.data.credentialLast4 ? `Stored key ends in ${settings.data.credentialLast4}; enter a key only to replace it` : 'Paste the workspace API key'} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary" /><span className="mt-1 block text-[10px] font-normal leading-4 text-muted-foreground">{provider === 'anthropic' ? 'A Claude Pro or Max subscription is not an Anthropic API credential; API billing is separate.' : 'Use an API key created for this workspace. The full key is never returned to your browser.'}</span></label>}<div className="flex flex-wrap items-center gap-2 sm:col-span-2"><button data-testid="button-save-ai-settings" disabled={save.isPending || settings.isLoading || selectedModelIsUnavailable || !model} className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{save.isPending ? 'Saving…' : provider === 'managed_openai' ? 'Use managed OpenAI' : apiKey ? 'Save & rotate key' : 'Save provider'}</button><button data-testid="button-test-ai-provider" type="button" onClick={testSettings} disabled={test.isPending || save.isPending || settings.isLoading || selectedModelIsUnavailable || !model} className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50">{test.isPending ? 'Testing…' : 'Test connection'}</button>{settings.data?.provider !== 'managed_openai' && <button data-testid="button-remove-ai-provider-key" type="button" onClick={removeCredential} disabled={remove.isPending} className="rounded-md px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50">{remove.isPending ? 'Removing…' : 'Remove key'}</button>}</div></form>{settings.isLoading && <p className="mt-3 text-[11px] text-muted-foreground">Loading AI connection…</p>}{notice && <p data-testid="ai-settings-notice" className="mt-3 text-[11px] font-medium text-primary">{notice}</p>}{error && <p data-testid="ai-settings-error" className="mt-3 text-[11px] font-medium text-destructive">{error instanceof Error ? error.message : 'AI provider settings could not be updated. Try again.'}</p>}</section>;
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
  const usageQuery = useGetAgarAccountingUsage({
    query: {
      queryKey: getGetAgarAccountingUsageQueryKey(),
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
  const { activeClient } = useClientWorkspace();
  const accountParams = { clientId: activeClient?.id ?? 0 };
  const accountQuery = useGetLedgerflowAccounts(accountParams, { query: { queryKey: getGetLedgerflowAccountsQueryKey(accountParams), enabled: !!activeClient } });
  const accounts = accountQuery.data ?? [];
  const isRecode = action.type === 'recode_lines';
  const proposedContactCount = lines.filter((line) => !line.contactId && line.contactReviewDisposition !== 'dismissed' && line.proposedContactName).length;
  const [accountSuggestion, setAccountSuggestion] = useState(accounts[0]?.accountName ?? '');
  useEffect(() => {
    if (!accounts.some((account) => account.accountName === accountSuggestion)) {
      setAccountSuggestion(accounts[0]?.accountName ?? '');
    }
  }, [accounts, accountSuggestion]);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const transition = action.type === 'bulk_post_entries'
    ? { from: 'draft', to: 'posted', verb: 'post', label: 'posting' }
    : { from: 'draft', to: 'reclassified', verb: 'recode', label: 'recode' };

  return <AlertDialog open onOpenChange={(open) => { if (!open && !pending) onCancel(); }}>
    <AlertDialogContent onOpenAutoFocus={(event) => { event.preventDefault(); requestAnimationFrame(() => cancelButtonRef.current?.focus()); }} className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-card-border bg-card">
      <AlertDialogHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0 flex-1 text-left">
          <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Confirm bulk action</div>
          <AlertDialogTitle data-testid="text-bulk-confirm-title" className="mt-2 break-words">{isRecode ? 'Recode selected lines' : `${transition.verb[0].toUpperCase()}${transition.verb.slice(1)} selected entries`}</AlertDialogTitle>
        </div>
        <button ref={cancelButtonRef} data-testid="button-cancel-bulk-action" onClick={onCancel} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Cancel bulk action"><X size={17} /></button>
      </AlertDialogHeader>
      <AlertDialogDescription data-testid="text-bulk-confirm-description" className="min-w-0 break-words text-xs leading-5">
        {isRecode
          ? `You are about to recode ${lines.length} draft ${lines.length === 1 ? 'line' : 'lines'} to one account. This updates the draft classification but does not post it.`
          : `Confirm ${transition.label} for ${lines.length} ${lines.length === 1 ? 'entry' : 'entries'}: ${transition.from} → ${transition.to}. ${action.type === 'bulk_post_entries' && proposedContactCount ? `${proposedContactCount} temporary contact ${proposedContactCount === 1 ? 'profile will' : 'profiles will'} be created or reused atomically.` : 'This cannot include entries that have changed status.'}`}
      </AlertDialogDescription>
      {isRecode && <label className="block text-xs font-semibold">
        <span className="flex items-center gap-1.5">
          Supported account
          {accountQuery.isFetching && <LoaderCircle size={11} className="animate-spin text-primary" aria-label="Refreshing accounts" />}
        </span>
        <select
          data-testid="select-bulk-recode-account"
          aria-busy={accountQuery.isLoading}
          disabled={accountQuery.isLoading}
          value={accountSuggestion}
          onChange={(event) => setAccountSuggestion(event.target.value)}
          className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus:border-primary disabled:opacity-50"
        >
          {accountQuery.isLoading
            ? <option value="">Loading accounts…</option>
            : !accounts.length
              ? <option value="">No active accounts available</option>
              : accounts.map((account) => <option key={account.id} value={account.accountName}>{account.accountCode} · {account.displayName} · {account.statementSection} · {account.taxTreatment.replaceAll('_', ' ')}</option>)}
        </select>
      </label>}
      <div className="mt-4 rounded-md border border-border bg-muted/35 p-3">
        <div className="font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">Selected lines · {lines.length}</div>
        <div className="mt-2 space-y-1.5">
          {lines.slice(0, 5).map((line) => <div data-testid={`bulk-confirm-line-${line.id}`} key={line.id} className="flex min-w-0 items-center justify-between gap-3 text-xs">
            <span className="truncate">{line.description}</span><span className="shrink-0 font-mono text-muted-foreground">{money(Math.abs(line.amount), line.currency)}</span>
          </div>)}
          {lines.length > 5 && <div className="pt-1 font-mono text-[10px] text-muted-foreground">+ {lines.length - 5} more selected</div>}
        </div>
      </div>
      {error != null && <div data-testid="status-bulk-action-error" className="mt-4 flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive"><CircleAlert size={15} className="mt-0.5 shrink-0" /><span>{mutationErrorMessage(error)}</span></div>}
      <AlertDialogFooter className="mt-2 flex-wrap gap-2 sm:space-x-0">
        <button data-testid="button-cancel-bulk-action-footer" onClick={onCancel} disabled={pending} className="min-w-0 rounded-md border border-input bg-background px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50">Cancel</button>
        <button data-testid={`button-confirm-${isRecode ? 'bulk-recode' : 'bulk-posting'}`} onClick={() => onConfirm(isRecode ? accountSuggestion : undefined)} disabled={pending || (isRecode && !accountSuggestion)} className="inline-flex min-w-0 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
          {pending && <LoaderCircle size={13} className="animate-spin" />}{pending ? 'Applying…' : `Confirm ${transition.verb}`}
        </button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

function mutationErrorMessage(error: unknown, fallback = 'The bulk action could not be applied. Refresh the queue and try again.') {
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (typeof data === 'object' && data !== null && 'error' in data && typeof (data as { error?: unknown }).error === 'string') {
      return (data as { error: string }).error;
    }
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    // Avoid dumping Express HTML 500 pages into the statement-line Post button.
    if (!message || /<!DOCTYPE|<html[\s>]|Internal Server Error/i.test(message)) return fallback;
    if (/^HTTP \d{3}\b/.test(message) && message.length > 180) return fallback;
    return message;
  }
  return fallback;
}

function StatementSourcePreview({ source, onClose }: { source: StatementImport; onClose: () => void }) {
  const [embedFailed, setEmbedFailed] = useState(false);
  const downloadUrl = source.sourceUrl ? `${source.sourceUrl}${source.sourceUrl.includes('?') ? '&' : '?'}download=true` : '';
  const canPreview = isBrowserPreviewableStatement(source);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape, { capture: true });
    return () => window.removeEventListener('keydown', closeOnEscape, { capture: true });
  }, [onClose]);

  return <DialogContent data-testid={`dialog-statement-source-preview-${source.id}`} className="flex max-h-[calc(100dvh-2rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0">
    <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-14">
      <DialogTitle className="text-base">Source preview</DialogTitle>
      <DialogDescription className="mt-1 truncate text-xs" title={source.fileName}>{source.fileName}</DialogDescription>
    </DialogHeader>
    <div className="min-h-0 flex-1 bg-muted/30 p-4">
      {canPreview && !embedFailed ? <div className="relative h-[min(65vh,720px)] min-h-[320px] overflow-hidden rounded-md border border-border bg-background">
        <iframe data-testid={`iframe-statement-source-preview-${source.id}`} title={`Preview of ${source.fileName}`} src={source.sourceUrl ?? undefined} tabIndex={-1} className="h-full w-full border-0" onError={() => setEmbedFailed(true)} />
      </div> : <div data-testid={`fallback-statement-source-preview-${source.id}`} className="flex min-h-[320px] flex-col items-center justify-center rounded-md border border-dashed border-border bg-background px-6 py-10 text-center">
        <FileSpreadsheet className="text-primary" size={28} />
        <h3 className="mt-4 text-sm font-semibold">{embedFailed ? 'This source could not be previewed' : 'This file type cannot be previewed here'}</h3>
        <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">{embedFailed ? 'The source could not be rendered in the preview. It may have expired or is temporarily unavailable.' : 'AgarAccounting can preview PDF statements in the popout. Download this source to inspect the original file.'}</p>
      </div>}
    </div>
    <DialogFooter className="shrink-0 border-t border-border px-5 py-4">
      {downloadUrl ? <a data-testid={`link-download-statement-source-${source.id}`} href={downloadUrl} download className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-muted"><Download size={14} /> Download source</a> : null}
      <button data-testid={`button-close-statement-source-preview-${source.id}`} type="button" onClick={onClose} className="h-9 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90">Close preview</button>
    </DialogFooter>
  </DialogContent>;
}

const emptyChartAccountForm: ChartAccountForm = {
  accountCode: '',
  accountName: '',
  displayName: '',
  statementSection: 'expense' as const,
  currentNonCurrent: 'not_applicable' as const,
  cashFlowCategory: 'operating' as const,
  taxTreatment: 'review_required' as const,
  taxTreatmentReason: '',
  sortOrder: 1000,
};

function ChartAccountsSection({ clientId }: { clientId: number }) {
  const params = { clientId, includeArchived: true };
  const query = useGetLedgerflowAccounts(params, { query: { queryKey: getGetLedgerflowAccountsQueryKey(params) } });
  const create = useCreateLedgerflowAccount();
  const update = useUpdateLedgerflowAccount();
  const archive = useArchiveLedgerflowAccount();
  const [filter, setFilter] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyChartAccountForm);
  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetLedgerflowAccountsQueryKey() });
  const reset = () => { setEditingId(null); setForm(emptyChartAccountForm); };
  const edit = (account: LedgerflowAccount) => {
    setEditingId(account.id);
    setForm({
      accountCode: account.accountCode,
      accountName: account.accountName,
      displayName: account.displayName,
      statementSection: account.statementSection,
      currentNonCurrent: account.currentNonCurrent,
      cashFlowCategory: account.cashFlowCategory,
      taxTreatment: account.taxTreatment,
      taxTreatmentReason: account.taxTreatmentReason ?? '',
      sortOrder: account.sortOrder,
    });
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const data = { clientId, ...form, taxTreatmentReason: form.taxTreatmentReason || null };
    const displayName = form.displayName || form.accountName;
    const wasEditing = editingId !== null;
    const options = { onSuccess: () => { reset(); refresh(); notify.success(wasEditing ? 'Account updated' : 'Account added', { description: `${form.accountCode} · ${displayName}` }); } };
    if (editingId) update.mutate({ id: editingId, data }, options);
    else create.mutate({ data }, options);
  };
  const rows = (query.data ?? []).filter((account) =>
    `${account.accountCode} ${account.displayName} ${account.statementSection} ${account.taxTreatment}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const pending = create.isPending || update.isPending;
  return <section id="chart-of-accounts" className="scroll-mt-24 rounded-lg border border-card-border bg-card p-5 md:p-6">
    <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Client accounting / UAE tax mapping</div>
    <h2 className="mt-2 text-base font-semibold">Chart of accounts</h2>
    <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Active accounts appear in review and bulk recoding. Tax treatments are decision-support mappings controlled by the accountant; business purpose, evidence, apportionment, and current Ministry of Finance or Federal Tax Authority guidance still govern.</p>
    <form onSubmit={submit} className="mt-5 grid gap-3 rounded-md border border-border bg-background p-4 md:grid-cols-2 xl:grid-cols-4">
      <label className="text-xs font-medium">Code<input required value={form.accountCode} disabled={Boolean(editingId && query.data?.find((account) => account.id === editingId)?.isSystem)} onChange={(e) => setForm({ ...form, accountCode: e.target.value })} className="mt-1.5 h-9 w-full rounded-md border border-input bg-card px-3 text-sm disabled:opacity-60" /></label>
      <label className="text-xs font-medium">Account name<input required value={form.accountName} disabled={Boolean(editingId && query.data?.find((account) => account.id === editingId)?.isSystem)} onChange={(e) => setForm({ ...form, accountName: e.target.value })} className="mt-1.5 h-9 w-full rounded-md border border-input bg-card px-3 text-sm disabled:opacity-60" /></label>
      <label className="text-xs font-medium">Display name<input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className="mt-1.5 h-9 w-full rounded-md border border-input bg-card px-3 text-sm" /></label>
      <label className="text-xs font-medium">Account type<select value={form.statementSection} disabled={Boolean(editingId && query.data?.find((account) => account.id === editingId)?.isSystem)} onChange={(e) => setForm({ ...form, statementSection: e.target.value as typeof form.statementSection })} className="mt-1.5 h-9 w-full rounded-md border border-input bg-card px-3 text-sm disabled:opacity-60"><option value="asset">Asset</option><option value="liability">Liability</option><option value="equity">Equity</option><option value="revenue">Revenue</option><option value="expense">Expense</option><option value="oci">OCI</option></select></label>
      <label className="text-xs font-medium xl:col-span-2">UAE Corporate Tax treatment<select value={form.taxTreatment} onChange={(e) => setForm({ ...form, taxTreatment: e.target.value as typeof form.taxTreatment })} className="mt-1.5 h-9 w-full rounded-md border border-input bg-card px-3 text-sm"><option value="ordinary_deductible">Ordinary deductible business expense</option><option value="entertainment_limited">Entertainment — 50% limitation</option><option value="fully_non_deductible">Fully non-deductible</option><option value="review_required">Accountant review required</option></select></label>
      <label className="text-xs font-medium xl:col-span-2">Treatment reason<input value={form.taxTreatmentReason} onChange={(e) => setForm({ ...form, taxTreatmentReason: e.target.value })} placeholder="State the intended treatment and evidence assumption" className="mt-1.5 h-9 w-full rounded-md border border-input bg-card px-3 text-sm" /></label>
      <div className="flex gap-2 md:col-span-2 xl:col-span-4"><button disabled={pending} className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{editingId ? 'Save account' : 'Add account'}</button>{editingId && <button type="button" onClick={reset} className="rounded-md border border-input px-4 py-2 text-xs font-semibold">Cancel</button>}</div>
    </form>
    <div className="mt-5"><div className="relative max-w-md"><Search className="absolute left-3 top-2.5 text-muted-foreground" size={14} /><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by code, account, type, or treatment" className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs" /></div></div>
    <div className="mt-4 overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[820px] text-left text-xs"><thead className="bg-muted/55 font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground"><tr><th className="px-3 py-2">Code</th><th className="px-3 py-2">Account</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Tax treatment</th><th className="px-3 py-2">State</th><th className="px-3 py-2 text-right">Actions</th></tr></thead>
      <tbody className="divide-y divide-border">{query.isLoading ? <tr><td colSpan={6} className="p-4 text-muted-foreground">Loading chart…</td></tr> : rows.length ? rows.map((account) => <tr key={account.id} className={!account.isActive ? 'opacity-60' : ''}><td className="px-3 py-3 font-mono">{account.accountCode}</td><td className="px-3 py-3"><div className="font-semibold">{account.displayName}</div><div className="mt-1 text-[10px] text-muted-foreground">{account.taxTreatmentReason || 'No treatment note'}{account.referenced ? ' · referenced by ledger history' : ''}</div></td><td className="px-3 py-3 capitalize">{account.statementSection}</td><td className="px-3 py-3">{account.taxTreatment.replaceAll('_', ' ')}</td><td className="px-3 py-3">{account.isActive ? 'Active' : 'Archived'}{account.isSystem ? ' · protected' : ''}</td><td className="px-3 py-3 text-right"><button type="button" onClick={() => edit(account)} className="font-semibold text-primary hover:underline">Edit</button>{account.isActive && !account.isSystem && <button type="button" onClick={() => { if (window.confirm(`Archive ${account.displayName}? Historical references will remain intact.`)) archive.mutate({ id: account.id, data: { clientId } }, { onSuccess: () => { refresh(); notify.success(`${account.displayName} archived`); } }); }} className="ml-3 font-semibold text-destructive hover:underline">Archive</button>}</td></tr>) : <tr><td colSpan={6} className="p-4 text-muted-foreground">No chart accounts match this filter.</td></tr>}</tbody></table>
    </div>
  </section>;
}
