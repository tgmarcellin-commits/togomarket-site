import { isDriverBusyForAssignment } from "./delivery-assignment-guard";

export type PriceConfirmationRow = {
  actorType: "buyer" | "vendor";
  amountFcfa: number;
};

export type PriceConfirmationState = {
  buyerAmount: number | null;
  vendorAmount: number | null;
  status: "pending" | "matched" | "mismatch";
};

export function getPriceConfirmationState(rows: PriceConfirmationRow[]): PriceConfirmationState {
  const buyerAmount = rows.find((row) => row.actorType === "buyer")?.amountFcfa ?? null;
  const vendorAmount = rows.find((row) => row.actorType === "vendor")?.amountFcfa ?? null;
  if (buyerAmount === null || vendorAmount === null) {
    return { buyerAmount, vendorAmount, status: "pending" };
  }
  return {
    buyerAmount,
    vendorAmount,
    status: buyerAmount === vendorAmount ? "matched" : "mismatch",
  };
}

export type DriverAvailabilitySnapshot = {
  id: number;
  assignments: Array<{ acceptanceStatus: string; assignmentExpiresAt: Date | null }>;
};

export function getBusyDriverIds(snapshots: DriverAvailabilitySnapshot[], now = new Date()): Set<number> {
  return new Set(
    snapshots
      .filter((snapshot) => isDriverBusyForAssignment(snapshot.assignments, now))
      .map((snapshot) => snapshot.id),
  );
}

export function hasAcceptedAssignmentConflict(
  selectedJobId: number,
  orderAssignments: Array<{ id: number; acceptanceStatus: string }>,
): boolean {
  return orderAssignments.some(
    (assignment) =>
      assignment.id !== selectedJobId &&
      assignment.acceptanceStatus === "accepted_by_driver",
  );
}
