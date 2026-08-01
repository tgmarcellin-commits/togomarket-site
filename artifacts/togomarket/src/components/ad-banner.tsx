import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useGetActiveAds, type Ad } from "@workspace/api-client-react";
import { Volume2, VolumeX, Play, Pause } from "lucide-react";
import { resolveImageUrl } from "@/lib/image";

export function AdBanner() {
  const { data: ads } = useGetActiveAds({
    query: { refetchInterval: 5 * 60 * 1000 }, // re-fetch toutes les 5 min pour suivre la rotation serveur
  });

  // Uniquement les publicités avec vidéo
  const videoAds = useMemo<Ad[]>(
    () => (ads ?? []).filter((ad) => !!ad.videoPath),
    [ads]
  );

  const [current, setCurrent] = useState(0);

  // Resynchroniser sur l'index 0 quand le serveur retourne une nouvelle liste
  // (le serveur place toujours la vidéo courante en tête)
  const prevAdsKeyRef = useRef<string>("");
  useEffect(() => {
    if (!videoAds.length) return;
    const key = videoAds.map((a) => a.id).join(",");
    if (key !== prevAdsKeyRef.current) {
      prevAdsKeyRef.current = key;
      setCurrent(0);
    }
  }, [videoAds]);
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showIcon, setShowIcon] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const lastTapTime = useRef(0);
  const iconTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ad = videoAds[current] as Ad | undefined;

  // Changer de vidéo → reset + lecture automatique
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    setPaused(false);
    v.play().catch(() => {});
  }, [current]);

  // Sync muted
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  const flashIcon = useCallback(() => {
    setShowIcon(true);
    if (iconTimer.current) clearTimeout(iconTimer.current);
    iconTimer.current = setTimeout(() => setShowIcon(false), 800);
  }, []);

  const handleNext = useCallback(() => {
    setCurrent((c) => (c + 1) % videoAds.length);
    setPaused(false);
  }, [videoAds.length]);

  const handlePrev = useCallback(() => {
    setCurrent((c) => (c - 1 + videoAds.length) % videoAds.length);
    setPaused(false);
  }, [videoAds.length]);

  const handleTap = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (paused) {
      v.play().catch(() => {});
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
    flashIcon();
  }, [paused, flashIcon]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      // Ignorer si le doigt s'est levé sur un bouton
      if ((e.target as HTMLElement).closest("button")) return;

      const dx = touchStartX.current - e.changedTouches[0].clientX;
      const dy = Math.abs(touchStartY.current - e.changedTouches[0].clientY);

      // Swipe horizontal (ignore si mouvement vertical dominant)
      if (Math.abs(dx) > 50 && Math.abs(dx) > dy) {
        lastTapTime.current = 0;
        if (dx > 0) handleNext();
        else handlePrev();
        return;
      }

      // Double tap pour pause / lecture
      if (Math.abs(dx) <= 15 && dy <= 15) {
        const now = Date.now();
        if (now - lastTapTime.current < 300) {
          lastTapTime.current = 0;
          handleTap();
        } else {
          lastTapTime.current = now;
        }
      }
    },
    [handleNext, handlePrev, handleTap]
  );

  if (!videoAds.length || !ad) return null;

  return (
    <div
      className="w-full relative bg-black overflow-hidden select-none"
      style={{ aspectRatio: "16/9", maxHeight: "256px" }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Vidéo */}
      <video
        ref={videoRef}
        key={ad.id}
        src={resolveImageUrl(ad.videoPath!)}
        muted={muted}
        autoPlay
        playsInline
        loop={videoAds.length === 1}
        onEnded={videoAds.length > 1 ? handleNext : undefined}
        className="w-full h-full object-cover"
      />

      {/* Icône play/pause flashée au tap */}
      {showIcon && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 rounded-full p-4">
            {paused ? (
              <Play className="w-10 h-10 text-white fill-white" />
            ) : (
              <Pause className="w-10 h-10 text-white fill-white" />
            )}
          </div>
        </div>
      )}

      {/* Overlay pause persistante (icône play centré) */}
      {paused && !showIcon && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20">
          <div className="bg-black/50 rounded-full p-4">
            <Play className="w-10 h-10 text-white fill-white" />
          </div>
        </div>
      )}

      {/* Barre supérieure : label + points + son */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 pt-2.5 pb-4 bg-gradient-to-b from-black/60 to-transparent pointer-events-none">
        <span className="text-[10px] font-black uppercase tracking-widest text-white/90 bg-black/30 px-2 py-0.5 rounded-full">
          PUBLICITÉ
        </span>
        <div className="flex items-center gap-2 pointer-events-auto">
          {videoAds.length > 1 && (
            <div className="flex gap-1 items-center">
              {videoAds.map((_, i) => (
                <button
                  key={i}
                  onClick={(e) => { e.stopPropagation(); setCurrent(i); setPaused(false); }}
                  className={`rounded-full transition-all ${
                    i === current
                      ? "bg-white w-3 h-1.5"
                      : "bg-white/40 w-1.5 h-1.5"
                  }`}
                />
              ))}
            </div>
          )}
          {/* Bouton son */}
          <button
            onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
            className="bg-black/50 rounded-full p-1.5 active:scale-90 transition-transform"
          >
            {muted ? (
              <VolumeX className="w-4 h-4 text-white" />
            ) : (
              <Volume2 className="w-4 h-4 text-white" />
            )}
          </button>
        </div>
      </div>

      {/* Barre inférieure : nom de l'annonceur */}
      <div className="absolute bottom-0 left-0 right-0 px-3 pb-2.5 pt-6 bg-gradient-to-t from-black/70 to-transparent pointer-events-none">
        <p className="text-sm font-bold text-white drop-shadow truncate">{ad.advertiserName}</p>
        {ad.message && (
          <p className="text-xs text-white/70 line-clamp-1 mt-0.5">{ad.message}</p>
        )}
      </div>
    </div>
  );
}
