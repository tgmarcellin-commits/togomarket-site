import { parseCloudinaryImageUrl } from "./cloudinary-image";
const PROFILE_PHOTO_OBJECT_PATH = /^\/objects\/uploads\/[^/]+$/;

export function isValidProfilePhotoPath(value: string): boolean {
  return PROFILE_PHOTO_OBJECT_PATH.test(value) || parseCloudinaryImageUrl(value)?.deliveryType === "upload";
}

export function normalizeProfilePhoto(value: string | null | undefined): string | null {
  const normalized = value?.trim() || null;
  return normalized && isValidProfilePhotoPath(normalized) ? normalized : null;
}