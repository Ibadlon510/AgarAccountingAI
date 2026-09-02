import { bigint, boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey(),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  starterClientId: integer("starter_client_id"),
  remediatedLegacyClientId: integer("remediated_legacy_client_id"),
  onboardingMode: text("onboarding_mode"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const firmProfilesTable = pgTable("agaraccounting_firm_profiles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  firmCode: varchar("firm_code", { length: 8 }),
  ownerUserId: varchar("owner_user_id").notNull(),
  name: text("name").notNull(),
  legalName: text("legal_name").notNull(),
  profileKind: text("profile_kind").notNull().default("accounting_firm"),
  systemRatesEnabled: boolean("system_rates_enabled").notNull().default(true),
  reportAttributionEnabled: boolean("report_attribution_enabled").notNull().default(false),
  slug: text("slug"),
  logoObjectPath: text("logo_object_path"),
  landingHeadline: text("landing_headline"),
  landingTagline: text("landing_tagline"),
  landingEnabled: boolean("landing_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("agaraccounting_firm_profiles_owner_kind_idx").on(table.ownerUserId, table.profileKind),
  uniqueIndex("agaraccounting_firm_profiles_firm_code_uidx").on(table.firmCode),
  uniqueIndex("agaraccounting_firm_profiles_slug_uidx").on(table.slug),
  foreignKey({
    columns: [table.ownerUserId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_firm_profiles_owner_user_fk",
  }).onDelete("cascade"),
  check("agaraccounting_firm_profiles_kind_check", sql`profile_kind in ('accounting_firm', 'internal_rate_container')`),
]);

export const firmMembershipsTable = pgTable("agaraccounting_firm_memberships", {
  firmId: integer("firm_id").notNull(),
  userId: varchar("user_id").notNull(),
  role: text("role").notNull().default("accountant"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("agaraccounting_firm_memberships_firm_user_idx").on(table.firmId, table.userId),
  index("agaraccounting_firm_memberships_user_role_idx").on(table.userId, table.role),
  check("agaraccounting_firm_memberships_role_check", sql`role in ('owner', 'admin', 'accountant', 'bookkeeper')`),
  check("agaraccounting_firm_memberships_status_check", sql`status in ('active', 'revoked')`),
  foreignKey({
    columns: [table.firmId],
    foreignColumns: [firmProfilesTable.id],
    name: "agaraccounting_firm_memberships_firm_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.userId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_firm_memberships_user_fk",
  }).onDelete("cascade"),
]);

export const clientsTable = pgTable("agaraccounting_clients", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  firmId: integer("firm_id"),
  rateProfileId: integer("rate_profile_id"),
  ownerUserId: varchar("owner_user_id"),
  ownershipStatus: text("ownership_status").notNull().default("company_owned"),
  subscriptionLiableParty: text("subscription_liable_party").notNull().default("company"),
  name: text("name").notNull(),
  legalName: text("legal_name").notNull(),
  functionalCurrency: text("functional_currency").notNull().default("AED"),
  basis: text("basis").notNull().default("IFRS"),
  period: text("period").notNull().default("August 2026"),
  systemRatesEnabled: boolean("system_rates_enabled").notNull().default(true),
  reportSystemBrandingEnabled: boolean("report_system_branding_enabled").notNull().default(true),
  shareCapitalAuthorisedShares: integer("share_capital_authorised_shares"),
  shareCapitalParValue: numeric("share_capital_par_value", { precision: 14, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  transferredAt: timestamp("transferred_at", { withTimezone: true }),
}, (table) => [
  index("agaraccounting_clients_firm_idx").on(table.firmId),
  index("agaraccounting_clients_rate_profile_idx").on(table.rateProfileId),
  index("agaraccounting_clients_owner_idx").on(table.ownerUserId),
  check("agaraccounting_clients_ownership_status_check", sql`ownership_status in ('company_owned', 'firm_provisional')`),
  check("agaraccounting_clients_subscription_liable_party_check", sql`subscription_liable_party in ('company', 'firm')`),
  foreignKey({
    columns: [table.firmId],
    foreignColumns: [firmProfilesTable.id],
    name: "agaraccounting_clients_firm_fk",
  }),
  foreignKey({
    columns: [table.rateProfileId],
    foreignColumns: [firmProfilesTable.id],
    name: "agaraccounting_clients_rate_profile_fk",
  }),
  foreignKey({
    columns: [table.ownerUserId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_clients_owner_user_fk",
  }),
]);

export const shareholdersTable = pgTable("agaraccounting_shareholders", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  name: text("name").notNull(),
  nationality: text("nationality"),
  numberOfShares: integer("number_of_shares").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("agaraccounting_shareholders_client_idx").on(table.clientId, table.sortOrder, table.id),
  foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "agaraccounting_shareholders_client_fk",
  }).onDelete("cascade"),
]);

export const clientWorkspacesTable = pgTable(
  "agaraccounting_client_workspaces",
  {
    clientId: integer("client_id").notNull(),
    userId: varchar("user_id").notNull(),
    role: text("role").notNull().default("admin"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agaraccounting_client_workspaces_client_user_idx").on(table.clientId, table.userId),
    index("agaraccounting_client_workspaces_user_role_idx").on(table.userId, table.role),
    check("agaraccounting_client_workspaces_role_check", sql`role in ('owner', 'admin', 'accountant', 'bookkeeper')`),
    foreignKey({
      columns: [table.clientId],
      foreignColumns: [clientsTable.id],
      name: "agaraccounting_client_workspaces_client_fk",
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [usersTable.id],
      name: "agaraccounting_client_workspaces_user_fk",
    }),
  ],
);

export const firmCompanyEngagementsTable = pgTable("agaraccounting_firm_company_engagements", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  firmId: integer("firm_id").notNull(),
  clientId: integer("client_id").notNull(),
  status: text("status").notNull().default("active"),
  invitedByUserId: varchar("invited_by_user_id").notNull(),
  acceptedByUserId: varchar("accepted_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("agaraccounting_firm_company_engagements_pair_idx").on(table.firmId, table.clientId),
  index("agaraccounting_firm_company_engagements_client_status_idx").on(table.clientId, table.status),
  check("agaraccounting_firm_company_engagements_status_v2_check", sql`status in ('provisional', 'active', 'revoked', 'expired')`),
  foreignKey({
    columns: [table.firmId],
    foreignColumns: [firmProfilesTable.id],
    name: "agaraccounting_firm_company_engagements_firm_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "agaraccounting_firm_company_engagements_client_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.invitedByUserId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_firm_company_engagements_inviter_fk",
  }),
  foreignKey({
    columns: [table.acceptedByUserId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_firm_company_engagements_accepter_fk",
  }),
]);

export const firmEngagementMembersTable = pgTable("agaraccounting_firm_engagement_members", {
  engagementId: integer("engagement_id").notNull(),
  userId: varchar("user_id").notNull(),
  role: text("role").notNull().default("bookkeeper"),
  status: text("status").notNull().default("nominated"),
  nominatedByUserId: varchar("nominated_by_user_id").notNull(),
  approvedByUserId: varchar("approved_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  previousWorkspaceRole: text("previous_workspace_role"),
}, (table) => [
  uniqueIndex("agaraccounting_firm_engagement_members_engagement_user_idx").on(table.engagementId, table.userId),
  index("agaraccounting_firm_engagement_members_user_status_idx").on(table.userId, table.status),
  check("agaraccounting_firm_engagement_members_role_check", sql`role in ('accountant', 'bookkeeper')`),
  check("agaraccounting_firm_engagement_members_status_check", sql`status in ('nominated', 'approved', 'revoked')`),
  foreignKey({
    columns: [table.engagementId],
    foreignColumns: [firmCompanyEngagementsTable.id],
    name: "agaraccounting_firm_engagement_members_engagement_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.userId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_firm_engagement_members_user_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.nominatedByUserId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_firm_engagement_members_nominator_fk",
  }),
  foreignKey({
    columns: [table.approvedByUserId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_firm_engagement_members_approver_fk",
  }),
]);

export const organizationInvitationsTable = pgTable("agaraccounting_organization_invitations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  kind: text("kind").notNull(),
  clientId: integer("client_id"),
  firmId: integer("firm_id"),
  email: varchar("email").notNull(),
  role: text("role"),
  invitedByUserId: varchar("invited_by_user_id").notNull(),
  tokenHash: varchar("token_hash").notNull().unique(),
  status: text("status").notNull().default("pending"),
  acceptedUserId: varchar("accepted_user_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("agaraccounting_organization_invitations_email_status_idx").on(table.email, table.status),
  index("agaraccounting_organization_invitations_client_idx").on(table.clientId),
  check("agaraccounting_organization_invitations_kind_v2_check", sql`kind in ('firm_member', 'firm_engagement', 'company_transfer', 'engagement_contract')`),
  check("agaraccounting_organization_invitations_role_check", sql`role is null or role in ('admin', 'accountant', 'bookkeeper')`),
  check("agaraccounting_organization_invitations_status_check", sql`status in ('pending', 'accepted', 'revoked', 'expired')`),
  foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "agaraccounting_organization_invitations_client_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.firmId],
    foreignColumns: [firmProfilesTable.id],
    name: "agaraccounting_organization_invitations_firm_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.invitedByUserId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_organization_invitations_inviter_fk",
  }),
  foreignKey({
    columns: [table.acceptedUserId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_organization_invitations_accepter_fk",
  }),
]);

export const engagementContractsTable = pgTable("agaraccounting_engagement_contracts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  engagementId: integer("engagement_id").notNull(),
  firmId: integer("firm_id").notNull(),
  clientId: integer("client_id").notNull(),
  invitationId: integer("invitation_id"),
  status: text("status").notNull().default("draft"),
  services: jsonb("services").$type<string[]>().notNull(),
  agreedTransactionsPerMonth: integer("agreed_transactions_per_month").notNull(),
  agreedRevenuePerYear: numeric("agreed_revenue_per_year", { precision: 14, scale: 2 }).notNull(),
  agreedRevenueCurrency: varchar("agreed_revenue_currency", { length: 3 }).notNull(),
  revenueCoverageStartDate: date("revenue_coverage_start_date", { mode: "string" }),
  revenueCoverageEndDate: date("revenue_coverage_end_date", { mode: "string" }),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }),
  feeNote: text("fee_note"),
  termsText: text("terms_text").notNull(),
  firmLegalName: text("firm_legal_name").notNull(),
  clientLegalName: text("client_legal_name").notNull(),
  signerEmail: varchar("signer_email").notNull(),
  signerName: text("signer_name"),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  confirmBy: timestamp("confirm_by", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedByUserId: varchar("confirmed_by_user_id"),
  pdfObjectPath: text("pdf_object_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("agaraccounting_engagement_contracts_engagement_idx").on(table.engagementId),
  index("agaraccounting_engagement_contracts_firm_status_idx").on(table.firmId, table.status),
  index("agaraccounting_engagement_contracts_client_idx").on(table.clientId),
  check("agaraccounting_engagement_contracts_status_check", sql`status in ('draft', 'sent', 'signed', 'confirmed', 'expired', 'revoked')`),
  foreignKey({
    columns: [table.engagementId],
    foreignColumns: [firmCompanyEngagementsTable.id],
    name: "agaraccounting_engagement_contracts_engagement_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.firmId],
    foreignColumns: [firmProfilesTable.id],
    name: "agaraccounting_engagement_contracts_firm_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "agaraccounting_engagement_contracts_client_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.invitationId],
    foreignColumns: [organizationInvitationsTable.id],
    name: "agaraccounting_engagement_contracts_invitation_fk",
  }),
  foreignKey({
    columns: [table.confirmedByUserId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_engagement_contracts_confirmer_fk",
  }),
]);

export const workspaceInvitationsTable = pgTable(
  "agaraccounting_workspace_invitations",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    email: varchar("email").notNull(),
    role: text("role").notNull().default("bookkeeper"),
    clientIds: integer("client_ids").array().notNull(),
    invitedByUserId: varchar("invited_by_user_id").notNull(),
    tokenHash: varchar("token_hash").notNull().unique(),
    status: text("status").notNull().default("pending"),
    acceptedUserId: varchar("accepted_user_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("agaraccounting_workspace_invitations_email_status_idx").on(table.email, table.status),
    index("agaraccounting_workspace_invitations_inviter_idx").on(table.invitedByUserId),
    check("agaraccounting_workspace_invitations_role_check", sql`role in ('admin', 'bookkeeper')`),
    check("agaraccounting_workspace_invitations_status_check", sql`status in ('pending', 'accepted', 'revoked', 'expired')`),
    foreignKey({
      columns: [table.invitedByUserId],
      foreignColumns: [usersTable.id],
      name: "agaraccounting_workspace_invitations_inviter_fk",
    }),
    foreignKey({
      columns: [table.acceptedUserId],
      foreignColumns: [usersTable.id],
      name: "agaraccounting_workspace_invitations_accepted_user_fk",
    }),
  ],
);
export const exchangeRatesTable = pgTable("agaraccounting_exchange_rates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull(),
  firmId: integer("firm_id"),
  sourceCurrency: varchar("source_currency", { length: 3 }).notNull(),
  functionalCurrency: varchar("functional_currency", { length: 3 }).notNull(),
  effectiveDate: date("effective_date", { mode: "string" }).notNull(),
  rate: numeric("rate", { precision: 20, scale: 10 }).notNull(),
  source: text("source").notNull().default("Manual"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  userCurrencyDateUnique: uniqueIndex("agaraccounting_exchange_rates_user_pair_date_idx")
    .on(table.userId, table.sourceCurrency, table.functionalCurrency, table.effectiveDate),
  userLookupIdx: index("agaraccounting_exchange_rates_user_lookup_idx")
    .on(table.userId, table.sourceCurrency, table.functionalCurrency, table.effectiveDate),
  firmCurrencyDateUnique: uniqueIndex("agaraccounting_exchange_rates_firm_pair_date_idx")
    .on(table.firmId, table.sourceCurrency, table.functionalCurrency, table.effectiveDate),
  firmLookupIdx: index("agaraccounting_exchange_rates_firm_lookup_idx")
    .on(table.firmId, table.sourceCurrency, table.functionalCurrency, table.effectiveDate),
  firmForeignKey: foreignKey({
    columns: [table.firmId],
    foreignColumns: [firmProfilesTable.id],
    name: "agaraccounting_exchange_rates_firm_fk",
  }),
}));

export const systemRateAdminsTable = pgTable("agaraccounting_system_rate_admins", {
  userId: varchar("user_id").primaryKey(),
  grantedByUserId: varchar("granted_by_user_id"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  index("agaraccounting_system_rate_admins_status_idx").on(table.status),
  check("agaraccounting_system_rate_admins_status_check", sql`status in ('active', 'revoked')`),
  foreignKey({
    columns: [table.userId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_system_rate_admins_user_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.grantedByUserId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_system_rate_admins_granted_by_fk",
  }),
]);

export const systemRateAdminBootstrapStateTable = pgTable("agaraccounting_system_rate_admin_bootstrap_state", {
  id: integer("id").primaryKey(),
  closedByUserId: varchar("closed_by_user_id"),
  reason: text("reason").notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("agaraccounting_system_rate_admin_bootstrap_singleton_check", sql`${table.id} = 1`),
  check("agaraccounting_system_rate_admin_bootstrap_reason_check", sql`${table.reason} in ('initial_claim', 'explicit_grant', 'existing_admin')`),
]);

export const aiProviderConfigsTable = pgTable("agaraccounting_ai_provider_configs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  provider: text("provider").notNull().default("managed_openai"),
  model: text("model").notNull().default("gpt-5.6-luna"),
  credentialStatus: text("credential_status").notNull().default("not_configured"),
  encryptedCredential: text("encrypted_credential"),
  credentialLast4: text("credential_last4"),
  credentialUpdatedAt: timestamp("credential_updated_at", { withTimezone: true }),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  clientUnique: uniqueIndex("agaraccounting_ai_provider_configs_client_idx").on(table.clientId),
}));

export const aiModelCatalogTable = pgTable("agaraccounting_ai_model_catalog", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  displayName: text("display_name").notNull(),
  inputCostPerMillionUsd: numeric("input_cost_per_million_usd", { precision: 12, scale: 6 }),
  outputCostPerMillionUsd: numeric("output_cost_per_million_usd", { precision: 12, scale: 6 }),
  status: text("status").notNull().default("active"),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  providerModelUnique: uniqueIndex("agaraccounting_ai_model_catalog_provider_model_idx").on(table.provider, table.model),
}));
export const bankAccountsTable = pgTable("agaraccounting_bank_accounts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  name: text("name").notNull(),
  bankName: text("bank_name"),
  accountNumberLast4: text("account_number_last4"),
  currency: text("currency").notNull().default("AED"),
  identityKey: text("identity_key"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  identityKeyUnique: uniqueIndex("agaraccounting_bank_accounts_identity_key_idx").on(table.identityKey),
  clientForeignKey: foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "agaraccounting_bank_accounts_client_fk",
  }),
}));

export const statementImportsTable = pgTable("agaraccounting_statement_imports", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  bankAccountId: integer("bank_account_id"),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  objectPath: text("object_path"),
  fileSize: integer("file_size"),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull().default(0),
  evidenceObjectPath: text("evidence_object_path"),
  evidenceExpiresAt: timestamp("evidence_expires_at"),
  fileHash: text("file_hash").notNull(),
  outcome: text("outcome").notNull().default("completed"),
  detectedCurrency: text("detected_currency"),
  errorMessage: text("error_message"),
  previewData: jsonb("preview_data").$type<Record<string, unknown> | null>(),
  importedLineCount: integer("imported_line_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  clientCompletedFileHashUnique: uniqueIndex("agaraccounting_statement_imports_client_file_hash_idx")
    .on(table.clientId, table.fileHash)
    .where(sql`outcome = 'completed'`),
  clientActiveFileHashUnique: uniqueIndex("agaraccounting_statement_imports_active_file_hash_idx")
    .on(table.clientId, table.fileHash)
    .where(sql`outcome in ('analyzing', 'pending_confirmation')`),
  clientForeignKey: foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "agaraccounting_statement_imports_client_fk",
  }),
  bankAccountForeignKey: foreignKey({
    columns: [table.bankAccountId],
    foreignColumns: [bankAccountsTable.id],
    name: "agaraccounting_statement_imports_bank_account_fk",
  }),
  outcomeCheck: check(
    "agaraccounting_statement_imports_outcome_v4_check",
    sql`outcome in ('analyzing', 'pending_confirmation', 'completed', 'duplicate', 'failed', 'undone')`,
  ),
}));

export const aiActivityTable = pgTable("agaraccounting_ai_activity", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  userId: varchar("user_id").notNull(),
  activityType: text("activity_type").notNull(),
  model: text("model").notNull(),
  provider: text("provider").notNull().default("unknown"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 14, scale: 8 }),
  billingSource: text("billing_source").notNull().default("unknown"),
  status: text("status").notNull().default("completed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("agaraccounting_ai_activity_client_created_idx").on(table.clientId, table.createdAt),
  index("agaraccounting_ai_activity_user_created_idx").on(table.userId, table.createdAt),
  foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "agaraccounting_ai_activity_client_fk",
  }),
  foreignKey({
    columns: [table.userId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_ai_activity_user_fk",
  }),
]);

export const assistantThreadsTable = pgTable("agaraccounting_assistant_threads", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull().default("New conversation"),
  scope: jsonb("scope").notNull().default({}),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("agaraccounting_assistant_threads_client_user_updated_idx").on(table.clientId, table.userId, table.updatedAt),
  foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "agaraccounting_assistant_threads_client_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.userId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_assistant_threads_user_fk",
  }).onDelete("cascade"),
  check("agaraccounting_assistant_threads_status_check", sql`status in ('active', 'cleared')`),
]);

export const assistantTurnsTable = pgTable("agaraccounting_assistant_turns", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  threadId: integer("thread_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  response: jsonb("response"),
  attachment: jsonb("attachment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("agaraccounting_assistant_turns_thread_created_idx").on(table.threadId, table.createdAt),
  foreignKey({
    columns: [table.threadId],
    foreignColumns: [assistantThreadsTable.id],
    name: "agaraccounting_assistant_turns_thread_fk",
  }).onDelete("cascade"),
  check("agaraccounting_assistant_turns_role_check", sql`role in ('user', 'assistant')`),
]);
export const statementLinesTable = pgTable("agaraccounting_statement_lines", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  statementImportId: integer("statement_import_id"),
  bankAccountId: integer("bank_account_id"),
  date: text("date").notNull(),
  description: text("description").notNull(),
  currency: text("currency").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  direction: text("direction").notNull(),
  status: text("status").notNull().default("draft"),
  source: text("source").notNull().default("Bank statement"),
  accountSuggestion: text("account_suggestion"),
  contactId: integer("contact_id"),
  contactSuggestionEvidenceCount: integer("contact_suggestion_evidence_count"),
  proposedContactName: text("proposed_contact_name"),
  proposedContactType: text("proposed_contact_type"),
  proposedContactAlias: text("proposed_contact_alias"),
  proposedContactConfidence: numeric("proposed_contact_confidence", { precision: 5, scale: 2 }),
  proposedContactSource: text("proposed_contact_source"),
  contactReviewDisposition: text("contact_review_disposition").notNull().default("pending"),
  accountClassificationId: integer("account_classification_id"),
  confidence: numeric("confidence", { precision: 5, scale: 2 }),
  importDedupeKey: text("import_dedupe_key"),
  functionalCurrency: varchar("functional_currency", { length: 3 }),
  functionalAmount: numeric("functional_amount", { precision: 14, scale: 2 }),
  exchangeRate: numeric("exchange_rate", { precision: 20, scale: 10 }),
  exchangeRateEffectiveDate: date("exchange_rate_effective_date", { mode: "string" }),
  exchangeRateSourceScope: text("exchange_rate_source_scope").notNull().default("none"),
  exchangeRateStatus: text("exchange_rate_status").notNull().default("not_required"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  importDedupeKeyUnique: uniqueIndex("agaraccounting_statement_lines_import_dedupe_key_idx").on(table.importDedupeKey),
  idClientUnique: uniqueIndex("agaraccounting_statement_lines_id_client_idx").on(table.id, table.clientId),
  statementImportIndex: index("agaraccounting_statement_lines_import_idx").on(table.statementImportId),
  clientDateIdx: index("agaraccounting_statement_lines_client_date_idx").on(table.clientId, table.date),
  clientStatusIdx: index("agaraccounting_statement_lines_client_status_idx").on(table.clientId, table.status),
  clientBankDateIdx: index("agaraccounting_statement_lines_client_bank_date_idx").on(table.clientId, table.bankAccountId, table.date),
  proposedContactTypeCheck: check(
    "agaraccounting_statement_lines_proposed_contact_type_check",
    sql`${table.proposedContactType} is null or ${table.proposedContactType} in ('customer', 'supplier', 'both')`,
  ),
  contactReviewDispositionCheck: check(
    "agaraccounting_statement_lines_contact_review_disposition_check",
    sql`${table.contactReviewDisposition} in ('pending', 'accepted', 'replaced', 'dismissed')`,
  ),
  statusCheck: check(
    "agaraccounting_statement_lines_lifecycle_compat_check",
    // Legacy non-posted values remain valid for publish compatibility. The API
    // exposes all of them as draft, and every new write uses draft or posted.
    sql`${table.status} in ('draft', 'posted', 'suggested', 'approved', 'needs_review')`,
  ),
  proposedContactShapeCheck: check(
    "agaraccounting_statement_lines_proposed_contact_shape_check",
    sql`(
      (${table.proposedContactName} is null and ${table.proposedContactType} is null and ${table.proposedContactAlias} is null)
      or
      (${table.proposedContactName} is not null and ${table.proposedContactType} is not null and ${table.proposedContactAlias} is not null)
    )`,
  ),
  proposedContactConfidenceCheck: check(
    "agaraccounting_statement_lines_proposed_contact_confidence_check",
    sql`${table.proposedContactConfidence} is null or (${table.proposedContactConfidence} >= 0 and ${table.proposedContactConfidence} <= 1)`,
  ),
  linkedContactProposalCheck: check(
    "agaraccounting_statement_lines_linked_contact_proposal_check",
    sql`${table.contactId} is null or (
      ${table.proposedContactName} is null
      and ${table.proposedContactType} is null
      and ${table.proposedContactAlias} is null
      and ${table.proposedContactConfidence} is null
      and ${table.proposedContactSource} is null
    )`,
  ),
  clientForeignKey: foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "agaraccounting_statement_lines_client_fk",
  }),
  bankAccountForeignKey: foreignKey({
    columns: [table.bankAccountId],
    foreignColumns: [bankAccountsTable.id],
    name: "agaraccounting_statement_lines_bank_account_fk",
  }),
  statementImportForeignKey: foreignKey({
    columns: [table.statementImportId],
    foreignColumns: [statementImportsTable.id],
    name: "agaraccounting_statement_lines_import_fk",
  }),
}));

export const journalEntriesTable = pgTable("agaraccounting_journal_entries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  statementLineId: integer("statement_line_id"),
  date: text("date").notNull(),
  memo: text("memo").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull().default("draft"),
  confidence: numeric("confidence", { precision: 5, scale: 2 }).notNull(),
  debitAccount: text("debit_account").notNull(),
  creditAccount: text("credit_account").notNull(),
  debitAccountClassificationId: integer("debit_account_classification_id"),
  creditAccountClassificationId: integer("credit_account_classification_id"),
  contactId: integer("contact_id"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  lines: jsonb("lines").$type<Array<{ description: string; account: string; debit: number; credit: number }>>(),
  functionalCurrency: varchar("functional_currency", { length: 3 }),
  functionalAmount: numeric("functional_amount", { precision: 14, scale: 2 }),
  exchangeRate: numeric("exchange_rate", { precision: 20, scale: 10 }),
  exchangeRateEffectiveDate: date("exchange_rate_effective_date", { mode: "string" }),
  exchangeRateSourceScope: text("exchange_rate_source_scope").notNull().default("none"),
  exchangeRateStatus: text("exchange_rate_status").notNull().default("not_required"),
  systemSource: text("system_source"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  statementLineUnique: uniqueIndex("agaraccounting_journal_entries_statement_line_id_idx").on(table.statementLineId),
  idClientUnique: uniqueIndex("agaraccounting_journal_entries_id_client_idx").on(table.id, table.clientId),
  clientDateIdx: index("agaraccounting_journal_entries_client_date_idx").on(table.clientId, table.date),
  shareCapitalRegisterUnique: uniqueIndex("agaraccounting_journal_entries_share_capital_register_idx")
    .on(table.clientId)
    .where(sql`${table.systemSource} = 'share_capital_register'`),
  systemSourceIdx: index("agaraccounting_journal_entries_system_source_idx").on(table.clientId, table.systemSource),
  statusCheck: check(
    "agaraccounting_journal_entries_lifecycle_compat_check",
    // Keep production rows from the former review lifecycle valid while the
    // runtime maps them to draft and transitions future writes to two states.
    sql`${table.status} in ('draft', 'posted', 'suggested', 'approved', 'needs_review')`,
  ),
  clientForeignKey: foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "agaraccounting_journal_entries_client_fk",
  }),
  statementLineForeignKey: foreignKey({
    columns: [table.statementLineId],
    foreignColumns: [statementLinesTable.id],
    name: "agaraccounting_journal_entries_statement_line_fk",
  }),
}));

export const accountClassificationsTable = pgTable("agaraccounting_account_classifications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  accountCode: text("account_code"),
  accountName: text("account_name").notNull(),
  displayName: text("display_name").notNull(),
  statementSection: text("statement_section").notNull(),
  currentNonCurrent: text("current_non_current").notNull().default("not_applicable"),
  cashFlowCategory: text("cash_flow_category").notNull().default("operating"),
  oci: text("oci").notNull().default("no"),
  relatedPartyCategory: text("related_party_category").notNull().default("none"),
  taxCategory: text("tax_category").notNull().default("not_assessed"),
  taxTreatment: text("tax_treatment").notNull().default("review_required"),
  taxTreatmentReason: text("tax_treatment_reason"),
  isActive: boolean("is_active").notNull().default(true),
  isSystem: boolean("is_system").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(1000),
  noteNumber: integer("note_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  clientAccountUnique: uniqueIndex("agaraccounting_account_classifications_client_account_idx").on(table.clientId, table.accountName),
  clientAccountCodeUnique: uniqueIndex("agaraccounting_account_classifications_client_code_idx").on(table.clientId, table.accountCode),
  clientForeignKey: foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "agaraccounting_account_classifications_client_fk",
  }).onDelete("cascade"),
}));

export const reportPacksTable = pgTable("agaraccounting_report_packs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  createdBy: varchar("created_by").notNull(),
  periodStart: date("period_start", { mode: "string" }).notNull(),
  periodEnd: date("period_end", { mode: "string" }).notNull(),
  comparativePeriodStart: date("comparative_period_start", { mode: "string" }).notNull(),
  comparativePeriodEnd: date("comparative_period_end", { mode: "string" }).notNull(),
  reportingBasis: text("reporting_basis").notNull().default("IFRS"),
  presentationProfile: text("presentation_profile").notNull().default("IAS 1"),
  presentationCurrency: varchar("presentation_currency", { length: 3 }).notNull(),
  roundingPolicy: text("rounding_policy").notNull().default("Nearest whole unit"),
  status: text("status").notNull().default("draft"),
  snapshot: jsonb("snapshot").notNull(),
  validation: jsonb("validation").notNull(),
  notes: jsonb("notes").notNull(),
  checklist: jsonb("checklist").notNull(),
  signatory: jsonb("signatory").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
}, (table) => [
  index("agaraccounting_report_packs_client_period_idx").on(table.clientId, table.periodEnd),
  foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "agaraccounting_report_packs_client_fk",
  }),
  check("agaraccounting_report_packs_status_check", sql`status in ('draft', 'finalized')`),
  check("agaraccounting_report_packs_basis_check", sql`reporting_basis in ('IFRS', 'IFRS for SMEs')`),
]);

export const bulkTransitionAuditsTable = pgTable("agaraccounting_bulk_transition_audits", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  actorUserId: varchar("actor_user_id").notNull(),
  actorName: text("actor_name"),
  actorEmail: text("actor_email"),
  transition: text("transition").notNull(),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  entryIds: integer("entry_ids").array().notNull(),
  statementLineIds: integer("statement_line_ids").array().notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("agaraccounting_bulk_transition_audits_client_confirmed_idx").on(table.clientId, table.confirmedAt),
]);

export const statementImportUndoAuditsTable = pgTable("agaraccounting_statement_import_undo_audits", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  statementImportId: integer("statement_import_id").notNull(),
  actorUserId: varchar("actor_user_id").notNull(),
  actorName: text("actor_name"),
  actorEmail: text("actor_email"),
  statementLineIds: integer("statement_line_ids").array().notNull(),
  journalEntryIds: integer("journal_entry_ids").array().notNull(),
  undoneAt: timestamp("undone_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("agaraccounting_statement_import_undo_audits_client_undone_idx").on(table.clientId, table.undoneAt),
]);
export const statementLineDetailRequestsTable = pgTable("agaraccounting_statement_line_detail_requests", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  createdByUserId: varchar("created_by_user_id").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  senderMessage: text("sender_message"),
  token: text("token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("agaraccounting_statement_line_detail_requests_token_idx").on(table.token),
  index("agaraccounting_statement_line_detail_requests_client_idx").on(table.clientId, table.createdAt),
  foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "agaraccounting_statement_line_detail_requests_client_fk",
  }),
  foreignKey({
    columns: [table.createdByUserId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_statement_line_detail_requests_creator_fk",
  }),
]);

export const statementLineDetailRequestItemsTable = pgTable("agaraccounting_statement_line_detail_request_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  requestId: integer("request_id").notNull(),
  statementLineId: integer("statement_line_id").notNull(),
}, (table) => [
  uniqueIndex("agaraccounting_statement_line_detail_request_items_unique_idx").on(table.requestId, table.statementLineId),
  index("agaraccounting_statement_line_detail_request_items_line_idx").on(table.statementLineId),
  foreignKey({
    columns: [table.requestId],
    foreignColumns: [statementLineDetailRequestsTable.id],
    name: "agaraccounting_statement_line_detail_request_items_request_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.statementLineId],
    foreignColumns: [statementLinesTable.id],
    name: "agaraccounting_statement_line_detail_request_items_line_fk",
  }).onDelete("cascade"),
]);

export const statementLineNotesTable = pgTable("agaraccounting_statement_line_notes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  statementLineId: integer("statement_line_id").notNull(),
  requestId: integer("request_id").notNull(),
  submittedByEmail: text("submitted_by_email").notNull(),
  noteText: text("note_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("agaraccounting_statement_line_notes_line_idx").on(table.statementLineId, table.createdAt),
  foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "agaraccounting_statement_line_notes_client_fk",
  }),
  foreignKey({
    columns: [table.statementLineId],
    foreignColumns: [statementLinesTable.id],
    name: "agaraccounting_statement_line_notes_line_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.requestId],
    foreignColumns: [statementLineDetailRequestsTable.id],
    name: "agaraccounting_statement_line_notes_request_fk",
  }).onDelete("cascade"),
]);

export const statementLineNoteAttachmentsTable = pgTable("agaraccounting_statement_line_note_attachments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  noteId: integer("note_id").notNull(),
  objectKey: text("object_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
}, (table) => [
  index("agaraccounting_statement_line_note_attachments_note_idx").on(table.noteId),
  foreignKey({
    columns: [table.noteId],
    foreignColumns: [statementLineNotesTable.id],
    name: "agaraccounting_statement_line_note_attachments_note_fk",
  }).onDelete("cascade"),
]);

export type InsertStatementLine = typeof statementLinesTable.$inferInsert;
export type StatementLine = typeof statementLinesTable.$inferSelect;
export type Client = typeof clientsTable.$inferSelect;
export type StatementLineDetailRequest = typeof statementLineDetailRequestsTable.$inferSelect;
export type StatementLineNote = typeof statementLineNotesTable.$inferSelect;
export type StatementLineNoteAttachment = typeof statementLineNoteAttachmentsTable.$inferSelect;
export type Shareholder = typeof shareholdersTable.$inferSelect;
export type JournalEntry = typeof journalEntriesTable.$inferSelect;
export type AccountClassification = typeof accountClassificationsTable.$inferSelect;
export type ReportPack = typeof reportPacksTable.$inferSelect;

export type BulkTransitionAudit = typeof bulkTransitionAuditsTable.$inferSelect;
export type StatementImportUndoAudit = typeof statementImportUndoAuditsTable.$inferSelect;
export type AssistantThread = typeof assistantThreadsTable.$inferSelect;
export type AssistantTurn = typeof assistantTurnsTable.$inferSelect;
export type User = typeof usersTable.$inferSelect;
export type UpsertUser = typeof usersTable.$inferInsert;

export const systemRatesTable = pgTable("agaraccounting_system_rates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sourceCurrency: varchar("source_currency", { length: 3 }).notNull(),
  functionalCurrency: varchar("functional_currency", { length: 3 }).notNull(),
  effectiveDate: date("effective_date", { mode: "string" }).notNull(),
  rate: numeric("rate", { precision: 20, scale: 10 }).notNull(),
  source: text("source").notNull().default("Manual"),
  note: text("note"),
  createdByUserId: varchar("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("agaraccounting_system_rates_pair_date_idx").on(table.sourceCurrency, table.functionalCurrency, table.effectiveDate),
  index("agaraccounting_system_rates_lookup_idx").on(table.sourceCurrency, table.functionalCurrency, table.effectiveDate),
  foreignKey({
    columns: [table.createdByUserId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_system_rates_creator_fk",
  }),
]);

export const systemRateAuditEventsTable = pgTable("agaraccounting_system_rate_audit_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  actorUserId: varchar("actor_user_id").notNull(),
  systemRateId: integer("system_rate_id"),
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("agaraccounting_system_rate_audit_events_created_idx").on(table.createdAt),
  check("agaraccounting_system_rate_audit_events_action_check", sql`action in ('created', 'updated', 'deleted', 'imported')`),
  foreignKey({
    columns: [table.actorUserId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_system_rate_audit_events_actor_fk",
  }),
  foreignKey({
    columns: [table.systemRateId],
    foreignColumns: [systemRatesTable.id],
    name: "agaraccounting_system_rate_audit_events_rate_fk",
  }).onDelete("set null"),
]);

export const feedbackPostsTable = pgTable("agaraccounting_feedback_posts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  authorId: varchar("author_id"),
  body: text("body").notNull(),
  imageObjectPath: varchar("image_object_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("agaraccounting_feedback_posts_feed_idx").on(table.createdAt, table.id),
  foreignKey({
    columns: [table.authorId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_feedback_posts_author_fk",
  }).onDelete("set null"),
]);

export const feedbackRepliesTable = pgTable("agaraccounting_feedback_replies", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  postId: integer("post_id").notNull(),
  authorId: varchar("author_id"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("agaraccounting_feedback_replies_post_thread_idx").on(table.postId, table.createdAt, table.id),
  foreignKey({
    columns: [table.postId],
    foreignColumns: [feedbackPostsTable.id],
    name: "agaraccounting_feedback_replies_post_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.authorId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_feedback_replies_author_fk",
  }).onDelete("set null"),
]);

export const feedbackPostLinksTable = pgTable("agaraccounting_feedback_post_links", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  postId: integer("post_id").notNull(),
  url: varchar("url").notNull(),
  position: smallint("position").notNull(),
}, (table) => [
  uniqueIndex("agaraccounting_feedback_post_links_post_position_idx").on(table.postId, table.position),
  check("agaraccounting_feedback_post_links_position_check", sql`position between 0 and 4`),
  foreignKey({
    columns: [table.postId],
    foreignColumns: [feedbackPostsTable.id],
    name: "agaraccounting_feedback_post_links_post_fk",
  }).onDelete("cascade"),
]);

export const feedbackReactionsTable = pgTable("agaraccounting_feedback_reactions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull(),
  targetType: text("target_type").notNull(),
  targetId: integer("target_id").notNull(),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("agaraccounting_feedback_reactions_unique_idx").on(table.userId, table.targetType, table.targetId, table.emoji),
  index("agaraccounting_feedback_reactions_target_idx").on(table.targetType, table.targetId),
  check("agaraccounting_feedback_reactions_target_type_check", sql`target_type in ('post', 'reply')`),
  check("agaraccounting_feedback_reactions_emoji_check", sql`emoji in ('thumbs_up', 'heart', 'celebrate', 'eyes', 'rocket', 'laugh')`),
  foreignKey({
    columns: [table.userId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_feedback_reactions_user_fk",
  }).onDelete("cascade"),
]);

export type FeedbackPost = typeof feedbackPostsTable.$inferSelect;
export type FeedbackReply = typeof feedbackRepliesTable.$inferSelect;
export type FeedbackPostLink = typeof feedbackPostLinksTable.$inferSelect;
export type FeedbackReaction = typeof feedbackReactionsTable.$inferSelect;

export const billingAccountsTable = pgTable("agaraccounting_billing_accounts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  payerType: text("payer_type").notNull(),
  firmId: integer("firm_id"),
  clientId: integer("client_id"),
  stripeCustomerId: text("stripe_customer_id"),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("agaraccounting_billing_accounts_firm_uidx").on(table.firmId),
  uniqueIndex("agaraccounting_billing_accounts_client_uidx").on(table.clientId),
  uniqueIndex("agaraccounting_billing_accounts_stripe_customer_uidx").on(table.stripeCustomerId),
  index("agaraccounting_billing_accounts_payer_idx").on(table.payerType),
  check("agaraccounting_billing_accounts_payer_check", sql`payer_type in ('firm', 'company')`),
  check(
    "agaraccounting_billing_accounts_payer_target_check",
    sql`(payer_type = 'firm' and firm_id is not null and client_id is null)
      or (payer_type = 'company' and client_id is not null and firm_id is null)`,
  ),
  foreignKey({
    columns: [table.firmId],
    foreignColumns: [firmProfilesTable.id],
    name: "agaraccounting_billing_accounts_firm_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "agaraccounting_billing_accounts_client_fk",
  }).onDelete("cascade"),
]);

export const billingSubscriptionsTable = pgTable("agaraccounting_billing_subscriptions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  billingAccountId: integer("billing_account_id").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  stripeScheduleId: text("stripe_schedule_id"),
  planKey: text("plan_key").notNull(),
  status: text("status").notNull(),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  sourceEventCreatedAt: timestamp("source_event_created_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("agaraccounting_billing_subscriptions_account_idx").on(table.billingAccountId, table.updatedAt),
  uniqueIndex("agaraccounting_billing_subscriptions_stripe_uidx").on(table.stripeSubscriptionId),
  check("agaraccounting_billing_subscriptions_plan_check", sql`plan_key in ('firm', 'company_pro', 'company_pro_firm_member')`),
  check("agaraccounting_billing_subscriptions_status_check", sql`status in ('trialing', 'active', 'past_due', 'canceled', 'lapsed_readonly', 'locked')`),
  foreignKey({
    columns: [table.billingAccountId],
    foreignColumns: [billingAccountsTable.id],
    name: "agaraccounting_billing_subscriptions_account_fk",
  }).onDelete("cascade"),
]);

export const billingWebhookEventsTable = pgTable("agaraccounting_billing_webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  stripeCreatedAt: timestamp("stripe_created_at", { withTimezone: true }).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (table) => [
  index("agaraccounting_billing_webhook_events_created_idx").on(table.stripeCreatedAt),
]);

export type BillingAccount = typeof billingAccountsTable.$inferSelect;
export type BillingSubscription = typeof billingSubscriptionsTable.$inferSelect;
export type BillingWebhookEvent = typeof billingWebhookEventsTable.$inferSelect;
