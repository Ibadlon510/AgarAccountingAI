import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FirmBrandingState, PublicFirmLanding } from "@workspace/api-zod";
import { customFetch } from "./custom-fetch";

export const getGetFirmBrandingQueryKey = () => ["firm-branding"] as const;
export const getGetPublicFirmLandingQueryKey = (slug: string) => ["public-firm-landing", slug] as const;

export async function getFirmBranding() {
  return customFetch<FirmBrandingState>("/api/workspace/firm-branding");
}

export function useGetFirmBranding(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: getGetFirmBrandingQueryKey(),
    queryFn: getFirmBranding,
    enabled: options?.enabled ?? true,
  });
}

export async function updateFirmBranding(data: {
  slug?: string;
  landingHeadline?: string | null;
  landingTagline?: string | null;
  landingEnabled?: boolean;
  logoObjectPath?: string | null;
}) {
  return customFetch<FirmBrandingState>("/api/workspace/firm-branding", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function useUpdateFirmBranding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateFirmBranding,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetFirmBrandingQueryKey() });
    },
  });
}

export async function uploadFirmBrandingLogo(data: { fileName: string; contentType: string; fileBase64: string }) {
  return customFetch<{ logoUrl: string; objectPath: string }>("/api/workspace/firm-branding/logo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function useUploadFirmBrandingLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: uploadFirmBrandingLogo,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetFirmBrandingQueryKey() });
    },
  });
}

export async function getPublicFirmLanding(slug: string) {
  return customFetch<PublicFirmLanding>(`/api/public/firm-landing/${encodeURIComponent(slug)}`);
}

export function useGetPublicFirmLanding(slug: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: getGetPublicFirmLandingQueryKey(slug),
    queryFn: () => getPublicFirmLanding(slug),
    enabled: (options?.enabled ?? true) && Boolean(slug),
    retry: false,
  });
}

export type { FirmBrandingState, PublicFirmLanding };
