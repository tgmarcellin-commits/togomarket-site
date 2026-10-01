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
