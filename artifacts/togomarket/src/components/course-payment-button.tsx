import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSiteSettings } from "@/lib/site-settings";

type Breakdown = {
  articlePrice: number;
  driverFee: number;
  buyerCommission: number;
  total: number;
};

type CoursePaymentStatus = {
  orderId: number | null;
  driverAccepted: boolean;
  paid: boolean;
  paymentDeadlineAt: string | null;
  breakdown: Breakdown | null;
};

const POLL_INTERVAL_MS = 8_000;

function formatFcfa(amount: number, isFrench: boolean): string {
  return `${new Intl.NumberFormat(isFrench ? "fr-FR" : "en-US").format(amount)} FCFA`;
}

/**
 * Bouton « Payer la course » affiché à l'ACHETEUR dans la messagerie, une fois que
 * le livreur a accepté la commande. Le montant est calculé par le serveur :
 * ce composant n'envoie jamais de prix.
 *
 * Total = prix de l'article + prix du livreur + 250 FCFA (commission TogoMarket acheteur).
 */
export function CoursePaymentButton({
  conversationId,
  buyerToken,
}: {
  conversationId: number;
  buyerToken: string;
}) {
  const { lang } = useSiteSettings();
  const isFrench = lang === "fr";
  const [status, setStatus] = useState<CoursePaymentStatus | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/delivery/conversations/${conversationId}/course-payment-status`, {
        headers: { "x-buyer-token": buyerToken },
      });
      if (!response.ok) return;
      setStatus(await response.json() as CoursePaymentStatus);
    } catch {
      // réseau instable : on réessaiera au prochain passage
    }
  }, [conversationId, buyerToken]);

  useEffect(() => {
    void loadStatus();
    const timer = setInterval(() => { void loadStatus(); }, POLL_INTERVAL_MS);
    // Au retour de la page FedaPay, on revérifie tout de suite
    const onVisible = () => { if (document.visibilityState === "visible") void loadStatus(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadStatus]);

  const pay = async () => {
    if (!status?.orderId || paying) return;
    setPaying(true);
    setError(null);
    // Fenêtre ouverte tout de suite (clic de l'utilisateur) pour ne pas être bloquée par le navigateur
    const popup = window.open("", "_blank");
    try {
      const response = await fetch(`/api/delivery/orders/${status.orderId}/course-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-buyer-token": buyerToken },
        body: JSON.stringify({ conversationId }),
      });
      const data = await response.json().catch(() => null) as { paymentUrl?: string; error?: string } | null;
      if (!response.ok || !data?.paymentUrl) {
        throw new Error(data?.error ?? (isFrench ? "Paiement impossible pour le moment." : "Payment unavailable right now."));
      }
      if (popup) popup.location.href = data.paymentUrl;
      else window.location.assign(data.paymentUrl);
    } catch (err) {
      popup?.close();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPaying(false);
    }
  };

  if (!status?.orderId) return null;

  if (status.paid) {
    return (
      <div className="mx-3 my-2 flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800" role="status">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {isFrench
            ? "Course payée. Le livreur est autorisé à partir et sa position sera partagée."
            : "Delivery paid. The driver is cleared to leave and will share their location."}
        </span>
      </div>
    );
  }

  if (!status.driverAccepted || !status.breakdown) return null;

  const { breakdown } = status;
  const deadline = status.paymentDeadlineAt
    ? new Date(status.paymentDeadlineAt).toLocaleTimeString(isFrench ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="mx-3 my-2 space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
      <p className="font-semibold">
        {isFrench ? "Le livreur a accepté. Payez la course pour qu'il parte." : "The driver accepted. Pay the delivery so they can leave."}
      </p>
      <dl className="space-y-0.5 text-muted-foreground">
        <div className="flex justify-between"><dt>{isFrench ? "Prix de la commande" : "Order price"}</dt><dd>{formatFcfa(breakdown.articlePrice, isFrench)}</dd></div>
        <div className="flex justify-between"><dt>{isFrench ? "Course du livreur" : "Driver fee"}</dt><dd>{formatFcfa(breakdown.driverFee, isFrench)}</dd></div>
        <div className="flex justify-between"><dt>{isFrench ? "Commission TogoMarket" : "TogoMarket commission"}</dt><dd>{formatFcfa(breakdown.buyerCommission, isFrench)}</dd></div>
        <div className="flex justify-between border-t pt-1 font-semibold text-foreground"><dt>Total</dt><dd>{formatFcfa(breakdown.total, isFrench)}</dd></div>
      </dl>
      <p className="text-xs text-muted-foreground">
        {isFrench ? "Les frais de la passerelle FedaPay peuvent s'ajouter lors du paiement." : "FedaPay gateway fees may be added at checkout."}
        {deadline && ` ${isFrench ? `Paiement attendu avant ${deadline}, sinon la course sera annulée.` : `Payment expected before ${deadline}, otherwise the delivery is cancelled.`}`}
      </p>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <Button type="button" className="w-full gap-2" onClick={pay} disabled={paying}>
        {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
        {isFrench ? `Payer la course · ${formatFcfa(breakdown.total, isFrench)}` : `Pay delivery · ${formatFcfa(breakdown.total, isFrench)}`}
      </Button>
    </div>
  );
}
