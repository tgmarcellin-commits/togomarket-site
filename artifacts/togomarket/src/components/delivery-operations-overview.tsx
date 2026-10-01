import { useState, useEffect, useCallback } from "react";
import {
  loadOperationsOverview,
  type OperationsOverview,
} from "@/pages/admin-accounting-api";
import {
  formatFcfa,
  computeGpsFreshness,
  computeQrHealth,
} from "@/lib/admin-accounting-ui";
import { Button } from "@/components/ui/button";
import {
  Activity,
  Truck,
  Users,
  QrCode,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Wallet,
  Radio,
  Clock,
  ArrowRight,
  ShieldAlert,
  Webhook,
} from "lucide-react";

interface DeliveryOperationsOverviewProps {
  adminCode: string;
}

export function DeliveryOperationsOverview({ adminCode }: DeliveryOperationsOverviewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<OperationsOverview | null>(null);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadOperationsOverview(adminCode);
      setOverview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur chargement des opérations.");
    } finally {
      setLoading(false);
    }
  }, [adminCode]);

  useEffect(() => {
    void fetchOverview();
    const timer = setInterval(() => {
      void fetchOverview();
    }, 30_000);
    return () => clearInterval(timer);
  }, [fetchOverview]);

  const gpsStatus = overview ? computeGpsFreshness(overview.gpsHealth) : null;
  const qrStatus = overview ? computeQrHealth(overview.qrHealth) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Opérations & Santé de Livraison
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Supervision temps réel : missions, flotte livreurs, GPS, validations QR et flux webhooks
          </p>
        </div>
        <Button variant="default" size="sm" onClick={() => void fetchOverview()} disabled={loading} className="h-8 text-xs">
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-xs text-destructive flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void fetchOverview()} className="h-7 text-xs">
            Réessayer
          </Button>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Missions Actives */}
        <div className="rounded-xl border bg-card p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Missions en cours</span>
              <Truck className="w-4 h-4 text-blue-500" />
            </div>
            <p className="text-2xl font-bold mt-2 text-foreground">
              {overview?.activeMissions.totalActive ?? 0}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t text-[11px] space-y-1 text-muted-foreground">
            <div className="flex justify-between">
              <span>En transit vers l'acheteur:</span>
              <span className="font-semibold text-foreground">{overview?.activeMissions.inTransit ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span>En cours de retour vendeur:</span>
              <span className="font-semibold text-foreground">{overview?.activeMissions.returning ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span>En attente de réponse livreur:</span>
              <span className="font-semibold text-amber-600">{overview?.activeMissions.pendingResponse ?? 0}</span>
            </div>
          </div>
        </div>

        {/* 2. Flotte Livreurs */}
        <div className="rounded-xl border bg-card p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Flotte Livreurs</span>
              <Users className="w-4 h-4 text-emerald-500" />
            </div>
            <p className="text-2xl font-bold mt-2 text-foreground">
              {overview?.driverStatus.available ?? 0}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                / {overview?.driverStatus.total ?? 0} au total
              </span>
            </p>
          </div>
          <div className="mt-4 pt-3 border-t text-[11px] space-y-1 text-muted-foreground">
            <div className="flex justify-between">
              <span>Disponibles immédiatement:</span>
              <span className="font-semibold text-emerald-600">{overview?.driverStatus.available ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span>En mission (occupés):</span>
              <span className="font-semibold text-blue-600">{overview?.driverStatus.busy ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span>Inactifs / Désactivés:</span>
              <span className="font-semibold text-muted-foreground">{overview?.driverStatus.inactive ?? 0}</span>
            </div>
          </div>
        </div>

        {/* 3. Signal GPS & Fraîcheur */}
        <div className="rounded-xl border bg-card p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Fraîcheur GPS</span>
              <Radio className={`w-4 h-4 ${gpsStatus?.isHealthy ? "text-emerald-500" : "text-destructive"}`} />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                gpsStatus?.isHealthy ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"
              }`}>
                {gpsStatus?.isHealthy ? (
                  <>
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Signaux Frais (&lt;10m)
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Alertes GPS Détectées
                  </>
                )}
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t text-[11px] space-y-1 text-muted-foreground">
            <div className="flex justify-between">
              <span>Positions fraîches (&lt;10m):</span>
              <span className="font-semibold text-emerald-600">{overview?.gpsHealth.freshCount ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span>Signal obsolète (&gt;10 min):</span>
              <span className="font-semibold text-destructive">{overview?.gpsHealth.staleAlertCount ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span>Position non initialisée:</span>
              <span className="font-semibold text-amber-600">{overview?.gpsHealth.missingCount ?? 0}</span>
            </div>
          </div>
        </div>

        {/* 4. Validations QR Code */}
        <div className="rounded-xl border bg-card p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Santé QR Tokens (3 min)</span>
              <QrCode className="w-4 h-4 text-purple-500" />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                qrStatus?.isHealthy ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"
              }`}>
                {qrStatus?.isHealthy ? "Proximité OK (&le;150m)" : "Écarts de proximité"}
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t text-[11px] space-y-1 text-muted-foreground">
            <div className="flex justify-between">
              <span>Tokens utilisés avec succès:</span>
              <span className="font-semibold text-foreground">{overview?.qrHealth.used ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span>Tokens expirés (non scannés):</span>
              <span className="font-semibold text-muted-foreground">{overview?.qrHealth.expired ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span>Scan hors zone (&gt;150m):</span>
              <span className="font-semibold text-destructive">{overview?.qrHealth.failedProximityCount ?? 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Alertes GPS Obsolète si présentes */}
      {overview && overview.gpsHealth.staleAlerts.length > 0 && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 space-y-2">
          <div className="flex items-center gap-2 text-destructive font-semibold text-xs uppercase tracking-wide">
            <ShieldAlert className="w-4 h-4" />
            Alertes GPS : Positions non rafraîchies sur livraisons actives ({overview.gpsHealth.staleAlerts.length})
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {overview.gpsHealth.staleAlerts.map((alert, idx) => (
              <div key={idx} className="bg-background/80 rounded-lg p-2.5 border text-xs">
                <div className="flex justify-between font-medium">
                  <span>Commande #{alert.orderId}</span>
                  <span className="text-destructive font-semibold">
                    {alert.ageMinutes > 120 ? "Signal perdu" : `Obsolète: ${alert.ageMinutes} min`}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Livreur assigné #{alert.driverId} • Dernier ping:{" "}
                  {alert.lastRecordedAt ? new Date(alert.lastRecordedAt).toLocaleTimeString("fr-FR") : "Aucun"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Row 2: Portefeuilles & FedaPay Webhooks */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Portefeuilles & Payouts */}
        <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b pb-2">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-emerald-500" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                Santé Portefeuilles & Retraits
              </h3>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted/30 p-2.5 rounded-lg">
              <span className="text-[10px] text-muted-foreground uppercase font-semibold">Solde Disponible</span>
              <p className="text-base font-bold text-foreground mt-0.5">
                {formatFcfa(overview?.walletHealth.totalAvailableBalance ?? 0)}
              </p>
            </div>
            <div className="bg-muted/30 p-2.5 rounded-lg">
              <span className="text-[10px] text-muted-foreground uppercase font-semibold">Solde Séquestre (Bloqué)</span>
              <p className="text-base font-bold text-blue-600 mt-0.5">
                {formatFcfa(overview?.walletHealth.totalLockedBalance ?? 0)}
              </p>
            </div>
            <div className="bg-muted/30 p-2.5 rounded-lg">
              <span className="text-[10px] text-muted-foreground uppercase font-semibold">En cours de virement</span>
              <p className="text-base font-bold text-amber-600 mt-0.5">
                {formatFcfa(overview?.walletHealth.totalPendingPayoutBalance ?? 0)}
              </p>
            </div>
            <div className="bg-muted/30 p-2.5 rounded-lg">
              <span className="text-[10px] text-muted-foreground uppercase font-semibold">Retraits Traités Payés</span>
              <p className="text-base font-bold text-emerald-600 mt-0.5">
                {formatFcfa(overview?.walletHealth.totalPaidOutBalance ?? 0)}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
            <span>Retraits en attente de revue :</span>
            <span className={`font-semibold ${overview?.walletHealth.reviewRequiredCount ? "text-amber-600" : "text-foreground"}`}>
              {overview?.walletHealth.reviewRequiredCount ?? 0} ticket(s)
            </span>
          </div>
        </div>

        {/* FedaPay Webhooks */}
        <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b pb-2">
            <div className="flex items-center gap-2">
              <Webhook className="w-4 h-4 text-primary" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                Événements Webhooks FedaPay
              </h3>
            </div>
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
              (overview?.fedapayWebhooks.failedCount ?? 0) === 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"
            }`}>
              {(overview?.fedapayWebhooks.failedCount ?? 0) === 0 ? "Opérationnel" : `${overview?.fedapayWebhooks.failedCount} échecs`}
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b">
              <span className="text-muted-foreground">Total événements reçus:</span>
              <span className="font-semibold font-mono text-foreground">{overview?.fedapayWebhooks.totalCount ?? 0}</span>
            </div>
            <div className="flex justify-between py-1 border-b">
              <span className="text-muted-foreground">Traités avec succès:</span>
              <span className="font-semibold font-mono text-emerald-600">{overview?.fedapayWebhooks.processedCount ?? 0}</span>
            </div>
            <div className="flex justify-between py-1 border-b">
              <span className="text-muted-foreground">Dernier webhook reçu:</span>
              <span className="font-medium text-foreground">
                {overview?.fedapayWebhooks.lastReceivedAt
                  ? new Date(overview.fedapayWebhooks.lastReceivedAt).toLocaleString("fr-FR")
                  : "Aucun"}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Dernier événement type:</span>
              <span className="font-mono text-[11px] text-foreground font-medium">
                {overview?.fedapayWebhooks.lastEventName ?? "—"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
