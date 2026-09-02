import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import { LoaderCircle, Mail } from 'lucide-react';
import {
  getGetStatementLinesQueryKey,
  useGetStatementLines,
  useGetWorkspaceMembers,
  useRequestStatementLineDetails,
  type StatementLine,
} from '@workspace/api-client-react';
import { getGetStatementLineDetailRequestsQueryKey } from '@workspace/api-client-react/statement-line-remarks';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { notify, readErrorMessage } from '@/lib/notify';

const money = (value: number, currency = 'AED') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);

const shortDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_REMARK_LINES = 50;

export function SendForRemarksDialog({
  clientId,
  clientName,
  lines,
  allowLinePicker = false,
  onClose,
  onSent,
}: {
  clientId: number;
  clientName: string;
  lines: StatementLine[];
  allowLinePicker?: boolean;
  onClose: () => void;
  onSent: (result?: { publicUrl?: string; recipientEmail: string; expiresAt: string }) => void;
}) {
  const { user } = useUser();
  const team = useGetWorkspaceMembers();
  const queryClient = useQueryClient();
  const send = useRequestStatementLineDetails();
  const pickerQuery = useGetStatementLines({ clientId, status: 'draft', limit: 50, sort: 'date', sortDirection: 'desc' }, {
    query: {
      queryKey: getGetStatementLinesQueryKey({ clientId, status: 'draft', limit: 50, sort: 'date', sortDirection: 'desc' }),
      enabled: allowLinePicker && lines.length === 0 && clientId > 0,
    },
  });
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [pickedIds, setPickedIds] = useState<number[]>([]);
  const memberEmails = useMemo(() => {
    const members = team.data?.members ?? [];
    return [...new Set(members.map((member) => member.email).filter(Boolean))].sort();
  }, [team.data?.members]);
  const pickerLines = useMemo(
    () => (pickerQuery.data ?? []).filter((line) => line.status === 'draft'),
    [pickerQuery.data],
  );
  const selectedLines = lines.length ? lines : pickerLines.filter((line) => pickedIds.includes(line.id));
  const invalidEmail = email.trim().length > 0 && !EMAIL_PATTERN.test(email.trim());
  const overCap = selectedLines.length > MAX_REMARK_LINES;
  const subject = `Please add remarks for ${clientName} — ${selectedLines.length} transaction${selectedLines.length === 1 ? '' : 's'}`;
  const senderName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || 'AgarAccounting AI';
  const canSend = EMAIL_PATTERN.test(email.trim()) && selectedLines.length > 0 && !overCap && !send.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    send.mutate({
      data: {
        clientId,
        statementLineIds: selectedLines.map((line) => line.id),
        recipientEmail: email.trim(),
        senderMessage: message.trim() || null,
      },
    }, {
      onSuccess: (result) => {
        const expires = new Date(result.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        notify.success('Remarks link sent', {
          description: `Sent to ${result.recipientEmail}. Active for 3 days, until ${expires}.`,
        });
        void queryClient.invalidateQueries({ queryKey: getGetStatementLineDetailRequestsQueryKey(clientId) });
        void queryClient.invalidateQueries({ queryKey: getGetStatementLinesQueryKey() });
        onSent({ publicUrl: result.publicUrl, recipientEmail: result.recipientEmail, expiresAt: result.expiresAt });
      },
      onError: (error) => {
        notify.error(error, {
          title: 'Could not send remarks link',
          fallback: readErrorMessage(error, 'The remarks email was not sent.'),
        });
      },
    });
  };

  const togglePicked = (id: number) => {
    setPickedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= MAX_REMARK_LINES) return current;
      return [...current, id];
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !send.isPending) onClose(); }}>
      <DialogContent className="!flex !flex-col w-[calc(100%-2rem)] max-w-5xl max-h-[90vh] gap-5 overflow-x-hidden overflow-y-auto p-5 sm:p-6" data-testid="dialog-send-for-remarks">
        <DialogHeader>
          <DialogTitle>Send for remarks</DialogTitle>
          <DialogDescription>
            Email a public link that stays active for 3 days. The recipient does not need an account.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)] lg:items-start">
        <form onSubmit={submit} className="min-w-0 rounded-lg border border-border bg-card p-4 space-y-4">
          <label className="block text-xs font-semibold">
            Recipient email
            <input
              data-testid="input-remarks-recipient"
              type="email"
              list="remarks-recipient-emails"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="owner@company.com"
              autoComplete="email"
              className="mt-1.5 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
            <datalist id="remarks-recipient-emails">
              {memberEmails.map((memberEmail) => <option key={memberEmail} value={memberEmail} />)}
            </datalist>
          </label>
          {invalidEmail && <p className="text-[11px] text-destructive">Enter a valid email address.</p>}
          <label className="block text-xs font-semibold">
            Message <span className="font-normal text-muted-foreground">(optional)</span>
            <textarea
              data-testid="input-remarks-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Please confirm what these payments were for."
              className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          {allowLinePicker && lines.length === 0 && pickerLines.length > 0 && (
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>{pickedIds.length} of {MAX_REMARK_LINES} lines selected</span>
              <button
                type="button"
                data-testid="button-remarks-select-all"
                onClick={() => setPickedIds(pickerLines.slice(0, MAX_REMARK_LINES).map((line) => line.id))}
                className="font-semibold text-primary hover:underline"
              >
                Select all{pickerLines.length > MAX_REMARK_LINES ? ` (first ${MAX_REMARK_LINES})` : ''}
              </button>
            </div>
          )}
          <div className="max-h-40 overflow-y-auto rounded-md border border-border">
            {allowLinePicker && lines.length === 0 ? (
              pickerQuery.isLoading
                ? <p className="px-3 py-2 text-[11px] text-muted-foreground">Loading draft lines…</p>
                : pickerLines.length === 0
                  ? <p className="px-3 py-2 text-[11px] text-muted-foreground">No draft statement lines are available.</p>
                  : pickerLines.map((line) => {
                    const checked = pickedIds.includes(line.id);
                    const blocked = !checked && pickedIds.length >= MAX_REMARK_LINES;
                    return (
                    <label key={line.id} className={`flex items-start gap-2 border-b border-border px-3 py-2 last:border-b-0 ${blocked ? 'opacity-50' : ''}`}>
                      <input
                        type="checkbox"
                        data-testid={`checkbox-remarks-line-${line.id}`}
                        checked={checked}
                        disabled={blocked}
                        onChange={() => togglePicked(line.id)}
                        className="mt-0.5 size-4 accent-primary"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold">{line.description}</span>
                        <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{shortDate(line.date)}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[11px]">
                        {line.direction === 'inflow' ? '+' : '−'}{money(Math.abs(line.amount), line.currency)}
                      </span>
                    </label>
                    );
                  })
            ) : selectedLines.map((line) => (
              <div key={line.id} className="flex items-start justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold">{line.description}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{shortDate(line.date)}</div>
                </div>
                <div className="shrink-0 font-mono text-[11px]">
                  {line.direction === 'inflow' ? '+' : '−'}{money(Math.abs(line.amount), line.currency)}
                </div>
              </div>
            ))}
          </div>
          {overCap && (
            <p className="text-[11px] text-destructive">Remarks links can include at most {MAX_REMARK_LINES} lines. Deselect some before sending.</p>
          )}
          <DialogFooter className="mt-5 border-t border-border pt-4">
            <button type="button" onClick={onClose} disabled={send.isPending} className="rounded-md px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted">Cancel</button>
            <button
              type="submit"
              data-testid="button-confirm-send-for-remarks"
              disabled={!canSend}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {send.isPending ? <LoaderCircle size={13} className="animate-spin" /> : <Mail size={13} />}
              {send.isPending ? 'Sending…' : 'Send link'}
            </button>
          </DialogFooter>
        </form>
        <aside className="min-w-0 rounded-lg border border-primary/20 bg-primary/5 p-4" data-testid="card-email-preview">
          <div className="font-mono text-[9px] uppercase tracking-[.14em] text-primary">Email Preview</div>
          <h3 className="mt-1 text-sm font-semibold">Request for transaction remarks</h3>
          <div className="mt-4 space-y-3 rounded-md border border-border bg-background p-3 text-[11px] leading-5">
            <div className="flex min-w-0 gap-2">
              <span className="w-12 shrink-0 text-muted-foreground">From</span>
              <span className="min-w-0 truncate font-medium">AgarAccounting AI</span>
            </div>
            <div className="flex min-w-0 gap-2">
              <span className="w-12 shrink-0 text-muted-foreground">To</span>
              <span className="min-w-0 truncate font-medium">{email.trim() || 'recipient@company.com'}</span>
            </div>
            <div className="flex min-w-0 gap-2">
              <span className="w-12 shrink-0 text-muted-foreground">Subject</span>
              <span className="min-w-0 font-medium">{subject}</span>
            </div>
            <div className="border-t border-border pt-3 text-muted-foreground">
              {message.trim() || `Please add remarks for ${selectedLines.length} draft statement line${selectedLines.length === 1 ? '' : 's'} in this client workspace.`}
            </div>
            <div className="border-t border-border pt-3 text-muted-foreground">
              This link stays active for 3 days. The recipient does not need an account.
            </div>
            <div className="rounded border border-primary/15 bg-primary/5 px-2.5 py-2 text-primary">
              {selectedLines.length > 0
                ? `${selectedLines.length} draft statement line${selectedLines.length === 1 ? '' : 's'} included`
                : 'Select at least one draft statement line'}
            </div>
            <div className="border-t border-border pt-3">
              <div className="text-muted-foreground">Link address</div>
              <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">Generated securely when the email is sent</div>
              <button type="button" disabled className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground opacity-50">
                Open remarks page
              </button>
            </div>
            <div className="border-t border-border pt-3 text-muted-foreground">
              Kind regards,<br />{senderName}
            </div>
          </div>
          <p className="mt-3 text-[10px] leading-4 text-muted-foreground">The public link and expiry date will be added automatically when the email is sent.</p>
        </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
