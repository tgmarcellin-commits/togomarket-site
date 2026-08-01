import { useState, useEffect, useRef, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, MessageCircle } from "lucide-react";
import { useSiteSettings } from "@/lib/site-settings";
import { getSocket } from "@/lib/socket";
import type { BuyerIdentity } from "./buyer-identity-prompt";

interface ChatMessage {
  id: number;
  conversationId: number;
  senderType: "buyer" | "vendor";
  content: string;
  createdAt: string;
}

/** Auth credentials — exactly one must be provided */
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

export function ChatWindow({
  open,
  onOpenChange,
  conversationId,
  buyerIdentity,
  vendorName,
  listingTitle,
  auth,
}: ChatWindowProps) {
  const { lang } = useSiteSettings();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchMessages = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        headers: authHeaders(auth),
      });
      if (res.ok) {
        const data = await res.json() as ChatMessage[];
        setMessages(data);
      }
    } finally {
      setLoading(false);
    }
  }, [conversationId, auth]);

  useEffect(() => {
    if (!open || !conversationId) return;
    fetchMessages();
    const socket = getSocket();
    // Include token so server can validate before admitting to the room
    const joinPayload =
      auth.kind === "buyer"
        ? { conversationId, buyerToken: auth.buyerToken }
        : { conversationId, buyerToken: "" }; // vendors reach messages via vendor:{id} room
    socket.emit("join_conv", joinPayload);
    const handler = (data: { conversationId: number; message: ChatMessage }) => {
      if (data.conversationId === conversationId) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
      }
    };
    socket.on("new_message", handler);
    return () => { socket.off("new_message", handler); };
  }, [open, conversationId, fetchMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const selfType = auth.kind === "vendor" ? "vendor" : "buyer";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[90dvh] flex flex-col p-0">
        <SheetHeader className="px-4 py-3 border-b bg-card flex-shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="w-5 h-5 text-primary flex-shrink-0" />
            <span>
              {auth.kind === "vendor" ? buyerIdentity.name : vendorName}
            </span>
          </SheetTitle>
          {listingTitle && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {lang === "fr" ? "Article :" : "Item:"} {listingTitle}
            </p>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
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
            messages.map((msg) => {
              const isSelf = msg.senderType === selfType;
              return (
                <div
                  key={msg.id}
                  className={`flex ${isSelf ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                      isSelf
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted text-foreground rounded-bl-sm"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t bg-card flex-shrink-0">
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
      </SheetContent>
    </Sheet>
  );
}
