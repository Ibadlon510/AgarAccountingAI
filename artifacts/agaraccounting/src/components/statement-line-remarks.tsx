import { Clock, Download, MessageSquare } from 'lucide-react';
import { type StatementLine } from '@workspace/api-client-react';
import { useGetStatementLineNotes } from '@workspace/api-client-react/statement-line-remarks';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

const shortDateTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export function StatementLineRemarkIcons({
  line,
  onOpenNotes,
}: {
  line: StatementLine;
  onOpenNotes: (line: StatementLine) => void;
}) {
  if (line.status !== 'draft') return null;
  const pending = line.pendingClarification;
  const hasNote = line.noteSummary?.hasNote;
  if (!pending && !hasNote) return null;
  return (
    <span className="ml-1.5 inline-flex items-center gap-0.5 align-middle" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
      {pending && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid={`icon-awaiting-remarks-${line.id}`}
              aria-label="Awaiting remarks"
              onClick={() => onOpenNotes(line)}
              className="inline-flex text-accent-foreground"
            >
              <Clock size={13} />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-left">
            Awaiting remarks from {pending.recipientEmail} — sent {shortDateTime(pending.sentAt)}, expires {shortDateTime(pending.expiresAt)}.
          </TooltipContent>
        </Tooltip>
      )}
      {hasNote && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid={`icon-remark-added-${line.id}`}
              aria-label="View remarks"
              onClick={() => onOpenNotes(line)}
              className="inline-flex text-primary"
            >
              <MessageSquare size={13} />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-left">
            {line.noteSummary.latestNotePreview ?? 'Remark added'}
            {line.noteSummary.attachmentCount > 0 ? ` · ${line.noteSummary.attachmentCount} attachment${line.noteSummary.attachmentCount === 1 ? '' : 's'}` : ''}
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

export function StatementLineNotesDrawer({
  line,
  clientId,
  onClose,
}: {
  line: StatementLine | null;
  clientId: number;
  onClose: () => void;
}) {
  const notesQuery = useGetStatementLineNotes(line?.id ?? 0, clientId, {
    query: { enabled: Boolean(line) },
  });

  return (
    <Sheet open={Boolean(line)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" data-testid="drawer-statement-line-notes">
        <SheetHeader>
          <SheetTitle>Remarks</SheetTitle>
          <SheetDescription>{line?.description}</SheetDescription>
        </SheetHeader>
        <div className="mt-5 space-y-4">
          {notesQuery.isLoading && <p className="text-xs text-muted-foreground">Loading remarks…</p>}
          {notesQuery.isError && <p className="text-xs text-destructive">Remarks could not be loaded.</p>}
          {notesQuery.data?.notes.length === 0 && <p className="text-xs text-muted-foreground">No remarks have been submitted yet.</p>}
          {notesQuery.data?.notes.map((note) => (
            <article key={note.id} className="rounded-md border border-border p-3">
              <p className="whitespace-pre-wrap text-sm">{note.noteText}</p>
              <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                {note.submittedByEmail} · {shortDateTime(note.updatedAt)}
              </p>
              {note.attachments.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {note.attachments.map((attachment) => (
                    <li key={attachment.id}>
                      <a
                        href={line ? `/api/agaraccounting/statement-lines/${line.id}/notes/attachments/${attachment.id}?clientId=${clientId}` : '#'}
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary"
                      >
                        <Download size={11} />
                        {attachment.filename}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
