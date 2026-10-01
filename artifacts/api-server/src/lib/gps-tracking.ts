import {
  db,
  deliveryLocationsTable,
  deliveryWorkflowJobsTable,
  ordersTable,
  deliveryAuditLogsTable,
  conversationDeliveryOrdersTable,
  conversationsTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getIo } from "./socket-io";

const GPS_THROTTLE_WINDOW_MS = 2000; // 2 seconds server-side throttle per job
const lastGpsUpdateByJob = new Map<number, number>();

export type IngestLocationInput = {
  deliveryJobId: number;
  driverId: number;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  recordedAt?: Date | string | null;
};

export async function ingestDriverLocation(input: IngestLocationInput) {
  const { deliveryJobId, driverId, latitude, longitude, accuracy, speed, heading } = input;

  // 1. Validate coordinates range
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    await db.insert(deliveryAuditLogsTable).values({
      actorType: "driver",
      actorId: String(driverId),
      action: "gps_update_malformed_rejected",
      metadata: { deliveryJobId, latitude, longitude, reason: "Coordonnées hors limites" },
    });
    throw new Error("Coordonnées GPS invalides.");
  }

  // 2. Validate timestamp if provided
  let recordedAtDate = new Date();
  if (input.recordedAt) {
    const parsed = new Date(input.recordedAt);
    if (!Number.isNaN(parsed.getTime())) {
      const diffMs = Math.abs(Date.now() - parsed.getTime());
      // Must not be in the future > 60s or older than 15 minutes
      if (parsed.getTime() > Date.now() + 60_000 || diffMs > 15 * 60 * 1000) {
        await db.insert(deliveryAuditLogsTable).values({
          actorType: "driver",
          actorId: String(driverId),
          action: "gps_update_timestamp_suspicious",
          metadata: { deliveryJobId, recordedAt: input.recordedAt, reason: "Horodatage incohérent" },
        });
        recordedAtDate = new Date();
      } else {
        recordedAtDate = parsed;
      }
    }
  }

  // 3. Verify job ownership and status
  const [job] = await db
    .select()
    .from(deliveryWorkflowJobsTable)
    .where(and(eq(deliveryWorkflowJobsTable.id, deliveryJobId), eq(deliveryWorkflowJobsTable.driverId, driverId)))
    .limit(1);

  if (!job) {
    throw new Error("Mission de livraison introuvable ou non assignée à ce livreur.");
  }

  if (job.acceptanceStatus !== "accepted_by_driver") {
    throw new Error(`Mission non active (statut: ${job.acceptanceStatus}). Impossible de mettre à jour la position GPS.`);
  }

  // 4. Verify order is active
  const [order] = await db
    .select({ id: ordersTable.id, status: ordersTable.status })
    .from(ordersTable)
    .where(eq(ordersTable.id, job.orderId))
    .limit(1);

  if (!order || (order.status !== "IN_TRANSIT" && order.status !== "ASSIGNED")) {
    throw new Error(`La commande associée n'est plus active (statut: ${order?.status ?? "inconnu"}). Mise à jour GPS refusée.`);
  }

  // 5. Rate-limiting / throttling
  const nowMs = Date.now();
  const lastUpdate = lastGpsUpdateByJob.get(deliveryJobId) ?? 0;
  if (nowMs - lastUpdate < GPS_THROTTLE_WINDOW_MS) {
    return {
      throttled: true,
      message: "Position ignorée (limite de 1 mise à jour toutes les 2 secondes).",
    };
  }
  lastGpsUpdateByJob.set(deliveryJobId, nowMs);

  // 6. Persist location in delivery_locations table
  const [locationRecord] = await db
    .insert(deliveryLocationsTable)
    .values({
      deliveryJobId,
      orderId: job.orderId,
      driverId,
      latitude,
      longitude,
      accuracyMeters: accuracy !== undefined && accuracy !== null ? accuracy : null,
      speed: speed !== undefined && speed !== null ? speed : null,
      heading: heading !== undefined && heading !== null ? heading : null,
      recordedAt: recordedAtDate,
    })
    .returning();

  // 7. Emit Socket.IO event ONLY to authorized rooms
  try {
    const io = getIo();
    const payload = {
      deliveryJobId,
      orderId: job.orderId,
      driverId,
      latitude,
      longitude,
      accuracy: locationRecord.accuracyMeters,
      speed: locationRecord.speed,
      heading: locationRecord.heading,
      recordedAt: recordedAtDate.toISOString(),
    };

    io.to(`order_${job.orderId}`).emit("driver_location_update", payload);

    // Resolve conversation ID if any to notify conversation room
    const [convOrder] = await db
      .select({ conversationId: conversationDeliveryOrdersTable.conversationId })
      .from(conversationDeliveryOrdersTable)
      .where(eq(conversationDeliveryOrdersTable.orderId, job.orderId))
      .orderBy(desc(conversationDeliveryOrdersTable.createdAt))
      .limit(1);

    if (convOrder) {
      io.to(`conv:${convOrder.conversationId}`).emit("driver_location_update", payload);
    }
  } catch {
    // Socket server might not be running in testing
  }

  return {
    throttled: false,
    location: {
      id: locationRecord.id,
      deliveryJobId: locationRecord.deliveryJobId,
      orderId: locationRecord.orderId,
      driverId: locationRecord.driverId,
      latitude: locationRecord.latitude,
      longitude: locationRecord.longitude,
      accuracy: locationRecord.accuracyMeters,
      speed: locationRecord.speed,
      heading: locationRecord.heading,
      recordedAt: locationRecord.recordedAt.toISOString(),
    },
  };
}

export async function canAccessLocation(params: {
  deliveryJobId: number;
  actor:
    | { role: "superadmin" }
    | { role: "driver"; driverId: number }
    | { role: "vendor"; vendorId: number }
    | { role: "buyer"; conversationId?: number; orderId?: number };
}): Promise<boolean> {
  const { deliveryJobId, actor } = params;

  if (actor.role === "superadmin") return true;

  const [job] = await db
    .select()
    .from(deliveryWorkflowJobsTable)
    .where(eq(deliveryWorkflowJobsTable.id, deliveryJobId))
    .limit(1);

  if (!job) return false;

  if (actor.role === "driver") {
    return job.driverId === actor.driverId;
  }

  const [convOrder] = await db
    .select({ conversationId: conversationDeliveryOrdersTable.conversationId })
    .from(conversationDeliveryOrdersTable)
    .where(eq(conversationDeliveryOrdersTable.orderId, job.orderId))
    .orderBy(desc(conversationDeliveryOrdersTable.createdAt))
    .limit(1);

  if (!convOrder) {
    if (actor.role === "buyer" && actor.orderId === job.orderId) return true;
    return false;
  }

  const [conv] = await db
    .select({ id: conversationsTable.id, vendorId: conversationsTable.vendorId })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, convOrder.conversationId))
    .limit(1);

  if (!conv) return false;

  if (actor.role === "vendor") {
    return conv.vendorId === actor.vendorId;
  }

  if (actor.role === "buyer") {
    return conv.id === actor.conversationId || job.orderId === actor.orderId;
  }

  return false;
}
