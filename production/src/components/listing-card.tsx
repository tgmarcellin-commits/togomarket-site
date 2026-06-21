import { useState } from "react";
import { openWhatsApp } from "@/lib/whatsapp";
import { resolveImageUrl } from "@/lib/image";
import type { Listing } from "@workspace/api-client-react";
import { useAdminDeleteListing, getGetListingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { MapPin, Phone, Trash2, Clock, ZoomIn } from "lucide-react";
import { ContactUnlockModal } from "@/components/contact-unlock-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageViewer } from "@/components/image-viewer";
import { useSiteSettings } from "@/lib/site-settings";
import { useT } from "@/lib/i18n";

interface ListingCardProps {
  listing: Listing;
  isAdmin: boolean;
  adminPassword?: string;
  commissionRate: number;
  whatsappCommission: string;
  isOwn?: boolean;
}

const sectorColors: Record<string, string> = {
  AgriMarket: "bg-primary text-primary-foreground",
  Immobilier: "bg-blue-500 text-white",
  Automobile: "bg-accent text-accent-foreground",
  Divers: "bg-secondary text-secondary-foreground",
};

function calcCommission(price: number, rate: number): number {
  if (rate === 0) return 0;
  return Math.round(Math.min(price, 100000) * rate / 100);
}

export function ListingCard({ listing, isAdmin, adminPassword, commissionRate, whatsappCommission, isOwn }: ListingCardProps) {
  const { lang } = useSiteSettings();
  const t = useT(lang);
  const queryClient = useQueryClient();
  const deleteMutation = useAdminDeleteListing();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);

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
    if (!adminPassword || !isAdmin) return;
    if (confirm(t.deleteListingTitle)) {
      deleteMutation.mutate(
        { data: { id: listing.id, password: adminPassword } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetListingsQueryKey() });
          },
        }
      );
    }
  };

  const commission = calcCommission(listing.price, commissionRate);

  const handleReport = () => {
    const message = lang === "fr"
      ? `🚨 Signalement d'article sur TogoMarket\n\nTitre: ${listing.name}\nPrix: ${new Intl.NumberFormat("fr-FR").format(listing.price)} FCFA\nLocalisation: ${listing.location}\nSecteur: ${listing.sector}\nID: #${listing.id}\n\nMerci de vérifier cet article.`
      : `🚨 Item report on TogoMarket\n\nTitle: ${listing.name}\nPrice: ${new Intl.NumberFormat("fr-FR").format(listing.price)} FCFA\nLocation: ${listing.location}\nSector: ${listing.sector}\nID: #${listing.id}\n\nPlease review this item.`;
    openWhatsApp(`https://wa.me/${whatsappCommission}?text=${encodeURIComponent(message)}`);
  };

  const unlockLabel = commissionRate === 0 ? t.unlockFree : t.unlockPaid(commission);

  return (
    <>
    <div className="group rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col h-full hover:shadow-md transition-all">
      <div className="relative aspect-video w-full overflow-hidden bg-black group/img">
        <div className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-hide">
          {listing.images && listing.images.length > 0 ? (
            listing.images.map((img, i) => (
              <img
                key={i}
                src={resolveImageUrl(img)}
                alt={`${listing.name} ${i + 1}`}
                className="w-full h-full object-contain snap-center flex-shrink-0 cursor-zoom-in"
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
        <button
          onClick={handleReport}
          className="absolute bottom-2 right-2 z-10 bg-white/80 hover:bg-white text-red-500 rounded-md px-2 py-1 text-[11px] font-medium shadow transition-colors"
        >
          {t.reportListing}
        </button>
      </div>

      <div className="p-4 flex flex-col flex-grow">
        <h3
          className={`font-semibold text-lg cursor-pointer ${titleExpanded ? "" : "line-clamp-2"}`}
          onClick={() => setTitleExpanded(e => !e)}
          title={titleExpanded ? t.collapseTitle : t.expandTitle}
        >
          {listing.name}
        </h3>
        <div className="text-xl font-bold text-primary mt-1 mb-1">
          {new Intl.NumberFormat("fr-FR").format(listing.price)} FCFA
        </div>

        <div className="flex items-center text-muted-foreground text-xs mb-1">
          <Clock className="w-3.5 h-3.5 mr-1 flex-shrink-0" />
          <span>{listing.createdAt ? formatDate(listing.createdAt) : ""}</span>
        </div>

        <div className="flex items-center text-muted-foreground text-sm mb-4">
          <MapPin className="w-4 h-4 mr-1 flex-shrink-0" />
          <span className="truncate">{listing.location}</span>
        </div>

        <div className="mt-auto space-y-3">
          <div className="text-[10px] text-destructive font-medium uppercase tracking-wider text-center bg-destructive/10 py-1.5 rounded">
            {t.warningNoPay}
          </div>

          <Button
            onClick={() => setContactModalOpen(true)}
            className="w-full bg-accent hover:bg-accent/90 text-accent-foreground text-sm"
          >
            {unlockLabel}
          </Button>

          {isAdmin && (
            <div className="pt-3 mt-3 border-t border-border flex items-center justify-between">
              <div className="flex items-center text-sm font-medium text-foreground">
                <Phone className="w-4 h-4 mr-2 text-muted-foreground" />
                {listing.phone || t.notSpecified}
              </div>
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
          )}
        </div>
      </div>
    </div>

    {viewerOpen && listing.images && listing.images.length > 0 && (
      <ImageViewer
        images={listing.images}
        startIndex={viewerIndex}
        onClose={() => setViewerOpen(false)}
      />
    )}
    <ContactUnlockModal
      open={contactModalOpen}
      onClose={() => setContactModalOpen(false)}
      listing={listing}
      commissionRate={commissionRate}
    />
    </>
  );
}
