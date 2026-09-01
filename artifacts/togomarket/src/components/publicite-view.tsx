import { useState } from "react";
import { SmartVideo } from "@/components/smart-video";
import { useGetActiveAds, useGetAdminSettings, type Ad } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Megaphone, Play } from "lucide-react";
import { resolveImageUrl } from "@/lib/image";
import { useSiteSettings } from "@/lib/site-settings";
import { useT } from "@/lib/i18n";

function ShareButtons({ text, url }: { text: string; url: string }) {
  const waHref = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const fbHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(text)}`;
  return (
    <div className="flex items-center gap-1.5">
      <a
        href={waHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="w-8 h-8 flex items-center justify-center rounded-full bg-[#25D366] hover:bg-[#1eb355] transition-colors"
        title="Partager sur WhatsApp"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.114 1.526 5.843L.057 23.617a.5.5 0 0 0 .611.64l5.975-1.566A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.426l-.369-.221-3.821 1.001.982-3.713-.24-.381A9.944 9.944 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
      </a>
      <a
        href={fbHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="w-8 h-8 flex items-center justify-center rounded-full bg-[#1877F2] hover:bg-[#0f65d8] transition-colors"
        title="Partager sur Facebook"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white"><path d="M24 12.073C24 5.404 18.627 0 12 0S0 5.404 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>
      </a>
    </div>
  );
}

function AdDetailModal({ ad, open, onClose, t }: {
  ad: Ad | null;
  open: boolean;
  onClose: () => void;
  t: ReturnType<typeof useT>;
}) {
  if (!ad) return null;
  const isActive = new Date(ad.endDate) > new Date();
  const endDate = new Date(ad.endDate).toLocaleDateString(t.dateLocale, { day: "numeric", month: "long", year: "numeric" });
  const shareText = `📢 ${ad.advertiserName}\n${ad.message}\n\nDécouvrez sur TogoMarket : ${window.location.origin}`;
  const shareUrl = window.location.origin;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="sm:max-w-[420px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{ad.advertiserName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {ad.videoPath ? (
              <SmartVideo
                src={resolveImageUrl(ad.videoPath)}
                mode="player"
                className="w-full rounded-xl"
                style={{ maxHeight: 280 }}
              />
            ) : ad.image ? (
              <div
                className="w-full rounded-xl overflow-hidden"
                style={{ maxHeight: 280 }}
              >
                <img
                  src={resolveImageUrl(ad.image)}
                  alt={ad.advertiserName}
                  className="w-full object-cover"
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
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground">{t.shareViaWhatsApp} / Facebook</span>
                <ShareButtons text={shareText} url={shareUrl} />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </>
  );
}

const AD_CATEGORIES = ["Agence", "Ecole", "Hotels", "Restaurant"] as const;
type AdCategory = typeof AD_CATEGORIES[number];

// Icônes par catégorie
const CATEGORY_ICONS: Record<AdCategory, string> = {
  Agence: "🏢",
  Ecole: "🎓",
  Hotels: "🏨",
  Restaurant: "🍽️",
};

export function PubliciteView() {
  const { lang } = useSiteSettings();
  const t = useT(lang);
  const { data: ads, isLoading } = useGetActiveAds();
  const { data: settings } = useGetAdminSettings();
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);
  const [activeCategory, setActiveCategory] = useState<AdCategory>("Agence");
  const whatsappAds = settings?.whatsappAds ?? "22870703131";

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-2xl space-y-4">
        {[1, 2, 3].map((n) => (
          <div key={n} className="rounded-xl border bg-card h-32 animate-pulse" />
        ))}
      </div>
    );
  }

  const submitText = lang === "fr"
    ? "📢 Bonjour TogoMarket, je souhaite soumettre une publicité. Pouvez-vous m'indiquer la marche à suivre ?"
    : "📢 Hello TogoMarket, I would like to submit an advertisement. Can you guide me?";

  // Filtrer les pubs de la catégorie active, épinglées en tête
  const filteredAds = (ads ?? [])
    .filter((ad) => (ad.category ?? "Agence") === activeCategory)
    .sort((a, b) => {
      if (a.isPinned === b.isPinned) return 0;
      return a.isPinned ? -1 : 1;
    });

  // Compter les pubs par catégorie pour afficher les badges
  const countByCategory = (cat: AdCategory) =>
    (ads ?? []).filter((ad) => (ad.category ?? "Agence") === cat).length;

  return (
    <div className="container mx-auto px-4 py-4 max-w-2xl">
      {/* Onglets catégories */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
        {AD_CATEGORIES.map((cat) => {
          const count = countByCategory(cat);
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 ${
                activeCategory === cat
                  ? "bg-amber-500 text-white shadow-md"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              <span>{CATEGORY_ICONS[cat]}</span>
              <span>{cat}</span>
              {count > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  activeCategory === cat ? "bg-white/20 text-white" : "bg-amber-100 text-amber-700"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Contenu de la catégorie */}
      {filteredAds.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mb-3 text-2xl">
            {CATEGORY_ICONS[activeCategory]}
          </div>
          <h3 className="text-base font-bold mb-1">Aucune publicité {activeCategory}</h3>
          <p className="text-muted-foreground text-sm mb-5">
            Il n'y a pas encore de publicité dans cette catégorie.
          </p>
          <SubmitAdButton t={t} whatsappAds={whatsappAds} />
        </div>
      ) : (
        <>
          <div className="space-y-4">
                {filteredAds.map((ad) => {
              const shareText = `📢 ${ad.advertiserName}\n${ad.message}\n\nDécouvrez sur TogoMarket : ${window.location.origin}`;
              const shareUrl = window.location.origin;
              return (
                <div key={ad.id} className={`rounded-xl border bg-card overflow-hidden hover:shadow-md transition-shadow ${ad.isPinned ? "border-amber-300 shadow-sm" : ""}`}>
                  {ad.isPinned && (
                    <div className="flex items-center gap-1 px-3 pt-2">
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                        📌 Épinglé
                      </span>
                    </div>
                  )}
                  <div className="flex gap-0">
                    {ad.videoPath ? (
                      <button type="button" className="flex-shrink-0 focus:outline-none" onClick={() => setSelectedAd(ad)}>
                        <div className="relative w-28 h-28 flex-shrink-0 overflow-hidden">
                          {ad.image ? (
                            <img
                              src={resolveImageUrl(ad.image)}
                              alt={ad.advertiserName}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                              <Megaphone className="w-10 h-10 text-white/50" />
                            </div>
                          )}
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="bg-black/55 rounded-full p-2.5 shadow-lg">
                              <Play className="w-5 h-5 text-white fill-white" />
                            </div>
                          </div>
                        </div>
                      </button>
                    ) : ad.image ? (
                      <button
                        type="button"
                        className="w-28 h-28 flex-shrink-0 overflow-hidden focus:outline-none"
                        onClick={() => setSelectedAd(ad)}
                      >
                        <img
                          src={resolveImageUrl(ad.image)}
                          alt={ad.advertiserName}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ) : (
                      <div className="w-28 h-28 bg-muted flex items-center justify-center flex-shrink-0">
                        <Megaphone className="w-8 h-8 text-muted-foreground" />
                      </div>
                    )}
                    <button
                      className="flex-1 min-w-0 text-left p-3"
                      onClick={() => setSelectedAd(ad)}
                    >
                      <p className="font-semibold text-sm">{ad.advertiserName}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{ad.message}</p>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {t.expiresOn} {new Date(ad.endDate).toLocaleDateString(t.dateLocale, { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </button>
                  </div>
                  <div className="px-3 pb-2 flex justify-end">
                    <ShareButtons text={shareText} url={shareUrl} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4 text-center">
            <Megaphone className="w-7 h-7 text-primary mx-auto mb-2" />
            <p className="text-sm font-semibold mb-0.5">{t.submitAdCta}</p>
            <p className="text-xs text-muted-foreground mb-3">{t.submitAdDesc}</p>
            <a
              href={`https://wa.me/${whatsappAds}?text=${encodeURIComponent(submitText)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#1eb355] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white flex-shrink-0"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.114 1.526 5.843L.057 23.617a.5.5 0 0 0 .611.64l5.975-1.566A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.426l-.369-.221-3.821 1.001.982-3.713-.24-.381A9.944 9.944 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
              {t.submitAdCta}
            </a>
          </div>
        </>
      )}

      <AdDetailModal
        ad={selectedAd}
        open={!!selectedAd}
        onClose={() => setSelectedAd(null)}
        t={t}
      />

    </div>
  );
}

function SubmitAdButton({ t, whatsappAds }: { t: ReturnType<typeof useT>; whatsappAds: string }) {
  const submitText = t.dateLocale === "fr-FR"
    ? "📢 Bonjour TogoMarket, je souhaite soumettre une publicité. Pouvez-vous m'indiquer la marche à suivre ?"
    : "📢 Hello TogoMarket, I would like to submit an advertisement. Can you guide me?";
  return (
    <a
      href={`https://wa.me/${whatsappAds}?text=${encodeURIComponent(submitText)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#1eb355] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
    >
      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white flex-shrink-0"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.114 1.526 5.843L.057 23.617a.5.5 0 0 0 .611.64l5.975-1.566A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.426l-.369-.221-3.821 1.001.982-3.713-.24-.381A9.944 9.944 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
      {t.submitAdCta}
    </a>
  );
}
