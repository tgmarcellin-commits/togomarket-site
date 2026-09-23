import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";

type CloudinaryImage = { publicId: string; format: string; deliveryType: "upload" | "authenticated" };

function configure() {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud_name || !api_key || !api_secret) {
    throw new Error("CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are required");
  }
  cloudinary.config({ cloud_name, api_key, api_secret, secure: true });
  return cloud_name;
}

export function parseCloudinaryImageUrl(value: string | null | undefined): CloudinaryImage | null {
  if (!value || !process.env.CLOUDINARY_CLOUD_NAME) return null;
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const hasSignature = /^s--[A-Za-z0-9_-]+--$/.test(parts[3] ?? "");
    const versionIndex = hasSignature ? 4 : 3;
    if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" ||
        url.username || url.password || url.search || url.hash ||
        parts[0] !== process.env.CLOUDINARY_CLOUD_NAME ||
        parts[1] !== "image" ||
        !["upload", "authenticated"].includes(parts[2] ?? "") ||
        !/^v\d+$/.test(parts[versionIndex] ?? "") ||
        parts[versionIndex + 1] !== "togomarket" ||
        !["public", "private"].includes(parts[versionIndex + 2] ?? "") ||
        !/^[a-f0-9-]{36}\.(jpe?g|png|webp)$/.test(parts[versionIndex + 3] ?? "") ||
        parts.length !== versionIndex + 4 ||
        (parts[2] === "authenticated") !== (parts[versionIndex + 2] === "private") ||
        (parts[2] === "upload" && hasSignature)) return null;
    const [id, format] = parts[versionIndex + 3].split(".");
    return { publicId: `togomarket/${parts[versionIndex + 2]}/${id}`, format, deliveryType: parts[2] as "upload" | "authenticated" };
  } catch {
    return null;
  }
}

export async function uploadCloudinaryImage(
  buffer: Buffer,
  owner: string,
  privateAccess = false,
): Promise<string> {
  configure();
  const publicId = `togomarket/${privateAccess ? "private" : "public"}/${randomUUID()}`;
  const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      resource_type: "image",
      type: privateAccess ? "authenticated" : "upload",
      public_id: publicId,
      overwrite: false,
      context: { owner },
    }, (error, response) => {
      if (error || !response?.secure_url) reject(error ?? new Error("Cloudinary returned no secure URL"));
      else resolve(response);
    });
    stream.end(buffer);
  });
  if (!parseCloudinaryImageUrl(result.secure_url)) {
    throw new Error("Cloudinary returned an unexpected image URL");
  }
  // Cloudinary's authenticated secure_url contains a permanent delivery
  // signature. Never persist that signature for private chat attachments.
  const storedUrl = privateAccess
    ? result.secure_url.replace(/\/s--[A-Za-z0-9_-]+--\/(?=v\d+\/togomarket\/private\/)/, "/")
    : result.secure_url;
  if (privateAccess && (storedUrl === result.secure_url ||
      parseCloudinaryImageUrl(storedUrl)?.deliveryType !== "authenticated")) {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image", type: "authenticated" });
    throw new Error("Cloudinary did not return a removable private delivery signature");
  }
  return storedUrl;
}

export async function isCloudinaryImageOwnedBy(value: string, owner: string): Promise<boolean> {
  const parsed = parseCloudinaryImageUrl(value);
  if (!parsed || parsed.deliveryType !== "upload") return false;
  configure();
  const resource = await cloudinary.api.resource(parsed.publicId, {
    resource_type: "image", type: parsed.deliveryType, context: true,
  });
  return resource.secure_url === value && resource.context?.custom?.owner === owner;
}

export function signedPrivateCloudinaryImageUrl(value: string): string | null {
  const parsed = parseCloudinaryImageUrl(value);
  if (!parsed || parsed.deliveryType !== "authenticated") return null;
  configure();
  return cloudinary.utils.private_download_url(parsed.publicId, parsed.format, {
    resource_type: "image",
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + 300,
  });
}

export async function deleteCloudinaryImage(value: string): Promise<void> {
  const parsed = parseCloudinaryImageUrl(value);
  if (!parsed) return;
  configure();
  await cloudinary.uploader.destroy(parsed.publicId, { resource_type: "image", type: parsed.deliveryType });
}