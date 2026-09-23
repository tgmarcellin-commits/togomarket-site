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

export async function uploadVideoFile(file: File): Promise<string> {
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
