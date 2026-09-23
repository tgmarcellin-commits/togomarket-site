import { parseCloudinaryImageUrl } from "./cloudinary-image";
export function isValidProfilePhotoPath(value: string): boolean {
  return parseCloudinaryImageUrl(value)?.deliveryType === "upload";
}

export function normalizeProfilePhoto(value: string | null | undefined): string | null {
  const normalized = value?.trim() || null;
  return normalized && isValidProfilePhotoPath(normalized) ? normalized : null;
}