import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const servicesTable = pgTable("services", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  contact: text("contact").notNull(),
  quartier: text("quartier").notNull(),
  ville: text("ville").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type Service = typeof servicesTable.$inferSelect;
