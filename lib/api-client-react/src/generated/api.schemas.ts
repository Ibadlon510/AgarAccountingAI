export interface HealthStatus {
  status: string;
}

export interface Client {
  id: number;
  name: string;
  legalName: string;
  functionalCurrency: string;
  basis: string;
  period: string;
}

export interface ClientInput {
  name: string;
  legalName: string;
}

export interface ClientUpdateInput {
  name: string;
  legalName: string;
  functionalCurrency: string;
  basis: string;
  period: string;
}

export interface ExchangeRate {
  id: number;
  /**
     * @minLength 3
     * @maxLength 3
     */
  sourceCurrency: string;
  /**
     * @minLength 3
     * @maxLength 3
     */
  functionalCurrency: string;
  effectiveDate: string;
  /** @exclusiveMinimum 0 */
  rate: number;
  source: string;
  /** @nullable */
  note?: string | null;
}
export interface LedgerOverview {
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
}
export interface StatementLine {
  id: number;
  /** @nullable */
  bankAccountId?: number | null;
  date: string;
  description: string;
  currency: string;
  amount: number;
  direction: string;
  status: string;
  source: string;
  /** @nullable */
  accountSuggestion?: string | null;
  /** @nullable */
  confidence?: number | null;
  /** @nullable */
  functionalCurrency?: string | null;
  /** @nullable */
  functionalAmount?: number | null;
  /** @nullable */
  exchangeRate?: number | null;
  /** @nullable */
  exchangeRateEffectiveDate?: string | null;
  exchangeRateStatus?: string;
}

export interface StatementLineInput {
  clientId?: number;
  /** @nullable */
  bankAccountId?: number | null;
  date: string;
  description: string;
  currency: string;
  amount: number;
  direction: string;
}

export interface StatementImportInput {
  clientId: number;
  /** @nullable */
  bankAccountId?: number | null;
  fileName: string;
  mimeType: string;
  contentBase64: string;
  currency: string;
}

export type StatementImportResultImportStatus = typeof StatementImportResultImportStatus[keyof typeof StatementImportResultImportStatus];
export interface BankAccount {
  id: number;
  clientId: number;
  name: string;
  /** @nullable */
  bankName?: string | null;
  /** @nullable */
  accountNumberLast4?: string | null;
  currency: string;
}

export interface StatementImportResult {
  fileName: string;
  importStatus: StatementImportResultImportStatus;
  message?: string;
  importedCount: number;
  duplicateCount: number;
  duplicateLines: StatementImportDuplicate[];
  lines: StatementLine[];
  bankAccount?: BankAccount | null;
}

export interface BankAccountInput {
  clientId: number;
  /** @minLength 1 */
  name: string;
  /** @nullable */
  bankName?: string | null;
  /**
     * @nullable
     * @pattern ^[0-9]{4}$
     */
  accountNumberLast4?: string | null;
  /**
     * @minLength 3
     * @maxLength 3
     */
  currency: string;
}

export interface ApproveJournalEntryInput {
  clientId: number;
}

export interface AIChatInput {
  clientId: number;
  message: string;
}

export type AIChatResponseContext = {
  clientName: string;
  pendingLines: number;
  postedLines: number;
};

export type AICopilotRecommendationType = typeof AICopilotRecommendationType[keyof typeof AICopilotRecommendationType];


export const AICopilotRecommendationType = {
  next_step: 'next_step',
  review_group: 'review_group',
  recode_lines: 'recode_lines',
  create_bank_account: 'create_bank_account',
  bulk_approve_entries: 'bulk_approve_entries',
  bulk_post_entries: 'bulk_post_entries',
} as const;
export interface BankAccountDraft {
  name: string;
  /** @nullable */
  bankName?: string | null;
  /**
     * @nullable
     * @pattern ^[0-9]{4}$
     */
  accountNumberLast4?: string | null;
  currency: string;
}

export type AICopilotRecommendationStatusTransition = {
  from: string;
  to: string;
};

export interface AICopilotRecommendation {
  id: string;
  clientId: number;
  type: AICopilotRecommendationType;
  title: string;
  summary: string;
  lineIds?: number[];
  entryIds?: number[];
  statementLineIds?: number[];
  entryCount?: number;
  lineCount?: number;
  fromStatus?: string;
  toStatus?: string;
  statusTransition?: AICopilotRecommendationStatusTransition;
  /** @nullable */
  accountSuggestion?: string | null;
  /** @nullable */
  confidence?: number | null;
  bankAccount?: BankAccountDraft | null;
  requiresConfirmation: boolean;
}

export interface AIChatResponse {
  answer: string;
  recommendations: AICopilotRecommendation[];
  context: AIChatResponseContext;
}

export type AIProvider = typeof AIProvider[keyof typeof AIProvider];
export type AICopilotActionInputType = typeof AICopilotActionInputType[keyof typeof AICopilotActionInputType];


export const AICopilotActionInputType = {
  recode_lines: 'recode_lines',
  create_bank_account: 'create_bank_account',
  bulk_approve_entries: 'bulk_approve_entries',
  bulk_post_entries: 'bulk_post_entries',
} as const;

export interface AICopilotActionInput {
  clientId: number;
  type: AICopilotActionInputType;
  /** @maxItems 100 */
  lineIds?: number[];
  /** @maxItems 100 */
  entryIds?: number[];
  /** @maxItems 100 */
  statementLineIds?: number[];
  /** @nullable */
  accountSuggestion?: string | null;
  /** @nullable */
  confidence?: number | null;
  bankAccount?: BankAccountDraft | null;
}

export interface JournalLine {
  account: string;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  id: number;
  statementLineId: number;
  date: string;
  memo: string;
  currency: string;
  status: string;
  confidence: number;
  lines: JournalLine[];
  /** @nullable */
  functionalCurrency?: string | null;
  /** @nullable */
  functionalAmount?: number | null;
  /** @nullable */
  exchangeRate?: number | null;
  /** @nullable */
  exchangeRateEffectiveDate?: string | null;
  exchangeRateStatus?: string;
}

export interface AICopilotActionResult {
  type: string;
  clientId?: number;
  entryIds?: number[];
  statementLineIds?: number[];
  entryCount?: number;
  lineCount?: number;
  fromStatus?: string;
  toStatus?: string;
  entries?: JournalEntry[];
  updatedLineCount: number;
  bankAccount: BankAccount | null;
}

export type BulkTransitionAuditTransition = typeof BulkTransitionAuditTransition[keyof typeof BulkTransitionAuditTransition];
export interface TrialBalanceRow {
  account: string;
  category: string;
  debit: number;
  credit: number;
  balance: number;
  functionalCurrency: string;
  missingRateCount: number;
  missingRateCurrencies: string[];
}

export interface StatementSection {
  label: string;
  amount: number;
  children?: StatementSection[];
}

export interface FinancialStatements {
  period: string;
  functionalCurrency: string;
  missingRateCount: number;
  missingRateCurrencies: string[];
  incomeStatement: StatementSection[];
  balanceSheet: StatementSection[];
  cashFlow: StatementSection[];
}

export type BeginBrowserLoginParams = {
returnTo?: string;
};
export type GetLedgerOverviewParams = {
clientId?: number;
};

export type GetBankAccountsParams = {
clientId: number;
};

export type GetStatementLinesParams = {
clientId?: number;
currency?: string;
status?: string;
};

export type GetBulkTransitionAuditsParams = {
clientId?: number;
};

export type GetLedgerflowAISettingsParams = {
clientId: number;
};
export type GetJournalEntriesParams = {
clientId?: number;
};

export type GetTrialBalanceParams = {
clientId?: number;
};

export type GetFinancialStatementsParams = {
clientId?: number;
period?: string;
};
/**
 * Generated by orval v8.23.0 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
export interface AuthUser {
  id: string;
  /** @nullable */
  email: string | null;
  /** @nullable */
  firstName: string | null;
  /** @nullable */
  lastName: string | null;
  /** @nullable */
  profileImageUrl: string | null;
}
export interface MobileTokenExchangeRequest {
  /** @minLength 1 */
  code: string;
  /** @minLength 1 */
  code_verifier: string;
  /** @minLength 1 */
  redirect_uri: string;
  /** @minLength 1 */
  state: string;
  /** @minLength 1 */
  nonce?: string;
}

export interface MobileTokenExchangeSuccess {
  token: string;
}
export type LogoutSuccess = typeof LogoutSuccessValue;
export type LogoutBrowserSessionParams = {
returnTo?: string;
};
export interface AuthUserEnvelope {
  user: AuthUser | null;
}
export const LogoutSuccessValue = {
  success: true,
} as const;
export interface StatementImportDuplicate {
  date: string;
  description: string;
  currency: string;
  amount: number;
  direction: string;
  /** @nullable */
  existingLineId: number | null;
  reason: StatementImportDuplicateReason;
}
export type StatementImportDuplicateReason = typeof StatementImportDuplicateReason[keyof typeof StatementImportDuplicateReason];


export const StatementImportDuplicateReason = {
  already_imported: 'already_imported',
  duplicate_in_file: 'duplicate_in_file',
} as const;
export const StatementImportResultImportStatus = {
  imported: 'imported',
  imported_with_duplicates: 'imported_with_duplicates',
  duplicates_found: 'duplicates_found',
  duplicate_file: 'duplicate_file',
} as const;

export const BulkTransitionAuditTransition = {
  bulk_approve_entries: 'bulk_approve_entries',
  bulk_post_entries: 'bulk_post_entries',
} as const;

export const AIProvider = {
  managed_openai: 'managed_openai',
  openai: 'openai',
  anthropic: 'anthropic',
} as const;

export type AICredentialStatus = typeof AICredentialStatus[keyof typeof AICredentialStatus];
export interface AIProviderSettingsTestInput {
  clientId: number;
}
export interface AIProviderSettingsInput {
  clientId: number;
  provider: AIProvider;
  model: string;
  /** @minLength 1 */
  apiKey?: string;
}
export const AICredentialStatus = {
  not_configured: 'not_configured',
  configured: 'configured',
  invalid: 'invalid',
  unavailable: 'unavailable',
} as const;

export interface AIProviderSettings {
  clientId: number;
  provider: AIProvider;
  model: string;
  credentialStatus: AICredentialStatus;
  /**
     * Last four characters only; never the API credential.
     * @nullable
     */
  credentialLast4: string | null;
  /** @nullable */
  credentialUpdatedAt: string | null;
  /** @nullable */
  lastTestedAt: string | null;
  availableModels: string[];
}

export interface BulkTransitionAuditActor {
  id: string;
  name: string;
  /** @nullable */
  email: string | null;
}

export interface BulkTransitionAudit {
  id: number;
  clientId: number;
  actor: BulkTransitionAuditActor;
  transition: BulkTransitionAuditTransition;
  fromStatus: string;
  toStatus: string;
  entryIds: number[];
  statementLineIds: number[];
  confirmedAt: string;
}

export interface ExchangeRateUpdate {
  /**
     * @minLength 3
     * @maxLength 3
     */
  sourceCurrency: string;
  /**
     * @minLength 3
     * @maxLength 3
     */
  functionalCurrency: string;
  effectiveDate: string;
  /** @exclusiveMinimum 0 */
  rate: number;
  source?: string;
  /** @nullable */
  note?: string | null;
}

export interface ExchangeRateInput {
  /**
     * @minLength 3
     * @maxLength 3
     */
  sourceCurrency: string;
  /**
     * @minLength 3
     * @maxLength 3
     */
  functionalCurrency: string;
  effectiveDate: string;
  /** @exclusiveMinimum 0 */
  rate: number;
  source?: string;
  /** @nullable */
  note?: string | null;
}

export interface ExchangeRateImportInput {
  /** @minItems 1 */
  rates: ExchangeRateInput[];
}

export interface ExchangeRateImportResult {
  importedCount: number;
  updatedCount: number;
  rates: ExchangeRate[];
}
