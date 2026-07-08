import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";

export const eventsTable = pgTable("events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  flyerImage: text("flyer_image"),
  date: timestamp("date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }),
  location: text("location").notNull(),
  ticketLink: text("ticket_link"),
  ticketPrice: text("ticket_price"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  isPublished: boolean("is_published").notNull().default(false),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  validationMethod: text("validation_method").notNull().default("pending"),
  fedapayTransactionId: text("fedapay_transaction_id"),
});

export type Event = typeof eventsTable.$inferSelect;
