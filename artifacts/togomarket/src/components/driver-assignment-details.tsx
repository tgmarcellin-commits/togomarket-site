import { useEffect, useState } from "react";
import { ExternalLink, Lock, MapPin, Phone } from "lucide-react";

type Contact = {
  latitude: number;
  longitude: number;
  mapsUrl: string;
  contactName: string | null;
  contactPhone: string | null;
};

type AssignmentDetails = {
  orderId: number;
  description: string;
  articlePriceFcfa: number;
  distanceKm: number | null;
  driverFeeFcfa: number | null;
  roundTripFeeFcfa: number | null;
  positionsShared: { seller: boolean; buyer: boolean };
  paid: boolean;
  revealed: boolean;
  pickup: Contact | null;
  dropoff: Contact | null;
};

type FallbackOrder = {
  distanceLockedKm?: number | null;
  transportFeeLocked?: number | null;
  roundTripFeeLocked?: number | null;
} | null | undefined;

const REFRESH_MS = 20_000;

function fcfa(value: number | null | undefined, isFrench: boolean): string {
  if (value == null) return "—";
  return `${new Intl.NumberFormat(isFrench ? "fr-FR" : "en-US").format(value)} FCFA`;
}

function ContactBlock({ title, contact, isFrench }: { title: string; contact: Contact; isFrench: boolean }) {
  return (
    <div className="space-y-1 rounded-lg border bg-background px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
        {title}
      </p>
      {contact.contactName && <p className="text-sm font-medium text-foreground">{contact.contactName}</p>}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {contact.contactPhone && (
          <a href={`tel:+${contact.contactPhone.replace(/\D/g, "")}`} className="inline-flex items-center gap-1 text-primary underline underline-offset-2">
            <Phone className="h-3.5 w-3.5" aria-hidden="true" />
            {contact.contactPhone}
          </a>
        )}
        <a href={contact.mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-2">
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          {isFrench ? "Ouvrir l'itinéraire" : "Open directions"}
        </a>
      </div>
    </div>
  );
}

/**
 * Détails de la course dans la carte d'assignation du livreur :
 * prix, distance, rémunération toujours visibles ; positions exactes et contacts
 * seulement une fois la course acceptée ET payée.
 */
export function DriverAssignmentDetails({
  token,
  deliveryJobId,
  isFrench,
  fallbackOrder,
}: {
  token: string;
  deliveryJobId: number;
  isFrench: boolean;
  fallbackOrder?: FallbackOrder;
}) {
  const [details, setDetails] = useState<AssignmentDetails | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/driver-connexion/assignments/${deliveryJobId}/details`, {
          headers: { Authorization: "Bearer " + token },
        });
        if (!response.ok) return;
        const data = await response.json() as AssignmentDetails;
        if (!cancelled) setDetails(data);
      } catch {
        // réseau instable : on garde les dernières valeurs
      }
    };
    void load();
    const timer = setInterval(() => { void load(); }, REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [token, deliveryJobId]);

  const distanceKm = details?.distanceKm ?? fallbackOrder?.distanceLockedKm ?? null;
  const driverFee = details?.driverFeeFcfa ?? fallbackOrder?.transportFeeLocked ?? null;
  const roundTripFee = details?.roundTripFeeFcfa ?? fallbackOrder?.roundTripFeeLocked ?? null;
  const missing = details
    ? [
        !details.positionsShared.seller ? (isFrench ? "du vendeur" : "seller") : null,
        !details.positionsShared.buyer ? (isFrench ? "de l'acheteur" : "buyer") : null,
      ].filter(Boolean)
    : [];

  return (
    <div className="space-y-3 text-sm">
      {details?.description && (
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-foreground">
          <span className="text-xs text-muted-foreground">{isFrench ? "Article : " : "Item: "}</span>
          {details.description}
        </p>
      )}

      <div className="grid gap-2 text-muted-foreground md:grid-cols-2">
        <p>
          {isFrench ? "Prix de la commande" : "Order price"} :{" "}
          <span className="font-medium text-foreground">{details ? fcfa(details.articlePriceFcfa, isFrench) : "—"}</span>
        </p>
        <p>
          {isFrench ? "Distance vendeur → acheteur" : "Seller → buyer distance"} :{" "}
          <span className="font-medium text-foreground">{distanceKm != null ? `${distanceKm} km` : "—"}</span>
        </p>
        <p>
          {isFrench ? "Votre rémunération (aller)" : "Your pay (outbound)"} :{" "}
          <span className="font-medium text-foreground">{fcfa(driverFee, isFrench)}</span>
        </p>
        <p>
          {isFrench ? "Frais retour possibles" : "Possible return fee"} :{" "}
          <span className="font-medium text-foreground">{fcfa(roundTripFee, isFrench)}</span>
        </p>
      </div>

      {details && missing.length > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
          {isFrench
            ? `La distance sera calculée dès que la position ${missing.join(" et ")} sera partagée.`
            : `The distance will be computed once the ${missing.join(" and ")} location is shared.`}
        </p>
      )}

      {details?.revealed ? (
        <div className="grid gap-2 md:grid-cols-2">
          {details.pickup && <ContactBlock title={isFrench ? "Retrait chez le vendeur" : "Pickup at seller"} contact={details.pickup} isFrench={isFrench} />}
          {details.dropoff && <ContactBlock title={isFrench ? "Livraison chez l'acheteur" : "Delivery to buyer"} contact={details.dropoff} isFrench={isFrench} />}
        </div>
      ) : (
        details && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {isFrench
              ? "Les positions exactes et les contacts du vendeur et de l'acheteur vous sont transmis une fois la course acceptée et payée."
              : "Exact locations and contacts of the seller and buyer are sent once the delivery is accepted and paid."}
          </p>
        )
      )}
    </div>
  );
}
