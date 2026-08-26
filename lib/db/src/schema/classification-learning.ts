import { index, integer, numeric, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

/**
 * Workspace-scoped aggregate classification evidence.
 *
 * Deliberately does not retain a client id, transaction id, description, amount,
 * or any other source-client detail.
 */
export const classificationPatternsTable = pgTable(
  "agaraccounting_classification_patterns",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: varchar("user_id").notNull(),
    normalizedVendor: text("normalized_vendor").notNull(),
    accountSuggestion: text("account_suggestion").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 2 }).notNull().default("0.85"),
    confirmationCount: integer("confirmation_count").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("agaraccounting_classification_patterns_user_vendor_account_idx").on(
      table.userId,
      table.normalizedVendor,
      table.accountSuggestion,
    ),
    index("agaraccounting_classification_patterns_user_vendor_idx").on(table.userId, table.normalizedVendor),
  ],
);

export type ClassificationPattern = typeof classificationPatternsTable.$inferSelect;
export type InsertClassificationPattern = typeof classificationPatternsTable.$inferInsert;