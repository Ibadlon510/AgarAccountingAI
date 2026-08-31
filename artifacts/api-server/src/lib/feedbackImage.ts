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
