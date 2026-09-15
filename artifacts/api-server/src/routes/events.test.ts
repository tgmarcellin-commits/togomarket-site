import assert from "node:assert/strict";
import test from "node:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import { compatibleEventsInsertTable } from "./events";

test("event inserts do not target whatsapp_phone before production migration", () => {
  const columns = getTableColumns(compatibleEventsInsertTable);

  assert.equal(getTableName(compatibleEventsInsertTable), "events");
  assert.ok(!("whatsappPhone" in columns));
  assert.deepEqual(Object.keys(columns), [
    "id",
    "title",
    "description",
    "flyerImage",
    "videoPath",
    "date",
    "endDate",
    "location",
    "ticketLink",
    "ticketPrice",
    "createdAt",
    "isPublished",
    "paymentStatus",
    "validationMethod",
    "fedapayTransactionId",
    "subscriptionExpiresAt",
  ]);
});