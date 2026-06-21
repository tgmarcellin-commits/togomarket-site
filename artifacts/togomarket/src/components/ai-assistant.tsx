import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Bot, X, Send, MessageCircle } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const WHATSAPP_NUMBER = "22870703131";

const WELCOME_MESSAGES: Record<"fr" | "en", string> = {
  fr: "Bonjour ! 👋 Je suis l'assistante virtuelle de TogoMarket. Comment puis-je vous aider ?",
  en: "Hello! 👋 I'm TogoMarket's virtual assistant. How can I help you?",
};

const PLACEHOLDERS: Record<"fr" | "en", string> = {
  fr: "Posez votre question...",
  en: "Ask your question...",
};

const TITLES: Record<"fr" | "en", string> = {
  fr: "Assistante TogoMarket",
  en: "TogoMarket Assistant",
};

const SUBTITLES: Record<"fr" | "en", string> = {
  fr: "En ligne · Répond instantanément",
  en: "Online · Replies instantly",
};

const ERROR_MSGS: Record<"fr" | "en", string> = {
  fr: "Une erreur s'est produite. Réessayez ou contactez le support.",
  en: "An error occurred. Please retry or contact support.",
};

const WHATSAPP_LABELS: Record<"fr" | "en", string> = {
  fr: "💬 Contacter le support WhatsApp",
  en: "💬 Contact WhatsApp support",
};

interface Props {
  lang: "fr" | "en";
}

export function AiAssistant({ lang }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [unread, setUnread] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ role: "assistant", content: WELCOME_MESSAGES[lang] }]);
    }
  }, [open, lang, messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  useEffect(() => {
    if (open) {
      setUnread(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    setOpen(false);
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);

    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages([...newMessages, assistantMsg]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error("Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const json = JSON.parse(line.slice(6));
            if (json.content) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "assistant") {
                  updated[updated.length - 1] = {
                    ...last,
                    content: last.content + json.content,
                  };
                }
                return updated;
              });
            }
          } catch {}
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant" && last.content === "") {
          updated[updated.length - 1] = {
            ...last,
            content: ERROR_MSGS[lang],
          };
        }
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  }, [input, messages, streaming, lang]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage]
  );

  const openWhatsApp = () => {
    window.open(`https://wa.me/${WHATSAPP_NUMBER}`, "_blank");
  };

  return (
    <>
      {/* ── FLOATING BUTTON ───────────────────────────────────────────── */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Assistant virtuel"
        className="fixed bottom-24 right-4 z-40 w-14 h-14 rounded-full bg-primary text-white shadow-2xl flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95"
        style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.22)" }}
      >
        {open ? (
          <X className="w-6 h-6" />
        ) : (
          <>
            <Bot className="w-7 h-7" />
            {unread && (
              <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white" />
            )}
          </>
        )}
      </button>

      {/* ── CHAT PANEL ────────────────────────────────────────────────── */}
      <div
        className={`fixed bottom-40 right-4 z-40 w-[calc(100vw-2rem)] max-w-sm bg-white rounded-2xl shadow-2xl flex flex-col transition-all duration-300 origin-bottom-right ${
          open
            ? "opacity-100 scale-100 pointer-events-auto"
            : "opacity-0 scale-95 pointer-events-none"
        }`}
        style={{ maxHeight: "70vh", minHeight: "400px" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-primary rounded-t-2xl text-white shrink-0">
          <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
            <Bot className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-tight">{TITLES[lang]}</p>
            <p className="text-xs text-white/75 leading-tight">{SUBTITLES[lang]}</p>
          </div>
          <button
            onClick={handleClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2" style={{ overscrollBehavior: "contain" }}>
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center mr-1.5 mt-1 shrink-0">
                  <Bot className="w-3.5 h-3.5 text-primary" />
                </div>
              )}
              <div
                className={`max-w-[82%] px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-primary text-white rounded-br-sm"
                    : "bg-gray-100 text-gray-800 rounded-bl-sm"
                }`}
              >
                {msg.content}
                {msg.role === "assistant" && msg.content === "" && streaming && (
                  <span className="inline-flex gap-1 ml-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* WhatsApp shortcut */}
        <div className="px-3 pb-1 shrink-0">
          <button
            onClick={openWhatsApp}
            className="w-full text-xs text-green-700 bg-green-50 hover:bg-green-100 transition-colors rounded-xl py-2 flex items-center justify-center gap-1.5 font-medium"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            {WHATSAPP_LABELS[lang]}
          </button>
        </div>

        {/* Input */}
        <div className="flex items-end gap-2 px-3 py-3 border-t border-gray-100 shrink-0">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={PLACEHOLDERS[lang]}
            rows={1}
            disabled={streaming}
            className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50 leading-relaxed"
            style={{ maxHeight: "80px", overflowY: "auto" }}
          />
          <Button
            onClick={sendMessage}
            disabled={!input.trim() || streaming}
            size="icon"
            className="w-9 h-9 rounded-xl shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </>
  );
}
