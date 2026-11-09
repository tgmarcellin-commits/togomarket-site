import { useState } from "react";
import { openWhatsApp } from "@/lib/whatsapp";
import { resolveImageUrl, isVideoMedia, resolveMediaUrl } from "@/lib/image";
import type { Listing } from "@workspace/api-client-react";
import { useAdminDeleteListing, getGetListingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { MapPin, Phone, Trash2, Clock, ZoomIn, MessageCircle, Star, Pin } from "lucide-react";
import { ListingReviews } from "@/components/listing-reviews";
import { useAdminPinListing } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageViewer } from "@/components/image-viewer";
import { useSiteSettings } from "@/lib/site-settings";
import { useT } from "@/lib/i18n";
import { BuyerIdentityPrompt, loadBuyerIdentity } from "@/components/buyer-identity-prompt";
import { ChatWindow } from "@/components/chat-window";
import type { BuyerIdentity } from "@/components/buyer-identity-prompt";
import {
  storeBuyerSession,
  getBuyerSession,
  getAllBuyerSessions,
  getOrCreateBuyerKey,
  removeBuyerSession,
  BUYER_SESSION_TTL_MS,
} from "@/components/buyer-inbox";

/** Slide dans le carrousel d'une annonce — vidéo avec controls si nécessaire, image sinon. */
function ListingMediaSlide({ path, alt, onClick }: { path: string; alt: string; onClick?: () => void }) {
  const [isVid, setIsVid] = useState(isVideoMedia(path));
  if (isVid) {
    return (
      <div className="w-full h-full snap-center flex-shrink-0 bg-black flex items-center justify-center relative">
        <video
          src={resolveMediaUrl(path)}
          controls
          playsInline
          className="w-full h-full object-cover"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    );
  }
  return (
    <img
      src={resolveImageUrl(path)}
      alt={alt}
      className="w-full h-full object-cover snap-center flex-shrink-0 cursor-zoom-in"
      onClick={onClick}
      onError={() => setIsVid(true)}
    />
  );
}

/** Per-listing chat session key in localStorage — keyed by vendorId+listingId, not by phone */
function chatSessionKey(vendorId: number, listingId: number) {
  return `tm_chat_${vendorId}_${listingId}`;
}
interface StoredChatSession { convId: number; buyerToken: string; expiresAt?: number }
function storeChatSession(vendorId: number, listingId: number, convId: number, buyerToken: string) {
  try {
    localStorage.setItem(chatSessionKey(vendorId, listingId), JSON.stringify({
      convId,
      buyerToken,
      expiresAt: Date.now() + BUYER_SESSION_TTL_MS,
    }));
  } catch {}
}
function loadChatSession(vendorId: number, listingId: number): StoredChatSession | null {
  try {
    const raw = localStorage.getItem(chatSessionKey(vendorId, listingId));
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredChatSession;
    const expiresAt = stored.expiresAt ?? Date.now() + BUYER_SESSION_TTL_MS;
    if (!stored.convId || !stored.buyerToken || expiresAt <= Date.now()) {
      localStorage.removeItem(chatSessionKey(vendorId, listingId));
      return null;
    }
    if (!stored.expiresAt) {
      localStorage.setItem(
        chatSessionKey(vendorId, listingId),
        JSON.stringify({ ...stored, expiresAt }),
      );
    }
    return { ...stored, expiresAt };
  } catch { return null; }
}

interface ListingCardProps {
  listing: Listing;
  isAdmin: boolean;
  adminPassword?: string;
  commissionRate: number;
  whatsappCommission: string;
  isOwn?: boolean;
  /** When provided: redirect to Messages tab instead of opening floating ChatWindow */
  onOpenInMessages?: (convId: number) => void;
}

const sectorColors: Record<string, string> = {
  AgriMarket: "bg-primary text-primary-foreground",
  Immobilier: "bg-blue-500 text-white",
  Automobile: "bg-accent text-accent-foreground",
  Divers: "bg-secondary text-secondary-foreground",
};

export function ListingCard({ listing, isAdmin, adminPassword, commissionRate, whatsappCommission, isOwn, onOpenInMessages }: ListingCardProps) {
  const { lang } = useSiteSettings();
  const t = useT(lang);
  const queryClient = useQueryClient();
  const deleteMutation = useAdminDeleteListing();
  const pinMutation = useAdminPinListing();
  const [pinnedState, setPinnedState] = useState<boolean>(listing.pinned ?? false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [identityPromptOpen, setIdentityPromptOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [buyerIdentity, setBuyerIdentity] = useState<BuyerIdentity | null>(null);
  const [buyerToken, setBuyerToken] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [avgRating, setAvgRating] = useState<number | null>(listing.avgRating ?? null);
  const [reviewCount, setReviewCount] = useState<number>(listing.reviewCount ?? 0);

  const dateLocale = lang === "fr" ? "fr-FR" : "en-US";

  function formatDate(iso: string) {
    return new Intl.DateTimeFormat(dateLocale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  }

  const openViewer = (index: number) => {
    setViewerIndex(index);
    setViewerOpen(true);
  };

  const handleDelete = () => {
    if (!isAdmin) return;
    let pwd = adminPassword;
    if (!pwd) {
      const entered = window.prompt("Mot de passe administrateur :");
      if (!entered) return;
      pwd = entered;
    }
    if (confirm(t.deleteListingTitle)) {
      deleteMutation.mutate(
        { data: { id: listing.id, password: pwd } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetListingsQueryKey() });
          },
        }
      );
    }
  };

  const handlePin = () => {
    if (!isAdmin) return;
    let pwd = adminPassword;
    if (!pwd) {
      const entered = window.prompt("Mot de passe administrateur :");
      if (!entered) return;
      pwd = entered;
    }
    pinMutation.mutate(
      { data: { id: listing.id, password: pwd } },
      {
        onSuccess: (updated) => {
          setPinnedState(updated.pinned ?? false);
          queryClient.invalidateQueries({ queryKey: getGetListingsQueryKey() });
        },
      }
    );
  };

  const handleReport = () => {
    const message = lang === "fr"
      ? `🚨 Signalement d'article sur TogoMarket\n\nTitre: ${listing.name}\nPrix: ${new Intl.NumberFormat("fr-FR").format(listing.price)} FCFA\nLocalisation: ${listing.location}\nSecteur: ${listing.sector}\nLien: ${window.location.href}`
      : `🚨 Item report on TogoMarket\n\nTitle: ${listing.name}\nPrice: ${new Intl.NumberFormat("fr-FR").format(listing.price)} FCFA\nLocation: ${listing.location}\nSector: ${listing.sector}\nLink: ${window.location.href}`;
    openWhatsApp(`https://wa.me/${whatsappCommission}?text=${encodeURIComponent(message)}`);
  };

  /**
   * Partage de l'article sur WhatsApp : image + titre + prix + heure + lieu, avec un lien
   * sous l'image qui ouvre directement l'article sur TogoMarket (page /a/:id).
   * 1) Mobile : partage natif avec l'image en fichier (WhatsApp affiche l'image, le texte en légende).
   * 2) Repli : lien wa.me avec le même texte ; l'aperçu du lien (image, titre, prix) vient des balises OG de /a/:id.
   */
  const handleShareWhatsApp = async () => {
    if (shareLoading) return;
    setShareLoading(true);
    const shareUrl = `${window.location.origin}/a/${listing.id}`;
    const shownPrice = new Intl.NumberFormat("fr-FR").format(listing.promoPrice ?? listing.price);
    const text = [
      `🛍️ *${listing.name}*`,
      `💰 ${shownPrice} FCFA`,
      ...(listing.createdAt ? [`🕒 ${formatDate(listing.createdAt)}`] : []),
      `📍 ${listing.location} — ${listing.country ?? "Togo"}`,
      "",
      lang === "fr" ? "👉 Voir l'article et discuter avec le vendeur :" : "👉 View the item and chat with the seller:",
      shareUrl,
    ].join("\n");

    try {
      const firstImage = listing.images?.find((img) => !isVideoMedia(img));
      if (firstImage && typeof navigator.share === "function" && typeof navigator.canShare === "function") {
        const resp = await fetch(resolveImageUrl(firstImage));
        if (resp.ok) {
          const blob = await resp.blob();
          const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
          const file = new File([blob], `togomarket-${listing.id}.${ext}`, { type: blob.type || "image/jpeg" });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], text });
            return;
          }
        }
      }
    } catch (err) {
      // L'utilisateur a fermé la fenêtre de partage : on s'arrête là.
      if (err instanceof DOMException && err.name === "AbortError") {
        setShareLoading(false);
        return;
      }
      // Autre erreur (image inaccessible, partage non supporté…) : repli wa.me ci-dessous.
    }
    try {
      openWhatsApp(`https://wa.me/?text=${encodeURIComponent(text)}`);
    } finally {
      setShareLoading(false);
    }
  };

  /** Create or resume a conversation then open it (floating window or redirect). */
  const startChat = async (identity: BuyerIdentity | null) => {
    if (chatLoading) return;
    setBuyerIdentity(identity);
    setChatLoading(true);
    setChatError(null);

    const vid = listing.vendorId ?? 0;
    const lid = listing.id;
    const stored = vid ? getBuyerSession(vid, lid) ?? loadChatSession(vid, lid) : null;

    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          vendorId: vid,
          buyerName: identity?.name,
          buyerPhone: identity?.phone,
          buyerKey: identity ? getOrCreateBuyerKey(identity) : undefined,
          conversationId: stored?.convId,
          resumeBuyerToken: stored?.buyerToken,
          knownBuyerTokens: getAllBuyerSessions()
            .filter((session) => session.vendorId === vid)
            .map((session) => session.buyerToken),
          listingTitle: listing.name,
          listingId: lid,
        }),
      });
      const payload = await res.json().catch(() => null) as {
        id?: number;
        buyerToken?: string;
        error?: string;
        message?: string;
      } | null;
      if (!res.ok || !payload?.id || !payload.buyerToken) {
        const requireBuyerIdentity = !identity && (
          payload?.error === "buyer identity required" ||
          payload?.error === "buyerKey required"
        );
        if (requireBuyerIdentity) {
          setIdentityPromptOpen(true);
          return;
        }
        const fallback = lang === "fr"
          ? "Impossible d’ouvrir la discussion. Réessayez."
          : "Unable to open the conversation. Please try again.";
        setChatError(payload?.message ?? fallback);
        return;
      }

      const conv = { id: payload.id, buyerToken: payload.buyerToken };
      if (vid) {
        storeBuyerSession({
          convId: conv.id,
          buyerToken: conv.buyerToken,
          vendorId: vid,
          listingId: lid,
          listingTitle: listing.name,
        });
      }
      if (onOpenInMessages) {
        onOpenInMessages(conv.id);
      } else {
        setConversationId(conv.id);
        setBuyerToken(conv.buyerToken);
        setChatOpen(true);
      }
    } catch {
      setChatError(lang === "fr"
        ? "La connexion a échoué. Vérifiez votre réseau puis réessayez."
        : "Connection failed. Check your network and try again.");
    } finally {
      setChatLoading(false);
    }
  };

  const handleContactVendor = () => {
    const existingIdentity = loadBuyerIdentity();
    if (existingIdentity) {
      startChat(existingIdentity);
      return;
    }

    setIdentityPromptOpen(true);
  };

  const handleIdentityConfirm = (identity: BuyerIdentity) => {
    setIdentityPromptOpen(false);
    startChat(identity);
  };

  const vendorDisplayName = listing.sector || "Vendeur";
  const listingImage = listing.images?.find((image) => !isVideoMedia(image)) ?? null;

  return (
    <>
    <div className="group rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col h-full hover:shadow-md transition-all">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-black group/img">
        <div className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-hide">
          {listing.images && listing.images.length > 0 ? (
            listing.images.map((img, i) => (
              <ListingMediaSlide
                key={i}
                path={img}
                alt={`${listing.name} ${i + 1}`}
                onClick={() => openViewer(i)}
              />
            ))
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              {t.noImage}
            </div>
          )}
        </div>

        {listing.images && listing.images.length > 0 && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity pointer-events-none">
            <div className="bg-black/40 rounded-full p-2">
              <ZoomIn className="w-6 h-6 text-white" />
            </div>
          </div>
        )}

        <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
          <Badge className={`border-none ${sectorColors[listing.sector] || "bg-gray-500"}`}>
            {listing.sector}
          </Badge>
          {isOwn && (
            <Badge className="border-none bg-white/90 text-foreground text-[10px] font-bold shadow-sm">
              {t.myListing}
            </Badge>
          )}
        </div>
        {listing.images && listing.images.length > 1 && (
          <div className="absolute top-2 right-2 z-10 bg-black/60 text-white rounded-md px-1.5 py-0.5 text-[11px] font-medium flex items-center gap-1">
            <span>📷</span>
            <span>+{listing.images.length - 1}</span>
          </div>
        )}
        <button
          onClick={handleReport}
          className="absolute bottom-2 right-2 z-10 bg-white/80 hover:bg-white text-red-500 rounded-md px-2 py-1 text-[11px] font-medium shadow transition-colors"
        >
          {t.reportListing}
        </button>
        {pinnedState && (
          <div className="absolute top-2 left-2 z-10 bg-red-600 text-white rounded-full p-1 shadow-md" title="Annonce épinglée">
            <Pin className="w-3.5 h-3.5 fill-white" />
          </div>
        )}
        {(reviewCount > 0) && (
          <button
            onClick={() => openViewer(0)}
            className={`absolute bottom-2 left-2 z-10 bg-black/60 hover:bg-black/75 text-white rounded-md px-1.5 py-0.5 text-[11px] font-medium flex items-center gap-1 transition-colors`}
            title="Voir les avis"
          >
            {avgRating != null && (
              <span className="flex items-center gap-0.5">
                <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                {avgRating.toFixed(1)}
              </span>
            )}
            <span className="flex items-center gap-0.5">💬 {reviewCount}</span>
          </button>
        )}
      </div>

      <div className="p-4 flex flex-col flex-grow">
        <h3
          className={`font-semibold text-lg cursor-pointer ${titleExpanded ? "" : "line-clamp-2"}`}
          onClick={() => setTitleExpanded(e => !e)}
          title={titleExpanded ? t.collapseTitle : t.expandTitle}
        >
          {listing.name}
        </h3>
        {listing.promoPrice != null ? (
          <div className="mt-1 mb-1 flex items-baseline gap-2 flex-wrap">
            <span className="text-xl font-bold text-red-600">
              {new Intl.NumberFormat("fr-FR").format(listing.promoPrice)} FCFA
            </span>
            <span className="text-sm font-medium text-muted-foreground line-through">
              {new Intl.NumberFormat("fr-FR").format(listing.price)} FCFA
            </span>
            <span className="text-[10px] bg-red-100 text-red-700 rounded-full px-1.5 py-0.5 font-bold">PROMO</span>
          </div>
        ) : (
          <div className="text-xl font-bold text-primary mt-1 mb-1">
            {new Intl.NumberFormat("fr-FR").format(listing.price)} FCFA
          </div>
        )}

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center text-muted-foreground text-xs mb-1">
              <Clock className="w-3.5 h-3.5 mr-1 flex-shrink-0" />
              <span>{listing.createdAt ? formatDate(listing.createdAt) : ""}</span>
            </div>

            <div className="flex items-center text-muted-foreground text-sm">
              <MapPin className="w-4 h-4 mr-1 flex-shrink-0" />
              <span className="truncate">{listing.location} — {listing.country ?? "Togo"}</span>
            </div>
          </div>
          {/* Partage WhatsApp : image + titre + prix + heure + lieu + lien direct vers l'article */}
          <button
            type="button"
            onClick={handleShareWhatsApp}
            disabled={shareLoading}
            title={t.shareViaWhatsApp}
            aria-label={t.shareViaWhatsApp}
            className="flex-shrink-0 w-11 h-11 rounded-full bg-[#25D366] hover:bg-[#1eb355] active:scale-95 disabled:opacity-60 transition-all shadow-sm flex items-center justify-center"
          >
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
          </button>
        </div>

        <div className="mt-auto space-y-3">
          <div className="text-[10px] text-destructive font-medium uppercase tracking-wider text-center bg-destructive/10 py-1.5 rounded">
            {t.warningNoPay}
          </div>

          <Button
            onClick={handleContactVendor}
            disabled={chatLoading}
            className="w-full bg-accent hover:bg-accent/90 text-accent-foreground text-sm gap-2"
          >
            <MessageCircle className="w-4 h-4" />
            {chatLoading ? (lang === "fr" ? "Ouverture…" : "Opening…") : t.contactVendor}
          </Button>
          {chatError && (
            <p role="alert" className="text-xs text-destructive text-center">
              {chatError}
            </p>
          )}

          {isAdmin && (
            <div className="pt-3 mt-3 border-t border-border space-y-2">
              <div className="flex items-center text-sm font-medium text-foreground">
                <Phone className="w-4 h-4 mr-2 text-muted-foreground" />
                {listing.phone || t.notSpecified}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={pinnedState ? "default" : "outline"}
                  size="sm"
                  onClick={handlePin}
                  disabled={pinMutation.isPending}
                  className={pinnedState ? "bg-red-600 hover:bg-red-700 text-white border-0 flex-1" : "flex-1 border-red-300 text-red-600 hover:bg-red-50"}
                >
                  <Pin className={`w-4 h-4 mr-1 ${pinnedState ? "fill-white" : ""}`} />
                  {pinnedState ? "Désépingler" : "Épingler en tête"}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  {t.delete}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    {viewerOpen && listing.images && listing.images.length > 0 && (
      <ImageViewer
        images={listing.images}
        startIndex={viewerIndex}
        onClose={() => setViewerOpen(false)}
        footer={
          <div className="space-y-3">
            <div>
              <h3 className="text-white font-bold text-base">{listing.name}</h3>
              <div className="flex items-baseline gap-2 mt-0.5">
                {listing.promoPrice != null ? (
                  <>
                    <span className="text-red-400 font-bold text-sm">
                      {new Intl.NumberFormat("fr-FR").format(listing.promoPrice)} FCFA
                    </span>
                    <span className="text-white/50 text-xs line-through">
                      {new Intl.NumberFormat("fr-FR").format(listing.price)} FCFA
                    </span>
                  </>
                ) : (
                  <span className="text-white font-semibold text-sm">
                    {new Intl.NumberFormat("fr-FR").format(listing.price)} FCFA
                  </span>
                )}
              </div>
              {listing.description && (
                <p className="text-white/80 text-xs mt-1.5 whitespace-pre-wrap break-words">{listing.description}</p>
              )}
            </div>
            <ListingReviews
              listingId={listing.id}
              isAdmin={isAdmin}
              adminPassword={adminPassword}
              onStatsChange={(avg, count) => { setAvgRating(avg); setReviewCount(count); }}
            />
          </div>
        }
      />
    )}

    <BuyerIdentityPrompt
      open={identityPromptOpen}
      onOpenChange={setIdentityPromptOpen}
      onConfirm={handleIdentityConfirm}
      defaultName={loadBuyerIdentity()?.name ?? ""}
      defaultPhone={loadBuyerIdentity()?.phone ?? ""}
    />

    {chatOpen && conversationId !== null && buyerIdentity && buyerToken && (
      <ChatWindow
        open={chatOpen}
        onOpenChange={setChatOpen}
        conversationId={conversationId}
        buyerIdentity={buyerIdentity}
        vendorName={vendorDisplayName}
        listingTitle={listing.name}
        listingImage={listingImage}
        auth={{ kind: "buyer", buyerToken }}
        showAssignDriver
        onConversationDeleted={() => {
          const vid = listing.vendorId ?? 0;
          if (vid) {
            try { localStorage.removeItem(`tm_chat_${vid}_${listing.id}`); } catch {}
          }
          removeBuyerSession(conversationId ?? 0);
          setConversationId(null);
          setBuyerToken(null);
          setChatOpen(false);
        }}
        onConversationUnavailable={() => {
          const vid = listing.vendorId ?? 0;
          if (vid) {
            try { localStorage.removeItem(chatSessionKey(vid, listing.id)); } catch {}
          }
          removeBuyerSession(conversationId ?? 0);
        }}
      />
    )}
    </>
  );
}
