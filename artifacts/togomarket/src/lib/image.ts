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

/** Capture the first decoded frame so video cards never need a black poster. */
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

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = () => {
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
    video.onerror = () => fail(new Error("Vidéo non prise en charge"));
    video.src = objectUrl;
    video.load();
  });
}
