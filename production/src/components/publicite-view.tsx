import { useState, useRef } from "react";
import { useGetActiveAds, type Ad } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Megaphone, Play } from "lucide-react";
import { resolveImageUrl } from "@/lib/image";
import { useSiteSettings } from "@/lib/site-settings";
import { useT } from "@/lib/i18n";

function AdDetailModal({ ad, open, onClose, t }: {
  ad: Ad | null;
  open: boolean;
  onClose: () => void;
  t: ReturnType<typeof useT>;
}) {
  if (!ad) return null;
  const isActive = new Date(ad.endDate) > new Date();
  const endDate = new Date(ad.endDate).toLocaleDateString(t.dateLocale, { day: "numeric", month: "long", year: "numeric" });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[420px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ad.advertiserName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {ad.videoPath ? (
            <video
              src={resolveImageUrl(ad.videoPath)}
              controls
              autoPlay
              playsInline
              className="w-full rounded-xl bg-black"
              style={{ maxHeight: 280 }}
            />
          ) : ad.image ? (
            <div className="w-full rounded-xl overflow-hidden bg-black flex items-center justify-center" style={{ maxHeight: 280 }}>
              <img
                src={resolveImageUrl(ad.image)}
                alt={ad.advertiserName}
                className="w-full h-full object-contain"
                style={{ maxHeight: 280 }}
              />
            </div>
          ) : null}
          <div className="space-y-2">
            <p className="text-sm leading-relaxed">{ad.message}</p>
            <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-2">
              <span>{t.expiresOn} {endDate}</span>
              <span className={`px-2 py-0.5 rounded-full font-medium ${
                isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
              }`}>
                {isActive ? t.active : t.expired}
              </span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VideoThumbnail({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  return (
    <div className="relative w-28 h-28 bg-black flex-shrink-0 flex items-center justify-center">
      <video
        ref={videoRef}
        src={resolveImageUrl(src)}
        muted
        playsInline
        preload="metadata"
        className="w-full h-full object-contain"
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="bg-black/50 rounded-full p-2">
          <Play className="w-6 h-6 text-white" />
        </div>
      </div>
    </div>
  );
}

export function PubliciteView() {
  const { lang } = useSiteSettings();
  const t = useT(lang);
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
        <h2 className="text-xl font-bold mb-2">{t.noAds}</h2>
        <p className="text-muted-foreground max-w-xs text-sm">{t.noAdsDesc}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <h2 className="font-bold text-lg mb-4">{t.adsTitle}</h2>
      <div className="space-y-4">
        {ads.map((ad) => (
          <button
            key={ad.id}
            className="w-full text-left rounded-xl border bg-card overflow-hidden hover:shadow-md transition-shadow"
            onClick={() => setSelectedAd(ad)}
          >
            <div className="flex gap-0">
              {ad.videoPath ? (
                <VideoThumbnail src={ad.videoPath} />
              ) : ad.image ? (
                <div className="w-28 h-28 bg-black flex-shrink-0 flex items-center justify-center">
                  <img
                    src={resolveImageUrl(ad.image)}
                    alt={ad.advertiserName}
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                <div className="w-28 h-28 bg-muted flex items-center justify-center flex-shrink-0">
                  <Megaphone className="w-8 h-8 text-muted-foreground" />
                </div>
              )}
              <div className="p-3 flex-1 min-w-0">
                <p className="font-semibold text-sm">{ad.advertiserName}</p>
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{ad.message}</p>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {t.expiresOn} {new Date(ad.endDate).toLocaleDateString(t.dateLocale, { day: "numeric", month: "short", year: "numeric" })}
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
        t={t}
      />
    </div>
  );
}
