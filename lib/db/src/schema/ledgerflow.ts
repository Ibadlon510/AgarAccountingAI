import { index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey(),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  starterClientId: integer("starter_client_id"),
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("ledgerflow_client_workspaces_client_user_idx").on(table.clientId, table.userId)],
);

export const bankAccountsTable = pgTable("ledgerflow_bank_accounts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  name: text("name").notNull(),
  bankName: text("bank_name"),
  accountNumberLast4: text("account_number_last4"),
  currency: text("currency").notNull().default("AED"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type InsertStatementLine = typeof statementLinesTable.$inferInsert;
export type StatementLine = typeof statementLinesTable.$inferSelect;
export type JournalEntry = typeof journalEntriesTable.$inferSelect;
export type User = typeof usersTable.$inferSelect;
export type UpsertUser = typeof usersTable.$inferInsert;