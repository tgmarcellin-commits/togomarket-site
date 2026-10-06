import { useCallback, useEffect, useState } from "react";
import { Landmark, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type Overview = {
  fedapay: { configured: boolean; reachable: boolean; balances: Array<{ mode: string; amount: number }>; totalFcfa: number };
  reserve: { balanceFcfa: number; alertThresholdFcfa: number };
  recent: Array<{ transactionId: string; target: "reserve" | "treasury"; amountFcfa: number; at: string }>;
};

type Target = "reserve" | "treasury";

const MIN_AMOUNT = 500;
const MAX_AMOUNT = 5_000_000;
const REFRESH_MS = 30_000;

const fcfa = (value: number) => `${new Intl.NumberFormat("fr-FR").format(value)} FCFA`;

const MODE_LABELS: Record<string, string> = {
  togocel: "Togocel",
  moov_tg: "Moov Togo",
  mtn: "MTN Bénin",
  moov: "Moov Bénin",
  mtn_ci: "MTN Côte d'Ivoire",
};

/**
 * Carte « Alimenter le compte FedaPay Marketplace » de la comptabilité (superadmin).
 * Le paiement se fait sur la page FedaPay, avec VOTRE moyen de paiement ; les frais FedaPay s'ajoutent, le compte reçoit le
 * montant demandé en entier. L'argent n'est inscrit (réserve du jeu ou trésorerie, grand livre) qu'à la confirmation de FedaPay.
 */
export function FedapayTopupCard({ adminCode }: { adminCode: string }) {
  const { toast } = useToast();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [target, setTarget] = useState<Target>("treasury");
  const [submitting, setSubmitting] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/fedapay-topup", { headers: { "x-admin-code": adminCode } });
      if (!response.ok) throw new Error(response.status === 403 ? "Accès refusé — superadmin requis." : "Soldes indisponibles pour le moment.");
      setOverview(await response.json() as Overview);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Soldes indisponibles pour le moment.");
    } finally {
      setLoading(false);
    }
  }, [adminCode]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const amountNumber = Number(amount);
  const amountValid = Number.isInteger(amountNumber) && amountNumber >= MIN_AMOUNT && amountNumber <= MAX_AMOUNT;

  const startPayment = async () => {
    if (!amountValid || submitting) return;
    setSubmitting(true);
    setPaymentUrl(null);
    try {
      const response = await fetch("/api/admin/fedapay-topup", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-code": adminCode },
        body: JSON.stringify({ amountFcfa: amountNumber, target }),
      });
      const data = await response.json().catch(() => null) as { paymentUrl?: unknown; error?: unknown } | null;
      if (!response.ok || typeof data?.paymentUrl !== "string") {
        throw new Error(typeof data?.error === "string" ? data.error : "Création du paiement impossible pour le moment.");
      }
      setPaymentUrl(data.paymentUrl);
      // Ouverture dans un nouvel onglet ; si le navigateur le bloque, le lien reste affiché juste en dessous
      window.open(data.paymentUrl, "_blank", "noopener,noreferrer");
      toast({ title: "Page de paiement FedaPay ouverte", description: "Payez, puis revenez ici : les soldes se mettent à jour automatiquement." });
    } catch (err) {
      toast({ title: "Alimentation impossible", description: err instanceof Error ? err.message : "Erreur inconnue.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm space-y-4" data-testid="fedapay-topup-card" aria-labelledby="fedapay-topup-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="fedapay-topup-title" className="text-base font-bold flex items-center gap-2">
            <Landmark className="w-4 h-4 text-primary" aria-hidden="true" />
            Alimenter le compte FedaPay Marketplace
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ajoutez des fonds chez FedaPay pour les retraits automatiques ou pour la réserve du jeu 10défis.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="h-8 text-xs shrink-0" aria-label="Actualiser les soldes">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
        </Button>
      </div>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      {overview && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Solde chez FedaPay</p>
            {!overview.fedapay.configured ? (
              <p className="mt-1 text-xs text-destructive">Clé FedaPay Marketplace non configurée.</p>
            ) : !overview.fedapay.reachable ? (
              <p className="mt-1 text-xs text-destructive">Soldes FedaPay momentanément illisibles.</p>
            ) : (
              <>
                <p className="mt-1 text-lg font-bold">{fcfa(overview.fedapay.totalFcfa)}</p>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {overview.fedapay.balances.map((balance) => (
                    <li key={balance.mode}>{MODE_LABELS[balance.mode] ?? balance.mode} : {fcfa(balance.amount)}</li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-muted-foreground">Un retrait est payé depuis le solde d'un seul opérateur.</p>
              </>
            )}
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Réserve du jeu 10défis</p>
            <p className="mt-1 text-lg font-bold">{fcfa(overview.reserve.balanceFcfa)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Alerte sous {fcfa(overview.reserve.alertThresholdFcfa)}</p>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted-foreground">Destination des fonds</legend>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="radio" name="topup-target" value="treasury" checked={target === "treasury"} onChange={() => setTarget("treasury")} className="mt-1" />
            <span><strong>Trésorerie FedaPay</strong> — pour payer les retraits des livreurs, vendeurs et acheteurs.</span>
          </label>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="radio" name="topup-target" value="reserve" checked={target === "reserve"} onChange={() => setTarget("reserve")} className="mt-1" />
            <span><strong>Réserve du jeu 10défis</strong> — couvre les achats payés avec le solde 10défis (alimente aussi la trésorerie).</span>
          </label>
        </fieldset>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="topup-amount" className="text-xs font-medium text-muted-foreground">Montant à ajouter (FCFA)</label>
            <Input
              id="topup-amount"
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="Ex : 20000"
              className="w-44"
              aria-invalid={amount !== "" && !amountValid}
            />
          </div>
          <Button onClick={() => void startPayment()} disabled={!amountValid || submitting} className="h-10" data-testid="fedapay-topup-submit">
            {submitting ? "Création…" : "Alimenter via FedaPay"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Entre {fcfa(MIN_AMOUNT)} et {fcfa(MAX_AMOUNT)}. Les frais FedaPay s'ajoutent à votre paiement ; le compte reçoit le montant saisi en entier.
        </p>

        {paymentUrl && (
          <p className="text-xs" role="status">
            Page de paiement non ouverte ?{" "}
            <a href={paymentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline">
              Ouvrir le paiement FedaPay <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          </p>
        )}
      </div>

      {overview && overview.recent.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Dernières alimentations enregistrées</p>
          <ul className="divide-y rounded-lg border text-xs">
            {overview.recent.map((item) => (
              <li key={`${item.target}-${item.transactionId}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>{item.target === "reserve" ? "Réserve 10défis" : "Trésorerie FedaPay"} · transaction {item.transactionId}</span>
                <span className="font-semibold">{fcfa(item.amountFcfa)} · {new Date(item.at).toLocaleString("fr-FR")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
