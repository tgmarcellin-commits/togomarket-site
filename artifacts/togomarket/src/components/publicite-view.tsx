import { useState } from "react";
import { useGetActiveAds, type Ad } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Megaphone, Play } from "lucide-react";

function AdDetailModal({ ad, open, onClose }: { ad: Ad | null; open: boolean; onClose: () => void }) {
  if (!ad) return null;
  const isActive = new Date(ad.endDate) > new Date();
  const endDate = new Date(ad.endDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[420px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ad.advertiserName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {ad.videoPath ? (
            <video
              src={ad.videoPath}
              controls
              className="w-full rounded-xl max-h-[220px] object-cover bg-black"
            />
          ) : ad.image ? (
            <img
              src={ad.image}
              alt={ad.advertiserName}
              className="w-full rounded-xl max-h-[220px] object-cover"
            />
          ) : null}
          <div className="space-y-2">
            <p className="text-sm leading-relaxed">{ad.message}</p>
            <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-2">
              <span>Expire le {endDate}</span>
              <span className={`px-2 py-0.5 rounded-full font-medium ${
                isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
              }`}>
                {isActive ? "Active" : "Expirée"}
              </span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PubliciteView() {
  const { data: ads, isLoading } = useGetActiveAds();
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-2xl space-y-4">
        {[1, 2, 3].map((n) => (
          <div key={n} className="rounded-xl border bg-card h-32 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!ads || ads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
          <Megaphone className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold mb-2">Aucune publicité</h2>
        <p className="text-muted-foreground max-w-xs text-sm">
          Aucune publicité n'est diffusée pour le moment. Revenez plus tard.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <h2 className="font-bold text-lg mb-4">Publicités en cours</h2>
      <div className="space-y-4">
        {ads.map((ad) => (
          <button
            key={ad.id}
            className="w-full text-left rounded-xl border bg-card overflow-hidden hover:shadow-md transition-shadow"
            onClick={() => setSelectedAd(ad)}
          >
            <div className="flex gap-0">
              {ad.videoPath ? (
                <div className="w-24 h-24 bg-black flex items-center justify-center flex-shrink-0">
                  <Play className="w-8 h-8 text-white" />
                </div>
              ) : ad.image ? (
                <img
                  src={ad.image}
                  alt={ad.advertiserName}
                  className="w-24 h-24 object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-24 h-24 bg-muted flex items-center justify-center flex-shrink-0">
                  <Megaphone className="w-8 h-8 text-muted-foreground" />
                </div>
              )}
              <div className="p-3 flex-1 min-w-0">
                <p className="font-semibold text-sm">{ad.advertiserName}</p>
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{ad.message}</p>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Expire le {new Date(ad.endDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>

      <AdDetailModal
        ad={selectedAd}
        open={!!selectedAd}
        onClose={() => setSelectedAd(null)}
      />
    </div>
  );
}
