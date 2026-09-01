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