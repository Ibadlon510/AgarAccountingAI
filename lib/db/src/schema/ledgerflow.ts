import { integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const statementLinesTable = pgTable("ledgerflow_statement_lines", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
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