import assert from "node:assert/strict";
import test from "node:test";
import { OVERVIEW_SECTION_NAMES, getOverviewStatusCode } from "./admin-accounting";

test("getOverviewStatusCode returns 200 when no subsection has failed", () => {
  assert.equal(getOverviewStatusCode([]), 200);
});

test("getOverviewStatusCode returns 200 when only some subsections failed (partial degradation)", () => {
  assert.equal(getOverviewStatusCode(["activeMissions", "disputes"]), 200);
  assert.equal(getOverviewStatusCode(OVERVIEW_SECTION_NAMES.slice(0, OVERVIEW_SECTION_NAMES.length - 1)), 200);
});

test("getOverviewStatusCode returns 503 when every subsection failed (total outage)", () => {
  assert.equal(getOverviewStatusCode([...OVERVIEW_SECTION_NAMES]), 503);
});
