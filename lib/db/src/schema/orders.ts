import { pgEnum, pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const orderStatusEnum = pgEnum("order_status", [
  "PENDING",
  "ASSIGNED",
  "IN_TRANSIT",
  "DELIVERED",
  "RETURNING_TO_SELLER",
  "RETURN_AT_SELLER",
  "RETURN_CONFIRMED",
]);

export const distanceSourceEnum = pgEnum("distance_source", ["ors_api", "fallback_haversine"]);

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  lastName: text("last_name").notNull(),
  firstName: text("first_name").notNull(),
  phone: text("phone").notNull(),
  description: text("description").notNull(),
  articlePriceLocked: integer("article_price_locked").notNull().default(0),
  distanceLockedKm: integer("distance_locked_km"),
  transportFeeLocked: integer("transport_fee_locked"),
  distanceActualKm: integer("distance_actual_km"),
  distanceSource: distanceSourceEnum("distance_source"),
  status: orderStatusEnum("status").notNull().default("PENDING"),
  buyerConsentAt: timestamp("buyer_consent_at", { withTimezone: true }),
  sellerConsentAt: timestamp("seller_consent_at", { withTimezone: true }),
  buyerConsented: boolean("buyer_consented").notNull().default(false),
  sellerConsented: boolean("seller_consented").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
