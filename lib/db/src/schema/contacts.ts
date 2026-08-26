import { date, foreignKey, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, varchar, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clientsTable, journalEntriesTable, statementLinesTable, usersTable } from "./agaraccounting";

export const contactsTable = pgTable("agaraccounting_contacts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  displayName: text("display_name").notNull(),
  legalName: text("legal_name").notNull(),
  contactType: text("contact_type").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("agaraccounting_contacts_client_legal_name_idx").on(table.clientId, table.legalName),
  uniqueIndex("agaraccounting_contacts_id_client_idx").on(table.id, table.clientId),
  index("agaraccounting_contacts_client_status_idx").on(table.clientId, table.status),
  check("agaraccounting_contacts_type_check", sql`contact_type in ('customer', 'supplier', 'both')`),
  check("agaraccounting_contacts_status_check", sql`status in ('active', 'archived')`),
  foreignKey({
    columns: [table.clientId],
    foreignColumns: [clientsTable.id],
    name: "agaraccounting_contacts_client_fk",
  }).onDelete("cascade"),
]);

export const contactAliasesTable = pgTable("agaraccounting_contact_aliases", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  contactId: integer("contact_id").notNull(),
  clientId: integer("client_id").notNull(),
  alias: text("alias").notNull(),
  normalizedAlias: text("normalized_alias").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("agaraccounting_contact_aliases_client_normalized_idx").on(table.clientId, table.normalizedAlias),
  index("agaraccounting_contact_aliases_contact_idx").on(table.contactId),
  foreignKey({
    columns: [table.contactId],
    foreignColumns: [contactsTable.id],
    name: "agaraccounting_contact_aliases_contact_fk",
  }).onDelete("cascade"),
]);

export const contactClassificationEvidenceTable = pgTable("agaraccounting_contact_classification_evidence", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").notNull(),
  contactId: integer("contact_id").notNull(),
  statementLineId: integer("statement_line_id").notNull(),
  journalEntryId: integer("journal_entry_id").notNull(),
  accountSuggestion: text("account_suggestion").notNull(),
  direction: text("direction").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  activityDate: date("activity_date", { mode: "string" }).notNull(),
  entryStatus: text("entry_status").notNull(),
  confirmedByUserId: varchar("confirmed_by_user_id").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("agaraccounting_contact_evidence_statement_line_idx").on(table.statementLineId),
  index("agaraccounting_contact_evidence_contact_date_idx").on(table.clientId, table.contactId, table.activityDate),
  foreignKey({
    columns: [table.contactId],
    foreignColumns: [contactsTable.id],
    name: "agaraccounting_contact_evidence_contact_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.statementLineId],
    foreignColumns: [statementLinesTable.id],
    name: "agaraccounting_contact_evidence_line_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.journalEntryId],
    foreignColumns: [journalEntriesTable.id],
    name: "agaraccounting_contact_evidence_entry_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.confirmedByUserId],
    foreignColumns: [usersTable.id],
    name: "agaraccounting_contact_evidence_user_fk",
  }),
]);

export type Contact = typeof contactsTable.$inferSelect;
export type InsertContact = typeof contactsTable.$inferInsert;
export type ContactAlias = typeof contactAliasesTable.$inferSelect;
export type ContactClassificationEvidence = typeof contactClassificationEvidenceTable.$inferSelect;