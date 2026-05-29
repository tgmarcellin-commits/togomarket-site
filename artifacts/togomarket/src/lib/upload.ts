interface UploadResponse {
  uploadURL: string;
  objectPath: string;
}

export async function uploadVideoFile(file: File): Promise<string> {
  const metaRes = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "video/mp4" }),
  });
  if (!metaRes.ok) throw new Error("Impossible d'obtenir l'URL d'upload");
  const { uploadURL, objectPath }: UploadResponse = await metaRes.json();

  const putRes = await fetch(uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "video/mp4" },
  });
  if (!putRes.ok) throw new Error("Échec de l'envoi de la vidéo");

  return objectPath;
}
