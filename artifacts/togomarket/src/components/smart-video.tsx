import { useState, useRef, useCallback } from "react";
import { Play, RefreshCw } from "lucide-react";

interface SmartVideoProps {
  src: string;
  className?: string;
  style?: React.CSSProperties;
  mode?: "thumbnail" | "player";
  poster?: string;
}

export function SmartVideo({ src, className = "", style, mode = "player", poster }: SmartVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState(false);

  const startPlay = useCallback(() => {
    setStarted(true);
    setBuffering(true);
    setError(false);
    setTimeout(() => {
      videoRef.current?.play().catch(() => {
        setBuffering(false);
        setError(true);
      });
    }, 30);
  }, []);

  const retry = useCallback(() => {
    setStarted(false);
    setBuffering(false);
    setError(false);
  }, []);

  if (mode === "thumbnail") {
    return (
      <div className={`relative bg-black flex-shrink-0 flex items-center justify-center overflow-hidden ${className}`} style={style}>
        {!started ? (
          <button
            type="button"
            className="absolute inset-0 flex items-center justify-center z-10"
            onClick={(e) => { e.stopPropagation(); startPlay(); }}
          >
            <div className="bg-black/55 rounded-full p-2">
              <Play className="w-5 h-5 text-white fill-white" />
            </div>
          </button>
        ) : (
          <>
            <video
              ref={videoRef}
              src={src}
              preload="none"
              muted
              playsInline
              loop
              className="w-full h-full object-cover"
              onWaiting={() => setBuffering(true)}
              onPlaying={() => setBuffering(false)}
              onCanPlay={() => setBuffering(false)}
              onError={() => { setBuffering(false); setError(true); }}
            />
            {buffering && !error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
                <RefreshCw className="w-4 h-4 text-white animate-spin" />
              </div>
            )}
            {error && (
              <button type="button" onClick={(e) => { e.stopPropagation(); retry(); }} className="absolute inset-0 flex items-center justify-center bg-black/60">
                <RefreshCw className="w-4 h-4 text-white" />
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`relative bg-black overflow-hidden ${className}`} style={style}>
      {!started ? (
        <button
          type="button"
          className="w-full flex items-center justify-center min-h-[160px]"
          style={style}
          onClick={startPlay}
        >
          {poster && (
            <img src={poster} className="absolute inset-0 w-full h-full object-contain opacity-50" alt="" />
          )}
          <div className="relative z-10 bg-black/60 rounded-full p-4 shadow-lg">
            <Play className="w-8 h-8 text-white fill-white" />
          </div>
        </button>
      ) : (
        <>
          <video
            ref={videoRef}
            src={src}
            preload="none"
            controls
            playsInline
            className="w-full h-full object-contain"
            style={style}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => setBuffering(false)}
            onCanPlay={() => setBuffering(false)}
            onError={() => { setBuffering(false); setError(true); }}
          />
          {buffering && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
              <RefreshCw className="w-8 h-8 text-white animate-spin" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-3">
              <p className="text-white text-sm font-medium">Chargement impossible</p>
              <button
                type="button"
                onClick={retry}
                className="flex items-center gap-2 bg-white/20 hover:bg-white/30 text-white text-sm px-4 py-2 rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Réessayer
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
