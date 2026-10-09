import { Router, type IRouter, type Request } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  deliveryLocationsTable,
  deliveryWorkflowJobsTable,
  ordersTable,
} from "@workspace/db";
import { authenticateVendorRequest } from "../lib/vendor-auth";
import { resolveBuyerConversationId, resolveVendorConversationId } from "../lib/conversation-access";
import { findLatestOrderIdForConversation, getPartyLocations } from "../lib/party-locations";

const router: IRouter = Router();

/** Statuts pendant lesquels le trajet est suivi. Hors de cette liste (livré, retour confirmé, annulé…) : plus rien n'est partagé. */
const ACTIVE_STATUSES = ["ASSIGNED", "PICKED_UP", "IN_TRANSIT", "RETURNING_TO_SELLER", "RETURN_AT_SELLER"];

type Point = { latitude: number; longitude: number };

const pt = (p: Point) => `${p.latitude},${p.longitude}`;
const pointUrl = (p: Point) => `https://www.google.com/maps/search/?api=1&query=${pt(p)}`;

/** Itinéraire Google Maps ; sans origine, Google part de la position du téléphone qui ouvre le lien. */
function routeUrl(origin: Point | null, destination: Point, waypoint?: Point | null): string {
  const params = [
    "api=1",
    origin ? `origin=${pt(origin)}` : "",
    `destination=${pt(destination)}`,
    waypoint ? `waypoints=${pt(waypoint)}` : "",
    "travelmode=two-wheeler",
  ].filter(Boolean);
  return `https://www.google.com/maps/dir/?${params.join("&")}`;
}

/** Acheteur (x-buyer-token) ou vendeur de la conversation. */
async function resolveCaller(req: Request, conversationId: number): Promise<number | null> {
  const buyerToken = req.headers["x-buyer-token"];
  if (typeof buyerToken === "string" && buyerToken) {
    return resolveBuyerConversationId(conversationId, buyerToken);
  }
  const vendor = await authenticateVendorRequest(req);
  if (!vendor) return null;
  return resolveVendorConversationId(conversationId, vendor.id);
}

/**
 * GET /api/delivery/conversations/:conversationId/position-details
 * Pour l'acheteur ET le vendeur de la conversation : positions du vendeur, de l'acheteur et du livreur
 * + liens Google Maps. Disponible UNIQUEMENT si la course est payée, acceptée par le livreur
 * et pas encore terminée (livraison / retour validé par QR code, ou annulation) ; sinon aucune coordonnée n'est renvoyée.
 */
router.get("/delivery/conversations/:conversationId/position-details", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const conversationId = Number(req.params.conversationId);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    res.status(400).json({ error: "Conversation invalide" });
    return;
  }
  const resolvedConversationId = await resolveCaller(req, conversationId);
  if (!resolvedConversationId) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }

  const orderId = await findLatestOrderIdForConversation(resolvedConversationId);
  if (!orderId) {
    res.json({ available: false, reason: "no_order" });
    return;
  }

  const [order] = await db
    .select({ status: ordersTable.status, driverPaymentConfirmedAt: ordersTable.driverPaymentConfirmedAt })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);
  if (!order) {
    res.json({ available: false, reason: "no_order" });
    return;
  }

  const status = String(order.status);
  if (!order.driverPaymentConfirmedAt) {
    res.json({ available: false, reason: "not_paid", orderStatus: status });
    return;
  }
  if (!ACTIVE_STATUSES.includes(status)) {
    res.json({ available: false, reason: "finished", orderStatus: status });
    return;
  }

  const [job] = await db
    .select({ id: deliveryWorkflowJobsTable.id })
    .from(deliveryWorkflowJobsTable)
    .where(and(
      eq(deliveryWorkflowJobsTable.orderId, orderId),
      eq(deliveryWorkflowJobsTable.acceptanceStatus, "accepted_by_driver"),
    ))
    .orderBy(desc(deliveryWorkflowJobsTable.id))
    .limit(1);
  if (!job) {
    res.json({ available: false, reason: "no_driver", orderStatus: status });
    return;
  }

  const parties = await getPartyLocations(resolvedConversationId);
  const [last] = await db
    .select({
      latitude: deliveryLocationsTable.latitude,
      longitude: deliveryLocationsTable.longitude,
      heading: deliveryLocationsTable.heading,
      recordedAt: deliveryLocationsTable.recordedAt,
    })
    .from(deliveryLocationsTable)
    .where(eq(deliveryLocationsTable.deliveryJobId, job.id))
    .orderBy(desc(deliveryLocationsTable.recordedAt))
    .limit(1);

  const seller: Point | null = parties.seller ? { latitude: parties.seller.latitude, longitude: parties.seller.longitude } : null;
  const buyer: Point | null = parties.buyer ? { latitude: parties.buyer.latitude, longitude: parties.buyer.longitude } : null;
  const driver: Point | null = last ? { latitude: last.latitude, longitude: last.longitude } : null;

  // Étape en cours : vers le vendeur puis l'acheteur, vers l'acheteur, ou retour vers le vendeur
  const phase = status === "ASSIGNED"
    ? "to-seller"
    : status === "RETURNING_TO_SELLER" || status === "RETURN_AT_SELLER"
      ? "returning"
      : "to-buyer";
  let routeLink: string | null = null;
  if (phase === "to-seller" && seller && buyer) routeLink = routeUrl(driver, buyer, seller);
  else if (phase === "to-seller" && seller) routeLink = routeUrl(driver, seller);
  else if (phase === "to-buyer" && buyer) routeLink = routeUrl(driver, buyer);
  else if (phase === "returning" && seller) routeLink = routeUrl(driver, seller);

  res.json({
    available: true,
    orderStatus: status,
    phase,
    seller: seller && { ...seller, mapsUrl: pointUrl(seller) },
    buyer: buyer && { ...buyer, mapsUrl: pointUrl(buyer) },
    driver: driver && last && {
      ...driver,
      heading: last.heading,
      recordedAt: last.recordedAt.toISOString(),
      mapsUrl: pointUrl(driver),
    },
    routeUrl: routeLink,
  });
});

export default router;
