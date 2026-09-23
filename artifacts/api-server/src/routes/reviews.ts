import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, reviewsTable, listingsTable } from "@workspace/db";
import { normalizePhone } from "../lib/phone";
import { isSuperAdmin } from "../lib/admin-auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function mapReview(r: typeof reviewsTable.$inferSelect) {
  return {
    id: r.id,
    listingId: r.listingId,
    buyerName: r.buyerName,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt.toISOString(),
  };
}

/* GET /api/listings/:listingId/reviews — liste des avis d'un article */
router.get("/listings/:listingId/reviews", async (req, res): Promise<void> => {
  const listingId = Number(req.params.listingId);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    res.status(400).json({ error: "Identifiant invalide" });
    return;
  }
  const items = await db
    .select()
    .from(reviewsTable)
    .where(eq(reviewsTable.listingId, listingId))
    .orderBy(desc(reviewsTable.createdAt));

  const count = items.length;
  const avgRating = count
    ? Math.round((items.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10
    : null;

  res.json({ items: items.map(mapReview), avgRating, count });
});

/* POST /api/listings/:listingId/reviews — créer un avis */
router.post("/listings/:listingId/reviews", async (req, res): Promise<void> => {
  const listingId = Number(req.params.listingId);
  const buyerName = String(req.body?.buyerName ?? "").trim();
  const buyerPhone = normalizePhone(String(req.body?.buyerPhone ?? ""));
  const rating = Number(req.body?.rating);
  const comment = String(req.body?.comment ?? "").trim();

  if (!Number.isInteger(listingId) || listingId <= 0) {
    res.status(400).json({ error: "Identifiant invalide" });
    return;
  }
  if (buyerName.length < 2 || buyerPhone.length < 8) {
    res.status(400).json({ error: "Nom et numéro requis" });
    return;
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: "Note invalide (1 à 5)" });
    return;
  }
  if (comment.length > 1000) {
    res.status(400).json({ error: "Commentaire trop long (1000 caractères max)" });
    return;
  }

  const listing = await db
    .select({ id: listingsTable.id })
    .from(listingsTable)
    .where(eq(listingsTable.id, listingId))
    .limit(1);
  if (listing.length === 0) {
    res.status(404).json({ error: "Article introuvable" });
    return;
  }

  const editToken = randomBytes(24).toString("hex");
  const [review] = await db
    .insert(reviewsTable)
    .values({ listingId, buyerName, buyerPhone, rating, comment, editToken })
    .returning();

  logger.info({ listingId, reviewId: review.id }, "Review created");
  res.status(201).json({ review: mapReview(review), editToken });
});

/* POST /api/reviews/update — modifier son avis (auteur uniquement via editToken) */
router.post("/reviews/update", async (req, res): Promise<void> => {
  const id = Number(req.body?.id);
  const editToken = String(req.body?.editToken ?? "");
  const rating = Number(req.body?.rating);
  const comment = String(req.body?.comment ?? "").trim();

  if (!Number.isInteger(id) || id <= 0 || !editToken) {
    res.status(400).json({ error: "Champs requis manquants" });
    return;
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: "Note invalide (1 à 5)" });
    return;
  }
  if (comment.length > 1000) {
    res.status(400).json({ error: "Commentaire trop long (1000 caractères max)" });
    return;
  }

  const rows = await db.select().from(reviewsTable).where(eq(reviewsTable.id, id)).limit(1);
  if (rows.length === 0) {
    res.status(404).json({ error: "Avis introuvable" });
    return;
  }
  if (rows[0].editToken !== editToken) {
    res.status(403).json({ error: "Vous ne pouvez pas modifier cet avis." });
    return;
  }

  const [updated] = await db
    .update(reviewsTable)
    .set({ rating, comment })
    .where(eq(reviewsTable.id, id))
    .returning();

  res.json(mapReview(updated));
});

/* POST /api/reviews/delete — auteur (editToken) ou admin (password) */
router.post("/reviews/delete", async (req, res): Promise<void> => {
  const id = Number(req.body?.id);
  const editToken = String(req.body?.editToken ?? "");
  const password = String(req.body?.password ?? "");

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Identifiant invalide" });
    return;
  }

  const rows = await db.select().from(reviewsTable).where(eq(reviewsTable.id, id)).limit(1);
  if (rows.length === 0) {
    res.status(404).json({ error: "Avis introuvable" });
    return;
  }

  const isAuthor = editToken.length > 0 && rows[0].editToken === editToken;
  const isAdmin = password.length > 0 && await isSuperAdmin(password);

  if (!isAuthor && !isAdmin) {
    res.status(403).json({ error: "Vous ne pouvez pas supprimer cet avis." });
    return;
  }

  await db.delete(reviewsTable).where(eq(reviewsTable.id, id));
  logger.info({ reviewId: id, by: isAuthor ? "author" : "admin" }, "Review deleted");
  res.json({ success: true });
});

export default router;
