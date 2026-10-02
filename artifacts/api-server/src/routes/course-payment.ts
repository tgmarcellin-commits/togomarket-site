import { Router, type IRouter, type Request } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  conversationDeliveryOrdersTable,
  db,
  deliveryWorkflowJobsTable,
  ordersTable,
} from "@workspace/db";
import { resolveBuyerConversationId } from "../lib/conversation-access";
import {
  COURSE_ENTITY_TYPE,
  confirmCoursePayment,
  createCoursePaymentLink,
  verifyCourseTransaction,
} from "../lib/course-payment";
import { paymentWebhookEventHash, verifyFedapayDriverWebhookSignature } from "../lib/fedapay-driver-webhook";
import { computeCourseTotal } from "../lib/platform-fees";

const router: IRouter = Router();

/**
 * POST /api/delivery/orders/:orderId/course-payment
 * Body : { conversationId: number }  —  Header : x-buyer-token
 * L'acheteur obtient le lien FedaPay pour payer la course, UNIQUEMENT après
 * acceptation du livreur. Le montant est calculé ici, jamais reçu du navigateur.
 */
router.post("/delivery/orders/:orderId/course-payment", async (req, res): Promise<void> => {
  const orderId = Number(req.params.orderId);
  const conversationId = Number(req.body?.conversationId);
  const buyerToken = req.headers["x-buyer-token"];
  if (!Number.isInteger(orderId) || orderId <= 0 || !Number.isInteger(conversationId) || conversationId <= 0
    || typeof buyerToken !== "string") {
    res.status(400).json({ error: "Requête invalide" });
    return;
  }

  const resolvedConversationId = await resolveBuyerConversationId(conversationId, buyerToken);
  if (!resolvedConversationId) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }

  // La commande doit appartenir à cette conversation
  const [link] = await db
    .select({ orderId: conversationDeliveryOrdersTable.orderId })
    .from(conversationDeliveryOrdersTable)
    .where(and(
      eq(conversationDeliveryOrdersTable.conversationId, resolvedConversationId),
      eq(conversationDeliveryOrdersTable.orderId, orderId),
    ))
    .orderBy(desc(conversationDeliveryOrdersTable.createdAt))
    .limit(1);
  if (!link) {
    res.status(404).json({ error: "Commande introuvable" });
    return;
  }

  const [order] = await db
    .select({
      id: ordersTable.id,
      firstName: ordersTable.firstName,
      phone: ordersTable.phone,
      articlePriceLocked: ordersTable.articlePriceLocked,
      transportFeeLocked: ordersTable.transportFeeLocked,
      driverPaymentConfirmedAt: ordersTable.driverPaymentConfirmedAt,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);
  if (!order) {
    res.status(404).json({ error: "Commande introuvable" });
    return;
  }
  if (order.driverPaymentConfirmedAt) {
    res.status(409).json({ error: "La course est déjà payée" });
    return;
  }
  if (!order.transportFeeLocked || order.transportFeeLocked <= 0) {
    res.status(409).json({ error: "Les frais de transport ne sont pas encore verrouillés" });
    return;
  }

  const [activeJob] = await db
    .select({ id: deliveryWorkflowJobsTable.id })
    .from(deliveryWorkflowJobsTable)
    .where(and(
      eq(deliveryWorkflowJobsTable.orderId, orderId),
      eq(deliveryWorkflowJobsTable.acceptanceStatus, "accepted_by_driver"),
    ))
    .limit(1);
  if (!activeJob) {
    res.status(409).json({ error: "Le paiement est possible après acceptation de la course par le livreur" });
    return;
  }

  const breakdown = computeCourseTotal(order);
  try {
    const { paymentUrl } = await createCoursePaymentLink({
      orderId,
      amount: breakdown.total,
      customerName: order.firstName,
      customerPhone: order.phone,
    });
    res.json({ paymentUrl, breakdown });
  } catch (err) {
    req.log?.error({ err, orderId }, "Création du paiement de course impossible");
    res.status(502).json({ error: "Paiement momentanément indisponible, réessayez" });
  }
});

/**
 * POST /api/fedapay-driver-callback  (webhook du compte « Marketplace Livraison »)
 * Signature obligatoire (FEDAPAY_DRIVER_WEBHOOK_SECRET). La transaction est relue chez
 * FedaPay avant toute confirmation.
 */
router.post("/fedapay-driver-callback", async (req: Request, res): Promise<void> => {
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const signature = req.headers["x-fedapay-signature"];
  if (!rawBody || !verifyFedapayDriverWebhookSignature(rawBody, typeof signature === "string" ? signature : undefined)) {
    res.status(401).json({ error: "Signature invalide" });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
  } catch {
    res.status(400).json({ error: "Corps invalide" });
    return;
  }
  const eventName = String(body["name"] ?? body["event"] ?? "");
  if (eventName !== "transaction.approved") {
    res.status(200).json({ received: true, skipped: true });
    return;
  }

  // Même format que le webhook FedaPay existant : data.object = la transaction
  const data = (body["data"] ?? {}) as Record<string, unknown>;
  const transaction = (data["object"] ?? body["entity"] ?? {}) as Record<string, unknown>;
  const transactionId = String(transaction["id"] ?? "");
  const verified = await verifyCourseTransaction(transactionId);
  if (!verified) {
    // 503 : FedaPay réessaiera plus tard (vérification momentanément impossible)
    res.status(503).json({ error: "Vérification de la transaction impossible" });
    return;
  }
  if (verified.entityType !== COURSE_ENTITY_TYPE || !verified.approved
    || !Number.isInteger(verified.orderId) || verified.orderId <= 0) {
    res.status(200).json({ received: true, skipped: true });
    return;
  }

  const result = await confirmCoursePayment({
    orderId: verified.orderId,
    transactionId,
    amount: verified.amount,
    currency: verified.currency,
    eventName,
    eventHash: paymentWebhookEventHash(rawBody),
    payload: body,
  });
  res.status(200).json({ received: true, result: result.status });
});

export default router;