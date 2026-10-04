import { useEffect, useState } from "react";
import { ExternalLink, Lock, MapPin, Phone, Repeat2 } from "lucide-react";

type Contact = {
  latitude: number;
  longitude: number;
  mapsUrl: string;
  contactName: string | null;
  contactPhone: string | null;
};

type TransferInfo =
  | { direction: "incoming"; fromDriverName: string }
  | { direction: "outgoing"; toDriverName: string; expiresAt: string | null }
  | { direction: "completed"; toDriverName: string };

type AssignmentDetails = {
  transfer?: TransferInfo | null;
  pricingState?: "ready" | "waiting_positions" | "error";
  orderId: number;
  description: string;
  articlePriceFcfa: number;
  distanceKm: number | null;
  driverFeeFcfa: number | null;
  roundTripFeeFcfa: number | null;
  positionsShared: { seller: boolean; buyer: boolean };
  paid: boolean;
  revealed: boolean;
  /** Livraison ou retour déjà validé par QR : aucune coordonnée n'est transmise. */
  finished?: boolean;
  positionsExpired?: boolean;
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
  finished = false,
  onReadyChange,
}: {
  token: string;
  deliveryJobId: number;
  isFrench: boolean;
  fallbackOrder?: FallbackOrder;
  /** Course terminée (QR validé) : les positions et les contacts ne sont plus affichés. */
  finished?: boolean;
  /** true quand la distance ET la rémunération sont connues : le livreur peut décider en connaissance de cause. */
  onReadyChange?: (ready: boolean) => void;
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
  const ready = distanceKm != null && driverFee != null && roundTripFee != null;
  // Gain du trajet retour = aller-retour moins aller (la moitié de l'aller pour les nouvelles commandes)
  const returnLegFee = roundTripFee != null && driverFee != null ? Math.max(0, roundTripFee - driverFee) : null;
  const returnIsHalf = returnLegFee != null && driverFee != null && returnLegFee * 2 === driverFee;

  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready, onReadyChange]);
  const missing = details
    ? [
        !details.positionsShared.seller ? (isFrench ? "du vendeur" : "seller") : null,
        !details.positionsShared.buyer ? (isFrench ? "de l'acheteur" : "buyer") : null,
      ].filter(Boolean)
    : [];

  const transferNotice = (() => {
    const transfer = details?.transfer;
    if (!transfer) return null;
    if (transfer.direction === "incoming") {
      return isFrench
        ? `Course transférée par ${transfer.fromDriverName || "un collègue"} : toute la commande vous est proposée. Acceptez-la ou refusez-la.`
        : `Delivery handed over by ${transfer.fromDriverName || "a colleague"}: the whole order is offered to you. Accept or decline it.`;
    }
    if (transfer.direction === "outgoing") {
      return isFrench
        ? `Transfert en attente de ${transfer.toDriverName}. La course reste à vous tant qu'il n'a pas accepté.`
        : `Transfer pending with ${transfer.toDriverName}. The delivery stays yours until they accept.`;
    }
    return isFrench
      ? `Course transférée à ${transfer.toDriverName}. Vous n'avez plus de droit sur cette livraison.`
      : `Delivery transferred to ${transfer.toDriverName}. You no longer have any right on it.`;
  })();

  return (
    <div className="space-y-3 text-sm">
      {transferNotice && (
        <p className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground" role="status">
          <Repeat2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {transferNotice}
        </p>
      )}
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
          <span className="font-medium text-foreground">{fcfa(returnLegFee, isFrench)}</span>
          {returnIsHalf && (
            <span className="text-xs"> {isFrench ? "(la moitié de l'aller)" : "(half of the outbound fee)"}</span>
          )}
        </p>
      </div>

      {details && !ready && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
          {details.pricingState === "waiting_positions" && missing.length > 0
            ? (isFrench
              ? `La distance sera calculée dès que la position ${missing.join(" et ")} sera partagée.`
              : `The distance will be computed once the ${missing.join(" and ")} location is shared.`)
            : (isFrench
              ? "Calcul de la distance et de votre rémunération en cours… Cette page se met à jour automatiquement."
              : "Computing the distance and your pay… This page updates automatically.")}
          {" "}
          {isFrench
            ? "Vous pourrez accepter dès que ces montants s'affichent."
            : "You can accept as soon as these amounts appear."}
        </p>
      )}

      {details?.revealed && details.positionsExpired && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
          {isFrench
            ? "Certaines positions ont été effacées automatiquement après 24 h. Demandez à l'acheteur ou au vendeur de repartager leur position dans la conversation."
            : "Some locations were automatically erased after 24 h. Ask the buyer or seller to share their location again in the conversation."}
        </p>
      )}

      {(finished || details?.finished) ? null : details?.revealed ? (
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
