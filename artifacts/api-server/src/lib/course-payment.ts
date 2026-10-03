import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  conversationDeliveryOrdersTable,
  conversationsTable,
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
import { BusinessRuleError } from "./route-errors";
import { normalizePhone } from "./phone";
import { getOrCreateVirtualWallet, recordWalletMovement } from "./wallet-service";
import { getBuyerAccountView } from "./buyer-accounts";
import type { DbOrTx } from "./accounting-ledger";
import { getIo } from "./socket-io";
import { sendWhatsAppUtilityTemplate } from "./whatsapp-api";
import { logger } from "./logger";
import { createDriverNotification } from "./driver-notifications";
import { sendDriverPush } from "./driver-push";
import { sendVendorPush } from "./vendor-push";

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
  /** Montant à payer par FedaPay = total de la course - solde utilisé. */
  amount: number;
  /** Part réglée avec le solde du portefeuille acheteur (0 si aucune). */
  walletApplied?: number;
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
      custom_metadata: {
        entityType: COURSE_ENTITY_TYPE,
        orderId: String(params.orderId),
        walletApplied: String(params.walletApplied ?? 0),
      },
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
  /** Part réglée avec le solde du portefeuille, lue dans les métadonnées de la transaction. */
  walletApplied: number;
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
      walletApplied: Math.max(0, Number.parseInt(String(metadata["walletApplied"] ?? "0"), 10) || 0),
    };
  } catch {
    return null;
  }
}

export type CoursePaymentQuote = {
  articlePrice: number;
  driverFee: number;
  buyerCommission: number;
  /** Total de la course (article + livreur + 250 FCFA). */
  total: number;
  /** Solde utilisable du portefeuille unique du numéro (0 tant que le numéro n'est pas vérifié par code WhatsApp). */
  walletBalance: number;
  /** Le numéro de l'acheteur a-t-il été vérifié ? Sans cela, le solde n'est ni visible ni utilisable. */
  phoneVerified: boolean;
  /** Part du total réglée avec le solde (0 si l'acheteur ne l'utilise pas). */
  walletApplied: number;
  /** Reste à payer par FedaPay (0 = entièrement réglé avec le solde). */
  cardAmount: number;
  /** Solde qui restera disponible après le paiement. */
  walletRemaining: number;
};

/**
 * Calcule comment la course sera réglée : le solde du portefeuille (unique par numéro) est utilisé en premier,
 * FedaPay ne couvre que la différence, et ce qui reste du solde reste disponible.
 */
export async function quoteCoursePayment(params: {
  order: { articlePriceLocked: number | null; transportFeeLocked: number | null };
  conversationId: number | null;
  useWallet?: boolean;
}): Promise<CoursePaymentQuote> {
  const breakdown = computeCourseTotal(params.order);
  let walletBalance = 0;
  let phoneVerified = false;
  if (params.conversationId) {
    const view = await getBuyerAccountView(params.conversationId);
    phoneVerified = Boolean(view?.verified);
    walletBalance = view?.verified ? view.balance : 0;
  }
  const walletApplied = params.useWallet === false ? 0 : Math.min(walletBalance, breakdown.total);
  return {
    ...breakdown,
    walletBalance,
    phoneVerified,
    walletApplied,
    cardAmount: breakdown.total - walletApplied,
    walletRemaining: walletBalance - walletApplied,
  };
}

type LockedWallet = { id: number; ownerId: number; balance: number; lockedBalance: number };

/**
 * Verrouille (FOR UPDATE) le portefeuille unique du numéro de la conversation.
 * `spendable` = solde dépensable : nul tant que le numéro n'est pas vérifié par code WhatsApp.
 */
async function lockBuyerAccountWallet(
  tx: DbOrTx,
  conversationId: number,
): Promise<{ wallet: LockedWallet; spendable: boolean }> {
  const view = await getBuyerAccountView(conversationId, tx);
  if (!view) throw new Error("Compte acheteur introuvable");
  const [row] = await tx
    .select({
      id: virtualWalletsTable.id,
      ownerId: virtualWalletsTable.ownerId,
      balance: virtualWalletsTable.balance,
      lockedBalance: virtualWalletsTable.lockedBalance,
    })
    .from(virtualWalletsTable)
    .where(eq(virtualWalletsTable.id, view.walletId))
    .for("update")
    .limit(1);
  if (!row) throw new Error("Portefeuille acheteur introuvable");
  return { wallet: row, spendable: view.verified };
}

export type ConfirmCoursePaymentResult =
  | { status: "confirmed"; driverId: number; deliveryJobId: number; conversationId: number | null }
  | {
      status:
        | "duplicate"
        | "order_not_found"
        | "amount_mismatch"
        | "no_active_job"
        | "already_confirmed"
        | "wallet_changed_credited";
    };

/**
 * Enregistre le paiement de la course : renseigne `orders.driver_payment_confirmed_at`
 * (ce qui autorise le départ du livreur et le partage de sa position), met l'argent
 * en séquestre (ledger + portefeuille acheteur). Idempotent via `payment_webhooks.event_hash`.
 *
 * Deux sources de fonds, cumulables :
 *  - le solde du portefeuille acheteur (`walletApplied`), débité ici dans la même transaction ;
 *  - FedaPay (`amount`), pour la différence.
 * Si le solde a diminué entre la création du lien et le paiement (retrait entre-temps), la commande n'est PAS
 * confirmée : la somme reçue par FedaPay est créditée au portefeuille de l'acheteur (`wallet_changed_credited`),
 * qui peut alors repayer sans rien perdre.
 */
export async function confirmCoursePayment(params: {
  orderId: number;
  transactionId: string;
  /** Montant réellement encaissé par FedaPay (0 pour un paiement 100 % solde). */
  amount: number;
  currency: string;
  eventName: string;
  eventHash: string;
  payload: Record<string, unknown>;
  /** Part réglée avec le solde du portefeuille acheteur. */
  walletApplied?: number;
  /** "wallet" = paiement entièrement réglé avec le solde (aucune transaction FedaPay). */
  source?: "fedapay" | "wallet";
}): Promise<ConfirmCoursePaymentResult> {
  const now = new Date();
  const source = params.source ?? "fedapay";
  const walletApplied = Math.max(0, Math.round(params.walletApplied ?? 0));
  const result = await db.transaction(async (tx): Promise<ConfirmCoursePaymentResult> => {
    const inserted = await tx
      .insert(paymentWebhooksTable)
      .values({
        eventHash: params.eventHash,
        provider: source === "wallet" ? "wallet_internal" : "fedapay_marketplace",
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
        actorId: source === "wallet" ? "wallet_internal" : "fedapay_marketplace",
        action,
        orderId: status === "order_not_found" ? null : params.orderId,
        metadata: { transactionId: params.transactionId, amount: params.amount, currency: params.currency, walletApplied, ...extra },
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
    // Le total doit être couvert exactement : encaissement FedaPay + solde du portefeuille
    const currencyOk = source === "wallet" || params.currency === COURSE_CURRENCY;
    if (!currencyOk || walletApplied > expected.total || params.amount + walletApplied !== expected.total) {
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

    // Portefeuilles acheteur (verrouillés : pas de double utilisation du solde)
    const [convOrder] = await tx
      .select({ conversationId: conversationDeliveryOrdersTable.conversationId })
      .from(conversationDeliveryOrdersTable)
      .where(eq(conversationDeliveryOrdersTable.orderId, order.id))
      .orderBy(desc(conversationDeliveryOrdersTable.createdAt))
      .limit(1);

    const funding = convOrder ? await lockBuyerAccountWallet(tx, convOrder.conversationId) : null;
    // Le solde n'est dépensable qu'une fois le numéro vérifié par code WhatsApp
    const spendable = funding?.spendable ? funding.wallet.balance : 0;

    if (walletApplied > 0 && spendable < walletApplied) {
      if (source === "wallet") {
        throw new BusinessRuleError(
          funding && !funding.spendable
            ? "Vérifiez votre numéro de téléphone par code WhatsApp pour utiliser votre solde."
            : "Solde insuffisant pour régler cette course avec votre portefeuille.",
          409,
        );
      }
      // Le solde a diminué depuis la création du lien : l'argent reçu de FedaPay est mis à l'abri dans le
      // portefeuille de l'acheteur, la commande reste à payer.
      if (funding && params.amount > 0) {
        const wallet = funding.wallet;
        const credited = wallet.balance + params.amount;
        await tx.update(virtualWalletsTable)
          .set({ balance: credited, updatedAt: now })
          .where(eq(virtualWalletsTable.id, wallet.id));
        await recordWalletMovement({
          walletId: wallet.id,
          orderId: order.id,
          entryType: "course_payment_credited_to_wallet",
          amount: params.amount,
          direction: "credit",
          balanceAfter: credited,
          settlementRef: `PAYCRED_${order.id}`,
          metadata: { orderId: order.id, transactionId: params.transactionId, reason: "wallet_balance_changed" },
        }, tx);
        await postBalancedJournalEntry({
          journalReference: `JRN_PAYCRED_${order.id}_${params.transactionId}`,
          legs: [{
            debitAccountCode: STANDARD_ACCOUNTS.FEDAPAY_CLEARING.code,
            creditAccountCode: STANDARD_ACCOUNTS.BUYER_WALLET_AVAILABLE.code,
            amount: params.amount,
            description: `Paiement de course #${order.id} crédité au portefeuille (solde modifié entre-temps)`,
          }],
          metadata: { orderId: order.id, transactionId: params.transactionId },
        }, tx);
      }
      return finish("wallet_changed_credited", "course_payment_credited_to_wallet", { expectedAmount: expected.total });
    }

    const [updated] = await tx
      .update(ordersTable)
      .set({ driverPaymentConfirmedAt: now })
      .where(and(eq(ordersTable.id, order.id), isNull(ordersTable.driverPaymentConfirmedAt)))
      .returning({ id: ordersTable.id });
    if (!updated) return finish("already_confirmed", "course_payment_duplicate_received");

    // Séquestre : FedaPay (compensation) et/ou solde acheteur -> dépôt séquestre acheteur
    const legs = [] as Parameters<typeof postBalancedJournalEntry>[0]["legs"];
    if (params.amount > 0) {
      legs.push({
        debitAccountCode: STANDARD_ACCOUNTS.FEDAPAY_CLEARING.code,
        creditAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
        amount: params.amount,
        description: `Encaissement FedaPay course commande #${order.id}`,
      });
    }
    if (walletApplied > 0) {
      legs.push({
        debitAccountCode: STANDARD_ACCOUNTS.BUYER_WALLET_AVAILABLE.code,
        creditAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
        amount: walletApplied,
        description: `Solde acheteur utilisé pour la course commande #${order.id}`,
      });
    }
    await postBalancedJournalEntry({
      journalReference: `JRN_PAY_${order.id}`,
      legs,
      metadata: { orderId: order.id, transactionId: params.transactionId, breakdown: expected, walletApplied, cardAmount: params.amount },
    }, tx);

    // Portefeuille unique du numéro : le solde utilisé quitte le disponible, le total entre en séquestre
    if (funding) {
      const wallet = funding.wallet;
      const newBalance = wallet.balance - walletApplied;
      await tx.update(virtualWalletsTable)
        .set({ balance: newBalance, lockedBalance: wallet.lockedBalance + expected.total, updatedAt: now })
        .where(eq(virtualWalletsTable.id, wallet.id));
      if (walletApplied > 0) {
        await recordWalletMovement({
          walletId: wallet.id,
          orderId: order.id,
          entryType: "buyer_wallet_applied_to_course",
          amount: walletApplied,
          direction: "debit",
          balanceAfter: newBalance,
          settlementRef: `PAY_${order.id}`,
          metadata: { orderId: order.id, transactionId: params.transactionId },
        }, tx);
      }
      await recordWalletMovement({
        walletId: wallet.id,
        orderId: order.id,
        entryType: "buyer_escrow_deposit",
        amount: expected.total,
        direction: "credit",
        balanceAfter: newBalance,
        settlementRef: `PAY_${order.id}`,
        metadata: { orderId: order.id, transactionId: params.transactionId, breakdown: expected, walletApplied, cardAmount: params.amount },
      }, tx);
    }

    await tx.update(paymentWebhooksTable)
      .set({ processed: true, processedAt: now })
      .where(eq(paymentWebhooksTable.eventHash, params.eventHash));
    await tx.insert(deliveryAuditLogsTable).values({
      actorType: "system",
      actorId: source === "wallet" ? "wallet_internal" : "fedapay_marketplace",
      action: "course_payment_confirmed",
      orderId: order.id,
      metadata: { transactionId: params.transactionId, deliveryJobId: job.id, breakdown: expected, walletApplied, cardAmount: params.amount, source },
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

/** Règle la course ENTIÈREMENT avec le solde du portefeuille acheteur (aucune transaction FedaPay). */
export async function payCourseWithWallet(orderId: number, total: number): Promise<ConfirmCoursePaymentResult> {
  return confirmCoursePayment({
    orderId,
    transactionId: `wallet_${orderId}`,
    amount: 0,
    currency: COURSE_CURRENCY,
    eventName: "wallet.course_payment",
    // Une clé par tentative : l'unicité du paiement est garantie par le verrou sur la commande
    eventHash: `wallet_${orderId}_${randomUUID()}`,
    payload: { orderId, walletApplied: total },
    walletApplied: total,
    source: "wallet",
  });
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
  // Notification Web Push au vendeur : la course est payée, le livreur part chercher la commande.
  if (info.conversationId) {
    const [conversation] = await db
      .select({ vendorId: conversationsTable.vendorId })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, info.conversationId))
      .limit(1);
    if (conversation) {
      await sendVendorPush(conversation.vendorId, {
        title: "Course payée par l'acheteur",
        body: `Le paiement de la commande #${orderId} est confirmé : le livreur part chercher l'article chez vous.`,
        tag: `course-paid-${orderId}`,
      });
    }
  }

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
