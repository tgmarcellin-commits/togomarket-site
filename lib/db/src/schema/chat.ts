import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { vendorsTable } from "./vendors";

// A conversation is initiated by a buyer interested in a specific vendor
export const conversationsTable = pgTable("conversations", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => vendorsTable.id, { onDelete: "cascade" }),
  buyerName: text("buyer_name").notNull(),
  buyerPhone: text("buyer_phone").notNull(),
  listingTitle: text("listing_title"),
  listingId: integer("listing_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  vendorUnreadCount: integer("vendor_unread_count").notNull().default(0),
  /** Unguessable token returned to buyer at conversation creation; required for buyer reads/sends */
  buyerToken: text("buyer_token").notNull(),
});

// Messages within a conversation
export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversationsTable.id, { onDelete: "cascade" }),
  senderType: text("sender_type").notNull(), // "buyer" | "vendor"
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Web Push subscriptions for vendors
export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => vendorsTable.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  keys: jsonb("keys").notNull(), // { auth: string, p256dh: string }
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Notifications système en boîte de réception du vendeur (rappels plateforme, etc.)
export const vendorNotificationsTable = pgTable("vendor_notifications", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => vendorsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  url: text("url"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Conversation = typeof conversationsTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;
export type VendorNotification = typeof vendorNotificationsTable.$inferSelect;
