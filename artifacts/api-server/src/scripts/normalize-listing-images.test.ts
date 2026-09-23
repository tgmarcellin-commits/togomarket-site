import test from "node:test";
import assert from "node:assert/strict";
import {
  buildListingCoverTransformationUrl,
  parseNormalizeListingImageArgs,
} from "./normalize-listing-images";

test("parseNormalizeListingImageArgs defaults to dry-run", () => {
  const parsed = parseNormalizeListingImageArgs([]);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.apply, false);
});

test("parseNormalizeListingImageArgs blocks apply without confirmation", () => {
  assert.throws(
    () => parseNormalizeListingImageArgs(["--apply"]),
    /--confirm-apply/,
  );
});

test("buildListingCoverTransformationUrl injects 4:3 transformation", () => {
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  const source = "https://res.cloudinary.com/demo/image/upload/v123/togomarket/public/123e4567-e89b-12d3-a456-426614174000.jpg";
  const transformed = buildListingCoverTransformationUrl(source);
  assert.equal(
    transformed,
    "https://res.cloudinary.com/demo/image/upload/c_fill,ar_4:3,g_auto,w_1400,h_1050,f_jpg,q_auto/v123/togomarket/public/123e4567-e89b-12d3-a456-426614174000.jpg",
  );
});
