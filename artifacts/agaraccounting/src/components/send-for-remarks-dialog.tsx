import { useMemo, useState } from 'react';
import { LoaderCircle, Mail } from 'lucide-react';
import { useGetWorkspaceMembers, useRequestStatementLineDetails, type StatementLine } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { notify, readErrorMessage } from '@/lib/notify';

const money = (value: number, currency = 'AED') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);

const shortDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function SendForRemarksDialog({
  clientId,
  lines,
  onClose,
  onSent,
}: {
  clientId: number;
  lines: StatementLine[];
  onClose: () => void;
  onSent: () => void;
}) {
  const team = useGetWorkspaceMembers();
  const send = useRequestStatementLineDetails();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const memberEmails = useMemo(() => {
    const members = team.data?.members ?? [];
    return [...new Set(members.map((member) => member.email).filter(Boolean))].sort();
  }, [team.data?.members]);
  const invalidEmail = email.trim().length > 0 && !EMAIL_PATTERN.test(email.trim());
  const canSend = EMAIL_PATTERN.test(email.trim()) && lines.length > 0 && !send.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    send.mutate({
      data: {
        clientId,
        statementLineIds: lines.map((line) => line.id),
        recipientEmail: email.trim(),
        senderMessage: message.trim() || null,
      },
    }, {
      onSuccess: (result) => {
        const expires = new Date(result.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        notify.success('Remarks link sent', {
          description: `Sent to ${result.recipientEmail}. ${lines.length} line${lines.length === 1 ? '' : 's'} awaiting remarks. Expires ${expires}.`,
        });
        onSent();
      },
      onError: (error) => {
        notify.error(error, {
          title: 'Could not send remarks link',
          fallback: readErrorMessage(error, 'The remarks email was not sent.'),
        });
      },
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !send.isPending) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="dialog-send-for-remarks">
        <DialogHeader>
          <DialogTitle>Send for remarks</DialogTitle>
          <DialogDescription>
            Email a public link covering {lines.length} draft line{lines.length === 1 ? '' : 's'}. The recipient does not need an account.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
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
          <div className="max-h-40 overflow-y-auto rounded-md border border-border">
            {lines.map((line) => (
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
          <DialogFooter>
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
      </DialogContent>
    </Dialog>
  );
}
