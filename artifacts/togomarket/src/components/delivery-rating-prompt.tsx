import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSiteSettings } from "@/lib/site-settings";

/** Déclenché après un scan réussi pour afficher la demande de note sans attendre le prochain rafraîchissement. */
export const DELIVERY_SETTLED_EVENT = "tm-delivery-settled";

type RatingStatus = { orderId: number | null; delivered: boolean; rated: boolean; stars?: number | null };

const POLL_INTERVAL_MS = 12_000;
const dismissKey = (orderId: number) => `tm_rating_dismissed_${orderId}`;

/**
 * Invite l'ACHETEUR à noter le livreur (1 à 5 étoiles + commentaire facultatif)
 * une fois la livraison confirmée par le scan du QR.
 */
export function DeliveryRatingPrompt({
  conversationId,
  buyerToken,
}: {
  conversationId: number;
  buyerToken: string;
}) {
  const { lang } = useSiteSettings();
  const isFrench = lang === "fr";
  const [status, setStatus] = useState<RatingStatus | null>(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/delivery/conversations/${conversationId}/rating-status`, {
        headers: { "x-buyer-token": buyerToken },
      });
      if (!response.ok) return;
      const data = await response.json() as RatingStatus;
      setStatus(data);
      if (data.orderId) {
        try { setDismissed(sessionStorage.getItem(dismissKey(data.orderId)) === "1"); } catch { /* stockage indisponible */ }
      }
    } catch {
      // réseau instable : on réessaiera
    }
  }, [conversationId, buyerToken]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, POLL_INTERVAL_MS);
    const onSettled = () => { void load(); };
    window.addEventListener(DELIVERY_SETTLED_EVENT, onSettled);
    return () => {
      clearInterval(timer);
      window.removeEventListener(DELIVERY_SETTLED_EVENT, onSettled);
    };
  }, [load]);

  const submit = async () => {
    if (!status?.orderId || stars < 1 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/delivery/orders/${status.orderId}/rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-buyer-token": buyerToken },
        body: JSON.stringify({ conversationId, stars, comment: comment.trim() }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(data?.error ?? (isFrench ? "Envoi de la note impossible." : "Could not send your rating."));
      }
      setThanks(true);
      setStatus({ ...status, rated: true, stars });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const later = () => {
    if (status?.orderId) {
      try { sessionStorage.setItem(dismissKey(status.orderId), "1"); } catch { /* stockage indisponible */ }
    }
    setDismissed(true);
  };

  if (thanks) {
    return (
      <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800" role="status">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{isFrench ? "Merci pour votre note, elle aide les autres acheteurs." : "Thank you for your rating, it helps other buyers."}</span>
      </div>
    );
  }

  if (!status?.orderId || !status.delivered || status.rated || dismissed) return null;

  return (
    <div className="mx-4 mt-3 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm" role="group" aria-label={isFrench ? "Noter le livreur" : "Rate the driver"}>
      <p className="font-semibold text-amber-950">
        {isFrench ? "Livraison confirmée. Comment était votre livreur ?" : "Delivery confirmed. How was your driver?"}
      </p>
      <div className="flex items-center gap-1" role="radiogroup" aria-label={isFrench ? "Note sur 5" : "Rating out of 5"}>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={stars === value}
            aria-label={isFrench ? `${value} étoile${value > 1 ? "s" : ""}` : `${value} star${value > 1 ? "s" : ""}`}
            onClick={() => setStars(value)}
            className="rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <Star className={`h-8 w-8 ${value <= stars ? "fill-amber-400 text-amber-500" : "text-amber-300"}`} />
          </button>
        ))}
      </div>
      <Input
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        maxLength={500}
        placeholder={isFrench ? "Un commentaire (facultatif)" : "A comment (optional)"}
        className="h-9 bg-background"
      />
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" onClick={() => { void submit(); }} disabled={stars < 1 || busy} className="gap-2">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {isFrench ? "Envoyer ma note" : "Send my rating"}
        </Button>
        <button type="button" onClick={later} disabled={busy} className="text-xs text-muted-foreground underline underline-offset-2 hover:no-underline">
          {isFrench ? "Plus tard" : "Later"}
        </button>
      </div>
    </div>
  );
}
