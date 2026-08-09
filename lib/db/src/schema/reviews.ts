import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { listingsTable } from "./listings";

/** Avis / commentaires des acheteurs sur les articles du marketplace. */
export const reviewsTable = pgTable("reviews", {
  id: serial("id").primaryKey(),
  listingId: integer("listing_id")
    .notNull()
    .references(() => listingsTable.id, { onDelete: "cascade" }),
  buyerName: text("buyer_name").notNull(),
  buyerPhone: text("buyer_phone").notNull(),
  rating: integer("rating").notNull(), // 1 à 5
  comment: text("comment").notNull().default(""),
  /** Jeton secret remis à l'auteur à la création — requis pour modifier/supprimer son avis. */
  editToken: text("edit_token").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Review = typeof reviewsTable.$inferSelect;
