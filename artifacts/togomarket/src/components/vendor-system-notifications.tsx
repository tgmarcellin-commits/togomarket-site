import { useState, useEffect, useCallback } from "react";
import { Bell, BellOff, CheckCheck, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSiteSettings } from "@/lib/site-settings";
import type { VendorProfile } from "@workspace/api-client-react";

interface SystemNotification {
  id: number;
  vendorId: number;
  title: string;
  body: string;
  url: string | null;
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

  const authHeaders = {
    "x-vendor-phone": vendor.phone,
    "x-vendor-password": vendorPassword,
  };

  const fetchNotifs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/notifications", { headers: authHeaders });
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

  useEffect(() => { fetchNotifs(); }, [fetchNotifs]);

  // Si des notifications non lues existent, on réinitialise le flag de dismiss
  // de la bannière push pour qu'elle réapparaisse.
  useEffect(() => {
    const unread = notifs.filter((n) => !n.isRead).length;
    if (unread > 0) sessionStorage.removeItem("tm_push_dismissed");
  }, [notifs]);

  const markRead = async (id: number) => {
    await fetch(`/api/vendor/notifications/${id}/read`, { method: "POST", headers: authHeaders });
    setNotifs((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );
    onUnreadChange?.(notifs.filter((n) => !n.isRead && n.id !== id).length);
  };

  const markAllRead = async () => {
    await fetch("/api/vendor/notifications/read-all", { method: "POST", headers: authHeaders });
    setNotifs((prev) => prev.map((n) => ({ ...n, isRead: true })));
    onUnreadChange?.(0);
  };

  const unreadCount = notifs.filter((n) => !n.isRead).length;

  if (loading) return null;
  if (notifs.length === 0) return null;

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
        {notifs.map((notif) => (
          <div
            key={notif.id}
            onClick={() => { if (!notif.isRead) markRead(notif.id); }}
            className={`relative rounded-xl border p-3 transition-colors cursor-pointer ${
              notif.isRead
                ? "bg-card border-border opacity-60"
                : "bg-primary/5 border-primary/20"
            }`}
          >
            {!notif.isRead && (
              <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary" />
            )}
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
          </div>
        ))}
      </div>
    </div>
  );
}
