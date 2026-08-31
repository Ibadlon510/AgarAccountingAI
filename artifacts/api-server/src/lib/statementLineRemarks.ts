import type { Request } from "express";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  clientsTable,
  db,
  statementLineDetailRequestItemsTable,
  statementLineDetailRequestsTable,
  statementLineNoteAttachmentsTable,
  statementLineNotesTable,
  statementLinesTable,
} from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";

export const DETAIL_REQUEST_TTL_MS = 3 * 24 * 60 * 60 * 1000;
export const MAX_REMARK_FILES = 5;
export const MAX_REMARK_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_REMARK_NOTE_CHARS = 4000;
export const ALLOWED_REMARK_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export const emptyNoteSummary = {
  hasNote: false,
  latestNotePreview: null as string | null,
  latestNoteAt: null as string | null,
  attachmentCount: 0,
};

export type NoteSummary = typeof emptyNoteSummary;
export type PendingClarification = {
  requestId: number;
  recipientEmail: string;
  sentAt: string;
  expiresAt: string;
};

export type RemarkState = {
  noteSummary: NoteSummary;
  pendingClarification: PendingClarification | null;
};

export type ParsedMultipartFile = {
  fieldName: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
};

const objectStorageService = new ObjectStorageService();

export function publicAppOrigin(req?: Request) {
  const configured = process.env.PUBLIC_APP_URL?.trim()
    || process.env.AGARACCOUNTING_PUBLIC_URL?.trim();
  const developmentDomain = process.env.NODE_ENV === "production"
    ? undefined
    : process.env.REPLIT_DEV_DOMAIN?.trim();
  const origin = configured
    ?? (developmentDomain ? `https://${developmentDomain}` : undefined)
    ?? req?.get("origin")
    ?? (req ? `${req.protocol}://${req.get("host")}` : undefined);
  if (!origin) {
    throw new Error("PUBLIC_APP_URL must be configured before remarks links can be sent.");
  }
  const url = new URL(origin);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("PUBLIC_APP_URL must use HTTPS.");
  }
  url.search = "";
  url.hash = "";
  return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
}

export function publicDetailRequestLink(token: string, req?: Request) {
  return `${publicAppOrigin(req)}/detail-request/${token}`;
}

export function previewText(value: string, max = 140) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function loadRemarkState(clientId: number, lineIds: number[]): Promise<Map<number, RemarkState>> {
  const state = new Map<number, RemarkState>();
  for (const id of lineIds) {
    state.set(id, { noteSummary: { ...emptyNoteSummary }, pendingClarification: null });
  }
  if (lineIds.length === 0) return state;

  const notes = await db.select({
    id: statementLineNotesTable.id,
    requestId: statementLineNotesTable.requestId,
    statementLineId: statementLineNotesTable.statementLineId,
    noteText: statementLineNotesTable.noteText,
    updatedAt: statementLineNotesTable.updatedAt,
  }).from(statementLineNotesTable).where(and(
    eq(statementLineNotesTable.clientId, clientId),
    inArray(statementLineNotesTable.statementLineId, lineIds),
  )).orderBy(desc(statementLineNotesTable.updatedAt), desc(statementLineNotesTable.id));

  const noteIds = notes.map((note) => note.id);
  const attachmentCounts = noteIds.length
    ? await db.select({
      noteId: statementLineNoteAttachmentsTable.noteId,
      count: sql<number>`count(*)::int`,
    }).from(statementLineNoteAttachmentsTable)
      .where(inArray(statementLineNoteAttachmentsTable.noteId, noteIds))
      .groupBy(statementLineNoteAttachmentsTable.noteId)
    : [];
  const countByNote = new Map(attachmentCounts.map((row) => [row.noteId, Number(row.count)]));
  const attachmentTotalByLine = new Map<number, number>();
  for (const note of notes) {
    attachmentTotalByLine.set(
      note.statementLineId,
      (attachmentTotalByLine.get(note.statementLineId) ?? 0) + (countByNote.get(note.id) ?? 0),
    );
  }
  const latestByLine = new Map<number, typeof notes[number]>();
  for (const note of notes) {
    if (!latestByLine.has(note.statementLineId)) latestByLine.set(note.statementLineId, note);
  }
  for (const [lineId, note] of latestByLine) {
    const current = state.get(lineId);
    if (!current) continue;
    current.noteSummary = {
      hasNote: true,
      latestNotePreview: previewText(note.noteText),
      latestNoteAt: toIso(note.updatedAt),
      attachmentCount: attachmentTotalByLine.get(lineId) ?? 0,
    };
  }

  const answered = new Set(notes.map((note) => `${note.requestId}:${note.statementLineId}`));
  const pendingRows = await db.select({
    requestId: statementLineDetailRequestsTable.id,
    statementLineId: statementLineDetailRequestItemsTable.statementLineId,
    recipientEmail: statementLineDetailRequestsTable.recipientEmail,
    createdAt: statementLineDetailRequestsTable.createdAt,
    expiresAt: statementLineDetailRequestsTable.expiresAt,
  }).from(statementLineDetailRequestItemsTable)
    .innerJoin(
      statementLineDetailRequestsTable,
      eq(statementLineDetailRequestsTable.id, statementLineDetailRequestItemsTable.requestId),
    )
    .where(and(
      eq(statementLineDetailRequestsTable.clientId, clientId),
      inArray(statementLineDetailRequestItemsTable.statementLineId, lineIds),
      isNull(statementLineDetailRequestsTable.revokedAt),
      sql`${statementLineDetailRequestsTable.expiresAt} > now()`,
    ))
    .orderBy(desc(statementLineDetailRequestsTable.createdAt));

  for (const row of pendingRows) {
    if (answered.has(`${row.requestId}:${row.statementLineId}`)) continue;
    const current = state.get(row.statementLineId);
    if (!current || current.pendingClarification) continue;
    current.pendingClarification = {
      requestId: row.requestId,
      recipientEmail: row.recipientEmail,
      sentAt: toIso(row.createdAt),
      expiresAt: toIso(row.expiresAt),
    };
  }

  return state;
}

export async function listLineNotes(clientId: number, lineId: number) {
  const notes = await db.select().from(statementLineNotesTable).where(and(
    eq(statementLineNotesTable.clientId, clientId),
    eq(statementLineNotesTable.statementLineId, lineId),
  )).orderBy(asc(statementLineNotesTable.createdAt), asc(statementLineNotesTable.id));
  const noteIds = notes.map((note) => note.id);
  const attachments = noteIds.length
    ? await db.select().from(statementLineNoteAttachmentsTable)
      .where(inArray(statementLineNoteAttachmentsTable.noteId, noteIds))
      .orderBy(asc(statementLineNoteAttachmentsTable.id))
    : [];
  const attachmentsByNote = new Map<number, typeof attachments>();
  for (const attachment of attachments) {
    const list = attachmentsByNote.get(attachment.noteId) ?? [];
    list.push(attachment);
    attachmentsByNote.set(attachment.noteId, list);
  }
  return notes.map((note) => ({
    id: note.id,
    requestId: note.requestId,
    submittedByEmail: note.submittedByEmail,
    noteText: note.noteText,
    createdAt: toIso(note.createdAt),
    updatedAt: toIso(note.updatedAt),
    attachments: (attachmentsByNote.get(note.id) ?? []).map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
    })),
  }));
}

export type LoadedPublicRequest = {
  request: typeof statementLineDetailRequestsTable.$inferSelect;
  clientName: string;
  lines: Array<typeof statementLinesTable.$inferSelect>;
};

export async function loadPublicRequest(token: string): Promise<
  | { status: "ok"; data: LoadedPublicRequest }
  | { status: "missing" }
  | { status: "gone"; reason: "expired" | "revoked" }
> {
  const [request] = await db.select().from(statementLineDetailRequestsTable)
    .where(eq(statementLineDetailRequestsTable.token, token))
    .limit(1);
  if (!request) return { status: "missing" };
  if (request.revokedAt) return { status: "gone", reason: "revoked" };
  if (request.expiresAt.getTime() <= Date.now()) return { status: "gone", reason: "expired" };
  const items = await db.select().from(statementLineDetailRequestItemsTable)
    .where(eq(statementLineDetailRequestItemsTable.requestId, request.id));
  const lineIds = items.map((item) => item.statementLineId);
  const lines = lineIds.length
    ? await db.select().from(statementLinesTable).where(and(
      eq(statementLinesTable.clientId, request.clientId),
      inArray(statementLinesTable.id, lineIds),
    )).orderBy(asc(statementLinesTable.date), asc(statementLinesTable.id))
    : [];
  const [client] = await db.select({ name: clientsTable.name }).from(clientsTable)
    .where(eq(clientsTable.id, request.clientId))
    .limit(1);
  return {
    status: "ok",
    data: {
      request,
      clientName: client?.name ?? "Client",
      lines,
    },
  };
}

export function detailRequestLifecycleStatus(request: {
  revokedAt: Date | null;
  expiresAt: Date;
}): "active" | "inactive" {
  if (request.revokedAt || request.expiresAt.getTime() <= Date.now()) return "inactive";
  return "active";
}

export function lineRemarkStatus(status: string): "open" | "posted" {
  return status === "posted" ? "posted" : "open";
}

export async function serializeDetailRequest(
  request: typeof statementLineDetailRequestsTable.$inferSelect,
  req?: Request,
) {
  const items = await db.select().from(statementLineDetailRequestItemsTable)
    .where(eq(statementLineDetailRequestItemsTable.requestId, request.id));
  const lineIds = items.map((item) => item.statementLineId);
  const lines = lineIds.length
    ? await db.select().from(statementLinesTable).where(and(
      eq(statementLinesTable.clientId, request.clientId),
      inArray(statementLinesTable.id, lineIds),
    )).orderBy(asc(statementLinesTable.date), asc(statementLinesTable.id))
    : [];
  const notes = lineIds.length
    ? await db.select({
      statementLineId: statementLineNotesTable.statementLineId,
    }).from(statementLineNotesTable).where(and(
      eq(statementLineNotesTable.requestId, request.id),
      inArray(statementLineNotesTable.statementLineId, lineIds),
    ))
    : [];
  const remarkCountByLine = new Map<number, number>();
  for (const note of notes) {
    remarkCountByLine.set(note.statementLineId, (remarkCountByLine.get(note.statementLineId) ?? 0) + 1);
  }
  const lineRows = lines.map((line) => ({
    id: line.id,
    date: line.date,
    description: line.description,
    currency: line.currency,
    amount: Number(line.amount),
    direction: line.direction,
    status: lineRemarkStatus(line.status),
    remarkCount: remarkCountByLine.get(line.id) ?? 0,
  }));
  return {
    id: request.id,
    recipientEmail: request.recipientEmail,
    senderMessage: request.senderMessage,
    status: detailRequestLifecycleStatus(request),
    expiresAt: request.expiresAt,
    sentAt: request.createdAt,
    revokedAt: request.revokedAt,
    publicUrl: publicDetailRequestLink(request.token, req),
    lineCount: lineRows.length,
    postedLineCount: lineRows.filter((line) => line.status === "posted").length,
    remarkCount: notes.length,
    lines: lineRows,
  };
}

export async function listDetailRequests(clientId: number, req?: Request) {
  const requests = await db.select().from(statementLineDetailRequestsTable)
    .where(eq(statementLineDetailRequestsTable.clientId, clientId))
    .orderBy(desc(statementLineDetailRequestsTable.createdAt), desc(statementLineDetailRequestsTable.id));
  return Promise.all(requests.map((request) => serializeDetailRequest(request, req)));
}

export async function publicLinePayload(
  requestId: number,
  line: typeof statementLinesTable.$inferSelect,
) {
  const notes = await db.select().from(statementLineNotesTable).where(and(
    eq(statementLineNotesTable.requestId, requestId),
    eq(statementLineNotesTable.statementLineId, line.id),
  )).orderBy(asc(statementLineNotesTable.createdAt), asc(statementLineNotesTable.id));
  const noteIds = notes.map((note) => note.id);
  const attachments = noteIds.length
    ? await db.select().from(statementLineNoteAttachmentsTable)
      .where(inArray(statementLineNoteAttachmentsTable.noteId, noteIds))
      .orderBy(asc(statementLineNoteAttachmentsTable.id))
    : [];
  const attachmentsByNote = new Map<number, typeof attachments>();
  for (const attachment of attachments) {
    const list = attachmentsByNote.get(attachment.noteId) ?? [];
    list.push(attachment);
    attachmentsByNote.set(attachment.noteId, list);
  }
  const posted = line.status === "posted";
  return {
    id: line.id,
    date: line.date,
    description: line.description,
    currency: line.currency,
    amount: Number(line.amount),
    direction: line.direction,
    posted,
    status: posted ? "posted" as const : "open" as const,
    notes: notes.map((note) => ({
      id: note.id,
      noteText: note.noteText,
      createdAt: toIso(note.createdAt),
      attachments: (attachmentsByNote.get(note.id) ?? []).map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
      })),
    })),
  };
}

export async function replaceNoteAttachments(noteId: number, files: ParsedMultipartFile[]) {
  const existing = await db.select().from(statementLineNoteAttachmentsTable)
    .where(eq(statementLineNoteAttachmentsTable.noteId, noteId));
  for (const attachment of existing) {
    await objectStorageService.deleteObject(attachment.objectKey).catch(() => undefined);
  }
  if (existing.length) {
    await db.delete(statementLineNoteAttachmentsTable)
      .where(eq(statementLineNoteAttachmentsTable.noteId, noteId));
  }
  for (const file of files) {
    const objectKey = await objectStorageService.storePrivateObject(
      `statement-line-remarks/${noteId}`,
      file.buffer,
      file.contentType,
    );
    await db.insert(statementLineNoteAttachmentsTable).values({
      noteId,
      objectKey,
      filename: file.filename.slice(0, 200) || "attachment",
      contentType: file.contentType,
      size: file.buffer.length,
    });
  }
}

export function validateRemarkFiles(files: ParsedMultipartFile[]) {
  if (files.length > MAX_REMARK_FILES) {
    return `A remark can include at most ${MAX_REMARK_FILES} files.`;
  }
  for (const file of files) {
    if (file.buffer.length > MAX_REMARK_FILE_BYTES) {
      return `Each attachment must be ${MAX_REMARK_FILE_BYTES / (1024 * 1024)} MB or smaller.`;
    }
    if (!ALLOWED_REMARK_MIME.has(file.contentType)) {
      return "Attachments must be a PDF or an image (PNG, JPEG, or WebP).";
    }
  }
  return null;
}

function parseContentDisposition(header: string) {
  const name = /(?:^|;)\s*name="([^"]*)"/i.exec(header)?.[1];
  const filename = /(?:^|;)\s*filename="([^"]*)"/i.exec(header)?.[1];
  const filenameStar = /(?:^|;)\s*filename\*=(?:UTF-8'')?([^;]+)/i.exec(header)?.[1];
  return {
    name: name ?? "",
    filename: decodeURIComponent((filenameStar ?? filename ?? "").trim()),
  };
}

export function parseMultipartBuffer(buffer: Buffer, contentType: string): {
  fields: Record<string, string>;
  files: ParsedMultipartFile[];
} {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2]?.trim();
  if (!boundary) throw new Error("Missing multipart boundary.");
  const delimiter = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  const files: ParsedMultipartFile[] = [];
  let start = buffer.indexOf(delimiter);
  if (start < 0) return { fields, files };
  start += delimiter.length;
  while (start < buffer.length) {
    if (buffer.slice(start, start + 2).toString() === "--") break;
    if (buffer.slice(start, start + 2).toString() === "\r\n") start += 2;
    const headerEnd = buffer.indexOf("\r\n\r\n", start);
    if (headerEnd < 0) break;
    const headers = buffer.slice(start, headerEnd).toString("utf8");
    const next = buffer.indexOf(delimiter, headerEnd + 4);
    if (next < 0) break;
    let body = buffer.slice(headerEnd + 4, next);
    if (body.slice(-2).toString() === "\r\n") body = body.slice(0, -2);
    const disposition = /content-disposition:\s*(.+)/i.exec(headers)?.[1] ?? "";
    const parsed = parseContentDisposition(disposition);
    const partType = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim()
      ?? "application/octet-stream";
    if (parsed.filename) {
      files.push({
        fieldName: parsed.name,
        filename: parsed.filename,
        contentType: partType.toLowerCase(),
        buffer: Buffer.from(body),
      });
    } else if (parsed.name) {
      fields[parsed.name] = body.toString("utf8");
    }
    start = next + delimiter.length;
  }
  return { fields, files };
}

export async function readRequestBuffer(req: Request, maxBytes: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      const error = new Error("Payload too large");
      (error as Error & { status?: number }).status = 413;
      throw error;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export { objectStorageService as remarkObjectStorage };
