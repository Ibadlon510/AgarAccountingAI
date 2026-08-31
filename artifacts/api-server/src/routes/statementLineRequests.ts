import { Readable } from "node:stream";
import { Router, type IRouter, type Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  GetPublicStatementLineRequestAttachmentParams,
  GetPublicStatementLineRequestParams,
  GetPublicStatementLineRequestResponse,
  SubmitPublicStatementLineDetailsParams,
  SubmitPublicStatementLineDetailsResponse,
  submitPublicStatementLineDetailsBodyNoteTextMax,
  submitPublicStatementLineDetailsBodyNoteTextMin,
} from "@workspace/api-zod";
import {
  db,
  statementLineNoteAttachmentsTable,
  statementLineNotesTable,
} from "@workspace/db";
import { ObjectNotFoundError } from "../lib/objectStorage";
import {
  loadPublicRequest,
  MAX_REMARK_FILE_BYTES,
  MAX_REMARK_FILES,
  parseMultipartBuffer,
  publicLinePayload,
  readRequestBuffer,
  remarkObjectStorage,
  replaceNoteAttachments,
  validateRemarkFiles,
} from "../lib/statementLineRemarks";

export const publicStatementLineRequestsRouter: IRouter = Router();

const MULTIPART_LIMIT = MAX_REMARK_FILES * MAX_REMARK_FILE_BYTES + 64 * 1024;

function gone(res: Response) {
  return res.status(410).json({ error: "This remarks link has expired or been revoked." });
}

function missing(res: Response) {
  return res.status(404).json({ error: "This remarks link was not found." });
}

async function resolvePublicRequest(token: string, res: Response) {
  const loaded = await loadPublicRequest(token);
  if (loaded.status === "missing") {
    missing(res);
    return null;
  }
  if (loaded.status === "gone") {
    gone(res);
    return null;
  }
  return loaded.data;
}

publicStatementLineRequestsRouter.get("/public/statement-line-requests/:token", async (req, res) => {
  const parsed = GetPublicStatementLineRequestParams.safeParse(req.params);
  if (!parsed.success) return missing(res);
  const loaded = await resolvePublicRequest(parsed.data.token, res);
  if (!loaded) return;
  const lines = await Promise.all(loaded.lines.map((line) => publicLinePayload(loaded.request.id, line)));
  return res.json(GetPublicStatementLineRequestResponse.parse({
    clientDisplayName: loaded.clientName,
    senderMessage: loaded.request.senderMessage,
    expiresAt: loaded.request.expiresAt,
    lines,
  }));
});

publicStatementLineRequestsRouter.post("/public/statement-line-requests/:token/lines/:lineId", async (req, res) => {
  const parsed = SubmitPublicStatementLineDetailsParams.safeParse(req.params);
  if (!parsed.success) return missing(res);
  const loaded = await resolvePublicRequest(parsed.data.token, res);
  if (!loaded) return;
  const line = loaded.lines.find((candidate) => candidate.id === parsed.data.lineId);
  if (!line) return missing(res);
  if (line.status === "posted") {
    return res.status(409).json({ error: "This line has already been posted." });
  }
  const contentType = String(req.headers["content-type"] ?? "");
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return res.status(400).json({ error: "Remarks must be submitted as multipart form data." });
  }
  let parsedBody: ReturnType<typeof parseMultipartBuffer>;
  try {
    const buffer = await readRequestBuffer(req, MULTIPART_LIMIT);
    parsedBody = parseMultipartBuffer(buffer, contentType);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 413) return res.status(413).json({ error: "The remarks upload is too large." });
    return res.status(400).json({ error: "The remarks form could not be read." });
  }
  const noteText = (parsedBody.fields.noteText ?? "").trim();
  if (noteText.length < submitPublicStatementLineDetailsBodyNoteTextMin
    || noteText.length > submitPublicStatementLineDetailsBodyNoteTextMax) {
    return res.status(400).json({ error: "Add a remark between 1 and 4,000 characters." });
  }
  const files = parsedBody.files.filter((file) => file.fieldName === "files" || file.fieldName === "files[]");
  const fileError = validateRemarkFiles(files);
  if (fileError) return res.status(400).json({ error: fileError });

  const [existing] = await db.select().from(statementLineNotesTable).where(and(
    eq(statementLineNotesTable.requestId, loaded.request.id),
    eq(statementLineNotesTable.statementLineId, line.id),
  )).limit(1);
  const note = existing
    ? (await db.update(statementLineNotesTable).set({
      noteText,
      submittedByEmail: loaded.request.recipientEmail,
      updatedAt: new Date(),
    }).where(eq(statementLineNotesTable.id, existing.id)).returning())[0]
    : (await db.insert(statementLineNotesTable).values({
      clientId: loaded.request.clientId,
      statementLineId: line.id,
      requestId: loaded.request.id,
      submittedByEmail: loaded.request.recipientEmail,
      noteText,
    }).returning())[0];
  if (!note) throw new Error("The remark could not be saved.");
  await replaceNoteAttachments(note.id, files);
  const payload = await publicLinePayload(loaded.request.id, line);
  return res.json(SubmitPublicStatementLineDetailsResponse.parse(payload));
});

publicStatementLineRequestsRouter.get("/public/statement-line-requests/:token/attachments/:attachmentId", async (req, res) => {
  const parsed = GetPublicStatementLineRequestAttachmentParams.safeParse(req.params);
  if (!parsed.success) return missing(res);
  const loaded = await resolvePublicRequest(parsed.data.token, res);
  if (!loaded) return;
  const lineIds = new Set(loaded.lines.map((line) => line.id));
  const [attachment] = await db.select({
    attachment: statementLineNoteAttachmentsTable,
    note: statementLineNotesTable,
  }).from(statementLineNoteAttachmentsTable)
    .innerJoin(statementLineNotesTable, eq(statementLineNotesTable.id, statementLineNoteAttachmentsTable.noteId))
    .where(and(
      eq(statementLineNoteAttachmentsTable.id, parsed.data.attachmentId),
      eq(statementLineNotesTable.requestId, loaded.request.id),
    ))
    .limit(1);
  if (!attachment || !lineIds.has(attachment.note.statementLineId)) return missing(res);
  try {
    const objectFile = await remarkObjectStorage.getObjectEntityFile(attachment.attachment.objectKey);
    const response = await remarkObjectStorage.downloadObject(objectFile);
    res.status(response.status);
    res.setHeader("Content-Type", attachment.attachment.contentType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${attachment.attachment.filename.replaceAll('"', "")}"`);
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "content-type" || key.toLowerCase() === "content-disposition") return;
      res.setHeader(key, value);
    });
    if (response.body) Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    else res.end();
    return;
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return missing(res);
    throw error;
  }
});

export default publicStatementLineRequestsRouter;
