import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PARTY_LOCATION_UPDATED_EVENT,
  capturePosition,
  fetchPartyLocationStatus,
  locationErrorMessage,
  sharePartyLocation,
  type PartyLocationStatus,
} from "@/lib/party-location";

/**
 * Bandeau « position » du panneau Prix + livreur.
 * - ma position manquante : bouton « Partager ma position » (avec consignes si la localisation est coupée) ;
 * - ma position partagée mais pas celle de l'autre : message d'attente ;
 * - les deux partagées : confirmation discrète.
 */
export function PartyLocationPrompt({
  conversationId,
  role,
  lang,
  getHeaders,
}: {
  conversationId: number;
  role: "buyer" | "seller";
  lang: "fr" | "en";
  getHeaders: () => Record<string, string>;
}) {
  const isFrench = lang === "fr";
  const [status, setStatus] = useState<PartyLocationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headersRef = useRef(getHeaders);
  headersRef.current = getHeaders;

  const refresh = useCallback(async () => {
    setStatus(await fetchPartyLocationStatus(conversationId, headersRef.current()));
  }, [conversationId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 20_000);
    const onUpdated = () => { void refresh(); };
    window.addEventListener(PARTY_LOCATION_UPDATED_EVENT, onUpdated);
    return () => {
      clearInterval(timer);
      window.removeEventListener(PARTY_LOCATION_UPDATED_EVENT, onUpdated);
    };
  }, [refresh]);

  const share = async () => {
    setBusy(true);
    setError(null);
    try {
      const position = await capturePosition();
      if (!position.ok) {
        setError(locationErrorMessage(position.reason, lang));
        return;
      }
      const result = await sharePartyLocation(conversationId, headersRef.current(), position);
      if (!result.ok) setError(result.error);
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  const otherShared = role === "buyer" ? status.seller : status.buyer;
  const otherLabel = role === "buyer" ? (isFrench ? "du vendeur" : "the seller's") : (isFrench ? "de l'acheteur" : "the buyer's");

  if (!status.mine) {
    return (
      <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
        <p className="flex items-start gap-1.5 font-semibold">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {isFrench ? "Partagez votre position" : "Share your location"}
        </p>
        <p>
          {isFrench
            ? "Elle est indispensable pour calculer la course et indiquer au livreur où aller. Activez la localisation de votre téléphone."
            : "It is required to compute the delivery and tell the driver where to go. Turn on your phone's location."}
        </p>
        {error && <p className="text-destructive" role="alert">{error}</p>}
        <Button type="button" size="sm" className="h-8 gap-1.5 text-[11px]" onClick={() => { void share(); }} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
          {isFrench ? "Partager ma position" : "Share my location"}
        </Button>
      </div>
    );
  }

  if (!otherShared) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground" role="status">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {isFrench
          ? `Votre position est partagée. En attente de la position ${otherLabel}.`
          : `Your location is shared. Waiting for ${otherLabel} location.`}
      </p>
    );
  }

  return (
    <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-600" role="status">
      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
      {isFrench ? "Positions de l'acheteur et du vendeur partagées" : "Buyer and seller locations shared"}
    </p>
  );
}
