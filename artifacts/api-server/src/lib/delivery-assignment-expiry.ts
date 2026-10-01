import { and, eq, isNull, lte } from "drizzle-orm";
import { db, deliveryAuditLogsTable, deliveryWorkflowJobsTable, driversTable, ordersTable } from "@workspace/db";
import { logger } from "./logger";
import { PAYMENT_CONFIRMATION_TIMEOUT_MS, shouldExpireAcceptedAssignmentForPaymentTimeout } from "./delivery-assignment-guard";

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

/**
 * Releases drivers stuck waiting for a buyer payment: if an acceptance has
 * been sitting in `accepted_by_driver` for longer than
 * `PAYMENT_CONFIRMATION_TIMEOUT_MS` without a confirmed payment, the mission
 * is cancelled for payment timeout, the driver becomes available again, and
 * the order is put back into a reassignable state.
 *
 * The actual decision of *whether* an acceptance has timed out is delegated
 * to `shouldExpireAcceptedAssignmentForPaymentTimeout`, which is covered by
 * dedicated unit tests. This function itself is a thin DB-touching wrapper
 * (query + transactional writes) and, like the pre-existing
 * `expirePendingAssignments`, is not unit-tested directly because this repo
 * has no local Postgres/test-DB harness to exercise real transactions.
 */
export async function expireUnpaidAcceptedAssignments(): Promise<number> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - PAYMENT_CONFIRMATION_TIMEOUT_MS);

  const candidates = await db
    .select({
      id: deliveryWorkflowJobsTable.id,
      orderId: deliveryWorkflowJobsTable.orderId,
      driverId: deliveryWorkflowJobsTable.driverId,
      acceptedAt: deliveryWorkflowJobsTable.acceptedAt,
      driverPaymentConfirmedAt: ordersTable.driverPaymentConfirmedAt,
    })
    .from(deliveryWorkflowJobsTable)
    .innerJoin(ordersTable, eq(deliveryWorkflowJobsTable.orderId, ordersTable.id))
    .where(and(
      eq(deliveryWorkflowJobsTable.acceptanceStatus, "accepted_by_driver"),
      lte(deliveryWorkflowJobsTable.acceptedAt, cutoff),
      eq(ordersTable.status, "IN_TRANSIT"),
      isNull(ordersTable.driverPaymentConfirmedAt),
    ));

  let expiredCount = 0;
  for (const candidate of candidates) {
    if (!shouldExpireAcceptedAssignmentForPaymentTimeout({
      acceptedAt: candidate.acceptedAt,
      paymentConfirmedAt: candidate.driverPaymentConfirmedAt,
      now,
    })) {
      continue;
    }

    const expired = await db.transaction(async (tx) => {
      // The order update is the authoritative, idempotent gate: it only
      // succeeds while the order is still unpaid and IN_TRANSIT. If a
      // payment was confirmed concurrently (or the order already moved on),
      // this matches zero rows and nothing else is mutated in this
      // transaction, so the driver is never wrongly released from a mission
      // that is actually proceeding normally.
      const [reassignedOrder] = await tx.update(ordersTable)
        .set({ status: "ASSIGNED" })
        .where(and(
          eq(ordersTable.id, candidate.orderId),
          eq(ordersTable.status, "IN_TRANSIT"),
          isNull(ordersTable.driverPaymentConfirmedAt),
        ))
        .returning({ id: ordersTable.id });
      if (!reassignedOrder) return false;

      // Guarded by the current acceptance status so a concurrent driver
      // response (e.g. a refusal) can never be clobbered (idempotent).
      const [expiredJob] = await tx
        .update(deliveryWorkflowJobsTable)
        .set({
          acceptanceStatus: "cancelled_payment_timeout",
          cancelledAt: now,
          cancelReason: "payment_timeout",
          updatedAt: now,
        })
        .where(and(
          eq(deliveryWorkflowJobsTable.id, candidate.id),
          eq(deliveryWorkflowJobsTable.acceptanceStatus, "accepted_by_driver"),
        ))
        .returning({ id: deliveryWorkflowJobsTable.id });
      if (!expiredJob) return false;

      await tx.update(driversTable)
        .set({ isAvailable: true, updatedAt: now })
        .where(eq(driversTable.id, candidate.driverId));

      await tx.insert(deliveryAuditLogsTable).values({
        actorType: "system",
        actorId: "delivery-assignment-expiry",
        action: "delivery_payment_timeout_expired",
        orderId: candidate.orderId,
        metadata: { deliveryJobId: candidate.id, driverId: candidate.driverId },
      });

      return true;
    });

    if (!expired) continue;

    logger.warn(
      { deliveryJobId: candidate.id, orderId: candidate.orderId, driverId: candidate.driverId },
      "Driver acceptance cancelled for payment timeout; driver released and order reassignable",
    );
    expiredCount++;
  }

  return expiredCount;
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

    expireUnpaidAcceptedAssignments()
      .then((count) => {
        if (count > 0) {
          logger.info({ count }, "Expired accepted delivery assignments for payment timeout");
        }
      })
      .catch((err) => logger.error({ err }, "Failed to expire accepted delivery assignments for payment timeout"));
  }, ASSIGNMENT_EXPIRY_INTERVAL_MS);
}
