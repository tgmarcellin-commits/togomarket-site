export function resolveImageUrl(img: string): string {
  // Retirer le préfixe vidéo v: s'il est présent (les chemins vidéo Tourisme)
  if (img.startsWith("v:")) img = img.slice(2);
  if (img.startsWith("data:") || img.startsWith("http") || img.startsWith("blob:")) return img;
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
