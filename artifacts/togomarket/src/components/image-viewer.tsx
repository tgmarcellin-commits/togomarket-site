import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { resolveImageUrl } from "@/lib/image";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

interface ImageViewerProps {
  images: string[];
  startIndex: number;
  onClose: () => void;
  /** Panneau optionnel affiché sous les photos (titre, description, avis…). */
  footer?: React.ReactNode;
}

export function ImageViewer({ images, startIndex, onClose, footer }: ImageViewerProps) {
  const [current, setCurrent] = useState(startIndex);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setCurrent((c) => (c + 1) % images.length);
      if (e.key === "ArrowLeft") setCurrent((c) => (c - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [images.length, onClose]);

  const prev = () => setCurrent((c) => (c - 1 + images.length) % images.length);
  const next = () => setCurrent((c) => (c + 1) % images.length);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center pointer-events-auto"
      onClick={onClose}
    >
      {/* Bouton fermer */}
      <button
        className="absolute top-4 right-4 text-white bg-white/10 hover:bg-white/25 rounded-full p-2 transition-colors z-10"
        onClick={onClose}
      >
        <X className="w-6 h-6" />
      </button>

      {/* Compteur */}
      {images.length > 1 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm font-medium z-10">
          {current + 1} / {images.length}
        </div>
      )}

      {/* Image principale */}
      <div
        className={`relative w-full flex items-center justify-center px-14 ${footer ? "flex-1 min-h-0 pt-12" : "h-full"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={resolveImageUrl(images[current])}
          alt={`Photo ${current + 1}`}
          className="max-w-full max-h-full object-contain select-none"
          style={{ maxHeight: footer ? undefined : "90vh" }}
        />

        {/* Navigation */}
        {images.length > 1 && (
          <>
            <button
              onClick={prev}
              className="absolute left-2 text-white bg-white/10 hover:bg-white/25 rounded-full p-2.5 transition-colors"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={next}
              className="absolute right-2 text-white bg-white/10 hover:bg-white/25 rounded-full p-2.5 transition-colors"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}
      </div>

      {/* Miniatures */}
      {images.length > 1 && (
        <div
          className={`flex gap-2 px-4 ${footer ? "py-2 justify-center flex-shrink-0" : "absolute bottom-4"}`}
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`w-12 h-12 rounded-md overflow-hidden border-2 transition-all flex-shrink-0 ${
                i === current ? "border-white scale-110" : "border-white/30 opacity-60"
              }`}
            >
              <img src={resolveImageUrl(img)} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Panneau bas : titre, description, avis… */}
      {footer && (
        <div
          className="w-full max-h-[45vh] overflow-y-auto bg-black/80 border-t border-white/10 px-4 py-3 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="max-w-2xl mx-auto">{footer}</div>
        </div>
      )}
    </div>,
    document.body
  );
}
