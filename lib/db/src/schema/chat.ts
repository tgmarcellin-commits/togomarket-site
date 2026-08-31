import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { vendorsTable } from "./vendors";

// A conversation is initiated by a buyer interested in a specific vendor
export const conversationsTable = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    buyerName: text("buyer_name").notNull(),
    buyerPhone: text("buyer_phone").notNull(),
    /**
     * SHA-256 of an opaque buyer account key. The raw key is browser-held for
     * guests and derived from the authenticated vendor id for vendor-buyers.
     */
    buyerKeyHash: text("buyer_key_hash"),
    listingTitle: text("listing_title"),
    listingId: integer("listing_id"),
    /** Snapshot reference to the selected listing's first image, when available */
    listingImage: text("listing_image"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    vendorUnreadCount: integer("vendor_unread_count").notNull().default(0),
    /** Messages vendor non lus par l'acheteur */
    buyerUnreadCount: integer("buyer_unread_count").notNull().default(0),
    /** Replies from vendors to broadcast messages — unread count for admin inbox */
    adminUnreadCount: integer("admin_unread_count").notNull().default(0),
    /** Unguessable token returned to buyer at conversation creation; required for buyer reads/sends */
    buyerToken: text("buyer_token").notNull(),
    /** Set when the vendor soft-deletes the conversation from their side only */
    vendorDeletedAt: timestamp("vendor_deleted_at", { withTimezone: true }),
    /** Set when the buyer soft-deletes the conversation from their side only */
    buyerDeletedAt: timestamp("buyer_deleted_at", { withTimezone: true }),
  },
  (t) => ({
    uniqueVendorBuyerKey: uniqueIndex("conversations_vendor_buyer_key_unique")
      .on(t.vendorId, t.buyerKeyHash),
  }),
);

/**
 * Keeps access working after duplicate conversations are consolidated.
 * legacyConversationId is intentionally not a FK because that row is removed.
 */
export const conversationBuyerTokensTable = pgTable(
  "conversation_buyer_tokens",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    legacyConversationId: integer("legacy_conversation_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueToken: unique().on(t.token),
    uniqueLegacyConversation: unique().on(t.legacyConversationId),
  }),
);

// Messages within a conversation
export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversationsTable.id, { onDelete: "cascade" }),
  senderType: text("sender_type").notNull(), // "buyer" | "vendor"
  content: text("content"),               // nullable when a file-only message
  fileUrl: text("file_url"),              // Object Storage path e.g. /objects/uploads/...
  fileType: text("file_type"),            // "image" | "pdf" | "audio"
  editedAt: timestamp("edited_at", { withTimezone: true }),
  /** Hard delete for both parties (sender only) */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  /** Soft-delete for the vendor's view only */
  vendorDeletedAt: timestamp("vendor_deleted_at", { withTimezone: true }),
  /** Soft-delete for the buyer's view only */
  buyerDeletedAt: timestamp("buyer_deleted_at", { withTimezone: true }),
  /** Timestamp when the vendor first read this buyer message */
  readByVendorAt: timestamp("read_by_vendor_at", { withTimezone: true }),
  /** Timestamp when the recipient first read this message */
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Web Push subscriptions for buyers — un device (endpoint) peut être abonné à N conversations
export const buyerPushSubscriptionsTable = pgTable(
  "buyer_push_subscriptions",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    keys: jsonb("keys").notNull(), // { auth: string, p256dh: string }
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueConvEndpoint: unique().on(t.conversationId, t.endpoint),
  }),
);

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
  /** 'push_nudge' = alerte push non activé ; 'renewal' = rappel renouvellement ; 'general' = autre */
  notifType: text("notif_type").notNull().default("general"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Conversation = typeof conversationsTable.$inferSelect;
export type ConversationBuyerToken = typeof conversationBuyerTokensTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;
export type BuyerPushSubscription = typeof buyerPushSubscriptionsTable.$inferSelect;
export type VendorNotification = typeof vendorNotificationsTable.$inferSelect;
