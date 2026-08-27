import { Readable } from "node:stream";
import express, { Router, type IRouter, type Request, type Response } from "express";
import { clientWorkspacesTable, db } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { MAX_STATEMENT_FILE_SIZE, validateStatementMetadata } from "../lib/statementDocument";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const body = req.body as { clientId?: unknown; name?: unknown; size?: unknown; contentType?: unknown };
  if (!req.dbUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (typeof body.clientId !== "number" || typeof body.name !== "string" || typeof body.size !== "number" || typeof body.contentType !== "string") {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }
  const { clientId, name, size, contentType } = body;
  const [membership] = await db.select({ clientId: clientWorkspacesTable.clientId })
    .from(clientWorkspacesTable)
    .where(and(eq(clientWorkspacesTable.clientId, clientId), eq(clientWorkspacesTable.userId, req.dbUser.id)))
    .limit(1);
  if (!membership) {
    res.status(403).json({ error: "You do not have access to this client workspace." });
    return;
  }
  const validationError = validateStatementMetadata(name, contentType, size);
  if (validationError) {
    res.status(400).json({ error: validationError, maxSize: MAX_STATEMENT_FILE_SIZE });
    return;
  }
  try {
    const prefix = `uploads/${encodeURIComponent(req.dbUser.id)}/${clientId}`;
    const uploadURL = await objectStorageService.getObjectEntityUploadURL(prefix);
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({
      uploadURL,
      objectPath,
      metadata: { name, size, contentType },
    });
  } catch (error) {
    req.log.error({ err: error }, "Error generating statement upload URL");
    res.status(500).json({ error: "Could not prepare the statement upload. Try again." });
  }
});

router.put(
  "/storage/uploads/:token",
  express.raw({ type: "*/*", limit: MAX_STATEMENT_FILE_SIZE }),
  async (req: Request, res: Response) => {
    if (!req.dbUser) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const token = req.params.token;
    if (typeof token !== "string" || !token) {
      res.status(400).json({ error: "Missing upload token." });
      return;
    }
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buffer.length) {
      res.status(400).json({ error: "The statement upload was empty." });
      return;
    }
    const contentType = String(req.headers["content-type"] || "application/octet-stream");
    try {
      await objectStorageService.completeLocalUpload(token, buffer, contentType);
      res.status(200).end();
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "This upload URL is no longer available. Please try again." });
        return;
      }
      req.log.error({ err: error }, "Error storing local statement upload");
      res.status(500).json({ error: "Could not store the statement upload. Try again." });
    }
  },
);

router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  if (!req.dbUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const raw = req.params.path;
  const objectPath = `/objects/${Array.isArray(raw) ? raw.join("/") : raw}`;
  try {
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const canAccess = await objectStorageService.canAccessObjectEntity({
      userId: req.dbUser.id,
      objectFile,
    });
    if (!canAccess) {
      res.status(403).json({ error: "You do not have access to this document." });
      return;
    }
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    else res.end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving private object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export { objectStorageService };
export default router;