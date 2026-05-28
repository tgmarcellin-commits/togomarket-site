import { useEffect, useState } from "react";
import { useGetActiveAds, type Ad } from "@workspace/api-client-react";
import { Megaphone, X } from "lucide-react";

function AdModal({ ad, onClose }: { ad: Ad; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {ad.image && (
          <div className="w-full aspect-video bg-black">
            <img
              src={ad.image}
              alt={ad.advertiserName}
              className="w-full h-full object-contain"
            />
          </div>
        )}
        <div className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="bg-amber-400 rounded-full p-1">
                  <Megaphone className="w-3 h-3 text-white" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600">
                  Publicité
                </span>
              </div>
              <h2 className="text-lg font-bold text-foreground">{ad.advertiserName}</h2>
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 rounded-full p-1.5 bg-muted hover:bg-muted/80 transition-colors"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          <p className="text-sm text-foreground leading-relaxed">{ad.message}</p>

          <div className="pt-2 border-t text-xs text-muted-foreground">
            Expire le {new Date(ad.endDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdBanner() {
  const { data: ads } = useGetActiveAds();
  const [current, setCurrent] = useState(0);
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);

  useEffect(() => {
    if (!ads || ads.length <= 1) return;
    const interval = setInterval(() => {
      setCurrent((prev) => (prev + 1) % ads.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [ads]);

  if (!ads || ads.length === 0) return null;

  const ad = ads[current];

  return (
    <>
      <div className="w-full bg-amber-50 border-b border-amber-200">
        <div className="container mx-auto px-4 py-2">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 bg-amber-400 rounded-full p-1.5">
              <Megaphone className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600 flex-shrink-0">
              Pub
            </span>
            <button
              className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden text-left cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setSelectedAd(ad)}
            >
              {ad.image && (
                <img
                  src={ad.image}
                  alt={ad.advertiserName}
                  className="w-10 h-10 rounded-md object-cover flex-shrink-0 border border-amber-200"
                />
              )}
              <div className="min-w-0">
                <p className="text-xs font-bold text-foreground truncate">{ad.advertiserName}</p>
                <p className="text-xs text-muted-foreground truncate">{ad.message}</p>
              </div>
              <span className="text-[10px] text-amber-500 font-medium flex-shrink-0 underline">
                Voir plus
              </span>
            </button>
            {ads.length > 1 && (
              <div className="flex gap-1 flex-shrink-0">
                {ads.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrent(i)}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${
                      i === current ? "bg-amber-500" : "bg-amber-200"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedAd && <AdModal ad={selectedAd} onClose={() => setSelectedAd(null)} />}
    </>
  );
}
