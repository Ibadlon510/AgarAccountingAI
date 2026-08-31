import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Clock, Lock, Paperclip, Send } from 'lucide-react';

const publicQueryClient = new QueryClient();
const MAX_FILES = 5;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const brandMarkUrl = `${basePath}/mark.svg`;

type PublicAttachment = { id: number; filename: string; contentType: string; size: number };
type PublicNote = { id: number; noteText: string; createdAt: string; attachments: PublicAttachment[] };
type PublicLine = {
  id: number;
  date: string;
  description: string;
  currency: string;
  amount: number;
  direction: string;
  posted: boolean;
  status: 'open' | 'posted';
  notes: PublicNote[];
};
type PublicRequest = {
  clientDisplayName: string;
  senderMessage?: string | null;
  expiresAt: string;
  lines: PublicLine[];
};

function readToken() {
  const path = window.location.pathname;
  const stripped = basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
  const match = stripped.match(/^\/detail-request\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

async function publicFetch<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T | null; error?: string }> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has('content-type') && init?.body) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(path, { ...init, credentials: 'omit', headers });
  if (response.status === 204) return { status: response.status, body: null };
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  const error = parsed && typeof parsed === 'object' && 'error' in parsed
    ? String((parsed as { error: unknown }).error)
    : undefined;
  return { status: response.status, body: parsed as T, error };
}

const money = (value: number, currency = 'AED') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);

const shortDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

function LineCard({ token, line, onUpdated }: { token: string; line: PublicLine; onUpdated: (next: PublicLine) => void }) {
  const [noteText, setNoteText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const posted = line.posted || line.status === 'posted';

  const submit = async () => {
    const trimmed = noteText.trim();
    if (!trimmed) {
      setError('Add a remark before submitting.');
      return;
    }
    if (files.length > MAX_FILES) {
      setError(`You can attach at most ${MAX_FILES} files.`);
      return;
    }
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        setError('Each file must be 5 MB or smaller.');
        return;
      }
      if (file.type && !ALLOWED_TYPES.has(file.type)) {
        setError('Attachments must be a PDF or an image (PNG, JPEG, or WebP).');
        return;
      }
    }
    setBusy(true);
    setError('');
    const form = new FormData();
    form.set('noteText', trimmed);
    for (const file of files) form.append('files', file);
    const result = await publicFetch<PublicLine>(`/api/public/statement-line-requests/${encodeURIComponent(token)}/lines/${line.id}`, {
      method: 'POST',
      body: form,
    });
    setBusy(false);
    if (result.status === 409) {
      setError(result.error ?? 'This line has already been posted.');
      return;
    }
    if (result.status === 410 || result.status === 404 || !result.body) {
      setError(result.error ?? 'This remarks link is no longer available.');
      return;
    }
    if (result.status >= 400) {
      setError(result.error ?? 'The remark could not be saved.');
      return;
    }
    setFiles([]);
    setNoteText('');
    onUpdated(result.body);
  };

  const remarksList = line.notes.length > 0 && (
    <ul className="space-y-2">
      {line.notes.map((note) => (
        <li key={note.id} className="rounded-md border border-border bg-muted/40 px-3 py-2">
          <p className="whitespace-pre-wrap text-sm">{note.noteText}</p>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">{shortDate(note.createdAt)}</p>
          {note.attachments.map((attachment) => (
            <a
              key={attachment.id}
              href={`/api/public/statement-line-requests/${encodeURIComponent(token)}/attachments/${attachment.id}`}
              className="mt-1 block text-[11px] font-semibold text-primary"
            >
              {attachment.filename}
            </a>
          ))}
        </li>
      ))}
    </ul>
  );

  return (
    <article data-testid={`public-line-${line.id}`} className="rounded-lg border border-card-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] text-muted-foreground">{shortDate(line.date)}</div>
          <h2 className="mt-1 text-sm font-semibold">{line.description}</h2>
        </div>
        <div className="text-right">
          <div className={`font-mono text-sm font-medium ${line.direction === 'inflow' ? 'text-primary' : 'text-foreground'}`}>
            {line.direction === 'inflow' ? '+' : '−'}{money(Math.abs(line.amount), line.currency)}
          </div>
          <span className="mt-1 inline-flex rounded-full bg-muted px-2 py-0.5 font-mono text-[9px] uppercase tracking-[.08em] text-muted-foreground">
            {posted ? 'posted' : 'open'}
          </span>
        </div>
      </div>
      {posted ? (
        <div className="mt-4 space-y-3">
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock size={13} /> This line has been posted and can no longer accept remarks.
          </p>
          {remarksList}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {remarksList}
          <textarea
            data-testid={`input-public-remark-${line.id}`}
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            maxLength={4000}
            rows={4}
            placeholder={line.notes.length ? 'Add another remark for this transaction' : 'Add a remark for this transaction'}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-primary">
            <Paperclip size={13} />
            Attach files ({files.length}/{MAX_FILES})
            <input
              data-testid={`input-public-files-${line.id}`}
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(event) => {
                const next = [...files, ...Array.from(event.target.files ?? [])].slice(0, MAX_FILES);
                setFiles(next);
                event.currentTarget.value = '';
              }}
            />
          </label>
          {files.length > 0 && (
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`}>{file.name}</li>
              ))}
            </ul>
          )}
          {error && <p className="text-[11px] text-destructive">{error}</p>}
          <button
            type="button"
            data-testid={`button-submit-public-remark-${line.id}`}
            onClick={() => { void submit(); }}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Send size={13} />
            {busy ? 'Saving…' : 'Submit remark'}
          </button>
        </div>
      )}
    </article>
  );
}

function PublicDetailRequestBody() {
  const token = useMemo(() => readToken(), []);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'gone'>('loading');
  const [goneMessage, setGoneMessage] = useState('This remarks link is no longer available.');
  const [request, setRequest] = useState<PublicRequest | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('missing');
      return;
    }
    void publicFetch<PublicRequest>(`/api/public/statement-line-requests/${encodeURIComponent(token)}`).then((result) => {
      if (result.status === 410) {
        setGoneMessage(result.error ?? 'This remarks link is no longer available.');
        setStatus('gone');
        return;
      }
      if (result.status !== 200 || !result.body) {
        setStatus('missing');
        return;
      }
      setRequest(result.body);
      setStatus('ready');
    });
  }, [token]);

  if (status === 'loading') {
    return <p className="text-sm text-muted-foreground">Loading requested lines…</p>;
  }
  if (status === 'gone') {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm">
        <Clock size={16} className="text-muted-foreground" />
        <p className="mt-3 font-semibold">{goneMessage}</p>
        <p className="mt-1 text-muted-foreground">Ask the sender to email a new link if you still need to add remarks.</p>
      </div>
    );
  }
  if (status === 'missing' || !request) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm">
        <p className="font-semibold">This remarks link was not found</p>
        <p className="mt-1 text-muted-foreground">The link may be incomplete. Use the original email to open it again.</p>
      </div>
    );
  }

  const expires = new Date(request.expiresAt);

  return (
    <div className="space-y-4">
      {request.senderMessage && (
        <p className="rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm">{request.senderMessage}</p>
      )}
      <p className="text-xs text-muted-foreground">
        {request.lines.length} line{request.lines.length === 1 ? '' : 's'} · expires {expires.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </p>
      {request.lines.map((line) => (
        <LineCard
          key={line.id}
          token={token}
          line={line}
          onUpdated={(next) => {
            setRequest((current) => current
              ? { ...current, lines: current.lines.map((item) => item.id === next.id ? next : item) }
              : current);
          }}
        />
      ))}
    </div>
  );
}

export default function PublicDetailRequestPage() {
  return (
    <QueryClientProvider client={publicQueryClient}>
      <main className="min-h-[100dvh] bg-background px-4 py-10" data-testid="public-detail-request">
        <div className="mx-auto w-full max-w-2xl">
          <div className="mb-8 flex items-center gap-3">
            <img src={brandMarkUrl} alt="" className="size-9 rounded-lg" />
            <div>
              <div className="font-display text-lg leading-none tracking-tight">AgarAccounting AI</div>
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[.2em] text-muted-foreground">Remarks request</div>
            </div>
          </div>
          <PublicDetailRequestBody />
        </div>
      </main>
    </QueryClientProvider>
  );
}
