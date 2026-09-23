import test from "node:test";
import assert from "node:assert/strict";
import { getCoverCropRect, getCoverOutputSize, LISTING_IMAGE_TARGET_RATIO } from "./image";

test("getCoverCropRect center-crops wide images to target ratio", () => {
  const crop = getCoverCropRect(2000, 1000, LISTING_IMAGE_TARGET_RATIO);
  assert.equal(Math.round(crop.sw), 1333);
  assert.equal(crop.sh, 1000);
  assert.equal(Math.round(crop.sx), 333);
  assert.equal(crop.sy, 0);
});

test("getCoverCropRect center-crops tall images to target ratio", () => {
  const crop = getCoverCropRect(900, 1600, LISTING_IMAGE_TARGET_RATIO);
  assert.equal(crop.sw, 900);
  assert.equal(Math.round(crop.sh), 675);
  assert.equal(crop.sx, 0);
  assert.equal(Math.round(crop.sy), 463);
});

test("getCoverOutputSize keeps ratio without upscaling beyond crop width", () => {
  const size = getCoverOutputSize(750, LISTING_IMAGE_TARGET_RATIO, 1400);
  assert.deepEqual(size, { width: 750, height: 563 });
});
