import { and, asc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import {
  adminAlertsTable,
  db,
  deliveryAuditLogsTable,
  deliveryWithdrawalTicketsTable,
  paymentWebhooksTable,
  payoutsFedapayTable,
  virtualWalletsTable,
  type WalletOwnerType,
} from "@workspace/db";
import { postBalancedJournalEntry, STANDARD_ACCOUNTS, type DbOrTx } from "./accounting-ledger";
import { createDriverNotification } from "./driver-notifications";
import { sendDriverPush } from "./driver-push";
import {
  FedapayPayoutError,
  createPayout,
  fetchBalances,
  isFedapayPayoutConfigured,
  isFedapayPayoutsEnabled,
  isPayoutCountrySupported,
  payoutFeeFcfa,
  payoutFeeForWithdrawal,
  payoutNetAmount,
  retrievePayout,
  retrievePayoutByReference,
  startPayout,
  type PayoutRecord,
} from "./fedapay-payouts";
import { logger } from "./logger";
import { normalizePhone } from "./phone";
import { BusinessRuleError } from "./route-errors";
import { sendVendorPush } from "./vendor-push";
import { recordWalletMovement, requestWalletWithdrawal } from "./wallet-service";

/**
 * Retraits automatiques : le virement part du compte FedaPay « Marketplace » vers le numéro Mobile Money saisi.
 *
 *   1. Les fonds sont réservés dans le portefeuille (solde -> « en attente de virement »), avec écriture comptable.
 *   2. Le virement est créé puis envoyé chez FedaPay (référence unique TM-WD-<ticket>).
 *   3. FedaPay confirme par webhook (payout.sent / payout.failed) ; un rapprochement automatique relit l'état
 *      chez FedaPay si le webhook n'arrive pas. « sent » -> fonds versés ; « failed » -> fonds remis sur le solde.
 */

const REFERENCE_PREFIX = "TM-WD-";
const CAPACITY_TTL_MS = 45_000;

export function minWithdrawalFcfa(): number {
  const value = Number(process.env.MIN_WITHDRAWAL_FCFA);
  return Number.isInteger(value) && value > 0 ? value : 500;
}

const fcfa = (value: number) => `${new Intl.NumberFormat("fr-FR").format(value)} FCFA`;
const maskPhone = (phone: string) => `••••• ${phone.replace(/\D/g, "").slice(-3)}`;

/* ───────────────────────── capacité de retrait chez FedaPay ───────────────────────── */

export type WithdrawalCapacity = {
  configured: boolean;
  reachable: boolean;
  /** FedaPay refuse les virements par API (compte non habilité) : retraits suspendus. */
  denied?: boolean;
  /** Plus gros solde disponible chez FedaPay sur UN mode de paiement (les soldes ne se combinent pas). */
  maxAvailableFcfa: number;
};

let capacityCache: { at: number; value: WithdrawalCapacity } | null = null;

/**
 * FedaPay a répondu « Opération non autorisée » : le compte n'est pas (encore) habilité à faire des virements par API.
 * On suspend les virements automatiques pendant 15 minutes au lieu de laisser chaque demande échouer.
 */
const PAYOUT_DENIED_PAUSE_MS = 15 * 60 * 1000;
let payoutDeniedAt = 0;

function payoutsDenied(): boolean {
  return Date.now() - payoutDeniedAt < PAYOUT_DENIED_PAUSE_MS;
}

export async function getFedapayWithdrawalCapacity(force = false): Promise<WithdrawalCapacity> {
  if (!isFedapayPayoutConfigured()) return { configured: false, reachable: false, maxAvailableFcfa: 0 };
  if (payoutsDenied()) return { configured: true, reachable: true, maxAvailableFcfa: 0, denied: true };
  if (!force && capacityCache && Date.now() - capacityCache.at < CAPACITY_TTL_MS) return capacityCache.value;
  try {
    const balances = await fetchBalances();
    const value: WithdrawalCapacity = {
      configured: true,
      reachable: true,
      maxAvailableFcfa: balances.reduce((max, balance) => Math.max(max, balance.amount), 0),
    };
    capacityCache = { at: Date.now(), value };
    return value;
  } catch (err) {
    logger.warn({ err }, "Soldes FedaPay indisponibles");
    return { configured: true, reachable: false, maxAvailableFcfa: 0 };
  }
}

/**
 * Met à jour le résumé du portefeuille renvoyé à l'écran : le bouton « Retirer » ne devient actif que si le solde du
 * portefeuille ET les fonds disponibles chez FedaPay couvrent au moins le montant minimum de retrait.
 */
export function applyCapacityToWalletSummary(body: unknown, capacity: WithdrawalCapacity): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const summary = body as Record<string, unknown>;
  if (typeof summary["availableBalance"] !== "number" || summary["verificationRequired"] === true) return body;

  const wallet = summary["availableBalance"] as number;
  const min = minWithdrawalFcfa();
  let canWithdraw = false;
  let max = 0;
  let label: string;

  if (!capacity.configured) {
    label = "Retraits indisponibles pour le moment.";
  } else if (capacity.denied) {
    label = "Retrait automatique momentanément indisponible : l'activation des virements est en cours chez FedaPay. Votre solde est conservé.";
  } else if (!capacity.reachable) {
    label = "La disponibilité des fonds chez FedaPay est momentanément inconnue. Réessayez dans un instant.";
  } else if (wallet < min) {
    label = `Retrait possible à partir de ${fcfa(min)}.`;
  } else {
    max = Math.min(wallet, capacity.maxAvailableFcfa);
    if (max < min) {
      label = "Retrait momentanément indisponible : vos fonds ne sont pas encore disponibles chez FedaPay (jusqu'à 72 h après un paiement). Réessayez plus tard.";
      max = 0;
    } else {
      canWithdraw = true;
      label = `Retrait disponible jusqu'à ${fcfa(max)} : l'argent est envoyé directement sur le numéro que vous saisissez. Les frais de virement FedaPay (${fcfa(payoutFeeForWithdrawal(max))} pour ${fcfa(max)}) sont à votre charge et déduits du montant reçu.`;
    }
  }

  const previousAvailability = (summary["withdrawalAvailability"] ?? {}) as Record<string, unknown>;
  return {
    ...summary,
    withdrawalReadiness: { canWithdraw, maxWithdrawableAmount: max },
    withdrawalAvailability: {
      ...previousAvailability,
      canWithdraw,
      availableForWithdrawal: max,
      statusLabel: label,
      estimatedPayoutDays: "quelques minutes",
    },
  };
}

/* ───────────────────────── demande de retrait ───────────────────────── */

export type AutomaticWithdrawalResult = {
  success: true;
  ticketId: number;
  amount: number;
  status: "processing";
  message: string;
};

function accountFor(ownerType: WalletOwnerType) {
  return ownerType === "seller"
    ? STANDARD_ACCOUNTS.SELLER_PAYABLE.code
    : ownerType === "driver"
      ? STANDARD_ACCOUNTS.DRIVER_PAYABLE.code
      : STANDARD_ACCOUNTS.BUYER_WALLET_AVAILABLE.code;
}

/** Réserve les fonds puis envoie le virement chez FedaPay. Lève une BusinessRuleError lisible en cas de refus. */
export async function requestAutomaticWithdrawal(params: {
  ownerType: WalletOwnerType;
  ownerId: number;
  amount: number;
  phoneNumber: string;
}): Promise<AutomaticWithdrawalResult> {
  const { ownerType, ownerId, amount } = params;
  if (!isFedapayPayoutsEnabled() || !isFedapayPayoutConfigured()) {
    throw new BusinessRuleError("Les retraits automatiques ne sont pas disponibles pour le moment.", 409);
  }
  const normalizedInput = normalizePhone(params.phoneNumber ?? "");
  // Numéro togolais saisi sans indicatif (8 chiffres, ex. 90123456) : on ajoute +228 pour l'utilisateur
  const inputDigits = (normalizedInput ?? "").replace(/\D/g, "");
  const phone = /^\d{8}$/.test(inputDigits) ? `+228${inputDigits}` : normalizedInput;
  if (!phone || phone.replace(/\D/g, "").length < 8) {
    throw new BusinessRuleError("Numéro de retrait invalide.", 400);
  }
  if (!isPayoutCountrySupported(phone.replace(/\D/g, ""))) {
    throw new BusinessRuleError(
      "Le retrait automatique est possible uniquement vers un numéro Mobile Money du Togo (Togocel ou Moov). Contactez TogoMarket pour un autre pays.",
      409,
    );
  }
  const min = minWithdrawalFcfa();
  if (!Number.isInteger(amount) || amount < min) {
    throw new BusinessRuleError(`Le montant minimum de retrait est de ${fcfa(min)}.`, 400);
  }

  if (payoutsDenied()) {
    throw new BusinessRuleError(
      "Retrait automatique momentanément indisponible : l'activation des virements est en cours chez FedaPay. Votre solde est conservé.",
      409,
    );
  }

  // Les fonds doivent être disponibles chez FedaPay (relu à l'instant, sans cache)
  const capacity = await getFedapayWithdrawalCapacity(true);
  if (!capacity.reachable) {
    throw new BusinessRuleError("FedaPay est momentanément injoignable. Réessayez dans un instant.", 409);
  }
  // Les frais sont à la charge de la personne qui retire : le virement est de (montant - frais).
  const fee = payoutFeeForWithdrawal(amount);
  const net = payoutNetAmount(amount);
  if (net < 1) {
    throw new BusinessRuleError(`Le montant est trop faible : les frais de virement sont de ${fcfa(fee)}.`, 400);
  }
  // FedaPay débite le montant versé PLUS ses frais sur le solde du compte Marketplace (au plus le montant demandé)
  if (net + payoutFeeFcfa(net) > capacity.maxAvailableFcfa) {
    throw new BusinessRuleError(
      "Retrait momentanément indisponible : les fonds ne sont pas encore disponibles chez FedaPay (jusqu'à 72 h après un paiement). Réessayez plus tard.",
      409,
    );
  }

  // 1. Réservation des fonds (solde -> en attente) + ticket + écriture comptable
  const reservation = await requestWalletWithdrawal({ ownerType, ownerId, amount, phoneNumber: phone });
  const ticketId = reservation.ticketId;
  await db
    .update(deliveryWithdrawalTicketsTable)
    .set({ status: "withdrawal_reserved", reviewReason: "Virement automatique FedaPay en cours", updatedAt: new Date() })
    .where(eq(deliveryWithdrawalTicketsTable.id, ticketId));

  // 2. Virement chez FedaPay
  await dispatchPayout({ ticketId, ownerType, ownerId, amount, phone });

  return {
    success: true,
    ticketId,
    amount,
    status: "processing",
    message: `Retrait de ${fcfa(amount)} en cours (frais de virement : ${fcfa(fee)}) : ${fcfa(net)} arrivent sur le ${maskPhone(phone)} en quelques minutes.`,
  };
}


/**
 * Crée puis envoie le virement chez FedaPay pour un ticket dont les fonds sont déjà réservés.
 * Refus net de FedaPay -> les fonds sont remis sur le solde et une BusinessRuleError est levée.
 * Réseau / erreur FedaPay -> état incertain : les fonds restent réservés, le rapprochement automatique tranchera.
 */
async function dispatchPayout(params: {
  ticketId: number;
  ownerType: WalletOwnerType;
  ownerId: number;
  amount: number;
  phone: string;
}): Promise<void> {
  const { ticketId, ownerType, ownerId, amount, phone } = params;
  const reference = `${REFERENCE_PREFIX}${ticketId}`;
  let payout: PayoutRecord | null = null;
  try {
    // Montant versé = montant demandé - frais de virement (à la charge de la personne qui retire)
    const netAmount = payoutNetAmount(amount);
    payout = await createPayout({
      amount: netAmount,
      phoneDigits: phone.replace(/\D/g, ""),
      reference,
      description: `Retrait TogoMarket #${ticketId}`,
      firstName: "TogoMarket",
      lastName: `Retrait ${ticketId}`,
      metadata: { ticketId: String(ticketId), ownerType, ownerId: String(ownerId) },
    });
    await db
      .insert(payoutsFedapayTable)
      .values({
        withdrawalTicketId: ticketId,
        fedapayPayoutId: payout.id,
        merchantReference: reference,
        status: "pending",
        amount: netAmount,
        customMetadata: { ownerType, ownerId, requestedAmount: amount, fee: payoutFeeForWithdrawal(amount) },
      })
      .onConflictDoNothing();
    await startPayout(payout.id);
    await db
      .update(payoutsFedapayTable)
      .set({ status: "started", updatedAt: new Date() })
      .where(eq(payoutsFedapayTable.merchantReference, reference));
    logger.info({ ticketId, payoutId: payout.id, amount }, "Virement FedaPay envoyé");
  } catch (err) {
    const failure = err instanceof FedapayPayoutError ? (err as FedapayPayoutError) : null;
    if (failure && failure.kind === "forbidden") {
      payoutDeniedAt = Date.now();
      capacityCache = null;
      logger.error({ ticketId, status: failure.status, detail: failure.detail }, "FedaPay n'autorise pas les virements par API pour ce compte");
      await applyPayoutResult({ ticketId, outcome: "failed", payoutId: payout?.id, reason: "Virements non autorisés par FedaPay" });
      await db.insert(adminAlertsTable).values({
        category: "withdrawal",
        severity: "critical",
        title: "FedaPay refuse les virements (Opération non autorisée)",
        message: "Le compte FedaPay Marketplace n'est pas habilité à faire des virements par API. Demandez l'activation des virements (payouts) à support@fedapay.com. En attendant, les retraits automatiques sont suspendus et les soldes restent intacts.",
        metadata: { ticketId, status: failure.status ?? null },
      }).catch(() => undefined);
      throw new BusinessRuleError(
        "Les virements automatiques ne sont pas encore activés sur le compte FedaPay de TogoMarket. Votre solde est inchangé et TogoMarket a été prévenu.",
        409,
      );
    }
    if (failure && failure.kind === "rejected") {
      logger.warn({ err, ticketId, detail: failure.detail }, "Virement refusé par FedaPay");
      await applyPayoutResult({ ticketId, outcome: "failed", payoutId: payout?.id, reason: `Refusé par FedaPay (${failure.status ?? "?"})` });
      throw new BusinessRuleError(
        "FedaPay a refusé ce virement (numéro non valide pour le Mobile Money ou fonds insuffisants). Votre solde est inchangé.",
        409,
      );
    }
    logger.error({ err, ticketId }, "Virement FedaPay : état incertain, rapprochement automatique à suivre");
    await db
      .update(deliveryWithdrawalTicketsTable)
      .set({ reviewReason: "FedaPay injoignable au moment de l'envoi : vérification automatique en cours", updatedAt: new Date() })
      .where(eq(deliveryWithdrawalTicketsTable.id, ticketId));
  }
}

/* ───────────────────────── résultat du virement ───────────────────────── */

export async function applyPayoutResult(params: {
  ticketId: number;
  outcome: "sent" | "failed";
  payoutId?: string;
  reason?: string;
}): Promise<"applied" | "already_final" | "not_found"> {
  const { ticketId, outcome } = params;

  const result = await db.transaction(async (tx: DbOrTx) => {
    const [ticket] = await tx
      .select()
      .from(deliveryWithdrawalTicketsTable)
      .where(eq(deliveryWithdrawalTicketsTable.id, ticketId))
      .for("update")
      .limit(1);
    if (!ticket) return { status: "not_found" as const };
    if (ticket.status === "sent" || ticket.status === "failed" || ticket.status === "cancelled") {
      return { status: "already_final" as const };
    }

    const [wallet] = await tx
      .select()
      .from(virtualWalletsTable)
      .where(eq(virtualWalletsTable.id, ticket.walletId))
      .for("update")
      .limit(1);
    if (!wallet) return { status: "not_found" as const };

    const amount = Number(ticket.amount);
    const now = new Date();
    const newPending = Math.max(0, wallet.pendingPayoutBalance - amount);

    if (outcome === "sent") {
      await tx
        .update(virtualWalletsTable)
        .set({ pendingPayoutBalance: newPending, paidOutBalance: wallet.paidOutBalance + amount, updatedAt: now })
        .where(eq(virtualWalletsTable.id, wallet.id));
      await recordWalletMovement({
        walletId: wallet.id,
        entryType: "withdrawal_paid",
        amount,
        direction: "debit",
        balanceAfter: wallet.balance,
        settlementRef: `WD_SENT_${ticket.id}`,
        metadata: { ticketId: ticket.id, payoutId: params.payoutId ?? null },
      }, tx);
      // Les fonds en cours de virement sortent de la trésorerie FedaPay
      await postBalancedJournalEntry({
        journalReference: `WD_SENT_${ticket.id}`,
        legs: [{
          debitAccountCode: STANDARD_ACCOUNTS.PENDING_PAYOUT.code,
          creditAccountCode: STANDARD_ACCOUNTS.FEDAPAY_PAYOUT_SETTLEMENT.code,
          amount,
          description: `Virement FedaPay envoyé, retrait #${ticket.id}`,
        }],
        metadata: { ticketId: ticket.id, ownerType: ticket.ownerType, ownerId: ticket.ownerId, payoutId: params.payoutId ?? null },
      }, tx);
    } else {
      const newBalance = wallet.balance + amount;
      await tx
        .update(virtualWalletsTable)
        .set({ balance: newBalance, pendingPayoutBalance: newPending, updatedAt: now })
        .where(eq(virtualWalletsTable.id, wallet.id));
      await recordWalletMovement({
        walletId: wallet.id,
        entryType: "withdrawal_failed_refund",
        amount,
        direction: "credit",
        balanceAfter: newBalance,
        settlementRef: `WD_FAIL_${ticket.id}`,
        metadata: { ticketId: ticket.id, reason: params.reason ?? null },
      }, tx);
      // Annulation de l'écriture de demande : les fonds retournent au passif du propriétaire
      await postBalancedJournalEntry({
        journalReference: `WD_FAIL_${ticket.id}`,
        legs: [{
          debitAccountCode: STANDARD_ACCOUNTS.PENDING_PAYOUT.code,
          creditAccountCode: accountFor(ticket.ownerType as WalletOwnerType),
          amount,
          description: `Virement FedaPay échoué, fonds remis sur le solde, retrait #${ticket.id}`,
        }],
        metadata: { ticketId: ticket.id, ownerType: ticket.ownerType, ownerId: ticket.ownerId, reason: params.reason ?? null },
      }, tx);
    }

    await tx
      .update(deliveryWithdrawalTicketsTable)
      .set({
        status: outcome,
        reviewReason: outcome === "failed" ? (params.reason ?? "Virement échoué") : null,
        updatedAt: now,
      })
      .where(eq(deliveryWithdrawalTicketsTable.id, ticket.id));
    await tx
      .update(payoutsFedapayTable)
      .set({
        status: outcome,
        failureReason: outcome === "failed" ? (params.reason ?? null) : null,
        updatedAt: now,
      })
      .where(eq(payoutsFedapayTable.withdrawalTicketId, ticket.id));
    await tx.insert(deliveryAuditLogsTable).values({
      actorType: "system",
      actorId: "fedapay_marketplace",
      action: outcome === "sent" ? "withdrawal_payout_sent" : "withdrawal_payout_failed",
      metadata: { ticketId: ticket.id, amount, ownerType: ticket.ownerType, ownerId: ticket.ownerId, payoutId: params.payoutId ?? null, reason: params.reason ?? null },
    });

    return {
      status: "applied" as const,
      ownerType: ticket.ownerType as WalletOwnerType,
      ownerId: ticket.ownerId as number,
      amount,
      phone: ticket.phoneNumber as string,
    };
  });

  if (result.status !== "applied") return result.status;
  await notifyWithdrawalOutcome(result.ownerType, result.ownerId, result.amount, result.phone, outcome);
  return "applied";
}

/** Prévient le livreur ou le vendeur (jamais l'acheteur : il voit déjà le résultat à l'écran). Ne lève jamais d'erreur. */
async function notifyWithdrawalOutcome(
  ownerType: WalletOwnerType,
  ownerId: number,
  amount: number,
  phone: string,
  outcome: "sent" | "failed",
): Promise<void> {
  try {
    const title = outcome === "sent" ? `Retrait envoyé : ${fcfa(amount)}` : "Retrait échoué";
    const body = outcome === "sent"
      ? `${fcfa(payoutNetAmount(amount))} ont été envoyés sur le ${maskPhone(phone)} (retrait de ${fcfa(amount)}, frais de virement ${fcfa(payoutFeeForWithdrawal(amount))}).`
      : `Le virement de ${fcfa(amount)} n'a pas abouti : l'argent est de nouveau disponible sur votre solde.`;
    if (ownerType === "driver") {
      await createDriverNotification({ driverId: ownerId, kind: `withdrawal_${outcome}`, title, body });
      await sendDriverPush(ownerId, { title, body, url: "/driver-connexion", tag: `withdrawal-${outcome}` });
    } else if (ownerType === "seller") {
      await sendVendorPush(ownerId, { title, body, tag: `withdrawal-${outcome}` });
    }
  } catch {
    // une notification ratée ne remet jamais en cause un virement déjà comptabilisé
  }
}

/* ───────────────────────── webhook FedaPay (payout.sent / payout.failed) ───────────────────────── */

async function ticketIdForPayout(record: PayoutRecord): Promise<number | null> {
  const reference = record.merchantReference ?? "";
  const match = new RegExp(`^${REFERENCE_PREFIX}(\\d+)$`).exec(reference);
  if (match) return Number(match[1]);
  const [row] = await db
    .select({ ticketId: payoutsFedapayTable.withdrawalTicketId })
    .from(payoutsFedapayTable)
    .where(eq(payoutsFedapayTable.fedapayPayoutId, record.id))
    .limit(1);
  return row?.ticketId ?? null;
}

export type PayoutWebhookResult = { http: 200 | 503; outcome: string };

/**
 * Traite payout.sent / payout.failed. L'état n'est JAMAIS pris dans le corps du webhook : le virement est relu chez
 * FedaPay (comme pour les paiements). 503 = FedaPay réessaiera plus tard.
 */
export async function handlePayoutWebhook(params: {
  payoutId: string;
  eventName: string;
  eventHash: string;
  payload: Record<string, unknown>;
}): Promise<PayoutWebhookResult> {
  const [seen] = await db
    .select({ id: paymentWebhooksTable.id })
    .from(paymentWebhooksTable)
    .where(eq(paymentWebhooksTable.eventHash, params.eventHash))
    .limit(1);
  if (seen) return { http: 200, outcome: "duplicate" };

  let record: PayoutRecord;
  try {
    record = await retrievePayout(params.payoutId);
  } catch (err) {
    const failure = err instanceof FedapayPayoutError ? (err as FedapayPayoutError) : null;
    if (failure && failure.kind === "unreachable") return { http: 503, outcome: "verification_unavailable" };
    return { http: 200, outcome: "payout_not_readable" };
  }

  const markSeen = async () => {
    await db
      .insert(paymentWebhooksTable)
      .values({
        eventHash: params.eventHash,
        provider: "fedapay_marketplace",
        eventName: params.eventName,
        payload: params.payload,
        processed: true,
        processedAt: new Date(),
      })
      .onConflictDoNothing();
  };

  const ticketId = await ticketIdForPayout(record);
  if (!ticketId) {
    await markSeen();
    return { http: 200, outcome: "not_ours" }; // virement fait à la main dans le tableau de bord FedaPay
  }
  if (record.status !== "sent" && record.status !== "failed") {
    await markSeen();
    return { http: 200, outcome: `status_${record.status}` };
  }

  const [ticket] = await db
    .select({ amount: deliveryWithdrawalTicketsTable.amount })
    .from(deliveryWithdrawalTicketsTable)
    .where(eq(deliveryWithdrawalTicketsTable.id, ticketId))
    .limit(1);
  // Le virement est de (montant demandé - frais) : c'est ce montant que FedaPay doit indiquer
  if (ticket && payoutNetAmount(Number(ticket.amount)) !== record.amount) {
    await db.insert(adminAlertsTable).values({
      category: "withdrawal",
      severity: "critical",
      title: "Montant de virement différent de la demande",
      message: `Retrait #${ticketId} : FedaPay indique ${record.amount} FCFA, le montant attendu était de ${payoutNetAmount(Number(ticket.amount))} FCFA (demande de ${ticket.amount} FCFA moins les frais). Aucun changement automatique n'a été fait.`,
      metadata: { ticketId, payoutId: record.id, status: record.status },
    });
    await markSeen();
    return { http: 200, outcome: "amount_mismatch" };
  }

  const applied = await applyPayoutResult({
    ticketId,
    outcome: record.status === "sent" ? "sent" : "failed",
    payoutId: record.id,
    reason: record.status === "failed" ? "Échec signalé par FedaPay" : undefined,
  });
  await markSeen();
  return { http: 200, outcome: applied };
}


/**
 * Reprend les retraits de livreurs et de vendeurs créés AVANT l'activation des virements automatiques : ils sont restés
 * « en attente de validation » sans que rien ne parte chez FedaPay. Seuls les tickets sans motif de revue sont repris
 * (jamais ceux placés en validation manuelle volontairement), de moins de 7 jours, quand les fonds sont disponibles chez FedaPay.
 */
export async function adoptManualWithdrawals(): Promise<number> {
  if (!isFedapayPayoutsEnabled() || !isFedapayPayoutConfigured()) return 0;
  const rows = await db
    .select()
    .from(deliveryWithdrawalTicketsTable)
    .where(and(
      eq(deliveryWithdrawalTicketsTable.status, "withdrawal_review_required"),
      isNull(deliveryWithdrawalTicketsTable.reviewReason),
      inArray(deliveryWithdrawalTicketsTable.ownerType, ["driver", "seller"]),
      gt(deliveryWithdrawalTicketsTable.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
    ))
    .orderBy(asc(deliveryWithdrawalTicketsTable.createdAt))
    .limit(5);
  if (rows.length === 0) return 0;

  const capacity = await getFedapayWithdrawalCapacity(true);
  if (!capacity.reachable || capacity.denied) return 0;

  let adopted = 0;
  let remaining = capacity.maxAvailableFcfa;
  for (const ticket of rows) {
    const amount = Number(ticket.amount);
    const phone = normalizePhone(String(ticket.phoneNumber ?? ""));
    if (!phone || !isPayoutCountrySupported(phone.replace(/\D/g, ""))) continue;
    const netForTicket = payoutNetAmount(amount);
    if (netForTicket < 1) continue;
    const needed = netForTicket + payoutFeeFcfa(netForTicket);
    if (needed > remaining) continue; // fonds (frais compris) pas encore disponibles chez FedaPay : on réessaiera plus tard

    // Prise en charge atomique : un seul passage peut s'en emparer
    const [claimed] = await db
      .update(deliveryWithdrawalTicketsTable)
      .set({ status: "withdrawal_reserved", reviewReason: "Virement automatique FedaPay en cours", updatedAt: new Date() })
      .where(and(
        eq(deliveryWithdrawalTicketsTable.id, ticket.id),
        eq(deliveryWithdrawalTicketsTable.status, "withdrawal_review_required"),
        isNull(deliveryWithdrawalTicketsTable.reviewReason),
      ))
      .returning({ id: deliveryWithdrawalTicketsTable.id });
    if (!claimed) continue;

    remaining -= needed;
    adopted++;
    try {
      await dispatchPayout({ ticketId: ticket.id, ownerType: ticket.ownerType as WalletOwnerType, ownerId: ticket.ownerId as number, amount, phone });
    } catch (err) {
      logger.warn({ err, ticketId: ticket.id }, "Reprise d'un ancien retrait : FedaPay l'a refusé, fonds remis sur le solde");
    }
  }
  return adopted;
}

/* ───────────────────────── rapprochement automatique ───────────────────────── */

/**
 * Filet de sécurité si un webhook n'arrive pas : relit chez FedaPay les virements automatiques encore en cours
 * (statut « withdrawal_reserved ») et applique leur résultat. Les retraits à valider à la main ne sont jamais touchés.
 */
export async function reconcilePendingWithdrawals(): Promise<number> {
  if (!isFedapayPayoutsEnabled() || !isFedapayPayoutConfigured()) return 0;
  const cutoff = new Date(Date.now() - 90_000);
  // Reprend d'abord les anciens retraits restés en attente de validation
  await adoptManualWithdrawals().catch((err) => logger.error({ err }, "Reprise des anciens retraits impossible"));

  const tickets = await db
    .select({
      id: deliveryWithdrawalTicketsTable.id,
      createdAt: deliveryWithdrawalTicketsTable.updatedAt,
    })
    .from(deliveryWithdrawalTicketsTable)
    .where(and(
      eq(deliveryWithdrawalTicketsTable.status, "withdrawal_reserved"),
      lt(deliveryWithdrawalTicketsTable.updatedAt, cutoff),
    ))
    .orderBy(asc(deliveryWithdrawalTicketsTable.updatedAt))
    .limit(20);

  let settled = 0;
  for (const ticket of tickets) {
    try {
      const reference = `${REFERENCE_PREFIX}${ticket.id}`;
      const record = await retrievePayoutByReference(reference);
      const ageMs = Date.now() - ticket.createdAt.getTime();

      if (!record) {
        // Jamais créé chez FedaPay (arrêt du serveur entre la réservation et l'envoi) : on remet les fonds
        if (ageMs > 5 * 60_000) {
          await applyPayoutResult({ ticketId: ticket.id, outcome: "failed", reason: "Virement non transmis à FedaPay" });
          settled++;
        }
        continue;
      }
      await db
        .insert(payoutsFedapayTable)
        .values({ withdrawalTicketId: ticket.id, fedapayPayoutId: record.id, merchantReference: reference, status: record.status, amount: record.amount })
        .onConflictDoNothing();

      if (record.status === "sent" || record.status === "failed") {
        const applied = await applyPayoutResult({
          ticketId: ticket.id,
          outcome: record.status === "sent" ? "sent" : "failed",
          payoutId: record.id,
          reason: record.status === "failed" ? "Échec constaté chez FedaPay" : undefined,
        });
        if (applied === "applied") settled++;
      } else if (record.status === "pending" && ageMs > 3 * 60_000) {
        // Créé mais jamais envoyé (l'appel d'envoi avait échoué) : on l'envoie maintenant
        await startPayout(record.id);
      }
    } catch (err) {
      logger.warn({ err, ticketId: ticket.id }, "Rapprochement d'un retrait impossible pour le moment");
    }
  }
  return settled;
}

export function startWithdrawalReconcileCron(): void {
  logger.info(
    { payoutsEnabled: isFedapayPayoutsEnabled(), keyConfigured: isFedapayPayoutConfigured() },
    isFedapayPayoutsEnabled()
      ? "Retraits FedaPay : virements automatiques ACTIVÉS"
      : "Retraits FedaPay : virements automatiques DÉSACTIVÉS (FEDAPAY_PAYOUTS_ENABLED absent) — retraits en validation manuelle",
  );
  const run = () => {
    reconcilePendingWithdrawals().catch((err) => logger.error({ err }, "Rapprochement des retraits impossible"));
  };
  setTimeout(run, 20_000).unref();
  setInterval(run, 2 * 60_000).unref();
}
