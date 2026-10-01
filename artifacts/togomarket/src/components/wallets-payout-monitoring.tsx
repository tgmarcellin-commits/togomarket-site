import { useState, useEffect, useCallback, useMemo } from "react";
import {
  loadAdminWallets,
  loadAdminWithdrawals,
  reviewAdminWithdrawal,
  type AdminWalletItem,
  type AdminWithdrawalTicket,
} from "@/pages/admin-accounting-api";
import {
  formatFcfa,
  formatDateTime,
  getWithdrawalStatusBadge,
} from "@/lib/admin-accounting-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Wallet,
  ArrowDownRight,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

interface WalletsPayoutMonitoringProps {
  adminCode: string;
}

export function WalletsPayoutMonitoring({ adminCode }: WalletsPayoutMonitoringProps) {
  const [activeTab, setActiveTab] = useState<"wallets" | "withdrawals">("withdrawals");
  const [wallets, setWallets] = useState<AdminWalletItem[]>([]);
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawalTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [walletTypeFilter, setWalletTypeFilter] = useState<string>("ALL");
  const [walletSearch, setWalletSearch] = useState("");
  const [withdrawalStatusFilter, setWithdrawalStatusFilter] = useState<string>("ALL");

  // Review modal state
  const [reviewTicket, setReviewTicket] = useState<AdminWithdrawalTicket | null>(null);
  const [reviewDecision, setReviewDecision] = useState<"approve" | "reject">("approve");
  const [reviewReason, setReviewReason] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [walletRes, withdrawalList] = await Promise.all([
        loadAdminWallets(adminCode),
        loadAdminWithdrawals(adminCode),
      ]);
      setWallets(walletRes.wallets ?? []);
      setWithdrawals(withdrawalList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement des portefeuilles et retraits.");
    } finally {
      setLoading(false);
    }
  }, [adminCode]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Aggregate stats
  const aggregateStats = useMemo(() => {
    const totalAvailable = wallets.reduce((acc, w) => acc + w.balance, 0);
    const totalLocked = wallets.reduce((acc, w) => acc + w.lockedBalance, 0);
    const totalPendingPayout = wallets.reduce((acc, w) => acc + w.pendingPayoutBalance, 0);
    const totalPaidOut = wallets.reduce((acc, w) => acc + w.paidOutBalance, 0);
    const pendingWithdrawalCount = withdrawals.filter(
      (w) => w.status === "pending" || w.status === "withdrawal_review_required"
    ).length;
    const reviewRequiredCount = withdrawals.filter(
      (w) => w.status === "withdrawal_review_required"
    ).length;

    return {
      totalAvailable,
      totalLocked,
      totalPendingPayout,
      totalPaidOut,
      pendingWithdrawalCount,
      reviewRequiredCount,
    };
  }, [wallets, withdrawals]);

  // Filtered wallets
  const filteredWallets = useMemo(() => {
    return wallets.filter((w) => {
      if (walletTypeFilter !== "ALL" && w.ownerType !== walletTypeFilter) return false;
      if (walletSearch) {
        const q = walletSearch.toLowerCase();
        const matchesName = w.ownerName?.toLowerCase().includes(q);
        const matchesContact = w.contact?.toLowerCase().includes(q);
        const matchesId = String(w.id).includes(q) || String(w.ownerId).includes(q);
        if (!matchesName && !matchesContact && !matchesId) return false;
      }
      return true;
    });
  }, [wallets, walletTypeFilter, walletSearch]);

  // Filtered withdrawals
  const filteredWithdrawals = useMemo(() => {
    return withdrawals.filter((w) => {
      if (withdrawalStatusFilter !== "ALL" && w.status !== withdrawalStatusFilter) return false;
      return true;
    });
  }, [withdrawals, withdrawalStatusFilter]);

  const handleExecuteReview = async () => {
    if (!reviewTicket) return;
    if (reviewDecision === "reject" && !reviewReason.trim()) {
      setReviewError("Une raison explicite est requise pour rejeter une demande de retrait.");
      return;
    }

    setSubmittingReview(true);
    setReviewError(null);
    try {
      await reviewAdminWithdrawal(adminCode, reviewTicket.id, reviewDecision, reviewReason);
      setReviewTicket(null);
      setReviewReason("");
      await fetchData();
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "Erreur lors de la validation du retrait.");
    } finally {
      setSubmittingReview(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Wallet className="w-5 h-5 text-emerald-500" />
            Portefeuilles & Files de Retraits
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Suivi des soldes disponibles, fonds séquestres, vérification FedaPay et traitement des retraits
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void fetchData()} disabled={loading} className="h-8 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            Actualiser
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-xs text-destructive flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void fetchData()} className="h-7 text-xs">
            Réessayer
          </Button>
        </div>
      )}

      {/* Aggregate Balance Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <span className="text-[11px] font-medium text-muted-foreground uppercase">Disponible Total</span>
          <p className="text-xl font-bold mt-1 text-emerald-600">
            {formatFcfa(aggregateStats.totalAvailable)}
          </p>
          <span className="text-[10px] text-muted-foreground">Fonds retirables immédiatement</span>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <span className="text-[11px] font-medium text-muted-foreground uppercase">Séquestre (En cours)</span>
          <p className="text-xl font-bold mt-1 text-blue-600">
            {formatFcfa(aggregateStats.totalLocked)}
          </p>
          <span className="text-[10px] text-muted-foreground">Lié à des commandes non livrées</span>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <span className="text-[11px] font-medium text-muted-foreground uppercase">Retraits en Transit</span>
          <p className="text-xl font-bold mt-1 text-amber-600">
            {formatFcfa(aggregateStats.totalPendingPayout)}
          </p>
          <span className="text-[10px] text-muted-foreground">Réservé FedaPay / En validation</span>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <span className="text-[11px] font-medium text-muted-foreground uppercase">Total Sorti (Payé)</span>
          <p className="text-xl font-bold mt-1 text-foreground">
            {formatFcfa(aggregateStats.totalPaidOut)}
          </p>
          <span className="text-[10px] text-muted-foreground">Transféré avec succès aux bénéficiaires</span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b">
        <button
          onClick={() => setActiveTab("withdrawals")}
          className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "withdrawals"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <ArrowDownRight className="w-4 h-4" />
          File des Demandes de Retrait ({withdrawals.length})
          {aggregateStats.reviewRequiredCount > 0 && (
            <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full ml-1">
              {aggregateStats.reviewRequiredCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("wallets")}
          className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "wallets"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Wallet className="w-4 h-4" />
          Comptes Portefeuilles ({wallets.length})
        </button>
      </div>

      {/* Content 1: Demandes de Retrait */}
      {activeTab === "withdrawals" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 bg-muted/40 p-1 rounded-lg border text-xs">
              <Filter className="w-3.5 h-3.5 text-muted-foreground ml-1" />
              <button
                onClick={() => setWithdrawalStatusFilter("ALL")}
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  withdrawalStatusFilter === "ALL" ? "bg-background shadow-xs text-foreground" : "text-muted-foreground"
                }`}
              >
                Tous ({withdrawals.length})
              </button>
              <button
                onClick={() => setWithdrawalStatusFilter("withdrawal_review_required")}
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  withdrawalStatusFilter === "withdrawal_review_required" ? "bg-background shadow-xs text-amber-600" : "text-muted-foreground"
                }`}
              >
                Revue Requise ({withdrawals.filter((w) => w.status === "withdrawal_review_required").length})
              </button>
              <button
                onClick={() => setWithdrawalStatusFilter("withdrawal_reserved")}
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  withdrawalStatusFilter === "withdrawal_reserved" ? "bg-background shadow-xs text-blue-600" : "text-muted-foreground"
                }`}
              >
                Réservés
              </button>
              <button
                onClick={() => setWithdrawalStatusFilter("completed")}
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  withdrawalStatusFilter === "completed" ? "bg-background shadow-xs text-emerald-600" : "text-muted-foreground"
                }`}
              >
                Payés
              </button>
              <button
                onClick={() => setWithdrawalStatusFilter("failed")}
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  withdrawalStatusFilter === "failed" ? "bg-background shadow-xs text-destructive" : "text-muted-foreground"
                }`}
              >
                Échoués / Rejetés
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/50 border-b text-[11px] font-semibold text-muted-foreground uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Ticket / Date</th>
                    <th className="py-2.5 px-3">Bénéficiaire</th>
                    <th className="py-2.5 px-3">Rôle</th>
                    <th className="py-2.5 px-3 text-right">Montant</th>
                    <th className="py-2.5 px-3">Téléphone</th>
                    <th className="py-2.5 px-3">Statut</th>
                    <th className="py-2.5 px-3">Raison / FedaPay</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredWithdrawals.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-muted-foreground">
                        Aucune demande de retrait pour les filtres sélectionnés.
                      </td>
                    </tr>
                  ) : (
                    filteredWithdrawals.map((ticket) => {
                      const badge = getWithdrawalStatusBadge(ticket.status);
                      const isReviewable = ticket.status === "withdrawal_review_required";

                      return (
                        <tr key={ticket.id} className="hover:bg-muted/20 transition-colors">
                          <td className="py-2.5 px-3 font-mono font-medium">
                            <div>#{ticket.id}</div>
                            <div className="text-[10px] text-muted-foreground font-sans">
                              {formatDateTime(ticket.createdAt)}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-medium">
                            {ticket.ownerType} #{ticket.ownerId}
                          </td>
                          <td className="py-2.5 px-3 capitalize text-muted-foreground">
                            {ticket.ownerType}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-foreground">
                            {formatFcfa(ticket.amount)}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px]">
                            {ticket.phoneNumber}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge.color}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-muted-foreground max-w-[200px] truncate" title={ticket.failureReason || ticket.payoutStatus || ""}>
                            {ticket.failureReason ? (
                              <span className="text-destructive font-medium">{ticket.failureReason}</span>
                            ) : ticket.payoutStatus ? (
                              <span className="font-mono text-[10px]">{ticket.payoutStatus}</span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {isReviewable ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setReviewTicket(ticket);
                                  setReviewDecision("approve");
                                  setReviewReason("");
                                  setReviewError(null);
                                }}
                                className="h-7 text-xs border-amber-500 text-amber-700 hover:bg-amber-50"
                              >
                                Examiner
                              </Button>
                            ) : (
                              <span className="text-muted-foreground text-[10px]">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Content 2: Liste des Portefeuilles */}
      {activeTab === "wallets" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="relative w-64">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Recherche titulaire, contact, ID..."
                  value={walletSearch}
                  onChange={(e) => setWalletSearch(e.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-lg border text-xs">
                <button
                  onClick={() => setWalletTypeFilter("ALL")}
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    walletTypeFilter === "ALL" ? "bg-background shadow-xs text-foreground" : "text-muted-foreground"
                  }`}
                >
                  Tous
                </button>
                <button
                  onClick={() => setWalletTypeFilter("driver")}
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    walletTypeFilter === "driver" ? "bg-background shadow-xs text-foreground" : "text-muted-foreground"
                  }`}
                >
                  Livreurs
                </button>
                <button
                  onClick={() => setWalletTypeFilter("seller")}
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    walletTypeFilter === "seller" ? "bg-background shadow-xs text-foreground" : "text-muted-foreground"
                  }`}
                >
                  Vendeurs
                </button>
                <button
                  onClick={() => setWalletTypeFilter("buyer")}
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    walletTypeFilter === "buyer" ? "bg-background shadow-xs text-foreground" : "text-muted-foreground"
                  }`}
                >
                  Acheteurs
                </button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {filteredWallets.length} portefeuille(s) trouvé(s)
            </div>
          </div>

          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/50 border-b text-[11px] font-semibold text-muted-foreground uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Portefeuille ID</th>
                    <th className="py-2.5 px-3">Titulaire</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3 text-right">Disponible</th>
                    <th className="py-2.5 px-3 text-right">Séquestre Bloqué</th>
                    <th className="py-2.5 px-3 text-right">Retrait en Cours</th>
                    <th className="py-2.5 px-3 text-right">Total Sorti</th>
                    <th className="py-2.5 px-3">Dernière Opération</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredWallets.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-muted-foreground">
                        Aucun portefeuille trouvé.
                      </td>
                    </tr>
                  ) : (
                    filteredWallets.map((wallet) => (
                      <tr key={wallet.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-medium">#{wallet.id}</td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold">{wallet.ownerName}</div>
                          {wallet.contact && (
                            <div className="text-[10px] text-muted-foreground">{wallet.contact}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 capitalize text-muted-foreground">
                          {wallet.ownerType}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-emerald-600">
                          {formatFcfa(wallet.balance)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold text-blue-600">
                          {formatFcfa(wallet.lockedBalance)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold text-amber-600">
                          {formatFcfa(wallet.pendingPayoutBalance)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-muted-foreground font-mono">
                          {formatFcfa(wallet.paidOutBalance)}
                        </td>
                        <td className="py-2.5 px-3 text-[10px] text-muted-foreground">
                          {formatDateTime(wallet.updatedAt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal d'examen de ticket de retrait */}
      {reviewTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card border rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-amber-500" />
                <h3 className="font-bold text-base">Revue Superadmin Retrait #{reviewTicket.id}</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setReviewTicket(null)}
                className="h-7 w-7 p-0"
              >
                ✕
              </Button>
            </div>

            <div className="bg-muted/40 p-3 rounded-lg text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bénéficiaire:</span>
                <span className="font-medium">{reviewTicket.ownerType} #{reviewTicket.ownerId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Montant net demandé:</span>
                <span className="font-bold text-foreground">{formatFcfa(reviewTicket.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Destination:</span>
                <span className="font-mono">{reviewTicket.phoneNumber}</span>
              </div>
              {reviewTicket.failureReason && (
                <div className="text-destructive font-medium pt-1 border-t">
                  Cause alerte : {reviewTicket.failureReason}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium">Décision :</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setReviewDecision("approve")}
                  className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    reviewDecision === "approve"
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-700"
                      : "border-border hover:bg-muted/40 text-muted-foreground"
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Approuver & Réserver
                </button>
                <button
                  type="button"
                  onClick={() => setReviewDecision("reject")}
                  className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    reviewDecision === "reject"
                      ? "border-destructive bg-destructive/10 text-destructive"
                      : "border-border hover:bg-muted/40 text-muted-foreground"
                  }`}
                >
                  <XCircle className="w-4 h-4" />
                  Rejeter & Rembourser
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                Motif d'audit {reviewDecision === "reject" && <span className="text-destructive">*</span>} :
              </label>
              <Input
                type="text"
                placeholder={
                  reviewDecision === "reject"
                    ? "Obligatoire : Ex. Solde insuffisant, compte suspect..."
                    : "Facultatif : Observation admin..."
                }
                value={reviewReason}
                onChange={(e) => setReviewReason(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            {reviewError && (
              <div className="text-xs text-destructive bg-destructive/10 p-2.5 rounded border border-destructive/20">
                {reviewError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReviewTicket(null)}
                disabled={submittingReview}
                className="h-8 text-xs"
              >
                Annuler
              </Button>
              <Button
                variant={reviewDecision === "approve" ? "default" : "destructive"}
                size="sm"
                onClick={() => void handleExecuteReview()}
                disabled={submittingReview}
                className="h-8 text-xs"
              >
                {submittingReview ? "Traitement..." : reviewDecision === "approve" ? "Confirmer Approbation" : "Confirmer Rejet"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
