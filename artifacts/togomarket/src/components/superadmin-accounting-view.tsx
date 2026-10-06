import { useState, useEffect, useMemo, useCallback } from "react";
import {
  loadAdminJournals,
  reverseAdminJournal,
  type FormattedJournal,
  type JournalsSummary,
  type JournalFilters,
} from "@/pages/admin-accounting-api";
import {
  formatFcfa,
  getJournalStatusStyle,
  buildClientCsvFromJournals,
  triggerDownload,
} from "@/lib/admin-accounting-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FedapayTopupCard } from "@/components/fedapay-topup-card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ReceiptText,
  RefreshCw,
  Download,
  Search,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Eye,
  Filter,
  ArrowRight,
  ShieldCheck,
  FileSpreadsheet,
  FileCode,
  DollarSign,
  Scale,
} from "lucide-react";

interface SuperadminAccountingViewProps {
  adminCode: string;
}

export function SuperadminAccountingView({ adminCode }: SuperadminAccountingViewProps) {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [journals, setJournals] = useState<FormattedJournal[]>([]);
  const [summary, setSummary] = useState<JournalsSummary>({
    totalJournals: 0,
    totalDebitSum: 0,
    totalCreditSum: 0,
    isBalanced: true,
    balancedCount: 0,
    reversedCount: 0,
    reversalCount: 0,
    pendingCorrectionCount: 0,
  });

  // Filters state
  const [journalType, setJournalType] = useState<string>("all");
  const [settlementStatus, setSettlementStatus] = useState<string>("all");
  const [orderIdFilter, setOrderIdFilter] = useState<string>("");
  const [driverIdFilter, setDriverIdFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [searchText, setSearchText] = useState<string>("");

  // Modals state
  const [selectedJournal, setSelectedJournal] = useState<FormattedJournal | null>(null);
  const [reversalTarget, setReversalTarget] = useState<FormattedJournal | null>(null);
  const [reversalReason, setReversalReason] = useState<string>("");
  const [reversing, setReversing] = useState(false);

  const fetchJournals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: JournalFilters = {
        journalType: journalType !== "all" ? journalType : undefined,
        settlementStatus: settlementStatus !== "all" ? settlementStatus : undefined,
        orderId: orderIdFilter ? Number(orderIdFilter) : undefined,
        driverId: driverIdFilter ? Number(driverIdFilter) : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        search: searchText || undefined,
        limit: 200,
      };

      const res = await loadAdminJournals(adminCode, filters);
      setJournals(res.journals);
      setSummary(res.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement des journaux comptables.");
    } finally {
      setLoading(false);
    }
  }, [adminCode, journalType, settlementStatus, orderIdFilter, driverIdFilter, dateFrom, dateTo, searchText]);

  useEffect(() => {
    void fetchJournals();
  }, [fetchJournals]);

  const handleExportCsv = () => {
    if (journals.length === 0) {
      toast({ title: "Aucune écriture à exporter", description: "Le filtre actuel ne contient aucune transaction." });
      return;
    }
    const csv = buildClientCsvFromJournals(journals);
    triggerDownload(csv, `journal-comptable-${new Date().toISOString().split("T")[0]}.csv`, "text/csv;charset=utf-8");
    toast({ title: "Export CSV réussi", description: `${journals.length} journal(aux) exporté(s).` });
  };

  const handleExportJson = () => {
    if (journals.length === 0) {
      toast({ title: "Aucune écriture à exporter", description: "Le filtre actuel ne contient aucune transaction." });
      return;
    }
    const json = JSON.stringify(journals, null, 2);
    triggerDownload(json, `journal-comptable-${new Date().toISOString().split("T")[0]}.json`, "application/json");
    toast({ title: "Export JSON réussi", description: `${journals.length} journal(aux) exporté(s).` });
  };

  const handleConfirmReversal = async () => {
    if (!reversalTarget) return;
    if (!reversalReason.trim() || reversalReason.trim().length < 3) {
      toast({
        title: "Motif requis",
        description: "Veuillez fournir un motif explicite d'annulation (au moins 3 caractères).",
        variant: "destructive",
      });
      return;
    }

    setReversing(true);
    try {
      const res = await reverseAdminJournal(adminCode, reversalTarget.journalReference, reversalReason.trim());
      toast({
        title: "Contre-passation effectuée",
        description: `Référence d'annulation générée: ${res.reversalJournalReference}`,
      });
      setReversalTarget(null);
      setReversalReason("");
      void fetchJournals();
    } catch (err) {
      toast({
        title: "Échec de l'annulation",
        description: err instanceof Error ? err.message : "Erreur lors de la contre-passation.",
        variant: "destructive",
      });
    } finally {
      setReversing(false);
    }
  };

  const resetFilters = () => {
    setJournalType("all");
    setSettlementStatus("all");
    setOrderIdFilter("");
    setDriverIdFilter("");
    setDateFrom("");
    setDateTo("");
    setSearchText("");
  };

  return (
    <div className="space-y-6">
      {/* Page Title & Actions */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ReceiptText className="w-5 h-5 text-primary" />
            Comptabilité & Grand Livre
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Audit exhaustif en partie double, balance générale et suivi des annulations administratives
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleExportCsv} className="h-8 text-xs">
            <FileSpreadsheet className="w-3.5 h-3.5 mr-1 text-emerald-600" />
            Exporter CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportJson} className="h-8 text-xs">
            <FileCode className="w-3.5 h-3.5 mr-1 text-blue-600" />
            Exporter JSON
          </Button>
          <Button variant="default" size="sm" onClick={() => void fetchJournals()} disabled={loading} className="h-8 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            Actualiser
          </Button>
        </div>
      </div>

      {/* Alimentation du compte FedaPay Marketplace (retraits automatiques et réserve du jeu 10défis) */}
      <FedapayTopupCard adminCode={adminCode} />

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Total Débit</span>
            <DollarSign className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-xl font-bold mt-2 text-foreground">{formatFcfa(summary.totalDebitSum)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Actifs & Charges engagés</p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Total Crédit</span>
            <DollarSign className="w-4 h-4 text-blue-500" />
          </div>
          <p className="text-xl font-bold mt-2 text-foreground">{formatFcfa(summary.totalCreditSum)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Passifs & Produits constatés</p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Équilibre Comptable</span>
            <Scale className={`w-4 h-4 ${summary.isBalanced ? "text-emerald-500" : "text-destructive"}`} />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
              summary.isBalanced ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"
            }`}>
              {summary.isBalanced ? (
                <>
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Parfaitement Équilibré
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Déséquilibre Détecté
                </>
              )}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Écart: {formatFcfa(Math.abs(summary.totalDebitSum - summary.totalCreditSum))}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Journaux & Reversals</span>
            <RotateCcw className="w-4 h-4 text-purple-500" />
          </div>
          <p className="text-xl font-bold mt-2 text-foreground">
            {summary.totalJournals}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              ({summary.reversedCount} annulés, {summary.reversalCount} reversals)
            </span>
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            {summary.balancedCount} équilibrés actifs
          </p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">Filtres d'audit</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="text-xs h-7 text-muted-foreground hover:text-foreground">
            Réinitialiser
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {/* Journal Type */}
          <div>
            <label className="text-[11px] text-muted-foreground font-medium block mb-1">Type de flux</label>
            <select
              value={journalType}
              onChange={(e) => setJournalType(e.target.value)}
              className="h-8 w-full rounded-md border bg-background px-2 text-xs"
            >
              <option value="all">Tous les types</option>
              <option value="delivery">Livraisons</option>
              <option value="return">Retours</option>
              <option value="withdrawal">Retraits Portefeuille</option>
              <option value="reversal">Annulations (Reversals)</option>
              <option value="dispute">Litiges</option>
            </select>
          </div>

          {/* Settlement Status */}
          <div>
            <label className="text-[11px] text-muted-foreground font-medium block mb-1">Statut d'équilibre</label>
            <select
              value={settlementStatus}
              onChange={(e) => setSettlementStatus(e.target.value)}
              className="h-8 w-full rounded-md border bg-background px-2 text-xs"
            >
              <option value="all">Tous les statuts</option>
              <option value="balanced">Équilibré</option>
              <option value="reversed">Contre-passé</option>
              <option value="reversal">Écriture d'annulation</option>
              <option value="pending_correction">À corriger</option>
            </select>
          </div>

          {/* Order ID */}
          <div>
            <label className="text-[11px] text-muted-foreground font-medium block mb-1">N° Commande</label>
            <Input
              type="number"
              placeholder="Ex: 42"
              value={orderIdFilter}
              onChange={(e) => setOrderIdFilter(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          {/* Driver ID */}
          <div>
            <label className="text-[11px] text-muted-foreground font-medium block mb-1">N° Livreur</label>
            <Input
              type="number"
              placeholder="Ex: 7"
              value={driverIdFilter}
              onChange={(e) => setDriverIdFilter(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          {/* Date From */}
          <div>
            <label className="text-[11px] text-muted-foreground font-medium block mb-1">Date début</label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="text-[11px] text-muted-foreground font-medium block mb-1">Date fin</label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>

        {/* Text Search Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Rechercher par référence, description, compte..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="h-8 text-xs pl-8"
          />
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-xs text-destructive flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void fetchJournals()} className="h-7 text-xs">
            Réessayer
          </Button>
        </div>
      )}

      {/* Journals Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b bg-muted/40 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                <th className="py-3 px-4">Référence & Date</th>
                <th className="py-3 px-4">Description & Liens</th>
                <th className="py-3 px-4 text-right">Débit</th>
                <th className="py-3 px-4 text-right">Crédit</th>
                <th className="py-3 px-4 text-center">Statut</th>
                <th className="py-3 px-4">Relations d'audit</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    <RefreshCw className="w-5 h-5 mx-auto animate-spin mb-2 text-primary" />
                    Chargement des journaux comptables...
                  </td>
                </tr>
              ) : journals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    <ReceiptText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    Aucune transaction comptable ne correspond aux critères sélectionnés.
                  </td>
                </tr>
              ) : (
                journals.map((j) => {
                  const style = getJournalStatusStyle(j.status);
                  const isRev = j.isReversal;
                  const isAlreadyReversed = Boolean(j.reversedBy);

                  return (
                    <tr key={j.journalReference} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4 align-top">
                        <div className="font-mono font-medium text-foreground">{j.journalReference}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {new Date(j.createdAt).toLocaleString("fr-FR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </td>

                      <td className="py-3 px-4 align-top max-w-xs">
                        <div className="text-foreground font-medium truncate" title={j.description}>
                          {j.description}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {j.orderId && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-500/10 text-blue-600">
                              Cmd #{j.orderId}
                            </span>
                          )}
                          {j.driverId && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-600">
                              Livreur #{j.driverId}
                            </span>
                          )}
                          {j.walletId && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-500/10 text-purple-600">
                              Portefeuille #{j.walletId}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground">({j.legs.length} écriture(s))</span>
                        </div>
                      </td>

                      <td className="py-3 px-4 align-top text-right font-medium text-foreground font-mono">
                        {formatFcfa(j.totalDebit)}
                      </td>

                      <td className="py-3 px-4 align-top text-right font-medium text-foreground font-mono">
                        {formatFcfa(j.totalCredit)}
                      </td>

                      <td className="py-3 px-4 align-top text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${style.badgeClass}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${style.dotClass}`} />
                          {style.label}
                        </span>
                      </td>

                      <td className="py-3 px-4 align-top text-[11px]">
                        {j.reversedFrom && (
                          <div className="text-purple-600 flex items-center gap-1 font-mono">
                            <RotateCcw className="w-3 h-3 shrink-0" />
                            <span className="truncate" title={`Annule: ${j.reversedFrom}`}>
                              Annule: {j.reversedFrom}
                            </span>
                          </div>
                        )}
                        {j.reversedBy && (
                          <div className="text-purple-600 flex items-center gap-1 font-mono">
                            <ArrowRight className="w-3 h-3 shrink-0" />
                            <span className="truncate" title={`Contre-passé par: ${j.reversedBy}`}>
                              Par: {j.reversedBy}
                            </span>
                          </div>
                        )}
                        {j.reversalReason && (
                          <div className="text-muted-foreground text-[10px] italic mt-0.5 truncate" title={j.reversalReason}>
                            "{j.reversalReason}"
                          </div>
                        )}
                        {!j.reversedFrom && !j.reversedBy && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      <td className="py-3 px-4 align-top text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedJournal(j)}
                            className="h-7 px-2 text-xs"
                            title="Voir les écritures en partie double"
                          >
                            <Eye className="w-3.5 h-3.5 mr-1" />
                            Détails
                          </Button>
                          {!isRev && !isAlreadyReversed && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setReversalTarget(j);
                                setReversalReason("");
                              }}
                              className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                              title="Contre-passer ce journal"
                            >
                              <RotateCcw className="w-3.5 h-3.5 mr-1" />
                              Annuler
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Journal Details Modal */}
      <Dialog open={selectedJournal !== null} onOpenChange={(open) => !open && setSelectedJournal(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ReceiptText className="w-4 h-4 text-primary" />
              Détail du Journal: {selectedJournal?.journalReference}
            </DialogTitle>
          </DialogHeader>

          {selectedJournal && (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-muted/30 p-3 rounded-lg">
                <div>
                  <span className="text-[10px] text-muted-foreground font-semibold uppercase">Date</span>
                  <p className="font-medium mt-0.5">{new Date(selectedJournal.createdAt).toLocaleString("fr-FR")}</p>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground font-semibold uppercase">Statut</span>
                  <div className="mt-0.5">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${getJournalStatusStyle(selectedJournal.status).badgeClass}`}>
                      {getJournalStatusStyle(selectedJournal.status).label}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground font-semibold uppercase">Total Débit</span>
                  <p className="font-mono font-bold text-foreground mt-0.5">{formatFcfa(selectedJournal.totalDebit)}</p>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground font-semibold uppercase">Total Crédit</span>
                  <p className="font-mono font-bold text-foreground mt-0.5">{formatFcfa(selectedJournal.totalCredit)}</p>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-2 uppercase text-[10px] text-muted-foreground tracking-wider">
                  Écritures en Partie Double ({selectedJournal.legs.length})
                </h4>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-muted/50 border-b text-[10px] text-muted-foreground uppercase">
                        <th className="py-2 px-3">Compte Débit</th>
                        <th className="py-2 px-3">Compte Crédit</th>
                        <th className="py-2 px-3 text-right">Montant</th>
                        <th className="py-2 px-3">Libellé</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {selectedJournal.legs.map((leg) => (
                        <tr key={leg.id} className="hover:bg-muted/20">
                          <td className="py-2 px-3 align-top font-mono">
                            <span className="font-semibold text-foreground">{leg.debitAccount.code}</span>
                            <div className="text-[10px] text-muted-foreground">{leg.debitAccount.name}</div>
                          </td>
                          <td className="py-2 px-3 align-top font-mono">
                            <span className="font-semibold text-foreground">{leg.creditAccount.code}</span>
                            <div className="text-[10px] text-muted-foreground">{leg.creditAccount.name}</div>
                          </td>
                          <td className="py-2 px-3 align-top text-right font-mono font-medium">
                            {formatFcfa(leg.amount)}
                          </td>
                          <td className="py-2 px-3 align-top text-muted-foreground">
                            {leg.description}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedJournal.reversalReason && (
                <div className="bg-purple-500/10 border border-purple-500/20 p-3 rounded-lg text-purple-700">
                  <span className="font-semibold block text-[10px] uppercase">Motif de la contre-passation</span>
                  <p className="mt-0.5">{selectedJournal.reversalReason}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSelectedJournal(null)} className="h-8 text-xs">
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reversal Confirmation Modal */}
      <Dialog open={reversalTarget !== null} onOpenChange={(open) => !open && setReversalTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base text-destructive">
              <RotateCcw className="w-4 h-4" />
              Contre-passer l'écriture comptable
            </DialogTitle>
          </DialogHeader>

          {reversalTarget && (
            <div className="space-y-3 text-xs">
              <p className="text-foreground">
                Vous êtes sur le point d'inverser l'écriture double-entry du journal{" "}
                <span className="font-mono font-bold">{reversalTarget.journalReference}</span> ({formatFcfa(reversalTarget.totalDebit)}).
              </p>
              <p className="text-muted-foreground">
                Une nouvelle écriture d'annulation immutable portant le préfixe <span className="font-mono">REV_</span> sera enregistrée dans le Grand Livre.
              </p>

              <div>
                <label className="block text-[11px] font-semibold uppercase text-muted-foreground mb-1">
                  Motif d'annulation obligatoire *
                </label>
                <Input
                  placeholder="Ex: Erreur de saisie distance / Litige acheteur validé"
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReversalTarget(null)}
              disabled={reversing}
              className="h-8 text-xs"
            >
              Annuler
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleConfirmReversal()}
              disabled={reversing || !reversalReason.trim() || reversalReason.trim().length < 3}
              className="h-8 text-xs"
            >
              {reversing ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 mr-1" />}
              Confirmer la contre-passation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
