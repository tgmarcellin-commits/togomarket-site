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

export interface JournalsSummary {
  totalJournals: number;
  totalDebitSum: number;
  totalCreditSum: number;
  isBalanced: boolean;
  balancedCount: number;
  reversedCount: number;
  reversalCount: number;
  pendingCorrectionCount: number;
}

export interface JournalsResponse {
  journals: FormattedJournal[];
  summary: JournalsSummary;
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface JournalFilters {
  journalType?: string;
  settlementStatus?: string;
  orderId?: number;
  driverId?: number;
  walletId?: number;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface OperationsOverview {
  activeMissions: {
    totalActive: number;
    pendingResponse: number;
    inTransit: number;
    returning: number;
  };
  driverStatus: {
    total: number;
    active: number;
    inactive: number;
    available: number;
    busy: number;
  };
  orderBreakdown: Record<string, number>;
  disputes: {
    openCount: number;
  };
  gpsHealth: {
    freshCount: number;
    staleAlertCount: number;
    missingCount: number;
    staleThresholdMinutes: number;
    staleAlerts: Array<{
      orderId: number;
      driverId: number;
      ageMinutes: number;
      lastRecordedAt: string | null;
    }>;
  };
  qrHealth: {
    totalIssued: number;
    used: number;
    activePending: number;
    expired: number;
    failedProximityCount: number;
    averageProximityMeters: number | null;
  };
  walletHealth: {
    totalAvailableBalance: number;
    totalLockedBalance: number;
    totalPendingPayoutBalance: number;
    totalPaidOutBalance: number;
    pendingWithdrawalsCount: number;
    pendingWithdrawalsAmount: number;
    reviewRequiredCount: number;
    failedWithdrawalsCount: number;
  };
  fedapayWebhooks: {
    totalCount: number;
    processedCount: number;
    failedCount: number;
    lastReceivedAt: string | null;
    lastProcessedAt: string | null;
    lastEventName: string | null;
  };
}

export interface AdminWalletItem {
  id: number;
  ownerType: "seller" | "driver" | "buyer";
  ownerId: number;
  ownerName: string;
  contact: string;
  balance: number;
  lockedBalance: number;
  pendingPayoutBalance: number;
  paidOutBalance: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminWalletsResponse {
  wallets: AdminWalletItem[];
  summary: {
    totalWallets: number;
    totalBalance: number;
    totalLocked: number;
    totalPendingPayout: number;
    totalPaidOut: number;
  };
}

export interface AdminWithdrawalTicket {
  id: number;
  ownerType: "seller" | "driver" | "buyer";
  ownerId: number;
  walletId: number;
  phoneNumber: string;
  amount: number;
  dailyCumulativeAmount: number;
  monthlyCumulativeAmount: number;
  status: string;
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
  fedapayPayoutId: string | null;
  payoutStatus: string | null;
  failureReason: string | null;
}

export interface DriverHistoryResponse {
  driver: {
    id: number;
    firstName: string;
    lastName: string;
    phone: string;
    workZone: string | null;
    isActive: boolean;
    isAvailable: boolean;
    createdAt: string;
  };
  stats: {
    totalAssigned: number;
    acceptedCount: number;
    refusedCount: number;
    completedCount: number;
    returnedCount: number;
    acceptanceRatePercent: number;
  };
  history: Array<{
    id: number;
    orderId: number;
    acceptanceStatus: string;
    assignmentExpiresAt: string | null;
    acceptedAt: string | null;
    refusedAt: string | null;
    cancelledAt: string | null;
    createdAt: string;
    orderStatus: string | null;
    distanceKm: number | null;
    transportFee: number | null;
  }>;
}

export interface OrderAuditResponse {
  order: {
    id: number;
    firstName: string;
    lastName: string;
    description: string;
    status: string;
    articlePriceLocked: number;
    distanceLockedKm: number | null;
    transportFeeLocked: number | null;
    roundTripFeeLocked: number | null;
    createdAt: string;
  };
  assignments: Array<{
    id: number;
    driverId: number;
    driverName: string;
    acceptanceStatus: string;
    acceptedAt: string | null;
    refusedAt: string | null;
    cancelledAt: string | null;
    createdAt: string;
  }>;
  qrTokens: Array<{
    id: number;
    stage: string;
    expiresAt: string;
    usedAt: string | null;
    scannedByRole: string | null;
    proximityMeters: number | null;
    createdAt: string;
  }>;
  auditLogs: Array<{
    id: number;
    actorType: string;
    actorId: string | null;
    action: string;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }>;
  ledgerEntries: Array<{
    id: number;
    journalReference: string;
    amount: number;
    description: string;
    debitCode: string;
    debitName: string;
    creditCode: string;
    creditName: string;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }>;
}

type FetchLike = typeof fetch;

export async function loadAdminJournals(
  adminCode: string,
  filters: JournalFilters = {},
  fetchImpl: FetchLike = fetch,
): Promise<JournalsResponse> {
  const query = new URLSearchParams();
  if (filters.journalType) query.set("journalType", filters.journalType);
  if (filters.settlementStatus) query.set("settlementStatus", filters.settlementStatus);
  if (filters.orderId) query.set("orderId", String(filters.orderId));
  if (filters.driverId) query.set("driverId", String(filters.driverId));
  if (filters.walletId) query.set("walletId", String(filters.walletId));
  if (filters.dateFrom) query.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) query.set("dateTo", filters.dateTo);
  if (filters.search) query.set("search", filters.search);
  if (filters.limit) query.set("limit", String(filters.limit));
  if (filters.offset) query.set("offset", String(filters.offset));

  const url = `/api/admin/comptabilite/journals${query.toString() ? `?${query.toString()}` : ""}`;
  const res = await fetchImpl(url, {
    headers: { "x-admin-code": adminCode },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error((errorData as { error?: string }).error ?? "Impossible de charger les écritures comptables.");
  }

  const data = await res.json() as JournalsResponse;
  return {
    journals: Array.isArray(data.journals) ? data.journals : [],
    summary: data.summary ?? {
      totalJournals: 0,
      totalDebitSum: 0,
      totalCreditSum: 0,
      isBalanced: true,
      balancedCount: 0,
      reversedCount: 0,
      reversalCount: 0,
      pendingCorrectionCount: 0,
    },
    pagination: data.pagination ?? {
      total: 0,
      limit: 100,
      offset: 0,
      hasMore: false,
    },
  };
}

export async function reverseAdminJournal(
  adminCode: string,
  journalReference: string,
  reason: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ success: boolean; reversalJournalReference: string; reversedEntriesCount: number }> {
  const res = await fetchImpl("/api/admin/comptabilite/reverse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-code": adminCode,
    },
    body: JSON.stringify({ journalReference, reason }),
  });

  const data = await res.json().catch(() => ({})) as {
    success?: boolean;
    reversalJournalReference?: string;
    reversedEntriesCount?: number;
    error?: string;
  };

  if (!res.ok || !data.success) {
    throw new Error(data.error ?? "Échec de l'annulation du journal comptable.");
  }

  return {
    success: true,
    reversalJournalReference: data.reversalJournalReference ?? `REV_${journalReference}`,
    reversedEntriesCount: data.reversedEntriesCount ?? 1,
  };
}

export async function loadOperationsOverview(
  adminCode: string,
  fetchImpl: FetchLike = fetch,
): Promise<OperationsOverview> {
  const res = await fetchImpl("/api/admin/operations/overview", {
    headers: { "x-admin-code": adminCode },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error((errorData as { error?: string }).error ?? "Impossible de charger la vue d'ensemble des opérations.");
  }

  return res.json() as Promise<OperationsOverview>;
}

export async function loadAdminWallets(
  adminCode: string,
  filters: { ownerType?: string; search?: string; hasBalance?: boolean } = {},
  fetchImpl: FetchLike = fetch,
): Promise<AdminWalletsResponse> {
  const query = new URLSearchParams();
  if (filters.ownerType) query.set("ownerType", filters.ownerType);
  if (filters.search) query.set("search", filters.search);
  if (filters.hasBalance) query.set("hasBalance", "true");

  const url = `/api/admin/wallets${query.toString() ? `?${query.toString()}` : ""}`;
  const res = await fetchImpl(url, {
    headers: { "x-admin-code": adminCode },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error((errorData as { error?: string }).error ?? "Impossible de charger les portefeuilles.");
  }

  return res.json() as Promise<AdminWalletsResponse>;
}

export async function loadAdminWithdrawals(
  adminCode: string,
  filters: { status?: string; ownerType?: string } = {},
  fetchImpl: FetchLike = fetch,
): Promise<AdminWithdrawalTicket[]> {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.ownerType) query.set("ownerType", filters.ownerType);

  const url = `/api/admin/withdrawals${query.toString() ? `?${query.toString()}` : ""}`;
  const res = await fetchImpl(url, {
    headers: { "x-admin-code": adminCode },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error((errorData as { error?: string }).error ?? "Impossible de charger les demandes de retrait.");
  }

  const data = await res.json() as { withdrawals?: AdminWithdrawalTicket[] };
  return Array.isArray(data.withdrawals) ? data.withdrawals : [];
}

export async function reviewAdminWithdrawal(
  adminCode: string,
  ticketId: number,
  action: "approve" | "reject",
  reason?: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ success: boolean; status: string }> {
  const res = await fetchImpl(`/api/admin/withdrawals/${ticketId}/review`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-code": adminCode,
    },
    body: JSON.stringify({ action, reason }),
  });

  const data = await res.json().catch(() => ({})) as { success?: boolean; status?: string; error?: string };
  if (!res.ok || !data.success) {
    throw new Error(data.error ?? "Échec du traitement du retrait.");
  }

  return { success: true, status: data.status ?? (action === "approve" ? "withdrawal_reserved" : "failed") };
}

export async function loadDriverHistory(
  adminCode: string,
  driverId: number,
  fetchImpl: FetchLike = fetch,
): Promise<DriverHistoryResponse> {
  const res = await fetchImpl(`/api/admin/drivers/${driverId}/history`, {
    headers: { "x-admin-code": adminCode },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error((errorData as { error?: string }).error ?? "Impossible de charger l'historique du livreur.");
  }

  return res.json() as Promise<DriverHistoryResponse>;
}

export async function loadOrderAudit(
  adminCode: string,
  orderId: number,
  fetchImpl: FetchLike = fetch,
): Promise<OrderAuditResponse> {
  const res = await fetchImpl(`/api/admin/orders/${orderId}/audit`, {
    headers: { "x-admin-code": adminCode },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error((errorData as { error?: string }).error ?? "Impossible de charger l'audit de la commande.");
  }

  return res.json() as Promise<OrderAuditResponse>;
}
