export function resolveImageUrl(img: string): string {
  // Retirer le préfixe vidéo v: s'il est présent (les chemins vidéo Tourisme)
  if (img.startsWith("v:")) img = img.slice(2);
  if (img.startsWith("data:") || img.startsWith("http") || img.startsWith("blob:") || img.startsWith("/api/")) return img;
  return `/api/storage${img}`;
}

/** Détecte les vidéos : préfixe v: (nouveaux uploads) OU extension connue (anciens uploads) */
export const isVideoMedia = (path: string) =>
  path.startsWith("v:") || /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(path);

/** Résout l'URL en retirant le préfixe v: si présent */
export const resolveMediaUrl = (path: string) =>
  resolveImageUrl(path.startsWith("v:") ? path.slice(2) : path);

export const STANDARD_IMAGE_RATIO = 4 / 3;
export const STANDARD_IMAGE_MAX = 1400;

function drawCroppedImage(img: HTMLImageElement, canvas: HTMLCanvasElement) {
  const targetRatio = STANDARD_IMAGE_RATIO;
  const targetWidth = STANDARD_IMAGE_MAX;
  const targetHeight = Math.round(targetWidth / targetRatio);

  const sourceRatio = img.width / img.height;
  let cropX = 0;
  let cropY = 0;
  let cropWidth = img.width;
  let cropHeight = img.height;

  if (sourceRatio > targetRatio) {
    cropWidth = img.height * targetRatio;
    cropX = (img.width - cropWidth) / 2;
  } else if (sourceRatio < targetRatio) {
    cropHeight = img.width / targetRatio;
    cropY = (img.height - cropHeight) / 2;
  }

  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(
    img,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    targetWidth,
    targetHeight,
  );
}

export function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          drawCroppedImage(img, canvas);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
          resolve(dataUrl);
        } catch (error) {
          reject(error instanceof Error ? error : new Error("Image processing error"));
        }
      };
      img.onerror = () => reject(new Error("Image load error"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("File read error"));
    reader.readAsDataURL(file);
  });
}

export function resizeImageToBlob(file: File): Promise<{ blob: Blob; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          drawCroppedImage(img, canvas);
          canvas.toBlob(
            (blob) => {
              if (!blob) return reject(new Error("Could not create blob"));
              const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
              resolve({ blob, dataUrl });
            },
            "image/jpeg",
            0.82,
          );
        } catch (error) {
          reject(error instanceof Error ? error : new Error("Image processing error"));
        }
      };
      img.onerror = () => reject(new Error("Image load error"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("File read error"));
    reader.readAsDataURL(file);
  });
}

/**
 * Capture a representative decoded frame from the first ten seconds so video
 * previews do not inherit a black fade-in at timestamp zero.
 */
export function extractVideoPoster(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.remove();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      if (settled) return;
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) {
        fail(new Error("Impossible de lire la première image de la vidéo"));
        return;
      }

      const maxWidth = 1280;
      const scale = Math.min(1, maxWidth / width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        fail(new Error("Impossible de préparer l'image de couverture"));
        return;
      }

      const capture = () => {
        if (settled) return;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) {
            fail(new Error("Impossible de créer l'image de couverture"));
            return;
          }
          settled = true;
          cleanup();
          resolve(blob);
        }, "image/jpeg", 0.82);
      };

      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      // Prefer a frame a few seconds into the video, while remaining inside
      // the first ten seconds and supporting short clips.
      const previewTime = Math.min(5, Math.max(0.5, duration > 0 ? duration * 0.4 : 2));
      video.onseeked = () => {
        video.onseeked = null;
        requestAnimationFrame(capture);
      };
      try {
        video.currentTime = previewTime;
      } catch {
        video.onseeked = null;
        capture();
      }
    };
    video.onerror = () => fail(new Error("Vidéo non prise en charge"));
    video.src = objectUrl;
    video.load();
  });
}

