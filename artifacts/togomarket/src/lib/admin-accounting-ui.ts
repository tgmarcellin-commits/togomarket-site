import type { FormattedJournal, OperationsOverview } from "@/pages/admin-accounting-api";

export function formatFcfa(amount: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(Math.round(amount))} FCFA`;
}

export type JournalStatusStyle = {
  label: string;
  badgeClass: string;
  dotClass: string;
};

export function getJournalStatusStyle(status: string): JournalStatusStyle {
  switch (status) {
    case "balanced":
      return {
        label: "Équilibré",
        badgeClass: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
        dotClass: "bg-emerald-500",
      };
    case "reversed":
      return {
        label: "Contre-passé",
        badgeClass: "bg-purple-500/10 text-purple-600 border-purple-500/20",
        dotClass: "bg-purple-500",
      };
    case "reversal":
      return {
        label: "Écriture d'annulation",
        badgeClass: "bg-amber-500/10 text-amber-600 border-amber-500/20",
        dotClass: "bg-amber-500",
      };
    case "pending_correction":
      return {
        label: "Déséquilibré (À corriger)",
        badgeClass: "bg-red-500/10 text-red-600 border-red-500/20",
        dotClass: "bg-red-500 animate-pulse",
      };
    case "failed":
      return {
        label: "Échec",
        badgeClass: "bg-red-500/10 text-red-600 border-red-500/20",
        dotClass: "bg-red-500",
      };
    default:
      return {
        label: status,
        badgeClass: "bg-muted text-muted-foreground border-border",
        dotClass: "bg-muted-foreground",
      };
  }
}

export function isJournalBalanced(journal: Pick<FormattedJournal, "totalDebit" | "totalCredit">): boolean {
  return journal.totalDebit === journal.totalCredit;
}

export function buildClientCsvFromJournals(journals: FormattedJournal[]): string {
  const escapeCsv = (val: unknown) => {
    const s = String(val ?? "").replace(/"/g, '""');
    return `"${s}"`;
  };

  const header = [
    "Reference",
    "Date",
    "Statut",
    "Annule_De",
    "Annule_Par",
    "Motif",
    "ID_Commande",
    "ID_Livreur",
    "Compte_Debit",
    "Compte_Credit",
    "Montant_FCFA",
    "Description",
  ].join(",");

  const lines = [header];

  for (const j of journals) {
    for (const leg of j.legs) {
      lines.push(
        [
          escapeCsv(j.journalReference),
          escapeCsv(j.createdAt),
          escapeCsv(j.status),
          escapeCsv(j.reversedFrom ?? ""),
          escapeCsv(j.reversedBy ?? ""),
          escapeCsv(j.reversalReason ?? ""),
          escapeCsv(j.orderId ?? ""),
          escapeCsv(j.driverId ?? ""),
          escapeCsv(`${leg.debitAccount.code} - ${leg.debitAccount.name}`),
          escapeCsv(`${leg.creditAccount.code} - ${leg.creditAccount.name}`),
          leg.amount,
          escapeCsv(leg.description),
        ].join(","),
      );
    }
  }

  return lines.join("\r\n");
}

export function triggerDownload(content: string, filename: string, mimeType = "text/csv;charset=utf-8"): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Ensures sensitive driver identification documents are NEVER leaked in non-admin or public views.
 */
export function sanitizeDriverForRole<T extends Record<string, unknown>>(
  driver: T,
  role: string | null | undefined,
): Omit<T, "idDocumentNumber" | "idDocumentPhotoUrl" | "phone" | "whatsappNumber"> | T {
  if (role === "superadmin") {
    return driver;
  }

  const sanitized = { ...driver };
  delete (sanitized as Record<string, unknown>).idDocumentNumber;
  delete (sanitized as Record<string, unknown>).idDocumentPhotoUrl;
  if (role !== "admin") {
    delete (sanitized as Record<string, unknown>).phone;
    delete (sanitized as Record<string, unknown>).whatsappNumber;
  }
  return sanitized;
}

export function computeGpsFreshness(
  overview: OperationsOverview["gpsHealth"],
): { isHealthy: boolean; alertMessage: string } {
  if (overview.staleAlertCount > 0 || overview.missingCount > 0) {
    return {
      isHealthy: false,
      alertMessage: `${overview.staleAlertCount} mission(s) avec signal GPS obsolète (>10 min) et ${overview.missingCount} sans localisation.`,
    };
  }
  return {
    isHealthy: true,
    alertMessage: "Toutes les missions actives transmettent un signal GPS récent.",
  };
}

export function computeQrHealth(
  overview: OperationsOverview["qrHealth"],
): { isHealthy: boolean; alertMessage: string } {
  if (overview.failedProximityCount > 0) {
    return {
      isHealthy: false,
      alertMessage: `${overview.failedProximityCount} tentative(s) de scan QR hors zone (>150m) détectée(s).`,
    };
  }
  return {
    isHealthy: true,
    alertMessage: "Validations QR normales, proximité respectée.",
  };
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? String(dateStr) : d.toLocaleString("fr-FR");
  } catch {
    return String(dateStr);
  }
}

export function getWithdrawalStatusBadge(status: string): { label: string; color: string } {
  switch (status) {
    case "completed":
      return { label: "Payé", color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" };
    case "pending":
      return { label: "En attente", color: "bg-amber-500/10 text-amber-600 border-amber-500/20" };
    case "withdrawal_review_required":
      return { label: "Revue requise", color: "bg-purple-500/10 text-purple-600 border-purple-500/20 font-bold" };
    case "withdrawal_reserved":
      return { label: "Réservé FedaPay", color: "bg-blue-500/10 text-blue-600 border-blue-500/20" };
    case "failed":
      return { label: "Échec / Rejeté", color: "bg-destructive/10 text-destructive border-destructive/20" };
    default:
      return { label: status, color: "bg-muted text-muted-foreground border-border" };
  }
}
