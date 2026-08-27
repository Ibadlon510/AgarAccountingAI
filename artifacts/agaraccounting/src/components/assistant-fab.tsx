import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles, X, Paperclip, Send, Loader2, ArrowRight, Check, CircleAlert,
  Menu, Maximize2, Minimize2, Plus, MoreVertical, Trash2, Edit2, AlertCircle,
  ListTodo, Search, TrendingUp, Tag, ArrowUpRight, Landmark, RotateCw
} from 'lucide-react';
import { useClientWorkspace } from '@/lib/workspace-context';
import {
  useAskAgarAccountingAI,
  useImportStatement,
  useConfirmAICopilotAction,
  useGetStatementImports,
  useGetAgarAccountingAIConversations,
  useGetAgarAccountingAIConversation,
  useCreateAgarAccountingAIConversation,
  useRenameAgarAccountingAIConversation,
  useClearAgarAccountingAIConversation,
  getGetStatementImportsQueryKey,
  getGetStatementLinesQueryKey,
  getGetBulkTransitionAuditsQueryKey,
  getGetLedgerOverviewQueryKey,
  getGetJournalEntriesQueryKey,
  getGetBankAccountsQueryKey,
  getGetTrialBalanceQueryKey,
  getGetFinancialStatementsQueryKey,
  getGetContactsQueryKey,
  getGetAgarAccountingAIConversationsQueryKey,
  getGetAgarAccountingAIConversationQueryKey
} from '@workspace/api-client-react';
import type {
  AIChatResponse, AICopilotRecommendation,
  AIAccountingResult, AIAccountingCitation,
  Client
} from '@workspace/api-client-react';
import { useUpload } from '@workspace/object-storage-web';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { useAssistantPageContext } from '@/lib/assistant-page-context';

type RenderMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  response?: AIChatResponse;
  type?: 'text' | 'import-progress' | 'import-result' | 'error';
  errorPrompt?: string;
  importData?: {
    importedCount?: number;
    pendingConfirmation?: boolean;
    detectedCurrency?: string | null;
    error?: string;
    bankAccountName?: string;
    accountNumberLast4?: string | null;
  };
};

const MAX_IMPORT_FILE_SIZE = 50 * 1024 * 1024;
const ASSISTANT_STATE_STORAGE_KEY = 'agaraccounting-ai-assistant-state';

type PendingImport = {
  clientId: number;
  fileName: string;
  objectPath: string;
  startedAt: number;
  progressMessageId: string;
};

type AssistantState = {
  pendingImports: Record<string, PendingImport>;
};

function readAssistantState(): AssistantState {
  try {
    const stored = window.localStorage.getItem(ASSISTANT_STATE_STORAGE_KEY);
    if (!stored) return { pendingImports: {} };
    const parsed = JSON.parse(stored) as Partial<AssistantState>;
    return { pendingImports: parsed.pendingImports ?? {} };
  } catch {
    return { pendingImports: {} };
  }
}

function getErrorMessage(error: unknown) {
  let message: string | null = null;
  if (typeof error === 'object' && error !== null) {
    if ('data' in error) {
      const data = (error as { data?: unknown }).data;
      if (typeof data === 'object' && data !== null && 'error' in data && typeof (data as { error?: unknown }).error === 'string') {
        message = (data as { error: string }).error;
      } else if (typeof data === 'string') {
        message = data;
      }
    }
    if (!message && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
      message = (error as { message: string }).message;
    }
  }
  if (!message && typeof error === 'string') message = error;
  return (message ?? 'Unknown error').replace(/^HTTP\s+\d+\s*:\s*/i, '');
}

function getErrorThreadId(error: unknown) {
  if (typeof error !== 'object' || error === null || !('data' in error)) return null;
  const data = (error as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null || !('threadId' in data)) return null;
  const threadId = Number((data as { threadId?: unknown }).threadId);
  return Number.isFinite(threadId) ? threadId : null;
}

function resultValue(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  return Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => `${key} ${String(entry)}`)
    .join(' · ');
}

function ResultCard({ result }: { result: AIAccountingResult }) {
  if (result.insufficientData) {
    return (
      <div className="mt-3 border border-border rounded-md bg-muted/30 p-3 shadow-sm">
        <div className="font-semibold text-[12px]">{result.title}</div>
        <p className="text-[11px] text-muted-foreground mt-1">Insufficient data to complete this request.</p>
      </div>
    );
  }

  const rowKeys = result.rows.length > 0 ? Object.keys(result.rows[0]) : [];
  const totalKeys = result.totals ? Object.keys(result.totals) : [];
  const columns = Array.from(new Set([...rowKeys, ...totalKeys]));

  const rows = result.rows;
  const totals = result.totals;

  return (
    <div data-testid={`card-result-${result.title.replace(/\s+/g, '-').toLowerCase()}`} className="mt-3 border border-border rounded-md bg-card overflow-hidden shadow-sm">
       <div className="border-b border-border bg-muted/40 px-3 py-2">
         <div className="break-words text-[12px] font-semibold [overflow-wrap:anywhere]">{result.title}</div>
         {!result.complete && <div className="mt-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-500">Partial results shown</div>}
       </div>
       {(rows.length > 0 || totalKeys.length > 0) && (
         <div className="overflow-x-auto">
           <table className="w-full text-[11px] text-left">
             <thead className="bg-muted/20 text-muted-foreground">
               <tr>
                 {columns.map(c => <th key={c} className="px-3 py-1.5 font-medium whitespace-nowrap">{c}</th>)}
               </tr>
             </thead>
             <tbody className="divide-y divide-border/50">
               {rows.map((row, i) => (
                 <tr key={i} className="hover:bg-muted/10 transition-colors">
                   {columns.map(c => <td key={c} className="px-3 py-1.5 whitespace-nowrap">{resultValue(row[c])}</td>)}
                 </tr>
               ))}
             </tbody>
             {totalKeys.length > 0 && (
               <tfoot className="bg-muted/20 font-semibold border-t border-border">
                 <tr>
                   {columns.map((c, i) => (
                     <td key={c} className="px-3 py-1.5 whitespace-nowrap">{totals[c] !== undefined && totals[c] !== null ? resultValue(totals[c]) : (i === 0 && rows.length > 0 ? 'Total' : '')}</td>
                   ))}
                 </tr>
               </tfoot>
             )}
           </table>
         </div>
       )}
       {result.calculationNotes && result.calculationNotes.length > 0 && (
         <div className="p-3 bg-muted/10 border-t border-border space-y-1">
           {result.calculationNotes.map((note, i) => (
             <div key={i} className="text-[10px] text-muted-foreground flex gap-1.5 leading-relaxed">
                <span className="opacity-50 mt-0.5">•</span> <span>{note}</span>
             </div>
           ))}
         </div>
       )}
    </div>
  );
}

function Citations({ citations }: { citations: AIAccountingCitation[] }) {
  if (!citations || citations.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
      {citations.map((c, i) => (
        <Link key={i} href={c.href} className="inline-flex items-center gap-1.5 rounded-md bg-secondary/50 hover:bg-secondary border border-border/50 px-2 py-1 text-[10px] font-mono text-secondary-foreground transition-all hover:shadow-sm">
          {c.label} <ArrowUpRight size={10} className="opacity-50" />
        </Link>
      ))}
    </div>
  );
}

function RecommendationCard({ rec, activeClientId, activeThreadId, onClose, onApplied }: { rec: AICopilotRecommendation; activeClientId: number; activeThreadId: number | null; onClose: () => void; onApplied?: () => void }) {
  const confirmMutation = useConfirmAICopilotAction();
  const queryClient = useQueryClient();

  const isBulkAction = rec.type === 'bulk_post_entries';
  const isConfirmable = rec.requiresConfirmation && (rec.type === 'recode_lines' || rec.type === 'create_bank_account' || isBulkAction);
  const isNavigable = rec.type === 'next_step' || rec.type === 'review_group';
  const actionLabel = rec.type === 'bulk_post_entries' ? 'posting' : 'proposal';

  const handleConfirm = () => {
    confirmMutation.mutate({
      data: {
        clientId: rec.clientId,
        type: rec.type as 'recode_lines' | 'create_bank_account' | 'bulk_post_entries',
        lineIds: rec.lineIds,
        entryIds: rec.entryIds,
        statementLineIds: rec.statementLineIds,
        accountSuggestion: rec.accountSuggestion,
        confidence: rec.confidence,
        bankAccount: rec.bankAccount
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBulkTransitionAuditsQueryKey({ clientId: activeClientId }) });
        queryClient.invalidateQueries({ queryKey: getGetLedgerOverviewQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetJournalEntriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTrialBalanceQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetFinancialStatementsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBankAccountsQueryKey({ clientId: activeClientId }) });
        queryClient.invalidateQueries({ queryKey: getGetContactsQueryKey() });
        onApplied?.();
      }
    });
  };

  return (
    <div className="mt-3 min-w-0 max-w-full overflow-hidden rounded-md border border-border bg-card p-3 shadow-sm">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 break-words text-[12px] font-semibold [overflow-wrap:anywhere]">{rec.title}</div>
        {rec.confidence != null && (
          <div className="shrink-0 rounded border border-border/50 bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {Math.round(rec.confidence * 100)}% conf
          </div>
        )}
      </div>
      <p className="mt-1.5 break-words text-[11px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{rec.summary}</p>
      {(rec as any).suggestionSource === 'workspace_learning' && (
        <div data-testid={`workspace-learning-recommendation-${rec.id}`} className="mt-2 inline-flex items-center gap-1.5 rounded bg-primary/10 px-2 py-1 font-mono text-[10px] font-semibold text-primary">
          <Sparkles size={11} /> Workspace learned · {(rec as any).supportingPatternCount ?? 0} confirmed pattern{((rec as any).supportingPatternCount ?? 0) === 1 ? '' : 's'}
        </div>
      )}

      {rec.type === 'recode_lines' && rec.accountSuggestion && (
        <div className="mt-2.5 flex items-center gap-2 text-[10px] font-mono">
          <span className="text-muted-foreground">Suggests:</span>
          <span className="font-semibold px-1.5 py-0.5 bg-secondary/40 rounded">{rec.accountSuggestion}</span>
        </div>
      )}

      {rec.type === 'create_bank_account' && rec.bankAccount && (
        <div className="mt-2.5 text-[10px] font-mono space-y-1.5 bg-muted/40 p-2 rounded">
          <div><span className="text-muted-foreground">Name:</span> {rec.bankAccount.name}</div>
          {rec.bankAccount.bankName && <div><span className="text-muted-foreground">Bank:</span> {rec.bankAccount.bankName}</div>}
          {rec.bankAccount.accountNumberLast4 && <div><span className="text-muted-foreground">Acct ends in:</span> {rec.bankAccount.accountNumberLast4}</div>}
          <div><span className="text-muted-foreground">Currency:</span> {rec.bankAccount.currency}</div>
        </div>
      )}

      {isBulkAction && (
        <div className="mt-2.5 rounded bg-muted/40 p-2 font-mono text-[10px] text-foreground">
          <div className="flex items-center justify-between gap-2">
            <span><span className="text-muted-foreground">Entries:</span> {rec.entryCount ?? rec.entryIds?.length ?? 0}</span>
            <span><span className="text-muted-foreground">Lines:</span> {rec.lineCount ?? rec.statementLineIds?.length ?? 0}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-muted-foreground">Transition:</span>
            <span className="font-semibold">{rec.statusTransition?.from ?? rec.fromStatus ?? '—'}</span>
            <ArrowRight size={11} />
            <span className="font-semibold">{rec.statusTransition?.to ?? rec.toStatus ?? '—'}</span>
          </div>
          <div className="mt-1.5 truncate text-muted-foreground" title={rec.entryIds?.map((id) => `JE-${String(id).padStart(4, '0')}`).join(', ')}>
            {rec.entryIds?.map((id) => `JE-${String(id).padStart(4, '0')}`).join(' · ')}
          </div>
        </div>
      )}

      {isConfirmable && (
        <div className="mt-3 border-t border-border/60 pt-3">
          {confirmMutation.isSuccess ? (
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
              <Check size={13} /> {actionLabel === 'posting' ? 'Posting confirmed' : 'Applied successfully'}
            </div>
          ) : confirmMutation.isError ? (
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-destructive">
              <CircleAlert size={13} /> Failed to apply {actionLabel}
            </div>
          ) : (
            <button
              data-testid={rec.type === 'bulk_post_entries' ? `button-confirm-bulk-posting-${rec.id}` : `button-confirm-ai-proposal-${rec.id}`}
              onClick={handleConfirm}
              disabled={confirmMutation.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-sm disabled:opacity-50"
            >
              {confirmMutation.isPending && <Loader2 size={12} className="animate-spin" />}
              {confirmMutation.isPending ? 'Applying...' : rec.type === 'bulk_post_entries' ? 'Confirm posting' : 'Confirm proposal'}
            </button>
          )}
        </div>
      )}

      {isNavigable && (
        <div className="mt-3 border-t border-border/60 pt-3">
          <Link href="/statement-lines" onClick={onClose} className="flex w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-[11px] font-semibold text-foreground transition-all hover:bg-muted hover:shadow-sm">
            Review lines <ArrowRight size={12} />
          </Link>
        </div>
      )}
    </div>
  );
}

const STARTERS = [
  { label: 'Review exceptions', prompt: 'Review the current exceptions queue and highlight the most urgent issues.', icon: CircleAlert },
  { label: 'Summarize queue', prompt: 'Summarize the pending review queue.', icon: ListTodo },
  { label: 'Find transactions', prompt: 'Find recent transactions over $10,000.', icon: Search },
  { label: 'Explain balances', prompt: 'Explain the changes in operating expenses this period.', icon: TrendingUp },
  { label: 'Classify lines', prompt: 'Propose classifications for unmapped statement lines.', icon: Tag },
  { label: 'Import statement', action: 'import', icon: Paperclip },
];

function EmptyState({ onSelect, onImport }: { onSelect: (prompt: string) => void, onImport: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-6 animate-in fade-in zoom-in-95 duration-300">
      <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary shadow-sm">
        <Sparkles size={24} />
      </div>
      <div className="text-center">
        <h3 className="text-sm font-semibold">How can I help?</h3>
        <p className="text-[11px] text-muted-foreground mt-1 max-w-[200px] mx-auto">Select a starter or type a question below to begin.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 w-full max-w-[320px]">
        {STARTERS.map(s => (
          <button
            key={s.label}
            data-testid={s.action === 'import' ? 'button-starter-import-statement' : `button-starter-${s.label.replace(/\s+/g, '-').toLowerCase()}`}
            onClick={() => s.action === 'import' ? onImport() : onSelect(s.prompt!)}
            className="flex flex-col items-start gap-2 p-3 text-left border border-border rounded-xl bg-card hover:bg-muted hover:border-primary/40 transition-all group lift-hover shadow-sm"
          >
            <s.icon size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
            <span className="text-[11px] font-medium leading-tight">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ msg, activeClient, activeThreadId, onClose, onRetry }: { msg: RenderMessage, activeClient: Client, activeThreadId: number | null, onClose: () => void, onRetry: (prompt: string) => void }) {
  const isUser = msg.role === 'user';
  const content = msg.content;
  const response = msg.response;
  const queryClient = useQueryClient();

  const handleApplied = (rec: any) => {
    if (rec.type !== 'bulk_post_entries' || !activeThreadId) return;
    const movedLines = rec.lineCount ?? rec.statementLineIds?.length ?? 0;

    queryClient.setQueryData(getGetAgarAccountingAIConversationQueryKey(activeThreadId), (old: any) => {
      if (!old) return old;
      return {
        ...old,
        turns: old.turns.map((t: any) => {
          if (t.id.toString() === msg.id && t.response?.context) {
            return {
              ...t,
              response: {
                ...t.response,
                context: {
                  ...t.response.context,
                  pendingLines: Math.max(0, t.response.context.pendingLines - movedLines),
                  postedLines: t.response.context.postedLines + movedLines,
                }
              }
            };
          }
          return t;
        })
      };
    });
  };

  return (
    <div className={`flex min-w-0 w-full ${isUser ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 fade-in duration-300`}>
      {isUser ? (
        <div className="min-w-0 max-w-[85%] break-words rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-[13px] leading-relaxed text-primary-foreground shadow-sm [overflow-wrap:anywhere]">
          {content}
        </div>
      ) : (
        <div className={`min-w-0 max-w-[92%] break-words rounded-2xl rounded-bl-sm border px-4 py-3 text-[13px] leading-relaxed shadow-sm [overflow-wrap:anywhere] ${msg.type === 'import-result' ? 'border-primary/30 bg-primary/5' : 'border-card-border bg-card'}`}>
          {msg.type === 'error' && (
            <div className="space-y-3">
              <div className="text-destructive font-semibold flex items-center gap-2">
                <AlertCircle size={16} /> Request Failed
              </div>
              <div className="text-foreground break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{content}</div>
              {msg.errorPrompt && (
                <button
                  data-testid="button-retry-chat"
                  onClick={() => onRetry(msg.errorPrompt!)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 shadow-sm"
                >
                  <RotateCw size={14} /> Retry
                </button>
              )}
            </div>
          )}
          {msg.type === 'import-progress' && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{content}</span>
            </div>
          )}
          {msg.type === 'import-result' && (
            <div>
              <div className="break-words font-semibold text-primary [overflow-wrap:anywhere]">{content}</div>
              <div className="mt-1 text-muted-foreground text-[11px]">
                {msg.importData?.pendingConfirmation
                  ? `${msg.importData.importedCount ?? 0} proposed lines are saved but not loaded.${msg.importData.detectedCurrency ? ` Detected currency: ${msg.importData.detectedCurrency}.` : ''}`
                  : `${msg.importData?.importedCount ?? 0} lines extracted and queued.`}
              </div>
              {msg.importData?.bankAccountName && (
                <div className="mt-2 rounded bg-secondary/50 px-2 py-1.5 font-mono text-[10px] text-foreground border border-border/50">
                  Bank account: {msg.importData.bankAccountName}{msg.importData.accountNumberLast4 ? ` · •••• ${msg.importData.accountNumberLast4}` : ''}
                </div>
              )}
              <Link href={msg.importData?.pendingConfirmation ? '/import-statement' : '/statement-lines'} onClick={onClose} className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 shadow-sm">
                {msg.importData?.pendingConfirmation ? 'Confirm currency' : 'Review lines'} <ArrowRight size={14} />
              </Link>
            </div>
          )}
          {(!msg.type || msg.type === 'text') && (
            <div className="min-w-0 space-y-3">
              <div className="text-foreground break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{content}</div>

              {response?.recommendations && response.recommendations.length > 0 && (
                <div className="space-y-3 pt-1">
                  {response.recommendations.map((rec: any) => (
                    <RecommendationCard key={rec.id} rec={rec} activeClientId={activeClient.id} activeThreadId={activeThreadId} onClose={onClose} onApplied={() => handleApplied(rec)} />
                  ))}
                </div>
              )}

              {response?.results && response.results.length > 0 && (
                <div className="space-y-3 pt-1">
                  {response.results.map((res: any, idx: number) => (
                    <ResultCard key={idx} result={res} />
                  ))}
                </div>
              )}

              {response?.citations && response.citations.length > 0 && (
                <Citations citations={response.citations} />
              )}

              {response?.context && (
                <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
                  <div className="font-mono text-[10px] text-muted-foreground">
                    Pending: <span className="font-semibold text-foreground">{response.context.pendingLines}</span>
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    Posted: <span className="font-semibold text-foreground">{response.context.postedLines}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AssistantFAB() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);

  const { activeClient, clients } = useClientWorkspace();
  const pageContext = useAssistantPageContext();
  const queryClient = useQueryClient();
  const chatMutation = useAskAgarAccountingAI();
  const importMutation = useImportStatement();
  const { uploadFile, isUploading } = useUpload();

  const [assistantState, setAssistantState] = useState<AssistantState>(readAssistantState);
  const [input, setInput] = useState('');
  const [activeChatClientId, setActiveChatClientId] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const createMutation = useCreateAgarAccountingAIConversation();

  const activeClientKey = activeClient ? String(activeClient.id) : 'none';
  const pendingImport = activeClient ? assistantState.pendingImports[activeClientKey] : undefined;

  const [optimisticTurns, setOptimisticTurns] = useState<RenderMessage[]>([]);
  const [localImportMessages, setLocalImportMessages] = useState<Record<string, RenderMessage[]>>({});

  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [showOptions, setShowOptions] = useState(false);

  const conversationsQuery = useGetAgarAccountingAIConversations(
    { clientId: activeClient?.id ?? 0 },
    { query: { enabled: !!activeClient, queryKey: getGetAgarAccountingAIConversationsQueryKey({ clientId: activeClient?.id ?? 0 }) } }
  );

  const activeThread = useGetAgarAccountingAIConversation(
    activeThreadId ?? 0,
    { query: { enabled: !!activeThreadId, queryKey: getGetAgarAccountingAIConversationQueryKey(activeThreadId ?? 0) } }
  );

  const renameMutation = useRenameAgarAccountingAIConversation();
  const clearMutation = useClearAgarAccountingAIConversation();

  const importTrail = useGetStatementImports(
    { clientId: activeClient?.id ?? 0 },
    {
      query: {
        queryKey: getGetStatementImportsQueryKey({ clientId: activeClient?.id ?? 0 }),
        enabled: Boolean(activeClient && pendingImport),
        refetchInterval: pendingImport ? 2_500 : false,
      },
    },
  );

  const clearPendingImport = (clientId: number) => {
    setAssistantState((current) => {
      const pendingImports = { ...current.pendingImports };
      delete pendingImports[String(clientId)];
      return { ...current, pendingImports };
    });
  };

  useEffect(() => {
    window.localStorage.setItem(ASSISTANT_STATE_STORAGE_KEY, JSON.stringify(assistantState));
  }, [assistantState]);

  useEffect(() => {
    if (activeClient && activeThreadId && activeThread.data?.clientId !== activeClient.id && !activeThread.isFetching) {
      setActiveThreadId(null);
      setView('chat');
    }
  }, [activeClient?.id, activeThread.data?.clientId, activeThreadId, activeThread.isFetching]);

  useEffect(() => {
    if (isOpen && composerRef.current) {
      setTimeout(() => composerRef.current?.focus(), 0);
    }
  }, [isOpen, activeThreadId, view]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [optimisticTurns, localImportMessages, activeThread.data, isOpen, view, activeChatClientId, pendingImport]);

  useEffect(() => {
    if (!activeThread.isFetching && optimisticTurns.length > 0 && !chatMutation.isPending) {
      setOptimisticTurns([]);
    }
  }, [activeThread.isFetching, chatMutation.isPending]);

  useEffect(() => {
    if (!activeClient || !pendingImport) return;
    const matchingImport = importTrail.data?.find((item) => item.objectPath === pendingImport.objectPath);
    if (!matchingImport) return;

    const settledMessage: RenderMessage = matchingImport.outcome === 'failed'
      ? {
          id: pendingImport.progressMessageId,
          role: 'assistant',
          content: `Import failed: ${matchingImport.errorMessage ?? 'The statement could not be processed.'}`,
          createdAt: new Date().toISOString()
        }
      : matchingImport.outcome === 'pending_confirmation'
        ? {
            id: pendingImport.progressMessageId,
            role: 'assistant',
            type: 'import-result',
            content: 'Statement parsed — currency confirmation required.',
            importData: {
              importedCount: 0,
              pendingConfirmation: true,
              detectedCurrency: matchingImport.detectedCurrency,
            },
            createdAt: new Date().toISOString()
          }
        : {
          id: pendingImport.progressMessageId,
          role: 'assistant',
          type: 'import-result',
          content: matchingImport.outcome === 'duplicate'
            ? 'This statement was already imported.'
            : 'Import completed.',
          importData: { importedCount: matchingImport.importedLineCount },
          createdAt: new Date().toISOString()
        };

    setLocalImportMessages(prev => {
      const current = prev[activeClient.id] || [];
      if (current.some(m => m.id === pendingImport.progressMessageId)) {
        return { ...prev, [activeClient.id]: current.map(m => m.id === pendingImport.progressMessageId ? settledMessage : m) };
      }
      return { ...prev, [activeClient.id]: [...current, settledMessage] };
    });

    clearPendingImport(activeClient.id);
    if (matchingImport.outcome !== 'pending_confirmation') {
      queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey({ clientId: activeClient.id }) });
      queryClient.invalidateQueries({ queryKey: getGetLedgerOverviewQueryKey({ clientId: activeClient.id }) });
    }
  }, [activeClient?.id, importTrail.data, pendingImport]);

  const handleSend = (e?: React.FormEvent | string) => {
    if (typeof e === 'object' && e !== null && 'preventDefault' in e) e.preventDefault();
    const content = typeof e === 'string' ? e : input;
    if (!content.trim() || !activeClient) return;

    const client = activeClient;

    setOptimisticTurns(prev => [...prev, {
      id: Date.now().toString(),
      role: 'user',
      content: content.trim(),
      createdAt: new Date().toISOString()
    }]);

    if (typeof e !== 'string') setInput('');

    setActiveChatClientId(client.id);
    chatMutation.mutate({ data: {
      clientId: client.id,
      message: content.trim(),
      threadId: activeThreadId ?? undefined,
      pageContext: {
        route: pageContext.route,
        selectedLineIds: pageContext.selectedLineIds,
        visibleLineIds: pageContext.visibleLineIds,
        statementLineSearch: pageContext.statementLineSearch,
      },
    } }, {
      onSuccess: (res) => {
         const responseThreadId = activeThreadId ?? res.threadId;
         if (!activeThreadId) {
           setActiveThreadId(res.threadId);
           queryClient.invalidateQueries({ queryKey: getGetAgarAccountingAIConversationsQueryKey({ clientId: client.id }) });
         } else {
           queryClient.invalidateQueries({ queryKey: getGetAgarAccountingAIConversationQueryKey(activeThreadId) });
         }
         if (/\b(?:reset|clear)\s+(?:all\s+)?filters?\b|\bshow\s+all\b/i.test(content)) {
           queryClient.setQueryData(getGetAgarAccountingAIConversationQueryKey(responseThreadId), (current: unknown) => {
             if (typeof current !== 'object' || current === null) return current;
             return { ...current, scope: {} };
           });
         }
         setActiveChatClientId(null);
      },
      onError: (err) => {
         const durableThreadId = activeThreadId ?? getErrorThreadId(err);
         setOptimisticTurns([]);
         setActiveChatClientId(null);
         queryClient.invalidateQueries({ queryKey: getGetAgarAccountingAIConversationsQueryKey({ clientId: client.id }) });
         if (durableThreadId) {
           setActiveThreadId(durableThreadId);
           queryClient.invalidateQueries({ queryKey: getGetAgarAccountingAIConversationQueryKey(durableThreadId) });
           return;
         }
         setLocalImportMessages(prev => ({
           ...prev,
           [client.id]: [
             ...(prev[client.id] || []),
             {
               id: (Date.now() + 1).toString(),
               role: 'assistant',
               type: 'error',
               content: getErrorMessage(err),
               errorPrompt: content.trim(),
               createdAt: new Date().toISOString()
             }
           ]
         }));
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim()) {
        handleSend();
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeClient) return;
    const client = activeClient;
    if (fileInputRef.current) fileInputRef.current.value = '';

    const progressId = Date.now().toString();

    if (file.size > MAX_IMPORT_FILE_SIZE) {
      setLocalImportMessages(prev => ({
        ...prev,
        [client.id]: [
          ...(prev[client.id] || []),
          { id: Date.now().toString() + '-user', role: 'user', content: `Importing ${file.name}`, createdAt: new Date().toISOString() },
          { id: progressId, role: 'assistant', type: 'text', content: 'Statement file is too large. Choose a file no larger than 50 MB.', createdAt: new Date().toISOString() },
        ]
      }));
      return;
    }

    setLocalImportMessages(prev => ({
      ...prev,
      [client.id]: [
        ...(prev[client.id] || []),
        { id: Date.now().toString() + '-user', role: 'user', content: `Importing ${file.name}`, createdAt: new Date().toISOString() },
        { id: progressId, role: 'assistant', type: 'import-progress', content: 'Uploading the original file to private storage...', createdAt: new Date().toISOString() }
      ]
    }));

    try {
      const uploaded = await uploadFile(file, { clientId: client.id });
      if (!uploaded) throw new Error('The private statement upload did not complete. Please try again.');
      const pending: PendingImport = {
        clientId: client.id,
        fileName: file.name,
        objectPath: uploaded.objectPath,
        startedAt: Date.now(),
        progressMessageId: progressId,
      };
      setAssistantState((current) => ({
        ...current,
        pendingImports: { ...current.pendingImports, [String(client.id)]: pending },
      }));

      setLocalImportMessages(prev => ({
        ...prev,
        [client.id]: prev[client.id].map(m => m.id === progressId ? { ...m, content: 'Upload complete. Extracting data in the background...' } : m)
      }));

      const data = await importMutation.mutateAsync({
        data: {
          clientId: client.id,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          objectPath: uploaded.objectPath,
          confirmed: false,
        }
      });
      clearPendingImport(client.id);

      setLocalImportMessages(prev => ({
        ...prev,
        [client.id]: prev[client.id].map(m => m.id === progressId ? {
          ...m,
          type: 'import-result',
          content: data.importStatus === 'preview'
            ? 'Statement parsed — currency confirmation required.'
            : data.message ?? 'This statement was already imported.',
          importData: {
            importedCount: data.importStatus === 'preview' ? data.lines.length : data.importedCount,
            pendingConfirmation: data.importStatus === 'preview',
            detectedCurrency: data.detectedCurrency,
            bankAccountName: data.bankAccount?.name,
            accountNumberLast4: data.bankAccount?.accountNumberLast4,
          }
        } : m)
      }));
      queryClient.invalidateQueries({ queryKey: getGetStatementImportsQueryKey({ clientId: client.id }) });
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error
        ? Number((error as { status?: unknown }).status)
        : null;
      if (status !== null && status >= 400 && status < 500) {
        clearPendingImport(client.id);
        setLocalImportMessages(prev => ({
          ...prev,
          [client.id]: prev[client.id].map(m => m.id === progressId ? {
            ...m,
            type: 'text',
            content: `Import failed: ${getErrorMessage(error)}`
          } : m)
        }));
      } else {
        setLocalImportMessages(prev => ({
          ...prev,
          [client.id]: prev[client.id].map(m => m.id === progressId ? {
            ...m,
            type: 'import-progress',
            content: 'Connection interrupted. AgarAccounting AI will keep checking this client’s import trail.'
          } : m)
        }));
      }
    }
  };

  const isChatWorkingForActiveClient = chatMutation.isPending && activeChatClientId === activeClient?.id;
  const backgroundImportClients = Object.values(assistantState.pendingImports)
    .filter((pending) => pending.clientId !== activeClient?.id)
    .map((pending) => clients.find((client) => client.id === pending.clientId)?.name ?? 'another client');
  const backgroundWorkCount = backgroundImportClients.length + (chatMutation.isPending && activeChatClientId !== activeClient?.id ? 1 : 0);

  const serverTurns: RenderMessage[] = (activeThread.data?.turns ?? []).map(t => ({
    id: t.id.toString(),
    role: t.role,
    content: t.content,
    createdAt: t.createdAt,
    response: t.response as unknown as AIChatResponse | undefined,
  }));

  const displayTurns = [
    ...serverTurns,
    ...optimisticTurns,
    ...(localImportMessages[activeClient?.id ?? 0] ?? [])
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const activeScope = Object.entries(activeThread.data?.scope ?? {});

  const closeAssistant = () => {
    setShowOptions(false);
    setIsExpanded(false);
    setView('chat');
    setIsOpen(false);
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (showOptions) {
          setShowOptions(false);
          return;
        }
        closeAssistant();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, showOptions]);

  const containerClasses = isExpanded
    ? "fixed inset-0 z-[60] flex min-h-0 min-w-0 flex-col overflow-hidden border border-border bg-card shadow-2xl md:inset-6 md:flex-row md:rounded-xl"
    : "fixed bottom-0 left-0 right-0 top-0 z-[60] flex min-h-0 min-w-0 flex-col overflow-hidden border border-border bg-card shadow-2xl md:bottom-6 md:left-auto md:right-6 md:top-auto md:h-[min(600px,calc(100dvh-7.5rem))] md:w-[min(380px,calc(100vw-3rem))] md:rounded-xl";

  const showSidebar = isExpanded || view === 'history';
  const showChat = isExpanded || view === 'chat';

  if (!isOpen) {
    return (
      <button
        data-testid="button-open-assistant"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-transform hover:-translate-y-1 focus-ring"
        aria-label="Open AI Assistant"
      >
        <Sparkles size={24} />
        {backgroundWorkCount > 0 && (
          <span className="absolute top-0 right-0 size-3.5 rounded-full bg-destructive border-2 border-background" />
        )}
      </button>
    );
  }

  return createPortal(
    <>
      <div
        data-testid="assistant-backdrop"
        className={`fixed inset-0 z-[55] ${isExpanded ? 'bg-background/55 backdrop-blur-sm' : 'bg-background/70 backdrop-blur-sm md:bg-foreground/20 md:backdrop-blur-[1px]'}`}
        onClick={closeAssistant}
        aria-hidden="true"
      />
      <div
        className={containerClasses}
        role="dialog"
        aria-modal="true"
        aria-label="AI assistant"
        data-testid="assistant-panel"
      >

        {/* Sidebar */}
        <div className={`min-w-0 flex flex-col border-border bg-muted/10 ${isExpanded ? 'w-full shrink-0 md:w-[280px] border-r' : 'w-full flex-1'} ${!showSidebar ? 'hidden' : ''}`}>
          <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3 shrink-0 h-[57px]">
            <h3 className="text-[13px] font-semibold text-foreground">Conversations</h3>
            <div className="flex items-center gap-1">
              <button
                data-testid="button-new-conversation"
                aria-label="New chat"
                onClick={() => {
                  if (!activeClient) return;
                  createMutation.mutate({ data: { clientId: activeClient.id } }, {
                    onSuccess: (res) => {
                      setActiveThreadId(res.id);
                      queryClient.invalidateQueries({ queryKey: getGetAgarAccountingAIConversationsQueryKey({ clientId: activeClient.id }) });
                      setView('chat');
                      setTimeout(() => composerRef.current?.focus(), 0);
                    }
                  });
                }}
                className="grid size-7 place-items-center text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors"
                title="New chat"
              >
                <Plus size={16} />
              </button>
              {!isExpanded && (
                <button data-testid="button-close-assistant-history" aria-label="Close" onClick={closeAssistant} className="relative z-20 grid size-7 place-items-center text-muted-foreground hover:bg-muted rounded-md" title="Close">
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-2 px-2 space-y-1">
            {conversationsQuery.data?.map(thread => (
              <div data-testid={`row-thread-${thread.id}`} key={thread.id} className={`group flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-colors ${activeThreadId === thread.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-foreground'}`} onClick={() => { setActiveThreadId(thread.id); setView('chat'); }}>
                {renamingId === thread.id ? (
                   <form onSubmit={(e) => {
                     e.preventDefault();
                     renameMutation.mutate({ id: thread.id, data: { clientId: activeClient!.id, title: renameTitle } }, {
                       onSuccess: () => {
                         queryClient.invalidateQueries({ queryKey: getGetAgarAccountingAIConversationsQueryKey({ clientId: activeClient!.id }) });
                         queryClient.invalidateQueries({ queryKey: getGetAgarAccountingAIConversationQueryKey(thread.id) });
                       }
                     });
                     setRenamingId(null);
                   }} className="flex-1 flex">
                     <input autoFocus value={renameTitle} onChange={e => setRenameTitle(e.target.value)} onBlur={() => setRenamingId(null)} className="flex-1 text-[12px] bg-background border border-primary/50 rounded px-2 py-0.5 outline-none" onClick={e => e.stopPropagation()} />
                   </form>
                ) : (
                   <div className="truncate text-[12px] font-medium flex-1 mr-2">{thread.title || 'New Conversation'}</div>
                )}

                {renamingId !== thread.id && (
                   <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                     <button
                       data-testid={`button-rename-thread-${thread.id}`}
                       aria-label="Rename chat"
                       onClick={(e) => { e.stopPropagation(); setRenamingId(thread.id); setRenameTitle(thread.title || ''); }}
                       className="p-1 hover:bg-background rounded text-muted-foreground"
                     >
                       <Edit2 size={12} />
                     </button>
                     <button
                       data-testid={`button-clear-thread-${thread.id}`}
                       aria-label="Clear chat"
                       onClick={(e) => {
                         e.stopPropagation();
                         if (confirm('Delete this conversation?')) {
                           clearMutation.mutate({ id: thread.id }, {
                             onSuccess: () => {
                               queryClient.invalidateQueries({ queryKey: getGetAgarAccountingAIConversationsQueryKey({ clientId: activeClient!.id }) });
                               queryClient.invalidateQueries({ queryKey: getGetAgarAccountingAIConversationQueryKey(thread.id) });
                             }
                           });
                         }
                       }}
                       className="p-1 hover:bg-background rounded text-destructive"
                     >
                       <Trash2 size={12} />
                     </button>
                   </div>
                )}
              </div>
            ))}
            {(!conversationsQuery.data || conversationsQuery.data.length === 0) && (
               <div className="p-6 text-center text-[11px] text-muted-foreground">No recent conversations.</div>
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div className={`min-w-0 min-h-0 flex flex-col bg-card ${isExpanded ? 'flex-1' : 'w-full flex-1'} ${!showChat ? 'hidden' : ''}`}>

          {/* Header */}
          <div className="relative z-20 flex h-[57px] shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-border bg-card px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
              {!isExpanded && (
                <button aria-label="View history" onClick={() => setView('history')} className="shrink-0 p-1 text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors -ml-1" title="View history">
                  <Menu size={16} />
                </button>
              )}
              <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Sparkles size={14} />
              </div>
              <div className="min-w-0 flex-1 overflow-hidden">
                <h3 className="truncate text-[13px] font-semibold leading-none text-foreground">
                  {activeThreadId ? activeThread.data?.title || 'Conversation' : 'New Conversation'}
                </h3>
                <p className="mt-1 truncate font-mono text-[9px] uppercase tracking-[.15em] text-muted-foreground">
                  {activeClient ? activeClient.name : 'Select a workspace'}
                </p>
              </div>
            </div>

            <div className="relative z-20 flex shrink-0 items-center gap-1">
              {activeThreadId && (
                 <div className="relative">
                   <button aria-label="Options" onClick={() => setShowOptions(!showOptions)} className="grid size-7 place-items-center text-muted-foreground hover:bg-muted rounded-md transition-colors" title="Options">
                     <MoreVertical size={15} />
                   </button>
                   {showOptions && (
                     <>
                       <button
                         type="button"
                         aria-label="Dismiss options"
                         className="fixed inset-0 z-[60]"
                         onClick={() => setShowOptions(false)}
                       />
                       <div className="absolute right-0 top-9 z-[70] min-w-[140px] rounded-xl border border-popover-border bg-popover p-1 shadow-md animate-in fade-in zoom-in-95 duration-100">
                          <button
                            data-testid={`button-rename-thread-${activeThreadId}`}
                            onClick={() => {
                              setShowOptions(false);
                              setRenamingId(activeThreadId);
                              setRenameTitle(activeThread.data?.title || '');
                              setView('history');
                            }}
                            className="w-full flex items-center gap-2 text-left px-3 py-2 text-[12px] hover:bg-muted rounded-lg text-foreground font-medium"
                          >
                            <Edit2 size={13}/> Rename
                          </button>
                          <button
                            data-testid={`button-clear-thread-${activeThreadId}`}
                            onClick={() => {
                              setShowOptions(false);
                              if (confirm('Clear this conversation?')) {
                                clearMutation.mutate({ id: activeThreadId }, {
                                  onSuccess: () => {
                                    queryClient.invalidateQueries({ queryKey: getGetAgarAccountingAIConversationsQueryKey({ clientId: activeClient!.id }) });
                                    queryClient.invalidateQueries({ queryKey: getGetAgarAccountingAIConversationQueryKey(activeThreadId) });
                                  }
                                });
                              }
                            }}
                            className="w-full flex items-center gap-2 text-left px-3 py-2 text-[12px] hover:bg-destructive/10 text-destructive rounded-lg font-medium mt-1"
                          >
                            <Trash2 size={13}/> Clear chat
                          </button>
                       </div>
                     </>
                   )}
                 </div>
              )}
              <button data-testid="button-expand-assistant" aria-label={isExpanded ? "Collapse" : "Expand"} onClick={() => setIsExpanded(!isExpanded)} className="relative z-[80] hidden md:grid size-7 place-items-center text-muted-foreground hover:bg-muted rounded-md transition-colors" title={isExpanded ? "Collapse" : "Expand"}>
                {isExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
              <button data-testid="button-close-assistant" aria-label="Close" onClick={closeAssistant} className="relative z-[80] grid size-7 place-items-center text-muted-foreground hover:bg-muted rounded-md transition-colors" title="Close">
                <X size={16} />
              </button>
            </div>
          </div>

          {activeScope.length > 0 && (
            <div data-testid="assistant-active-filters" className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-primary/5 px-4 py-2">
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-primary">Active filters</span>
              {activeScope.map(([key, value]) => (
                <span key={key} title={`${key}: ${resultValue(value)}`} className="max-w-[160px] shrink-0 truncate rounded-full border border-primary/20 bg-background px-2 py-0.5 text-[10px] text-foreground">
                  {key}: {resultValue(value)}
                </span>
              ))}
              <button
                type="button"
                data-testid="button-reset-ai-filters"
                onClick={() => handleSend('Reset filters and show all transactions.')}
                disabled={chatMutation.isPending}
                className="ml-auto shrink-0 text-[10px] font-semibold text-primary underline-offset-2 hover:underline disabled:opacity-50"
              >
                Show all
              </button>
            </div>
          )}

          {/* Messages */}
          <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-muted/20 p-4 space-y-5" aria-live="polite">
            {backgroundWorkCount > 0 && (
              <div className="mx-auto max-w-fit rounded-full bg-primary/10 border border-primary/20 px-3 py-1 text-[10px] font-medium text-primary flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" />
                Working in {backgroundImportClients[0] ?? 'another client'}{backgroundWorkCount > 1 ? ` and ${backgroundWorkCount - 1} more` : ''}
              </div>
            )}

            {!activeClient ? (
              <div className="flex-1 h-full flex flex-col items-center justify-center p-6 text-center animate-in fade-in zoom-in duration-300">
                <div className="grid size-14 place-items-center rounded-3xl bg-muted border border-border text-muted-foreground mb-4 shadow-sm">
                  <Landmark size={24} />
                </div>
                <h3 className="text-sm font-semibold">No Workspace Selected</h3>
                <p className="text-[11px] text-muted-foreground mt-2 max-w-[200px] mx-auto leading-relaxed">Select a workspace from the dashboard to use the AI assistant.</p>
              </div>
            ) : (!activeThreadId && displayTurns.length === 0) ? (
              <EmptyState
                onSelect={(prompt) => {
                  setInput(prompt);
                  setTimeout(() => composerRef.current?.focus(), 0);
                }}
                onImport={() => fileInputRef.current?.click()}
              />
            ) : (
              displayTurns.map(msg => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  activeClient={activeClient}
                  activeThreadId={activeThreadId}
                  onClose={() => !isExpanded && setIsOpen(false)}
                  onRetry={(prompt) => handleSend(prompt)}
                />
              ))
            )}

            {isChatWorkingForActiveClient && (
              <div className="flex w-full justify-start animate-in fade-in duration-300">
                <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-card-border bg-card px-4 py-4 text-[13px] shadow-sm">
                  <div className="flex gap-1.5 items-center h-2">
                    <span className="size-1.5 animate-pulse rounded-full bg-primary/60"></span>
                    <span className="size-1.5 animate-pulse rounded-full bg-primary/60 stagger-1"></span>
                    <span className="size-1.5 animate-pulse rounded-full bg-primary/60 stagger-2"></span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="min-w-0 shrink-0 overflow-hidden border-t border-border bg-card p-3">
            <form onSubmit={handleSend} className="flex min-w-0 items-end gap-2 rounded-xl border border-input bg-background p-1.5 shadow-sm transition-all focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20">
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".pdf,.csv,.xls,.xlsx,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileChange}
              />
              <button
                data-testid="button-ai-import-statement"
                aria-label="Import statement"
                type="button"
                title="Import statement"
                onClick={() => fileInputRef.current?.click()}
                disabled={!activeClient || importMutation.isPending || isUploading || Boolean(pendingImport)}
                className="mb-0.5 grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <Paperclip size={17} />
              </button>
              <textarea
                ref={composerRef}
                data-testid="input-ai-message"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                }}
                onKeyDown={handleKeyDown}
                placeholder={activeClient ? "Ask or instruct..." : "Select a workspace"}
                disabled={!activeClient || chatMutation.isPending}
                className="max-h-[120px] min-h-[20px] min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
                rows={1}
              />
              <button
                data-testid="button-send-ai-message"
                aria-label="Send message"
                type="submit"
                disabled={!input.trim() || !activeClient || chatMutation.isPending}
                className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50 transition-transform hover:scale-105 active:scale-95 mb-0.5 shadow-sm"
              >
                <Send size={15} className="mr-0.5" />
              </button>
            </form>
          </div>

        </div>
      </div>
    </>,
    document.body,
  );
}
