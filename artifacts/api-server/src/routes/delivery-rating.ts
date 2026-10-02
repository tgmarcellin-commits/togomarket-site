import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  conversationDeliveryOrdersTable,
  conversationsTable,
  db,
  deliveryAuditLogsTable,
  ordersTable,
  ratingsTable,
} from "@workspace/db";
import { resolveBuyerConversationId } from "../lib/conversation-access";

const router: IRouter = Router();

const MAX_COMMENT_LENGTH = 500;

async function latestOrderIdOfConversation(conversationId: number): Promise<number | null> {
  const [link] = await db
    .select({ orderId: conversationDeliveryOrdersTable.orderId })
    .from(conversationDeliveryOrdersTable)
    .where(eq(conversationDeliveryOrdersTable.conversationId, conversationId))
    .orderBy(desc(conversationDeliveryOrdersTable.createdAt))
    .limit(1);
  return link?.orderId ?? null;
}

/**
 * GET /api/delivery/conversations/:conversationId/rating-status    (header x-buyer-token)
 * Dit si la livraison est terminée et si l'acheteur a déjà noté le livreur.
 */
router.get("/delivery/conversations/:conversationId/rating-status", async (req, res): Promise<void> => {
  const conversationId = Number(req.params.conversationId);
  const buyerToken = req.headers["x-buyer-token"];
  if (!Number.isInteger(conversationId) || conversationId <= 0 || typeof buyerToken !== "string") {
    res.status(400).json({ error: "Requête invalide" });
    return;
  }
  const resolved = await resolveBuyerConversationId(conversationId, buyerToken);
  if (!resolved) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }

  const orderId = await latestOrderIdOfConversation(resolved);
  if (!orderId) {
    res.json({ orderId: null, delivered: false, rated: false });
    return;
  }
  const [order] = await db
    .select({ status: ordersTable.status })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);
  const [rating] = await db
    .select({ stars: ratingsTable.stars })
    .from(ratingsTable)
    .where(eq(ratingsTable.orderId, orderId))
    .limit(1);
  res.json({
    orderId,
    delivered: order?.status === "DELIVERED",
    rated: Boolean(rating),
    stars: rating?.stars ?? null,
  });
});

/**
 * POST /api/delivery/orders/:orderId/rating    (header x-buyer-token)
 * Body : { conversationId, stars (1 à 5), comment? }
 * L'acheteur note le livreur après une livraison validée par QR. Une seule note par commande.
 */
router.post("/delivery/orders/:orderId/rating", async (req, res): Promise<void> => {
  const orderId = Number(req.params.orderId);
  const { conversationId: rawConversationId, stars, comment } = (req.body ?? {}) as {
    conversationId?: unknown;
    stars?: unknown;
    comment?: unknown;
  };
  const conversationId = Number(rawConversationId);
  const buyerToken = req.headers["x-buyer-token"];
  if (!Number.isInteger(orderId) || orderId <= 0 || !Number.isInteger(conversationId) || conversationId <= 0
    || typeof buyerToken !== "string") {
    res.status(400).json({ error: "Requête invalide" });
    return;
  }
  if (typeof stars !== "number" || !Number.isInteger(stars) || stars < 1 || stars > 5) {
    res.status(400).json({ error: "La note doit être comprise entre 1 et 5 étoiles." });
    return;
  }
  const cleanComment = typeof comment === "string" ? comment.trim() : "";
  if (cleanComment.length > MAX_COMMENT_LENGTH) {
    res.status(400).json({ error: `Le commentaire est limité à ${MAX_COMMENT_LENGTH} caractères.` });
    return;
  }

  const resolved = await resolveBuyerConversationId(conversationId, buyerToken);
  if (!resolved) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    // La commande doit appartenir à cette conversation
    const [link] = await tx
      .select({ orderId: conversationDeliveryOrdersTable.orderId })
      .from(conversationDeliveryOrdersTable)
      .where(and(
        eq(conversationDeliveryOrdersTable.conversationId, resolved),
        eq(conversationDeliveryOrdersTable.orderId, orderId),
      ))
      .limit(1);
    if (!link) return "not_found" as const;

    // Verrou sur la commande : deux envois simultanés ne peuvent pas créer deux notes
    const [order] = await tx
      .select({ status: ordersTable.status })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .for("update")
      .limit(1);
    if (!order) return "not_found" as const;
    if (order.status !== "DELIVERED") return "not_delivered" as const;

    const [existing] = await tx
      .select({ id: ratingsTable.id })
      .from(ratingsTable)
      .where(eq(ratingsTable.orderId, orderId))
      .limit(1);
    if (existing) return "already_rated" as const;

    const [conversation] = await tx
      .select({ buyerPhone: conversationsTable.buyerPhone })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, resolved))
      .limit(1);

    await tx.insert(ratingsTable).values({
      orderId,
      buyerPhone: conversation?.buyerPhone ?? "",
      stars,
      comment: cleanComment || null,
    });
    await tx.insert(deliveryAuditLogsTable).values({
      actorType: "buyer",
      actorId: String(resolved),
      action: "driver_rated",
      orderId,
      metadata: { stars, hasComment: cleanComment.length > 0 },
    });
    return "created" as const;
  });

  if (outcome === "not_found") {
    res.status(404).json({ error: "Commande introuvable" });
    return;
  }
  if (outcome === "not_delivered") {
    res.status(409).json({ error: "Vous pourrez noter le livreur une fois la livraison confirmée." });
    return;
  }
  if (outcome === "already_rated") {
    res.status(409).json({ error: "Vous avez déjà noté cette livraison." });
    return;
  }
  res.status(201).json({ success: true });
});

export default router;
