import { Storage } from "@google-cloud/storage";
import { db, listingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

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

function getPrivateObjectDir(): string {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set");
  return dir;
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) path = `/${path}`;
  const parts = path.split("/");
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

async function uploadBase64Image(base64DataUrl: string): Promise<string> {
  const match = base64DataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) throw new Error("Invalid base64 data URL");

  const contentType = match[1];
  const buffer = Buffer.from(match[2], "base64");

  const privateObjectDir = getPrivateObjectDir();
  const objectId = randomUUID();
  const fullPath = `${privateObjectDir}/uploads/${objectId}`;
  const { bucketName, objectName } = parseObjectPath(fullPath);

  const bucket = storageClient.bucket(bucketName);
  const file = bucket.file(objectName);
  await file.save(buffer, { contentType, resumable: false });

  return `/objects/uploads/${objectId}`;
}

async function migrateImages() {
  console.log("Démarrage de la migration des images...");

  const listings = await db.select().from(listingsTable);
  console.log(`${listings.length} annonce(s) trouvée(s)`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const listing of listings) {
    const hasBase64 = listing.images.some((img) => img.startsWith("data:"));
    const alreadyMigrated = listing.images.every(
      (img) => img.startsWith("/objects/") || img === ""
    );

    if (alreadyMigrated || listing.images.length === 0) {
      skipped++;
      continue;
    }

    if (!hasBase64) {
      skipped++;
      continue;
    }

    try {
      const newImages: string[] = [];
      for (const img of listing.images) {
        if (img.startsWith("data:")) {
          const objectPath = await uploadBase64Image(img);
          newImages.push(objectPath);
          process.stdout.write(".");
        } else {
          newImages.push(img);
        }
      }

      await db
        .update(listingsTable)
        .set({ images: newImages })
        .where(eq(listingsTable.id, listing.id));

      migrated++;
      console.log(`\n✅ Annonce #${listing.id} (${listing.name}) — ${newImages.length} image(s) migrée(s)`);
    } catch (err) {
      errors++;
      console.error(`\n❌ Erreur pour l'annonce #${listing.id}:`, err);
    }
  }

  console.log("\n--- Résultat ---");
  console.log(`✅ Migrées : ${migrated}`);
  console.log(`⏭  Déjà OK : ${skipped}`);
  console.log(`❌ Erreurs : ${errors}`);
}

migrateImages()
  .then(() => {
    console.log("Migration terminée.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Erreur fatale:", err);
    process.exit(1);
  });
