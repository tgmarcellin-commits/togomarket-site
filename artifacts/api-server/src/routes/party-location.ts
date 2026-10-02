import { Router, type IRouter, type Request } from "express";
import { authenticateVendorRequest } from "../lib/vendor-auth";
import { resolveBuyerConversationId, resolveVendorConversationId } from "../lib/conversation-access";
import {
  MAX_ACCURACY_METERS,
  ensureOrderPricingLocked,
  findLatestOrderIdForConversation,
  getPartyLocations,
  isValidCoordinatePair,
  savePartyLocation,
  type PartyActor,
} from "../lib/party-locations";

const router: IRouter = Router();

/** Identifie l'appelant : acheteur (x-buyer-token) ou vendeur de la conversation. */
async function resolveActor(
  req: Request,
  conversationId: number,
): Promise<{ conversationId: number; actor: PartyActor } | null> {
  const buyerToken = req.headers["x-buyer-token"];
  if (typeof buyerToken === "string" && buyerToken) {
    const id = await resolveBuyerConversationId(conversationId, buyerToken);
    return id ? { conversationId: id, actor: "buyer" } : null;
  }
  const vendor = await authenticateVendorRequest(req);
  if (!vendor) return null;
  const id = await resolveVendorConversationId(conversationId, vendor.id);
  return id ? { conversationId: id, actor: "seller" } : null;
}

/**
 * POST /api/delivery/conversations/:conversationId/party-location
 * Body : { latitude, longitude, accuracyMeters? }
 * L'acheteur ou le vendeur partage sa position (obligatoire pour valider le prix).
 */
router.post("/delivery/conversations/:conversationId/party-location", async (req, res): Promise<void> => {
  const conversationId = Number(req.params.conversationId);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    res.status(400).json({ error: "Conversation invalide" });
    return;
  }
  const caller = await resolveActor(req, conversationId);
  if (!caller) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }

  const { latitude, longitude, accuracyMeters } = (req.body ?? {}) as {
    latitude?: unknown;
    longitude?: unknown;
    accuracyMeters?: unknown;
  };
  if (!isValidCoordinatePair(latitude, longitude)) {
    res.status(400).json({ error: "Position GPS invalide. Activez la localisation de votre téléphone." });
    return;
  }
  const accuracy = typeof accuracyMeters === "number" && Number.isFinite(accuracyMeters) && accuracyMeters >= 0
    ? accuracyMeters
    : null;
  if (accuracy !== null && accuracy > MAX_ACCURACY_METERS) {
    res.status(400).json({ error: "Position trop imprécise. Activez le GPS en haute précision puis réessayez." });
    return;
  }

  await savePartyLocation({
    conversationId: caller.conversationId,
    actorType: caller.actor,
    latitude: latitude as number,
    longitude: longitude as number,
    accuracyMeters: accuracy,
  });

  // Si une commande existe déjà, les frais de course peuvent maintenant être calculés
  const orderId = await findLatestOrderIdForConversation(caller.conversationId);
  if (orderId) {
    await ensureOrderPricingLocked(orderId).catch((err) => {
      req.log?.warn({ err, orderId }, "Verrouillage des frais impossible après partage de position");
    });
  }
  res.json({ ok: true });
});

/**
 * GET /api/delivery/conversations/:conversationId/party-location-status
 * { buyer, seller, mine } : qui a déjà partagé sa position (jamais les coordonnées elles-mêmes).
 */
router.get("/delivery/conversations/:conversationId/party-location-status", async (req, res): Promise<void> => {
  const conversationId = Number(req.params.conversationId);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    res.status(400).json({ error: "Conversation invalide" });
    return;
  }
  const caller = await resolveActor(req, conversationId);
  if (!caller) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }
  const positions = await getPartyLocations(caller.conversationId);
  res.json({
    buyer: Boolean(positions.buyer),
    seller: Boolean(positions.seller),
    mine: Boolean(positions[caller.actor]),
  });
});

export default router;
