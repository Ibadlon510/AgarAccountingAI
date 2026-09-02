import * as zod from "zod";

const engagementService = zod.enum([
  "bookkeeping",
  "statement_review",
  "journals",
  "ifrs_pack",
  "uae_tax_estimate",
]);

const onboardingStatus = zod.enum(["draft", "sent", "signed", "confirmed", "expired", "revoked"]);

const contractTerms = zod.object({
  services: zod.array(engagementService),
  agreedTransactionsPerMonth: zod.number(),
  agreedRevenuePerYear: zod.number(),
  agreedRevenueCurrency: zod.string(),
  startDate: zod.string(),
  endDate: zod.string().nullable(),
  feeNote: zod.string().nullable(),
  termsText: zod.string(),
  firmLegalName: zod.string(),
  clientLegalName: zod.string(),
});

const engagementOnboarding = zod.object({
  id: zod.number(),
  engagementId: zod.number(),
  firmId: zod.number(),
  clientId: zod.number(),
  clientName: zod.string(),
  status: onboardingStatus,
  terms: contractTerms,
  signerEmail: zod.string(),
  signerName: zod.string().nullable(),
  signedAt: zod.union([zod.coerce.date(), zod.null()]),
  sentAt: zod.union([zod.coerce.date(), zod.null()]),
  confirmBy: zod.union([zod.coerce.date(), zod.null()]),
  confirmedAt: zod.union([zod.coerce.date(), zod.null()]),
  inviteExpiresAt: zod.union([zod.coerce.date(), zod.null()]),
  inviteLink: zod.string().optional(),
  pdfBase64: zod.string().optional(),
  emailDeliveryStatus: zod.enum(["sent", "failed"]).optional(),
});

export const GetFirmOverviewQueryParams = zod.object({
  firmId: zod.coerce.number(),
});

export const GetFirmOverviewResponse = zod.object({
  firmId: zod.number(),
  firmName: zod.string(),
  totals: zod.object({
    clientCount: zod.number(),
    pendingReviewClients: zod.number(),
    pendingReviewLines: zod.number(),
    missingRateClients: zod.number(),
    awaitingSignatureCount: zod.number(),
    awaitingConfirmationCount: zod.number(),
    expiredOnboardingCount: zod.number(),
    pendingInvitationCount: zod.number(),
  }),
  clients: zod.array(zod.object({
    id: zod.number(),
    name: zod.string(),
    period: zod.string(),
    ownershipStatus: zod.string(),
    functionalCurrency: zod.string(),
    completionPercent: zod.number(),
    pendingReview: zod.number(),
    totalLines: zod.number(),
    journalCount: zod.number(),
    missingRateCount: zod.number(),
    postedAmountFunctional: zod.number(),
    onboardingStatus: onboardingStatus.nullable(),
    engagementStatus: zod.string().nullable(),
    agreedTransactionsPerMonth: zod.number().nullable(),
    agreedRevenuePerYear: zod.number().nullable(),
    agreedRevenueCurrency: zod.string().nullable(),
    onboardingId: zod.number().nullable(),
    confirmBy: zod.union([zod.coerce.date(), zod.null()]),
    canResend: zod.boolean(),
  })),
  attention: zod.array(zod.object({
    kind: zod.enum([
      "pending_review",
      "missing_rates",
      "awaiting_signature",
      "awaiting_confirmation",
      "expired_onboarding",
      "pending_invitation",
    ]),
    label: zod.string(),
    clientId: zod.number().nullable(),
    onboardingId: zod.number().nullable(),
  })),
});

export const GetFirmClientPracticeOverviewParams = zod.object({
  clientId: zod.coerce.number(),
});

export const GetFirmClientPracticeOverviewQueryParams = zod.object({
  firmId: zod.coerce.number(),
});

export const GetFirmClientPracticeOverviewResponse = zod.object({
  clientId: zod.number(),
  clientName: zod.string(),
  firmId: zod.number(),
  ownershipStatus: zod.string(),
  engagementStatus: zod.string().nullable(),
  onboardingStatus: onboardingStatus.nullable(),
  onboardingId: zod.number().nullable(),
  confirmBy: zod.union([zod.coerce.date(), zod.null()]),
  services: zod.array(engagementService),
  startDate: zod.string().nullable(),
  endDate: zod.string().nullable(),
  feeNote: zod.string().nullable(),
  agreedTransactionsPerMonth: zod.number().nullable(),
  agreedRevenuePerYear: zod.number().nullable(),
  agreedRevenueCurrency: zod.string().nullable(),
  signedAt: zod.union([zod.coerce.date(), zod.null()]),
  canResend: zod.boolean(),
  workspaceAccessible: zod.boolean(),
  ledgerActualsHidden: zod.boolean(),
  closeSnapshot: zod.object({
    period: zod.string(),
    currencies: zod.array(zod.string()),
    totalLines: zod.number(),
    pendingReview: zod.number(),
    postedAmount: zod.number(),
    completionPercent: zod.number(),
    functionalCurrency: zod.string(),
    postedAmountFunctional: zod.number(),
    missingRateCount: zod.number(),
    missingRateCurrencies: zod.array(zod.string()),
    journalCount: zod.number(),
  }),
  monthlyPostedJournals: zod.array(zod.object({
    month: zod.string(),
    postedCount: zod.number(),
  })),
  currentMonthPostedJournals: zod.number(),
  actualRevenuePerYear: zod.number().nullable(),
  revenuePeriod: zod.string().nullable(),
  revenueSource: zod.enum(["report_pack", "live_statements", "unavailable"]),
  missingRateCount: zod.number(),
});

export const CreateEngagementOnboardingParams = zod.object({
  firmId: zod.coerce.number(),
});

export const CreateEngagementOnboardingBody = zod.object({
  name: zod.string(),
  legalName: zod.string(),
  functionalCurrency: zod.string(),
  basis: zod.string(),
  period: zod.string(),
  services: zod.array(engagementService),
  agreedTransactionsPerMonth: zod.number(),
  agreedRevenuePerYear: zod.number(),
  startDate: zod.string(),
  endDate: zod.string().nullable().optional(),
  feeNote: zod.string().nullable().optional(),
  termsText: zod.string(),
  signerEmail: zod.string(),
});

export const CreateEngagementOnboardingResponse = engagementOnboarding;
export const GetEngagementOnboardingParams = zod.object({
  id: zod.coerce.number(),
});
export const GetEngagementOnboardingResponse = engagementOnboarding;
export const ConfirmEngagementOnboardingParams = zod.object({
  id: zod.coerce.number(),
});
export const ConfirmEngagementOnboardingResponse = engagementOnboarding;
export const RevokeEngagementOnboardingParams = zod.object({
  id: zod.coerce.number(),
});
export const RevokeEngagementOnboardingResponse = engagementOnboarding;
export const ResendEngagementOnboardingParams = zod.object({
  id: zod.coerce.number(),
});
export const ResendEngagementOnboardingResponse = engagementOnboarding;
export const GetEngagementContractInvitationParams = zod.object({
  token: zod.string(),
});
export const GetEngagementContractInvitationResponse = zod.object({
  id: zod.number(),
  firmName: zod.string(),
  clientName: zod.string(),
  status: onboardingStatus,
  terms: contractTerms,
  signerEmail: zod.string(),
  pdfBase64: zod.string().optional(),
});
export const SignEngagementContractInvitationParams = zod.object({
  token: zod.string(),
});
export const SignEngagementContractInvitationBody = zod.object({
  signerName: zod.string(),
  accepted: zod.boolean(),
});
export const SignEngagementContractInvitationResponse = engagementOnboarding;
