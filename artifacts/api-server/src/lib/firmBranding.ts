export const FIRM_HOST_SUFFIX = process.env.AGARACCOUNTING_FIRM_HOST_SUFFIX?.replace(/^\.+/, "") || "agaraccounting.com";
export const MAX_FIRM_LOGO_BYTES = 2 * 1024 * 1024;
export const FIRM_LOGO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const RESERVED_FIRM_SLUGS = new Set([
  "www", "api", "app", "admin", "mail", "ftp", "cdn", "staging", "static", "assets",
  "help", "status", "billing", "clerk", "feedback", "signin", "signup", "sign-in", "sign-up",
  "www2", "dev", "test", "preview", "support", "docs", "blog",
]);

export function slugifyFirmName(name: string) {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : "";
}

export function normalizeFirmSlug(value: string) {
  return slugifyFirmName(value);
}

export function firmSlugError(slug: string) {
  if (slug.length < 3 || slug.length > 32) return "Use 3 to 32 letters, numbers, or hyphens.";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return "Use lowercase letters, numbers, and hyphens only.";
  if (RESERVED_FIRM_SLUGS.has(slug)) return "That address is reserved. Choose another slug.";
  return null;
}

export function publicFirmHost(slug: string) {
  return `${slug}.${FIRM_HOST_SUFFIX}`;
}

export function firmLandingLogoPath(slug: string) {
  return `/api/public/firm-landing/${encodeURIComponent(slug)}/logo`;
}

export function firmSlugFromHost(hostname: string, suffix = FIRM_HOST_SUFFIX) {
  const host = hostname.split(":")[0]?.trim().toLowerCase() ?? "";
  if (!host || host === "localhost" || host === "127.0.0.1") return null;
  const local = host.match(/^([a-z0-9-]+)\.localhost$/);
  if (local?.[1] && !RESERVED_FIRM_SLUGS.has(local[1])) return local[1];
  const root = suffix.toLowerCase();
  if (host === root || host === `www.${root}`) return null;
  if (!host.endsWith(`.${root}`)) return null;
  const slug = host.slice(0, -(root.length + 1));
  if (!slug || slug.includes(".") || RESERVED_FIRM_SLUGS.has(slug)) return null;
  return slug;
}

export function validateFirmLogoMetadata(fileName: string, contentType: string, size: number) {
  if (!Number.isFinite(size) || size <= 0) return "Logo size must be a positive number.";
  if (size > MAX_FIRM_LOGO_BYTES) return "Firm logos must be 2 MB or smaller.";
  const normalizedType = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (!FIRM_LOGO_MIME_TYPES.has(normalizedType)) return "Firm logos must be JPEG, PNG, or WebP.";
  const extension = fileName.trim().toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  const expected = extension === ".jpg" || extension === ".jpeg"
    ? "image/jpeg"
    : extension === ".png"
      ? "image/png"
      : extension === ".webp"
        ? "image/webp"
        : null;
  if (!expected) return "Firm logos must be JPEG, PNG, or WebP.";
  if (expected !== normalizedType) return "Logo file extension does not match its image type.";
  return null;
}

export function validateFirmLogoBytes(bytes: Buffer, contentType: string) {
  const normalizedType = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  const isPng = bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  const matches = (
    (normalizedType === "image/png" && isPng)
    || (normalizedType === "image/jpeg" && isJpeg)
    || (normalizedType === "image/webp" && isWebp)
  );
  return matches ? null : "Uploaded file content does not match its declared image type.";
}
