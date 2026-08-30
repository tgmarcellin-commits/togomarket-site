import { useState, useEffect } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSiteSettings } from "@/lib/site-settings";
import type { VendorProfile } from "@workspace/api-client-react";
import { vendorAuthHeaders } from "@/lib/vendor-auth";
import {
  activateVendorPush,
  confirmOrRepairVendorPush,
  supportsVendorPush,
} from "@/lib/vendor-push";

interface PushActivationBannerProps {
  vendor: VendorProfile;
  vendorPassword: string;
  onActivated?: () => void;
}

export function PushActivationBanner({ vendor, vendorPassword, onActivated }: PushActivationBannerProps) {
  const { lang } = useSiteSettings();
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    return sessionStorage.getItem("tm_push_dismissed") === "1";
  });

  useEffect(() => {
    if (dismissed) return;
    if (!supportsVendorPush()) {
      setError(lang === "fr" ? "Les notifications push ne sont pas prises en charge par ce navigateur." : "Push notifications are not supported by this browser.");
      setShow(true);
      return;
    }
    if (Notification.permission === "denied") {
      setError(lang === "fr" ? "Notifications bloquées. Autorisez-les dans les paramètres du navigateur." : "Notifications are blocked. Allow them in your browser settings.");
      setShow(true);
      return;
    }
    let cancelled = false;
    confirmOrRepairVendorPush({ phone: vendor.phone, password: vendorPassword })
      .then((active) => {
        if (!cancelled) setShow(!active);
      })
      .catch(() => {
        if (!cancelled) {
          setError(lang === "fr" ? "Impossible de vérifier les notifications push." : "Unable to check push notifications.");
          setShow(true);
        }
      });
    return () => { cancelled = true; };
  }, [dismissed, lang, vendor.phone, vendorPassword]);

  if (!show || dismissed) return null;

  const handleActivate = async () => {
    setLoading(true);
    setError(null);
    try {
      await activateVendorPush({ phone: vendor.phone, password: vendorPassword });

      // Marquer les nudges push comme lus côté serveur (ils seront masqués visuellement)
      fetch("/api/vendor/notifications/read-all", {
        method: "POST",
        headers: {
          ...vendorAuthHeaders(vendor.phone, vendorPassword),
        },
        credentials: "include",
      }).catch(() => {/* non-fatal */});

      setShow(false);
      setDismissed(false);
      sessionStorage.removeItem("tm_push_dismissed");
      onActivated?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(lang === "fr"
        ? `Échec de l'activation (${msg}). Réessayez ou rechargez la page.`
        : `Activation failed (${msg}). Retry or reload the page.`);
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem("tm_push_dismissed", "1");
    setShow(false);
  };

  return (
    <div className="mx-4 mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3 flex items-start gap-3">
      <Bell className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">
          {lang === "fr" ? "Activez les notifications" : "Activate notifications"}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          {lang === "fr"
            ? "Recevez une notification instantanée dès qu'un acheteur vous envoie un message."
            : "Get notified instantly when a buyer sends you a message."}
        </p>
        {error && (
          <p className="text-xs text-destructive mt-1.5 leading-relaxed">{error}</p>
        )}
        <Button
          size="sm"
          className="mt-2 h-7 text-xs rounded-full px-4"
          onClick={handleActivate}
          disabled={loading}
        >
          {loading
            ? (lang === "fr" ? "Activation…" : "Activating…")
            : (lang === "fr" ? "Activer" : "Activate")}
        </Button>
      </div>
      <button
        onClick={handleDismiss}
        className="text-muted-foreground hover:text-foreground flex-shrink-0 mt-0.5"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
