import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  ledgerAccountsTable,
  ledgerEntriesTable,
  virtualWalletsTable,
  walletLedgerTable,
  deliveryWithdrawalTicketsTable,
  payoutsFedapayTable,
  paymentWebhooksTable,
  deliveryWorkflowJobsTable,
  deliveryLocationsTable,
  qrTokensTable,
  ordersTable,
  driversTable,
  vendorsTable,
  disputesTable,
  deliveryAuditLogsTable,
} from "@workspace/db";
import {
  eq,
  and,
  desc,
  sql,
  inArray,
  aliasedTable,
} from "drizzle-orm";
import { isSuperAdmin, isAdminAny } from "../lib/admin-auth";
import { reverseJournalEntry, getTrialBalance } from "../lib/accounting-ledger";

const router: IRouter = Router();

async function requireSuperAdmin(req: Request, res: Response): Promise<boolean> {
  const adminCode = String(req.headers["x-admin-code"] ?? req.query?.adminCode ?? req.body?.adminCode ?? "").trim();
  if (!adminCode || !(await isSuperAdmin(adminCode))) {
    res.status(403).json({ error: "Accès refusé — rôle superadmin requis." });
    return false;
  }
  return true;
}

async function requireAnyAdmin(req: Request, res: Response): Promise<boolean> {
  const adminCode = String(req.headers["x-admin-code"] ?? req.query?.adminCode ?? req.body?.adminCode ?? "").trim();
  if (!adminCode || !(await isAdminAny(adminCode))) {
    res.status(403).json({ error: "Accès administrateur requis." });
    return false;
  }
  return true;
}

export interface FormattedJournalLeg {
  id: number;
  debitAccount: { id: number; code: string; name: string; accountType: string };
  creditAccount: { id: number; code: string; name: string; accountType: string };
  amount: number;
  description: string;
  metadata?: Record<string, unknown>;
}

export interface FormattedJournal {
  journalReference: string;
  createdAt: string;
  description: string;
  entriesCount: number;
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
  isReversal: boolean;
  reversedFrom: string | null;
  reversedBy: string | null;
  reversalReason: string | null;
  status: "balanced" | "reversed" | "reversal" | "pending_correction";
  orderId: number | null;
  driverId: number | null;
  walletId: number | null;
  settlementRef: string | null;
  legs: FormattedJournalLeg[];
}

/**
 * Helper to build and group all ledger entries into journal transactions.
 */
async function buildGroupedJournals(): Promise<FormattedJournal[]> {
  const debitAccountAlias = aliasedTable(ledgerAccountsTable, "debit_account");
  const creditAccountAlias = aliasedTable(ledgerAccountsTable, "credit_account");

  const rows = await db
    .select({
      id: ledgerEntriesTable.id,
      journalReference: ledgerEntriesTable.journalReference,
      amount: ledgerEntriesTable.amount,
      description: ledgerEntriesTable.description,
      metadata: ledgerEntriesTable.metadata,
      createdAt: ledgerEntriesTable.createdAt,
      debitAccountId: ledgerEntriesTable.debitAccountId,
      debitAccountCode: debitAccountAlias.code,
      debitAccountName: debitAccountAlias.name,
      debitAccountType: debitAccountAlias.accountType,
      creditAccountId: ledgerEntriesTable.creditAccountId,
      creditAccountCode: creditAccountAlias.code,
      creditAccountName: creditAccountAlias.name,
      creditAccountType: creditAccountAlias.accountType,
    })
    .from(ledgerEntriesTable)
    .leftJoin(debitAccountAlias, eq(ledgerEntriesTable.debitAccountId, debitAccountAlias.id))
    .leftJoin(creditAccountAlias, eq(ledgerEntriesTable.creditAccountId, creditAccountAlias.id))
    .orderBy(desc(ledgerEntriesTable.createdAt), desc(ledgerEntriesTable.id));

  const journalMap = new Map<string, FormattedJournal>();
  const reversalMap = new Map<string, { reversalRef: string; reason: string }>();

  for (const row of rows) {
    const meta = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
    const orderId = typeof meta.orderId === "number" ? meta.orderId : null;
    const driverId = typeof meta.driverId === "number" ? meta.driverId : null;
    const walletId = typeof meta.walletId === "number" ? meta.walletId : null;
    const settlementRef = typeof meta.settlementRef === "string" ? meta.settlementRef : null;

    const isRev = row.journalReference.startsWith("REV_") || typeof meta.reversedFrom === "string";
    const reversedFrom = typeof meta.reversedFrom === "string"
      ? meta.reversedFrom
      : (row.journalReference.startsWith("REV_") ? row.journalReference.replace(/^REV_/, "") : null);
    const reversalReason = typeof meta.reversalReason === "string" ? meta.reversalReason : null;

    if (reversedFrom) {
      reversalMap.set(reversedFrom, {
        reversalRef: row.journalReference,
        reason: reversalReason ?? "Annulation administrative",
      });
    }

    const leg: FormattedJournalLeg = {
      id: row.id,
      debitAccount: {
        id: row.debitAccountId,
        code: row.debitAccountCode ?? "UNKNOWN",
        name: row.debitAccountName ?? "Compte Débit Inconnu",
        accountType: row.debitAccountType ?? "asset",
      },
      creditAccount: {
        id: row.creditAccountId,
        code: row.creditAccountCode ?? "UNKNOWN",
        name: row.creditAccountName ?? "Compte Crédit Inconnu",
        accountType: row.creditAccountType ?? "liability",
      },
      amount: row.amount,
      description: row.description,
      metadata: meta,
    };

    let group = journalMap.get(row.journalReference);
    if (!group) {
      group = {
        journalReference: row.journalReference,
        createdAt: row.createdAt.toISOString(),
        description: row.description,
        entriesCount: 0,
        totalDebit: 0,
        totalCredit: 0,
        isBalanced: true,
        isReversal: isRev,
        reversedFrom,
        reversedBy: null,
        reversalReason,
        status: isRev ? "reversal" : "balanced",
        orderId,
        driverId,
        walletId,
        settlementRef,
        legs: [],
      };
      journalMap.set(row.journalReference, group);
    }

    group.legs.push(leg);
    group.entriesCount += 1;
    group.totalDebit += row.amount;
    group.totalCredit += row.amount;
    if (!group.orderId && orderId) group.orderId = orderId;
    if (!group.driverId && driverId) group.driverId = driverId;
    if (!group.walletId && walletId) group.walletId = walletId;
    if (!group.settlementRef && settlementRef) group.settlementRef = settlementRef;
  }

  // Second pass: apply reversal links and status
  const list = Array.from(journalMap.values());
  for (const group of list) {
    group.isBalanced = group.totalDebit === group.totalCredit;
    const rev = reversalMap.get(group.journalReference);
    if (rev) {
      group.reversedBy = rev.reversalRef;
      group.reversalReason = rev.reason;
      group.status = "reversed";
    } else if (group.isReversal) {
      group.status = "reversal";
    } else if (!group.isBalanced) {
      group.status = "pending_correction";
    } else {
      group.status = "balanced";
    }
  }

  return list;
}

// --------------------------------------------------------------------------
// 1. GET /admin/comptabilite/journals
// --------------------------------------------------------------------------
router.get("/admin/comptabilite/journals", async (req, res) => {
  if (!(await requireSuperAdmin(req, res))) return;

  const journals = await buildGroupedJournals();

  const journalType = String(req.query.journalType ?? "all").toLowerCase();
  const settlementStatus = String(req.query.settlementStatus ?? "all").toLowerCase();
  const orderId = req.query.orderId ? Number(req.query.orderId) : null;
  const driverId = req.query.driverId ? Number(req.query.driverId) : null;
  const walletId = req.query.walletId ? Number(req.query.walletId) : null;
  const search = String(req.query.search ?? "").trim().toLowerCase();
  const dateFrom = String(req.query.dateFrom ?? "").trim();
  const dateTo = String(req.query.dateTo ?? "").trim();

  const filtered = journals.filter((j) => {
    // Type filter
    if (journalType !== "all") {
      const ref = j.journalReference.toUpperCase();
      if (journalType === "delivery" && !ref.includes("DELIVERY") && !ref.includes("LIVR")) return false;
      if (journalType === "return" && !ref.includes("RETURN") && !ref.includes("RETOUR")) return false;
      if (journalType === "withdrawal" && !ref.includes("WITHDRAWAL") && !ref.includes("RETRAIT") && !ref.includes("PAYOUT")) return false;
      if (journalType === "reversal" && !j.isReversal) return false;
      if (journalType === "dispute" && !ref.includes("DISPUTE") && !ref.includes("LITIGE")) return false;
    }

    // Settlement status
    if (settlementStatus !== "all" && j.status !== settlementStatus) {
      return false;
    }

    // Order ID
    if (orderId && j.orderId !== orderId) {
      const hasOrderInLeg = j.legs.some((l) => l.metadata?.orderId === orderId);
      const matchesRef = j.journalReference.includes(`ORDER_${orderId}`) || j.journalReference.includes(`_${orderId}_`);
      if (!hasOrderInLeg && !matchesRef) return false;
    }

    // Driver ID
    if (driverId && j.driverId !== driverId) {
      const hasDriverInLeg = j.legs.some((l) => l.metadata?.driverId === driverId);
      if (!hasDriverInLeg) return false;
    }

    // Wallet ID
    if (walletId && j.walletId !== walletId) {
      const hasWalletInLeg = j.legs.some((l) => l.metadata?.walletId === walletId);
      if (!hasWalletInLeg) return false;
    }

    // Date range
    if (dateFrom && j.createdAt < dateFrom) return false;
    if (dateTo) {
      const endInclusive = dateTo.includes("T") ? dateTo : `${dateTo}T23:59:59.999Z`;
      if (j.createdAt > endInclusive) return false;
    }

    // Text search
    if (search) {
      const inRef = j.journalReference.toLowerCase().includes(search);
      const inDesc = j.description.toLowerCase().includes(search);
      const inLegs = j.legs.some(
        (l) =>
          l.description.toLowerCase().includes(search) ||
          l.debitAccount.name.toLowerCase().includes(search) ||
          l.creditAccount.name.toLowerCase().includes(search) ||
          l.debitAccount.code.includes(search) ||
          l.creditAccount.code.includes(search),
      );
      if (!inRef && !inDesc && !inLegs) return false;
    }

    return true;
  });

  const totalDebitSum = filtered.reduce((acc, curr) => acc + curr.totalDebit, 0);
  const totalCreditSum = filtered.reduce((acc, curr) => acc + curr.totalCredit, 0);

  const summary = {
    totalJournals: filtered.length,
    totalDebitSum,
    totalCreditSum,
    isBalanced: totalDebitSum === totalCreditSum,
    balancedCount: filtered.filter((j) => j.status === "balanced").length,
    reversedCount: filtered.filter((j) => j.status === "reversed").length,
    reversalCount: filtered.filter((j) => j.status === "reversal").length,
    pendingCorrectionCount: filtered.filter((j) => j.status === "pending_correction").length,
  };

  const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 500);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  const paginated = filtered.slice(offset, offset + limit);

  return res.json({
    journals: paginated,
    summary,
    pagination: {
      total: filtered.length,
      limit,
      offset,
      hasMore: offset + limit < filtered.length,
    },
  });
});

// --------------------------------------------------------------------------
// 2. POST /admin/comptabilite/reverse
// --------------------------------------------------------------------------
router.post("/admin/comptabilite/reverse", async (req, res) => {
  if (!(await requireSuperAdmin(req, res))) return;

  const journalReference = String(req.body?.journalReference ?? "").trim();
  const reason = String(req.body?.reason ?? "").trim();

  if (!journalReference) {
    return res.status(400).json({ error: "journalReference est obligatoire." });
  }
  if (!reason || reason.length < 3) {
    return res.status(400).json({ error: "Un motif d'annulation explicite (au moins 3 caractères) est requis." });
  }

  // Cannot reverse an existing reversal
  if (journalReference.startsWith("REV_")) {
    return res.status(400).json({ error: "Impossible d'annuler directement une contre-passation (REV_)." });
  }

  // Check if already reversed
  const [alreadyReversed] = await db
    .select({ id: ledgerEntriesTable.id })
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.journalReference, `REV_${journalReference}`))
    .limit(1);

  if (alreadyReversed) {
    return res.status(409).json({ error: "Cette écriture comptable a déjà été contre-passée / annulée." });
  }

  try {
    const result = await reverseJournalEntry({
      originalJournalReference: journalReference,
      reason,
    });

    await db.insert(deliveryAuditLogsTable).values({
      actorType: "superadmin",
      action: "admin_reverse_journal_entry",
      metadata: {
        originalJournalReference: journalReference,
        reversalJournalReference: result.reversalJournalReference,
        reason,
        reversedEntriesCount: result.reversedEntriesCount,
      },
    });

    return res.json({
      success: true,
      reversalJournalReference: result.reversalJournalReference,
      reversedEntriesCount: result.reversedEntriesCount,
      message: `Journal ${journalReference} contre-passé avec succès.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur lors de l'annulation comptable";
    return res.status(400).json({ error: msg });
  }
});

// --------------------------------------------------------------------------
// 3. GET /admin/comptabilite/export
// --------------------------------------------------------------------------
router.get("/admin/comptabilite/export", async (req, res) => {
  if (!(await requireSuperAdmin(req, res))) return;

  const format = String(req.query.format ?? "csv").toLowerCase();
  const journals = await buildGroupedJournals();

  if (format === "json") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="grand-livre-${Date.now()}.json"`);
    return res.json({
      exportedAt: new Date().toISOString(),
      count: journals.length,
      journals,
    });
  }

  // CSV format
  const escapeCsv = (val: unknown) => {
    const s = String(val ?? "").replace(/"/g, '""');
    return `"${s}"`;
  };

  const header = [
    "Reference_Journal",
    "Date_Creation",
    "Statut",
    "Est_Annulation",
    "Annule_De",
    "Annule_Par",
    "Motif_Annulation",
    "ID_Commande",
    "ID_Livreur",
    "ID_Portefeuille",
    "Compte_Debit_Code",
    "Compte_Debit_Nom",
    "Compte_Credit_Code",
    "Compte_Credit_Nom",
    "Montant_FCFA",
    "Description",
  ].join(",");

  const lines: string[] = [header];

  for (const j of journals) {
    for (const leg of j.legs) {
      lines.push([
        escapeCsv(j.journalReference),
        escapeCsv(j.createdAt),
        escapeCsv(j.status),
        escapeCsv(j.isReversal ? "OUI" : "NON"),
        escapeCsv(j.reversedFrom ?? ""),
        escapeCsv(j.reversedBy ?? ""),
        escapeCsv(j.reversalReason ?? ""),
        escapeCsv(j.orderId ?? ""),
        escapeCsv(j.driverId ?? ""),
        escapeCsv(j.walletId ?? ""),
        escapeCsv(leg.debitAccount.code),
        escapeCsv(leg.debitAccount.name),
        escapeCsv(leg.creditAccount.code),
        escapeCsv(leg.creditAccount.name),
        leg.amount,
        escapeCsv(leg.description),
      ].join(","));
    }
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="grand-livre-${Date.now()}.csv"`);
  return res.send(lines.join("\r\n"));
});

// --------------------------------------------------------------------------
// 4. GET /admin/operations/overview
// --------------------------------------------------------------------------
router.get("/admin/operations/overview", async (req, res) => {
  if (!(await requireAnyAdmin(req, res))) return;

  const now = Date.now();
  const tenMinutesAgo = new Date(now - 10 * 60 * 1000);

  // 1. Active missions
  const allJobs = await db
    .select({
      id: deliveryWorkflowJobsTable.id,
      orderId: deliveryWorkflowJobsTable.orderId,
      driverId: deliveryWorkflowJobsTable.driverId,
      acceptanceStatus: deliveryWorkflowJobsTable.acceptanceStatus,
      acceptedAt: deliveryWorkflowJobsTable.acceptedAt,
      createdAt: deliveryWorkflowJobsTable.createdAt,
    })
    .from(deliveryWorkflowJobsTable);

  const pendingResponseCount = allJobs.filter((j) => j.acceptanceStatus === "pending_driver_response").length;
  const acceptedJobs = allJobs.filter((j) => j.acceptanceStatus === "accepted_by_driver");

  // Orders distribution
  const allOrders = await db
    .select({
      id: ordersTable.id,
      status: ordersTable.status,
    })
    .from(ordersTable);

  const orderBreakdown: Record<string, number> = {};
  for (const o of allOrders) {
    orderBreakdown[o.status] = (orderBreakdown[o.status] ?? 0) + 1;
  }

  const inTransitCount = orderBreakdown["IN_TRANSIT"] ?? 0;
  const returningCount = (orderBreakdown["RETURNING_TO_SELLER"] ?? 0) + (orderBreakdown["RETURN_AT_SELLER"] ?? 0);
  const totalActiveMissions = inTransitCount + returningCount + pendingResponseCount;

  // 2. Drivers status
  const allDrivers = await db
    .select({
      id: driversTable.id,
      isActive: driversTable.isActive,
      isAvailable: driversTable.isAvailable,
    })
    .from(driversTable);

  const busyDriverIds = new Set(
    acceptedJobs
      .filter((j) => {
        const order = allOrders.find((o) => o.id === j.orderId);
        return order && ["IN_TRANSIT", "RETURNING_TO_SELLER", "RETURN_AT_SELLER", "ASSIGNED"].includes(order.status);
      })
      .map((j) => j.driverId),
  );

  const totalDrivers = allDrivers.length;
  const activeDrivers = allDrivers.filter((d) => d.isActive).length;
  const inactiveDrivers = allDrivers.filter((d) => !d.isActive).length;
  const busyDrivers = allDrivers.filter((d) => d.isActive && busyDriverIds.has(d.id)).length;
  const availableDrivers = allDrivers.filter((d) => d.isActive && d.isAvailable && !busyDriverIds.has(d.id)).length;

  // 3. Open disputes
  const openDisputes = await db
    .select({ id: disputesTable.id })
    .from(disputesTable)
    .where(eq(disputesTable.status, "open"));

  // 4. GPS Freshness check on active missions
  const activeMissionOrders = allOrders.filter((o) => ["IN_TRANSIT", "RETURNING_TO_SELLER"].includes(o.status));
  const activeOrderIds = activeMissionOrders.map((o) => o.id);
  const activeJobs = acceptedJobs.filter((j) => activeOrderIds.includes(j.orderId));
  const activeJobIds = activeJobs.map((j) => j.id);

  let freshGpsCount = 0;
  let staleAlertCount = 0;
  let missingGpsCount = 0;
  const staleAlerts: Array<{ orderId: number; driverId: number; ageMinutes: number; lastRecordedAt: string | null }> = [];

  if (activeJobIds.length > 0) {
    const locRows = await db
      .select({
        deliveryJobId: deliveryLocationsTable.deliveryJobId,
        recordedAt: deliveryLocationsTable.recordedAt,
      })
      .from(deliveryLocationsTable)
      .where(inArray(deliveryLocationsTable.deliveryJobId, activeJobIds))
      .orderBy(desc(deliveryLocationsTable.recordedAt));

    const latestLocByJobId = new Map<number, Date>();
    for (const loc of locRows) {
      if (loc.deliveryJobId != null && !latestLocByJobId.has(loc.deliveryJobId)) {
        latestLocByJobId.set(loc.deliveryJobId, loc.recordedAt);
      }
    }

    for (const job of activeJobs) {
      const recordedAt = latestLocByJobId.get(job.id);
      if (!recordedAt) {
        missingGpsCount++;
        staleAlerts.push({
          orderId: job.orderId,
          driverId: job.driverId,
          ageMinutes: 999,
          lastRecordedAt: null,
        });
      } else {
        const recordedTime = new Date(recordedAt).getTime();
        const ageMinutes = Math.round((now - recordedTime) / 60000);
        if (recordedAt < tenMinutesAgo) {
          staleAlertCount++;
          staleAlerts.push({
            orderId: job.orderId,
            driverId: job.driverId,
            ageMinutes,
            lastRecordedAt: recordedAt.toISOString(),
          });
        } else {
          freshGpsCount++;
        }
      }
    }
  }

  // 5. QR Token Health
  const allQrTokens = await db
    .select({
      id: qrTokensTable.id,
      expiresAt: qrTokensTable.expiresAt,
      usedAt: qrTokensTable.usedAt,
      proximityMeters: qrTokensTable.proximityMeters,
    })
    .from(qrTokensTable);

  const totalQrIssued = allQrTokens.length;
  const qrUsed = allQrTokens.filter((q) => q.usedAt !== null).length;
  const qrActivePending = allQrTokens.filter((q) => q.usedAt === null && new Date(q.expiresAt).getTime() > now).length;
  const qrExpired = allQrTokens.filter((q) => q.usedAt === null && new Date(q.expiresAt).getTime() <= now).length;
  const failedProximityCount = allQrTokens.filter((q) => q.proximityMeters !== null && q.proximityMeters > 150).length;

  const validProximityValues = allQrTokens
    .map((q) => q.proximityMeters)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p));
  const avgProximityMeters = validProximityValues.length > 0
    ? Math.round(validProximityValues.reduce((a, b) => a + b, 0) / validProximityValues.length)
    : null;

  // 6. Wallet movement and Payout health summary
  const allWallets = await db
    .select({
      balance: virtualWalletsTable.balance,
      lockedBalance: virtualWalletsTable.lockedBalance,
      pendingPayoutBalance: virtualWalletsTable.pendingPayoutBalance,
      paidOutBalance: virtualWalletsTable.paidOutBalance,
    })
    .from(virtualWalletsTable);

  const totalAvailableBalance = allWallets.reduce((acc, w) => acc + w.balance, 0);
  const totalLockedBalance = allWallets.reduce((acc, w) => acc + w.lockedBalance, 0);
  const totalPendingPayoutBalance = allWallets.reduce((acc, w) => acc + w.pendingPayoutBalance, 0);
  const totalPaidOutBalance = allWallets.reduce((acc, w) => acc + w.paidOutBalance, 0);

  const allWithdrawals = await db
    .select({
      id: deliveryWithdrawalTicketsTable.id,
      amount: deliveryWithdrawalTicketsTable.amount,
      status: deliveryWithdrawalTicketsTable.status,
    })
    .from(deliveryWithdrawalTicketsTable);

  const pendingWithdrawalStatuses = ["pending_otp", "otp_verified", "withdrawal_reserved", "withdrawal_review_required"];
  const pendingWithdrawals = allWithdrawals.filter((w) => pendingWithdrawalStatuses.includes(w.status));
  const pendingWithdrawalsCount = pendingWithdrawals.length;
  const pendingWithdrawalsAmount = pendingWithdrawals.reduce((acc, w) => acc + w.amount, 0);
  const reviewRequiredCount = allWithdrawals.filter((w) => w.status === "withdrawal_review_required").length;
  const failedWithdrawalsCount = allWithdrawals.filter((w) => w.status === "failed").length;

  // 7. FedaPay Webhook Events Health
  const allWebhooks = await db
    .select({
      id: paymentWebhooksTable.id,
      eventName: paymentWebhooksTable.eventName,
      processed: paymentWebhooksTable.processed,
      processedAt: paymentWebhooksTable.processedAt,
      createdAt: paymentWebhooksTable.createdAt,
    })
    .from(paymentWebhooksTable)
    .orderBy(desc(paymentWebhooksTable.createdAt));

  const totalWebhooks = allWebhooks.length;
  const processedWebhooks = allWebhooks.filter((w) => w.processed).length;
  const failedWebhooks = allWebhooks.filter((w) => !w.processed).length;
  const latestWebhook = allWebhooks[0] ?? null;
  const latestProcessed = allWebhooks.find((w) => w.processed && w.processedAt) ?? null;

  return res.json({
    activeMissions: {
      totalActive: totalActiveMissions,
      pendingResponse: pendingResponseCount,
      inTransit: inTransitCount,
      returning: returningCount,
    },
    driverStatus: {
      total: totalDrivers,
      active: activeDrivers,
      inactive: inactiveDrivers,
      available: availableDrivers,
      busy: busyDrivers,
    },
    orderBreakdown,
    disputes: {
      openCount: openDisputes.length,
    },
    gpsHealth: {
      freshCount: freshGpsCount,
      staleAlertCount,
      missingCount: missingGpsCount,
      staleThresholdMinutes: 10,
      staleAlerts,
    },
    qrHealth: {
      totalIssued: totalQrIssued,
      used: qrUsed,
      activePending: qrActivePending,
      expired: qrExpired,
      failedProximityCount,
      averageProximityMeters: avgProximityMeters,
    },
    walletHealth: {
      totalAvailableBalance,
      totalLockedBalance,
      totalPendingPayoutBalance,
      totalPaidOutBalance,
      pendingWithdrawalsCount,
      pendingWithdrawalsAmount,
      reviewRequiredCount,
      failedWithdrawalsCount,
    },
    fedapayWebhooks: {
      totalCount: totalWebhooks,
      processedCount: processedWebhooks,
      failedCount: failedWebhooks,
      lastReceivedAt: latestWebhook?.createdAt ? latestWebhook.createdAt.toISOString() : null,
      lastProcessedAt: latestProcessed?.processedAt ? latestProcessed.processedAt.toISOString() : null,
      lastEventName: latestWebhook?.eventName ?? null,
    },
  });
});

// --------------------------------------------------------------------------
// 5. GET /admin/wallets (Superadmin Wallet Monitoring)
// --------------------------------------------------------------------------
router.get("/admin/wallets", async (req, res) => {
  if (!(await requireSuperAdmin(req, res))) return;

  const ownerTypeFilter = String(req.query.ownerType ?? "all").toLowerCase();
  const search = String(req.query.search ?? "").trim().toLowerCase();
  const hasBalanceOnly = req.query.hasBalance === "true";

  const wallets = await db
    .select({
      id: virtualWalletsTable.id,
      ownerType: virtualWalletsTable.ownerType,
      ownerId: virtualWalletsTable.ownerId,
      balance: virtualWalletsTable.balance,
      lockedBalance: virtualWalletsTable.lockedBalance,
      pendingPayoutBalance: virtualWalletsTable.pendingPayoutBalance,
      paidOutBalance: virtualWalletsTable.paidOutBalance,
      createdAt: virtualWalletsTable.createdAt,
      updatedAt: virtualWalletsTable.updatedAt,
    })
    .from(virtualWalletsTable)
    .orderBy(desc(virtualWalletsTable.balance), desc(virtualWalletsTable.updatedAt));

  // Resolve safe owner labels
  const driverIds = wallets.filter((w) => w.ownerType === "driver").map((w) => w.ownerId);
  const vendorIds = wallets.filter((w) => w.ownerType === "seller").map((w) => w.ownerId);

  const driversMap = new Map<number, { name: string; phone: string }>();
  if (driverIds.length > 0) {
    const drivers = await db
      .select({ id: driversTable.id, firstName: driversTable.firstName, lastName: driversTable.lastName, phone: driversTable.phone })
      .from(driversTable)
      .where(inArray(driversTable.id, driverIds));
    for (const d of drivers) {
      driversMap.set(d.id, { name: `${d.firstName} ${d.lastName}`, phone: d.phone });
    }
  }

  const vendorsMap = new Map<number, { name: string; shopName: string | null; phone: string }>();
  if (vendorIds.length > 0) {
    const vendors = await db
      .select({ id: vendorsTable.id, firstName: vendorsTable.firstName, lastName: vendorsTable.lastName, shopName: vendorsTable.shopName, phone: vendorsTable.phone })
      .from(vendorsTable)
      .where(inArray(vendorsTable.id, vendorIds));
    for (const v of vendors) {
      vendorsMap.set(v.id, { name: `${v.firstName} ${v.lastName}`, shopName: v.shopName, phone: v.phone });
    }
  }

  const formatted = wallets.map((w) => {
    let ownerName = `Compte #${w.ownerId}`;
    let contact = "";

    if (w.ownerType === "driver") {
      const d = driversMap.get(w.ownerId);
      ownerName = d ? `Livreur: ${d.name}` : `Livreur #${w.ownerId}`;
      contact = d?.phone ?? "";
    } else if (w.ownerType === "seller") {
      const v = vendorsMap.get(w.ownerId);
      ownerName = v ? `Vendeur: ${v.shopName ? `${v.shopName} (${v.name})` : v.name}` : `Vendeur #${w.ownerId}`;
      contact = v?.phone ?? "";
    } else if (w.ownerType === "buyer") {
      ownerName = `Acheteur #${w.ownerId}`;
    }

    return {
      id: w.id,
      ownerType: w.ownerType,
      ownerId: w.ownerId,
      ownerName,
      contact,
      balance: w.balance,
      lockedBalance: w.lockedBalance,
      pendingPayoutBalance: w.pendingPayoutBalance,
      paidOutBalance: w.paidOutBalance,
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
    };
  });

  const filtered = formatted.filter((w) => {
    if (ownerTypeFilter !== "all" && w.ownerType !== ownerTypeFilter) return false;
    if (hasBalanceOnly && w.balance === 0 && w.lockedBalance === 0 && w.pendingPayoutBalance === 0) return false;
    if (search) {
      const matchName = w.ownerName.toLowerCase().includes(search);
      const matchContact = w.contact.toLowerCase().includes(search);
      const matchId = String(w.ownerId).includes(search);
      if (!matchName && !matchContact && !matchId) return false;
    }
    return true;
  });

  return res.json({
    wallets: filtered,
    summary: {
      totalWallets: filtered.length,
      totalBalance: filtered.reduce((acc, w) => acc + w.balance, 0),
      totalLocked: filtered.reduce((acc, w) => acc + w.lockedBalance, 0),
      totalPendingPayout: filtered.reduce((acc, w) => acc + w.pendingPayoutBalance, 0),
      totalPaidOut: filtered.reduce((acc, w) => acc + w.paidOutBalance, 0),
    },
  });
});

// --------------------------------------------------------------------------
// 6. GET /admin/withdrawals (Withdrawal Requests Queue & Status)
// --------------------------------------------------------------------------
router.get("/admin/withdrawals", async (req, res) => {
  if (!(await requireSuperAdmin(req, res))) return;

  const statusFilter = String(req.query.status ?? "all").toLowerCase();
  const ownerTypeFilter = String(req.query.ownerType ?? "all").toLowerCase();

  const tickets = await db
    .select({
      id: deliveryWithdrawalTicketsTable.id,
      ownerType: deliveryWithdrawalTicketsTable.ownerType,
      ownerId: deliveryWithdrawalTicketsTable.ownerId,
      walletId: deliveryWithdrawalTicketsTable.walletId,
      phoneNumber: deliveryWithdrawalTicketsTable.phoneNumber,
      amount: deliveryWithdrawalTicketsTable.amount,
      dailyCumulativeAmount: deliveryWithdrawalTicketsTable.dailyCumulativeAmount,
      monthlyCumulativeAmount: deliveryWithdrawalTicketsTable.monthlyCumulativeAmount,
      status: deliveryWithdrawalTicketsTable.status,
      reviewReason: deliveryWithdrawalTicketsTable.reviewReason,
      createdAt: deliveryWithdrawalTicketsTable.createdAt,
      updatedAt: deliveryWithdrawalTicketsTable.updatedAt,
      fedapayPayoutId: payoutsFedapayTable.fedapayPayoutId,
      payoutStatus: payoutsFedapayTable.status,
      failureReason: payoutsFedapayTable.failureReason,
    })
    .from(deliveryWithdrawalTicketsTable)
    .leftJoin(
      payoutsFedapayTable,
      eq(deliveryWithdrawalTicketsTable.id, payoutsFedapayTable.withdrawalTicketId),
    )
    .orderBy(desc(deliveryWithdrawalTicketsTable.createdAt));

  const filtered = tickets.filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (ownerTypeFilter !== "all" && t.ownerType !== ownerTypeFilter) return false;
    return true;
  });

  return res.json({
    withdrawals: filtered.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
  });
});

// --------------------------------------------------------------------------
// 7. POST /admin/withdrawals/:ticketId/review (Approve or Reject review_required)
// --------------------------------------------------------------------------
router.post("/admin/withdrawals/:ticketId/review", async (req, res) => {
  if (!(await requireSuperAdmin(req, res))) return;

  const ticketId = Number(req.params.ticketId);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ error: "ID de ticket invalide." });
  }

  const action = String(req.body?.action ?? "").toLowerCase();
  const reason = String(req.body?.reason ?? "").trim();

  if (action !== "approve" && action !== "reject") {
    return res.status(400).json({ error: "Action doit être 'approve' ou 'reject'." });
  }

  const [ticket] = await db
    .select()
    .from(deliveryWithdrawalTicketsTable)
    .where(eq(deliveryWithdrawalTicketsTable.id, ticketId))
    .limit(1);

  if (!ticket) {
    return res.status(404).json({ error: "Ticket de retrait introuvable." });
  }

  if (ticket.status !== "withdrawal_review_required") {
    return res.status(400).json({
      error: `Ce ticket est au statut '${ticket.status}' et ne peut plus être révisé.`,
    });
  }

  if (action === "approve") {
    await db
      .update(deliveryWithdrawalTicketsTable)
      .set({
        status: "withdrawal_reserved",
        reviewReason: reason ? `Approuvé par superadmin: ${reason}` : "Approuvé par superadmin",
        updatedAt: new Date(),
      })
      .where(eq(deliveryWithdrawalTicketsTable.id, ticketId));

    await db.insert(deliveryAuditLogsTable).values({
      actorType: "superadmin",
      action: "admin_approve_withdrawal_review",
      metadata: { ticketId, reason, amount: ticket.amount },
    });

    return res.json({ success: true, status: "withdrawal_reserved" });
  }

  // Reject: return locked funds back to available balance
  await db.transaction(async (tx) => {
    await tx
      .update(deliveryWithdrawalTicketsTable)
      .set({
        status: "failed",
        reviewReason: reason ? `Rejeté par superadmin: ${reason}` : "Rejeté par superadmin",
        updatedAt: new Date(),
      })
      .where(eq(deliveryWithdrawalTicketsTable.id, ticketId));

    // Release funds in wallet: decrease pendingPayoutBalance and increase balance
    await tx
      .update(virtualWalletsTable)
      .set({
        balance: sql`${virtualWalletsTable.balance} + ${ticket.amount}`,
        pendingPayoutBalance: sql`GREATEST(0, ${virtualWalletsTable.pendingPayoutBalance} - ${ticket.amount})`,
        updatedAt: new Date(),
      })
      .where(eq(virtualWalletsTable.id, ticket.walletId));

    await tx.insert(deliveryAuditLogsTable).values({
      actorType: "superadmin",
      action: "admin_reject_withdrawal_review",
      metadata: { ticketId, reason, amount: ticket.amount, walletId: ticket.walletId },
    });
  });

  return res.json({ success: true, status: "failed", reason });
});

// --------------------------------------------------------------------------
// 8. GET /admin/drivers/:driverId/history (Assignment & Mission History)
// --------------------------------------------------------------------------
router.get("/admin/drivers/:driverId/history", async (req, res) => {
  if (!(await requireSuperAdmin(req, res))) return;

  const driverId = Number(req.params.driverId);
  if (!Number.isInteger(driverId) || driverId <= 0) {
    return res.status(400).json({ error: "ID livreur invalide." });
  }

  const [driver] = await db
    .select({
      id: driversTable.id,
      firstName: driversTable.firstName,
      lastName: driversTable.lastName,
      phone: driversTable.phone,
      workZone: driversTable.workZone,
      isActive: driversTable.isActive,
      isAvailable: driversTable.isAvailable,
      createdAt: driversTable.createdAt,
    })
    .from(driversTable)
    .where(eq(driversTable.id, driverId))
    .limit(1);

  if (!driver) {
    return res.status(404).json({ error: "Livreur introuvable." });
  }

  const jobs = await db
    .select({
      id: deliveryWorkflowJobsTable.id,
      orderId: deliveryWorkflowJobsTable.orderId,
      acceptanceStatus: deliveryWorkflowJobsTable.acceptanceStatus,
      assignmentExpiresAt: deliveryWorkflowJobsTable.assignmentExpiresAt,
      acceptedAt: deliveryWorkflowJobsTable.acceptedAt,
      refusedAt: deliveryWorkflowJobsTable.refusedAt,
      cancelledAt: deliveryWorkflowJobsTable.cancelledAt,
      createdAt: deliveryWorkflowJobsTable.createdAt,
      orderStatus: ordersTable.status,
      distanceKm: ordersTable.distanceLockedKm,
      transportFee: ordersTable.transportFeeLocked,
    })
    .from(deliveryWorkflowJobsTable)
    .leftJoin(ordersTable, eq(deliveryWorkflowJobsTable.orderId, ordersTable.id))
    .where(eq(deliveryWorkflowJobsTable.driverId, driverId))
    .orderBy(desc(deliveryWorkflowJobsTable.createdAt))
    .limit(50);

  const completedCount = jobs.filter((j) => j.orderStatus === "DELIVERED").length;
  const returnedCount = jobs.filter((j) => j.orderStatus === "RETURN_CONFIRMED" || j.orderStatus === "RETURN_AT_SELLER").length;
  const refusedCount = jobs.filter((j) => j.acceptanceStatus === "refused_by_driver").length;
  const acceptedCount = jobs.filter((j) => j.acceptanceStatus === "accepted_by_driver").length;

  return res.json({
    driver,
    stats: {
      totalAssigned: jobs.length,
      acceptedCount,
      refusedCount,
      completedCount,
      returnedCount,
      acceptanceRatePercent: jobs.length > 0 ? Math.round((acceptedCount / jobs.length) * 100) : 100,
    },
    history: jobs.map((j) => ({
      ...j,
      createdAt: j.createdAt.toISOString(),
      acceptedAt: j.acceptedAt?.toISOString() ?? null,
      refusedAt: j.refusedAt?.toISOString() ?? null,
      cancelledAt: j.cancelledAt?.toISOString() ?? null,
      assignmentExpiresAt: j.assignmentExpiresAt?.toISOString() ?? null,
    })),
  });
});

// --------------------------------------------------------------------------
// 9. GET /admin/orders/:orderId/audit (Traceability & Full Audit Trail)
// --------------------------------------------------------------------------
router.get("/admin/orders/:orderId/audit", async (req, res) => {
  if (!(await requireSuperAdmin(req, res))) return;

  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({ error: "ID de commande invalide." });
  }

  const [order] = await db
    .select({
      id: ordersTable.id,
      firstName: ordersTable.firstName,
      lastName: ordersTable.lastName,
      description: ordersTable.description,
      status: ordersTable.status,
      articlePriceLocked: ordersTable.articlePriceLocked,
      distanceLockedKm: ordersTable.distanceLockedKm,
      transportFeeLocked: ordersTable.transportFeeLocked,
      roundTripFeeLocked: ordersTable.roundTripFeeLocked,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);

  if (!order) {
    return res.status(404).json({ error: "Commande introuvable." });
  }

  // Jobs history
  const jobs = await db
    .select({
      id: deliveryWorkflowJobsTable.id,
      driverId: deliveryWorkflowJobsTable.driverId,
      driverFirstName: driversTable.firstName,
      driverLastName: driversTable.lastName,
      acceptanceStatus: deliveryWorkflowJobsTable.acceptanceStatus,
      acceptedAt: deliveryWorkflowJobsTable.acceptedAt,
      refusedAt: deliveryWorkflowJobsTable.refusedAt,
      cancelledAt: deliveryWorkflowJobsTable.cancelledAt,
      createdAt: deliveryWorkflowJobsTable.createdAt,
    })
    .from(deliveryWorkflowJobsTable)
    .leftJoin(driversTable, eq(deliveryWorkflowJobsTable.driverId, driversTable.id))
    .where(eq(deliveryWorkflowJobsTable.orderId, orderId))
    .orderBy(desc(deliveryWorkflowJobsTable.createdAt));

  // QR Tokens
  const qrTokens = await db
    .select({
      id: qrTokensTable.id,
      stage: qrTokensTable.stage,
      expiresAt: qrTokensTable.expiresAt,
      usedAt: qrTokensTable.usedAt,
      scannedByRole: qrTokensTable.scannedByRole,
      proximityMeters: qrTokensTable.proximityMeters,
      createdAt: qrTokensTable.createdAt,
    })
    .from(qrTokensTable)
    .where(eq(qrTokensTable.orderId, orderId))
    .orderBy(desc(qrTokensTable.createdAt));

  // Audit Logs
  const auditLogs = await db
    .select()
    .from(deliveryAuditLogsTable)
    .where(eq(deliveryAuditLogsTable.orderId, orderId))
    .orderBy(desc(deliveryAuditLogsTable.createdAt));

  // Accounting Ledger Entries
  const debitAccountAlias = aliasedTable(ledgerAccountsTable, "debit_acc");
  const creditAccountAlias = aliasedTable(ledgerAccountsTable, "credit_acc");

  const ledgerEntries = await db
    .select({
      id: ledgerEntriesTable.id,
      journalReference: ledgerEntriesTable.journalReference,
      amount: ledgerEntriesTable.amount,
      description: ledgerEntriesTable.description,
      createdAt: ledgerEntriesTable.createdAt,
      debitCode: debitAccountAlias.code,
      debitName: debitAccountAlias.name,
      creditCode: creditAccountAlias.code,
      creditName: creditAccountAlias.name,
      metadata: ledgerEntriesTable.metadata,
    })
    .from(ledgerEntriesTable)
    .leftJoin(debitAccountAlias, eq(ledgerEntriesTable.debitAccountId, debitAccountAlias.id))
    .leftJoin(creditAccountAlias, eq(ledgerEntriesTable.creditAccountId, creditAccountAlias.id))
    .where(
      sql`${ledgerEntriesTable.metadata}->>'orderId' = ${String(orderId)} OR ${ledgerEntriesTable.journalReference} ILIKE ${`%_${orderId}%`}`,
    )
    .orderBy(desc(ledgerEntriesTable.createdAt));

  return res.json({
    order: {
      ...order,
      createdAt: order.createdAt.toISOString(),
    },
    assignments: jobs.map((j) => ({
      ...j,
      driverName: j.driverFirstName ? `${j.driverFirstName} ${j.driverLastName}` : `Livreur #${j.driverId}`,
      createdAt: j.createdAt.toISOString(),
      acceptedAt: j.acceptedAt?.toISOString() ?? null,
      refusedAt: j.refusedAt?.toISOString() ?? null,
      cancelledAt: j.cancelledAt?.toISOString() ?? null,
    })),
    qrTokens: qrTokens.map((q) => ({
      ...q,
      createdAt: q.createdAt.toISOString(),
      expiresAt: q.expiresAt.toISOString(),
      usedAt: q.usedAt?.toISOString() ?? null,
    })),
    auditLogs: auditLogs.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    })),
    ledgerEntries: ledgerEntries.map((l) => ({
      ...l,
      createdAt: l.createdAt.toISOString(),
    })),
  });
});

export default router;
