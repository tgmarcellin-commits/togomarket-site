import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, sellersTable, listingsTable } from "@workspace/db";

const router: IRouter = Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "17210";

router.get("/sellers/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) {
    res.status(400).json({ error: "Numéro de boutique invalide" });
    return;
  }

  const [seller] = await db
    .select()
    .from(sellersTable)
    .where(eq(sellersTable.id, id))
    .limit(1);

  if (!seller) {
    res.status(404).json({ found: false });
    return;
  }

  const listings = await db
    .select()
    .from(listingsTable)
    .where(and(eq(listingsTable.phone, seller.phone), eq(listingsTable.approved, true)));

  const mapped = listings.map((l) => ({
    id: l.id,
    name: l.name,
    price: parseFloat(l.price),
    location: l.location,
    sector: l.sector,
    images: l.images,
    createdAt: l.createdAt.toISOString(),
    phone: l.phone,
    approved: l.approved,
  }));

  res.json({
    found: true,
    seller: {
      id: seller.id,
      firstName: seller.firstName,
      phone: seller.phone,
    },
    listings: mapped,
  });
});

router.post("/admin/sellers", async (req, res): Promise<void> => {
  const { password, firstName, phone } = req.body;

  if (!password || password !== ADMIN_PASSWORD) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!firstName || typeof firstName !== "string" || firstName.trim().length < 2) {
    res.status(400).json({ error: "Prénom requis (min 2 caractères)" });
    return;
  }

  if (!phone || typeof phone !== "string" || phone.trim().length < 8) {
    res.status(400).json({ error: "Numéro de téléphone requis" });
    return;
  }

  const [seller] = await db
    .insert(sellersTable)
    .values({ firstName: firstName.trim(), phone: phone.trim() })
    .returning();

  res.status(201).json({ id: seller.id, firstName: seller.firstName, phone: seller.phone });
});

router.post("/admin/sellers/list", async (req, res): Promise<void> => {
  const { password } = req.body;

  if (!password || password !== ADMIN_PASSWORD) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const sellers = await db
    .select()
    .from(sellersTable)
    .orderBy(sellersTable.id);

  res.json(sellers.map((s) => ({ id: s.id, firstName: s.firstName, phone: s.phone })));
});

router.post("/admin/sellers/delete", async (req, res): Promise<void> => {
  const { password, id } = req.body;

  if (!password || password !== ADMIN_PASSWORD) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!id || typeof id !== "number") {
    res.status(400).json({ error: "ID requis" });
    return;
  }

  const deleted = await db
    .delete(sellersTable)
    .where(eq(sellersTable.id, id))
    .returning();

  if (deleted.length === 0) {
    res.status(404).json({ error: "Vendeur introuvable" });
    return;
  }

  res.json({ success: true });
});

export default router;
