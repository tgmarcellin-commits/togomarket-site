import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MapPin, Navigation, ExternalLink } from "lucide-react";

type PointDetail = { latitude: number; longitude: number; mapsUrl: string };
type PositionDetails =
  | { available: false; reason: "no_order" | "not_paid" | "finished" | "no_driver"; orderStatus?: string }
  | {
    available: true;
    orderStatus: string;
    phase: "to-seller" | "to-buyer" | "returning";
    seller: PointDetail | null;
    buyer: PointDetail | null;
    driver: (PointDetail & { heading: number | null; recordedAt: string }) | null;
    routeUrl: string | null;
  };

const REFRESH_MS = 10_000;
const STALE_MS = 60_000;

const PHASE_LABELS = {
  fr: {
    "to-seller": "Le livreur se rend chez le vendeur, puis chez l'acheteur.",
    "to-buyer": "Le livreur a la commande et se rend chez l'acheteur.",
    returning: "Retour de la commande vers le vendeur.",
  },
  en: {
    "to-seller": "The driver is heading to the seller, then to the buyer.",
    "to-buyer": "The driver has the order and is heading to the buyer.",
    returning: "The order is on its way back to the seller.",
  },
} as const;

const UNAVAILABLE = {
  fr: {
    not_paid: "Les positions s'afficheront dès que l'acheteur aura payé la commande et la course.",
    no_driver: "Les positions s'afficheront dès que le livreur aura accepté la course.",
    no_order: "Aucune livraison en cours pour cette conversation.",
    finished: "La course est terminée : le partage de position est arrêté.",
  },
  en: {
    not_paid: "Positions will appear once the buyer has paid for the order and the delivery.",
    no_driver: "Positions will appear once the driver has accepted the delivery.",
    no_order: "There is no delivery in progress for this conversation.",
    finished: "The delivery is over: location sharing has stopped.",
  },
} as const;

/** Bouton « Voir détail de position » de la conversation (acheteur et vendeur). */
export function PositionDetailsButton({
  conversationId,
  headers,
  language,
  orderStatus,
}: {
  conversationId: number;
  headers: Record<string, string>;
  language: "fr" | "en";
  /** Statut de la commande déjà connu par le chat : le bouton disparaît quand la course est terminée. */
  orderStatus: string;
}) {
  const fr = language === "fr";
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<PositionDetails | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/delivery/conversations/${conversationId}/position-details`, {
        headers,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("http");
      setDetails(await response.json() as PositionDetails);
      setError("");
    } catch {
      setError(fr ? "Impossible de charger les positions. Vérifiez votre connexion." : "Could not load positions. Check your connection.");
    }
  }, [conversationId, headers, fr]);

  // Rafraîchit toutes les 10 s tant que la fenêtre est ouverte
  useEffect(() => {
    if (!open) return;
    void load();
    const timer = window.setInterval(() => { void load(); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [open, load]);

  // Course terminée : on ferme et on masque tout, sans garder de coordonnées en mémoire
  const finished = ["DELIVERED", "RETURN_CONFIRMED", "CANCELLED"].includes(orderStatus.toUpperCase());
  useEffect(() => {
    if (finished) { setOpen(false); setDetails(null); }
  }, [finished]);
  if (finished) return null;

  const driverStale = details?.available && details.driver
    ? Date.now() - new Date(details.driver.recordedAt).getTime() > STALE_MS
    : false;

  const row = (label: string, color: string, point: PointDetail | null, extra?: string) => (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold"><i className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${color}`} />{label}</p>
        <p className="text-xs text-muted-foreground">
          {point ? (extra ?? (fr ? "Position partagée" : "Location shared")) : (fr ? "Position non disponible" : "Location unavailable")}
        </p>
      </div>
      {point && (
        <Button asChild size="sm" variant="outline">
          <a href={point.mapsUrl} target="_blank" rel="noopener noreferrer">
            <MapPin className="mr-1 h-4 w-4" />{fr ? "Voir" : "View"}
          </a>
        </Button>
      )}
    </div>
  );

  return (
    <>
      <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => setOpen(true)} data-testid="button-position-details">
        <MapPin className="mr-2 h-4 w-4" />
        {fr ? "Voir détail de position" : "View position details"}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{fr ? "Détail de position" : "Position details"}</SheetTitle>
            <SheetDescription>
              {details?.available ? PHASE_LABELS[language][details.phase] : (fr ? "Suivi du trajet en direct." : "Live trip tracking.")}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            {!details && !error && <p className="text-sm text-muted-foreground">{fr ? "Chargement…" : "Loading…"}</p>}
            {details && !details.available && (
              <p className="text-sm text-muted-foreground" role="status">{UNAVAILABLE[language][details.reason]}</p>
            )}
            {details?.available && (
              <>
                {row(fr ? "Livreur" : "Driver", "bg-blue-600", details.driver,
                  details.driver
                    ? `${fr ? "Mis à jour à" : "Updated at"} ${new Date(details.driver.recordedAt).toLocaleTimeString(fr ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit" })}${driverStale ? (fr ? " — signal ancien" : " — stale signal") : ""}`
                    : undefined)}
                {row(fr ? "Vendeur" : "Seller", "bg-green-600", details.seller)}
                {row(fr ? "Acheteur" : "Buyer", "bg-purple-600", details.buyer)}
                {details.routeUrl && (
                  <Button asChild className="w-full">
                    <a href={details.routeUrl} target="_blank" rel="noopener noreferrer">
                      <Navigation className="mr-2 h-4 w-4" />
                      {fr ? "Suivre le trajet sur Google Maps" : "Follow the trip on Google Maps"}
                      <ExternalLink className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  {fr
                    ? "Les positions sont mises à jour toutes les 10 secondes et disparaissent à la fin de la course."
                    : "Positions refresh every 10 seconds and disappear when the delivery ends."}
                </p>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
