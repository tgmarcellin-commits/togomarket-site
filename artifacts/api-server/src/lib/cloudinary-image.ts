import {
  deleteCloudinaryMedia,
  isCloudinaryMediaOwnedBy,
  parseCloudinaryMediaUrl,
  uploadCloudinaryMedia,
} from "./cloudinary-media";

export function parseCloudinaryImageUrl(value: string | null | undefined) {
  const parsed = parseCloudinaryMediaUrl(value);
  return parsed?.resourceType === "image" ? parsed : null;
}

export function uploadCloudinaryImage(buffer: Buffer, owner: string, privateAccess = false) {
  return uploadCloudinaryMedia(buffer, "image", owner, privateAccess);
}

export function isCloudinaryImageOwnedBy(value: string, owner: string) {
  return parseCloudinaryImageUrl(value)?.deliveryType === "upload"
    ? isCloudinaryMediaOwnedBy(value, owner)
    : Promise.resolve(false);
}

export async function deleteCloudinaryImage(value: string): Promise<void> {
  if (parseCloudinaryImageUrl(value)) await deleteCloudinaryMedia(value);
}