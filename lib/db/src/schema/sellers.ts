import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const sellersTable = pgTable("sellers", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  phone: text("phone").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Seller = typeof sellersTable.$inferSelect;
