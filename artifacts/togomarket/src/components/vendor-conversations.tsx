import { useState, useEffect, useCallback } from "react";
import { MessageCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChatWindow } from "@/components/chat-window";
import { useSiteSettings } from "@/lib/site-settings";
import { getSocket } from "@/lib/socket";
import type { VendorProfile } from "@workspace/api-client-react";

interface Conversation {
  id: number;
  vendorId: number;
  buyerName: string;
  buyerPhone: string;
  listingTitle: string | null;
  listingId: number | null;
  createdAt: string;
  updatedAt: string;
  vendorUnreadCount: number;
}

interface VendorConversationsProps {
  vendor: VendorProfile;
  vendorPassword: string;
}

export function VendorConversations({ vendor, vendorPassword }: VendorConversationsProps) {
  const { lang } = useSiteSettings();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [openConv, setOpenConv] = useState<Conversation | null>(null);

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/conversations", {
        headers: {
          "x-vendor-phone": vendor.phone,
          "x-vendor-password": vendorPassword,
        },
      });
      if (res.ok) {
        const data = await res.json() as Conversation[];
        setConversations(data);
      }
    } finally {
      setLoading(false);
    }
  }, [vendor.phone, vendorPassword]);

  useEffect(() => {
    fetchConversations();
    // Authenticate vendor socket
    const socket = getSocket();
    socket.emit("auth", { phone: vendor.phone, password: vendorPassword });
    const handler = () => {
      // Refresh conversations when a new message arrives
      fetchConversations();
    };
    socket.on("new_message", handler);
    return () => { socket.off("new_message", handler); };
  }, [fetchConversations, vendor.phone, vendorPassword]);

  const handleOpenConv = async (conv: Conversation) => {
    setOpenConv(conv);
    // Mark as read
    await fetch(`/api/vendor/conversations/${conv.id}/read`, {
      method: "POST",
      headers: {
        "x-vendor-phone": vendor.phone,
        "x-vendor-password": vendorPassword,
      },
    }).catch(() => {});
    // Reset unread locally
    setConversations((prev) =>
      prev.map((c) => (c.id === conv.id ? { ...c, vendorUnreadCount: 0 } : c))
    );
  };

  const totalUnread = conversations.reduce((s, c) => s + (c.vendorUnreadCount ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-primary" />
          {lang === "fr" ? "Conversations" : "Conversations"}
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
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => handleOpenConv(conv)}
              className="w-full text-left rounded-xl border bg-card hover:bg-muted/50 transition-colors p-3 flex items-start gap-3"
            >
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-primary font-semibold text-sm">
                  {conv.buyerName.charAt(0).toUpperCase()}
                </span>
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
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </button>
          ))}
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
          auth={{ kind: "vendor", phone: vendor.phone, password: vendorPassword }}
        />
      )}
    </div>
  );
}
