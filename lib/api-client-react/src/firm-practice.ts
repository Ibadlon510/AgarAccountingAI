import { useMutation, useQuery, type QueryKey, type UseMutationOptions, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";
import { customFetch, type ErrorType } from "./custom-fetch";

export type EngagementService = "bookkeeping" | "statement_review" | "journals" | "ifrs_pack" | "uae_tax_estimate";
export type EngagementOnboardingStatus = "draft" | "sent" | "signed" | "confirmed" | "expired" | "revoked";

export type EngagementContractTerms = {
  services: EngagementService[];
  agreedTransactionsPerMonth: number;
  agreedRevenuePerYear: number;
  agreedRevenueCurrency: string;
  startDate: string;
  endDate: string | null;
  feeNote: string | null;
  termsText: string;
  firmLegalName: string;
  clientLegalName: string;
};

export type EngagementOnboarding = {
  id: number;
  engagementId: number;
  firmId: number;
  clientId: number;
  clientName: string;
  status: EngagementOnboardingStatus;
  terms: EngagementContractTerms;
  signerEmail: string;
  signerName: string | null;
  signedAt: Date | string | null;
  sentAt: Date | string | null;
  confirmBy: Date | string | null;
  confirmedAt: Date | string | null;
  inviteExpiresAt: Date | string | null;
  inviteLink?: string;
  pdfBase64?: string;
  emailDeliveryStatus?: "sent" | "failed";
};

export type EngagementOnboardingInput = {
  name: string;
  legalName: string;
  functionalCurrency: string;
  basis: string;
  period: string;
  services: EngagementService[];
  agreedTransactionsPerMonth: number;
  agreedRevenuePerYear: number;
  startDate: string;
  endDate?: string | null;
  feeNote?: string | null;
  termsText: string;
  signerEmail: string;
};

export type EngagementContractPreview = {
  id: number;
  firmName: string;
  clientName: string;
  status: EngagementOnboardingStatus;
  terms: EngagementContractTerms;
  signerEmail: string;
  pdfBase64?: string;
};

export type FirmOverview = {
  firmId: number;
  firmName: string;
  totals: {
    clientCount: number;
    pendingReviewClients: number;
    pendingReviewLines: number;
    missingRateClients: number;
    awaitingSignatureCount: number;
    awaitingConfirmationCount: number;
    expiredOnboardingCount: number;
    pendingInvitationCount: number;
  };
  clients: Array<{
    id: number;
    name: string;
    period: string;
    ownershipStatus: string;
    functionalCurrency: string;
    completionPercent: number;
    pendingReview: number;
    totalLines: number;
    journalCount: number;
    missingRateCount: number;
    postedAmountFunctional: number;
    onboardingStatus: EngagementOnboardingStatus | null;
    engagementStatus: string | null;
    agreedTransactionsPerMonth: number | null;
    agreedRevenuePerYear: number | null;
    agreedRevenueCurrency: string | null;
    onboardingId: number | null;
    confirmBy: Date | string | null;
    canResend: boolean;
  }>;
  attention: Array<{
    kind: "pending_review" | "missing_rates" | "awaiting_signature" | "awaiting_confirmation" | "expired_onboarding" | "pending_invitation";
    label: string;
    clientId: number | null;
    onboardingId: number | null;
  }>;
};

export type FirmClientPracticeOverview = {
  clientId: number;
  clientName: string;
  firmId: number;
  ownershipStatus: string;
  engagementStatus: string | null;
  onboardingStatus: EngagementOnboardingStatus | null;
  onboardingId: number | null;
  confirmBy: Date | string | null;
  services: EngagementService[];
  startDate: string | null;
  endDate: string | null;
  feeNote: string | null;
  agreedTransactionsPerMonth: number | null;
  agreedRevenuePerYear: number | null;
  agreedRevenueCurrency: string | null;
  signedAt: Date | string | null;
  canResend: boolean;
  workspaceAccessible: boolean;
  ledgerActualsHidden: boolean;
  closeSnapshot: {
    period: string;
    currencies: string[];
    totalLines: number;
    pendingReview: number;
    postedAmount: number;
    completionPercent: number;
    functionalCurrency: string;
    postedAmountFunctional: number;
    missingRateCount: number;
    missingRateCurrencies: string[];
    journalCount: number;
  };
  monthlyPostedJournals: Array<{ month: string; postedCount: number }>;
  currentMonthPostedJournals: number;
  actualRevenuePerYear: number | null;
  revenuePeriod: string | null;
  revenueSource: "report_pack" | "live_statements" | "unavailable";
  missingRateCount: number;
};

export const getGetFirmOverviewQueryKey = (params?: { firmId?: number }) => ["/api/agaraccounting/firm-overview", params] as const;
export const getFirmOverview = (params: { firmId: number }, options?: Parameters<typeof customFetch>[1]) =>
  customFetch<FirmOverview>(`/api/agaraccounting/firm-overview?firmId=${params.firmId}`, options);
type QueryOptions<T> = Omit<UseQueryOptions<T>, "queryKey" | "queryFn"> & { queryKey?: QueryKey; enabled?: boolean };

export function useGetFirmOverview(params: { firmId: number }, options?: { query?: QueryOptions<FirmOverview> }) {
  const queryKey = options?.query?.queryKey ?? getGetFirmOverviewQueryKey(params);
  const query = useQuery({
    queryKey,
    queryFn: () => getFirmOverview(params),
    enabled: params.firmId > 0 && (options?.query?.enabled ?? true),
    ...options?.query,
  }) as UseQueryResult<FirmOverview> & { queryKey: QueryKey };
  query.queryKey = queryKey as QueryKey;
  return query;
}

export const getGetFirmClientPracticeOverviewQueryKey = (clientId: number, params?: { firmId?: number }) =>
  ["/api/agaraccounting/firm-clients", clientId, "practice-overview", params] as const;
export const getFirmClientPracticeOverview = (clientId: number, params: { firmId: number }, options?: Parameters<typeof customFetch>[1]) =>
  customFetch<FirmClientPracticeOverview>(`/api/agaraccounting/firm-clients/${clientId}/practice-overview?firmId=${params.firmId}`, options);
export function useGetFirmClientPracticeOverview(clientId: number, params: { firmId: number }, options?: { query?: QueryOptions<FirmClientPracticeOverview> }) {
  const queryKey = options?.query?.queryKey ?? getGetFirmClientPracticeOverviewQueryKey(clientId, params);
  const query = useQuery({
    queryKey,
    queryFn: () => getFirmClientPracticeOverview(clientId, params),
    enabled: clientId > 0 && params.firmId > 0 && (options?.query?.enabled ?? true),
    ...options?.query,
  }) as UseQueryResult<FirmClientPracticeOverview> & { queryKey: QueryKey };
  query.queryKey = queryKey as QueryKey;
  return query;
}

export const createEngagementOnboarding = (firmId: number, data: EngagementOnboardingInput, options?: Parameters<typeof customFetch>[1]) =>
  customFetch<EngagementOnboarding>(`/api/firms/${firmId}/engagement-onboardings`, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(data),
  });
export function useCreateEngagementOnboarding(options?: { mutation?: UseMutationOptions<EngagementOnboarding, ErrorType<unknown>, { firmId: number; data: EngagementOnboardingInput }> }) {
  return useMutation({
    mutationFn: ({ firmId, data }) => createEngagementOnboarding(firmId, data),
    ...options?.mutation,
  });
}

export const confirmEngagementOnboarding = (id: number, options?: Parameters<typeof customFetch>[1]) =>
  customFetch<EngagementOnboarding>(`/api/engagement-onboardings/${id}/confirm`, { ...options, method: "POST" });
export function useConfirmEngagementOnboarding(options?: { mutation?: UseMutationOptions<EngagementOnboarding, ErrorType<unknown>, { id: number }> }) {
  return useMutation({
    mutationFn: ({ id }) => confirmEngagementOnboarding(id),
    ...options?.mutation,
  });
}

export const revokeEngagementOnboarding = (id: number, options?: Parameters<typeof customFetch>[1]) =>
  customFetch<EngagementOnboarding>(`/api/engagement-onboardings/${id}/revoke`, { ...options, method: "POST" });
export function useRevokeEngagementOnboarding(options?: { mutation?: UseMutationOptions<EngagementOnboarding, ErrorType<unknown>, { id: number }> }) {
  return useMutation({
    mutationFn: ({ id }) => revokeEngagementOnboarding(id),
    ...options?.mutation,
  });
}

export const resendEngagementOnboarding = (id: number, options?: Parameters<typeof customFetch>[1]) =>
  customFetch<EngagementOnboarding>(`/api/engagement-onboardings/${id}/resend`, { ...options, method: "POST" });
export function useResendEngagementOnboarding(options?: { mutation?: UseMutationOptions<EngagementOnboarding, ErrorType<unknown>, { id: number }> }) {
  return useMutation({
    mutationFn: ({ id }) => resendEngagementOnboarding(id),
    ...options?.mutation,
  });
}

export const getGetEngagementContractInvitationQueryKey = (token: string) =>
  ["/api/organization-invitations", token, "engagement-contract"] as const;
export const getEngagementContractInvitation = (token: string, options?: Parameters<typeof customFetch>[1]) =>
  customFetch<EngagementContractPreview>(`/api/organization-invitations/${token}/engagement-contract`, options);
export function useGetEngagementContractInvitation(token: string, options?: { query?: QueryOptions<EngagementContractPreview> }) {
  const queryKey = options?.query?.queryKey ?? getGetEngagementContractInvitationQueryKey(token);
  const query = useQuery({
    queryKey,
    queryFn: () => getEngagementContractInvitation(token),
    enabled: Boolean(token) && (options?.query?.enabled ?? true),
    ...options?.query,
  }) as UseQueryResult<EngagementContractPreview> & { queryKey: QueryKey };
  query.queryKey = queryKey as QueryKey;
  return query;
}

export const signEngagementContractInvitation = (token: string, data: { signerName: string; accepted: boolean }, options?: Parameters<typeof customFetch>[1]) =>
  customFetch<EngagementOnboarding>(`/api/organization-invitations/${token}/engagement-contract`, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(data),
  });
export function useSignEngagementContractInvitation(options?: { mutation?: UseMutationOptions<EngagementOnboarding, ErrorType<unknown>, { token: string; data: { signerName: string; accepted: boolean } }> }) {
  return useMutation({
    mutationFn: ({ token, data }) => signEngagementContractInvitation(token, data),
    ...options?.mutation,
  });
}
