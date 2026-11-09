import { Router, type IRouter } from "express";
import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { db, listingsTable, vendorsTable } from "@workspace/db";

/**
 * Page de partage d'un article : GET /a/:id
 * - fournit les balises Open Graph (image, titre, prix, lieu, date) lues par WhatsApp/Facebook
 *   pour afficher l'aperçu du lien ;
 * - redirige immédiatement les visiteurs vers /?listing=:id, qui ouvre l'article sur TogoMarket.
 */
const router: IRouter = Router();

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value: string) => value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

const isVideo = (path: string) => path.startsWith("v:") || /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(path);

/** Même logique que resolveImageUrl côté front, mais en URL absolue (requise par Open Graph). */
function absoluteImageUrl(origin: string, img: string): string {
  if (img.startsWith("http")) return img;
  if (img.startsWith("/api/")) return `${origin}${img}`;
  return `${origin}/api/storage${img}`;
}

router.get("/a/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const validId = Number.isInteger(id) && id > 0;
  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol).split(",")[0].trim();
  const origin = `${proto}://${req.get("host")}`;
  const target = validId ? `/?listing=${id}` : "/";

  let title = "TogoMarket";
  let description = "TogoMarket — La marketplace multi-secteurs du Togo.";
  let image = `${origin}/opengraph.jpg`;

  if (validId) {
    try {
      const activeVendorPhones = db
        .select({ phone: vendorsTable.phone })
        .from(vendorsTable)
        .where(and(eq(vendorsTable.isPublished, true), gt(vendorsTable.expiryDate, sql`now()`)));
      const [listing] = await db
        .select()
        .from(listingsTable)
        .where(and(
          eq(listingsTable.id, id),
          eq(listingsTable.approved, true),
          ne(listingsTable.sector, "Tourisme"),
          inArray(listingsTable.phone, activeVendorPhones),
        ))
        .limit(1);
      if (listing) {
        const price = new Intl.NumberFormat("fr-FR").format(parseFloat(listing.promoPrice ?? listing.price));
        const date = new Intl.DateTimeFormat("fr-FR", {
          day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome",
        }).format(listing.createdAt);
        title = listing.name;
        description = `${price} FCFA · ${listing.location} — ${listing.country ?? "Togo"} · ${date}`;
        const firstImage = (listing.images ?? []).find((img) => !isVideo(img) && !img.startsWith("data:"));
        if (firstImage) image = absoluteImageUrl(origin, firstImage);
      }
    } catch (err) {
      req.log.error({ err }, "Failed to load listing for share page");
    }
  }

  const url = `${origin}/a/${validId ? id : ""}`;
  res.set("Cache-Control", "public, max-age=300");
  res.type("html").send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} — TogoMarket</title>
<meta name="description" content="${esc(description)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="TogoMarket" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${esc(image)}" />
<meta property="og:url" content="${esc(url)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(image)}" />
<meta http-equiv="refresh" content="0;url=${esc(target)}" />
</head>
<body>
<p><a href="${esc(target)}">Ouvrir l'article sur TogoMarket</a></p>
</body>
</html>`);
});

export default router;
