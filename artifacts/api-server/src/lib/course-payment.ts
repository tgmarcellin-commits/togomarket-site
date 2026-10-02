import { and, desc, eq, isNull } from "drizzle-orm";
import {
  conversationDeliveryOrdersTable,
  db,
  deliveryAuditLogsTable,
  deliveryWorkflowJobsTable,
  driversTable,
  ordersTable,
  paymentWebhooksTable,
  virtualWalletsTable,
  whatsappNotificationsTable,
} from "@workspace/db";
import { postBalancedJournalEntry, STANDARD_ACCOUNTS } from "./accounting-ledger";
import { computeCourseTotal } from "./platform-fees";
import { normalizePhone } from "./phone";
import { getOrCreateVirtualWallet, recordWalletMovement } from "./wallet-service";
import { getIo } from "./socket-io";
import { sendWhatsAppUtilityTemplate } from "./whatsapp-api";
import { logger } from "./logger";
import { createDriverNotification } from "./driver-notifications";
import { sendDriverPush } from "./driver-push";

/**
 * Paiement de la course par l'acheteur — compte FedaPay « Marketplace Livraison ».
 * N'utilise QUE FEDAPAY_MARKETPLACE_* (jamais FEDAPAY_SECRET_KEY, réservé aux abonnements).
 */
const COURSE_CURRENCY = "XOF";
/** Nom du modèle WhatsApp (catégorie Utilitaire) ; surchargeable par WHATSAPP_PAYMENT_TEMPLATE_NAME. */
const DEFAULT_PAYMENT_TEMPLATE_NAME = "driver_payment_confirmed_utility";
export const COURSE_ENTITY_TYPE = "driver_course";

function marketplaceSecretKey(): string {
  return process.env.FEDAPAY_MARKETPLACE_SECRET_KEY?.trim() ?? "";
}

function isLiveEnvironment(): boolean {
  const publicKey = process.env.FEDAPAY_MARKETPLACE_PUBLIC_KEY?.trim() ?? "";
  const secretKey = marketplaceSecretKey();
  return publicKey.startsWith("pk_live") || secretKey.startsWith("sk_live");
}

function baseUrl(): string {
  return isLiveEnvironment() ? "https://api.fedapay.com/v1" : "https://sandbox-api.fedapay.com/v1";
}

function unwrapTransaction(json: Record<string, unknown>): Record<string, unknown> {
  // La réponse FedaPay REST porte la clé littérale "v1/transaction" (avec slash)
  return (
    json["v1/transaction"]
    ?? (json["v1"] as Record<string, unknown> | undefined)?.["transaction"]
    ?? json["transaction"]
    ?? json
  ) as Record<string, unknown>;
}

function readCurrency(raw: unknown): string {
  return typeof raw === "object" && raw
    ? String((raw as Record<string, unknown>)["iso"] ?? "")
    : String(raw ?? "");
}

function phoneCountry(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("229")) return "BJ";
  if (digits.startsWith("225")) return "CI";
  if (digits.startsWith("221")) return "SN";
  if (digits.startsWith("227")) return "NE";
  return "TG";
}

/** Crée la transaction FedaPay de la course et renvoie le lien de paiement. */
export async function createCoursePaymentLink(params: {
  orderId: number;
  amount: number;
  customerName: string;
  customerPhone: string;
}): Promise<{ transactionId: string; paymentUrl: string }> {
  const key = marketplaceSecretKey();
  if (!key) throw new Error("FEDAPAY_MARKETPLACE_SECRET_KEY manquante");
  if (!Number.isInteger(params.amount) || params.amount <= 0) throw new Error("Montant de course invalide");

  const phone = normalizePhone(params.customerPhone);
  const res = await fetch(`${baseUrl()}/transactions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      description: `Course TogoMarket - commande #${params.orderId}`,
      amount: params.amount,
      currency: { iso: COURSE_CURRENCY },
      callback_url: process.env.PUBLIC_SITE_URL?.trim() || "https://togomarket.site",
      customer: {
        firstname: params.customerName,
        phone_number: { number: phone, country: phoneCountry(phone) },
      },
      custom_metadata: { entityType: COURSE_ENTITY_TYPE, orderId: String(params.orderId) },
      include_fees: true, // frais passerelle FedaPay ajoutés au paiement de l'acheteur
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`FedaPay: création refusée (${res.status})`);

  const tx = unwrapTransaction(await res.json() as Record<string, unknown>);
  const paymentUrl = String(tx["payment_url"] ?? "");
  if (!paymentUrl) throw new Error("FedaPay: payment_url absent de la réponse");
  return { transactionId: String(tx["id"] ?? ""), paymentUrl };
}

export type VerifiedCourseTransaction = {
  approved: boolean;
  amount: number;
  currency: string;
  orderId: number;
  entityType: string;
};

/** Relit la transaction chez FedaPay : on ne se fie jamais au corps du webhook seul. */
export async function verifyCourseTransaction(transactionId: string): Promise<VerifiedCourseTransaction | null> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(transactionId)) return null;
  const key = marketplaceSecretKey();
  if (!key) return null;
  try {
    const res = await fetch(`${baseUrl()}/transactions/${transactionId}`, {
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const tx = unwrapTransaction(await res.json() as Record<string, unknown>);
    const metadata = (tx["custom_metadata"] ?? {}) as Record<string, unknown>;
    return {
      approved: String(tx["status"] ?? "") === "approved",
      // le montant FedaPay peut être flottant : conversion immédiate en entier (cahier des charges, section 18)
      amount: Math.round(Number(tx["amount"] ?? 0)),
      currency: readCurrency(tx["currency"]),
      orderId: Number.parseInt(String(metadata["orderId"] ?? "0"), 10),
      entityType: String(metadata["entityType"] ?? ""),
    };
  } catch {
    return null;
  }
}

export type ConfirmCoursePaymentResult =
  | { status: "confirmed"; driverId: number; deliveryJobId: number; conversationId: number | null }
  | { status: "duplicate" | "order_not_found" | "amount_mismatch" | "no_active_job" | "already_confirmed" };

/**
 * Enregistre le paiement de la course : renseigne `orders.driver_payment_confirmed_at`
 * (ce qui autorise le départ du livreur et le partage de sa position), met l'argent
 * en séquestre (ledger + portefeuille acheteur). Idempotent via `payment_webhooks.event_hash`.
 */
export async function confirmCoursePayment(params: {
  orderId: number;
  transactionId: string;
  amount: number;
  currency: string;
  eventName: string;
  eventHash: string;
  payload: Record<string, unknown>;
}): Promise<ConfirmCoursePaymentResult> {
  const now = new Date();
  const result = await db.transaction(async (tx): Promise<ConfirmCoursePaymentResult> => {
    const inserted = await tx
      .insert(paymentWebhooksTable)
      .values({
        eventHash: params.eventHash,
        provider: "fedapay_marketplace",
        eventName: params.eventName,
        payload: params.payload,
      })
      .onConflictDoNothing()
      .returning({ id: paymentWebhooksTable.id });
    if (inserted.length === 0) return { status: "duplicate" };

    const finish = async (
      status: Exclude<ConfirmCoursePaymentResult["status"], "confirmed" | "duplicate">,
      action: string,
      extra: Record<string, unknown> = {},
    ): Promise<ConfirmCoursePaymentResult> => {
      await tx.update(paymentWebhooksTable)
        .set({ processed: true, processedAt: now })
        .where(eq(paymentWebhooksTable.eventHash, params.eventHash));
      await tx.insert(deliveryAuditLogsTable).values({
        actorType: "system",
        actorId: "fedapay_marketplace",
        action,
        orderId: status === "order_not_found" ? null : params.orderId,
        metadata: { transactionId: params.transactionId, amount: params.amount, currency: params.currency, ...extra },
      });
      return { status };
    };

    const [order] = await tx
      .select({
        id: ordersTable.id,
        articlePriceLocked: ordersTable.articlePriceLocked,
        transportFeeLocked: ordersTable.transportFeeLocked,
        driverPaymentConfirmedAt: ordersTable.driverPaymentConfirmedAt,
      })
      .from(ordersTable)
      .where(eq(ordersTable.id, params.orderId))
      .for("update")
      .limit(1);
    if (!order) return finish("order_not_found", "course_payment_order_not_found");

    const expected = computeCourseTotal(order);
    if (params.currency !== COURSE_CURRENCY || params.amount !== expected.total) {
      return finish("amount_mismatch", "course_payment_amount_mismatch", { expectedAmount: expected.total });
    }
    // Second paiement reçu : à rembourser manuellement (jamais confirmé deux fois)
    if (order.driverPaymentConfirmedAt) return finish("already_confirmed", "course_payment_duplicate_received");

    const [job] = await tx
      .select({ id: deliveryWorkflowJobsTable.id, driverId: deliveryWorkflowJobsTable.driverId })
      .from(deliveryWorkflowJobsTable)
      .where(and(
        eq(deliveryWorkflowJobsTable.orderId, order.id),
        eq(deliveryWorkflowJobsTable.acceptanceStatus, "accepted_by_driver"),
      ))
      .limit(1);
    // Mission annulée/expirée entre-temps : argent reçu, à rembourser manuellement
    if (!job) return finish("no_active_job", "course_payment_without_active_job");

    const [updated] = await tx
      .update(ordersTable)
      .set({ driverPaymentConfirmedAt: now })
      .where(and(eq(ordersTable.id, order.id), isNull(ordersTable.driverPaymentConfirmedAt)))
      .returning({ id: ordersTable.id });
    if (!updated) return finish("already_confirmed", "course_payment_duplicate_received");

    // Séquestre : débit compensation FedaPay / crédit dépôt séquestre acheteur
    await postBalancedJournalEntry({
      journalReference: `JRN_PAY_${order.id}`,
      legs: [{
        debitAccountCode: STANDARD_ACCOUNTS.FEDAPAY_CLEARING.code,
        creditAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
        amount: expected.total,
        description: `Encaissement course commande #${order.id} (article + livreur + commission acheteur)`,
      }],
      metadata: { orderId: order.id, transactionId: params.transactionId, breakdown: expected },
    }, tx);

    // Portefeuille acheteur : montant mis en séquestre (même convention que settlement-service)
    const [convOrder] = await tx
      .select({ conversationId: conversationDeliveryOrdersTable.conversationId })
      .from(conversationDeliveryOrdersTable)
      .where(eq(conversationDeliveryOrdersTable.orderId, order.id))
      .orderBy(desc(conversationDeliveryOrdersTable.createdAt))
      .limit(1);
    if (convOrder) {
      const wallet = await getOrCreateVirtualWallet("buyer", convOrder.conversationId, tx);
      const newLocked = wallet.lockedBalance + expected.total;
      await tx.update(virtualWalletsTable)
        .set({ lockedBalance: newLocked, updatedAt: now })
        .where(eq(virtualWalletsTable.id, wallet.id));
      await recordWalletMovement({
        walletId: wallet.id,
        orderId: order.id,
        entryType: "buyer_escrow_deposit",
        amount: expected.total,
        direction: "credit",
        balanceAfter: wallet.balance,
        settlementRef: `PAY_${order.id}`,
        metadata: { orderId: order.id, transactionId: params.transactionId, breakdown: expected },
      }, tx);
    }

    await tx.update(paymentWebhooksTable)
      .set({ processed: true, processedAt: now })
      .where(eq(paymentWebhooksTable.eventHash, params.eventHash));
    await tx.insert(deliveryAuditLogsTable).values({
      actorType: "system",
      actorId: "fedapay_marketplace",
      action: "course_payment_confirmed",
      orderId: order.id,
      metadata: { transactionId: params.transactionId, deliveryJobId: job.id, breakdown: expected },
    });

    return {
      status: "confirmed",
      driverId: job.driverId,
      deliveryJobId: job.id,
      conversationId: convOrder?.conversationId ?? null,
    };
  });

  if (result.status === "confirmed") {
    await notifyCoursePaid(params.orderId, result).catch(() => {
      // la confirmation est déjà enregistrée : une notification ratée ne doit jamais la remettre en cause
    });
  }
  return result;
}

async function notifyCoursePaid(
  orderId: number,
  info: { driverId: number; deliveryJobId: number; conversationId: number | null },
): Promise<void> {
  const payload = { orderId, deliveryJobId: info.deliveryJobId, paidAt: new Date().toISOString() };
  try {
    const io = getIo();
    io.to(`order_${orderId}`).emit("course_payment_confirmed", payload);
    if (info.conversationId) io.to(`conv:${info.conversationId}`).emit("course_payment_confirmed", payload);
  } catch {
    // serveur socket absent (tests)
  }
  // Notification dans le tableau de bord du livreur connecté (secours du message WhatsApp).
  // Créée dans tous les cas : le livreur la voit même si WhatsApp n'est pas livré.
  await createDriverNotification({
    driverId: info.driverId,
    orderId,
    kind: "course_payment_confirmed",
    title: "Course payée : vous pouvez partir",
    body: `Le paiement de la course #${orderId} est confirmé. Rendez-vous chez le vendeur : les détails de la commande sont sur cette page.`,
  });
  // Notification Web Push sur les appareils du livreur abonnés (ne lève jamais d'erreur).
  await sendDriverPush(info.driverId, {
    title: "Course payée : vous pouvez partir",
    body: `Le paiement de la course #${orderId} est confirmé. Ouvrez votre espace livreur pour les détails.`,
    url: "/driver-connexion",
    tag: `course-paid-${orderId}`,
  });

  const [driver] = await db
    .select({ phone: driversTable.phone, whatsappNumber: driversTable.whatsappNumber })
    .from(driversTable)
    .where(eq(driversTable.id, info.driverId))
    .limit(1);
  const target = driver?.whatsappNumber || driver?.phone;
  if (!target) return;

  // Rappel WhatsApp via un modèle UTILITAIRE approuvé par Meta (un texte libre n'est livré
  // que dans les 24 h suivant un message du livreur). Une seule variable : {{1}} = n° de course.
  const templateName = process.env.WHATSAPP_PAYMENT_TEMPLATE_NAME?.trim() || DEFAULT_PAYMENT_TEMPLATE_NAME;
  try {
    await sendWhatsAppUtilityTemplate(target, templateName, [String(orderId)]);
    await logWhatsAppNotification(target, templateName, orderId, "sent", null);
  } catch (err) {
    logger.warn({ err, orderId }, "WhatsApp : rappel de paiement de course non envoyé");
    // Statut « fallback_triggered » : WhatsApp a échoué, la notification du tableau de bord prend le relais.
    await logWhatsAppNotification(
      target,
      templateName,
      orderId,
      "fallback_triggered",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Journal des envois WhatsApp (cahier des charges, section 20.5). Ne doit jamais faire échouer le paiement. */
async function logWhatsAppNotification(
  recipientPhone: string,
  templateName: string,
  orderId: number,
  deliveryStatus: "sent" | "failed" | "fallback_triggered",
  errorMessage: string | null,
): Promise<void> {
  try {
    await db.insert(whatsappNotificationsTable).values({
      recipientPhone,
      messageContent: `[template ${templateName}] course #${orderId} payée`,
      deliveryStatus,
      providerResponse: errorMessage ? { error: errorMessage } : null,
    });
  } catch (err) {
    logger.warn({ err, orderId }, "Journal WhatsApp : écriture impossible");
  }
}
      
