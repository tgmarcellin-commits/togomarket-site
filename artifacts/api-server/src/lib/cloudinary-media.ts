import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";

export type MediaKind = "image" | "video" | "audio" | "pdf";
type ResourceType = "image" | "video" | "raw";
export type CloudinaryMedia = {
  publicId: string;
  format: string;
  resourceType: ResourceType;
  deliveryType: "upload" | "authenticated";
};

function configure(): void {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud_name || !api_key || !api_secret) {
    throw new Error("CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are required");
  }
  cloudinary.config({ cloud_name, api_key, api_secret, secure: true });
}

export function parseCloudinaryMediaUrl(value: string | null | undefined): CloudinaryMedia | null {
  if (!value || !process.env.CLOUDINARY_CLOUD_NAME) return null;
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const signed = /^s--[A-Za-z0-9_-]+--$/.test(parts[3] ?? "");
    const versionIndex = signed ? 4 : 3;
    const resourceType = parts[1];
    const deliveryType = parts[2];
    const scope = parts[versionIndex + 2];
    const filename = parts[versionIndex + 3] ?? "";
    const extension = filename.match(/^[a-f0-9-]{36}\.([a-z0-9]+)$/)?.[1];
    if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" ||
        url.port || url.username || url.password || url.search || url.hash ||
        parts[0] !== process.env.CLOUDINARY_CLOUD_NAME ||
        !["image", "video", "raw"].includes(resourceType ?? "") ||
        !["upload", "authenticated"].includes(deliveryType ?? "") ||
        !/^v\d+$/.test(parts[versionIndex] ?? "") ||
        parts[versionIndex + 1] !== "togomarket" ||
        !["public", "private"].includes(scope ?? "") ||
        parts.length !== versionIndex + 4 ||
        (deliveryType === "authenticated") !== (scope === "private") ||
        (deliveryType === "upload" && signed) ||
        !extension ||
        (resourceType === "image" && !["jpg", "jpeg", "png", "webp"].includes(extension)) ||
        (resourceType === "video" && !["mp4", "webm", "ogg", "wav", "mp3", "m4a"].includes(extension)) ||
        (resourceType === "raw" && extension !== "pdf")) return null;
    return {
      publicId: `togomarket/${scope}/${resourceType === "raw" ? filename : filename.slice(0, -extension.length - 1)}`,
      format: extension,
      resourceType: resourceType as ResourceType,
      deliveryType: deliveryType as "upload" | "authenticated",
    };
  } catch {
    return null;
  }
}

export async function uploadCloudinaryMedia(
  buffer: Buffer,
  kind: MediaKind,
  owner: string,
  privateAccess = false,
): Promise<string> {
  configure();
  const resourceType: ResourceType = kind === "image" ? "image" : kind === "pdf" ? "raw" : "video";
  const publicId = `togomarket/${privateAccess ? "private" : "public"}/${randomUUID()}${kind === "pdf" ? ".pdf" : ""}`;
  const deliveryType = privateAccess ? "authenticated" : "upload";
  const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      resource_type: resourceType,
      type: deliveryType,
      public_id: publicId,
      overwrite: false,
      context: { owner },
    }, (error, response) => {
      if (error || !response?.secure_url) reject(error ?? new Error("Cloudinary returned no secure URL"));
      else resolve(response);
    });
    stream.end(buffer);
  });

  // Authenticated Cloudinary secure_url includes a permanent signature.
  // Store the unsigned HTTPS URL; only issue expiring links after chat access checks.
  const storedUrl = privateAccess
    ? result.secure_url.replace(/\/s--[A-Za-z0-9_-]+--\/(?=v\d+\/togomarket\/private\/)/, "/")
    : result.secure_url;
  const parsed = parseCloudinaryMediaUrl(storedUrl);
  if (!parsed || parsed.publicId !== publicId || parsed.resourceType !== resourceType ||
      parsed.deliveryType !== deliveryType || (privateAccess && storedUrl === result.secure_url)) {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, type: deliveryType }).catch(() => {});
    throw new Error("Cloudinary returned an unexpected media URL");
  }
  return storedUrl;
}

export function signedPrivateCloudinaryMediaUrl(value: string): string | null {
  const parsed = parseCloudinaryMediaUrl(value);
  if (!parsed || parsed.deliveryType !== "authenticated") return null;
  configure();
  return cloudinary.utils.private_download_url(
    parsed.publicId, parsed.resourceType === "raw" ? "" : parsed.format, {
      resource_type: parsed.resourceType,
      type: "authenticated",
      expires_at: Math.floor(Date.now() / 1000) + 300,
    },
  );
}

export async function isCloudinaryMediaOwnedBy(value: string, owner: string): Promise<boolean> {
  const parsed = parseCloudinaryMediaUrl(value);
  if (!parsed || parsed.deliveryType !== "upload") return false;
  configure();
  const resource = await cloudinary.api.resource(parsed.publicId, {
    resource_type: parsed.resourceType, type: "upload", context: true,
  });
  return resource.secure_url === value && resource.context?.custom?.owner === owner;
}

export async function deleteCloudinaryMedia(value: string): Promise<void> {
  const parsed = parseCloudinaryMediaUrl(value);
  if (!parsed) return;
  configure();
  const result = await cloudinary.uploader.destroy(parsed.publicId, {
    resource_type: parsed.resourceType, type: parsed.deliveryType,
  });
  if (result.result !== "ok" && result.result !== "not found") {
    throw new Error(`Cloudinary deletion failed: ${result.result}`);
  }
}

export async function listCloudinaryMedia(): Promise<string[]> {
  configure();
  const urls: string[] = [];
  for (const resource_type of ["image", "video", "raw"] as const) {
    for (const type of ["upload", "authenticated"] as const) {
      let next_cursor: string | undefined;
      do {
        const page = await cloudinary.api.resources({
          resource_type, type, prefix: "togomarket/", max_results: 500, next_cursor,
        });
        for (const resource of page.resources) {
          const url = type === "authenticated"
            ? resource.secure_url.replace(/\/s--[A-Za-z0-9_-]+--\/(?=v\d+\/togomarket\/private\/)/, "/")
            : resource.secure_url;
          if (parseCloudinaryMediaUrl(url)) urls.push(url);
        }
        next_cursor = page.next_cursor;
      } while (next_cursor);
    }
  }
  return urls;
}