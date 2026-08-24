import { randomUUID } from "node:crypto";
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

export class ObjectStorageService {
  getPrivateObjectDir() {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) throw new Error("PRIVATE_OBJECT_DIR is not configured.");
    return dir;
  }

  async getObjectEntityUploadURL(prefix = "uploads") {
    if (!/^[a-zA-Z0-9_%/-]+$/.test(prefix) || prefix.includes("..")) {
      throw new Error("Invalid object upload prefix.");
    }
    const fullPath = `${this.getPrivateObjectDir()}/${prefix}/${randomUUID()}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    return signObjectURL({ bucketName, objectName, method: "PUT", ttlSec: 900 });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const entityId = objectPath.slice("/objects/".length);
    if (!entityId || entityId.includes("..")) throw new ObjectNotFoundError();
    const privateDir = this.getPrivateObjectDir().replace(/\/+$/, "");
    const { bucketName, objectName } = parseObjectPath(`${privateDir}/${entityId}`);
    const objectFile = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) throw new ObjectNotFoundError();
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string) {
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