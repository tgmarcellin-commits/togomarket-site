import assert from "node:assert/strict";
import test from "node:test";
import { isValidProfilePhotoPath, normalizeProfilePhoto } from "./profile-photo";

test("vendor profile photos reject former object-storage paths", () => {
  assert.equal(isValidProfilePhotoPath("/objects/uploads/photo-id"), false);
  assert.equal(isValidProfilePhotoPath("data:image/jpeg;base64,SGVsbG8="), false);
  assert.equal(isValidProfilePhotoPath("/objects/uploads/"), false);
  assert.equal(isValidProfilePhotoPath("/objects/uploads/photo-id/extra"), false);
});

test("vendor profile photos accept only public HTTPS Cloudinary images from this account", () => {
  const previous = process.env.CLOUDINARY_CLOUD_NAME;
  process.env.CLOUDINARY_CLOUD_NAME = "unit-test-cloud";
  try {
    const url = "https://res.cloudinary.com/unit-test-cloud/image/upload/v123/togomarket/public/123e4567-e89b-42d3-a456-426614174000.png";
    assert.equal(isValidProfilePhotoPath(url), true);
    assert.equal(normalizeProfilePhoto(` ${url} `), url);
    assert.equal(isValidProfilePhotoPath(url.replace("https:", "http:")), false);
    assert.equal(isValidProfilePhotoPath(url.replace("unit-test-cloud", "other-cloud")), false);
    assert.equal(isValidProfilePhotoPath(url.replace("/public/", "/private/")), false);
  } finally {
    if (previous === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = previous;
  }
});

test("legacy or invalid profile values are omitted from vendor responses", () => {
  assert.equal(normalizeProfilePhoto(" /objects/uploads/photo-id "), null);
  assert.equal(normalizeProfilePhoto("data:image/jpeg;base64,SGVsbG8="), null);
  assert.equal(normalizeProfilePhoto(null), null);
});