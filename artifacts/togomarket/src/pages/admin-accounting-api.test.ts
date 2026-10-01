import assert from "node:assert/strict";
import test from "node:test";
import {
  loadAdminJournals,
  reverseAdminJournal,
  loadOperationsOverview,
  loadAdminWallets,
  loadAdminWithdrawals,
  reviewAdminWithdrawal,
  loadDriverHistory,
  loadOrderAudit,
} from "./admin-accounting-api";

test("loadAdminJournals formats filters query string and sends x-admin-code header", async () => {
  let requestedUrl = "";
  let headers: HeadersInit | undefined;

  const mockResponse = {
    journals: [
      {
        journalReference: "DELIVERY_SETTLEMENT_ORDER_10",
        createdAt: "2026-10-01T04:00:00.000Z",
        description: "Règlement livraison commande #10",
        entriesCount: 2,
        totalDebit: 10000,
        totalCredit: 10000,
        isBalanced: true,
        isReversal: false,
        reversedFrom: null,
        reversedBy: null,
        reversalReason: null,
        status: "balanced",
        orderId: 10,
        driverId: 3,
        walletId: null,
        settlementRef: "SETTLE_10",
        legs: [],
      },
    ],
    summary: {
      totalJournals: 1,
      totalDebitSum: 10000,
      totalCreditSum: 10000,
      isBalanced: true,
      balancedCount: 1,
      reversedCount: 0,
      reversalCount: 0,
      pendingCorrectionCount: 0,
    },
    pagination: { total: 1, limit: 100, offset: 0, hasMore: false },
  };

  const result = await loadAdminJournals(
    "secret-admin-pass",
    {
      journalType: "delivery",
      settlementStatus: "balanced",
      orderId: 10,
      search: "commande",
    },
    async (input, init) => {
      requestedUrl = String(input);
      headers = init?.headers;
      return {
        ok: true,
        json: async () => mockResponse,
      } as Response;
    },
  );

  assert.equal(requestedUrl.includes("/api/admin/comptabilite/journals"), true);
  assert.equal(requestedUrl.includes("journalType=delivery"), true);
  assert.equal(requestedUrl.includes("settlementStatus=balanced"), true);
  assert.equal(requestedUrl.includes("orderId=10"), true);
  assert.equal(requestedUrl.includes("search=commande"), true);
  assert.deepEqual(headers, { "x-admin-code": "secret-admin-pass" });
  assert.equal(result.journals.length, 1);
  assert.equal(result.journals[0].journalReference, "DELIVERY_SETTLEMENT_ORDER_10");
  assert.equal(result.summary.isBalanced, true);
});

test("loadAdminJournals handles errors and empty response gracefully", async () => {
  await assert.rejects(
    () =>
      loadAdminJournals("bad-pass", {}, async () => ({
        ok: false,
        json: async () => ({ error: "Accès refusé" }),
      } as Response)),
    /Accès refusé/,
  );

  const fallback = await loadAdminJournals("pass", {}, async () => ({
    ok: true,
    json: async () => ({}),
  } as Response));

  assert.deepEqual(fallback.journals, []);
  assert.equal(fallback.summary.totalJournals, 0);
});

test("reverseAdminJournal posts reversal with reason and returns reversal reference", async () => {
  let bodyJson: Record<string, unknown> = {};

  const result = await reverseAdminJournal(
    "super-pass",
    "TX_ORIGINAL_123",
    "Erreur de facturation livreur",
    async (input, init) => {
      bodyJson = JSON.parse(String(init?.body));
      return {
        ok: true,
        json: async () => ({
          success: true,
          reversalJournalReference: "REV_TX_ORIGINAL_123",
          reversedEntriesCount: 2,
        }),
      } as Response;
    },
  );

  assert.equal(bodyJson.journalReference, "TX_ORIGINAL_123");
  assert.equal(bodyJson.reason, "Erreur de facturation livreur");
  assert.equal(result.success, true);
  assert.equal(result.reversalJournalReference, "REV_TX_ORIGINAL_123");
  assert.equal(result.reversedEntriesCount, 2);
});

test("loadOperationsOverview loads metrics, GPS alerts and webhook stats", async () => {
  const mockOverview = {
    activeMissions: { totalActive: 3, pendingResponse: 1, inTransit: 2, returning: 0 },
    driverStatus: { total: 10, active: 8, inactive: 2, available: 5, busy: 3 },
    orderBreakdown: { PENDING: 2, IN_TRANSIT: 2, DELIVERED: 40 },
    disputes: { openCount: 1 },
    gpsHealth: { freshCount: 2, staleAlertCount: 1, missingCount: 0, staleThresholdMinutes: 10, staleAlerts: [] },
    qrHealth: { totalIssued: 50, used: 45, activePending: 2, expired: 3, failedProximityCount: 1, averageProximityMeters: 42 },
    walletHealth: {
      totalAvailableBalance: 150000,
      totalLockedBalance: 20000,
      totalPendingPayoutBalance: 10000,
      totalPaidOutBalance: 500000,
      pendingWithdrawalsCount: 2,
      pendingWithdrawalsAmount: 10000,
      reviewRequiredCount: 1,
      failedWithdrawalsCount: 0,
    },
    fedapayWebhooks: {
      totalCount: 120,
      processedCount: 118,
      failedCount: 2,
      lastReceivedAt: "2026-10-01T04:20:00.000Z",
      lastProcessedAt: "2026-10-01T04:20:01.000Z",
      lastEventName: "transaction.approved",
    },
  };

  const overview = await loadOperationsOverview("admin-secret", async () => ({
    ok: true,
    json: async () => mockOverview,
  } as Response));

  assert.equal(overview.activeMissions.totalActive, 3);
  assert.equal(overview.driverStatus.busy, 3);
  assert.equal(overview.gpsHealth.staleAlertCount, 1);
  assert.equal(overview.qrHealth.failedProximityCount, 1);
  assert.equal(overview.fedapayWebhooks.lastEventName, "transaction.approved");
});

test("loadAdminWallets and loadAdminWithdrawals fetch with filters", async () => {
  const walletsRes = await loadAdminWallets("admin-secret", { ownerType: "driver", hasBalance: true }, async (url) => {
    assert.equal(String(url).includes("ownerType=driver"), true);
    assert.equal(String(url).includes("hasBalance=true"), true);
    return {
      ok: true,
      json: async () => ({
        wallets: [{ id: 1, ownerType: "driver", ownerId: 5, ownerName: "Livreur: Paul", balance: 25000 }],
        summary: { totalWallets: 1, totalBalance: 25000 },
      }),
    } as Response;
  });

  assert.equal(walletsRes.wallets[0].ownerName, "Livreur: Paul");

  const withdrawals = await loadAdminWithdrawals("admin-secret", { status: "withdrawal_review_required" }, async (url) => {
    assert.equal(String(url).includes("status=withdrawal_review_required"), true);
    return {
      ok: true,
      json: async () => ({
        withdrawals: [{ id: 44, status: "withdrawal_review_required", amount: 100000, reviewReason: "Montant élevé" }],
      }),
    } as Response;
  });

  assert.equal(withdrawals.length, 1);
  assert.equal(withdrawals[0].amount, 100000);
});

test("reviewAdminWithdrawal sends approve or reject command", async () => {
  const approveRes = await reviewAdminWithdrawal("admin-secret", 44, "approve", "Vérification effectuée", async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.action, "approve");
    assert.equal(payload.reason, "Vérification effectuée");
    return {
      ok: true,
      json: async () => ({ success: true, status: "withdrawal_reserved" }),
    } as Response;
  });

  assert.equal(approveRes.status, "withdrawal_reserved");
});

test("loadDriverHistory and loadOrderAudit return safe traces without private documents", async () => {
  const driverHist = await loadDriverHistory("admin-secret", 5, async () => ({
    ok: true,
    json: async () => ({
      driver: { id: 5, firstName: "Koffi", lastName: "Abalo", workZone: "Lomé", isActive: true },
      stats: { totalAssigned: 10, acceptedCount: 9, completionRatePercent: 90 },
      history: [],
    }),
  } as Response));

  assert.equal(driverHist.driver.firstName, "Koffi");
  assert.equal("idDocumentPhotoUrl" in driverHist.driver, false);
  assert.equal("idDocumentNumber" in driverHist.driver, false);

  const orderAudit = await loadOrderAudit("admin-secret", 101, async () => ({
    ok: true,
    json: async () => ({
      order: { id: 101, status: "DELIVERED", description: "Colis", articlePriceLocked: 15000 },
      assignments: [{ id: 1, driverName: "Koffi Abalo", acceptanceStatus: "accepted_by_driver" }],
      qrTokens: [{ stage: "delivery", proximityMeters: 18 }],
      auditLogs: [{ action: "qr_scanned_delivered" }],
      ledgerEntries: [{ journalReference: "DELIVERY_SETTLEMENT_ORDER_101", amount: 15000 }],
    }),
  } as Response));

  assert.equal(orderAudit.order.id, 101);
  assert.equal(orderAudit.assignments[0].driverName, "Koffi Abalo");
  assert.equal(orderAudit.qrTokens[0].proximityMeters, 18);
});
