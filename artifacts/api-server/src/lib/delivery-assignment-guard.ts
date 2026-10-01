type DriverLatestAssignment = {
  acceptanceStatus: string;
  assignmentExpiresAt: Date | null;
};

export function isDriverBusyForAssignment(
  assignments: DriverLatestAssignment[],
  now = new Date(),
): boolean {
  const nowTs = now.getTime();
  return assignments.some((assignment) => {
    if (assignment.acceptanceStatus === "accepted_by_driver") return true;
    if (assignment.acceptanceStatus !== "pending_driver_response") return false;
    if (!assignment.assignmentExpiresAt) return true;
    return assignment.assignmentExpiresAt.getTime() > nowTs;
  });
}

export function isOrderAssignableStatus(status: string): boolean {
  return status === "PENDING" || status === "ASSIGNED" || status === "IN_TRANSIT";
}

/** Driver acceptances must be paid within this delay or the mission is released. */
export const PAYMENT_CONFIRMATION_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * A driver who accepted a mission must not stay blocked indefinitely if the
 * buyer never pays: once `PAYMENT_CONFIRMATION_TIMEOUT_MS` has elapsed since
 * acceptance without a confirmed payment, the acceptance is considered
 * expired so the driver can be released and the order reassigned.
 */
export function shouldExpireAcceptedAssignmentForPaymentTimeout(params: {
  acceptedAt: Date | null;
  paymentConfirmedAt: Date | null;
  now?: Date;
  timeoutMs?: number;
}): boolean {
  const { acceptedAt, paymentConfirmedAt, now = new Date(), timeoutMs = PAYMENT_CONFIRMATION_TIMEOUT_MS } = params;
  if (!acceptedAt || paymentConfirmedAt) return false;
  return now.getTime() - acceptedAt.getTime() >= timeoutMs;
}

type DriverMissionAssignment = {
  acceptanceStatus: string;
  orderStatus: string;
};

/**
 * A driver cannot be safely deleted while engaged in a mission that is still
 * pending the driver's response or already accepted, as long as the related
 * order is still in an active (non-terminal) state.
 */
export function hasActiveOrAcceptedMission(assignments: DriverMissionAssignment[]): boolean {
  return assignments.some(
    (assignment) =>
      (assignment.acceptanceStatus === "pending_driver_response" ||
        assignment.acceptanceStatus === "accepted_by_driver") &&
      isOrderAssignableStatus(assignment.orderStatus),
  );
}
