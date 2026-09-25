import assert from "node:assert/strict";
import test from "node:test";
import { isDriverBusyForAssignment, isOrderAssignableStatus } from "./delivery-assignment-guard";

test("isDriverBusyForAssignment marks accepted assignments as busy", () => {
  assert.equal(
    isDriverBusyForAssignment([
      { acceptanceStatus: "accepted_by_driver", assignmentExpiresAt: null },
    ]),
    true,
  );
});

test("isDriverBusyForAssignment marks pending unexpired assignments as busy", () => {
  const now = new Date("2026-09-25T06:00:00.000Z");
  assert.equal(
    isDriverBusyForAssignment(
      [{ acceptanceStatus: "pending_driver_response", assignmentExpiresAt: new Date("2026-09-25T06:10:00.000Z") }],
      now,
    ),
    true,
  );
});

test("isDriverBusyForAssignment ignores expired and closed assignments", () => {
  const now = new Date("2026-09-25T06:00:00.000Z");
  assert.equal(
    isDriverBusyForAssignment(
      [
        { acceptanceStatus: "pending_driver_response", assignmentExpiresAt: new Date("2026-09-25T05:59:59.000Z") },
        { acceptanceStatus: "refused_by_driver", assignmentExpiresAt: null },
        { acceptanceStatus: "cancelled_by_reassignment", assignmentExpiresAt: null },
      ],
      now,
    ),
    false,
  );
});

test("isOrderAssignableStatus only allows assignable order states", () => {
  assert.equal(isOrderAssignableStatus("PENDING"), true);
  assert.equal(isOrderAssignableStatus("ASSIGNED"), true);
  assert.equal(isOrderAssignableStatus("IN_TRANSIT"), true);
  assert.equal(isOrderAssignableStatus("DELIVERED"), false);
  assert.equal(isOrderAssignableStatus("CANCELLED"), false);
});
