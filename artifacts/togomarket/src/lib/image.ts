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

export const LISTING_IMAGE_TARGET_RATIO = 4 / 3;
export const LISTING_IMAGE_MAX_WIDTH = 1400;

export interface CoverCropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export function getCoverCropRect(sourceWidth: number, sourceHeight: number, targetRatio: number): CoverCropRect {
  if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(targetRatio > 0)) {
    return { sx: 0, sy: 0, sw: Math.max(1, sourceWidth), sh: Math.max(1, sourceHeight) };
  }
  const sourceRatio = sourceWidth / sourceHeight;
  if (sourceRatio > targetRatio) {
    const sw = sourceHeight * targetRatio;
    return { sx: (sourceWidth - sw) / 2, sy: 0, sw, sh: sourceHeight };
  }
  const sh = sourceWidth / targetRatio;
  return { sx: 0, sy: (sourceHeight - sh) / 2, sw: sourceWidth, sh };
}

export function getCoverOutputSize(cropWidth: number, targetRatio: number, maxWidth: number): { width: number; height: number } {
  const width = Math.max(1, Math.round(Math.min(cropWidth, maxWidth)));
  const height = Math.max(1, Math.round(width / targetRatio));
  return { width, height };
}

export function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        const max = 800;

        if (width > height) {
          if (width > max) {
            height = Math.round((height * max) / width);
            width = max;
          }
        } else {
          if (height > max) {
            width = Math.round((width * max) / height);
            height = max;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Could not get canvas context"));

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        resolve(dataUrl);
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
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        const max = 800;

        if (width > height) {
          if (width > max) {
            height = Math.round((height * max) / width);
            width = max;
          }
        } else {
          if (height > max) {
            width = Math.round((width * max) / height);
            height = max;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Could not get canvas context"));

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error("Could not create blob"));
            resolve({ blob, dataUrl });
          },
          "image/jpeg",
          0.7
        );
      };
      img.onerror = () => reject(new Error("Image load error"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("File read error"));
    reader.readAsDataURL(file);
  });
}

export function resizeListingImageToBlob(file: File): Promise<{ blob: Blob; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const crop = getCoverCropRect(img.width, img.height, LISTING_IMAGE_TARGET_RATIO);
        const { width, height } = getCoverOutputSize(crop.sw, LISTING_IMAGE_TARGET_RATIO, LISTING_IMAGE_MAX_WIDTH);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Could not get canvas context"));
        ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error("Could not create blob"));
            resolve({ blob, dataUrl });
          },
          "image/jpeg",
          0.82
        );
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
