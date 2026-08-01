import { useState, useEffect, useRef, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Send, MessageCircle, ShoppingBag, Paperclip,
  Pencil, Trash2, X, Check, FileText,
} from "lucide-react";
import { useSiteSettings } from "@/lib/site-settings";
import { getSocket } from "@/lib/socket";
import { resolveImageUrl } from "@/lib/image";
import type { BuyerIdentity } from "./buyer-identity-prompt";

interface ChatMessage {
  id: number;
  conversationId: number;
  senderType: "buyer" | "vendor";
  content: string | null;
  fileUrl: string | null;
  fileType: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

type ChatAuth =
  | { kind: "buyer"; buyerToken: string }
  | { kind: "vendor"; phone: string; password: string };

interface ChatWindowProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conversationId: number;
  buyerIdentity: BuyerIdentity;
  vendorName: string;
  listingTitle?: string | null;
  auth: ChatAuth;
}

function authHeaders(auth: ChatAuth): Record<string, string> {
  if (auth.kind === "buyer") return { "x-buyer-token": auth.buyerToken };
  return { "x-vendor-phone": auth.phone, "x-vendor-password": auth.password };
}

function canEditOrDelete(msg: ChatMessage): boolean {
  return Date.now() - new Date(msg.createdAt).getTime() < 5 * 60 * 1000;
}

export function ChatWindow({
  open, onOpenChange, conversationId, buyerIdentity, vendorName, listingTitle, auth,
}: ChatWindowProps) {
  const { lang } = useSiteSettings();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [menuMsgId, setMenuMsgId] = useState<number | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selfType = auth.kind === "vendor" ? "vendor" : "buyer";

  const scrollToBottom = () => endRef.current?.scrollIntoView({ behavior: "smooth" });

  const fetchMessages = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        headers: authHeaders(auth),
      });
      if (res.ok) setMessages(await res.json() as ChatMessage[]);
    } finally { setLoading(false); }
  }, [conversationId, auth]);

  useEffect(() => {
    if (!open || !conversationId) return;
    fetchMessages();
    const socket = getSocket();
    const joinPayload =
      auth.kind === "buyer"
        ? { conversationId, buyerToken: auth.buyerToken }
        : { conversationId, buyerToken: "" };
    socket.emit("join_conv", joinPayload);

    const onNew = (data: { conversationId: number; message: ChatMessage }) => {
      if (data.conversationId !== conversationId) return;
      setMessages((prev) =>
        prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message],
      );
    };
    const onEdited = (data: { messageId: number; content: string; editedAt: string }) => {
      setMessages((prev) =>
        prev.map((m) => m.id === data.messageId ? { ...m, content: data.content, editedAt: data.editedAt } : m),
      );
    };
    const onDeleted = (data: { messageId: number }) => {
      setMessages((prev) =>
        prev.map((m) => m.id === data.messageId ? { ...m, deletedAt: new Date().toISOString() } : m),
      );
    };

    socket.on("new_message", onNew);
    socket.on("message_edited", onEdited);
    socket.on("message_deleted", onDeleted);
    return () => {
      socket.off("new_message", onNew);
      socket.off("message_edited", onEdited);
      socket.off("message_deleted", onDeleted);
    };
  }, [open, conversationId, fetchMessages]);

  useEffect(() => { scrollToBottom(); }, [messages]);

  // ── Send text ──────────────────────────────────────────────────────────────
  const sendMessage = async () => {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    setInput("");
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(auth) },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        const msg = await res.json() as ChatMessage;
        setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
      }
    } finally { setSending(false); }
  };

  // ── Upload file ────────────────────────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const allowed = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
    if (!allowed.includes(file.type)) {
      alert(lang === "fr" ? "Format non supporté. Utilisez JPEG, PNG ou PDF." : "Unsupported format. Use JPEG, PNG or PDF.");
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/conversations/${conversationId}/upload`, {
        method: "POST",
        headers: authHeaders(auth),
        body: form,
      });
      if (res.ok) {
        const msg = await res.json() as ChatMessage;
        setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
      }
    } finally { setUploading(false); }
  };

  // ── Delete message ─────────────────────────────────────────────────────────
  const deleteMessage = async (id: number) => {
    closeMenu();
    const res = await fetch(`/api/messages/${id}`, {
      method: "DELETE",
      headers: authHeaders(auth),
    });
    if (res.ok) {
      setMessages((prev) =>
        prev.map((m) => m.id === id ? { ...m, deletedAt: new Date().toISOString() } : m),
      );
    }
  };

  // ── Edit message ───────────────────────────────────────────────────────────
  const startEdit = (msg: ChatMessage) => {
    closeMenu();
    setEditingId(msg.id);
    setEditContent(msg.content ?? "");
  };

  const saveEdit = async () => {
    if (!editingId || !editContent.trim()) return;
    const res = await fetch(`/api/messages/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders(auth) },
      body: JSON.stringify({ content: editContent.trim() }),
    });
    if (res.ok) {
      const updated = await res.json() as { content: string; editedAt: string };
      setMessages((prev) =>
        prev.map((m) => m.id === editingId ? { ...m, ...updated } : m),
      );
    }
    setEditingId(null);
    setEditContent("");
  };

  // ── Long press handlers ────────────────────────────────────────────────────
  const onPressStart = (id: number, e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    longPressTimer.current = setTimeout(() => {
      const rect = el.getBoundingClientRect();
      const menuHeight = 44;
      const spaceAbove = rect.top - 60; // 60px for the sheet header
      const top = spaceAbove >= menuHeight
        ? rect.top - menuHeight - 6
        : rect.bottom + 6;
      const right = window.innerWidth - rect.right;
      setMenuPos({ top, right });
      setMenuMsgId(id);
    }, 500);
  };
  const onPressEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };
  const closeMenu = () => { setMenuMsgId(null); setMenuPos(null); };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── Render message bubble ──────────────────────────────────────────────────
  const renderBubble = (msg: ChatMessage) => {
    const isSelf = msg.senderType === selfType;

    if (msg.deletedAt) return null;

    return (
      <div key={msg.id} className={`flex ${isSelf ? "justify-end" : "justify-start"}`}>
        <div
          onPointerDown={isSelf ? (e) => onPressStart(msg.id, e) : undefined}
          onPointerUp={isSelf ? onPressEnd : undefined}
          onPointerLeave={isSelf ? onPressEnd : undefined}
          onClick={isSelf && menuMsgId === msg.id ? closeMenu : undefined}
          className={`max-w-[75%] rounded-2xl text-sm leading-relaxed overflow-hidden select-none ${
            isSelf
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-muted text-foreground rounded-bl-sm"
          }`}
        >
          {/* Image */}
          {msg.fileUrl && msg.fileType === "image" && (
            <a href={resolveImageUrl(msg.fileUrl)} target="_blank" rel="noopener noreferrer">
              <img
                src={resolveImageUrl(msg.fileUrl)}
                alt="image"
                className="max-w-[220px] max-h-[220px] object-cover block"
              />
            </a>
          )}

          {/* PDF */}
          {msg.fileUrl && msg.fileType === "pdf" && (
            <a
              href={resolveImageUrl(msg.fileUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2"
            >
              <FileText className="w-8 h-8 flex-shrink-0 opacity-80" />
              <span className="text-xs font-medium underline break-all">
                {lang === "fr" ? "Voir le PDF" : "Open PDF"}
              </span>
            </a>
          )}

          {/* Text */}
          {msg.content && (
            <p className="px-3 py-2">{msg.content}</p>
          )}

          {/* Edited label */}
          {msg.editedAt && (
            <p className={`text-[10px] pb-1 px-3 opacity-60 ${isSelf ? "text-right" : "text-left"}`}>
              {lang === "fr" ? "Modifié" : "Edited"}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { closeMenu(); onOpenChange(v); }}>
      <SheetContent side="bottom" className="h-[90dvh] flex flex-col p-0">
        {/* Header */}
        <SheetHeader className="px-4 py-3 border-b bg-card flex-shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="w-5 h-5 text-primary flex-shrink-0" />
            <span>{auth.kind === "vendor" ? buyerIdentity.name : vendorName}</span>
          </SheetTitle>
          {listingTitle && (
            <div className="flex items-center gap-2 mt-1.5 bg-primary/10 border border-primary/20 rounded-lg px-3 py-2">
              <ShoppingBag className="w-4 h-4 text-primary flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-primary/70 uppercase tracking-wide leading-none mb-0.5">
                  {lang === "fr" ? "Article concerné" : "Item"}
                </p>
                <p className="text-sm font-semibold text-foreground leading-tight line-clamp-2">
                  {listingTitle}
                </p>
              </div>
            </div>
          )}
        </SheetHeader>

        {/* Fixed context menu — rendered outside scroll container to avoid overflow clipping */}
        {menuMsgId !== null && menuPos && (() => {
          const msg = messages.find((m) => m.id === menuMsgId);
          if (!msg) return null;
          const withinEdit = canEditOrDelete(msg);
          return (
            <div
              style={{ position: "fixed", top: menuPos.top, right: menuPos.right, zIndex: 9999 }}
              className="bg-popover border border-border rounded-xl shadow-lg flex gap-1 p-1"
            >
              {withinEdit && !msg.fileUrl && (
                <button
                  onClick={() => startEdit(msg)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-muted transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  {lang === "fr" ? "Modifier" : "Edit"}
                </button>
              )}
              <button
                onClick={() => deleteMessage(msg.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {lang === "fr" ? "Supprimer" : "Delete"}
              </button>
              <button
                onClick={closeMenu}
                className="flex items-center px-2 py-1.5 rounded-lg text-xs hover:bg-muted transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })()}

        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0"
          onClick={closeMenu}
        >
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full border-2 border-primary border-t-transparent w-6 h-6" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-10">
              {lang === "fr"
                ? "Démarrez la conversation ! Le vendeur vous répondra dès que possible."
                : "Start the conversation! The seller will reply as soon as possible."}
            </div>
          ) : (
            messages.map((m) => renderBubble(m))
          )}
          <div ref={endRef} />
        </div>

        {/* Input bar */}
        {editingId ? (
          /* Edit mode */
          <div className="flex flex-col gap-2 px-4 py-3 border-t bg-amber-50/50 flex-shrink-0">
            <div className="flex items-center gap-1 text-xs text-amber-700 font-medium">
              <Pencil className="w-3.5 h-3.5" />
              {lang === "fr" ? "Modification du message" : "Editing message"}
            </div>
            <div className="flex items-center gap-2">
              <Input
                className="flex-1 rounded-full"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); } }}
                autoFocus
              />
              <Button size="icon" className="rounded-full flex-shrink-0 bg-green-500 hover:bg-green-600" onClick={saveEdit}>
                <Check className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="ghost" className="rounded-full flex-shrink-0" onClick={() => { setEditingId(null); setEditContent(""); }}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ) : (
          /* Normal mode */
          <div className="flex items-center gap-2 px-4 py-3 border-t bg-card flex-shrink-0">
            {/* File attachment */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
              title={lang === "fr" ? "Joindre un fichier" : "Attach a file"}
            >
              {uploading
                ? <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                : <Paperclip className="w-5 h-5" />}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            <Input
              className="flex-1 rounded-full"
              placeholder={lang === "fr" ? "Votre message…" : "Your message…"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
            />
            <Button
              size="icon"
              className="rounded-full flex-shrink-0"
              onClick={sendMessage}
              disabled={!input.trim() || sending}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
