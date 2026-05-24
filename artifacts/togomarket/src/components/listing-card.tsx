import type { Listing } from "@workspace/api-client-react";
import { useAdminDeleteListing, getGetListingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { MapPin, Phone, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ListingCardProps {
  listing: Listing;
  isAdmin: boolean;
  adminPassword?: string;
}

const sectorColors: Record<string, string> = {
  AgriMarket: "bg-primary text-primary-foreground",
  Immobilier: "bg-blue-500 text-white",
  Automobile: "bg-accent text-accent-foreground",
  Divers: "bg-secondary text-secondary-foreground"
};

export function ListingCard({ listing, isAdmin, adminPassword }: ListingCardProps) {
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
          }
        }
      );
    }
  };

  const commission = Math.round(listing.price * 0.05);
  const handleUnlockContact = () => {
    const message = `Bonjour, je suis intéressé par l'article: ${listing.name} à ${listing.price} FCFA. Je suis prêt à payer la commission de ${commission} FCFA pour obtenir le contact du vendeur.`;
    window.open(`https://wa.me/22870703131?text=${encodeURIComponent(message)}`, '_blank');
  };

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
          <Badge className={`border-none ${sectorColors[listing.sector] || 'bg-gray-500'}`}>
            {listing.sector}
          </Badge>
        </div>
      </div>
      
      <div className="p-4 flex flex-col flex-grow">
        <h3 className="font-semibold text-lg line-clamp-2">{listing.name}</h3>
        <div className="text-xl font-bold text-primary mt-1 mb-2">
          {new Intl.NumberFormat('fr-TG').format(listing.price)} FCFA
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
            className="w-full bg-accent hover:bg-accent/90 text-accent-foreground"
          >
            Débloquer le Contact
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
