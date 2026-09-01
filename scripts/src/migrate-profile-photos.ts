import { Storage } from "@google-cloud/storage";
import { db, pool, vendorsTable } from "@workspace/db";
import { and, eq, like } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const storageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

type DecodedImage = {
  buffer: Buffer;
  contentType: string;
};

function getPrivateObjectDir(): string {
  const dir = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!dir) {
    throw new Error("PRIVATE_OBJECT_DIR must be configured");
  }
  return dir;
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const parts = normalizedPath.split("/");
  if (parts.length < 3 || !parts[1] || !parts.slice(2).join("/")) {
    throw new Error(`Invalid object path: ${path}`);
  }
  return {
    bucketName: parts[1],
    objectName: parts.slice(2).join("/"),
  };
}

export function decodeImageDataUrl(dataUrl: string): DecodedImage {
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex < 0) {
    throw new Error("profile photo is not a data URL");
  }

  const metadata = dataUrl.slice("data:".length, commaIndex).split(";");
  const contentType = metadata.shift()?.trim().toLowerCase();
  if (!contentType?.startsWith("image/") || !metadata.some((part) => part.toLowerCase() === "base64")) {
    throw new Error("profile photo is not a base64 image");
  }

  const encoded = dataUrl.slice(commaIndex + 1).replace(/\s/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error("profile photo contains invalid base64");
  }

  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length === 0) {
    throw new Error("profile photo is empty");
  }

  return { buffer, contentType };
}

async function uploadImage(image: DecodedImage): Promise<string> {
  const objectId = randomUUID();
  const fullPath = `${getPrivateObjectDir()}/uploads/${objectId}`;
  const { bucketName, objectName } = parseObjectPath(fullPath);
  const file = storageClient.bucket(bucketName).file(objectName);

  await file.save(image.buffer, {
    contentType: image.contentType,
    resumable: false,
  });

  return `/objects/uploads/${objectId}`;
}

async function deleteUploadedImage(objectPath: string): Promise<void> {
  const privateObjectDir = getPrivateObjectDir().replace(/\/+$/, "");
  const entityPath = objectPath.replace(/^\/objects\/?/, "");
  const { bucketName, objectName } = parseObjectPath(`${privateObjectDir}/${entityPath}`);
  await storageClient.bucket(bucketName).file(objectName).delete({ ignoreNotFound: true });
}

export async function persistMigratedProfilePhoto({
  vendorId,
  originalPhoto,
  objectPath,
  updateIfUnchanged,
  deleteUploadedObject,
}: {
  vendorId: number;
  originalPhoto: string;
  objectPath: string;
  updateIfUnchanged: (
    vendorId: number,
    originalPhoto: string,
    objectPath: string,
  ) => Promise<boolean>;
  deleteUploadedObject: (objectPath: string) => Promise<void>;
}): Promise<boolean> {
  const updated = await updateIfUnchanged(vendorId, originalPhoto, objectPath);
  if (updated) {
    return true;
  }

  await deleteUploadedObject(objectPath);
  return false;
}

export async function migrateProfilePhotos(): Promise<void> {
  console.log("Démarrage de la migration des photos de profil vendeur...");

  const vendors = await db
    .select({
      id: vendorsTable.id,
      profilePhoto: vendorsTable.profilePhoto,
    })
    .from(vendorsTable)
    .where(like(vendorsTable.profilePhoto, "data:%"));

  console.log(`${vendors.length} photo(s) de profil à migrer`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const vendor of vendors) {
    const originalPhoto = vendor.profilePhoto;
    if (!originalPhoto?.startsWith("data:")) {
      skipped++;
      continue;
    }

    let objectPath: string | undefined;
    try {
      const image = decodeImageDataUrl(originalPhoto);
      objectPath = await uploadImage(image);

      const updated = await persistMigratedProfilePhoto({
        vendorId: vendor.id,
        originalPhoto,
        objectPath,
        updateIfUnchanged: async (vendorId, expectedPhoto, nextPhoto) => {
          const rows = await db
            .update(vendorsTable)
            .set({ profilePhoto: nextPhoto })
            .where(and(
              eq(vendorsTable.id, vendorId),
              eq(vendorsTable.profilePhoto, expectedPhoto),
            ))
            .returning({ id: vendorsTable.id });
          return rows.length > 0;
        },
        deleteUploadedObject: deleteUploadedImage,
      });

      if (!updated) {
        objectPath = undefined;
        skipped++;
        console.log(`⏭ Vendeur #${vendor.id} — photo modifiée pendant la migration`);
        continue;
      }

      migrated++;
      console.log(`✅ Vendeur #${vendor.id} — photo migrée (${image.buffer.length} octets)`);
    } catch (error) {
      errors++;
      if (objectPath) {
        await deleteUploadedImage(objectPath).catch((cleanupError) => {
          console.error(`⚠️ Impossible de supprimer l'objet temporaire du vendeur #${vendor.id}:`, cleanupError);
        });
      }
      console.error(`❌ Erreur pour le vendeur #${vendor.id}:`, error);
    }
  }

  console.log("\n--- Résultat ---");
  console.log(`✅ Migrées : ${migrated}`);
  console.log(`⏭ Déjà OK : ${skipped}`);
  console.log(`❌ Erreurs : ${errors}`);

  if (errors > 0) {
    throw new Error(`${errors} photo(s) de profil n'ont pas pu être migrée(s)`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateProfilePhotos()
    .then(async () => {
      await pool.end();
      console.log("Migration terminée.");
    })
    .catch(async (error) => {
      console.error("Erreur fatale:", error);
      await pool.end();
      process.exitCode = 1;
    });
}