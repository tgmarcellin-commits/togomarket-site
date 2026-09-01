import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeImageDataUrl,
  persistMigratedProfilePhoto,
} from "./migrate-profile-photos";

test("profile photo migration decodes valid base64 images", () => {
  const image = decodeImageDataUrl("data:image/png;base64,iVBORw0KGgo=");

  assert.equal(image.contentType, "image/png");
  assert.equal(image.buffer.length > 0, true);
});

test("profile photo migration rejects malformed base64 before upload", () => {
  assert.throws(
    () => decodeImageDataUrl("data:image/png;base64,AA="),
    /invalid base64/,
  );
  assert.throws(
    () => decodeImageDataUrl("data:text/plain;base64,SGVsbG8="),
    /not a base64 image/,
  );
});

test("a concurrent profile update is preserved and its unused upload is removed", async () => {
  const deletedPaths: string[] = [];
  const updated = await persistMigratedProfilePhoto({
    vendorId: 42,
    originalPhoto: "data:image/png;base64,iVBORw0KGgo=",
    objectPath: "/objects/uploads/migration-copy",
    updateIfUnchanged: async () => false,
    deleteUploadedObject: async (path) => {
      deletedPaths.push(path);
    },
  });

  assert.equal(updated, false);
  assert.deepEqual(deletedPaths, ["/objects/uploads/migration-copy"]);
});