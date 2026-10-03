import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, UserCheck, X } from "lucide-react";
import { useSiteSettings } from "@/lib/site-settings";

export const DRIVER_CHANGED_EVENT = "tm-delivery-driver-changed";

type Notice =
  | { kind: "driver_unavailable"; message: string; at: string }
  | { kind: "driver_changed"; message: string; driverName: string; at: string }
  | null;

const POLL_MS = 15_000;

/**
 * Avis à l'acheteur et au vendeur quand le livreur change :
 *  - « Assigner nouveau livreur : livreur indisponible » (le livreur a refusé la course) ;
 *  - « Nouveau livreur : X » (un collègue a repris la course ; les informations du livreur se mettent à jour d'elles-mêmes).
 */
export function DriverChangeNotice({
  conversationId,
  headers,
}: {
  conversationId: number;
  headers: Record<string, string>;
}) {
  const { lang } = useSiteSettings();
  const isFrench = lang === "fr";
  const [notice, setNotice] = useState<Notice>(null);
  const [dismissedAt, setDismissedAt] = useState<string | null>(() => {
    try { return sessionStorage.getItem(`tm_driver_notice_${conversationId}`); } catch { return null; }
  });
  // headers est reconstruit à chaque rendu par l'appelant : on en garde une version sérialisée stable
  const headersKey = JSON.stringify(headers);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/delivery/conversations/${conversationId}/driver-notice`, {
        headers: JSON.parse(headersKey) as Record<string, string>,
      });
      if (!response.ok) return;
      const data = await response.json() as { notice: Notice };
      setNotice(data.notice);
    } catch {
      // réseau instable : on réessaiera
    }
  }, [conversationId, headersKey]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, POLL_MS);
    const onChanged = () => { void load(); };
    window.addEventListener(DRIVER_CHANGED_EVENT, onChanged);
    return () => {
      clearInterval(timer);
      window.removeEventListener(DRIVER_CHANGED_EVENT, onChanged);
    };
  }, [load]);

  if (!notice || dismissedAt === notice.at) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(`tm_driver_notice_${conversationId}`, notice.at); } catch { /* stockage indisponible */ }
    setDismissedAt(notice.at);
  };

  if (notice.kind === "driver_unavailable") {
    return (
      <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="alert" data-testid="driver-unavailable-notice">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{isFrench ? notice.message : "Assign a new driver: driver unavailable"}</p>
          <p className="text-xs">
            {isFrench
              ? "Le livreur ne peut plus assurer la course. Choisissez un nouveau livreur avec « Assigner livreur » : la course déjà payée reste valable."
              : "The driver can no longer make the delivery. Pick a new driver with \"Assign driver\": the delivery fee already paid remains valid."}
          </p>
        </div>
        <button type="button" onClick={dismiss} className="shrink-0 rounded-md p-1 hover:bg-amber-100" aria-label={isFrench ? "Fermer" : "Close"}><X className="h-4 w-4" /></button>
      </div>
    );
  }

  return (
    <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900" role="status" data-testid="driver-changed-notice">
      <UserCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{isFrench ? notice.message : `New driver: ${notice.driverName}`}</p>
        <p className="text-xs">
          {isFrench
            ? "Un collègue a repris la livraison. Les informations du livreur sont mises à jour automatiquement ; rien à refaire de votre côté."
            : "A colleague took over the delivery. The driver's details are updated automatically; nothing to redo on your side."}
        </p>
      </div>
      <button type="button" onClick={dismiss} className="shrink-0 rounded-md p-1 hover:bg-green-100" aria-label={isFrench ? "Fermer" : "Close"}><X className="h-4 w-4" /></button>
    </div>
  );
}
