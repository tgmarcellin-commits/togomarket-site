import { useEffect, useState } from "react";
import { useGetActiveAds, type Ad } from "@workspace/api-client-react";
import { Megaphone, X, ChevronLeft, ChevronRight, Play } from "lucide-react";

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
        {ad.videoPath && (
          <div className="w-full aspect-video bg-black">
            <video
              src={`/api/storage${ad.videoPath}`}
              className="w-full h-full object-contain"
              controls
              playsInline
            />
          </div>
        )}
        {!ad.videoPath && ad.image && (
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
    }, 6000);
    return () => clearInterval(interval);
  }, [ads]);

  if (!ads || ads.length === 0) return null;

  const ad = ads[current];
  const hasMedia = !!(ad.image || ad.videoPath);

  return (
    <>
      <div className="w-full bg-gradient-to-r from-amber-500 to-orange-500 shadow-md">
        <div className="container mx-auto px-3 py-2.5">
          {/* Label */}
          <div className="flex items-center gap-1.5 mb-2">
            <div className="bg-white/20 rounded-full p-1">
              <Megaphone className="w-3 h-3 text-white" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-white/90">
              Publicité
            </span>
            {ads.length > 1 && (
              <div className="flex gap-1 ml-auto">
                {ads.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrent(i)}
                    className={`w-1.5 h-1.5 rounded-full transition-all ${
                      i === current ? "bg-white scale-125" : "bg-white/40"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Ad content */}
          <button
            className="w-full flex items-center gap-3 text-left active:opacity-80 transition-opacity"
            onClick={() => setSelectedAd(ad)}
          >
            {/* Media thumbnail */}
            {hasMedia && (
              <div className="relative flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2 border-white/30 shadow-md">
                {ad.image && <img src={ad.image} alt={ad.advertiserName} className="w-full h-full object-cover" />}
                {ad.videoPath && !ad.image && (
                  <div className="w-full h-full bg-black/60 flex items-center justify-center">
                    <Play className="w-6 h-6 text-white fill-white" />
                  </div>
                )}
                {ad.videoPath && (
                  <div className="absolute bottom-0.5 right-0.5 bg-black/60 rounded-full p-0.5">
                    <Play className="w-2.5 h-2.5 text-white fill-white" />
                  </div>
                )}
              </div>
            )}

            {/* Text */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate leading-tight">{ad.advertiserName}</p>
              <p className="text-xs text-white/80 line-clamp-2 leading-snug mt-0.5">{ad.message}</p>
            </div>

            {/* CTA */}
            <div className="flex-shrink-0 bg-white text-amber-600 font-bold text-[11px] px-3 py-1.5 rounded-full shadow-sm whitespace-nowrap">
              Voir plus
            </div>
          </button>

          {/* Navigation arrows for multiple ads */}
          {ads.length > 1 && (
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={() => setCurrent((c) => (c - 1 + ads.length) % ads.length)}
                className="bg-white/20 hover:bg-white/30 rounded-full p-0.5 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5 text-white" />
              </button>
              <button
                onClick={() => setCurrent((c) => (c + 1) % ads.length)}
                className="bg-white/20 hover:bg-white/30 rounded-full p-0.5 transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          )}
        </div>
      </div>

      {selectedAd && <AdModal ad={selectedAd} onClose={() => setSelectedAd(null)} />}
    </>
  );
}
