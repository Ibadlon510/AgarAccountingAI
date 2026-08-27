import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { File, Storage } from "@google-cloud/storage";
import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
  type ObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const LOCAL_UPLOAD_TTL_MS = 900_000;
const LOCAL_UPLOAD_URL_PREFIX = "/api/storage/uploads/";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
  }
}

type PendingLocalUpload = {
  objectPath: string;
  ownerUserId: string;
  expiresAt: number;
};

type LocalObjectMeta = {
  contentType: string;
  aclPolicy?: ObjectAclPolicy;
};

const pendingLocalUploads = new Map<string, PendingLocalUpload>();

function useLocalObjectStorage() {
  if (process.env.LOCAL_OBJECT_STORAGE === "1") return true;
  if (process.env.REPL_ID) return false;
  return !process.env.PRIVATE_OBJECT_DIR;
}

function localObjectRoot() {
  return path.resolve(process.env.LOCAL_OBJECT_DIR || path.join(process.cwd(), ".local", "object-storage"));
}

function assertUploadPrefix(prefix: string) {
  if (!/^[a-zA-Z0-9_%/-]+$/.test(prefix) || prefix.includes("..")) {
    throw new Error("Invalid object upload prefix.");
  }
}

function entityIdFromObjectPath(objectPath: string) {
  if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
  const entityId = objectPath.slice("/objects/".length);
  if (!entityId || entityId.includes("..") || path.isAbsolute(entityId)) throw new ObjectNotFoundError();
  return entityId;
}

function localPaths(objectPath: string) {
  const entityId = entityIdFromObjectPath(objectPath);
  const root = localObjectRoot();
  const filePath = path.resolve(root, entityId);
  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new ObjectNotFoundError();
  return { filePath, metaPath: `${filePath}.meta.json`, name: objectPath };
}

async function readLocalMeta(metaPath: string): Promise<LocalObjectMeta> {
  try {
    return JSON.parse(await readFile(metaPath, "utf8")) as LocalObjectMeta;
  } catch {
    return { contentType: "application/octet-stream" };
  }
}

class LocalStoredFile {
  readonly name: string;

  constructor(private readonly filePath: string, private readonly metaPath: string, objectPath: string) {
    this.name = objectPath;
  }

  async exists(): Promise<[boolean]> {
    try {
      await access(this.filePath);
      return [true];
    } catch {
      return [false];
    }
  }

  async getMetadata() {
    const [exists] = await this.exists();
    if (!exists) throw new ObjectNotFoundError();
    const fileStat = await stat(this.filePath);
    const meta = await readLocalMeta(this.metaPath);
    return [{
      size: String(fileStat.size),
      contentType: meta.contentType,
      metadata: meta.aclPolicy ? { "custom:aclPolicy": JSON.stringify(meta.aclPolicy) } : undefined,
    }];
  }

  async setMetadata(update: { metadata?: Record<string, string> }) {
    const meta = await readLocalMeta(this.metaPath);
    const rawPolicy = update.metadata?.["custom:aclPolicy"];
    if (rawPolicy) meta.aclPolicy = JSON.parse(rawPolicy) as ObjectAclPolicy;
    await writeFile(this.metaPath, JSON.stringify(meta), "utf8");
  }

  createReadStream() {
    return createReadStream(this.filePath);
  }

  async download(): Promise<[Buffer]> {
    const [exists] = await this.exists();
    if (!exists) throw new ObjectNotFoundError();
    return [await readFile(this.filePath)];
  }

  async delete(options: { ignoreNotFound?: boolean } = {}) {
    try {
      await unlink(this.filePath);
    } catch (error) {
      if (!options.ignoreNotFound) throw error;
    }
    await unlink(this.metaPath).catch(() => undefined);
  }
}

export class ObjectStorageService {
  getPrivateObjectDir() {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) throw new Error("PRIVATE_OBJECT_DIR is not configured.");
    return dir;
  }

  async getObjectEntityUploadURL(prefix = "uploads") {
    assertUploadPrefix(prefix);
    if (useLocalObjectStorage()) {
      const token = randomUUID();
      const objectPath = `/objects/${prefix}/${randomUUID()}`;
      const ownerUserId = decodeURIComponent(prefix.split("/")[1] ?? "");
      pendingLocalUploads.set(token, {
        objectPath,
        ownerUserId,
        expiresAt: Date.now() + LOCAL_UPLOAD_TTL_MS,
      });
      return `${LOCAL_UPLOAD_URL_PREFIX}${token}`;
    }
    const fullPath = `${this.getPrivateObjectDir()}/${prefix}/${randomUUID()}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    return signObjectURL({ bucketName, objectName, method: "PUT", ttlSec: 900 });
  }

  async completeLocalUpload(token: string, buffer: Buffer, contentType: string) {
    const pending = pendingLocalUploads.get(token);
    pendingLocalUploads.delete(token);
    if (!pending || pending.expiresAt < Date.now()) throw new ObjectNotFoundError();
    const { filePath, metaPath } = localPaths(pending.objectPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);
    const aclPolicy: ObjectAclPolicy | undefined = pending.ownerUserId
      ? { owner: pending.ownerUserId, visibility: "private" }
      : undefined;
    await writeFile(metaPath, JSON.stringify({ contentType, aclPolicy } satisfies LocalObjectMeta), "utf8");
    return pending.objectPath;
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (useLocalObjectStorage()) {
      const { filePath, metaPath, name } = localPaths(objectPath);
      const localFile = new LocalStoredFile(filePath, metaPath, name);
      const [exists] = await localFile.exists();
      if (!exists) throw new ObjectNotFoundError();
      return localFile as unknown as File;
    }
    const entityId = entityIdFromObjectPath(objectPath);
    const privateDir = this.getPrivateObjectDir().replace(/\/+$/, "");
    const { bucketName, objectName } = parseObjectPath(`${privateDir}/${entityId}`);
    const objectFile = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) throw new ObjectNotFoundError();
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string) {
    if (rawPath.startsWith(LOCAL_UPLOAD_URL_PREFIX)) {
      const token = rawPath.slice(LOCAL_UPLOAD_URL_PREFIX.length).split("?")[0];
      const pending = token ? pendingLocalUploads.get(token) : undefined;
      if (pending) return pending.objectPath;
      return rawPath;
    }
    if (!rawPath.startsWith("https://storage.googleapis.com/")) return rawPath;
    const url = new URL(rawPath);
    const privateDir = `${this.getPrivateObjectDir().replace(/\/+$/, "")}/`;
    if (!url.pathname.startsWith(privateDir)) return url.pathname;
    return `/objects/${url.pathname.slice(privateDir.length)}`;
  }

  async trySetObjectEntityAclPolicy(rawPath: string, aclPolicy: ObjectAclPolicy) {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission = ObjectPermission.READ,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }) {
    return canAccessObject({ userId, objectFile, requestedPermission });
  }

  async downloadObject(objectFile: File, cacheTtlSec = 3600) {
    const [metadata] = await objectFile.getMetadata();
    const aclPolicy = await getObjectAclPolicy(objectFile);
    const response = new Response(
      Readable.toWeb(objectFile.createReadStream()) as ReadableStream,
      {
        headers: {
          "Content-Type": (metadata.contentType as string) || "application/octet-stream",
          "Cache-Control": `${aclPolicy?.visibility === "public" ? "public" : "private"}, max-age=${cacheTtlSec}`,
          ...(metadata.size ? { "Content-Length": String(metadata.size) } : {}),
        },
      },
    );
    return response;
  }
}

function parseObjectPath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const parts = normalized.split("/");
  if (parts.length < 3 || !parts[1] || !parts.slice(2).join("/")) throw new Error("Invalid object path.");
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "PUT" | "GET" | "DELETE" | "HEAD";
  ttlSec: number;
}) {
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Failed to sign object URL: ${response.status}`);
  const { signed_url: signedURL } = await response.json() as { signed_url: string };
  return signedURL;
}
