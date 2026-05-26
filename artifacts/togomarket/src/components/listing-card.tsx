import type { Listing } from "@workspace/api-client-react";
import { useAdminDeleteListing, getGetListingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { MapPin, Phone, Trash2, Flag, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ListingCardProps {
  listing: Listing;
  isAdmin: boolean;
  adminPassword?: string;
  commissionRate: number;
}

const sectorColors: Record<string, string> = {
  AgriMarket: "bg-primary text-primary-foreground",
  Immobilier: "bg-blue-500 text-white",
  Automobile: "bg-accent text-accent-foreground",
  Divers: "bg-secondary text-secondary-foreground",
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function calcCommission(price: number, rate: number): number {
  if (rate === 0) return 0;
  return Math.round(Math.min(price, 100000) * rate / 100);
}

export function ListingCard({ listing, isAdmin, adminPassword, commissionRate }: ListingCardProps) {
  const queryClient = useQueryClient();
  const deleteMutation = useAdminDeleteListing();

  const handleDelete = () => {
    if (!adminPassword || !isAdmin) return;
    if (confirm("Supprimer cet article ?")) {
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

  const handleUnlockContact = () => {
    const commissionText =
      commissionRate === 0
        ? "gratuitement"
        : `en payant ${new Intl.NumberFormat("fr-FR").format(commission)} FCFA de commission`;
    const message = `Bonjour, je suis intéressé par l'article: "${listing.name}" à ${new Intl.NumberFormat("fr-FR").format(listing.price)} FCFA. Je souhaite débloquer le contact du vendeur ${commissionText}.`;
    window.open(`https://wa.me/22870703131?text=${encodeURIComponent(message)}`, "_blank");
  };

  const handleReport = () => {
    const message = `🚨 Signalement d'article sur TogoMarket\n\nTitre: ${listing.name}\nPrix: ${new Intl.NumberFormat("fr-FR").format(listing.price)} FCFA\nLocalisation: ${listing.location}\nSecteur: ${listing.sector}\nID: #${listing.id}\n\nMerci de vérifier cet article.`;
    window.open(`https://wa.me/22870703131?text=${encodeURIComponent(message)}`, "_blank");
  };

  const unlockLabel =
    commissionRate === 0
      ? "Débloquer le Contact — Gratuit"
      : `Débloquer le Contact — ${new Intl.NumberFormat("fr-FR").format(commission)} FCFA`;

  return (
    <div className="group rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col h-full hover:shadow-md transition-all">
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        <div className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-hide">
          {listing.images && listing.images.length > 0 ? (
            listing.images.map((img, i) => (
              <img
                key={i}
                src={img}
                alt={`${listing.name} ${i + 1}`}
                className="w-full h-full object-cover snap-center flex-shrink-0"
              />
            ))
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              Aucune image
            </div>
          )}
        </div>
        <div className="absolute top-2 left-2 z-10">
          <Badge className={`border-none ${sectorColors[listing.sector] || "bg-gray-500"}`}>
            {listing.sector}
          </Badge>
        </div>
        <button
          onClick={handleReport}
          title="Signaler cet article"
          className="absolute top-2 right-2 z-10 bg-white/80 hover:bg-white text-red-500 rounded-full p-1.5 shadow transition-colors"
        >
          <Flag className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-4 flex flex-col flex-grow">
        <h3 className="font-semibold text-lg line-clamp-2">{listing.name}</h3>
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
            ATTENTION : Ne payez aucun article sans l'avoir vu.
          </div>

          <Button
            onClick={handleUnlockContact}
            className="w-full bg-accent hover:bg-accent/90 text-accent-foreground text-sm"
          >
            {unlockLabel}
          </Button>

          {isAdmin && (
            <div className="pt-3 mt-3 border-t border-border flex items-center justify-between">
              <div className="flex items-center text-sm font-medium text-foreground">
                <Phone className="w-4 h-4 mr-2 text-muted-foreground" />
                {listing.phone || "Non spécifié"}
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Supprimer
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
