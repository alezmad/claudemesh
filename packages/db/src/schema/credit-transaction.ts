import { relations } from "drizzle-orm";
import { integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { generateId } from "@turbostarter/shared/utils";

import { customer } from "./customer";

export const creditTransactionTypeEnum = pgEnum("credit_transaction_type", [
  "signup", // Initial free credits
  "purchase", // Bought via billing
  "usage", // Consumed by AI features
  "admin_grant", // Manually added by admin
  "admin_deduct", // Manually removed by admin
  "refund", // Refunded credits
  "promo", // Promotional credits
  "referral", // Referral bonus
  "expiry", // Credits expired
]);

export const creditTransaction = pgTable("credit_transaction", {
  id: text().primaryKey().$defaultFn(generateId),
  customerId: text("customer_id")
    .notNull()
    .references(() => customer.id, { onDelete: "cascade" }),
  amount: integer().notNull(), // Positive = add, Negative = deduct
  type: creditTransactionTypeEnum().notNull(),
  reason: text(), // Human-readable description
  metadata: text(), // JSON for additional context (e.g., AI feature used)
  balanceAfter: integer("balance_after").notNull(), // Snapshot for reconciliation
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: text("created_by"), // User ID who initiated (for admin actions)
});

export const creditTransactionRelations = relations(
  creditTransaction,
  ({ one }) => ({
    customer: one(customer, {
      fields: [creditTransaction.customerId],
      references: [customer.id],
    }),
  }),
);

export type CreditTransaction = typeof creditTransaction.$inferSelect;
export type InsertCreditTransaction = typeof creditTransaction.$inferInsert;
