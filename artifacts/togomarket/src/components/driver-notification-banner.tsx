import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, X } from "lucide-react";
import { useSiteSettings } from "@/lib/site-settings";

type DriverNotification = {
  id: number;
  orderId: number | null;
  kind: string;
  title: string;
  body: string;
  createdAt: string;
};

const POLL_INTERVAL_MS = 15_000;

/** Traductions des notifications connues ; sinon le texte du serveur (français) est affiché tel quel. */
function localize(notification: DriverNotification, isFrench: boolean): { title: string; body: string } {
  if (!isFrench && notification.kind === "course_payment_confirmed") {
    return {
      title: "Delivery paid: you can leave",
      body: `Payment for delivery #${notification.orderId ?? ""} is confirmed. Head to the seller: order details are on this page.`,
    };
  }
  return { title: notification.title, body: notification.body };
}

/**
 * Notifications du tableau de bord du livreur connecté (secours du message WhatsApp).
 * Vérifie le serveur toutes les 15 s et au retour sur l'onglet.
 */
export function DriverNotificationBanner({ token }: { token: string }) {
  const { lang } = useSiteSettings();
  const isFrench = lang === "fr";
  const [notifications, setNotifications] = useState<DriverNotification[]>([]);
  const knownIdsRef = useRef<Set<number> | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/driver-connexion/notifications", {
        headers: { Authorization: "Bearer " + token },
      });
      if (!response.ok) return;
      const data = await response.json() as { notifications?: DriverNotification[] };
      const list = Array.isArray(data.notifications) ? data.notifications : [];
      // Vibration légère à l'arrivée d'une NOUVELLE notification (pas au premier chargement)
      const known = knownIdsRef.current;
      if (known && list.some((item) => !known.has(item.id))) {
        try { navigator.vibrate?.([200, 100, 200]); } catch { /* non supporté */ }
      }
      knownIdsRef.current = new Set(list.map((item) => item.id));
      setNotifications(list);
    } catch {
      // réseau instable : prochaine tentative dans 15 s
    }
  }, [token]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, POLL_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const dismiss = async (id: number) => {
    setNotifications((current) => current.filter((item) => item.id !== id));
    try {
      await fetch(`/api/driver-connexion/notifications/${id}/read`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
    } catch {
      // elle réapparaîtra au prochain passage si l'envoi a échoué
    }
  };

  if (notifications.length === 0) return null;

  return (
    <div className="space-y-2" aria-live="polite">
      {notifications.map((notification) => {
        const text = localize(notification, isFrench);
        return (
          <div
            key={notification.id}
            className="flex items-start gap-3 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900"
            role="status"
          >
            <BellRing className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{text.title}</p>
              <p className="text-green-800">{text.body}</p>
            </div>
            <button
              type="button"
              onClick={() => { void dismiss(notification.id); }}
              className="shrink-0 rounded-md p-1 text-green-800 hover:bg-green-100"
              aria-label={isFrench ? "Fermer la notification" : "Dismiss notification"}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}