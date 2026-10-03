import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import {
  ordersTable,
  deliveryWorkflowJobsTable,
  driversTable,
  virtualWalletsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  settleDeliveredOrder,
  settleReturnedOrder,
} from "./settlement-service";
import { computeSellerPayout } from "./platform-fees";
import {
  getWalletSummary,
  requestWalletWithdrawal,
} from "./wallet-service";

test("settlement: successful delivery credits seller and driver, closes order and logs accounting", async () => {
  const sellerId = Math.floor(100000 + Math.random() * 900000);
  const buyerId = Math.floor(100000 + Math.random() * 900000);

  // 1. Create a driver
  const [driver] = await db
    .insert(driversTable)
    .values({
      firstName: "TestDriver",
      lastName: "Deliv",
      phone: `+2289000${Math.floor(1000 + Math.random() * 9000)}`,
      isActive: true,
      isAvailable: true,
    })
    .returning();

  // 2. Create an order with locked pricing
  const articlePrice = 12000;
  const transportFee = 1500; // 30 km * 50 FCFA
  const roundTripFee = transportFee * 2; // 3000

  const [order] = await db
    .insert(ordersTable)
    .values({
      lastName: "Koffi",
      firstName: "Amevi",
      phone: "+22890112233",
      description: "Colis test livraison",
      articlePriceLocked: articlePrice,
      distanceLockedKm: 30,
      transportFeeLocked: transportFee,
      roundTripFeeLocked: roundTripFee,
      status: "IN_TRANSIT",
      settlementStatus: "pending",
      driverPaymentConfirmedAt: new Date(), // la course doit être payée pour que le règlement soit autorisé
    })
    .returning();

  // 3. Create delivery job
  const [job] = await db
    .insert(deliveryWorkflowJobsTable)
    .values({
      orderId: order.id,
      driverId: driver.id,
      acceptanceStatus: "accepted_by_driver",
    })
    .returning();

  // 4. Run atomic delivered settlement
  const settlement = await settleDeliveredOrder({
    orderId: order.id,
    deliveryJobId: job.id,
    sellerId,
    buyerId,
  });

  assert.equal(settlement.status, "settled");
  assert.equal(settlement.sellerPayout, computeSellerPayout(articlePrice));
  assert.equal(settlement.driverPayout, transportFee);
  assert.equal(settlement.buyerRefund, 0);

  // 5. Verify order updated
  const [updatedOrder] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, order.id));
  assert.equal(updatedOrder.status, "DELIVERED");
  assert.equal(updatedOrder.settlementStatus, "settled_delivered");

  // 6. Verify seller wallet credited
  const sellerWallet = await getWalletSummary("seller", sellerId);
  assert.equal(sellerWallet.availableBalance, computeSellerPayout(articlePrice));

  // 7. Verify driver wallet credited
  const driverWallet = await getWalletSummary("driver", driver.id);
  assert.equal(driverWallet.availableBalance, transportFee);

  // 8. Idempotency: re-running settlement returns already_settled without double credits
  const secondSettlement = await settleDeliveredOrder({
    orderId: order.id,
    deliveryJobId: job.id,
    sellerId,
    buyerId,
  });
  assert.equal(secondSettlement.status, "already_settled");

  // Wallets must NOT be double-credited!
  const sellerWalletAfter = await getWalletSummary("seller", sellerId);
  assert.equal(sellerWalletAfter.availableBalance, computeSellerPayout(articlePrice));
});

test("settlement: returned order with sufficient buyer funds pays round trip to driver, refunds buyer, seller gets 0", async () => {
  const sellerId = Math.floor(100000 + Math.random() * 900000);
  const buyerId = Math.floor(100000 + Math.random() * 900000);

  const [driver] = await db
    .insert(driversTable)
    .values({
      firstName: "TestDriver",
      lastName: "RetSuff",
      phone: `+2289000${Math.floor(1000 + Math.random() * 9000)}`,
      isActive: true,
      isAvailable: true,
    })
    .returning();

  const articlePrice = 10000;
  const transportFee = 1000; // 20 km * 50 FCFA
  const roundTripFee = 2000; // 2 * 1000 FCFA
  const totalPaid = articlePrice + transportFee; // 11000

  // Pre-seed buyer wallet with locked escrow balance
  const buyerWalletBefore = await getWalletSummary("buyer", buyerId);
  await db
    .update(virtualWalletsTable)
    .set({ lockedBalance: totalPaid })
    .where(eq(virtualWalletsTable.id, buyerWalletBefore.id));

  const [order] = await db
    .insert(ordersTable)
    .values({
      lastName: "Mensah",
      firstName: "Komi",
      phone: "+22890223344",
      description: "Colis retour test",
      articlePriceLocked: articlePrice,
      distanceLockedKm: 20,
      transportFeeLocked: transportFee,
      roundTripFeeLocked: roundTripFee,
      status: "RETURNING_TO_SELLER",
      settlementStatus: "pending",
      driverPaymentConfirmedAt: new Date(), // la course doit être payée pour que le règlement soit autorisé
    })
    .returning();

  const [job] = await db
    .insert(deliveryWorkflowJobsTable)
    .values({
      orderId: order.id,
      driverId: driver.id,
      acceptanceStatus: "accepted_by_driver",
    })
    .returning();

  const settlement = await settleReturnedOrder({
    orderId: order.id,
    deliveryJobId: job.id,
    sellerId,
    buyerId,
    returnReason: "Acheteur absent à la livraison",
  });

  assert.equal(settlement.status, "settled");
  assert.equal(settlement.sellerPayout, 0);
  assert.equal(settlement.driverPayout, roundTripFee); // 2000
  assert.equal(settlement.buyerRefund, totalPaid - roundTripFee); // 11000 - 2000 = 9000
  assert.equal(settlement.insufficientBuyerFunds, false);

  const [updatedOrder] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, order.id));
  assert.equal(updatedOrder.status, "RETURN_CONFIRMED");
  assert.equal(updatedOrder.settlementStatus, "settled_returned");

  const driverWallet = await getWalletSummary("driver", driver.id);
  assert.equal(driverWallet.availableBalance, roundTripFee);

  const buyerWallet = await getWalletSummary("buyer", buyerId);
  assert.equal(buyerWallet.availableBalance, totalPaid - roundTripFee);
  assert.equal(buyerWallet.lockedBalance, 0);

  const sellerWallet = await getWalletSummary("seller", sellerId);
  assert.equal(sellerWallet.availableBalance, 0);
});

test("settlement: returned order with insufficient buyer funds gives all available funds to driver and 0 to buyer", async () => {
  const sellerId = Math.floor(100000 + Math.random() * 900000);
  const buyerId = Math.floor(100000 + Math.random() * 900000);

  const [driver] = await db
    .insert(driversTable)
    .values({
      firstName: "TestDriver",
      lastName: "RetInsuff",
      phone: `+2289000${Math.floor(1000 + Math.random() * 9000)}`,
      isActive: true,
      isAvailable: true,
    })
    .returning();

  // Edge case: roundTripFee (3000) exceeds total paid by buyer (2500)
  const articlePrice = 1000;
  const transportFee = 1500;
  const roundTripFee = 3000;
  const totalPaid = 2500;

  const [order] = await db
    .insert(ordersTable)
    .values({
      lastName: "Lawson",
      firstName: "Eric",
      phone: "+22890334455",
      description: "Colis sous-financé",
      articlePriceLocked: articlePrice,
      distanceLockedKm: 30,
      transportFeeLocked: transportFee,
      roundTripFeeLocked: roundTripFee,
      status: "RETURNING_TO_SELLER",
      settlementStatus: "pending",
      driverPaymentConfirmedAt: new Date(), // la course doit être payée pour que le règlement soit autorisé
    })
    .returning();

  const [job] = await db
    .insert(deliveryWorkflowJobsTable)
    .values({
      orderId: order.id,
      driverId: driver.id,
      acceptanceStatus: "accepted_by_driver",
    })
    .returning();

  const settlement = await settleReturnedOrder({
    orderId: order.id,
    deliveryJobId: job.id,
    sellerId,
    buyerId,
    returnReason: "Colis endommagé",
  });

  assert.equal(settlement.status, "settled");
  assert.equal(settlement.sellerPayout, 0);
  assert.equal(settlement.driverPayout, totalPaid); // Driver gets all available (2500)
  assert.equal(settlement.buyerRefund, 0); // Buyer gets 0
  assert.equal(settlement.insufficientBuyerFunds, true);

  const driverWallet = await getWalletSummary("driver", driver.id);
  assert.equal(driverWallet.availableBalance, totalPaid);

  const buyerWallet = await getWalletSummary("buyer", buyerId);
  assert.equal(buyerWallet.availableBalance, 0);
});

test("wallet: withdrawal readiness, locked funds prevention, and honest availability status", async () => {
  const ownerId = Math.floor(100000 + Math.random() * 900000);

  // Summary with 0 balance has canWithdraw = false
  const summary0 = await getWalletSummary("seller", ownerId);
  assert.equal(summary0.availableBalance, 0);
  assert.equal(summary0.withdrawalReadiness.canWithdraw, false);

  // Directly give user some available balance and locked balance
  await db
    .update(virtualWalletsTable)
    .set({
      balance: 5000,
      lockedBalance: 2000,
    })
    .where(eq(virtualWalletsTable.id, summary0.id));

  const summary = await getWalletSummary("seller", ownerId);
  assert.equal(summary.availableBalance, 5000);
  assert.equal(summary.lockedBalance, 2000);
  assert.equal(summary.withdrawalReadiness.canWithdraw, true);
  assert.equal(summary.withdrawalReadiness.maxWithdrawableAmount, 5000);

  // Attempt to withdraw more than available (e.g. 6000) must fail
  await assert.rejects(
    async () => {
      await requestWalletWithdrawal({
        ownerType: "seller",
        ownerId,
        amount: 6000,
        phone: "+22890123456",
      });
    },
    /Solde insuffisant/,
  );

  // Valid withdrawal of 3000
  const ticket = await requestWalletWithdrawal({
    ownerType: "seller",
    ownerId,
    amount: 3000,
    phone: "+22890123456",
  });

  assert.equal(ticket.amount, 3000);
  assert.ok(["pending_otp", "withdrawal_review_required"].includes(ticket.status));

  // Balance should now reflect: available = 2000, pendingPayout = 3000, locked = 2000
  const summaryAfter = await getWalletSummary("seller", ownerId);
  assert.equal(summaryAfter.availableBalance, 2000);
  assert.equal(summaryAfter.pendingPayoutBalance, 3000);
  assert.equal(summaryAfter.lockedBalance, 2000);
});
