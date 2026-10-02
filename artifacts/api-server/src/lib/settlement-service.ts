import {
  db,
  ordersTable,
  deliveryWorkflowJobsTable,
  virtualWalletsTable,
  conversationsTable,
  conversationDeliveryOrdersTable,
  deliveryAuditLogsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { postBalancedJournalEntry, STANDARD_ACCOUNTS, type DbOrTx } from "./accounting-ledger";
import { getOrCreateVirtualWallet, recordWalletMovement } from "./wallet-service";
import { getIo } from "./socket-io";
import {
  TOGOMARKET_BUYER_COMMISSION_FCFA,
  computeSellerCommission,
  computeSellerPayout,
} from "./platform-fees";

export type SettlementDeliveredResult = {
  status: "settled" | "already_settled";
  orderId: number;
  settlementRef: string;
  sellerPayout: number;
  driverPayout: number;
  buyerRefund: number;
  settledAt: Date;
};

export type SettlementReturnedResult = {
  status: "settled" | "already_settled";
  orderId: number;
  settlementRef: string;
  sellerPayout: number;
  driverPayout: number;
  buyerRefund: number;
  roundTripFee: number;
  insufficientBuyerFunds: boolean;
  settledAt: Date;
};

export async function settleDeliveredOrder(params: {
  orderId: number;
  deliveryJobId?: number | null;
  buyerId?: number;
  sellerId?: number;
  idempotencyKey?: string;
}): Promise<SettlementDeliveredResult> {
  const { orderId, deliveryJobId, idempotencyKey } = params;

  return await db.transaction(async (trx) => {
    // 1. Lock order row
    const [order] = await trx
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .for("update")
      .limit(1);

    if (!order) {
      throw new Error(`Commande #${orderId} introuvable.`);
    }

    // 2. Idempotency check
    if (order.settlementStatus === "settled_delivered") {
      return {
        status: "already_settled",
        orderId: order.id,
        settlementRef: order.settlementRef ?? `SETTLE_DELV_${order.id}`,
        sellerPayout: computeSellerPayout(order.articlePriceLocked ?? 0),
        driverPayout: order.transportFeeLocked ?? 0,
        buyerRefund: 0,
        settledAt: order.settledAt ?? new Date(),
      };
    }

    if (order.settlementStatus === "settled_returned") {
      throw new Error(`Conflit de règlement: la commande #${orderId} a déjà été marquée retournée.`);
    }

    // 3. Lock delivery job
    let job: typeof deliveryWorkflowJobsTable.$inferSelect | undefined;
    if (deliveryJobId) {
      const [j] = await trx
        .select()
        .from(deliveryWorkflowJobsTable)
        .where(eq(deliveryWorkflowJobsTable.id, deliveryJobId))
        .for("update")
        .limit(1);
      job = j;
    } else {
      const [j] = await trx
        .select()
        .from(deliveryWorkflowJobsTable)
        .where(eq(deliveryWorkflowJobsTable.orderId, orderId))
        .orderBy(desc(deliveryWorkflowJobsTable.createdAt))
        .for("update")
        .limit(1);
      job = j;
    }

    if (!job) {
      throw new Error(`Mission de livraison introuvable pour la commande #${orderId}.`);
    }

    // 4. Resolve seller vendorId from conversation or param
    let vendorId = params.sellerId ?? 0;
    let conversationBuyerId = params.buyerId ?? 0;

    const [convOrder] = await trx
      .select({ conversationId: conversationDeliveryOrdersTable.conversationId })
      .from(conversationDeliveryOrdersTable)
      .where(eq(conversationDeliveryOrdersTable.orderId, orderId))
      .orderBy(desc(conversationDeliveryOrdersTable.createdAt))
      .limit(1);

    if (convOrder) {
      const [conv] = await trx
        .select({ vendorId: conversationsTable.vendorId, id: conversationsTable.id })
        .from(conversationsTable)
        .where(eq(conversationsTable.id, convOrder.conversationId))
        .limit(1);
      if (conv) {
        if (!vendorId) vendorId = conv.vendorId;
        if (!conversationBuyerId) conversationBuyerId = conv.id;
      }
    }

    // 5. Authoritative amounts from locked fields
    const articlePrice = Number(order.articlePriceLocked ?? 0);
    const transportFee = Number(order.transportFeeLocked ?? 0);
    // Commission TogoMarket (cahier des charges, section 5) : 250 FCFA payés par l'acheteur
    // (inclus dans son paiement) + 250 FCFA déduits du reversement du vendeur.
    const buyerCommission = TOGOMARKET_BUYER_COMMISSION_FCFA;
    const sellerCommission = computeSellerCommission(articlePrice);
    const platformCommission = buyerCommission + sellerCommission;
    const sellerPayout = computeSellerPayout(articlePrice);
    const totalBuyerPaid = articlePrice + transportFee + buyerCommission;
    const settlementRef = idempotencyKey ?? `SETTLE_DELV_${order.id}_${Date.now()}`;
    const settledAt = new Date();

    // 6. Update Seller Wallet
    const sellerWallet = await getOrCreateVirtualWallet("seller", vendorId, trx);
    const newSellerBalance = sellerWallet.balance + sellerPayout;
    await trx
      .update(virtualWalletsTable)
      .set({
        balance: newSellerBalance,
        updatedAt: settledAt,
      })
      .where(eq(virtualWalletsTable.id, sellerWallet.id));

    await recordWalletMovement(
      {
        walletId: sellerWallet.id,
        orderId: order.id,
        entryType: "seller_article_payout",
        amount: sellerPayout,
        direction: "credit",
        balanceAfter: newSellerBalance,
        settlementRef,
        metadata: { orderId: order.id, role: "seller", articlePrice, sellerCommission },
      },
      trx,
    );

    // 7. Update Driver Wallet
    const driverWallet = await getOrCreateVirtualWallet("driver", job.driverId, trx);
    const newDriverBalance = driverWallet.balance + transportFee;
    await trx
      .update(virtualWalletsTable)
      .set({
        balance: newDriverBalance,
        updatedAt: settledAt,
      })
      .where(eq(virtualWalletsTable.id, driverWallet.id));

    await recordWalletMovement(
      {
        walletId: driverWallet.id,
        orderId: order.id,
        entryType: "driver_transport_fee",
        amount: transportFee,
        direction: "credit",
        balanceAfter: newDriverBalance,
        settlementRef,
        metadata: { orderId: order.id, role: "driver" },
      },
      trx,
    );

    // 8. Unlock/clear Buyer escrow
    if (conversationBuyerId > 0) {
      const buyerWallet = await getOrCreateVirtualWallet("buyer", conversationBuyerId, trx);
      const newBuyerLocked = Math.max(0, buyerWallet.lockedBalance - totalBuyerPaid);
      await trx
        .update(virtualWalletsTable)
        .set({
          lockedBalance: newBuyerLocked,
          updatedAt: settledAt,
        })
        .where(eq(virtualWalletsTable.id, buyerWallet.id));

      await recordWalletMovement(
        {
          walletId: buyerWallet.id,
          orderId: order.id,
          entryType: "buyer_escrow_settled",
          amount: totalBuyerPaid,
          direction: "debit",
          balanceAfter: buyerWallet.balance,
          settlementRef,
          metadata: { orderId: order.id, role: "buyer" },
        },
        trx,
      );
    }

    // 9. Post Balanced Double-Entry Journal
    const legs = [];
    if (sellerPayout > 0) {
      legs.push({
        debitAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
        creditAccountCode: STANDARD_ACCOUNTS.SELLER_PAYABLE.code,
        amount: sellerPayout,
        description: `Règlement vente article #${order.id} au vendeur #${vendorId}`,
      });
    }
    if (transportFee > 0) {
      legs.push({
        debitAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
        creditAccountCode: STANDARD_ACCOUNTS.DRIVER_PAYABLE.code,
        amount: transportFee,
        description: `Règlement course livraison #${order.id} au livreur #${job.driverId}`,
      });
    }

    if (platformCommission > 0) {
      legs.push({
        debitAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
        creditAccountCode: STANDARD_ACCOUNTS.MARKETPLACE_COMMISSION.code,
        amount: platformCommission,
        description: `Commission TogoMarket commande #${order.id} (acheteur ${buyerCommission} + vendeur ${sellerCommission})`,
      });
    }
    if (legs.length > 0) {
      await postBalancedJournalEntry(
        {
          journalReference: `JRN_DELV_${order.id}`,
          legs,
          metadata: { orderId: order.id, settlementRef, deliveryJobId: job.id },
        },
        trx,
      );
    }

    // 10. Update order and job status
    await trx
      .update(ordersTable)
      .set({
        status: "DELIVERED",
        settlementStatus: "settled_delivered",
        settledAt,
        settlementRef,
      })
      .where(eq(ordersTable.id, order.id));

    await trx
      .update(deliveryWorkflowJobsTable)
      .set({
        updatedAt: settledAt,
      })
      .where(eq(deliveryWorkflowJobsTable.id, job.id));

    // 11. Audit log
    await trx.insert(deliveryAuditLogsTable).values({
      actorType: "system",
      actorId: `job_${job.id}`,
      action: "order_settled_delivered",
      orderId: order.id,
      metadata: {
        settlementRef,
        articlePrice,
        transportFee,
        sellerPayout,
        sellerCommission,
        buyerCommission,
        platformCommission,
        driverPayout: transportFee,
        buyerRefund: 0,
      },
    });

    // 12. Socket.IO notification to close tracking
    try {
      const io = getIo();
      io.to(`order_${order.id}`).emit("delivery_tracking_closed", {
        orderId: order.id,
        status: "DELIVERED",
        settledAt: settledAt.toISOString(),
      });
    } catch {
      // socket server might not be running in testing
    }

    return {
      status: "settled",
      orderId: order.id,
      settlementRef,
      sellerPayout,
      driverPayout: transportFee,
      buyerRefund: 0,
      settledAt,
    };
  });
}

export async function settleReturnedOrder(params: {
  orderId: number;
  deliveryJobId?: number | null;
  sellerId?: number;
  buyerId?: number;
  idempotencyKey?: string;
  returnReason?: string;
}): Promise<SettlementReturnedResult> {
  const { orderId, deliveryJobId, idempotencyKey, returnReason } = params;

  return await db.transaction(async (trx) => {
    // 1. Lock order row
    const [order] = await trx
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .for("update")
      .limit(1);

    if (!order) {
      throw new Error(`Commande #${orderId} introuvable.`);
    }

    // 2. Idempotency check
    if (order.settlementStatus === "settled_returned") {
      const outboundFee = Number(order.transportFeeLocked ?? 0);
      const roundTripFee = Number(order.roundTripFeeLocked ?? (2 * outboundFee));
      const amountPaid = Number(order.articlePriceLocked ?? 0) + outboundFee;
      const driverPayout = Math.min(amountPaid, roundTripFee);
      const buyerRefund = Math.max(0, amountPaid - roundTripFee);
      return {
        status: "already_settled",
        orderId: order.id,
        settlementRef: order.settlementRef ?? `SETTLE_RET_${order.id}`,
        sellerPayout: 0,
        driverPayout,
        buyerRefund,
        roundTripFee,
        insufficientBuyerFunds: amountPaid < roundTripFee,
        settledAt: order.settledAt ?? new Date(),
      };
    }

    if (order.settlementStatus === "settled_delivered") {
      throw new Error(`Conflit de règlement: la commande #${orderId} a déjà été marquée livrée.`);
    }

    // 3. Lock delivery job
    let job: typeof deliveryWorkflowJobsTable.$inferSelect | undefined;
    if (deliveryJobId) {
      const [j] = await trx
        .select()
        .from(deliveryWorkflowJobsTable)
        .where(eq(deliveryWorkflowJobsTable.id, deliveryJobId))
        .for("update")
        .limit(1);
      job = j;
    } else {
      const [j] = await trx
        .select()
        .from(deliveryWorkflowJobsTable)
        .where(eq(deliveryWorkflowJobsTable.orderId, orderId))
        .orderBy(desc(deliveryWorkflowJobsTable.createdAt))
        .for("update")
        .limit(1);
      job = j;
    }

    if (!job) {
      throw new Error(`Mission de livraison introuvable pour la commande #${orderId}.`);
    }

    // 4. Resolve buyer and seller
    const [convOrder] = await trx
      .select({ conversationId: conversationDeliveryOrdersTable.conversationId })
      .from(conversationDeliveryOrdersTable)
      .where(eq(conversationDeliveryOrdersTable.orderId, orderId))
      .orderBy(desc(conversationDeliveryOrdersTable.createdAt))
      .limit(1);

    let conversationBuyerId = params.buyerId ?? 0;
    if (convOrder) {
      const [conv] = await trx
        .select({ id: conversationsTable.id })
        .from(conversationsTable)
        .where(eq(conversationsTable.id, convOrder.conversationId))
        .limit(1);
      if (conv && !conversationBuyerId) conversationBuyerId = conv.id;
    }

    // 5. Authoritative return economics
    const articlePrice = Number(order.articlePriceLocked ?? 0);
    const outboundFee = Number(order.transportFeeLocked ?? 0);
    const roundTripFee = Number(order.roundTripFeeLocked ?? (2 * outboundFee));
    const amountPaidByBuyer = articlePrice + outboundFee;
    // La part acheteur de la commission TogoMarket n'est jamais restituée (service déjà rendu)
    const buyerCommission = TOGOMARKET_BUYER_COMMISSION_FCFA;

    // Driver receives min(amountPaidByBuyer, roundTripFee)
    const driverPayout = Math.min(amountPaidByBuyer, roundTripFee);
    // Buyer receives max(0, amountPaidByBuyer - roundTripFee)
    const buyerRefund = Math.max(0, amountPaidByBuyer - roundTripFee);
    // Seller payout is 0
    const sellerPayout = 0;
    const insufficientBuyerFunds = amountPaidByBuyer < roundTripFee;

    const settlementRef = idempotencyKey ?? `SETTLE_RET_${order.id}_${Date.now()}`;
    const settledAt = new Date();

    // 6. Driver Wallet
    const driverWallet = await getOrCreateVirtualWallet("driver", job.driverId, trx);
    const newDriverBalance = driverWallet.balance + driverPayout;
    await trx
      .update(virtualWalletsTable)
      .set({
        balance: newDriverBalance,
        updatedAt: settledAt,
      })
      .where(eq(virtualWalletsTable.id, driverWallet.id));

    await recordWalletMovement(
      {
        walletId: driverWallet.id,
        orderId: order.id,
        entryType: "driver_return_fee",
        amount: driverPayout,
        direction: "credit",
        balanceAfter: newDriverBalance,
        settlementRef,
        metadata: {
          orderId: order.id,
          role: "driver",
          roundTripFee,
          driverPayout,
        },
      },
      trx,
    );

    // 7. Buyer Wallet: release locked escrow and credit refund if any
    if (conversationBuyerId > 0) {
      const buyerWallet = await getOrCreateVirtualWallet("buyer", conversationBuyerId, trx);
      const newBuyerLocked = Math.max(0, buyerWallet.lockedBalance - amountPaidByBuyer - buyerCommission);
      const newBuyerBalance = buyerWallet.balance + buyerRefund;

      await trx
        .update(virtualWalletsTable)
        .set({
          balance: newBuyerBalance,
          lockedBalance: newBuyerLocked,
          updatedAt: settledAt,
        })
        .where(eq(virtualWalletsTable.id, buyerWallet.id));

      if (buyerRefund > 0) {
        await recordWalletMovement(
          {
            walletId: buyerWallet.id,
            orderId: order.id,
            entryType: "buyer_return_refund",
            amount: buyerRefund,
            direction: "credit",
            balanceAfter: newBuyerBalance,
            settlementRef,
            metadata: { orderId: order.id, buyerRefund, roundTripFee },
          },
          trx,
        );
      }
    }

    // 8. Balanced Double-Entry Journal
    const legs = [];
    if (driverPayout > 0) {
      legs.push({
        debitAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
        creditAccountCode: STANDARD_ACCOUNTS.DRIVER_PAYABLE.code,
        amount: driverPayout,
        description: `Frais aller-retour retour commande #${order.id} au livreur #${job.driverId}`,
      });
    }
    if (buyerRefund > 0) {
      legs.push({
        debitAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
        creditAccountCode: STANDARD_ACCOUNTS.BUYER_WALLET_AVAILABLE.code,
        amount: buyerRefund,
        description: `Remboursement acheteur après déduction aller-retour commande #${order.id}`,
      });
    }

    legs.push({
      debitAccountCode: STANDARD_ACCOUNTS.BUYER_ESCROW.code,
      creditAccountCode: STANDARD_ACCOUNTS.MARKETPLACE_COMMISSION.code,
      amount: buyerCommission,
      description: `Commission TogoMarket (part acheteur) retour commande #${order.id}`,
    });
    if (legs.length > 0) {
      await postBalancedJournalEntry(
        {
          journalReference: `JRN_RET_${order.id}`,
          legs,
          metadata: {
            orderId: order.id,
            settlementRef,
            deliveryJobId: job.id,
            roundTripFee,
            driverPayout,
            buyerRefund,
          },
        },
        trx,
      );
    }

    // 9. Update order and job status
    await trx
      .update(ordersTable)
      .set({
        status: "RETURN_CONFIRMED",
        settlementStatus: "settled_returned",
        settledAt,
        settlementRef,
      })
      .where(eq(ordersTable.id, order.id));

    await trx
      .update(deliveryWorkflowJobsTable)
      .set({
        updatedAt: settledAt,
      })
      .where(eq(deliveryWorkflowJobsTable.id, job.id));

    // 10. Audit log
    await trx.insert(deliveryAuditLogsTable).values({
      actorType: "system",
      actorId: `job_${job.id}`,
      action: "order_settled_returned",
      orderId: order.id,
      metadata: {
        settlementRef,
        roundTripFee,
        amountPaidByBuyer,
        sellerPayout,
        driverPayout,
        buyerRefund,
        insufficientBuyerFunds,
      },
    });

    // 11. Socket.IO notification to close tracking
    try {
      const io = getIo();
      io.to(`order_${order.id}`).emit("delivery_tracking_closed", {
        orderId: order.id,
        status: "RETURNED",
        settledAt: settledAt.toISOString(),
      });
    } catch {
      // socket server might not be running in testing
    }

    return {
      status: "settled",
      orderId: order.id,
      settlementRef,
      sellerPayout,
      driverPayout,
      buyerRefund,
      roundTripFee,
      insufficientBuyerFunds,
      settledAt,
    };
  });
        }
        
