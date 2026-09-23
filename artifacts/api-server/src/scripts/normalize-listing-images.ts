import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { db, listingsTable } from "@workspace/db";
import { parseCloudinaryImageUrl, uploadCloudinaryImage } from "../lib/cloudinary-image";

const APPLY_CONFIRMATION = "normalize-listing-images";
const TARGET_TRANSFORMATION = "c_fill,ar_4:3,g_auto,w_1400,h_1050,f_jpg,q_auto";

type ScriptOptions = {
  apply: boolean;
  confirm?: string;
  limit?: number;
  listingId?: number;
  verbose: boolean;
};

function parseOptions(): ScriptOptions {
  const parsed = parseArgs({
    options: {
      apply: { type: "boolean", default: false },
      confirm: { type: "string" },
      limit: { type: "string" },
      listingId: { type: "string" },
      verbose: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const limit = parsed.values.limit ? Number(parsed.values.limit) : undefined;
  const listingId = parsed.values.listingId ? Number(parsed.values.listingId) : undefined;

  return {
    apply: parsed.values.apply,
    confirm: parsed.values.confirm,
    limit: Number.isInteger(limit) && (limit ?? 0) > 0 ? limit : undefined,
    listingId: Number.isInteger(listingId) && (listingId ?? 0) > 0 ? listingId : undefined,
    verbose: parsed.values.verbose,
  };
}

function transformedCloudinaryUrl(imageUrl: string): string | null {
  const parsed = parseCloudinaryImageUrl(imageUrl);
  if (!parsed || parsed.deliveryType !== "upload") return null;
  const marker = `/${parsed.resourceType}/${parsed.deliveryType}/`;
  const markerIndex = imageUrl.indexOf(marker);
  if (markerIndex < 0) return null;
  const prefix = imageUrl.slice(0, markerIndex + marker.length);
  const suffix = imageUrl.slice(markerIndex + marker.length);
  return `${prefix}${TARGET_TRANSFORMATION}/${suffix}`;
}

async function normalizeImage(imageUrl: string): Promise<string | null> {
  const transformedUrl = transformedCloudinaryUrl(imageUrl);
  if (!transformedUrl) return null;
  const response = await fetch(transformedUrl);
  if (!response.ok) {
    throw new Error(`Cloudinary transformation failed (${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return uploadCloudinaryImage(buffer, "admin-media");
}

async function main() {
  const options = parseOptions();
  const dryRun = !options.apply;
  const canApply = options.apply && options.confirm === APPLY_CONFIRMATION;

  if (options.apply && !canApply) {
    console.error(
      `Refusing apply mode without explicit confirmation. Re-run with --apply --confirm=${APPLY_CONFIRMATION}`,
    );
    process.exit(1);
  }

  console.log(
    dryRun
      ? "[dry-run] Listing image migration preview (no database writes)."
      : "[apply] Listing image migration started.",
  );

  let query = db
    .select({ id: listingsTable.id, images: listingsTable.images })
    .from(listingsTable)
    .$dynamic();

  if (options.listingId) {
    query = query.where(eq(listingsTable.id, options.listingId));
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }

  const listings = await query;
  let scanned = 0;
  let candidates = 0;
  let updatedListings = 0;
  let replacedImages = 0;

  for (const listing of listings) {
    const sourceImages = Array.isArray(listing.images) ? listing.images : [];
    if (sourceImages.length === 0) continue;
    scanned += 1;

    let changed = false;
    const nextImages: string[] = [];

    for (const raw of sourceImages) {
      if (typeof raw !== "string" || raw.length === 0) {
        nextImages.push(raw);
        continue;
      }
      if (raw.startsWith("v:")) {
        nextImages.push(raw);
        continue;
      }
      if (!parseCloudinaryImageUrl(raw)) {
        nextImages.push(raw);
        continue;
      }

      candidates += 1;
      if (dryRun) {
        if (options.verbose) {
          console.log(`[dry-run] listing#${listing.id} image candidate: ${raw}`);
        }
        nextImages.push(raw);
        continue;
      }

      const normalized = await normalizeImage(raw);
      if (!normalized) {
        nextImages.push(raw);
        continue;
      }
      changed = true;
      replacedImages += 1;
      nextImages.push(normalized);
      if (options.verbose) {
        console.log(`[apply] listing#${listing.id} replaced image -> ${normalized}`);
      }
    }

    if (!dryRun && changed) {
      await db
        .update(listingsTable)
        .set({ images: nextImages })
        .where(eq(listingsTable.id, listing.id));
      updatedListings += 1;
    }
  }

  console.log(`Listings scanned: ${scanned}`);
  console.log(`Image candidates: ${candidates}`);
  if (dryRun) {
    console.log("No data changed. Use --apply with explicit --confirm to perform updates.");
    return;
  }
  console.log(`Listings updated: ${updatedListings}`);
  console.log(`Images replaced: ${replacedImages}`);
}

await main();
