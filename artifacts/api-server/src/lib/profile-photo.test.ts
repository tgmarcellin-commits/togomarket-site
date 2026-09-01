import assert from "node:assert/strict";
import test from "node:test";
import { isValidProfilePhotoPath, normalizeProfilePhoto } from "./profile-photo";

test("vendor profile photos only persist upload object paths", () => {
  assert.equal(isValidProfilePhotoPath("/objects/uploads/photo-id"), true);
  assert.equal(isValidProfilePhotoPath("data:image/jpeg;base64,SGVsbG8="), false);
  assert.equal(isValidProfilePhotoPath("/objects/uploads/"), false);
  assert.equal(isValidProfilePhotoPath("/objects/uploads/photo-id/extra"), false);
});

test("legacy or invalid profile values are omitted from vendor responses", () => {
  assert.equal(normalizeProfilePhoto(" /objects/uploads/photo-id "), "/objects/uploads/photo-id");
  assert.equal(normalizeProfilePhoto("data:image/jpeg;base64,SGVsbG8="), null);
  assert.equal(normalizeProfilePhoto(null), null);
});