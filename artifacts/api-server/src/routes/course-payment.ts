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
  payCourseWithBalances,
  quoteCoursePayment,
  verifyCourseTransaction,
} from "../lib/course-payment";
import { BusinessRuleError } from "../lib/route-errors";
import { paymentWebhookEventHash, verifyFedapayDriverWebhookSignature } from "../lib/fedapay-driver-webhook";
import { computeCourseTotal } from "../lib/platform-fees";
import { PAYMENT_CONFIRMATION_TIMEOUT_MS } from "../lib/delivery-assignment-guard";
import { ensureOrderPricingLocked } from "../lib/party-locations";
import { handlePayoutWebhook } from "../lib/wallet-payouts";

const router: IRouter = Router();

/**
 * POST /api/delivery/orders/:orderId/course-payment
 * Body : { conversationId: number, useWallet?: boolean, useGame?: boolean }  —  Header : x-buyer-token
 * Le solde du portefeuille acheteur est utilisé en premier (sauf useWallet=false) ; FedaPay ne couvre que
 * la différence. Si le solde suffit, la course est réglée tout de suite, sans passer par FedaPay.
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

  // Distance et frais calculés ici si les deux positions GPS sont connues et que ce n'est pas encore fait
  await ensureOrderPricingLocked(orderId).catch(() => undefined);

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
    res.status(409).json({
      error: "Les positions GPS de l'acheteur et du vendeur sont nécessaires pour calculer la course. Chacun doit partager sa position dans la conversation.",
    });
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

  const useWallet = (req.body as { useWallet?: unknown } | undefined)?.useWallet !== false;
  const useGame = (req.body as { useGame?: unknown } | undefined)?.useGame !== false;
  const quote = await quoteCoursePayment({ order, conversationId: resolvedConversationId, useWallet, useGame });

  // Solde suffisant : réglé immédiatement avec le portefeuille, aucun appel FedaPay
  if (quote.cardAmount === 0) {
    try {
      const outcome = await payCourseWithBalances(orderId, { walletApplied: quote.walletApplied, gameApplied: quote.gameApplied });
      if (outcome.status === "confirmed") {
        res.json({ paid: true, method: "wallet", quote });
        return;
      }
      res.status(409).json({
        error: outcome.status === "already_confirmed"
          ? "La course est déjà payée"
          : "Le paiement n'a pas pu être enregistré. Réessayez dans un instant.",
      });
    } catch (err) {
      if (err instanceof BusinessRuleError) {
        const rule = err as BusinessRuleError;
        res.status(rule.status).json({ error: rule.message });
        return;
      }
      req.log?.error({ err, orderId }, "Paiement de la course avec le solde impossible");
      res.status(500).json({ error: "Paiement momentanément indisponible, réessayez" });
    }
    return;
  }

  try {
    const { paymentUrl } = await createCoursePaymentLink({
      orderId,
      amount: quote.cardAmount,
      walletApplied: quote.walletApplied,
      gameApplied: quote.gameApplied,
      customerName: order.firstName,
      customerPhone: order.phone,
    });
    res.json({ paymentUrl, breakdown: computeCourseTotal(order), quote });
  } catch (err) {
    req.log?.error({ err, orderId }, "Création du paiement de course impossible");
    res.status(502).json({ error: "Paiement momentanément indisponible, réessayez" });
  }
});

/**
 * GET /api/delivery/conversations/:conversationId/course-payment-status
 * Header : x-buyer-token
 * Dit à l'écran de l'acheteur s'il doit afficher « Payer la course » :
 * le livreur a accepté, la course n'est pas encore payée, et combien il doit payer.
 */
router.get("/delivery/conversations/:conversationId/course-payment-status", async (req, res): Promise<void> => {
  const conversationId = Number(req.params.conversationId);
  const buyerToken = req.headers["x-buyer-token"];
  if (!Number.isInteger(conversationId) || conversationId <= 0 || typeof buyerToken !== "string") {
    res.status(400).json({ error: "Requête invalide" });
    return;
  }
  const resolvedConversationId = await resolveBuyerConversationId(conversationId, buyerToken);
  if (!resolvedConversationId) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }

  const [link] = await db
    .select({ orderId: conversationDeliveryOrdersTable.orderId })
    .from(conversationDeliveryOrdersTable)
    .where(eq(conversationDeliveryOrdersTable.conversationId, resolvedConversationId))
    .orderBy(desc(conversationDeliveryOrdersTable.createdAt))
    .limit(1);
  if (!link) {
    res.json({ orderId: null, driverAccepted: false, paid: false });
    return;
  }

  await ensureOrderPricingLocked(link.orderId).catch(() => undefined);

  const [order] = await db
    .select({
      id: ordersTable.id,
      status: ordersTable.status,
      articlePriceLocked: ordersTable.articlePriceLocked,
      transportFeeLocked: ordersTable.transportFeeLocked,
      driverPaymentConfirmedAt: ordersTable.driverPaymentConfirmedAt,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, link.orderId))
    .limit(1);
  if (!order) {
    res.json({ orderId: null, driverAccepted: false, paid: false });
    return;
  }

  const [job] = await db
    .select({ acceptedAt: deliveryWorkflowJobsTable.acceptedAt })
    .from(deliveryWorkflowJobsTable)
    .where(and(
      eq(deliveryWorkflowJobsTable.orderId, order.id),
      eq(deliveryWorkflowJobsTable.acceptanceStatus, "accepted_by_driver"),
    ))
    .limit(1);

  const paid = Boolean(order.driverPaymentConfirmedAt);
  const driverAccepted = Boolean(job);
  const quote = !paid && order.transportFeeLocked && order.transportFeeLocked > 0
    ? await quoteCoursePayment({ order, conversationId: resolvedConversationId })
    : null;
  const timeoutEnabled = process.env.DISABLE_PAYMENT_TIMEOUT !== "true";
  const paymentDeadlineAt = job?.acceptedAt && !paid && timeoutEnabled
    ? new Date(job.acceptedAt.getTime() + PAYMENT_CONFIRMATION_TIMEOUT_MS).toISOString()
    : null;

  res.json({
    orderId: order.id,
    orderStatus: order.status,
    driverAccepted,
    paid,
    paidAt: order.driverPaymentConfirmedAt?.toISOString() ?? null,
    paymentDeadlineAt,
    // Le détail n'est utile (et exact) que lorsque les frais de transport sont verrouillés
    breakdown: order.transportFeeLocked && order.transportFeeLocked > 0 ? computeCourseTotal(order) : null,
    // Règlement prévu : solde utilisé, reste à payer par FedaPay, solde conservé
    wallet: quote
      ? {
          balance: quote.walletBalance,
          phoneVerified: quote.phoneVerified,
          applied: quote.walletApplied,
          gameBalance: quote.gameBalance,
          gameEligible: quote.gameEligible,
          gameApplied: quote.gameApplied,
          cardAmount: quote.cardAmount,
          remaining: quote.walletRemaining,
        }
      : null,
  });
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
    // Cause la plus fréquente : FEDAPAY_DRIVER_WEBHOOK_SECRET différent du secret du webhook (test et live ont chacun le leur)
    req.log?.warn(
      { hasRawBody: Boolean(rawBody), hasSignature: typeof signature === "string", hasSecret: Boolean(process.env.FEDAPAY_DRIVER_WEBHOOK_SECRET) },
      "Webhook FedaPay Marketplace : signature invalide",
    );
    res.status(401).json({ error: "Signature invalide" });
    return;
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: "Corps invalide" });
      return;
    }
    const eventName = String(body["name"] ?? body["event"] ?? "");

    // Retraits : payout.sent / payout.failed (le virement est relu chez FedaPay avant toute écriture)
    if (eventName === "payout.sent" || eventName === "payout.failed") {
      const payoutEntity = (body["entity"] ?? (body["data"] as Record<string, unknown> | undefined)?.["object"] ?? {}) as Record<string, unknown>;
      const payoutId = String(payoutEntity["id"] ?? "");
      if (!payoutId) {
        res.status(200).json({ received: true, skipped: true, reason: "payout_id_missing" });
        return;
      }
      const outcome = await handlePayoutWebhook({
        payoutId,
        eventName,
        eventHash: paymentWebhookEventHash(rawBody),
        payload: body,
      });
      req.log?.info({ eventName, payoutId, result: outcome.outcome }, "Webhook FedaPay Marketplace : retrait traité");
      res.status(outcome.http).json({ received: outcome.http === 200, result: outcome.outcome });
      return;
    }

    if (eventName !== "transaction.approved") {
      req.log?.info({ eventName }, "Webhook FedaPay Marketplace : événement ignoré");
      res.status(200).json({ received: true, skipped: true, reason: "event_not_handled", eventName });
      return;
    }

    // Même format que le webhook FedaPay existant : data.object = la transaction
    const data = (body["data"] ?? {}) as Record<string, unknown>;
    const transaction = (data["object"] ?? body["entity"] ?? {}) as Record<string, unknown>;
    const transactionId = String(transaction["id"] ?? "");
    const verified = await verifyCourseTransaction(transactionId);
    if (!verified) {
      // 503 : FedaPay réessaiera plus tard. Cause la plus fréquente : FEDAPAY_MARKETPLACE_SECRET_KEY du mauvais compte ou du mauvais mode (test / live)
      req.log?.warn({ transactionId }, "Webhook FedaPay Marketplace : transaction illisible chez FedaPay (clé API du bon compte et du bon mode ?)");
      res.status(503).json({ error: "Vérification de la transaction impossible", reason: "verification_failed" });
      return;
    }
    if (verified.entityType !== COURSE_ENTITY_TYPE || !verified.approved
      || !Number.isInteger(verified.orderId) || verified.orderId <= 0) {
      // Ce n'est pas le paiement d'une course (ou il n'est pas approuvé) : rien à faire
      req.log?.info(
        { transactionId, entityType: verified.entityType, approved: verified.approved, orderId: verified.orderId },
        "Webhook FedaPay Marketplace : transaction qui n'est pas un paiement de course",
      );
      res.status(200).json({
        received: true,
        skipped: true,
        reason: !verified.approved ? "not_approved" : "not_a_course_payment",
        entityType: verified.entityType || null,
      });
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
      walletApplied: verified.walletApplied,
      gameApplied: verified.gameApplied,
    });
    // « confirmed » = course payée. Toute autre valeur explique pourquoi la course reste non payée
    // (amount_mismatch, no_active_job, order_not_found, already_confirmed, duplicate, wallet_changed_credited).
    req.log?.info(
      { orderId: verified.orderId, transactionId, amount: verified.amount, walletApplied: verified.walletApplied, gameApplied: verified.gameApplied, result: result.status },
      "Webhook FedaPay Marketplace : paiement de course traité",
    );
    res.status(200).json({
      received: true,
      result: result.status,
      ...("detail" in result && result.detail ? { detail: result.detail } : {}),
    });
  } catch (err) {
    req.log?.error({ err }, "Webhook FedaPay Marketplace : traitement impossible");
    res.status(500).json({ error: "Erreur interne" });
  }
});

export default router;
