import assert from "node:assert/strict";
import test from "node:test";
import {
  hasActiveOrAcceptedMission,
  isDriverBusyForAssignment,
  isOrderAssignableStatus,
  shouldExpireAcceptedAssignmentForPaymentTimeout,
} from "./delivery-assignment-guard";

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

test("hasActiveOrAcceptedMission blocks deletion when a pending mission is still active", () => {
  assert.equal(
    hasActiveOrAcceptedMission([
      { acceptanceStatus: "pending_driver_response", orderStatus: "PENDING" },
    ]),
    true,
  );
});

test("hasActiveOrAcceptedMission blocks deletion when an accepted mission is still active", () => {
  assert.equal(
    hasActiveOrAcceptedMission([
      { acceptanceStatus: "accepted_by_driver", orderStatus: "IN_TRANSIT" },
    ]),
    true,
  );
});

test("hasActiveOrAcceptedMission allows deletion when the related order is terminal", () => {
  assert.equal(
    hasActiveOrAcceptedMission([
      { acceptanceStatus: "accepted_by_driver", orderStatus: "DELIVERED" },
      { acceptanceStatus: "pending_driver_response", orderStatus: "RETURN_CONFIRMED" },
    ]),
    false,
  );
});

test("hasActiveOrAcceptedMission allows deletion when missions are refused, expired or cancelled", () => {
  assert.equal(
    hasActiveOrAcceptedMission([
      { acceptanceStatus: "refused_by_driver", orderStatus: "PENDING" },
      { acceptanceStatus: "expired", orderStatus: "ASSIGNED" },
      { acceptanceStatus: "cancelled_by_reassignment", orderStatus: "IN_TRANSIT" },
    ]),
    false,
  );
});

test("shouldExpireAcceptedAssignmentForPaymentTimeout expires an unpaid acceptance after 10 minutes", () => {
  const acceptedAt = new Date("2026-09-25T06:00:00.000Z");
  const now = new Date("2026-09-25T06:10:00.000Z");
  assert.equal(
    shouldExpireAcceptedAssignmentForPaymentTimeout({ acceptedAt, paymentConfirmedAt: null, now }),
    true,
  );
});

test("shouldExpireAcceptedAssignmentForPaymentTimeout does not expire before the 10 minute deadline", () => {
  const acceptedAt = new Date("2026-09-25T06:00:00.000Z");
  const now = new Date("2026-09-25T06:09:59.000Z");
  assert.equal(
    shouldExpireAcceptedAssignmentForPaymentTimeout({ acceptedAt, paymentConfirmedAt: null, now }),
    false,
  );
});

test("shouldExpireAcceptedAssignmentForPaymentTimeout never expires once payment is confirmed", () => {
  const acceptedAt = new Date("2026-09-25T06:00:00.000Z");
  const paymentConfirmedAt = new Date("2026-09-25T06:05:00.000Z");
  const now = new Date("2026-09-25T07:00:00.000Z");
  assert.equal(
    shouldExpireAcceptedAssignmentForPaymentTimeout({ acceptedAt, paymentConfirmedAt, now }),
    false,
  );
});

test("shouldExpireAcceptedAssignmentForPaymentTimeout is a no-op without an acceptance timestamp", () => {
  assert.equal(
    shouldExpireAcceptedAssignmentForPaymentTimeout({ acceptedAt: null, paymentConfirmedAt: null }),
    false,
  );
});
