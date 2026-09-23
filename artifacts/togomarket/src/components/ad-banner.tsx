import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { getGetActiveAdsQueryKey, getGetAdminSettingsQueryKey, useGetActiveAds, useGetAdminSettings, type Ad } from "@workspace/api-client-react";
import { Volume2, VolumeX, Play, Pause } from "lucide-react";
import { resolveImageUrl } from "@/lib/image";

export function AdBanner() {
  const { data: ads } = useGetActiveAds({
    query: {
      queryKey: getGetActiveAdsQueryKey(),
      refetchInterval: 5 * 60 * 1000,
    }, // re-fetch toutes les 5 min pour suivre la rotation serveur
  });
  const { data: settings, isError: settingsError } = useGetAdminSettings({
    query: {
      queryKey: getGetAdminSettingsQueryKey(),
      refetchInterval: 30 * 1000,
      refetchOnWindowFocus: true,
    },
  });
  const playbackConfigured = settings !== undefined || settingsError;
  const economicalMode = settings?.adVideoPlaybackMode === "ECONOMICAL";

  // Les publicités sont soit des flyers, soit des vidéos. Une vidéo reste
  // prioritaire lorsqu'elle possède aussi une image utilisée comme poster.
  const mediaAds = useMemo<Ad[]>(
    () => (ads ?? []).filter((ad) => !!ad.videoPath || !!ad.image),
    [ads]
  );

  const [current, setCurrent] = useState(0);

  // Resynchroniser sur l'index 0 quand le serveur retourne une nouvelle liste
  // (le serveur place toujours la vidéo courante en tête)
  const prevAdsKeyRef = useRef<string>("");
  useEffect(() => {
    if (!mediaAds.length) return;
    const key = mediaAds.map((a) => a.id).join(",");
    if (key !== prevAdsKeyRef.current) {
      prevAdsKeyRef.current = key;
      setCurrent(0);
    }
  }, [mediaAds]);
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [viewingVideo, setViewingVideo] = useState(false);
  const [showIcon, setShowIcon] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const lastTouchTime = useRef(0);
  const iconTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ad = mediaAds[current] as Ad | undefined;
  const isVideoAd = !!ad?.videoPath;
  // Utiliser immédiatement le poster enregistré évite un écran vide pendant
  // la génération serveur. Les nouveaux posters sont extraits dans les
  // premières secondes et le serveur sert de fallback si l'image manque.
  const posterUrl = isVideoAd
    ? ad?.image
      ? resolveImageUrl(ad.image)
      : `/api/storage/video-poster?path=${encodeURIComponent(ad.videoPath!)}`
    : undefined;

  // Changer de vidéo : lecture automatique uniquement dans le mode configuré.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    setViewingVideo(false);
    if (!playbackConfigured) {
      v.pause();
      setPaused(true);
      return;
    }
    if (economicalMode) {
      v.pause();
      setPaused(true);
      return;
    }
    setPaused(false);
    v.play().catch(() => {});
  }, [current, economicalMode, playbackConfigured]);

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
    setCurrent((c) => (c + 1) % mediaAds.length);
    setPaused(false);
    setViewingVideo(false);
  }, [mediaAds.length]);

  const handlePrev = useCallback(() => {
    setCurrent((c) => (c - 1 + mediaAds.length) % mediaAds.length);
    setPaused(false);
    setViewingVideo(false);
  }, [mediaAds.length]);

  // Les flyers ont une durée d'affichage de dix secondes. En mode
  // économique, le même minuteur s'applique aux vidéos tant qu'elles ne sont
  // pas lancées. En lecture automatique, une vidéo passe à la suivante à sa
  // fin réelle.
  useEffect(() => {
    if (
      !playbackConfigured
      || mediaAds.length <= 1
      || (isVideoAd && !economicalMode)
      || (economicalMode && isVideoAd && viewingVideo)
    ) return;
    const timer = window.setInterval(handleNext, 10_000);
    return () => window.clearInterval(timer);
  }, [economicalMode, handleNext, isVideoAd, mediaAds.length, playbackConfigured, viewingVideo]);

  const startManualPlayback = useCallback(() => {
    if (!economicalMode) return;
    const v = videoRef.current;
    if (!v) return;
    setViewingVideo(true);
    v.play().then(() => setPaused(false)).catch(() => {
      setViewingVideo(false);
      setPaused(true);
    });
  }, [economicalMode]);

  const handleTap = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (economicalMode && !viewingVideo) {
      startManualPlayback();
      return;
    }
    if (paused) {
      v.play().catch(() => {});
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
    flashIcon();
  }, [economicalMode, flashIcon, paused, startManualPlayback, viewingVideo]);

  const handleVideoClick = useCallback(
    () => {
      if (Date.now() - lastTouchTime.current < 500) return;
      handleTap();
    },
    [handleTap]
  );

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
        if (dx > 0) handleNext();
        else handlePrev();
        return;
      }

      // Un tap sur la vidéo contrôle la lecture. Le clic généré ensuite par le
      // navigateur est ignoré pour éviter de basculer deux fois l'état.
      if (Math.abs(dx) <= 15 && dy <= 15) {
        lastTouchTime.current = Date.now();
        handleTap();
      }
    },
    [handleNext, handlePrev, handleTap]
  );

  if (!mediaAds.length || !ad) return null;

  return (
    <div
      className="w-full relative bg-black overflow-hidden select-none"
      style={{
        // La zone publicitaire occupe réellement l'espace disponible sur grand
        // écran sans devenir démesurée. Le flyer, lui, est toujours contenu
        // intégralement à l'intérieur de cette zone.
        height: "min(70vh, 56.25vw, 720px)",
        minHeight: "220px",
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {isVideoAd ? (
        <video
          ref={videoRef}
          key={ad.id}
          src={resolveImageUrl(ad.videoPath!)}
          poster={posterUrl}
          muted={muted}
          autoPlay={playbackConfigured && !economicalMode}
          preload={playbackConfigured && !economicalMode ? "auto" : "none"}
          playsInline
          loop={!economicalMode && mediaAds.length === 1}
          onClick={handleVideoClick}
          onEnded={economicalMode ? () => {
            setViewingVideo(false);
            setPaused(true);
          } : handleNext}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-black">
          {/* Fond agrandi pour remplir toute la zone sans recadrer le flyer
              principal. Le flyer net reste toujours entièrement visible. */}
          <img
            src={resolveImageUrl(ad.image!)}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-35"
          />
          <img
            key={ad.id}
            src={resolveImageUrl(ad.image!)}
            alt={`Flyer publicitaire de ${ad.advertiserName}`}
            className="relative z-[1] max-w-full max-h-full w-auto h-auto object-contain"
          />
        </div>
      )}

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
          {mediaAds.length > 1 && (
            <div className="flex gap-1 items-center">
              {mediaAds.map((_, i) => (
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
          {isVideoAd && (
            <button
              type="button"
              aria-label="Activer ou couper le son"
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMuted((m) => !m);
              }}
              className="bg-black/50 rounded-full p-1.5 active:scale-90 transition-transform"
            >
              {muted ? (
                <VolumeX className="w-4 h-4 text-white" />
              ) : (
                <Volume2 className="w-4 h-4 text-white" />
              )}
            </button>
          )}
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
