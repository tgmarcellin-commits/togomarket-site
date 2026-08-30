export type UploadAuth =
  | { adminCode: string }
  | { vendorPhone: string; vendorPassword: string; tourismeListingId?: number };

function uploadHeaders(auth: UploadAuth): HeadersInit {
  if ("adminCode" in auth) return { "X-Admin-Code": auth.adminCode };
  return {
    "X-Vendor-Phone": auth.vendorPhone,
    "X-Vendor-Password": auth.vendorPassword,
    ...(auth.tourismeListingId
      ? { "X-Tourisme-Listing-Id": String(auth.tourismeListingId) }
      : {}),
  };
}

/**
 * Upload a video file.
 * Every video goes through server-side signature checks and bounded ffmpeg
 * transcoding. There is deliberately no direct-upload fallback.
 */
export async function uploadVideoFile(
  file: File,
  auth: UploadAuth,
  onProgress?: (status: "compressing" | "uploading") => void,
): Promise<string> {
  onProgress?.("compressing");
  const form = new FormData();
  form.append("video", file);
  const response = await fetch("/api/storage/uploads/video", {
    method: "POST",
    headers: uploadHeaders(auth),
    body: form,
  });
  if (!response.ok) throw new Error("Vidéo invalide, trop volumineuse ou non prise en charge");
  const { objectPath } = await response.json() as { objectPath: string };
  onProgress?.("uploading");
  return objectPath;
}

export async function uploadImageFile(blob: Blob, filename: string, auth: UploadAuth): Promise<string> {
  const form = new FormData();
  form.append("image", blob, filename);
  const response = await fetch("/api/storage/uploads/image", {
    method: "POST",
    headers: uploadHeaders(auth),
    body: form,
  });
  if (!response.ok) throw new Error("Image invalide ou trop volumineuse");
  const { objectPath } = await response.json() as { objectPath: string };
  return objectPath;
}
