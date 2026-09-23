import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { listingsTable } from "./listings";

export const contactRequestsTable = pgTable("contact_requests", {
  id: serial("id").primaryKey(),
  listingId: integer("listing_id")
    .notNull()
    .references(() => listingsTable.id, { onDelete: "cascade" }),
  buyerName: text("buyer_name").notNull(),
  buyerPhone: text("buyer_phone").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ContactRequest = typeof contactRequestsTable.$inferSelect;
