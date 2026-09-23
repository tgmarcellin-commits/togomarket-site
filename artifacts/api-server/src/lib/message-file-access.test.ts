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

test("authenticated Cloudinary attachments keep their permanent URLs out of API responses", () => {
  const previous = process.env.CLOUDINARY_CLOUD_NAME;
  process.env.CLOUDINARY_CLOUD_NAME = "unit-test-cloud";
  try {
    for (const [resource, extension] of [["image", "png"], ["video", "wav"], ["raw", "pdf"]]) {
      const url = `https://res.cloudinary.com/unit-test-cloud/${resource}/authenticated/v123/togomarket/private/123e4567-e89b-42d3-a456-426614174000.${extension}`;
      const message = { id: 12, conversationId: 42, fileUrl: url };
      const secured = secureMessageFileUrl(message);
      assert.match(secured.fileUrl, /^\/api\/conversations\/42\/files\/12\?access=/);
      assert.equal(verifyMessageFileAccess(42, 12, decodeURIComponent(secured.fileUrl.split("access=")[1])), true);
    }
  } finally {
    if (previous === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = previous;
  }
});