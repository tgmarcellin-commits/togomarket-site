import { fileURLToPath } from "node:url";
import { parseCloudinaryMediaUrl, uploadCloudinaryMedia } from "../lib/cloudinary-media";

const LISTING_COVER_TRANSFORMATION = "c_fill,ar_4:3,g_auto,w_1400,h_1050,f_jpg,q_auto";

type NormalizeOptions = {
  dryRun: boolean;
  apply: boolean;
  confirmApply: boolean;
  verbose: boolean;
  limit?: number;
};

type NormalizeStats = {
  listingsScanned: number;
  imageRefsScanned: number;
  planned: number;
  migrated: number;
  skippedVideos: number;
  skippedUnsupported: number;
  skippedFetchErrors: number;
};

export function parseNormalizeListingImageArgs(argv: string[]): NormalizeOptions {
  const apply = argv.includes("--apply");
  const confirmApply = argv.includes("--confirm-apply");
  const verbose = argv.includes("--verbose");
  const dryRun = !apply;

  const limitArg = argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined;
  if (limitArg && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }

  if (apply && !confirmApply) {
    throw new Error("Real execution requires --confirm-apply in addition to --apply");
  }

  return { dryRun, apply, confirmApply, verbose, limit };
}

export function buildListingCoverTransformationUrl(imageUrl: string): string | null {
  const parsed = parseCloudinaryMediaUrl(imageUrl);
  if (!parsed || parsed.resourceType !== "image" || parsed.deliveryType !== "upload") {
    return null;
  }

  const url = new URL(imageUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 5) return null;

  const hasSignatureSegment = /^s--[A-Za-z0-9_-]+--$/.test(parts[3] ?? "");
  if (hasSignatureSegment) {
    return null;
  }

  const transformedPath = `/${[parts[0], parts[1], parts[2], LISTING_COVER_TRANSFORMATION, ...parts.slice(3)].join("/")}`;
  const transformedUrl = new URL(url.toString());
  transformedUrl.pathname = transformedPath;
  transformedUrl.search = "";
  transformedUrl.hash = "";
  return transformedUrl.toString();
}

async function fetchTransformedImageBuffer(transformedUrl: string): Promise<Buffer> {
  const response = await fetch(transformedUrl);
  if (!response.ok) {
    throw new Error(`Transformation fetch failed (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function normalizeListingImages(options: NormalizeOptions): Promise<NormalizeStats> {
  const { db, listingsTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const stats: NormalizeStats = {
    listingsScanned: 0,
    imageRefsScanned: 0,
    planned: 0,
    migrated: 0,
    skippedVideos: 0,
    skippedUnsupported: 0,
    skippedFetchErrors: 0,
  };

  const listings = await db
    .select({ id: listingsTable.id, images: listingsTable.images })
    .from(listingsTable)
    .orderBy(listingsTable.id);

  for (const listing of listings) {
    stats.listingsScanned += 1;
    const originalImages = listing.images ?? [];
    if (originalImages.length === 0) continue;

    const nextImages = [...originalImages];
    let listingChanged = false;

    for (let index = 0; index < originalImages.length; index += 1) {
      if (options.limit && stats.planned >= options.limit) break;

      const image = originalImages[index];
      stats.imageRefsScanned += 1;

      if (image.startsWith("v:")) {
        stats.skippedVideos += 1;
        continue;
      }

      const transformedUrl = buildListingCoverTransformationUrl(image);
      if (!transformedUrl) {
        stats.skippedUnsupported += 1;
        continue;
      }

      stats.planned += 1;
      const prefix = options.dryRun ? "[dry-run]" : "[apply]";
      console.log(`${prefix} listing#${listing.id} image[${index}] => crop 4:3`);
      if (options.verbose) {
        console.log(`  from: ${image}`);
      }

      if (options.dryRun) {
        if (options.verbose) {
          console.log(`  preview transformation: ${transformedUrl}`);
        }
        continue;
      }

      try {
        const transformedBuffer = await fetchTransformedImageBuffer(transformedUrl);
        const migratedUrl = await uploadCloudinaryMedia(
          transformedBuffer,
          "image",
          "migration:normalize-listing-images",
        );
        nextImages[index] = migratedUrl;
        listingChanged = true;
        stats.migrated += 1;
        if (options.verbose) {
          console.log(`  to: ${migratedUrl}`);
        }
      } catch (error) {
        stats.skippedFetchErrors += 1;
        console.warn(
          `[warn] listing#${listing.id} image[${index}] skipped: ${(error as Error).message}`,
        );
      }
    }

    if (options.apply && listingChanged) {
      await db
        .update(listingsTable)
        .set({ images: nextImages })
        .where(eq(listingsTable.id, listing.id));
    }

    if (options.limit && stats.planned >= options.limit) break;
  }

  return stats;
}

async function main() {
  const options = parseNormalizeListingImageArgs(process.argv.slice(2));
  if (options.dryRun) {
    console.log("[mode] dry-run (default): no DB writes, no media replacement");
  } else {
    console.log("[mode] apply: writing updated listing image references");
  }

  const stats = await normalizeListingImages(options);
  console.log("[summary]", JSON.stringify(stats, null, 2));
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("normalize-listing-images failed:", (error as Error).message);
    process.exitCode = 1;
  });
}
