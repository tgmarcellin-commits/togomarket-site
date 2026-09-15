import { messagesTable } from "@workspace/db";
import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Production can temporarily lag behind the source schema. Using the full
 * messagesTable for inserts makes Drizzle mention every source column, even
 * omitted nullable columns, which breaks while listing_* is absent.
 */
export const compatibleMessagesInsertTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  senderType: text("sender_type").notNull(),
  content: text("content"),
  fileUrl: text("file_url"),
  fileType: text("file_type"),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  vendorDeletedAt: timestamp("vendor_deleted_at", { withTimezone: true }),
  buyerDeletedAt: timestamp("buyer_deleted_at", { withTimezone: true }),
  readByVendorAt: timestamp("read_by_vendor_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const compatibleMessageInsertColumns = {
  id: compatibleMessagesInsertTable.id,
  conversationId: compatibleMessagesInsertTable.conversationId,
  senderType: compatibleMessagesInsertTable.senderType,
  content: compatibleMessagesInsertTable.content,
  fileUrl: compatibleMessagesInsertTable.fileUrl,
  fileType: compatibleMessagesInsertTable.fileType,
  editedAt: compatibleMessagesInsertTable.editedAt,
  deletedAt: compatibleMessagesInsertTable.deletedAt,
  vendorDeletedAt: compatibleMessagesInsertTable.vendorDeletedAt,
  buyerDeletedAt: compatibleMessagesInsertTable.buyerDeletedAt,
  readByVendorAt: compatibleMessagesInsertTable.readByVendorAt,
  readAt: compatibleMessagesInsertTable.readAt,
  createdAt: compatibleMessagesInsertTable.createdAt,
};

export const compatibleMessageColumns = {
  id: messagesTable.id,
  conversationId: messagesTable.conversationId,
  senderType: messagesTable.senderType,
  content: messagesTable.content,
  fileUrl: messagesTable.fileUrl,
  fileType: messagesTable.fileType,
  editedAt: messagesTable.editedAt,
  deletedAt: messagesTable.deletedAt,
  vendorDeletedAt: messagesTable.vendorDeletedAt,
  buyerDeletedAt: messagesTable.buyerDeletedAt,
  readByVendorAt: messagesTable.readByVendorAt,
  readAt: messagesTable.readAt,
  createdAt: messagesTable.createdAt,
};

export function withMessageListingContext<T extends object>(
  message: T,
  context?: {
    listingId?: number | null;
    listingTitle?: string | null;
    listingImage?: string | null;
  },
) {
  return {
    ...message,
    listingId: context?.listingId ?? null,
    listingTitle: context?.listingTitle ?? null,
    listingImage: context?.listingImage ?? null,
  };
}