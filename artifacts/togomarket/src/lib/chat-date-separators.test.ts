import assert from "node:assert/strict";
import test from "node:test";
import { getChatDaySeparatorLabel, getLocalDayKey } from "./chat-date-separators";

test("labels messages from today in French", () => {
  const now = new Date("2026-09-23T12:00:00.000Z");
  const label = getChatDaySeparatorLabel("2026-09-23T09:30:00.000Z", "fr", now);

  assert.equal(label, "Aujourd'hui");
});

test("labels messages from yesterday in French", () => {
  const now = new Date("2026-09-23T18:00:00.000Z");
  const label = getChatDaySeparatorLabel("2026-09-22T12:00:00.000Z", "fr", now);

  assert.equal(label, "Hier");
});

test("formats older French dates with day month year", () => {
  const now = new Date("2026-09-23T12:00:00.000Z");
  const label = getChatDaySeparatorLabel("2026-09-15T08:30:00.000Z", "fr", now);

  assert.match(label, /15/);
  assert.match(label, /sept/i);
  assert.match(label, /2026/);
});

test("produces stable day keys for messages on the same day", () => {
  const first = getLocalDayKey("2026-09-15T01:00:00.000Z");
  const second = getLocalDayKey("2026-09-15T03:00:00.000Z");

  assert.equal(first, second);
});
