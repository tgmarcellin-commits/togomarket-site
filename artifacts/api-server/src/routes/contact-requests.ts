import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, contactRequestsTable, listingsTable, vendorsTable } from "@workspace/db";
import bcrypt from "bcryptjs";
import { normalizePhone, phoneEq } from "../lib/phone";

const router: IRouter = Router();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "17210";

router.post("/contact-requests", async (req, res) => {
  const { listingId, buyerName, buyerPhone } = req.body;
  if (!listingId || !buyerName?.trim() || !buyerPhone?.trim()) {
    return res.status(400).json({ error: "Champs requis manquants" });
  }
  try {
    const [listing] = await db
      .select({ id: listingsTable.id })
      .from(listingsTable)
      .where(eq(listingsTable.id, Number(listingId)));
    if (!listing) return res.status(404).json({ error: "Annonce introuvable" });

    await db.insert(contactRequestsTable).values({
      listingId: Number(listingId),
      buyerName: buyerName.trim(),
      buyerPhone: buyerPhone.trim(),
    });
    req.log.info({ listingId }, "Contact request recorded");
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to create contact request");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/vendor/contact-requests", async (req, res) => {
  const { password } = req.body;
  const phone = normalizePhone(String(req.body.phone ?? ""));
  if (!phone || !password) return res.status(400).json({ error: "Champs requis" });
  try {
    const [vendor] = await db
      .select()
      .from(vendorsTable)
      .where(phoneEq(vendorsTable.phone, phone));
    if (!vendor) return res.status(403).json({ error: "Compte introuvable" });
    const valid = await bcrypt.compare(password, vendor.passwordHash);
    if (!valid) return res.status(403).json({ error: "Mot de passe incorrect" });

    const stats = await db
      .select({
        listingId: listingsTable.id,
        listingName: listingsTable.name,
        count: sql<number>`cast(count(${contactRequestsTable.id}) as int)`,
      })
      .from(listingsTable)
      .leftJoin(contactRequestsTable, eq(contactRequestsTable.listingId, listingsTable.id))
      .where(eq(listingsTable.phone, vendor.phone))
      .groupBy(listingsTable.id, listingsTable.name);

    return res.json(stats);
  } catch (err) {
    req.log.error({ err }, "Failed to get vendor contact requests");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/admin/contact-requests/stats", async (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: "Forbidden" });
  try {
    const stats = await db
      .select({
        listingId: listingsTable.id,
        listingName: listingsTable.name,
        vendorPhone: listingsTable.phone,
        count: sql<number>`cast(count(${contactRequestsTable.id}) as int)`,
      })
      .from(listingsTable)
      .leftJoin(contactRequestsTable, eq(contactRequestsTable.listingId, listingsTable.id))
      .groupBy(listingsTable.id, listingsTable.name, listingsTable.phone)
      .having(sql`count(${contactRequestsTable.id}) > 0`);

    return res.json(stats);
  } catch (err) {
    req.log.error({ err }, "Failed to get admin contact stats");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

export default router;
