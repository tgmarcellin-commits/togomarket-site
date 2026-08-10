interface UploadResponse {
  uploadURL: string;
  objectPath: string;
}

async function requestUploadUrl(file: File | { name: string; size: number; type: string }): Promise<UploadResponse> {
  const metaRes = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
  });
  if (!metaRes.ok) throw new Error("Impossible d'obtenir l'URL d'upload");
  return metaRes.json() as Promise<UploadResponse>;
}

const VIDEO_COMPRESS_THRESHOLD = 30 * 1024 * 1024; // 30 MB

/**
 * Upload a video file.
 * - If the file is larger than 30 MB, it goes through the server-side
 *   compression endpoint (ffmpeg 720p, CRF 26) before being stored.
 * - Smaller files are uploaded directly to object storage via a presigned URL.
 */
export async function uploadVideoFile(
  file: File,
  onProgress?: (status: "compressing" | "uploading") => void,
): Promise<string> {
  // For large videos, try server-side ffmpeg compression first.
  // If the server can't compress (ffmpeg unavailable, timeout, etc.),
  // fall back silently to a direct presigned-URL upload.
  if (file.size > VIDEO_COMPRESS_THRESHOLD) {
    onProgress?.("compressing");
    try {
      const form = new FormData();
      form.append("video", file);
      const res = await fetch("/api/storage/uploads/video", {
        method: "POST",
        body: form,
      });
      if (res.ok) {
        const { objectPath } = await res.json() as { objectPath: string };
        return objectPath;
      }
      // Non-OK response → fall through to direct upload below
    } catch {
      // Network / timeout error → fall through
    }
  }

  // Direct upload via presigned URL (small files, or fallback for large ones)
  onProgress?.("uploading");
  const { uploadURL, objectPath } = await requestUploadUrl(file);
  const putRes = await fetch(uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "video/mp4" },
  });
  if (!putRes.ok) throw new Error("Échec de l'envoi de la vidéo");
  return objectPath;
}

export async function uploadImageFile(blob: Blob, filename: string): Promise<string> {
  const { uploadURL, objectPath } = await requestUploadUrl({
    name: filename,
    size: blob.size,
    type: blob.type || "image/jpeg",
  });

  const putRes = await fetch(uploadURL, {
    method: "PUT",
    body: blob,
    headers: { "Content-Type": blob.type || "image/jpeg" },
  });
  if (!putRes.ok) throw new Error("Échec de l'envoi de l'image");

  return objectPath;
}
