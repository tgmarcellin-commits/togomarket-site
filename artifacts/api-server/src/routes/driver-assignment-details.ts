import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  conversationsTable,
  db,
  deliveryWorkflowJobsTable,
  ordersTable,
  vendorsTable,
} from "@workspace/db";
import { resolveWorkflowDriverId } from "../lib/driver-workflow-auth";
import { ensureOrderPricingLocked, findLatestOrderLink, getPartyLocations } from "../lib/party-locations";

const router: IRouter = Router();

function mapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}

/**
 * GET /api/driver-connexion/assignments/:deliveryJobId/details
 * Détails de la course pour le livreur concerné :
 *  - toujours : description, prix de la commande, distance, rémunération, frais de retour ;
 *  - UNIQUEMENT après acceptation ET paiement de la course (cahier des charges, section 9) :
 *    positions exactes et contacts du vendeur (retrait) et de l'acheteur (livraison).
 */
router.get("/driver-connexion/assignments/:deliveryJobId/details", async (req, res): Promise<void> => {
  const driverId = await resolveWorkflowDriverId(req.headers.authorization);
  if (!driverId) {
    res.status(401).json({ error: "Session livreur invalide" });
    return;
  }
  const deliveryJobId = Number(req.params.deliveryJobId);
  if (!Number.isInteger(deliveryJobId) || deliveryJobId <= 0) {
    res.status(400).json({ error: "Mission invalide" });
    return;
  }

  const [job] = await db
    .select({
      id: deliveryWorkflowJobsTable.id,
      orderId: deliveryWorkflowJobsTable.orderId,
      acceptanceStatus: deliveryWorkflowJobsTable.acceptanceStatus,
    })
    .from(deliveryWorkflowJobsTable)
    .where(and(eq(deliveryWorkflowJobsTable.id, deliveryJobId), eq(deliveryWorkflowJobsTable.driverId, driverId)))
    .limit(1);
  if (!job) {
    res.status(404).json({ error: "Mission introuvable" });
    return;
  }

  // Calcule et verrouille distance + frais si les positions sont là et que ce n'est pas encore fait
  await ensureOrderPricingLocked(job.orderId).catch((err) => {
    req.log?.warn({ err, orderId: job.orderId }, "Verrouillage des frais impossible");
  });

  const [order] = await db
    .select({
      id: ordersTable.id,
      description: ordersTable.description,
      firstName: ordersTable.firstName,
      lastName: ordersTable.lastName,
      phone: ordersTable.phone,
      articlePriceLocked: ordersTable.articlePriceLocked,
      distanceLockedKm: ordersTable.distanceLockedKm,
      transportFeeLocked: ordersTable.transportFeeLocked,
      roundTripFeeLocked: ordersTable.roundTripFeeLocked,
      driverPaymentConfirmedAt: ordersTable.driverPaymentConfirmedAt,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, job.orderId))
    .limit(1);
  if (!order) {
    res.status(404).json({ error: "Commande introuvable" });
    return;
  }

  const link = await findLatestOrderLink(job.orderId);
  const positions = link ? await getPartyLocations(link.conversationId) : {};
  const paid = Boolean(order.driverPaymentConfirmedAt);
  const accepted = job.acceptanceStatus === "accepted_by_driver";
  const revealed = paid && accepted;

  let pickup: Record<string, unknown> | null = null;
  let dropoff: Record<string, unknown> | null = null;
  if (revealed && link) {
    const [conversation] = await db
      .select({
        buyerName: conversationsTable.buyerName,
        buyerPhone: conversationsTable.buyerPhone,
        vendorId: conversationsTable.vendorId,
      })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, link.conversationId))
      .limit(1);
    const [vendor] = conversation
      ? await db
        .select({
          firstName: vendorsTable.firstName,
          lastName: vendorsTable.lastName,
          shopName: vendorsTable.shopName,
          phone: vendorsTable.phone,
        })
        .from(vendorsTable)
        .where(eq(vendorsTable.id, conversation.vendorId))
        .limit(1)
      : [];

    if (positions.seller) {
      pickup = {
        latitude: positions.seller.latitude,
        longitude: positions.seller.longitude,
        mapsUrl: mapsUrl(positions.seller.latitude, positions.seller.longitude),
        contactName: vendor ? (vendor.shopName || `${vendor.firstName} ${vendor.lastName}`.trim()) : null,
        contactPhone: vendor?.phone ?? null,
      };
    }
    if (positions.buyer) {
      dropoff = {
        latitude: positions.buyer.latitude,
        longitude: positions.buyer.longitude,
        mapsUrl: mapsUrl(positions.buyer.latitude, positions.buyer.longitude),
        contactName: conversation?.buyerName ?? `${order.firstName} ${order.lastName}`.trim(),
        contactPhone: conversation?.buyerPhone ?? order.phone,
      };
    }
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({
    orderId: order.id,
    description: order.description,
    articlePriceFcfa: order.articlePriceLocked ?? 0,
    distanceKm: order.distanceLockedKm ?? null,
    driverFeeFcfa: order.transportFeeLocked ?? null,
    roundTripFeeFcfa: order.roundTripFeeLocked ?? null,
    positionsShared: { seller: Boolean(positions.seller), buyer: Boolean(positions.buyer) },
    paid,
    revealed,
    pickup,
    dropoff,
  });
});

export default router;
