import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const servicesTable = pgTable("services", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  contact: text("contact").notNull(),
  quartier: text("quartier").notNull(),
  ville: text("ville").notNull(),
  image: text("image"),
  videoPath: text("video_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  isPublished: boolean("is_published").notNull().default(false),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  validationMethod: text("validation_method").notNull().default("pending"),
  fedapayTransactionId: text("fedapay_transaction_id"),
});

export type Service = typeof servicesTable.$inferSelect;
