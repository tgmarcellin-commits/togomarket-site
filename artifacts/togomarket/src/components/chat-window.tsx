import { useState, useEffect, useRef, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Send, MessageCircle, ShoppingBag, Paperclip,
  Pencil, Trash2, X, Check, FileText, Eraser, Mic, StopCircle,
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
  /** Called after the current user successfully deletes their copy of the conversation */
  onConversationDeleted?: () => void;
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
  onConversationDeleted,
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
  const [confirmDeleteConv, setConfirmDeleteConv] = useState(false);
  const [deletingConv, setDeletingConv] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selfType = auth.kind === "vendor" ? "vendor" : "buyer";

  const scrollToBottom = () => endRef.current?.scrollIntoView({ behavior: "smooth" });

  // ── Keyboard scroll fix ────────────────────────────────────────────────────
  // When the soft keyboard opens on mobile the scroll area can jump. We save
  // the scrollTop just before the keyboard appears and restore it afterwards
  // so the user stays at whatever position they were reading.
  const handleInputFocus = useCallback(() => {
    const area = scrollAreaRef.current;
    if (!area) return;
    const saved = area.scrollTop;
    setTimeout(() => { if (area) area.scrollTop = saved; }, 400);
  }, []);

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

  // ── Voice recording ────────────────────────────────────────────────────────
  const startRecording = async () => {
    if (uploading || sending) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const actualMime = mediaRecorder.mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: actualMime });
        const ext = actualMime.includes("ogg") ? "ogg" : actualMime.includes("mp4") ? "mp4" : "webm";
        await uploadAudioBlob(blob, ext);
      };

      mediaRecorder.start(250);
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => setRecordingDuration((d) => d + 1), 1000);
    } catch {
      /* microphone access denied — ignore silently */
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setIsRecording(false);
      setRecordingDuration(0);
    }
  };

  const uploadAudioBlob = async (blob: Blob, ext: string) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", blob, `audio.${ext}`);
      const res = await fetch(`/api/conversations/${conversationId}/upload`, {
        method: "POST",
        headers: authHeaders(auth),
        body: formData,
      });
      if (res.ok) {
        const msg = await res.json() as ChatMessage;
        setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
      }
    } finally {
      setUploading(false);
    }
  };

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

  // ── Delete conversation (own side only) ───────────────────────────────────
  const deleteConversation = async () => {
    setDeletingConv(true);
    try {
      const url = auth.kind === "vendor"
        ? `/api/vendor/conversations/${conversationId}`
        : `/api/conversations/${conversationId}`;
      const res = await fetch(url, { method: "DELETE", headers: authHeaders(auth) });
      if (res.ok) {
        onConversationDeleted?.();
        onOpenChange(false);
      }
    } finally {
      setDeletingConv(false);
      setConfirmDeleteConv(false);
    }
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

          {/* Audio */}
          {msg.fileUrl && msg.fileType === "audio" && (
            <div className="px-3 py-2.5">
              <audio
                controls
                src={resolveImageUrl(msg.fileUrl)}
                className="h-10 max-w-[220px]"
              />
            </div>
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
          {/* pr-8 reserves space for the Sheet's built-in ✕ close button */}
          <SheetTitle className="flex items-center gap-2 text-base pr-8">
            <MessageCircle className="w-5 h-5 text-primary flex-shrink-0" />
            <span className="flex-1 min-w-0 truncate">
              {auth.kind === "vendor" ? buyerIdentity.name : vendorName}
            </span>
            {/* Delete conversation — own side only; sits LEFT of the Sheet close button */}
            {!confirmDeleteConv ? (
              <button
                onClick={() => setConfirmDeleteConv(true)}
                className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title={lang === "fr" ? "Supprimer ma copie" : "Delete my copy"}
              >
                <Eraser className="w-4 h-4" />
              </button>
            ) : (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-xs text-destructive font-medium whitespace-nowrap">
                  {lang === "fr" ? "Supprimer ?" : "Delete?"}
                </span>
                <button
                  onClick={deleteConversation}
                  disabled={deletingConv}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-destructive text-white disabled:opacity-50"
                >
                  {lang === "fr" ? "Oui" : "Yes"}
                </button>
                <button
                  onClick={() => setConfirmDeleteConv(false)}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-muted text-foreground"
                >
                  {lang === "fr" ? "Non" : "No"}
                </button>
              </div>
            )}
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
          ref={scrollAreaRef}
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
          <>
            {isRecording && (
              <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border-t border-red-100 flex-shrink-0">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs font-medium text-red-600">
                  {String(Math.floor(recordingDuration / 60)).padStart(2, "0")}:{String(recordingDuration % 60).padStart(2, "0")}
                </span>
                <span className="text-xs text-red-400 flex-1">
                  {lang === "fr" ? "Enregistrement…" : "Recording…"}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 px-4 py-3 border-t bg-card flex-shrink-0">
              {/* File attachment */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || isRecording}
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
                onFocus={handleInputFocus}
                disabled={sending || isRecording}
              />
              {/* Voice message button */}
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={uploading || sending}
                className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 ${
                  isRecording
                    ? "bg-red-500 text-white hover:bg-red-600"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                title={isRecording
                  ? (lang === "fr" ? "Arrêter l'enregistrement" : "Stop recording")
                  : (lang === "fr" ? "Message vocal" : "Voice message")}
              >
                {isRecording ? <StopCircle className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
              <Button
                size="icon"
                className="rounded-full flex-shrink-0"
                onClick={sendMessage}
                disabled={!input.trim() || sending || isRecording}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
