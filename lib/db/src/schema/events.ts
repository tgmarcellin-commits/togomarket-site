import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const eventsTable = pgTable("events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  flyerImage: text("flyer_image"),
  date: timestamp("date", { withTimezone: true }).notNull(),
  location: text("location").notNull(),
  ticketLink: text("ticket_link"),
  ticketPrice: text("ticket_price"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Event = typeof eventsTable.$inferSelect;
