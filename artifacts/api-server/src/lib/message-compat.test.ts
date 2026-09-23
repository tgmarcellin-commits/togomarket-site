import assert from "node:assert/strict";
import test from "node:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import { compatibleMessagesInsertTable } from "./message-compat";

test("message inserts only target columns available in the production-compatible schema", () => {
  const columns = getTableColumns(compatibleMessagesInsertTable);

  assert.equal(getTableName(compatibleMessagesInsertTable), "messages");
  assert.deepEqual(Object.keys(columns), [
    "id",
    "conversationId",
    "senderType",
    "content",
    "fileUrl",
    "fileType",
    "editedAt",
    "deletedAt",
    "vendorDeletedAt",
    "buyerDeletedAt",
    "readByVendorAt",
    "readAt",
    "createdAt",
  ]);
  assert.ok(!("listingId" in columns));
  assert.ok(!("listingTitle" in columns));
  assert.ok(!("listingImage" in columns));
});