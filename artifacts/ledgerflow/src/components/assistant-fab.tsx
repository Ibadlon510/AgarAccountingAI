import { useState, useRef, useEffect } from 'react';
import { Sparkles, X, Paperclip, Send, Loader2, ArrowRight, Check, CircleAlert } from 'lucide-react';
import { useClientWorkspace } from '../App';
import { 
  useAskLedgerflowAI, 
  useImportStatement, 
  useConfirmAICopilotAction,
  getGetStatementLinesQueryKey, 
  getGetLedgerOverviewQueryKey,
  getGetJournalEntriesQueryKey,
  getGetBankAccountsQueryKey,
  getGetTrialBalanceQueryKey,
  getGetFinancialStatementsQueryKey
} from '@workspace/api-client-react';
import type { AIChatResponse, AICopilotRecommendation } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  type: 'text' | 'import-progress' | 'import-result' | 'recommendations';
  content: string;
  context?: AIChatResponse['context'];
  recommendations?: AICopilotRecommendation[];
  importData?: {
    importedCount?: number;
    error?: string;
    bankAccountName?: string;
    accountNumberLast4?: string | null;
  };
};

const MAX_IMPORT_FILE_SIZE = 15 * 1024 * 1024;

function RecommendationCard({ rec, activeClientId, onClose, onApplied }: { rec: AICopilotRecommendation; activeClientId: number; onClose: () => void; onApplied?: () => void }) {
  const confirmMutation = useConfirmAICopilotAction();
  const queryClient = useQueryClient();

  const isBulkAction = rec.type === 'bulk_approve_entries' || rec.type === 'bulk_post_entries';
  const isConfirmable = rec.requiresConfirmation && (rec.type === 'recode_lines' || rec.type === 'create_bank_account' || isBulkAction);
  const isNavigable = rec.type === 'next_step' || rec.type === 'review_group';
  const actionLabel = rec.type === 'bulk_approve_entries' ? 'approval' : rec.type === 'bulk_post_entries' ? 'posting' : 'proposal';
  
  const handleConfirm = () => {
    confirmMutation.mutate({
      data: {
        clientId: rec.clientId,
        type: rec.type as 'recode_lines' | 'create_bank_account' | 'bulk_approve_entries' | 'bulk_post_entries',
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
        queryClient.invalidateQueries({ queryKey: getGetLedgerOverviewQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetJournalEntriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTrialBalanceQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetFinancialStatementsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBankAccountsQueryKey({ clientId: activeClientId }) });
        onApplied?.();
      }
    });
  };

  return (
    <div className="mt-3 rounded-md border border-border bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-[12px]">{rec.title}</div>
        {rec.confidence != null && (
          <div className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {Math.round(rec.confidence * 100)}% conf
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed">{rec.summary}</p>
      
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
        <div className="mt-3 border-t border-border pt-3">
          {confirmMutation.isSuccess ? (
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
              <Check size={13} /> {actionLabel === 'approval' ? 'Approval confirmed' : actionLabel === 'posting' ? 'Posting confirmed' : 'Applied successfully'}
            </div>
          ) : confirmMutation.isError ? (
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-destructive">
              <CircleAlert size={13} /> Failed to apply {actionLabel}
            </div>
          ) : (
            <button
              data-testid={rec.type === 'bulk_approve_entries' ? `button-confirm-bulk-approval-${rec.id}` : rec.type === 'bulk_post_entries' ? `button-confirm-bulk-posting-${rec.id}` : `button-confirm-ai-proposal-${rec.id}`}
              onClick={handleConfirm}
              disabled={confirmMutation.isPending}
              className="flex w-full items-center justify-center gap-2 rounded bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {confirmMutation.isPending && <Loader2 size={12} className="animate-spin" />}
              {confirmMutation.isPending ? 'Applying...' : rec.type === 'bulk_approve_entries' ? 'Confirm approval' : rec.type === 'bulk_post_entries' ? 'Confirm posting' : 'Confirm proposal'}
            </button>
          )}
        </div>
      )}
      
      {isNavigable && (
        <div className="mt-3 border-t border-border pt-3">
          <Link href="/statement-lines" onClick={onClose} className="flex w-full items-center justify-center gap-2 rounded border border-input bg-background px-3 py-1.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted hover:text-foreground">
            Review lines <ArrowRight size={12} />
          </Link>
        </div>
      )}
    </div>
  );
}

export function AssistantFAB() {
  const [isOpen, setIsOpen] = useState(false);
  const { activeClient } = useClientWorkspace();
  const queryClient = useQueryClient();
  const chatMutation = useAskLedgerflowAI();
  const importMutation = useImportStatement();
  
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'assistant', type: 'text', content: 'Hello. I can answer questions about this workspace or extract transactions from a bank statement.' }
  ]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen, chatMutation.isPending]);

  useEffect(() => {
    setMessages([{
      id: `workspace-${activeClient?.id ?? 'none'}`,
      role: 'assistant',
      type: 'text',
      content: activeClient
        ? `You are working in ${activeClient.name}. Ask about its review queue, posted entries, or upload a statement.`
        : 'Select a workspace to ask questions or import a statement.',
    }]);
    setInput('');
  }, [activeClient?.id]);

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || !activeClient) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', type: 'text', content: input.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');

    chatMutation.mutate({ data: { clientId: activeClient.id, message: userMsg.content } }, {
      onSuccess: (res) => {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          type: res.recommendations && res.recommendations.length > 0 ? 'recommendations' : 'text',
          content: res.answer,
          context: res.context,
          recommendations: res.recommendations
        }]);
      },
      onError: () => {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          type: 'text',
          content: 'I encountered an error processing your request.'
        }]);
      }
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeClient) return;
    
    if (fileInputRef.current) fileInputRef.current.value = '';

    const progressId = Date.now().toString();

    if (file.size > MAX_IMPORT_FILE_SIZE) {
      setMessages(prev => [...prev,
        { id: Date.now().toString() + '-user', role: 'user', type: 'text', content: `Importing ${file.name}` },
        { id: progressId, role: 'assistant', type: 'text', content: 'Statement file is too large. Please choose a file smaller than 15 MB.' },
      ]);
      return;
    }
    
    setMessages(prev => [
      ...prev,
      { id: Date.now().toString() + '-user', role: 'user', type: 'text', content: `Importing ${file.name}` },
      { id: progressId, role: 'assistant', type: 'import-progress', content: 'Extracting data...' }
    ]);

    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });

      importMutation.mutate({
        data: {
          clientId: activeClient.id,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          contentBase64,
          currency: activeClient.functionalCurrency || 'AED'
        }
      }, {
        onSuccess: (data) => {
          setMessages(prev => prev.map(m => m.id === progressId ? {
            ...m,
            type: 'import-result',
            content: `Import completed.`,
            importData: {
              importedCount: data.importedCount,
              bankAccountName: data.bankAccount?.name,
              accountNumberLast4: data.bankAccount?.accountNumberLast4,
            }
          } : m));
          
          queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey({ clientId: activeClient.id }) });
          queryClient.invalidateQueries({ queryKey: getGetLedgerOverviewQueryKey({ clientId: activeClient.id }) });
        },
        onError: (err) => {
          setMessages(prev => prev.map(m => m.id === progressId ? {
            ...m,
            type: 'text',
            content: `Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`
          } : m));
        }
      });
    } catch (error) {
      setMessages(prev => prev.map(m => m.id === progressId ? {
        ...m,
        type: 'text',
        content: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`
      } : m));
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {isOpen && (
        <div className="mb-4 flex h-[550px] max-h-[calc(100dvh-120px)] w-[380px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl transition-all page-enter">
          <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                <Sparkles size={16} />
              </div>
              <div>
                <h3 className="text-[13px] font-semibold leading-none text-foreground">LedgerFlow AI</h3>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-[.15em] text-muted-foreground">
                  {activeClient ? activeClient.name : 'Select a workspace'}
                </p>
              </div>
            </div>
            <button 
              onClick={() => setIsOpen(false)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X size={16} />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto bg-muted/20 p-4 space-y-4">
            {messages.map(msg => (
              <div key={msg.id} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'user' ? (
                  <div className="max-w-[85%] rounded-lg bg-primary px-3.5 py-2.5 text-[13px] leading-relaxed text-primary-foreground shadow-sm">
                    {msg.content}
                  </div>
                ) : (
                  <div className={`max-w-[85%] rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm ${msg.type === 'import-result' ? 'border-primary/30 bg-primary/5' : 'border-card-border bg-card'}`}>
                    {msg.type === 'import-progress' ? (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 size={14} className="animate-spin" />
                        <span>{msg.content}</span>
                      </div>
                    ) : msg.type === 'import-result' ? (
                      <div>
                        <div className="font-semibold text-primary">{msg.content}</div>
                        <div className="mt-1 text-muted-foreground">{msg.importData?.importedCount ?? 0} lines extracted and queued.</div>
                        {msg.importData?.bankAccountName && <div className="mt-2 rounded bg-secondary/50 px-2 py-1.5 font-mono text-[10px] text-foreground">Bank account: {msg.importData.bankAccountName}{msg.importData.accountNumberLast4 ? ` · •••• ${msg.importData.accountNumberLast4}` : ''}</div>}
                        <Link href="/statement-lines" onClick={() => setIsOpen(false)} className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5">
                          Review lines <ArrowRight size={14} />
                        </Link>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="text-foreground">{msg.content}</div>
                        
                        {msg.type === 'recommendations' && msg.recommendations && activeClient && (
                          <div className="space-y-3 pt-1">
                            {msg.recommendations.map(rec => (
                              <RecommendationCard 
                                key={rec.id} 
                                rec={rec} 
                                activeClientId={activeClient.id} 
                                onClose={() => setIsOpen(false)} 
                                onApplied={() => {
                                  if (rec.type !== 'bulk_post_entries' || !msg.context) return;
                                  const movedLines = rec.lineCount ?? rec.statementLineIds?.length ?? 0;
                                  setMessages((current) => current.map((item) => item.id === msg.id && item.context
                                    ? {
                                      ...item,
                                      context: {
                                        ...item.context,
                                        pendingLines: Math.max(0, item.context.pendingLines - movedLines),
                                        postedLines: item.context.postedLines + movedLines,
                                      },
                                    }
                                    : item));
                                }}
                              />
                            ))}
                          </div>
                        )}
                        
                        {msg.context && (
                          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
                            <div className="font-mono text-[10px] text-muted-foreground">
                              Pending: <span className="font-semibold text-foreground">{msg.context.pendingLines}</span>
                            </div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              Posted: <span className="font-semibold text-foreground">{msg.context.postedLines}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {chatMutation.isPending && (
              <div className="flex w-full justify-start">
                <div className="max-w-[85%] rounded-lg border border-card-border bg-card px-4 py-3.5 text-[13px] shadow-sm">
                  <div className="flex gap-1.5">
                    <span className="size-1.5 animate-pulse rounded-full bg-primary/60"></span>
                    <span className="size-1.5 animate-pulse rounded-full bg-primary/60 stagger-1"></span>
                    <span className="size-1.5 animate-pulse rounded-full bg-primary/60 stagger-2"></span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-border bg-card p-3">
            <form onSubmit={handleSend} className="flex items-center gap-2">
              <input 
                type="file" 
                ref={fileInputRef}
                className="hidden" 
                accept=".pdf,.csv,.xls,.xlsx,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileChange}
              />
              <button
                data-testid="button-ai-import-statement"
                type="button"
                title="Import statement"
                onClick={() => fileInputRef.current?.click()}
                disabled={!activeClient || importMutation.isPending}
                className="grid size-9 shrink-0 place-items-center rounded-md border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
              >
                <Paperclip size={17} />
              </button>
              <input
                data-testid="input-ai-message"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={activeClient ? "Ask or instruct..." : "Select a workspace"}
                disabled={!activeClient || chatMutation.isPending}
                className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-[13px] outline-none transition-colors focus:border-primary disabled:opacity-50"
              />
              <button
                data-testid="button-send-ai-message"
                type="submit"
                disabled={!input.trim() || !activeClient || chatMutation.isPending}
                className="grid size-9 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
              >
                <Send size={15} className="ml-0.5" />
              </button>
            </form>
          </div>
        </div>
      )}
      
      <button
        data-testid="button-toggle-ai-assistant"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex size-[52px] items-center justify-center rounded-full shadow-lg transition-transform hover:-translate-y-0.5 ${isOpen ? 'bg-secondary text-foreground hover:bg-secondary/80' : 'bg-primary text-primary-foreground'}`}
      >
        {isOpen ? <X size={22} /> : <Sparkles size={22} />}
      </button>
    </div>
  );
}
