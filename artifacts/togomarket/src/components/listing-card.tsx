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
import { BuyerIdentityPrompt, loadBuyerIdentity, normalizePhone } from "@/components/buyer-identity-prompt";
import { ChatWindow } from "@/components/chat-window";
import type { BuyerIdentity } from "@/components/buyer-identity-prompt";
import { storeBuyerSession, getBuyerSession } from "@/components/buyer-inbox";

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
          className="w-full h-full object-contain"
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
interface StoredChatSession { convId: number; buyerToken: string }
function storeChatSession(vendorId: number, listingId: number, convId: number, buyerToken: string) {
  try {
    localStorage.setItem(chatSessionKey(vendorId, listingId), JSON.stringify({ convId, buyerToken }));
  } catch {}
}
function loadChatSession(vendorId: number, listingId: number): StoredChatSession | null {
  try {
    const raw = localStorage.getItem(chatSessionKey(vendorId, listingId));
    return raw ? (JSON.parse(raw) as StoredChatSession) : null;
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
      ? `🚨 Signalement d'article sur TogoMarket\n\nTitre: ${listing.name}\nPrix: ${new Intl.NumberFormat("fr-FR").format(listing.price)} FCFA\nLocalisation: ${listing.location}\nSecteur: ${listing.sector}\nID: #${listing.id}\n\nMerci de vérifier cet article.`
      : `🚨 Item report on TogoMarket\n\nTitle: ${listing.name}\nPrice: ${new Intl.NumberFormat("fr-FR").format(listing.price)} FCFA\nLocation: ${listing.location}\nSector: ${listing.sector}\nID: #${listing.id}\n\nPlease review this item.`;
    openWhatsApp(`https://wa.me/${whatsappCommission}?text=${encodeURIComponent(message)}`);
  };

  /** Create or resume a conversation then open it (floating window or redirect). */
  const startChat = async (identity: BuyerIdentity) => {
    setBuyerIdentity(identity);

    const vid = listing.vendorId ?? 0;
    const lid = listing.id;
    const stored = vid ? loadChatSession(vid, lid) : null;

    // Resume previous session only if the phone matches the stored buyer
    const storedIdentity = loadBuyerIdentity();
    const samePhone = stored && storedIdentity &&
      normalizePhone(storedIdentity.phone) === normalizePhone(identity.phone);

    if (samePhone && stored) {
      // Also ensure this session is in the new BuyerInbox store
      if (vid) {
        const inboxSession = getBuyerSession(vid, lid);
        if (!inboxSession) {
          storeBuyerSession({ convId: stored.convId, buyerToken: stored.buyerToken, vendorId: vid, listingId: lid, listingTitle: listing.name });
        }
      }
      if (onOpenInMessages) {
        onOpenInMessages(stored.convId);
      } else {
        setConversationId(stored.convId);
        setBuyerToken(stored.buyerToken);
        setChatOpen(true);
      }
      return;
    }

    // Different person or no previous session → create a new conversation
    setChatLoading(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: vid,
          buyerName: identity.name,
          buyerPhone: identity.phone,
          listingTitle: listing.name,
          listingId: lid,
        }),
      });
      if (res.ok) {
        const conv = await res.json() as { id: number; buyerToken: string };
        // Store in both legacy key and new BuyerInbox store
        storeChatSession(vid, lid, conv.id, conv.buyerToken);
        if (vid) {
          storeBuyerSession({ convId: conv.id, buyerToken: conv.buyerToken, vendorId: vid, listingId: lid, listingTitle: listing.name });
        }
        if (onOpenInMessages) {
          onOpenInMessages(conv.id);
        } else {
          setConversationId(conv.id);
          setBuyerToken(conv.buyerToken);
          setChatOpen(true);
        }
      }
    } finally {
      setChatLoading(false);
    }
  };

  const handleContactVendor = () => {
    const existingIdentity = loadBuyerIdentity();
    // If buyer is already identified AND caller wants redirect → skip the prompt
    if (existingIdentity && onOpenInMessages) {
      startChat(existingIdentity);
    } else {
      // Show the identity form (pre-filled for returning buyers without redirect)
      setIdentityPromptOpen(true);
    }
  };

  const handleIdentityConfirm = (identity: BuyerIdentity) => {
    setIdentityPromptOpen(false);
    startChat(identity);
  };

  const vendorDisplayName = listing.sector || "Vendeur";

  return (
    <>
    <div className="group rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col h-full hover:shadow-md transition-all">
      <div className="relative aspect-video w-full overflow-hidden bg-black group/img">
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

        <div className="flex items-center text-muted-foreground text-xs mb-1">
          <Clock className="w-3.5 h-3.5 mr-1 flex-shrink-0" />
          <span>{listing.createdAt ? formatDate(listing.createdAt) : ""}</span>
        </div>

        <div className="flex items-center text-muted-foreground text-sm mb-4">
          <MapPin className="w-4 h-4 mr-1 flex-shrink-0" />
          <span className="truncate">{listing.location} — {listing.country ?? "Togo"}</span>
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
        auth={{ kind: "buyer", buyerToken }}
        onConversationDeleted={() => {
          // Clear the stored session so the buyer won't re-open this deleted conversation
          const vid = listing.vendorId ?? 0;
          if (vid) {
            try { localStorage.removeItem(`tm_chat_${vid}_${listing.id}`); } catch {}
          }
          setConversationId(null);
          setBuyerToken(null);
          setChatOpen(false);
        }}
      />
    )}
    </>
  );
}
