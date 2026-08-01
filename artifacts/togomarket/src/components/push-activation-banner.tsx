import { useState, useEffect } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSiteSettings } from "@/lib/site-settings";
import type { VendorProfile } from "@workspace/api-client-react";

interface PushActivationBannerProps {
  vendor: VendorProfile;
  vendorPassword: string;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function PushActivationBanner({ vendor, vendorPassword }: PushActivationBannerProps) {
  const { lang } = useSiteSettings();
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    return sessionStorage.getItem("tm_push_dismissed") === "1";
  });

  useEffect(() => {
    if (dismissed) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const perm = Notification.permission;
    if (perm === "granted") return; // already subscribed
    setShow(true);
  }, [dismissed]);

  if (!show || dismissed) return null;

  const handleActivate = async () => {
    setLoading(true);
    setError(null);
    try {
      // Register service worker and wait for it to become active
      await navigator.serviceWorker.register("/sw.js");
      const activeReg = await navigator.serviceWorker.ready;

      // Request permission (no-op if already granted)
      const perm = await Notification.requestPermission();
      if (perm === "denied") {
        setError(lang === "fr"
          ? "Notifications bloquées. Autorisez-les dans les paramètres du navigateur."
          : "Notifications blocked. Allow them in your browser settings.");
        setLoading(false);
        return;
      }
      if (perm !== "granted") {
        setShow(false);
        setLoading(false);
        return;
      }

      // Fetch VAPID public key
      const keyRes = await fetch("/api/push/vapid-public-key");
      if (!keyRes.ok) throw new Error("vapid-key-fetch-failed");
      const { key } = await keyRes.json() as { key: string };
      if (!key) throw new Error("vapid-key-empty");

      // Subscribe — pass Uint8Array directly (not .buffer) for mobile Chrome compatibility
      const keyBytes = urlBase64ToUint8Array(key);
      const sub = await activeReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes.buffer as ArrayBuffer,
      });

      const subJson = sub.toJSON() as {
        endpoint: string;
        keys: { auth: string; p256dh: string };
      };

      const saveRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-vendor-phone": vendor.phone,
          "x-vendor-password": vendorPassword,
        },
        body: JSON.stringify({ endpoint: subJson.endpoint, keys: subJson.keys }),
      });
      if (!saveRes.ok) throw new Error("subscribe-save-failed");

      // Marquer les nudges push comme lus côté serveur (ils seront masqués visuellement)
      fetch("/api/vendor/notifications/read-all", {
        method: "POST",
        headers: {
          "x-vendor-phone": vendor.phone,
          "x-vendor-password": vendorPassword,
        },
      }).catch(() => {/* non-fatal */});

      setShow(false);
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
