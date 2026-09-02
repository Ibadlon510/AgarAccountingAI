import * as zod from "zod";

export const FirmBranding = zod.object({
  slug: zod.string().nullable(),
  publicHost: zod.string().nullable(),
  pathFallback: zod.string().nullable(),
  logoUrl: zod.string().nullable(),
  landingHeadline: zod.string().nullable(),
  landingTagline: zod.string().nullable(),
  landingEnabled: zod.boolean(),
  available: zod.boolean(),
  canManage: zod.boolean(),
});

export const GetFirmBrandingResponse = FirmBranding;

export const UpdateFirmBrandingBody = zod.object({
  slug: zod.string().min(3).max(32).optional(),
  landingHeadline: zod.string().max(120).nullable().optional(),
  landingTagline: zod.string().max(280).nullable().optional(),
  landingEnabled: zod.boolean().optional(),
  logoObjectPath: zod.string().nullable().optional(),
});

export const UpdateFirmBrandingResponse = FirmBranding;

export const CreateFirmBrandingLogoBody = zod.object({
  fileName: zod.string().min(1),
  contentType: zod.string().min(1),
  fileBase64: zod.string().min(1),
});

export const CreateFirmBrandingLogoResponse = zod.object({
  logoUrl: zod.string(),
  objectPath: zod.string(),
});

export const GetPublicFirmLandingResponse = zod.object({
  slug: zod.string(),
  name: zod.string(),
  legalName: zod.string(),
  headline: zod.string(),
  tagline: zod.string().nullable(),
  logoUrl: zod.string().nullable(),
  host: zod.string(),
});

export type FirmBrandingState = zod.infer<typeof FirmBranding>;
export type PublicFirmLanding = zod.infer<typeof GetPublicFirmLandingResponse>;
