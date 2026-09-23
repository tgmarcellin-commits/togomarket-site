import assert from "node:assert/strict";
import test from "node:test";
import { startDriverSessionPolling } from "./driver-session-polling";

test("driver session polling registers and clears its interval", () => {
  let callback: (() => void) | null = null;
  let clearedId: number | null = null;
  let tickCount = 0;

  const stop = startDriverSessionPolling(
    () => { tickCount += 1; },
    {
      setInterval(next) {
        callback = next;
        return 42;
      },
      clearInterval(id) {
        clearedId = id;
      },
    },
    5_000,
  );

  assert.ok(callback);
  callback?.();
  assert.equal(tickCount, 1);

  stop();
  assert.equal(clearedId, 42);
});
