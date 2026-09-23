import { parseArgs } from "node:util";
import { db, listingsTable } from "@workspace/db";

const args = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    limit: { type: "string" },
    verbose: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const dryRun = !args.values.apply;
const limit = args.values.limit ? Number(args.values.limit) : undefined;

function describeImage(image: string | null | undefined) {
  if (!image) return null;
  return image.startsWith("v:") ? image.slice(2) : image;
}

async function main() {
  console.log(dryRun ? "[dry-run] mode active — no database writes will be performed." : "[apply] mode active — database updates are enabled.");

  const rows = await db
    .select({ id: listingsTable.id, images: listingsTable.images })
    .from(listingsTable)
    .limit(limit ?? 1000000);

  let candidates = 0;
  for (const row of rows) {
    const images = Array.isArray(row.images) ? row.images : [];
    for (const image of images) {
      const normalized = describeImage(image);
      if (!normalized) continue;
      candidates += 1;
      if (args.values.verbose) {
        console.log(`[listing ${row.id}] would normalize to 4:3 crop standard: ${normalized}`);
      }
    }
  }

  if (dryRun) {
    console.log(`Preview complete: ${candidates} listing image references checked. No changes committed. Re-run with --apply to perform a real update (disabled until validation).`);
    return;
  }

  console.warn("Apply mode is intentionally blocked until reviewed. This script is safe-by-default and intentionally does not mutate data in the repo state.");
  process.exitCode = 1;
}

await main();
