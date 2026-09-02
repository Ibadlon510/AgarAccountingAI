import { useMutation, useQuery } from "@tanstack/react-query";
import type { BillingMe, CompanyBillingState, FirmBillingState } from "@workspace/api-zod";
import { customFetch } from "./custom-fetch";

export const getGetBillingMeQueryKey = () => ["billing", "me"] as const;

export async function getBillingMe() {
  return customFetch<BillingMe>("/api/billing/me");
}

export function useGetBillingMe(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: getGetBillingMeQueryKey(),
    queryFn: getBillingMe,
    enabled: options?.enabled ?? true,
  });
}

export async function createBillingCheckout(data: { payerType: "firm" | "company"; firmId?: number; clientId?: number }) {
  return customFetch<{ url: string | null }>("/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function useCreateBillingCheckout() {
  return useMutation({ mutationFn: createBillingCheckout });
}

export async function createBillingPortal(data: { payerType: "firm" | "company"; firmId?: number; clientId?: number }) {
  return customFetch<{ url: string | null }>("/api/billing/portal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function useCreateBillingPortal() {
  return useMutation({ mutationFn: createBillingPortal });
}

export type { BillingMe, CompanyBillingState, FirmBillingState };
