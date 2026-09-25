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
  return status === "PENDING" || status === "ASSIGNED";
}
