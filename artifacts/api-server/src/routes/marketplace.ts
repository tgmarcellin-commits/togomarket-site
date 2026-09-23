import { Router, type IRouter } from "express";
import {
  db,
  auditLogsTable,
  deliveryDriversTable,
  deliveryJobsTable,
  deliveryQrTokensTable,
  marketplaceDisputesTable,
  marketplaceLedgerTable,
  marketplaceOrdersTable,
  marketplaceRefundsTable,
  marketplaceWalletsTable,
  payoutWebhookEventsTable,
  withdrawalTicketsTable,
} from "@workspace/db";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { verifyAdminCode } from "../lib/admin-auth";
import { authenticateVendorRequest } from "../lib/vendor-auth";
import { authenticateDriverAuthorization } from "../lib/driver-auth";
import {
  assertIntegerFcfaAmount,
  createQrToken,
  ensureDeliveryJobTransition,
  ensureReturnTransition,
  hashOpaqueToken,
  isQrTokenUsable,
  normalizeIdempotencyKey,
} from "../lib/marketplace-security";
import { apiRateLimit } from "../lib/http-security";

const router: IRouter = Router();
router.use(apiRateLimit);

async function appendAuditLog(args: {
  actorType: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLogsTable).values({
    actorType: args.actorType,
    actorId: args.actorId,
    action: args.action,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    metadataJson: JSON.stringify(args.metadata ?? {}),
  });
}

router.post("/admin/finance/overview", async (req, res): Promise<void> => {
  const code = String(req.body?.code ?? "");
  const admin = await verifyAdminCode(code);
  if (!admin) {
    res.status(403).json({ error: "Accès administrateur requis" });
    return;
  }

  const statusFilter = typeof req.body?.withdrawalStatus === "string" ? req.body.withdrawalStatus : undefined;
  const page = Math.max(1, Number.parseInt(String(req.body?.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.body?.pageSize ?? "20"), 10) || 20));
  const offset = (page - 1) * pageSize;

  const [walletSummary] = await db.select({
    wallets: count(marketplaceWalletsTable.id),
    availableFcfa: sql<number>`cast(coalesce(sum(${marketplaceWalletsTable.availableBalanceFcfa}), 0) as int)`,
    pendingFcfa: sql<number>`cast(coalesce(sum(${marketplaceWalletsTable.pendingBalanceFcfa}), 0) as int)`,
    paidOutFcfa: sql<number>`cast(coalesce(sum(${marketplaceWalletsTable.totalPaidOutFcfa}), 0) as int)`,
  }).from(marketplaceWalletsTable);

  const [ledgerSummary] = await db.select({
    entries: count(marketplaceLedgerTable.id),
    creditsFcfa: sql<number>`cast(coalesce(sum(case when ${marketplaceLedgerTable.direction} = 'credit' then ${marketplaceLedgerTable.amountFcfa} else 0 end), 0) as int)`,
    debitsFcfa: sql<number>`cast(coalesce(sum(case when ${marketplaceLedgerTable.direction} = 'debit' then ${marketplaceLedgerTable.amountFcfa} else 0 end), 0) as int)`,
  }).from(marketplaceLedgerTable);

  const withdrawalsWhere = statusFilter
    ? eq(withdrawalTicketsTable.status, statusFilter)
    : undefined;

  const [withdrawalSummary] = await db.select({
    total: count(withdrawalTicketsTable.id),
    totalAmountFcfa: sql<number>`cast(coalesce(sum(${withdrawalTicketsTable.amountFcfa}), 0) as int)`,
  }).from(withdrawalTicketsTable).where(withdrawalsWhere);

  const withdrawals = await db.select({
    id: withdrawalTicketsTable.id,
    status: withdrawalTicketsTable.status,
    amountFcfa: withdrawalTicketsTable.amountFcfa,
    fedapayPayoutId: withdrawalTicketsTable.fedapayPayoutId,
    externalReference: withdrawalTicketsTable.externalReference,
    processedAt: withdrawalTicketsTable.processedAt,
    createdAt: withdrawalTicketsTable.createdAt,
  }).from(withdrawalTicketsTable)
    .where(withdrawalsWhere)
    .orderBy(desc(withdrawalTicketsTable.createdAt))
    .limit(pageSize)
    .offset(offset);

  const [disputeSummary] = await db.select({
    total: count(marketplaceDisputesTable.id),
    open: sql<number>`cast(coalesce(sum(case when ${marketplaceDisputesTable.status} = 'open' then 1 else 0 end), 0) as int)`,
    accepted: sql<number>`cast(coalesce(sum(case when ${marketplaceDisputesTable.status} in ('accepted', 'refunded') then 1 else 0 end), 0) as int)`,
  }).from(marketplaceDisputesTable);

  const [qrAlerts] = await db.select({
    expiredPendingQrTokens: sql<number>`cast(coalesce(sum(case when ${deliveryQrTokensTable.expiresAt} < now() and ${deliveryQrTokensTable.consumedAt} is null then 1 else 0 end), 0) as int)`,
  }).from(deliveryQrTokensTable);
  const [withdrawalAlerts] = await db.select({
    stalePendingWithdrawals: sql<number>`cast(coalesce(sum(case when ${withdrawalTicketsTable.status} = 'pending' and ${withdrawalTicketsTable.createdAt} < now() - interval '3 day' then 1 else 0 end), 0) as int)`,
  }).from(withdrawalTicketsTable);

  res.json({
    wallets: {
      count: Number(walletSummary?.wallets ?? 0),
      availableFcfa: Number(walletSummary?.availableFcfa ?? 0),
      pendingFcfa: Number(walletSummary?.pendingFcfa ?? 0),
      paidOutFcfa: Number(walletSummary?.paidOutFcfa ?? 0),
    },
    ledger: {
      entries: Number(ledgerSummary?.entries ?? 0),
      creditsFcfa: Number(ledgerSummary?.creditsFcfa ?? 0),
      debitsFcfa: Number(ledgerSummary?.debitsFcfa ?? 0),
    },
    withdrawals: {
      total: Number(withdrawalSummary?.total ?? 0),
      totalAmountFcfa: Number(withdrawalSummary?.totalAmountFcfa ?? 0),
      page,
      pageSize,
      items: withdrawals,
    },
    disputes: {
      total: Number(disputeSummary?.total ?? 0),
      open: Number(disputeSummary?.open ?? 0),
      accepted: Number(disputeSummary?.accepted ?? 0),
    },
    alerts: {
      expiredPendingQrTokens: Number(qrAlerts?.expiredPendingQrTokens ?? 0),
      stalePendingWithdrawals: Number(withdrawalAlerts?.stalePendingWithdrawals ?? 0),
    },
  });
});

router.post("/marketplace/orders", async (req, res): Promise<void> => {
  const vendor = await authenticateVendorRequest(req, {
    phone: req.body?.vendorPhone,
    password: req.body?.vendorPassword,
  });
  if (!vendor) {
    res.status(403).json({ error: "Authentification vendeur requise" });
    return;
  }

  let amountFcfa: number;
  try {
    amountFcfa = assertIntegerFcfaAmount(Number(req.body?.amountFcfa));
  } catch {
    res.status(400).json({ error: "Montant FCFA invalide" });
    return;
  }

  const buyerName = String(req.body?.buyerName ?? "").trim();
  const buyerPhone = String(req.body?.buyerPhone ?? "").trim();
  if (buyerName.length < 2 || buyerPhone.length < 8) {
    res.status(400).json({ error: "Acheteur invalide" });
    return;
  }

  const publicId = `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const [order] = await db.insert(marketplaceOrdersTable).values({
    publicId,
    vendorId: vendor.id,
    buyerName,
    buyerPhone,
    amountFcfa,
    status: "pending",
  }).returning();

  await appendAuditLog({
    actorType: "vendor",
    actorId: String(vendor.id),
    action: "marketplace.order.created",
    resourceType: "marketplace_order",
    resourceId: String(order.id),
    metadata: { amountFcfa: order.amountFcfa },
  });

  res.status(201).json({ order });
});

router.post("/marketplace/drivers/:driverId/availability", async (req, res): Promise<void> => {
  const driver = await authenticateDriverAuthorization(req.headers.authorization);
  if (!driver) {
    res.status(401).json({ error: "Session livreur invalide" });
    return;
  }

  const requestedDriverId = Number.parseInt(req.params.driverId, 10);
  if (!Number.isInteger(requestedDriverId) || requestedDriverId !== driver.id) {
    res.status(403).json({ error: "Action non autorisée pour ce livreur" });
    return;
  }

  const isAvailable = Boolean(req.body?.isAvailable);
  await db.update(deliveryDriversTable)
    .set({ isAvailable })
    .where(eq(deliveryDriversTable.id, driver.id));

  await appendAuditLog({
    actorType: "driver",
    actorId: String(driver.id),
    action: "driver.availability.updated",
    resourceType: "delivery_driver",
    resourceId: String(driver.id),
    metadata: { isAvailable },
  });

  res.json({ success: true, driverId: driver.id, isAvailable });
});

router.post("/marketplace/delivery-jobs/:deliveryJobId/accept", async (req, res): Promise<void> => {
  const driver = await authenticateDriverAuthorization(req.headers.authorization);
  if (!driver) {
    res.status(401).json({ error: "Session livreur invalide" });
    return;
  }

  const deliveryJobId = Number.parseInt(req.params.deliveryJobId, 10);
  if (!Number.isInteger(deliveryJobId) || deliveryJobId <= 0) {
    res.status(400).json({ error: "Livraison invalide" });
    return;
  }

  const [job] = await db.select().from(deliveryJobsTable).where(eq(deliveryJobsTable.id, deliveryJobId)).limit(1);
  if (!job) {
    res.status(404).json({ error: "Livraison introuvable" });
    return;
  }

  if (job.driverId !== driver.id) {
    res.status(403).json({ error: "Cette livraison n'est pas assignée à ce livreur" });
    return;
  }

  try {
    ensureDeliveryJobTransition(job.status, "accepted");
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Transition invalide" });
    return;
  }

  await db.update(deliveryJobsTable)
    .set({ status: "accepted", updatedAt: new Date() })
    .where(eq(deliveryJobsTable.id, job.id));

  await appendAuditLog({
    actorType: "driver",
    actorId: String(driver.id),
    action: "delivery_job.accepted",
    resourceType: "delivery_job",
    resourceId: String(job.id),
  });

  res.json({ success: true, deliveryJobId: job.id, status: "accepted" });
});

router.post("/marketplace/orders/:orderId/qr-token", async (req, res): Promise<void> => {
  const actorRole = String(req.body?.actorRole ?? "");
  if (!["buyer", "seller", "driver"].includes(actorRole)) {
    res.status(400).json({ error: "Rôle QR invalide" });
    return;
  }

  const orderId = Number.parseInt(req.params.orderId, 10);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    res.status(400).json({ error: "Commande invalide" });
    return;
  }

  const [order] = await db.select().from(marketplaceOrdersTable).where(eq(marketplaceOrdersTable.id, orderId)).limit(1);
  if (!order) {
    res.status(404).json({ error: "Commande introuvable" });
    return;
  }

  const [job] = await db.select().from(deliveryJobsTable).where(eq(deliveryJobsTable.orderId, order.id)).limit(1);
  if (!job) {
    res.status(404).json({ error: "Livraison introuvable" });
    return;
  }

  const ttlSeconds = Number.parseInt(String(req.body?.ttlSeconds ?? "600"), 10);
  const token = createQrToken(Number.isInteger(ttlSeconds) ? ttlSeconds : 600);

  await db.insert(deliveryQrTokensTable).values({
    deliveryJobId: job.id,
    orderId: order.id,
    actorRole,
    tokenHash: token.tokenHash,
    expiresAt: token.expiresAt,
  });

  await appendAuditLog({
    actorType: "system",
    actorId: "api",
    action: "delivery.qr.generated",
    resourceType: "marketplace_order",
    resourceId: String(order.id),
    metadata: { actorRole, deliveryJobId: job.id, expiresAt: token.expiresAt.toISOString() },
  });

  res.status(201).json({
    orderId: order.id,
    deliveryJobId: job.id,
    actorRole,
    qrToken: token.rawToken,
    expiresAt: token.expiresAt.toISOString(),
  });
});

router.post("/marketplace/orders/:orderId/qr-scan", async (req, res): Promise<void> => {
  const driver = await authenticateDriverAuthorization(req.headers.authorization);
  if (!driver) {
    res.status(401).json({ error: "Session livreur invalide" });
    return;
  }

  const orderId = Number.parseInt(req.params.orderId, 10);
  const rawToken = String(req.body?.token ?? "").trim();
  const action = String(req.body?.action ?? "").trim();

  if (!Number.isInteger(orderId) || !rawToken || !["confirm_delivery", "confirm_return"].includes(action)) {
    res.status(400).json({ error: "Payload scan QR invalide" });
    return;
  }

  const [job] = await db
    .select({
      id: deliveryJobsTable.id,
      status: deliveryJobsTable.status,
      orderId: deliveryJobsTable.orderId,
      driverId: deliveryJobsTable.driverId,
    })
    .from(deliveryJobsTable)
    .where(eq(deliveryJobsTable.orderId, orderId))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Livraison introuvable" });
    return;
  }

  if (job.driverId !== driver.id) {
    res.status(403).json({ error: "Ce livreur ne peut pas confirmer cette livraison" });
    return;
  }

  const tokenHash = hashOpaqueToken(rawToken);
  const [persistedToken] = await db
    .select()
    .from(deliveryQrTokensTable)
    .where(and(eq(deliveryQrTokensTable.orderId, orderId), eq(deliveryQrTokensTable.tokenHash, tokenHash)))
    .limit(1);

  if (!persistedToken || !isQrTokenUsable({
    providedRawToken: rawToken,
    persistedTokenHash: persistedToken.tokenHash,
    expiresAt: persistedToken.expiresAt,
    consumedAt: persistedToken.consumedAt,
  })) {
    res.status(409).json({ error: "QR invalide, expiré ou déjà utilisé" });
    return;
  }

  if (action === "confirm_delivery") {
    try {
      ensureDeliveryJobTransition(job.status, "delivered");
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : "Transition invalide" });
      return;
    }

    await db.update(deliveryJobsTable)
      .set({ status: "delivered", deliveredAt: new Date(), updatedAt: new Date() })
      .where(eq(deliveryJobsTable.id, job.id));

    await db.update(marketplaceOrdersTable)
      .set({ status: "delivered", updatedAt: new Date() })
      .where(eq(marketplaceOrdersTable.id, job.orderId));
  } else {
    try {
      ensureDeliveryJobTransition(job.status, "returned");
      const [order] = await db
        .select({ returnStatus: marketplaceOrdersTable.returnStatus })
        .from(marketplaceOrdersTable)
        .where(eq(marketplaceOrdersTable.id, job.orderId))
        .limit(1);
      ensureReturnTransition(order?.returnStatus ?? "none", "collected");
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : "Transition invalide" });
      return;
    }

    await db.update(deliveryJobsTable)
      .set({ status: "returned", returnConfirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(deliveryJobsTable.id, job.id));

    await db.update(marketplaceOrdersTable)
      .set({ status: "returned", returnStatus: "collected", updatedAt: new Date() })
      .where(eq(marketplaceOrdersTable.id, job.orderId));
  }

  await db.update(deliveryQrTokensTable)
    .set({ consumedAt: new Date(), consumedByRole: "driver" })
    .where(eq(deliveryQrTokensTable.id, persistedToken.id));

  await appendAuditLog({
    actorType: "driver",
    actorId: String(driver.id),
    action: action === "confirm_delivery" ? "delivery.confirmed" : "delivery.return_confirmed",
    resourceType: "marketplace_order",
    resourceId: String(orderId),
    metadata: { qrTokenId: persistedToken.id, deliveryJobId: job.id },
  });

  res.json({ success: true, orderId, deliveryJobId: job.id, action });
});

router.post("/marketplace/orders/:orderId/return-status", async (req, res): Promise<void> => {
  const admin = await verifyAdminCode(String(req.body?.code ?? ""));
  if (!admin) {
    res.status(403).json({ error: "Accès administrateur requis" });
    return;
  }

  const orderId = Number.parseInt(req.params.orderId, 10);
  const targetStatus = String(req.body?.status ?? "");

  if (!Number.isInteger(orderId) || orderId <= 0) {
    res.status(400).json({ error: "Commande invalide" });
    return;
  }

  const [order] = await db.select().from(marketplaceOrdersTable).where(eq(marketplaceOrdersTable.id, orderId)).limit(1);
  if (!order) {
    res.status(404).json({ error: "Commande introuvable" });
    return;
  }

  try {
    ensureReturnTransition(order.returnStatus, targetStatus);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Transition retour invalide" });
    return;
  }

  await db.update(marketplaceOrdersTable)
    .set({ returnStatus: targetStatus, updatedAt: new Date() })
    .where(eq(marketplaceOrdersTable.id, order.id));

  await appendAuditLog({
    actorType: "admin",
    actorId: admin.username,
    action: "order.return_status.updated",
    resourceType: "marketplace_order",
    resourceId: String(order.id),
    metadata: { from: order.returnStatus, to: targetStatus },
  });

  res.json({ success: true, orderId: order.id, returnStatus: targetStatus });
});

router.post("/marketplace/disputes", async (req, res): Promise<void> => {
  const actorType = String(req.body?.actorType ?? "buyer");
  const actorId = String(req.body?.actorId ?? "anonymous");
  const orderId = Number.parseInt(String(req.body?.orderId ?? "0"), 10);
  const reason = String(req.body?.reason ?? "").trim();

  if (!Number.isInteger(orderId) || orderId <= 0 || reason.length < 5) {
    res.status(400).json({ error: "Litige invalide" });
    return;
  }

  let idempotencyKeyHash: string;
  try {
    idempotencyKeyHash = normalizeIdempotencyKey(req.body?.idempotencyKey);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Clé d'idempotence invalide" });
    return;
  }

  const existing = await db.select({ id: marketplaceDisputesTable.id, status: marketplaceDisputesTable.status })
    .from(marketplaceDisputesTable)
    .where(and(eq(marketplaceDisputesTable.orderId, orderId), eq(marketplaceDisputesTable.idempotencyKeyHash, idempotencyKeyHash)))
    .limit(1);

  if (existing[0]) {
    res.status(200).json({ disputeId: existing[0].id, status: existing[0].status, idempotent: true });
    return;
  }

  const [dispute] = await db.insert(marketplaceDisputesTable).values({
    orderId,
    reason,
    openedBy: `${actorType}:${actorId}`,
    status: "open",
    idempotencyKeyHash,
  }).returning();

  await appendAuditLog({
    actorType,
    actorId,
    action: "dispute.opened",
    resourceType: "marketplace_dispute",
    resourceId: String(dispute.id),
    metadata: { orderId },
  });

  res.status(201).json({ disputeId: dispute.id, status: dispute.status });
});

router.post("/marketplace/disputes/:disputeId/refund", async (req, res): Promise<void> => {
  const admin = await verifyAdminCode(String(req.body?.code ?? ""));
  if (!admin) {
    res.status(403).json({ error: "Accès administrateur requis" });
    return;
  }

  const disputeId = Number.parseInt(req.params.disputeId, 10);
  if (!Number.isInteger(disputeId) || disputeId <= 0) {
    res.status(400).json({ error: "Litige invalide" });
    return;
  }

  let amountFcfa: number;
  let idempotencyKeyHash: string;
  try {
    amountFcfa = assertIntegerFcfaAmount(Number(req.body?.amountFcfa));
    idempotencyKeyHash = normalizeIdempotencyKey(req.body?.idempotencyKey);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Payload invalide" });
    return;
  }

  const [dispute] = await db
    .select()
    .from(marketplaceDisputesTable)
    .where(eq(marketplaceDisputesTable.id, disputeId))
    .limit(1);

  if (!dispute) {
    res.status(404).json({ error: "Litige introuvable" });
    return;
  }

  const [existingRefund] = await db.select({ id: marketplaceRefundsTable.id, status: marketplaceRefundsTable.status })
    .from(marketplaceRefundsTable)
    .where(eq(marketplaceRefundsTable.idempotencyKeyHash, idempotencyKeyHash))
    .limit(1);

  if (existingRefund) {
    res.status(200).json({ refundId: existingRefund.id, status: existingRefund.status, idempotent: true });
    return;
  }

  const [refund] = await db.insert(marketplaceRefundsTable).values({
    disputeId: dispute.id,
    orderId: dispute.orderId,
    amountFcfa,
    status: "processed",
    processedAt: new Date(),
    idempotencyKeyHash,
  }).returning();

  await db.update(marketplaceDisputesTable).set({
    status: "refunded",
    resolvedBy: admin.username,
    resolvedAt: new Date(),
  }).where(eq(marketplaceDisputesTable.id, dispute.id));

  await db.update(marketplaceOrdersTable)
    .set({ disputeStatus: "refunded", returnStatus: "refunded", updatedAt: new Date() })
    .where(eq(marketplaceOrdersTable.id, dispute.orderId));

  await appendAuditLog({
    actorType: "admin",
    actorId: admin.username,
    action: "refund.processed",
    resourceType: "marketplace_refund",
    resourceId: String(refund.id),
    metadata: { disputeId: dispute.id, amountFcfa },
  });

  res.status(201).json({ refundId: refund.id, status: refund.status, amountFcfa: refund.amountFcfa });
});

router.post("/marketplace/withdrawals", async (req, res): Promise<void> => {
  const vendor = await authenticateVendorRequest(req, {
    phone: req.body?.vendorPhone,
    password: req.body?.vendorPassword,
  });
  if (!vendor) {
    res.status(403).json({ error: "Authentification vendeur requise" });
    return;
  }

  let amountFcfa: number;
  try {
    amountFcfa = assertIntegerFcfaAmount(Number(req.body?.amountFcfa));
  } catch {
    res.status(400).json({ error: "Montant FCFA invalide" });
    return;
  }

  const [wallet] = await db
    .select()
    .from(marketplaceWalletsTable)
    .where(eq(marketplaceWalletsTable.vendorId, vendor.id))
    .limit(1);

  if (!wallet || wallet.availableBalanceFcfa < amountFcfa) {
    res.status(409).json({ error: "Solde insuffisant" });
    return;
  }

  const externalReference = `wd_${vendor.id}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const [ticket] = await db.insert(withdrawalTicketsTable).values({
    walletId: wallet.id,
    amountFcfa,
    status: "pending",
    externalReference,
  }).returning();

  await db.update(marketplaceWalletsTable).set({
    availableBalanceFcfa: wallet.availableBalanceFcfa - amountFcfa,
    pendingBalanceFcfa: wallet.pendingBalanceFcfa + amountFcfa,
    updatedAt: new Date(),
  }).where(eq(marketplaceWalletsTable.id, wallet.id));

  await appendAuditLog({
    actorType: "vendor",
    actorId: String(vendor.id),
    action: "withdrawal.requested",
    resourceType: "withdrawal_ticket",
    resourceId: String(ticket.id),
    metadata: { amountFcfa },
  });

  res.status(201).json({ ticketId: ticket.id, status: ticket.status, amountFcfa, externalReference });
});

router.post("/marketplace/payouts/fedapay-webhook", async (req, res): Promise<void> => {
  const rawEventId = String(req.body?.eventId ?? req.body?.id ?? "").trim();
  if (!rawEventId) {
    res.status(400).json({ error: "eventId requis" });
    return;
  }

  const eventIdHash = hashOpaqueToken(rawEventId);
  const [existing] = await db.select({ id: payoutWebhookEventsTable.id })
    .from(payoutWebhookEventsTable)
    .where(eq(payoutWebhookEventsTable.eventIdHash, eventIdHash))
    .limit(1);

  if (existing) {
    res.status(200).json({ received: true, idempotent: true });
    return;
  }

  const externalReference = String(req.body?.externalReference ?? "").trim();
  const payoutId = String(req.body?.payoutId ?? "").trim();
  const payoutStatus = String(req.body?.status ?? "").trim().toLowerCase();
  if (!externalReference || !payoutId || !["paid", "failed"].includes(payoutStatus)) {
    res.status(400).json({ error: "Webhook payout invalide" });
    return;
  }

  const [ticket] = await db.select().from(withdrawalTicketsTable)
    .where(eq(withdrawalTicketsTable.externalReference, externalReference)).limit(1);

  if (!ticket) {
    res.status(404).json({ error: "Ticket de retrait introuvable" });
    return;
  }

  if (ticket.status === "paid") {
    await db.insert(payoutWebhookEventsTable).values({ eventIdHash, rawEventId, status: "duplicate_paid" });
    res.status(200).json({ received: true, idempotent: true });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.insert(payoutWebhookEventsTable).values({ eventIdHash, rawEventId, status: "processed" });

    await tx.update(withdrawalTicketsTable).set({
      status: payoutStatus === "paid" ? "paid" : "failed",
      fedapayPayoutId: payoutId,
      processedAt: new Date(),
    }).where(eq(withdrawalTicketsTable.id, ticket.id));

    const [wallet] = await tx.select().from(marketplaceWalletsTable).where(eq(marketplaceWalletsTable.id, ticket.walletId)).limit(1);
    if (!wallet) return;

    if (payoutStatus === "paid") {
      await tx.update(marketplaceWalletsTable).set({
        pendingBalanceFcfa: Math.max(0, wallet.pendingBalanceFcfa - ticket.amountFcfa),
        totalPaidOutFcfa: wallet.totalPaidOutFcfa + ticket.amountFcfa,
        updatedAt: new Date(),
      }).where(eq(marketplaceWalletsTable.id, wallet.id));
    } else {
      await tx.update(marketplaceWalletsTable).set({
        pendingBalanceFcfa: Math.max(0, wallet.pendingBalanceFcfa - ticket.amountFcfa),
        availableBalanceFcfa: wallet.availableBalanceFcfa + ticket.amountFcfa,
        updatedAt: new Date(),
      }).where(eq(marketplaceWalletsTable.id, wallet.id));
    }
  });

  await appendAuditLog({
    actorType: "webhook",
    actorId: "fedapay",
    action: payoutStatus === "paid" ? "payout.paid" : "payout.failed",
    resourceType: "withdrawal_ticket",
    resourceId: String(ticket.id),
    metadata: { externalReference, payoutId, rawEventId },
  });

  res.status(200).json({ received: true, status: payoutStatus });
});

router.get("/marketplace/drivers/:driverId/jobs", async (req, res): Promise<void> => {
  const driver = await authenticateDriverAuthorization(req.headers.authorization);
  if (!driver) {
    res.status(401).json({ error: "Session livreur invalide" });
    return;
  }

  const driverId = Number.parseInt(req.params.driverId, 10);
  if (!Number.isInteger(driverId) || driver.id !== driverId) {
    res.status(403).json({ error: "Accès non autorisé" });
    return;
  }

  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  const jobs = await db.select({
    id: deliveryJobsTable.id,
    orderId: deliveryJobsTable.orderId,
    status: deliveryJobsTable.status,
    createdAt: deliveryJobsTable.createdAt,
    updatedAt: deliveryJobsTable.updatedAt,
  })
    .from(deliveryJobsTable)
    .where(and(eq(deliveryJobsTable.driverId, driver.id), statusFilter ? eq(deliveryJobsTable.status, statusFilter) : undefined))
    .orderBy(asc(deliveryJobsTable.createdAt));

  res.json({ driverId: driver.id, jobs });
});

export default router;
