import assert from "node:assert/strict";
import test from "node:test";
import { parseCloudinaryMediaUrl } from "./cloudinary-media";

test("only URLs belonging to this Cloudinary account and managed folder are accepted", () => {
  const previous = process.env.CLOUDINARY_CLOUD_NAME;
  process.env.CLOUDINARY_CLOUD_NAME = "unit-test-cloud";
  try {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const publicVideo = `https://res.cloudinary.com/unit-test-cloud/video/upload/v123/togomarket/public/${id}.mp4`;
    const privateAudio = `https://res.cloudinary.com/unit-test-cloud/video/authenticated/v123/togomarket/private/${id}.wav`;
    const privatePdf = `https://res.cloudinary.com/unit-test-cloud/raw/authenticated/v123/togomarket/private/${id}.pdf`;
    assert.equal(parseCloudinaryMediaUrl(publicVideo)?.publicId, `togomarket/public/${id}`);
    assert.equal(parseCloudinaryMediaUrl(privateAudio)?.resourceType, "video");
    assert.equal(parseCloudinaryMediaUrl(privatePdf)?.publicId, `togomarket/private/${id}.pdf`);
    assert.equal(parseCloudinaryMediaUrl(publicVideo.replace("unit-test-cloud", "other-cloud")), null);
    assert.equal(parseCloudinaryMediaUrl(privatePdf.replace("https:", "http:")), null);
    assert.equal(parseCloudinaryMediaUrl(privatePdf.replace("/private/", "/public/")), null);
    assert.equal(parseCloudinaryMediaUrl(publicVideo + "?something=1"), null);
  } finally {
    if (previous === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = previous;
  }
});