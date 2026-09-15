import { messagesTable } from "@workspace/db";

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