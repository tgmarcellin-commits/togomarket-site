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
  ne,
  and,
  or,
  desc,
  sql,
  inArray,
  notInArray,
  aliasedTable,
  count,
  sum,
  avg,
  gt,
  isNotNull,
} from "drizzle-orm";
import { isSuperAdmin, isAdminAny } from "../lib/admin-auth";
import { reverseJournalEntry, getTrialBalance, buildSafeMetadataIntFilter } from "../lib/accounting-ledger";
import { logAndRespondInternalError } from "../lib/route-errors";

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

function computeRowDebitCredit(row: {
  amount: number;
  debitAccountId: number;
  creditAccountId: number;
  metadata?: unknown;
}): { debit: number; credit: number } {
  const meta = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
  const entrySide = (meta.entrySide ?? meta.side) as string | undefined;

  if (typeof meta.debitAmount === "number" || typeof meta.creditAmount === "number") {
    const debit = typeof meta.debitAmount === "number" ? Math.max(0, meta.debitAmount) : 0;
    const credit = typeof meta.creditAmount === "number" ? Math.max(0, meta.creditAmount) : 0;
    return { debit, credit };
  }

  if (entrySide === "debit") {
    return { debit: row.amount, credit: 0 };
  }
  if (entrySide === "credit") {
    return { debit: 0, credit: row.amount };
  }
  if (entrySide === "balanced") {
    if (row.debitAccountId === row.creditAccountId) {
      return { debit: row.amount, credit: 0 };
    }
    return { debit: row.amount, credit: row.amount };
  }

  // If entrySide is not specified:
  // If debitAccountId === creditAccountId, it is a single-sided leg recorded with same account ID
  if (row.debitAccountId === row.creditAccountId) {
    return { debit: row.amount, credit: 0 };
  }

  // Paired leg with distinct debit and credit accounts
  return { debit: row.amount, credit: row.amount };
}

/**
 * Helper to build and group ledger entries into journal transactions.
 * When targetRefs is provided, only loads rows for those journal references.
 */
async function buildGroupedJournals(targetRefs?: string[]): Promise<FormattedJournal[]> {
  if (targetRefs !== undefined && targetRefs.length === 0) {
    return [];
  }

  const debitAccountAlias = aliasedTable(ledgerAccountsTable, "debit_account");
  const creditAccountAlias = aliasedTable(ledgerAccountsTable, "credit_account");

  const query = db
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
    .leftJoin(creditAccountAlias, eq(ledgerEntriesTable.creditAccountId, creditAccountAlias.id));

  if (targetRefs && targetRefs.length > 0) {
    query.where(inArray(ledgerEntriesTable.journalReference, targetRefs));
  }

  const rows = await query.orderBy(desc(ledgerEntriesTable.createdAt), desc(ledgerEntriesTable.id));

  // Also query reversals to correctly link reversedBy
  const reversalRows = await db
    .select({
      journalReference: ledgerEntriesTable.journalReference,
      metadata: ledgerEntriesTable.metadata,
    })
    .from(ledgerEntriesTable)
    .where(
      or(
        sql`${ledgerEntriesTable.journalReference} LIKE 'REV_%'`,
        sql`${ledgerEntriesTable.metadata}->>'reversedFrom' IS NOT NULL`
      )
    )
    .limit(1000);

  const reversalMap = new Map<string, { reversalRef: string; reason: string }>();
  for (const revRow of reversalRows) {
    const rMeta = (revRow.metadata && typeof revRow.metadata === "object" ? revRow.metadata : {}) as Record<string, unknown>;
    const reversedFrom = typeof rMeta.reversedFrom === "string"
      ? rMeta.reversedFrom
      : (revRow.journalReference.startsWith("REV_") ? revRow.journalReference.replace(/^REV_/, "") : null);
    const reversalReason = typeof rMeta.reversalReason === "string" ? rMeta.reversalReason : "Annulation administrative";
    if (reversedFrom) {
      reversalMap.set(reversedFrom, {
        reversalRef: revRow.journalReference,
        reason: reversalReason,
      });
    }
  }

  const journalMap = new Map<string, FormattedJournal>();

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

    const { debit: legDebit, credit: legCredit } = computeRowDebitCredit(row);
    group.legs.push(leg);
    group.entriesCount += 1;
    group.totalDebit += legDebit;
    group.totalCredit += legCredit;
    if (!group.orderId && orderId) group.orderId = orderId;
    if (!group.driverId && driverId) group.driverId = driverId;
    if (!group.walletId && walletId) group.walletId = walletId;
    if (!group.settlementRef && settlementRef) group.settlementRef = settlementRef;
  }

  // Second pass: apply true double-entry balance check and reversal status
  const list = Array.from(journalMap.values());
  for (const group of list) {
    group.isBalanced = group.totalDebit === group.totalCredit && group.totalDebit > 0;
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

  try {
  const journalType = String(req.query.journalType ?? "all").toLowerCase();
  const settlementStatus = String(req.query.settlementStatus ?? "all").toLowerCase();
  const orderId = req.query.orderId ? Number(req.query.orderId) : null;
  const driverId = req.query.driverId ? Number(req.query.driverId) : null;
  const walletId = req.query.walletId ? Number(req.query.walletId) : null;
  const search = String(req.query.search ?? "").trim().toLowerCase();
  const dateFrom = String(req.query.dateFrom ?? "").trim();
  const dateTo = String(req.query.dateTo ?? "").trim();
  const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 500);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);

  // Push SQL filters down to DB level where possible
  const sqlConditions = [];
  if (orderId) {
    sqlConditions.push(
      or(
        buildSafeMetadataIntFilter(ledgerEntriesTable.metadata, "orderId", orderId),
        sql`${ledgerEntriesTable.journalReference} ILIKE ${`%ORDER_${orderId}%`}`,
        sql`${ledgerEntriesTable.journalReference} ILIKE ${`%_${orderId}_%`}`
      )
    );
  }
  if (driverId) {
    sqlConditions.push(buildSafeMetadataIntFilter(ledgerEntriesTable.metadata, "driverId", driverId));
  }
  if (walletId) {
    sqlConditions.push(buildSafeMetadataIntFilter(ledgerEntriesTable.metadata, "walletId", walletId));
  }
  if (dateFrom) {
    sqlConditions.push(sql`${ledgerEntriesTable.createdAt} >= ${new Date(dateFrom)}`);
  }
  if (dateTo) {
    const endInclusive = dateTo.includes("T") ? dateTo : `${dateTo}T23:59:59.999Z`;
    sqlConditions.push(sql`${ledgerEntriesTable.createdAt} <= ${new Date(endInclusive)}`);
  }
  if (search) {
    sqlConditions.push(
      or(
        sql`${ledgerEntriesTable.journalReference} ILIKE ${`%${search}%`}`,
        sql`${ledgerEntriesTable.description} ILIKE ${`%${search}%`}`
      )
    );
  }
  if (journalType !== "all") {
    if (journalType === "delivery") {
      sqlConditions.push(or(sql`${ledgerEntriesTable.journalReference} ILIKE '%DELIVERY%'`, sql`${ledgerEntriesTable.journalReference} ILIKE '%LIVR%'`));
    } else if (journalType === "return") {
      sqlConditions.push(or(sql`${ledgerEntriesTable.journalReference} ILIKE '%RETURN%'`, sql`${ledgerEntriesTable.journalReference} ILIKE '%RETOUR%'`));
    } else if (journalType === "withdrawal") {
      sqlConditions.push(or(sql`${ledgerEntriesTable.journalReference} ILIKE '%WITHDRAWAL%'`, sql`${ledgerEntriesTable.journalReference} ILIKE '%RETRAIT%'`, sql`${ledgerEntriesTable.journalReference} ILIKE '%PAYOUT%'`));
    } else if (journalType === "reversal") {
      sqlConditions.push(sql`${ledgerEntriesTable.journalReference} LIKE 'REV_%'`);
    } else if (journalType === "dispute") {
      sqlConditions.push(or(sql`${ledgerEntriesTable.journalReference} ILIKE '%DISPUTE%'`, sql`${ledgerEntriesTable.journalReference} ILIKE '%LITIGE%'`));
    }
  }

  const whereClause = sqlConditions.length > 0 ? and(...sqlConditions) : undefined;

  // DB pagination for distinct journals
  const distinctJournalQuery = db
    .select({
      journalReference: ledgerEntriesTable.journalReference,
      maxCreatedAt: sql<Date>`max(${ledgerEntriesTable.createdAt})`,
    })
    .from(ledgerEntriesTable)
    .where(whereClause)
    .groupBy(ledgerEntriesTable.journalReference)
    .orderBy(desc(sql`max(${ledgerEntriesTable.createdAt})`));

  if (settlementStatus === "all") {
    const [countResult] = await db
      .select({ count: sql<number>`count(distinct ${ledgerEntriesTable.journalReference})` })
      .from(ledgerEntriesTable)
      .where(whereClause);
    const total = Number(countResult?.count ?? 0);

    const pagedRefRows = await distinctJournalQuery.limit(limit).offset(offset);
    const targetRefs = pagedRefRows.map((r) => r.journalReference);
    const paginated = await buildGroupedJournals(targetRefs);

    const totalDebitSum = paginated.reduce((acc, curr) => acc + curr.totalDebit, 0);
    const totalCreditSum = paginated.reduce((acc, curr) => acc + curr.totalCredit, 0);

    const summary = {
      totalJournals: total,
      totalDebitSum,
      totalCreditSum,
      isBalanced: totalDebitSum === totalCreditSum,
      balancedCount: paginated.filter((j) => j.status === "balanced").length,
      reversedCount: paginated.filter((j) => j.status === "reversed").length,
      reversalCount: paginated.filter((j) => j.status === "reversal").length,
      pendingCorrectionCount: paginated.filter((j) => j.status === "pending_correction").length,
    };

    return res.json({
      journals: paginated,
      summary,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  }

  // When filtering by specific status ('pending_correction', 'reversed', etc.)
  const candidateRefRows = await distinctJournalQuery.limit(500);
  const targetRefs = candidateRefRows.map((r) => r.journalReference);
  const candidateJournals = await buildGroupedJournals(targetRefs);
  const filtered = candidateJournals.filter((j) => j.status === settlementStatus);

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
  } catch (err) {
    logAndRespondInternalError(req, res, {
      route: "GET /admin/comptabilite/journals",
      message: "Impossible de charger les journaux comptables.",
      err,
      context: {
        journalType: req.query.journalType,
        settlementStatus: req.query.settlementStatus,
        orderId: req.query.orderId,
        driverId: req.query.driverId,
        walletId: req.query.walletId,
      },
    });
    return;
  }
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

  try {
    // Check if already reversed
    const [alreadyReversed] = await db
      .select({ id: ledgerEntriesTable.id })
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.journalReference, `REV_${journalReference}`))
      .limit(1);

    if (alreadyReversed) {
      return res.status(409).json({ error: "Cette écriture comptable a déjà été contre-passée / annulée." });
    }

  // Inner try/catch: reverseJournalEntry throws deliberate business-rule
  // errors (e.g. unbalanced journal, missing accounts) that are surfaced to
  // the admin as a specific 400 message. The outer try/catch below is a
  // safety net for any other (infra/DB) failure, returning a generic safe
  // 500 instead of letting it crash to the global "Erreur interne" handler.
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
  } catch (err) {
    logAndRespondInternalError(req, res, {
      route: "POST /admin/comptabilite/reverse",
      message: "Impossible de contre-passer ce journal comptable.",
      err,
      context: { journalReference },
    });
    return;
  }
});

// --------------------------------------------------------------------------
// 3. GET /admin/comptabilite/export
// --------------------------------------------------------------------------
router.get("/admin/comptabilite/export", async (req, res) => {
  if (!(await requireSuperAdmin(req, res))) return;

  try {
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
  } catch (err) {
    logAndRespondInternalError(req, res, {
      route: "GET /admin/comptabilite/export",
      message: "Impossible de générer l'export comptable.",
      err,
    });
    return;
  }
});

// --------------------------------------------------------------------------
// 4. GET /admin/operations/overview
// --------------------------------------------------------------------------
router.get("/admin/operations/overview", async (req, res) => {
  if (!(await requireAnyAdmin(req, res))) return;

  const degradedSections: string[] = [];

  // 1. Active missions & Order breakdown (pushed down to SQL)
  let orderBreakdown: Record<string, number> = {};
  let inTransitCount = 0;
  let returningCount = 0;
  let pendingResponseCount = 0;
  let totalActiveMissions = 0;
  try {
    const now = Date.now();
    const orderBreakdownRows = await db
      .select({
        status: ordersTable.status,
        count: count(),
      })
      .from(ordersTable)
      .groupBy(ordersTable.status);

    for (const row of orderBreakdownRows) {
      orderBreakdown[row.status] = Number(row.count);
    }

    inTransitCount = orderBreakdown["IN_TRANSIT"] ?? 0;
    returningCount = (orderBreakdown["RETURNING_TO_SELLER"] ?? 0) + (orderBreakdown["RETURN_AT_SELLER"] ?? 0);

    const [jobPendingStats] = await db
      .select({
        pendingResponseCount: sql<number>`coalesce(count(*) filter (where ${deliveryWorkflowJobsTable.acceptanceStatus} = 'pending_driver_response'), 0)`,
      })
      .from(deliveryWorkflowJobsTable);

    pendingResponseCount = Number(jobPendingStats?.pendingResponseCount ?? 0);
    totalActiveMissions = inTransitCount + returningCount + pendingResponseCount;
  } catch (err) {
    req.log?.error({ err, route: "GET /admin/operations/overview", section: "activeMissions" }, "Operations overview subsection failed");
    degradedSections.push("activeMissions");
  }

  // 2. Drivers status
  let totalDrivers = 0;
  let activeDrivers = 0;
  let inactiveDrivers = 0;
  let availableDrivers = 0;
  let busyDrivers = 0;
  try {
    const [driverStats] = await db
      .select({
        totalDrivers: count(),
        activeDrivers: sql<number>`coalesce(count(*) filter (where ${driversTable.isActive} = true), 0)`,
        inactiveDrivers: sql<number>`coalesce(count(*) filter (where ${driversTable.isActive} = false), 0)`,
      })
      .from(driversTable);

    totalDrivers = Number(driverStats?.totalDrivers ?? 0);
    activeDrivers = Number(driverStats?.activeDrivers ?? 0);
    inactiveDrivers = Number(driverStats?.inactiveDrivers ?? 0);

    const availableDriversRow = await db
      .select({
        availableCount: sql<number>`coalesce(count(*) filter (where ${driversTable.isActive} = true and ${driversTable.isAvailable} = true and ${driversTable.id} not in (
          select ${deliveryWorkflowJobsTable.driverId} from ${deliveryWorkflowJobsTable}
          inner join ${ordersTable} on ${deliveryWorkflowJobsTable.orderId} = ${ordersTable.id}
          where ${deliveryWorkflowJobsTable.acceptanceStatus} = 'accepted_by_driver'
          and ${ordersTable.status} in ('IN_TRANSIT', 'RETURNING_TO_SELLER', 'RETURN_AT_SELLER', 'ASSIGNED')
        )), 0)`,
      })
      .from(driversTable);

    availableDrivers = Number(availableDriversRow[0]?.availableCount ?? 0);
    busyDrivers = Math.max(0, activeDrivers - availableDrivers);
  } catch (err) {
    req.log?.error({ err, route: "GET /admin/operations/overview", section: "driverStatus" }, "Operations overview subsection failed");
    degradedSections.push("driverStatus");
  }

  // 3. Open disputes
  let openDisputesCount = 0;
  try {
    const [openDisputes] = await db
      .select({ count: count() })
      .from(disputesTable)
      .where(eq(disputesTable.status, "open"));
    openDisputesCount = Number(openDisputes?.count ?? 0);
  } catch (err) {
    req.log?.error({ err, route: "GET /admin/operations/overview", section: "disputes" }, "Operations overview subsection failed");
    degradedSections.push("disputes");
  }

  // 4. GPS Freshness check on active missions
  let freshGpsCount = 0;
  let staleAlertCount = 0;
  let missingGpsCount = 0;
  let staleAlerts: Array<{ orderId: number; driverId: number; ageMinutes: number; lastRecordedAt: string | null }> = [];
  try {
    const now = Date.now();
    const tenMinutesAgo = new Date(now - 10 * 60 * 1000);
    const activeJobs = await db
      .select({
        id: deliveryWorkflowJobsTable.id,
        orderId: deliveryWorkflowJobsTable.orderId,
        driverId: deliveryWorkflowJobsTable.driverId,
      })
      .from(deliveryWorkflowJobsTable)
      .innerJoin(ordersTable, eq(deliveryWorkflowJobsTable.orderId, ordersTable.id))
      .where(
        and(
          eq(deliveryWorkflowJobsTable.acceptanceStatus, "accepted_by_driver"),
          inArray(ordersTable.status, ["IN_TRANSIT", "RETURNING_TO_SELLER"])
        )
      );

    if (activeJobs.length > 0) {
      const activeJobIds = activeJobs.map((j) => j.id);
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
  } catch (err) {
    req.log?.error({ err, route: "GET /admin/operations/overview", section: "gpsHealth" }, "Operations overview subsection failed");
    degradedSections.push("gpsHealth");
  }

  // 5. QR Token Health (SQL aggregation)
  let totalQrIssued = 0;
  let qrUsed = 0;
  let qrActivePending = 0;
  let qrExpired = 0;
  let failedProximityCount = 0;
  let avgProximityMeters: number | null = null;
  try {
    const [qrStats] = await db
      .select({
        totalIssued: count(),
        used: sql<number>`coalesce(count(*) filter (where ${qrTokensTable.usedAt} is not null), 0)`,
        activePending: sql<number>`coalesce(count(*) filter (where ${qrTokensTable.usedAt} is null and ${qrTokensTable.expiresAt} > now()), 0)`,
        expired: sql<number>`coalesce(count(*) filter (where ${qrTokensTable.usedAt} is null and ${qrTokensTable.expiresAt} <= now()), 0)`,
        failedProximityCount: sql<number>`coalesce(count(*) filter (where ${qrTokensTable.proximityMeters} is not null and ${qrTokensTable.proximityMeters} > 150), 0)`,
        avgProximityMeters: sql<number | null>`round(avg(${qrTokensTable.proximityMeters}))`,
      })
      .from(qrTokensTable);

    totalQrIssued = Number(qrStats?.totalIssued ?? 0);
    qrUsed = Number(qrStats?.used ?? 0);
    qrActivePending = Number(qrStats?.activePending ?? 0);
    qrExpired = Number(qrStats?.expired ?? 0);
    failedProximityCount = Number(qrStats?.failedProximityCount ?? 0);
    avgProximityMeters = qrStats?.avgProximityMeters != null ? Number(qrStats.avgProximityMeters) : null;
  } catch (err) {
    req.log?.error({ err, route: "GET /admin/operations/overview", section: "qrHealth" }, "Operations overview subsection failed");
    degradedSections.push("qrHealth");
  }

  // 6. Wallet movement and Payout health summary (SQL aggregation)
  let totalAvailableBalance = 0;
  let totalLockedBalance = 0;
  let totalPendingPayoutBalance = 0;
  let totalPaidOutBalance = 0;
  let pendingWithdrawalsCount = 0;
  let pendingWithdrawalsAmount = 0;
  let reviewRequiredCount = 0;
  let failedWithdrawalsCount = 0;
  try {
    const [walletStats] = await db
      .select({
        totalAvailableBalance: sql<number>`coalesce(sum(${virtualWalletsTable.balance}), 0)`,
        totalLockedBalance: sql<number>`coalesce(sum(${virtualWalletsTable.lockedBalance}), 0)`,
        totalPendingPayoutBalance: sql<number>`coalesce(sum(${virtualWalletsTable.pendingPayoutBalance}), 0)`,
        totalPaidOutBalance: sql<number>`coalesce(sum(${virtualWalletsTable.paidOutBalance}), 0)`,
      })
      .from(virtualWalletsTable);

    totalAvailableBalance = Number(walletStats?.totalAvailableBalance ?? 0);
    totalLockedBalance = Number(walletStats?.totalLockedBalance ?? 0);
    totalPendingPayoutBalance = Number(walletStats?.totalPendingPayoutBalance ?? 0);
    totalPaidOutBalance = Number(walletStats?.totalPaidOutBalance ?? 0);

    const [withdrawalStats] = await db
      .select({
        pendingWithdrawalsCount: sql<number>`coalesce(count(*) filter (where ${deliveryWithdrawalTicketsTable.status} in ('pending_otp', 'otp_verified', 'withdrawal_reserved', 'withdrawal_review_required')), 0)`,
        pendingWithdrawalsAmount: sql<number>`coalesce(sum(${deliveryWithdrawalTicketsTable.amount}) filter (where ${deliveryWithdrawalTicketsTable.status} in ('pending_otp', 'otp_verified', 'withdrawal_reserved', 'withdrawal_review_required')), 0)`,
        reviewRequiredCount: sql<number>`coalesce(count(*) filter (where ${deliveryWithdrawalTicketsTable.status} = 'withdrawal_review_required'), 0)`,
        failedWithdrawalsCount: sql<number>`coalesce(count(*) filter (where ${deliveryWithdrawalTicketsTable.status} = 'failed'), 0)`,
      })
      .from(deliveryWithdrawalTicketsTable);

    pendingWithdrawalsCount = Number(withdrawalStats?.pendingWithdrawalsCount ?? 0);
    pendingWithdrawalsAmount = Number(withdrawalStats?.pendingWithdrawalsAmount ?? 0);
    reviewRequiredCount = Number(withdrawalStats?.reviewRequiredCount ?? 0);
    failedWithdrawalsCount = Number(withdrawalStats?.failedWithdrawalsCount ?? 0);
  } catch (err) {
    req.log?.error({ err, route: "GET /admin/operations/overview", section: "walletHealth" }, "Operations overview subsection failed");
    degradedSections.push("walletHealth");
  }

  // 7. FedaPay Webhook Events Health (SQL aggregation + targeted single latest rows)
  let totalWebhooks = 0;
  let processedWebhooks = 0;
  let failedWebhooks = 0;
  let lastReceivedAt: string | null = null;
  let lastProcessedAt: string | null = null;
  let lastEventName: string | null = null;
  try {
    const [webhookStats] = await db
      .select({
        totalWebhooks: count(),
        processedWebhooks: sql<number>`coalesce(count(*) filter (where ${paymentWebhooksTable.processed} = true), 0)`,
        failedWebhooks: sql<number>`coalesce(count(*) filter (where ${paymentWebhooksTable.processed} = false), 0)`,
      })
      .from(paymentWebhooksTable);

    const [latestWebhook] = await db
      .select({
        id: paymentWebhooksTable.id,
        eventName: paymentWebhooksTable.eventName,
        processed: paymentWebhooksTable.processed,
        processedAt: paymentWebhooksTable.processedAt,
        createdAt: paymentWebhooksTable.createdAt,
      })
      .from(paymentWebhooksTable)
      .orderBy(desc(paymentWebhooksTable.createdAt))
      .limit(1);

    const [latestProcessed] = await db
      .select({
        id: paymentWebhooksTable.id,
        eventName: paymentWebhooksTable.eventName,
        processed: paymentWebhooksTable.processed,
        processedAt: paymentWebhooksTable.processedAt,
        createdAt: paymentWebhooksTable.createdAt,
      })
      .from(paymentWebhooksTable)
      .where(and(eq(paymentWebhooksTable.processed, true), isNotNull(paymentWebhooksTable.processedAt)))
      .orderBy(desc(paymentWebhooksTable.createdAt))
      .limit(1);

    totalWebhooks = Number(webhookStats?.totalWebhooks ?? 0);
    processedWebhooks = Number(webhookStats?.processedWebhooks ?? 0);
    failedWebhooks = Number(webhookStats?.failedWebhooks ?? 0);
    lastReceivedAt = latestWebhook?.createdAt ? latestWebhook.createdAt.toISOString() : null;
    lastProcessedAt = latestProcessed?.processedAt ? latestProcessed.processedAt.toISOString() : null;
    lastEventName = latestWebhook?.eventName ?? null;
  } catch (err) {
    req.log?.error({ err, route: "GET /admin/operations/overview", section: "fedapayWebhooks" }, "Operations overview subsection failed");
    degradedSections.push("fedapayWebhooks");
  }

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
      openCount: openDisputesCount,
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
      lastReceivedAt,
      lastProcessedAt,
      lastEventName,
    },
    ...(degradedSections.length > 0 ? { degradedSections } : {}),
  });
});

// --------------------------------------------------------------------------
// 5. GET /admin/wallets (Superadmin Wallet Monitoring - DB Paginated)
// --------------------------------------------------------------------------
router.get("/admin/wallets", async (req, res) => {
  if (!(await requireSuperAdmin(req, res))) return;

  try {
  const ownerTypeFilter = String(req.query.ownerType ?? "all").toLowerCase();
  const search = String(req.query.search ?? "").trim().toLowerCase();
  const hasBalanceOnly = req.query.hasBalance === "true";
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
  const offset = req.query.offset ? Math.max(0, parseInt(req.query.offset as string, 10)) : (page - 1) * limit;

  const conditions = [];
  if (ownerTypeFilter !== "all" && ["seller", "driver", "buyer"].includes(ownerTypeFilter)) {
    conditions.push(eq(virtualWalletsTable.ownerType, ownerTypeFilter as any));
  }
  if (hasBalanceOnly) {
    conditions.push(
      or(
        gt(virtualWalletsTable.balance, 0),
        gt(virtualWalletsTable.lockedBalance, 0),
        gt(virtualWalletsTable.pendingPayoutBalance, 0)
      )
    );
  }
  if (search) {
    const searchNum = Number(search);
    if (!isNaN(searchNum) && Number.isInteger(searchNum)) {
      conditions.push(
        or(
          eq(virtualWalletsTable.id, searchNum),
          eq(virtualWalletsTable.ownerId, searchNum)
        )
      );
    } else {
      conditions.push(sql`${virtualWalletsTable.ownerType}::text ILIKE ${`%${search}%`}`);
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // DB-level summary totals
  const [summary] = await db
    .select({
      totalWallets: count(),
      totalBalance: sql<number>`coalesce(sum(${virtualWalletsTable.balance}), 0)`,
      totalLocked: sql<number>`coalesce(sum(${virtualWalletsTable.lockedBalance}), 0)`,
      totalPendingPayout: sql<number>`coalesce(sum(${virtualWalletsTable.pendingPayoutBalance}), 0)`,
      totalPaidOut: sql<number>`coalesce(sum(${virtualWalletsTable.paidOutBalance}), 0)`,
    })
    .from(virtualWalletsTable)
    .where(whereClause);

  // DB-level paginated wallets query
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
    .where(whereClause)
    .orderBy(desc(virtualWalletsTable.balance), desc(virtualWalletsTable.updatedAt))
    .limit(limit)
    .offset(offset);

  // Resolve safe owner labels only for the paginated slice
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

  return res.json({
    wallets: formatted,
    summary: {
      totalWallets: Number(summary?.totalWallets ?? 0),
      totalBalance: Number(summary?.totalBalance ?? 0),
      totalLocked: Number(summary?.totalLocked ?? 0),
      totalPendingPayout: Number(summary?.totalPendingPayout ?? 0),
      totalPaidOut: Number(summary?.totalPaidOut ?? 0),
    },
  });
  } catch (err) {
    logAndRespondInternalError(req, res, {
      route: "GET /admin/wallets",
      message: "Impossible de charger les portefeuilles.",
      err,
    });
    return;
  }
});

// --------------------------------------------------------------------------
// 6. GET /admin/withdrawals (Withdrawal Requests Queue & Status)
// --------------------------------------------------------------------------
router.get("/admin/withdrawals", async (req, res) => {
  if (!(await requireSuperAdmin(req, res))) return;

  try {
  const statusFilter = String(req.query.status ?? "all").toLowerCase();
  const ownerTypeFilter = String(req.query.ownerType ?? "all").toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit ?? 200), 1), 500);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);

  const conditions = [];
  if (statusFilter !== "all") {
    conditions.push(eq(deliveryWithdrawalTicketsTable.status, statusFilter as any));
  }
  if (ownerTypeFilter !== "all" && ["seller", "driver", "buyer"].includes(ownerTypeFilter)) {
    conditions.push(eq(deliveryWithdrawalTicketsTable.ownerType, ownerTypeFilter as any));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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
    .where(whereClause)
    .orderBy(desc(deliveryWithdrawalTicketsTable.createdAt))
    .limit(limit)
    .offset(offset);

  return res.json({
    withdrawals: tickets.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
  });
  } catch (err) {
    logAndRespondInternalError(req, res, {
      route: "GET /admin/withdrawals",
      message: "Impossible de charger les retraits.",
      err,
    });
    return;
  }
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

  try {
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
  } catch (err) {
    logAndRespondInternalError(req, res, {
      route: "POST /admin/withdrawals/:ticketId/review",
      message: "Impossible de traiter cette révision de retrait.",
      err,
      context: { ticketId },
    });
    return;
  }
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

  try {
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
  } catch (err) {
    logAndRespondInternalError(req, res, {
      route: "GET /admin/drivers/:driverId/history",
      message: "Impossible de charger l'historique de ce livreur.",
      err,
      context: { driverId },
    });
    return;
  }
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

  try {
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
  } catch (err) {
    logAndRespondInternalError(req, res, {
      route: "GET /admin/orders/:orderId/audit",
      message: "Impossible de charger l'audit de cette commande.",
      err,
      context: { orderId },
    });
    return;
  }
});

export default router;
