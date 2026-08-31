import { useState, useEffect, useCallback, useRef } from "react";
import { MessageCircle, RefreshCw, Bell, X, ShoppingBag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatWindow } from "@/components/chat-window";
import { useSiteSettings } from "@/lib/site-settings";
import { getSocket, joinBuyerConversationRooms } from "@/lib/socket";
import { resolveImageUrl } from "@/lib/image";
import type { BuyerIdentity } from "@/components/buyer-identity-prompt";

/* ── Types ───────────────────────────────────────────────────── */
interface BuyerConversation {
  id: number;
  vendorId: number;
  listingTitle: string | null;
  listingImage: string | null;
  buyerName: string;
  buyerPhone: string;
  lastMessage: string | null;
  lastMessageAt: string;
  buyerUnreadCount: number;
  buyerToken: string;
}

/* ── localStorage helpers ────────────────────────────────────── */
const BUYER_TOKENS_KEY = "tm_buyer_tokens";
const BUYER_KEY_KEY = "tm_buyer_key";
export const BUYER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface StoredSession {
  convId: number;
  buyerToken: string;
  vendorId: number;
  listingId: number;
  listingTitle: string;
  expiresAt?: number;
}

export function getAllBuyerSessions(): StoredSession[] {
  try {
    const raw = localStorage.getItem(BUYER_TOKENS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const now = Date.now();
    const sessions = parsed.flatMap((session: Partial<StoredSession>) => {
      if (!session || !session.convId || !session.buyerToken) return [];
      const expiresAt = typeof session.expiresAt === "number"
        ? session.expiresAt
        : now + BUYER_SESSION_TTL_MS;
      if (expiresAt <= now) {
        if (session.vendorId && session.listingId) {
          localStorage.removeItem(`tm_chat_${session.vendorId}_${session.listingId}`);
        }
        return [];
      }
      return [{ ...session, expiresAt } as StoredSession];
    });

    // Persist the expiry added to older sessions and remove expired/deleted
    // entries before they can be sent back to the API.
    if (JSON.stringify(sessions) !== raw) {
      localStorage.setItem(BUYER_TOKENS_KEY, JSON.stringify(sessions));
    }
    return sessions;
  } catch {
    return [];
  }
}

export function removeBuyerSession(convId: number): void {
  try {
    const sessions = getAllBuyerSessions();
    const removed = sessions.filter((session) => session.convId === convId);
    removed.forEach((session) => {
      localStorage.removeItem(`tm_chat_${session.vendorId}_${session.listingId}`);
    });
    localStorage.setItem(
      BUYER_TOKENS_KEY,
      JSON.stringify(sessions.filter((session) => session.convId !== convId)),
    );
  } catch {}
}

/**
 * Migre les anciennes clés localStorage `tm_chat_${vendorId}_${listingId}`
 * vers le store centralisé `tm_buyer_tokens`. Idempotent — exécuté à chaque
 * montage de BuyerInbox, mais n'ajoute que ce qui n'est pas déjà présent.
 */
export function migrateLegacySessions(): void {
  try {
    const existing = getAllBuyerSessions();
    const existingConvIds = new Set(existing.map((s) => s.convId));
    const toAdd: StoredSession[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith("tm_chat_")) continue;
      // format: tm_chat_${vendorId}_${listingId}
      const parts = key.split("_");
      if (parts.length < 4) continue;
      const vendorId = parseInt(parts[2], 10);
      const listingId = parseInt(parts[3], 10);
      if (isNaN(vendorId) || isNaN(listingId)) continue;

      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const stored = JSON.parse(raw) as {
          convId?: number;
          buyerToken?: string;
          expiresAt?: number;
        };
        if (!stored.convId || !stored.buyerToken) continue;
        if (typeof stored.expiresAt === "number" && stored.expiresAt <= Date.now()) {
          localStorage.removeItem(key);
          continue;
        }
        if (existingConvIds.has(stored.convId)) continue;

        toAdd.push({
          convId: stored.convId,
          buyerToken: stored.buyerToken,
          vendorId,
          listingId,
          listingTitle: "",
          expiresAt: typeof stored.expiresAt === "number"
            ? stored.expiresAt
            : Date.now() + BUYER_SESSION_TTL_MS,
        });
        existingConvIds.add(stored.convId);
      } catch {}
    }

    if (toAdd.length > 0) {
      localStorage.setItem(BUYER_TOKENS_KEY, JSON.stringify([...existing, ...toAdd]));
    }
  } catch {}
}

export function storeBuyerSession(session: StoredSession) {
  try {
    const existing = getAllBuyerSessions();
    // One buyer/vendor thread: changing listings updates the same session.
    const filtered = existing.filter(
      (s) => s.vendorId !== session.vendorId && s.convId !== session.convId,
    );
    localStorage.setItem(BUYER_TOKENS_KEY, JSON.stringify([
      ...filtered,
      {
        ...session,
        expiresAt: session.expiresAt ?? Date.now() + BUYER_SESSION_TTL_MS,
      },
    ]));
  } catch {}
}

export function getBuyerSession(vendorId: number, listingId?: number): StoredSession | null {
  void listingId;
  return getAllBuyerSessions().find((s) => s.vendorId === vendorId) ?? null;
}

export function getOrCreateBuyerKey(identity: BuyerIdentity): string {
  const identityFingerprint = identity.phone.trim();
  try {
    const saved = JSON.parse(localStorage.getItem(BUYER_KEY_KEY) ?? "null") as {
      identityFingerprint?: string;
      key?: string;
    } | null;
    if (saved?.identityFingerprint === identityFingerprint && saved.key) return saved.key;
  } catch {
    // A malformed value is replaced below.
  }
  const key = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  localStorage.setItem(BUYER_KEY_KEY, JSON.stringify({ identityFingerprint, key }));
  return key;
}

/* ── VAPID helper ────────────────────────────────────────────── */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

/* ── BuyerPushBanner ─────────────────────────────────────────── */
function BuyerPushBanner({
  conversations,
  lang,
}: {
  conversations: BuyerConversation[];
  lang: string;
}) {
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(() =>
    sessionStorage.getItem("tm_buyer_push_dismissed") === "1",
  );

  // Afficher le banner si la permission n'est pas encore accordée
  useEffect(() => {
    if (dismissed) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission === "granted") return;
    setShow(true);
  }, [dismissed]);

  // Auto-subscribe silencieux si la permission est déjà accordée
  // Couvre : (a) retour d'un acheteur ayant déjà activé les notifs,
  //          (b) nouvelles conversations créées après l'activation initiale.
  useEffect(() => {
    if (conversations.length === 0) return;
    if (Notification.permission !== "granted") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return; // Pas d'abonnement actif → la banner gèrera ça
        const subJson = sub.toJSON() as { endpoint: string; keys: { auth: string; p256dh: string } };
        await Promise.allSettled(
          conversations.map((conv) =>
            fetch("/api/push/buyer-subscribe", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-buyer-token": conv.buyerToken,
                "x-conversation-id": String(conv.id),
              },
              body: JSON.stringify({ endpoint: subJson.endpoint, keys: subJson.keys }),
            }),
          ),
        );
      } catch {}
    })();
  }, [conversations]); // S'exécute à chaque mise à jour de la liste des conversations

  if (!show || dismissed || conversations.length === 0) return null;

  const handleActivate = async () => {
    setLoading(true);
    setError(null);
    try {
      await navigator.serviceWorker.register("/sw.js");
      const reg = await navigator.serviceWorker.ready;

      const perm = await Notification.requestPermission();
      if (perm === "denied") {
        setError(
          lang === "fr"
            ? "Notifications bloquées — autorisez-les dans les paramètres du navigateur."
            : "Notifications blocked — allow them in your browser settings.",
        );
        setLoading(false);
        return;
      }
      if (perm !== "granted") {
        setShow(false);
        setLoading(false);
        return;
      }

      const keyRes = await fetch("/api/push/vapid-public-key");
      if (!keyRes.ok) throw new Error("vapid-key-fetch-failed");
      const { key } = (await keyRes.json()) as { key: string };
      if (!key) throw new Error("vapid-key-empty");

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key).buffer as ArrayBuffer,
      });
      const subJson = sub.toJSON() as {
        endpoint: string;
        keys: { auth: string; p256dh: string };
      };

      // Subscribe once per conversation the buyer has
      await Promise.allSettled(
        conversations.map((conv) =>
          fetch("/api/push/buyer-subscribe", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-buyer-token": conv.buyerToken,
              "x-conversation-id": String(conv.id),
            },
            body: JSON.stringify({ endpoint: subJson.endpoint, keys: subJson.keys }),
          }),
        ),
      );

      setShow(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        lang === "fr"
          ? `Échec de l'activation (${msg}). Réessayez.`
          : `Activation failed (${msg}). Retry.`,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-0 mb-4 rounded-xl border border-primary/30 bg-primary/5 p-3 flex items-start gap-3">
      <Bell className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">
          {lang === "fr" ? "Activer les notifications" : "Enable notifications"}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          {lang === "fr"
            ? "Recevez une notification dès qu'un vendeur vous répond."
            : "Get notified instantly when a seller replies."}
        </p>
        {error && <p className="text-xs text-destructive mt-1.5">{error}</p>}
        <Button
          size="sm"
          className="mt-2 h-7 text-xs rounded-full px-4"
          onClick={handleActivate}
          disabled={loading}
        >
          {loading
            ? lang === "fr"
              ? "Activation…"
              : "Activating…"
            : lang === "fr"
              ? "Activer"
              : "Activate"}
        </Button>
      </div>
      <button
        onClick={() => {
          setDismissed(true);
          sessionStorage.setItem("tm_buyer_push_dismissed", "1");
          setShow(false);
        }}
        className="text-muted-foreground hover:text-foreground flex-shrink-0 mt-0.5"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

/* ── BuyerInbox ──────────────────────────────────────────────── */
interface BuyerInboxProps {
  identity: BuyerIdentity;
  /** If set, auto-open this conversation when the inbox loads */
  pendingConvId?: number | null;
  onClearPending?: () => void;
  onUnreadChange?: (total: number) => void;
}

export function BuyerInbox({ identity, pendingConvId, onClearPending, onUnreadChange }: BuyerInboxProps) {
  const { lang } = useSiteSettings();
  const [conversations, setConversations] = useState<BuyerConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [openConv, setOpenConv] = useState<BuyerConversation | null>(null);
  const [unavailableConversationId, setUnavailableConversationId] = useState<number | null>(null);
  const socketRef = useRef(getSocket());
  const fetchSequenceRef = useRef(0);
  const totalUnread = conversations.reduce((sum, conversation) => sum + (conversation.buyerUnreadCount ?? 0), 0);

  useEffect(() => {
    onUnreadChange?.(totalUnread);
  }, [onUnreadChange, totalUnread]);

  const fetchConversations = useCallback(async () => {
    const requestSequence = ++fetchSequenceRef.current;
    const sessions = getAllBuyerSessions();
    if (sessions.length === 0) {
      setConversations([]);
      return;
    }
    setLoading(true);
    try {
      const socket = socketRef.current;
      socket.connect();
      await joinBuyerConversationRooms(socket, sessions);
      if (requestSequence !== fetchSequenceRef.current) return;

      const res = await fetch("/api/conversations/buyer-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyerTokens: sessions.map((s) => s.buyerToken) }),
      });
      if (res.ok && requestSequence === fetchSequenceRef.current) {
        const data = (await res.json()) as BuyerConversation[];
        if (requestSequence !== fetchSequenceRef.current) return;
        const canonicalSessions: StoredSession[] = [];
        const enriched = data.map((conv) => {
          const session = sessions.find((s) => s.buyerToken === conv.buyerToken)
            ?? sessions.find((s) => s.convId === conv.id);
          if (session) {
            canonicalSessions.push({
              ...session,
              convId: conv.id,
              buyerToken: conv.buyerToken,
              vendorId: conv.vendorId,
              listingTitle: conv.listingTitle ?? session.listingTitle,
              expiresAt: Date.now() + BUYER_SESSION_TTL_MS,
            });
          }
          return { ...conv, buyerToken: session?.buyerToken ?? conv.buyerToken };
        });
        const newestByVendor = new Map<number, StoredSession>();
        for (const session of canonicalSessions) newestByVendor.set(session.vendorId, session);
        localStorage.setItem(BUYER_TOKENS_KEY, JSON.stringify([...newestByVendor.values()]));
        const sorted = enriched.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
        setConversations(sorted);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleMessagesRead = useCallback(() => {
    void fetchConversations();
  }, [fetchConversations]);

  const openConversation = async (conversation: BuyerConversation) => {
    const res = await fetch(`/api/conversations/${conversation.id}`, {
      headers: { "x-buyer-token": conversation.buyerToken },
    });
    if (res.status === 404) {
      removeBuyerSession(conversation.id);
      setConversations((current) => current.filter((conv) => conv.id !== conversation.id));
      setUnavailableConversationId(conversation.id);
      return;
    }
    if (!res.ok) return;
    const resolved = await res.json() as { id?: number };
    const canonicalConversation = resolved.id && resolved.id !== conversation.id
      ? { ...conversation, id: resolved.id }
      : conversation;
    storeBuyerSession({
      convId: canonicalConversation.id,
      buyerToken: canonicalConversation.buyerToken,
      vendorId: canonicalConversation.vendorId,
      listingId: getBuyerSession(canonicalConversation.vendorId)?.listingId ?? 0,
      listingTitle: canonicalConversation.listingTitle ?? "",
    });
    setOpenConv(canonicalConversation);
  };

  // Migration des anciennes sessions localStorage (tm_chat_*) vers le store centralisé
  useEffect(() => {
    migrateLegacySessions();
  }, []);

  // Initial fetch + real-time updates
  useEffect(() => {
    fetchConversations();
    const socket = socketRef.current;
    const handler = () => fetchConversations();
    const reconnectHandler = () => fetchConversations();
    socket.on("new_message", handler);
    socket.on("messages_read", handler);
    socket.on("connect", reconnectHandler);
    socket.on("reconnect", reconnectHandler);
    return () => {
      socket.off("new_message", handler);
      socket.off("messages_read", handler);
      socket.off("connect", reconnectHandler);
      socket.off("reconnect", reconnectHandler);
    };
  }, [fetchConversations]);

  // Auto-open pending conversation from "Discuter" redirect
  useEffect(() => {
    if (!pendingConvId || conversations.length === 0) return;
    const target = conversations.find((c) => c.id === pendingConvId);
    if (target) {
      setOpenConv(target);
      onClearPending?.();
    }
  }, [pendingConvId, conversations, onClearPending]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-primary" />
          {lang === "fr" ? "Mes conversations" : "My conversations"}
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

      {/* Push banner */}
      <BuyerPushBanner conversations={conversations} lang={lang} />

      {/* Buyer info */}
      <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
        {lang === "fr" ? "Connecté en tant que" : "Signed in as"}{" "}
        <span className="font-semibold text-foreground">{identity.name}</span>{" "}
        · {identity.phone}
      </div>

      {unavailableConversationId !== null && (
        <p className="text-sm text-muted-foreground text-center py-2">
          {lang === "fr"
            ? "Cette conversation n'est plus disponible"
            : "This conversation is no longer available"}
        </p>
      )}

      {/* Conversation list */}
      {conversations.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          {loading
            ? lang === "fr"
              ? "Chargement…"
              : "Loading…"
            : lang === "fr"
              ? "Aucune conversation. Cliquez sur « Discuter » sur un article pour démarrer."
              : "No conversations yet. Tap \"Contact seller\" on any listing to start."}
        </p>
      ) : (
        <div className="space-y-2">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => { void openConversation(conv); }}
              className="w-full text-left rounded-xl border bg-card p-3 flex items-start gap-3 hover:bg-muted/50 transition-colors"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 overflow-hidden flex items-center justify-center flex-shrink-0 mt-0.5 relative">
                <ShoppingBag className="w-4 h-4 text-primary" />
                {conv.listingImage && (
                  <img
                    src={resolveImageUrl(conv.listingImage)}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(event) => { event.currentTarget.style.display = "none"; }}
                  />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-medium text-sm truncate">
                    {conv.listingTitle ?? (lang === "fr" ? "Discussion" : "Chat")}
                  </span>
                  {conv.buyerUnreadCount > 0 && (
                    <Badge className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0 rounded-full flex-shrink-0">
                      {conv.buyerUnreadCount}
                    </Badge>
                  )}
                </div>
                {conv.lastMessage && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{conv.lastMessage}</p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(conv.lastMessageAt).toLocaleDateString(
                    lang === "fr" ? "fr-FR" : "en-US",
                    { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" },
                  )}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Open ChatWindow */}
      {openConv && (
        <ChatWindow
          open={true}
          onOpenChange={(v) => {
            if (!v) {
              setOpenConv(null);
              fetchConversations(); // refresh unread on close
            }
          }}
          conversationId={openConv.id}
          buyerIdentity={{ name: identity.name, phone: identity.phone }}
          vendorName={openConv.listingTitle ?? "Vendeur"}
          listingTitle={openConv.listingTitle}
          listingImage={openConv.listingImage}
          auth={{ kind: "buyer", buyerToken: openConv.buyerToken }}
          onMessagesRead={handleMessagesRead}
          onConversationDeleted={() => {
            // Remove from local sessions
            removeBuyerSession(openConv.id);
            setOpenConv(null);
            fetchConversations();
          }}
          onConversationUnavailable={() => removeBuyerSession(openConv.id)}
        />
      )}
    </div>
  );
}
