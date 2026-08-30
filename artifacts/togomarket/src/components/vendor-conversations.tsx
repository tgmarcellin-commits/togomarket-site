import { useState, useEffect, useCallback, useRef } from "react";
import { MessageCircle, RefreshCw, ShoppingBag, Trash2 } from "lucide-react";
import { resolveImageUrl } from "@/lib/image";
import { Badge } from "@/components/ui/badge";
import { ChatWindow } from "@/components/chat-window";
import { useSiteSettings } from "@/lib/site-settings";
import { getSocket } from "@/lib/socket";
import { SESSION_COOKIE_PASSWORD, vendorAuthHeaders } from "@/lib/vendor-auth";
import type { VendorProfile } from "@workspace/api-client-react";

interface Conversation {
  id: number;
  vendorId: number;
  buyerName: string;
  buyerPhone: string;
  listingTitle: string | null;
  listingId: number | null;
  listingImage: string | null;
  createdAt: string;
  updatedAt: string;
  vendorUnreadCount: number;
}

interface VendorConversationsProps {
  vendor: VendorProfile;
  vendorPassword: string;
  onUnreadChange?: (total: number) => void;
}

export function VendorConversations({ vendor, vendorPassword, onUnreadChange }: VendorConversationsProps) {
  const { lang } = useSiteSettings();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [openConv, setOpenConv] = useState<Conversation | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const authHeaders = vendorAuthHeaders(vendor.phone, vendorPassword);

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/conversations", { headers: authHeaders, credentials: "include" });
      if (res.ok) {
        const data = await res.json() as Conversation[];
        setConversations(data);
        onUnreadChange?.(data.reduce((sum, c) => sum + c.vendorUnreadCount, 0));
      }
    } finally {
      setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor.phone, vendorPassword]);

  useEffect(() => {
    fetchConversations();
    const socket = getSocket();
    socket.connect();
    const sync = () => {
      if (vendorPassword !== SESSION_COOKIE_PASSWORD) {
        socket.emit("auth", { phone: vendor.phone, password: vendorPassword });
      }
      fetchConversations();
    };
    sync();
    const handler = () => { fetchConversations(); };
    socket.on("new_message", handler);
    socket.on("auth_ok", fetchConversations);
    socket.on("connect", sync);
    socket.on("reconnect", sync);
    return () => {
      socket.off("new_message", handler);
      socket.off("auth_ok", fetchConversations);
      socket.off("connect", sync);
      socket.off("reconnect", sync);
    };
  }, [fetchConversations, vendor.phone, vendorPassword]);

  const handleOpenConv = async (conv: Conversation) => {
    if (deletingId !== null) return; // don't open while confirming delete
    setOpenConv(conv);
    await fetch(`/api/vendor/conversations/${conv.id}/read`, {
      method: "POST", headers: authHeaders, credentials: "include",
    }).catch(() => {});
    setConversations((prev) => {
      const next = prev.map((c) => (c.id === conv.id ? { ...c, vendorUnreadCount: 0 } : c));
      onUnreadChange?.(next.reduce((sum, c) => sum + c.vendorUnreadCount, 0));
      return next;
    });
  };

  const deleteConversation = async (id: number) => {
    setDeletingId(null);
    await fetch(`/api/vendor/conversations/${id}`, {
      method: "DELETE", headers: authHeaders, credentials: "include",
    });
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      onUnreadChange?.(next.reduce((s, c) => s + c.vendorUnreadCount, 0));
      return next;
    });
  };

  const onPressStart = (id: number) => {
    longPressTimer.current = setTimeout(() => setDeletingId(id), 500);
  };
  const onPressEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const totalUnread = conversations.reduce((s, c) => s + (c.vendorUnreadCount ?? 0), 0);

  return (
    <div className="space-y-3" onClick={() => { if (deletingId) setDeletingId(null); }}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-primary" />
          {lang === "fr" ? "Mes clients" : "My customers"}
          {totalUnread > 0 && (
            <Badge className="bg-destructive text-white text-[10px] px-1.5 py-0.5 rounded-full">
              {totalUnread}
            </Badge>
          )}
        </h3>
        <button
          onClick={fetchConversations}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {conversations.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          {loading
            ? (lang === "fr" ? "Chargement…" : "Loading…")
            : (lang === "fr"
              ? "Aucune conversation pour l'instant. Les acheteurs qui vous contactent apparaîtront ici."
              : "No conversations yet. Buyers who contact you will appear here.")}
        </p>
      ) : (
        <div className="space-y-2">
          {conversations.map((conv) => {
            const isDeleting = deletingId === conv.id;
            return (
              <div
                key={conv.id}
                onPointerDown={() => onPressStart(conv.id)}
                onPointerUp={onPressEnd}
                onPointerLeave={onPressEnd}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isDeleting) { setDeletingId(null); return; }
                  handleOpenConv(conv);
                }}
                className={`w-full text-left rounded-xl border bg-card p-3 flex items-start gap-3 transition-all select-none cursor-pointer ${
                  isDeleting
                    ? "ring-2 ring-destructive/60 bg-destructive/5"
                    : "hover:bg-muted/50"
                }`}
              >
                {isDeleting ? (
                  /* ── Confirmation suppression ── */
                  <div className="flex-1 flex items-center justify-between gap-2">
                    <span className="text-sm text-destructive font-medium">
                      {lang === "fr" ? "Supprimer cette conversation ?" : "Delete this conversation?"}
                    </span>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-destructive text-white"
                      >
                        <Trash2 className="w-3 h-3" />
                        {lang === "fr" ? "Oui" : "Yes"}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeletingId(null); }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-muted text-foreground"
                      >
                        {lang === "fr" ? "Non" : "No"}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── Carte normale ── */
                  <>
                    <div className="w-9 h-9 rounded-lg bg-primary/10 overflow-hidden flex items-center justify-center flex-shrink-0 mt-0.5 relative">
                      <ShoppingBag className="w-4 h-4 text-primary" />
                      {conv.listingImage ? (
                        <img
                          src={resolveImageUrl(conv.listingImage)}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                          onError={(event) => { event.currentTarget.style.display = "none"; }}
                        />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center text-primary font-semibold text-sm bg-primary/10">
                          {conv.buyerName.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-medium text-sm truncate">{conv.buyerName}</span>
                        {conv.vendorUnreadCount > 0 && (
                          <Badge className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0 rounded-full flex-shrink-0">
                            {conv.vendorUnreadCount}
                          </Badge>
                        )}
                      </div>
                      {conv.listingTitle && (
                        <p className="text-xs text-muted-foreground truncate">{conv.listingTitle}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {new Date(conv.updatedAt).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
                          day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {openConv && (
        <ChatWindow
          open={true}
          onOpenChange={(v) => { if (!v) setOpenConv(null); }}
          conversationId={openConv.id}
          buyerIdentity={{ name: openConv.buyerName, phone: openConv.buyerPhone }}
          vendorName={openConv.buyerName}
          listingTitle={openConv.listingTitle}
          listingImage={openConv.listingImage}
          auth={{ kind: "vendor", phone: vendor.phone, password: vendorPassword }}
          onConversationDeleted={() => {
            setConversations((prev) => {
              const next = prev.filter((c) => c.id !== openConv.id);
              onUnreadChange?.(next.reduce((sum, c) => sum + c.vendorUnreadCount, 0));
              return next;
            });
            setOpenConv(null);
          }}
        />
      )}
    </div>
  );
}
