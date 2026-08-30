import { useState, useEffect, useCallback, useRef } from "react";
import { Bell, CheckCheck, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSiteSettings } from "@/lib/site-settings";
import type { VendorProfile } from "@workspace/api-client-react";
import { getSocket } from "@/lib/socket";
import { vendorAuthHeaders } from "@/lib/vendor-auth";
import { confirmOrRepairVendorPush } from "@/lib/vendor-push";

interface SystemNotification {
  id: number;
  vendorId: number;
  title: string;
  body: string;
  url: string | null;
  notifType: string;
  isRead: boolean;
  createdAt: string;
}

interface Props {
  vendor: VendorProfile;
  vendorPassword: string;
  onUnreadChange?: (count: number) => void;
}

export function VendorSystemNotifications({ vendor, vendorPassword, onUnreadChange }: Props) {
  const { lang } = useSiteSettings();
  const [notifs, setNotifs] = useState<SystemNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const authHeaders = vendorAuthHeaders(vendor.phone, vendorPassword);

  const fetchNotifs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/notifications", { headers: authHeaders, credentials: "include" });
      if (res.ok) {
        const data = await res.json() as SystemNotification[];
        setNotifs(data);
        onUnreadChange?.(data.filter((n) => !n.isRead).length);
      }
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor.phone, vendorPassword]);

  useEffect(() => {
    fetchNotifs();
    const socket = getSocket();
    const sync = () => { fetchNotifs(); };
    socket.on("vendor_system_notification", sync);
    socket.on("auth_ok", sync);
    socket.on("connect", sync);
    socket.on("reconnect", sync);
    return () => {
      socket.off("vendor_system_notification", sync);
      socket.off("auth_ok", sync);
      socket.off("connect", sync);
      socket.off("reconnect", sync);
    };
  }, [fetchNotifs]);

  useEffect(() => {
    let cancelled = false;
    confirmOrRepairVendorPush({ phone: vendor.phone, password: vendorPassword })
      .then((active) => { if (!cancelled) setPushSubscribed(active); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [vendor.phone, vendorPassword]);

  // Si des notifications non lues existent, on réinitialise le flag de dismiss
  // de la bannière push pour qu'elle réapparaisse.
  useEffect(() => {
    const unread = notifs.filter((n) => !n.isRead).length;
    if (unread > 0) sessionStorage.removeItem("tm_push_dismissed");
  }, [notifs]);

  const markRead = async (id: number) => {
    await fetch(`/api/vendor/notifications/${id}/read`, { method: "POST", headers: authHeaders, credentials: "include" });
    setNotifs((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );
    onUnreadChange?.(notifs.filter((n) => !n.isRead && n.id !== id).length);
  };

  const markAllRead = async () => {
    await fetch("/api/vendor/notifications/read-all", { method: "POST", headers: authHeaders, credentials: "include" });
    setNotifs((prev) => prev.map((n) => ({ ...n, isRead: true })));
    onUnreadChange?.(0);
  };

  const deleteNotif = async (id: number) => {
    setDeletingId(null);
    await fetch(`/api/vendor/notifications/${id}`, { method: "DELETE", headers: authHeaders, credentials: "include" });
    setNotifs((prev) => {
      const next = prev.filter((n) => n.id !== id);
      onUnreadChange?.(next.filter((n) => !n.isRead).length);
      return next;
    });
  };

  const onPressStart = (id: number) => {
    longPressTimer.current = setTimeout(() => setDeletingId(id), 500);
  };
  const onPressEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  // Masquer les nudges uniquement après confirmation serveur pour ce vendeur.
  const visibleNotifs = pushSubscribed
    ? notifs.filter((n) => n.notifType !== "push_nudge")
    : notifs;

  const unreadCount = visibleNotifs.filter((n) => !n.isRead).length;

  if (loading) return null;
  if (visibleNotifs.length === 0) return null;

  return (
    <div className="mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">
            {lang === "fr" ? "Notifications plateforme" : "Platform notifications"}
          </span>
          {unreadCount > 0 && (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
              {unreadCount}
            </Badge>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 gap-1 text-muted-foreground"
            onClick={markAllRead}
          >
            <CheckCheck className="w-3 h-3" />
            {lang === "fr" ? "Tout lire" : "Mark all read"}
          </Button>
        )}
      </div>

      {/* Liste */}
      <div className="space-y-2">
        {visibleNotifs.map((notif) => (
          <div
            key={notif.id}
            onPointerDown={() => onPressStart(notif.id)}
            onPointerUp={onPressEnd}
            onPointerLeave={onPressEnd}
            onClick={() => {
              if (deletingId === notif.id) { setDeletingId(null); return; }
              if (!notif.isRead) markRead(notif.id);
            }}
            className={`relative rounded-xl border p-3 transition-colors cursor-pointer select-none ${
              notif.isRead
                ? "bg-card border-border opacity-60"
                : "bg-primary/5 border-primary/20"
            } ${deletingId === notif.id ? "ring-2 ring-destructive/60" : ""}`}
          >
            {/* Badge non lu */}
            {!notif.isRead && deletingId !== notif.id && (
              <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary" />
            )}

            {/* Bouton supprimer (long press) */}
            {deletingId === notif.id ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-destructive font-medium">
                  {lang === "fr" ? "Supprimer cette notification ?" : "Delete this notification?"}
                </span>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteNotif(notif.id); }}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-destructive text-white"
                  >
                    <Trash2 className="w-3 h-3" />
                    {lang === "fr" ? "Oui" : "Yes"}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeletingId(null); }}
                    className="px-2 py-1 rounded-lg text-xs font-semibold bg-muted text-foreground"
                  >
                    {lang === "fr" ? "Non" : "No"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm font-semibold pr-4">{notif.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{notif.body}</p>
                {notif.url && (
                  <a
                    href={notif.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 mt-2 text-xs text-primary font-medium hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {lang === "fr" ? "Renouveler maintenant" : "Renew now"}
                  </a>
                )}
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  {new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-US", {
                    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                  }).format(new Date(notif.createdAt))}
                </p>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
