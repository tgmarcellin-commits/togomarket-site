import assert from "node:assert/strict";
import test from "node:test";
import { secureMessageFileUrl, verifyMessageFileAccess } from "./message-file-access";

process.env.SESSION_SECRET = "message-file-access-test-secret";

test("generates verifiable private URLs for refreshed attachment messages", () => {
  const messages = [
    { id: 7, conversationId: 42, fileUrl: "/objects/uploads/image" },
    { id: 8, conversationId: 42, fileUrl: "/objects/uploads/audio" },
    { id: 9, conversationId: 42, fileUrl: "/objects/uploads/document" },
  ];

  for (const message of messages) {
    const secured = secureMessageFileUrl(message);
    assert.match(secured.fileUrl, new RegExp(
      `^/api/conversations/${message.conversationId}/files/${message.id}\\?access=`,
    ));

    const access = decodeURIComponent(secured.fileUrl.split("access=")[1]);
    assert.equal(
      verifyMessageFileAccess(message.conversationId, message.id, access),
      true,
    );
  }
});

test("does not rewrite legacy or non-private attachment URLs", () => {
  const message = { id: 7, conversationId: 42, fileUrl: "data:application/pdf;base64,legacy" };

  assert.deepEqual(secureMessageFileUrl(message), message);
});