import { Readable } from "node:stream";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, ne } from "drizzle-orm";
import {
  CreateFirmBrandingLogoBody,
  CreateFirmBrandingLogoResponse,
  GetFirmBrandingResponse,
  GetPublicFirmLandingResponse,
  UpdateFirmBrandingBody,
  UpdateFirmBrandingResponse,
} from "@workspace/api-zod";
import {
  db,
  firmMembershipsTable,
  firmProfilesTable,
} from "@workspace/db";
import { resolveFirmBilling } from "../lib/billing";
import {
  firmLandingLogoPath,
  firmSlugError,
  MAX_FIRM_LOGO_BYTES,
  normalizeFirmSlug,
  publicFirmHost,
  validateFirmLogoBytes,
  validateFirmLogoMetadata,
} from "../lib/firmBranding";
import { ObjectNotFoundError } from "../lib/objectStorage";
import { objectStorageService } from "./storage";

export const firmBrandingPublicRouter: IRouter = Router();
export const firmBrandingAuthRouter: IRouter = Router();

function currentUserId(req: Request) {
  if (!req.dbUser) throw new Error("Authenticated user is required.");
  return req.dbUser.id;
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: string }).code === "23505");
}

function isManagerRole(role: string) {
  return role === "owner" || role === "admin";
}

function trimToNull(value: string | null | undefined, max: number) {
  if (value == null) return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length ? trimmed : null;
}

async function allocateUniqueSlug(desired: string, excludeFirmId?: number) {
  let base = normalizeFirmSlug(desired);
  if (firmSlugError(base)) base = "practice";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base.slice(0, 27)}-${attempt + 1}`;
    if (firmSlugError(candidate)) continue;
    const [existing] = await db.select({ id: firmProfilesTable.id }).from(firmProfilesTable).where(
      excludeFirmId
        ? and(eq(firmProfilesTable.slug, candidate), ne(firmProfilesTable.id, excludeFirmId))
        : eq(firmProfilesTable.slug, candidate),
    ).limit(1);
    if (!existing) return candidate;
  }
  return `firm-${Date.now().toString(36)}`.slice(0, 32);
}

async function accountingFirmForUser(userId: string) {
  const [row] = await db.select({
    role: firmMembershipsTable.role,
    firm: firmProfilesTable,
  }).from(firmMembershipsTable)
    .innerJoin(firmProfilesTable, eq(firmProfilesTable.id, firmMembershipsTable.firmId))
    .where(and(
      eq(firmMembershipsTable.userId, userId),
      eq(firmMembershipsTable.status, "active"),
      eq(firmProfilesTable.profileKind, "accounting_firm"),
    ))
    .limit(1);
  return row ?? null;
}

async function requireFirmBrandingManager(req: Request, res: Response) {
  const membership = await accountingFirmForUser(currentUserId(req));
  if (!membership || !isManagerRole(membership.role)) {
    res.status(403).json({ error: "Only firm owners or admins can manage white-label branding." });
    return null;
  }
  return membership.firm;
}

async function ensureFirmSlug(firm: typeof firmProfilesTable.$inferSelect) {
  if (firm.slug) return firm;
  const slug = await allocateUniqueSlug(firm.name, firm.id);
  const [saved] = await db.update(firmProfilesTable).set({ slug }).where(eq(firmProfilesTable.id, firm.id)).returning();
  return saved ?? { ...firm, slug };
}

function brandingPayload(firm: typeof firmProfilesTable.$inferSelect, available: boolean, canManage: boolean) {
  const slug = firm.slug ?? null;
  return {
    slug,
    publicHost: slug ? publicFirmHost(slug) : null,
    pathFallback: slug ? `/f/${slug}` : null,
    logoUrl: firm.logoObjectPath ? "/api/workspace/firm-branding/logo" : null,
    landingHeadline: firm.landingHeadline,
    landingTagline: firm.landingTagline,
    landingEnabled: firm.landingEnabled,
    available,
    canManage,
  };
}

async function publishedFirmBySlug(rawSlug: string) {
  const slug = normalizeFirmSlug(rawSlug);
  if (firmSlugError(slug)) return null;
  const [firm] = await db.select().from(firmProfilesTable).where(and(
    eq(firmProfilesTable.slug, slug),
    eq(firmProfilesTable.profileKind, "accounting_firm"),
  )).limit(1);
  if (!firm || !firm.landingEnabled) return null;
  const billing = await resolveFirmBilling(firm.id);
  if (!billing?.fullAccess) return null;
  return firm;
}

firmBrandingPublicRouter.get("/public/firm-landing/:slug/logo", async (req, res) => {
  const firm = await publishedFirmBySlug(String(req.params.slug ?? ""));
  if (!firm?.logoObjectPath) {
    res.status(404).json({ error: "Firm landing not found." });
    return;
  }
  try {
    const objectFile = await objectStorageService.getObjectEntityFile(firm.logoObjectPath);
    const response = await objectStorageService.downloadObject(objectFile, 300);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline");
    if (response.body) Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    else res.end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Firm landing not found." });
      return;
    }
    req.log?.error({ err: error }, "Error serving firm landing logo");
    res.status(500).json({ error: "Failed to serve firm logo." });
  }
});

firmBrandingPublicRouter.get("/public/firm-landing/:slug", async (req, res) => {
  const firm = await publishedFirmBySlug(String(req.params.slug ?? ""));
  if (!firm?.slug) {
    res.status(404).json({ error: "Firm landing not found." });
    return;
  }
  res.json(GetPublicFirmLandingResponse.parse({
    slug: firm.slug,
    name: firm.name,
    legalName: firm.legalName,
    headline: firm.landingHeadline?.trim() || "Your close, ready for review.",
    tagline: firm.landingTagline,
    logoUrl: firm.logoObjectPath ? firmLandingLogoPath(firm.slug) : null,
    host: publicFirmHost(firm.slug),
  }));
});

firmBrandingAuthRouter.get("/workspace/firm-branding", async (req, res) => {
  const membership = await accountingFirmForUser(currentUserId(req));
  if (!membership) {
    res.status(404).json({ error: "No accounting firm is linked to this account." });
    return;
  }
  const firm = await ensureFirmSlug(membership.firm);
  const billing = await resolveFirmBilling(firm.id);
  res.json(GetFirmBrandingResponse.parse(brandingPayload(firm, Boolean(billing?.fullAccess), isManagerRole(membership.role))));
});

firmBrandingAuthRouter.get("/workspace/firm-branding/logo", async (req, res) => {
  const membership = await accountingFirmForUser(currentUserId(req));
  if (!membership?.firm.logoObjectPath) {
    res.status(404).json({ error: "Firm logo not found." });
    return;
  }
  try {
    const objectFile = await objectStorageService.getObjectEntityFile(membership.firm.logoObjectPath);
    const response = await objectStorageService.downloadObject(objectFile, 0);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline");
    if (response.body) Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    else res.end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Firm logo not found." });
      return;
    }
    req.log?.error({ err: error }, "Error serving firm branding logo");
    res.status(500).json({ error: "Failed to serve firm logo." });
  }
});

firmBrandingAuthRouter.patch("/workspace/firm-branding", async (req, res) => {
  const parsed = UpdateFirmBrandingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid slug, headline, and tagline." });
    return;
  }
  const firm = await requireFirmBrandingManager(req, res);
  if (!firm) return;
  const billing = await resolveFirmBilling(firm.id);
  if (!billing?.writeAccess) {
    res.status(402).json({
      error: "Subscribe to Firm Pro to edit white-label branding.",
      code: billing?.status === "locked" ? "firm_locked" : "firm_lapsed",
    });
    return;
  }
  const updates: Partial<typeof firmProfilesTable.$inferInsert> = {};
  if (parsed.data.slug !== undefined) {
    const slug = normalizeFirmSlug(parsed.data.slug);
    const slugError = firmSlugError(slug);
    if (slugError) {
      res.status(400).json({ error: slugError });
      return;
    }
    updates.slug = slug;
  }
  if (parsed.data.landingHeadline !== undefined) updates.landingHeadline = trimToNull(parsed.data.landingHeadline, 120);
  if (parsed.data.landingTagline !== undefined) updates.landingTagline = trimToNull(parsed.data.landingTagline, 280);
  if (parsed.data.landingEnabled !== undefined) updates.landingEnabled = parsed.data.landingEnabled;
  if (parsed.data.logoObjectPath !== undefined) updates.logoObjectPath = parsed.data.logoObjectPath;
  try {
    const saved = Object.keys(updates).length
      ? (await db.update(firmProfilesTable).set(updates).where(eq(firmProfilesTable.id, firm.id)).returning())[0]
      : await ensureFirmSlug(firm);
    if (!saved) {
      res.status(404).json({ error: "Firm branding could not be saved." });
      return;
    }
    if (parsed.data.logoObjectPath === null && firm.logoObjectPath) {
      await objectStorageService.deleteObject(firm.logoObjectPath).catch(() => undefined);
    }
    res.json(UpdateFirmBrandingResponse.parse(brandingPayload(saved, true, true)));
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: "That address is already in use. Choose another slug." });
      return;
    }
    throw error;
  }
});

firmBrandingAuthRouter.post("/workspace/firm-branding/logo", async (req, res) => {
  const parsed = CreateFirmBrandingLogoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a JPEG, PNG, or WebP logo." });
    return;
  }
  const firm = await requireFirmBrandingManager(req, res);
  if (!firm) return;
  const billing = await resolveFirmBilling(firm.id);
  if (!billing?.writeAccess) {
    res.status(402).json({
      error: "Subscribe to Firm Pro to upload a firm logo.",
      code: billing?.status === "locked" ? "firm_locked" : "firm_lapsed",
    });
    return;
  }
  const buffer = Buffer.from(parsed.data.fileBase64, "base64");
  const metadataError = validateFirmLogoMetadata(parsed.data.fileName, parsed.data.contentType, buffer.length);
  if (metadataError) {
    res.status(400).json({ error: metadataError, maxSize: MAX_FIRM_LOGO_BYTES });
    return;
  }
  const bytesError = validateFirmLogoBytes(buffer, parsed.data.contentType);
  if (bytesError) {
    res.status(400).json({ error: bytesError });
    return;
  }
  const previousPath = firm.logoObjectPath;
  const objectPath = await objectStorageService.storePrivateObject(`firm-branding/${firm.id}`, buffer, parsed.data.contentType.toLowerCase().split(";")[0]?.trim() ?? "image/png");
  const current = await ensureFirmSlug(firm);
  const [saved] = await db.update(firmProfilesTable).set({ logoObjectPath: objectPath }).where(eq(firmProfilesTable.id, firm.id)).returning();
  if (previousPath && previousPath !== objectPath) {
    await objectStorageService.deleteObject(previousPath).catch(() => undefined);
  }
  const slug = saved.slug ?? current.slug;
  res.json(CreateFirmBrandingLogoResponse.parse({
    objectPath,
    logoUrl: slug ? firmLandingLogoPath(slug) : objectPath,
  }));
});

export { allocateUniqueSlug };
