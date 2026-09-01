import assert from "node:assert/strict";
import test from "node:test";
import { collectReferencedObjectPaths } from "./storageCleanup";

test("storage cleanup retains referenced vendor profile photos", () => {
  const referencedProfilePhoto = "/objects/uploads/vendor-profile";
  const usedPaths = collectReferencedObjectPaths({
    listings: [],
    ads: [],
    vendors: [{ profilePhoto: referencedProfilePhoto }],
    messages: [],
    services: [],
    events: [],
  });

  const allPaths = [referencedProfilePhoto, "/objects/uploads/orphan"];
  assert.deepEqual(
    allPaths.filter((path) => !usedPaths.has(path)),
    ["/objects/uploads/orphan"],
  );
});

test("storage cleanup retains attachments from active and deleted messages", () => {
  const activeAttachment = "/objects/uploads/message-active";
  const deletedAttachment = "/objects/uploads/message-deleted";

  const usedPaths = collectReferencedObjectPaths({
    listings: [],
    ads: [],
    vendors: [],
    messages: [
      { fileUrl: activeAttachment, deletedAt: null },
      { fileUrl: deletedAttachment, deletedAt: new Date("2026-08-01T00:00:00.000Z") },
    ],
    services: [],
    events: [],
  });

  assert.equal(usedPaths.has(activeAttachment), true);
  assert.equal(usedPaths.has(deletedAttachment), true);
});

test("storage cleanup retains every media source and identifies only unreferenced paths as orphans", () => {
  const referencedPaths = [
    "/objects/uploads/listing-image",
    "/objects/uploads/listing-image-legacy-prefix",
    "/objects/uploads/ad-image",
    "/objects/uploads/ad-video",
    "/objects/uploads/vendor-profile",
    "/objects/uploads/message-file",
    "/objects/uploads/service-image",
    "/objects/uploads/service-video",
    "/objects/uploads/event-flyer",
    "/objects/uploads/event-video",
  ];
  const allPaths = [...referencedPaths, "/objects/uploads/orphan"];

  const usedPaths = collectReferencedObjectPaths({
    listings: [{
      images: [
        referencedPaths[0],
        `v:${referencedPaths[1]}`,
      ],
    }],
    ads: [{
      image: referencedPaths[2],
      videoPath: referencedPaths[3],
    }],
    vendors: [{ profilePhoto: referencedPaths[4] }],
    messages: [{ fileUrl: referencedPaths[5] }],
    services: [{
      image: referencedPaths[6],
      videoPath: referencedPaths[7],
    }],
    events: [{
      flyerImage: referencedPaths[8],
      videoPath: referencedPaths[9],
    }],
  });

  assert.deepEqual(
    allPaths.filter((path) => !usedPaths.has(path)),
    ["/objects/uploads/orphan"],
  );
});