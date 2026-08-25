import { bigint, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey(),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  starterClientId: integer("starter_client_id"),
  remediatedLegacyClientId: integer("remediated_legacy_client_id"),
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

export const clientsTable = pgTable("ledgerflow_clients", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  legalName: text("legal_name").notNull(),
  functionalCurrency: text("functional_currency").notNull().default("AED"),
  basis: text("basis").notNull().default("IFRS"),
  period: text("period").notNull().default("August 2026"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const clientWorkspacesTable = pgTable(
  "ledgerflow_client_workspaces",
  {
    clientId: integer("client_id").notNull(),
    userId: varchar("user_id").notNull(),
    role: text("role").notNull().default("admin"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ledgerflow_client_workspaces_client_user_idx").on(table.clientId, table.userId),
    index("ledgerflow_client_workspaces_user_role_idx").on(table.userId, table.role),
    check("ledgerflow_client_workspaces_role_check", sql`role in ('admin', 'bookkeeper')`),
    foreignKey({
      columns: [table.clientId],
      foreignColumns: [clientsTable.id],
      name: "ledgerflow_client_workspaces_client_fk",
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [usersTable.id],
      name: "ledgerflow_client_workspaces_user_fk",
    }),
  ],
);

export const workspaceInvitationsTable = pgTable(
  "ledgerflow_workspace_invitations",
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
    index("ledgerflow_workspace_invitations_email_status_idx").on(table.email, table.status),
    index("ledgerflow_workspace_invitations_inviter_idx").on(table.invitedByUserId),
    check("ledgerflow_workspace_invitations_role_check", sql`role in ('admin', 'bookkeeper')`),
    check("ledgerflow_workspace_invitations_status_check", sql`status in ('pending', 'accepted', 'revoked', 'expired')`),
    foreignKey({
      columns: [table.invitedByUserId],
      foreignColumns: [usersTable.id],
      name: "ledgerflow_workspace_invitations_inviter_fk",
    }),
    foreignKey({
      columns: [table.acceptedUserId],
      foreignColumns: [usersTable.id],
      name: "ledgerflow_workspace_invitations_accepted_user_fk",
    }),
  ],
);
export const exchangeRatesTable = pgTable("ledgerflow_exchange_rates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull(),
  sourceCurrency: varchar("source_currency", { length: 3 }).notNull(),
  functionalCurrency: varchar("functional_currency", { length: 3 }).notNull(),
  effectiveDate: date("effective_date", { mode: "string" }).notNull(),
  rate: numeric("rate", { precision: 20, scale: 10 }).notNull(),
  source: text("source").notNull().default("Manual"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  userCurrencyDateUnique: uniqueIndex("ledgerflow_exchange_rates_user_pair_date_idx")
    .on(table.userId, table.sourceCurrency, table.functionalCurrency, table.effectiveDate),
  userLookupIdx: index("ledgerflow_exchange_rates_user_lookup_idx")
    .on(table.userId, table.sourceCurrency, table.functionalCurrency, table.effectiveDate),
}));
export const aiProviderConfigsTable = pgTable("ledgerflow_ai_provider_configs", {
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
  clientUnique: uniqueIndex("ledgerflow_ai_provider_configs_client_idx").on(table.clientId),
}));

export const aiModelCatalogTable = pgTable("ledgerflow_ai_model_catalog", {
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
  providerModelUnique: uniqueIndex("ledgerflow_ai_model_catalog_provider_model_idx").on(table.provider, table.model),
}));
export const bankAccountsTable = pgTable("ledgerflow_bank_accounts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  name: text("name").notNull(),
  bankName: text("bank_name"),
  accountNumberLast4: text("account_number_last4"),
  currency: text("currency").notNull().default("AED"),
  identityKey: text("identity_key"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  identityKeyUnique: uniqueIndex("ledgerflow_bank_accounts_identity_key_idx").on(table.identityKey),
  clientForeignKey: foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "ledgerflow_bank_accounts_client_fk",
  }),
}));

export const statementImportsTable = pgTable("ledgerflow_statement_imports", {
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
  errorMessage: text("error_message"),
  importedLineCount: integer("imported_line_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  clientCompletedFileHashUnique: uniqueIndex("ledgerflow_statement_imports_client_file_hash_idx")
    .on(table.clientId, table.fileHash)
    .where(sql`outcome = 'completed'`),
  clientForeignKey: foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "ledgerflow_statement_imports_client_fk",
  }),
  bankAccountForeignKey: foreignKey({
    columns: [table.bankAccountId],
    foreignColumns: [bankAccountsTable.id],
    name: "ledgerflow_statement_imports_bank_account_fk",
  }),
  outcomeCheck: check(
    "ledgerflow_statement_imports_outcome_check",
    sql`outcome in ('completed', 'duplicate', 'failed')`,
  ),
}));

export const aiActivityTable = pgTable("ledgerflow_ai_activity", {
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
  index("ledgerflow_ai_activity_client_created_idx").on(table.clientId, table.createdAt),
  index("ledgerflow_ai_activity_user_created_idx").on(table.userId, table.createdAt),
  foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "ledgerflow_ai_activity_client_fk",
  }),
  foreignKey({
    columns: [table.userId],
    foreignColumns: [usersTable.id],
    name: "ledgerflow_ai_activity_user_fk",
  }),
]);
export const statementLinesTable = pgTable("ledgerflow_statement_lines", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull().default(1),
  bankAccountId: integer("bank_account_id"),
  date: text("date").notNull(),
  description: text("description").notNull(),
  currency: text("currency").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  direction: text("direction").notNull(),
  status: text("status").notNull().default("needs_review"),
  source: text("source").notNull().default("Bank statement"),
  accountSuggestion: text("account_suggestion"),
  confidence: numeric("confidence", { precision: 5, scale: 2 }),
  importDedupeKey: text("import_dedupe_key"),
  functionalCurrency: varchar("functional_currency", { length: 3 }),
  functionalAmount: numeric("functional_amount", { precision: 14, scale: 2 }),
  exchangeRate: numeric("exchange_rate", { precision: 20, scale: 10 }),
  exchangeRateEffectiveDate: date("exchange_rate_effective_date", { mode: "string" }),
  exchangeRateStatus: text("exchange_rate_status").notNull().default("not_required"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  importDedupeKeyUnique: uniqueIndex("ledgerflow_statement_lines_import_dedupe_key_idx").on(table.importDedupeKey),
  clientForeignKey: foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "ledgerflow_statement_lines_client_fk",
  }),
  bankAccountForeignKey: foreignKey({
    columns: [table.bankAccountId],
    foreignColumns: [bankAccountsTable.id],
    name: "ledgerflow_statement_lines_bank_account_fk",
  }),
}));

export const journalEntriesTable = pgTable("ledgerflow_journal_entries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull().default(1),
  statementLineId: integer("statement_line_id").notNull(),
  date: text("date").notNull(),
  memo: text("memo").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull().default("suggested"),
  confidence: numeric("confidence", { precision: 5, scale: 2 }).notNull(),
  debitAccount: text("debit_account").notNull(),
  creditAccount: text("credit_account").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  functionalCurrency: varchar("functional_currency", { length: 3 }),
  functionalAmount: numeric("functional_amount", { precision: 14, scale: 2 }),
  exchangeRate: numeric("exchange_rate", { precision: 20, scale: 10 }),
  exchangeRateEffectiveDate: date("exchange_rate_effective_date", { mode: "string" }),
  exchangeRateStatus: text("exchange_rate_status").notNull().default("not_required"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  statementLineUnique: uniqueIndex("ledgerflow_journal_entries_statement_line_id_idx").on(table.statementLineId),
  clientForeignKey: foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "ledgerflow_journal_entries_client_fk",
  }),
  statementLineForeignKey: foreignKey({
    columns: [table.statementLineId],
    foreignColumns: [statementLinesTable.id],
    name: "ledgerflow_journal_entries_statement_line_fk",
  }),
}));

export const accountClassificationsTable = pgTable("ledgerflow_account_classifications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  accountName: text("account_name").notNull(),
  displayName: text("display_name").notNull(),
  statementSection: text("statement_section").notNull(),
  currentNonCurrent: text("current_non_current").notNull().default("not_applicable"),
  cashFlowCategory: text("cash_flow_category").notNull().default("operating"),
  oci: text("oci").notNull().default("no"),
  relatedPartyCategory: text("related_party_category").notNull().default("none"),
  taxCategory: text("tax_category").notNull().default("not_assessed"),
  noteNumber: integer("note_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  clientAccountUnique: uniqueIndex("ledgerflow_account_classifications_client_account_idx").on(table.clientId, table.accountName),
  clientForeignKey: foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "ledgerflow_account_classifications_client_fk",
  }),
}));

export const reportPacksTable = pgTable("ledgerflow_report_packs", {
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
  index("ledgerflow_report_packs_client_period_idx").on(table.clientId, table.periodEnd),
  foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "ledgerflow_report_packs_client_fk",
  }),
  check("ledgerflow_report_packs_status_check", sql`status in ('draft', 'finalized')`),
  check("ledgerflow_report_packs_basis_check", sql`reporting_basis in ('IFRS', 'IFRS for SMEs')`),
]);

export const bulkTransitionAuditsTable = pgTable("ledgerflow_bulk_transition_audits", {
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
  index("ledgerflow_bulk_transition_audits_client_confirmed_idx").on(table.clientId, table.confirmedAt),
]);
export type InsertStatementLine = typeof statementLinesTable.$inferInsert;
export type StatementLine = typeof statementLinesTable.$inferSelect;
export type JournalEntry = typeof journalEntriesTable.$inferSelect;
export type AccountClassification = typeof accountClassificationsTable.$inferSelect;
export type ReportPack = typeof reportPacksTable.$inferSelect;

export type BulkTransitionAudit = typeof bulkTransitionAuditsTable.$inferSelect;
export type User = typeof usersTable.$inferSelect;
export type UpsertUser = typeof usersTable.$inferInsert;
