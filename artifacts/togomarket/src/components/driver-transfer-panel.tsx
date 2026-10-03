import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Repeat2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";

type Candidate = {
  driverId: number;
  firstName: string;
  photoUrl: string | null;
  workZone: string | null;
  distanceKm: number;
};

type TransferOverview = {
  orderId: number;
  sellerPositionKnown: boolean;
  radiusKm: number;
  candidates: Candidate[];
  pendingOffer: { jobId: number; driverId: number; firstName: string; expiresAt: string | null } | null;
};

const REFRESH_MS = 10_000;

function api(token: string, path: string, init?: RequestInit) {
  return fetch(`/api/driver-connexion/assignments/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...(init?.headers ?? {}) },
  });
}

/**
 * Panneau « Passer indisponible » d'un livreur qui a déjà une course acceptée :
 *  - liste des collègues disponibles près de la position du vendeur, avec « Transférer la commande » ;
 *  - « Reprendre la commande » : annule l'offre et garde la course ;
 *  - « Refuser la commande » : abandonne la course (l'acheteur et le vendeur en sont informés).
 */
export function DriverTransferPanel({
  token,
  deliveryJobId,
  orderId,
  isFrench,
  onClose,
  onChanged,
}: {
  token: string;
  deliveryJobId: number;
  orderId: number | null;
  isFrench: boolean;
  onClose: () => void;
  /** Appelé quand la course a changé de mains ou a été abandonnée : la page recharge la session. */
  onChanged: (message: string) => void;
}) {
  const [overview, setOverview] = useState<TransferOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | "cancel" | "abandon" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api(token, `${deliveryJobId}/transfer-candidates`);
      const data = await response.json().catch(() => null) as (TransferOverview & { error?: string }) | null;
      if (!response.ok) {
        // La course n'est plus en cours pour ce livreur (transférée, terminée…) : on referme et on recharge
        if (response.status === 409 || response.status === 404) {
          onChanged(isFrench
            ? "Cette course n'est plus à vous (transférée à un collègue ou terminée)."
            : "This delivery is no longer yours (handed to a colleague or finished).");
        }
        else setError(data?.error ?? (isFrench ? "Liste des collègues indisponible." : "Colleague list unavailable."));
        return;
      }
      setOverview(data);
      setError(null);
    } catch {
      setError(isFrench ? "Connexion impossible. Réessayez." : "Connection failed. Try again.");
    } finally {
      setLoading(false);
    }
  }, [token, deliveryJobId, isFrench, onChanged]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const transfer = async (candidate: Candidate) => {
    setBusy(candidate.driverId);
    setError(null);
    try {
      const response = await api(token, `${deliveryJobId}/transfer`, {
        method: "POST",
        body: JSON.stringify({ toDriverId: candidate.driverId }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? (isFrench ? "Transfert impossible." : "Transfer failed."));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await load();
    } finally {
      setBusy(null);
    }
  };

  const resume = async () => {
    setBusy("cancel");
    setError(null);
    try {
      const response = await api(token, `${deliveryJobId}/transfer/cancel`, { method: "POST" });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? (isFrench ? "Impossible de reprendre la commande." : "Could not resume the delivery."));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const abandon = async () => {
    setBusy("abandon");
    setError(null);
    try {
      const response = await api(token, `${deliveryJobId}/abandon`, { method: "POST" });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? (isFrench ? "Impossible de refuser la commande." : "Could not decline the delivery."));
      onChanged(isFrench ? "Commande refusée. L'acheteur et le vendeur ont été prévenus." : "Delivery declined. The buyer and seller have been notified.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfirmAbandon(false);
    } finally {
      setBusy(null);
    }
  };

  const expiresAtLabel = overview?.pendingOffer?.expiresAt
    ? new Date(overview.pendingOffer.expiresAt).toLocaleTimeString(isFrench ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm" role="region" aria-label={isFrench ? "Transférer la commande" : "Transfer the delivery"}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-amber-950">
            {isFrench ? `Course en cours${orderId ? ` · commande #${orderId}` : ""}` : `Delivery in progress${orderId ? ` · order #${orderId}` : ""}`}
          </p>
          <p className="text-xs text-amber-900">
            {isFrench
              ? "Vous êtes trop loin du vendeur ? Transférez toute la commande à un collègue disponible près de lui."
              : "Too far from the seller? Hand the whole delivery to an available colleague close to the seller."}
          </p>
        </div>
        <button type="button" onClick={() => { void load(); }} className="shrink-0 rounded-md p-1 text-amber-900 hover:bg-amber-100" aria-label={isFrench ? "Actualiser la liste" : "Refresh the list"}>
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {loading && <p className="flex items-center gap-2 text-xs text-amber-900"><Loader2 className="h-4 w-4 animate-spin" />{isFrench ? "Recherche des collègues proches du vendeur…" : "Looking for colleagues near the seller…"}</p>}

      {overview?.pendingOffer && (
        <p className="rounded-lg border border-amber-300 bg-background px-3 py-2 text-xs text-foreground" role="status">
          {isFrench
            ? `Transfert envoyé à ${overview.pendingOffer.firstName}${expiresAtLabel ? ` (réponse attendue avant ${expiresAtLabel})` : ""}. La course reste à vous tant qu'il n'a pas accepté.`
            : `Transfer sent to ${overview.pendingOffer.firstName}${expiresAtLabel ? ` (answer expected before ${expiresAtLabel})` : ""}. The delivery stays yours until they accept.`}
        </p>
      )}

      {overview && !overview.pendingOffer && !overview.sellerPositionKnown && (
        <p className="text-xs text-amber-900">
          {isFrench
            ? "La position du vendeur n'est plus disponible : le transfert est impossible. Vous pouvez reprendre ou refuser la commande."
            : "The seller's location is no longer available: transfer is not possible. You can resume or decline the delivery."}
        </p>
      )}

      {overview && !overview.pendingOffer && overview.sellerPositionKnown && (
        overview.candidates.length === 0 ? (
          <p className="text-xs text-amber-900">
            {isFrench
              ? `Aucun livreur disponible dans un rayon de ${overview.radiusKm} km autour du vendeur pour le moment. Actualisez, reprenez la commande ou refusez-la.`
              : `No driver is available within ${overview.radiusKm} km of the seller right now. Refresh, resume the delivery or decline it.`}
          </p>
        ) : (
          <ul className="space-y-2">
            {overview.candidates.map((candidate) => (
              <li key={candidate.driverId} className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2">
                {candidate.photoUrl
                  ? <img src={candidate.photoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                  : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted"><UserRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" /></span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{candidate.firstName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {candidate.distanceKm} km {isFrench ? "du vendeur" : "from the seller"}
                    {candidate.workZone ? ` · ${candidate.workZone}` : ""}
                  </p>
                </div>
                <Button type="button" size="sm" className="shrink-0 gap-1.5" onClick={() => { void transfer(candidate); }} disabled={busy !== null}>
                  {busy === candidate.driverId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Repeat2 className="h-4 w-4" />}
                  {isFrench ? "Transférer la commande" : "Transfer the delivery"}
                </Button>
              </li>
            ))}
          </ul>
        )
      )}

      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={() => { void resume(); }} disabled={busy !== null}>
          {busy === "cancel" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isFrench ? "Reprendre la commande" : "Resume the delivery"}
        </Button>
        {confirmAbandon ? (
          <>
            <Button type="button" variant="destructive" size="sm" onClick={() => { void abandon(); }} disabled={busy !== null}>
              {busy === "abandon" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isFrench ? "Oui, refuser la commande" : "Yes, decline the delivery"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmAbandon(false)} disabled={busy !== null}>
              {isFrench ? "Annuler" : "Cancel"}
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" size="sm" className="border-destructive/40 text-destructive" onClick={() => setConfirmAbandon(true)} disabled={busy !== null}>
            {isFrench ? "Refuser la commande" : "Decline the delivery"}
          </Button>
        )}
      </div>
      {confirmAbandon && (
        <p className="text-xs text-destructive">
          {isFrench
            ? "Vous ne serez pas rémunéré pour cette course. L'acheteur et le vendeur devront choisir un nouveau livreur."
            : "You will not be paid for this delivery. The buyer and seller will have to pick a new driver."}
        </p>
      )}
    </div>
  );
}
