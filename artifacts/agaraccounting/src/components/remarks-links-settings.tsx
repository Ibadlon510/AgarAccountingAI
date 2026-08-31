import { useState } from 'react';
import { Copy, Link2, Plus } from 'lucide-react';
import {
  getGetStatementLineDetailRequestsQueryKey,
  getGetStatementLinesQueryKey,
  useGetStatementLineDetailRequests,
  useRevokeStatementLineDetailRequest,
  type StatementLineDetailRequest,
} from '@workspace/api-client-react';
import { SendForRemarksDialog } from '@/components/send-for-remarks-dialog';
import { notify, readErrorMessage } from '@/lib/notify';
import { useQueryClient } from '@tanstack/react-query';

const shortDateTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

function statusTone(status: StatementLineDetailRequest['status']) {
  return status === 'active'
    ? 'bg-primary/10 text-primary'
    : 'bg-muted text-muted-foreground';
}

export function RemarksLinksSettings({ clientId, clientName }: { clientId: number; clientName: string }) {
  const queryClient = useQueryClient();
  const list = useGetStatementLineDetailRequests(clientId);
  const revoke = useRevokeStatementLineDetailRequest();
  const [createOpen, setCreateOpen] = useState(false);

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      notify.success('Remarks link copied');
    } catch {
      notify.error('The remarks link could not be copied.');
    }
  };

  const deactivate = (request: StatementLineDetailRequest) => {
    revoke.mutate({ id: request.id, data: { clientId } }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetStatementLineDetailRequestsQueryKey(clientId) });
        void queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey() });
        notify.success('Remarks link deactivated');
      },
      onError: (error) => {
        notify.error(error, {
          title: 'Could not deactivate remarks link',
          fallback: readErrorMessage(error, 'The remarks link could not be deactivated.'),
        });
      },
    });
  };

  return (
    <section id="remarks-links" className="scroll-mt-24 rounded-lg border border-card-border bg-card p-5 md:p-6" data-testid="card-settings-remarks-links">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Link2 size={18} /></div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Client remarks</div>
            <h2 className="mt-2 text-base font-semibold">Remarks links</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              Create a public 3-day link for draft statement lines. Active links accept remarks until they expire or you deactivate them. Posted lines stay on the link as posted and cannot receive new remarks.
            </p>
          </div>
        </div>
        <button
          type="button"
          data-testid="button-create-remarks-link"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
        >
          <Plus size={13} /> Create remarks link
        </button>
      </div>
      <div className="mt-5 overflow-hidden rounded-lg border border-border">
        {list.isLoading && <p className="p-4 text-xs text-muted-foreground">Loading remarks links…</p>}
        {list.isError && <p className="p-4 text-xs text-destructive">Remarks links could not be loaded.</p>}
        {!list.isLoading && !list.isError && (list.data?.length ?? 0) === 0 && (
          <p data-testid="state-remarks-links-empty" className="p-4 text-xs text-muted-foreground">No remarks links yet. Create one to email a 3-day public page for selected draft lines.</p>
        )}
        {list.data?.map((request) => (
          <article key={request.id} data-testid={`row-remarks-link-${request.id}`} className="border-b border-border p-4 last:border-b-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold">{request.recipientEmail}</span>
                  <span data-testid={`status-remarks-link-${request.id}`} className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[.08em] ${statusTone(request.status)}`}>
                    {request.status === 'inactive' && request.revokedAt ? 'inactive · deactivated' : request.status === 'inactive' ? 'inactive · expired' : request.status}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  Sent {shortDateTime(request.sentAt)} · expires {shortDateTime(request.expiresAt)} · {request.lineCount} line{request.lineCount === 1 ? '' : 's'} · {request.postedLineCount} posted · {request.remarkCount} remark{request.remarkCount === 1 ? '' : 's'}
                </p>
                {request.senderMessage && <p className="mt-2 text-[11px] text-muted-foreground">{request.senderMessage}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {request.status === 'active' && (
                  <button
                    type="button"
                    data-testid={`button-copy-remarks-link-${request.id}`}
                    onClick={() => { void copyLink(request.publicUrl); }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold"
                  >
                    <Copy size={12} /> Copy link
                  </button>
                )}
                {request.status === 'active' && (
                  <button
                    type="button"
                    data-testid={`button-deactivate-remarks-link-${request.id}`}
                    disabled={revoke.isPending}
                    onClick={() => deactivate(request)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-destructive disabled:opacity-50"
                  >
                    Deactivate
                  </button>
                )}
              </div>
            </div>
            {request.lines.length > 0 && (
              <ul className="mt-3 space-y-1 rounded-md border border-border bg-muted/30 p-2">
                {request.lines.map((line) => (
                  <li key={line.id} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="min-w-0 truncate">{line.description}</span>
                    <span className="shrink-0 font-mono uppercase text-muted-foreground">
                      {line.status}{line.remarkCount ? ` · ${line.remarkCount} remark${line.remarkCount === 1 ? '' : 's'}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
      {createOpen && (
        <SendForRemarksDialog
          clientId={clientId}
          clientName={clientName}
          lines={[]}
          allowLinePicker
          onClose={() => setCreateOpen(false)}
          onSent={() => setCreateOpen(false)}
        />
      )}
    </section>
  );
}
