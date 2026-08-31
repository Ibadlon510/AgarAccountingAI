import { extname } from "node:path";

export const MAX_FEEDBACK_IMAGE_SIZE = 5 * 1024 * 1024;

const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const supportedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const mimeByExtension = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

export function validateFeedbackImageContent(contentType: string, size: number) {
  if (!Number.isFinite(size) || size <= 0) return "Image size must be a positive number.";
  if (size > MAX_FEEDBACK_IMAGE_SIZE) return "Feedback images must be 5 MB or smaller.";
  const normalizedType = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (!supportedMimeTypes.has(normalizedType)) {
    return "Feedback images must use an image MIME type (JPEG, PNG, WebP, or GIF).";
  }
  return null;
}

export function validateFeedbackImageBytes(bytes: Buffer, contentType: string) {
  const normalizedType = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  const isPng = bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff;
  const signature = bytes.subarray(0, 6).toString("ascii");
  const isGif = signature === "GIF87a" || signature === "GIF89a";
  const isWebp = bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  const matches = (
    (normalizedType === "image/png" && isPng)
    || (normalizedType === "image/jpeg" && isJpeg)
    || (normalizedType === "image/gif" && isGif)
    || (normalizedType === "image/webp" && isWebp)
  );
  return matches ? null : "Uploaded file content does not match its declared image type.";
}

export function validateFeedbackImageMetadata(name: string, contentType: string, size: number) {
  const contentError = validateFeedbackImageContent(contentType, size);
  if (contentError) return contentError;
  const extension = extname(name).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    return "Feedback images must be JPEG, PNG, WebP, or GIF.";
  }
  const normalizedType = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  const expected = mimeByExtension.get(extension);
  if (expected && expected !== normalizedType) {
    return "Image file extension does not match its MIME type.";
  }
  return null;
}

export function isFeedbackObjectPath(objectPath: string, userId?: string) {
  const normalized = objectPath.startsWith("/objects/")
    ? objectPath.slice("/objects/".length)
    : objectPath.replace(/^\/+/, "");
  if (!normalized.startsWith("feedback/")) return false;
  if (normalized.includes("..")) return false;
  if (userId) {
    const expectedPrefix = `feedback/${encodeURIComponent(userId)}/`;
    const altPrefix = `feedback/${userId}/`;
    return normalized.startsWith(expectedPrefix) || normalized.startsWith(altPrefix);
  }
  return /^feedback\/[^/]+\/[^/]+$/.test(normalized);
}

export function feedbackImagePublicUrl(objectPath: string) {
  const normalized = objectPath.startsWith("/objects/")
    ? objectPath.slice("/objects/".length)
    : objectPath.replace(/^\/+/, "");
  return `/api/feedback/images/${normalized}`;
}

export function normalizeFeedbackObjectPath(raw: string) {
  if (raw.startsWith("/objects/")) return raw;
  if (raw.startsWith("feedback/")) return `/objects/${raw}`;
  return raw;
}
