import { and, eq, lte } from "drizzle-orm";
import { db, deliveryWorkflowJobsTable } from "@workspace/db";
import { logger } from "./logger";

const ASSIGNMENT_EXPIRY_INTERVAL_MS = 60_000;

let assignmentExpiryTimer: NodeJS.Timeout | undefined;

export async function expirePendingAssignments(): Promise<number> {
  const now = new Date();
  const expiredRows = await db
    .update(deliveryWorkflowJobsTable)
    .set({
      acceptanceStatus: "expired",
      updatedAt: now,
    })
    .where(and(
      eq(deliveryWorkflowJobsTable.acceptanceStatus, "pending_driver_response"),
      lte(deliveryWorkflowJobsTable.assignmentExpiresAt, now),
    ))
    .returning({ id: deliveryWorkflowJobsTable.id });
  return expiredRows.length;
}

export function startDeliveryAssignmentExpiryCron(): void {
  if (assignmentExpiryTimer) return;
  assignmentExpiryTimer = setInterval(() => {
    expirePendingAssignments()
      .then((count) => {
        if (count > 0) {
          logger.info({ count }, "Expired pending delivery assignments");
        }
      })
      .catch((err) => logger.error({ err }, "Failed to expire pending delivery assignments"));
  }, ASSIGNMENT_EXPIRY_INTERVAL_MS);
}
