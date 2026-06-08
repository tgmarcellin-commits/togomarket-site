import { Router, type IRouter } from "express";
import { eq, ilike, and, gt, desc, sql, type SQL } from "drizzle-orm";
import { normalizePhone, phoneEq } from "../lib/phone";
import bcrypt from "bcryptjs";
import { db, listingsTable, vendorsTable, publishCodesTable } from "@workspace/db";
import {
  CreateListingBody,
  GetListingsQueryParams,
  GetListingsResponse,
  AdminDeleteListingBody,
  AdminDeleteListingResponse,
  AdminApproveListingBody,
  AdminGetPendingListingsBody,
  AdminGetPendingListingsResponse,
  AdminCreateListingBody,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { ObjectStorageService } from "../lib/objectStorage";

const objectStorage = new ObjectStorageService();

const router: IRouter = Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "17210";

function mapListing(l: typeof listingsTable.$inferSelect) {
  return {
    id: l.id,
    name: l.name,
    price: parseFloat(l.price),
    location: l.location,
    sector: l.sector,
    images: l.images,
    createdAt: l.createdAt.toISOString(),
    phone: l.phone,
    approved: l.approved,
  };
}

router.get("/listings", async (req, res): Promise<void> => {
  const parsed = GetListingsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { sector, search, page, limit, shopNumber } = parsed.data;
  const offset = (page - 1) * limit;

  const conditions: SQL[] = [eq(listingsTable.approved, true)];
  if (sector) conditions.push(eq(listingsTable.sector, sector));
  if (search) conditions.push(ilike(listingsTable.name, `%${search}%`));
  let shopVendorName: string | undefined;
  if (shopNumber) {
    const vendorRows = await db
      .select({ phone: vendorsTable.phone, firstName: vendorsTable.firstName, lastName: vendorsTable.lastName })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, shopNumber))
      .limit(1);
    if (vendorRows.length === 0) {
      res.json(GetListingsResponse.parse({ items: [], total: 0, page, hasMore: false }));
      return;
    }
    shopVendorName = vendorRows[0].firstName;
    conditions.push(eq(listingsTable.phone, vendorRows[0].phone));
  }

  const [countResult, listings] = await Promise.all([
    db
      .select({ count: sql<string>`count(*)` })
      .from(listingsTable)
      .where(and(...conditions)),
    db
      .select()
      .from(listingsTable)
      .where(and(...conditions))
      .orderBy(desc(listingsTable.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  const total = Number(countResult[0]?.count ?? 0);

  res.json(GetListingsResponse.parse({
    items: listings.map(mapListing),
    total,
    page,
    hasMore: offset + listings.length < total,
    ...(shopVendorName ? { vendorName: shopVendorName } : {}),
  }));
});

router.post("/listings", async (req, res): Promise<void> => {
  const parsed = CreateListingBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid listing body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const vendorPhone = normalizePhone(parsed.data.vendorPhone);
  const { vendorPassword, vendorPublishCode } = parsed.data;

  const vendors = await db
    .select()
    .from(vendorsTable)
    .where(phoneEq(vendorsTable.phone, vendorPhone))
    .limit(1);

  if (vendors.length === 0) {
    res.status(403).json({ error: "Compte vendeur introuvable." });
    return;
  }

  const vendor = vendors[0];
  const passwordMatch = await bcrypt.compare(vendorPassword, vendor.passwordHash);
  if (!passwordMatch) {
    res.status(403).json({ error: "Mot de passe incorrect." });
    return;
  }

  if (!vendor.verified) {
    res.status(403).json({ error: "Votre compte n'est pas encore activé. Contactez l'administrateur." });
    return;
  }

  const now = new Date();
  const codes = await db
    .select()
    .from(publishCodesTable)
    .where(and(eq(publishCodesTable.vendorId, vendor.id), gt(publishCodesTable.endDate, now)))
    .orderBy(desc(publishCodesTable.endDate))
    .limit(1);

  if (codes.length === 0 || codes[0].code !== vendorPublishCode) {
    res.status(403).json({ error: "Code de publication invalide ou expiré." });
    return;
  }

  const [listing] = await db
    .insert(listingsTable)
    .values({
      name: parsed.data.name,
      price: String(parsed.data.price),
      location: parsed.data.location,
      sector: parsed.data.sector,
      phone: vendor.phone,
      images: parsed.data.images,
      approved: false,
    })
    .returning();

  req.log.info({ id: listing.id }, "Listing created (pending approval)");
  res.status(201).json(mapListing(listing));
});

router.post("/listings/update-price", async (req, res): Promise<void> => {
  const { id, password, newPrice } = req.body;
  const phone = normalizePhone(String(req.body.phone ?? ""));
  if (!id || !phone || !password || newPrice === undefined) {
    res.status(400).json({ error: "Champs requis manquants" });
    return;
  }

  const vendors = await db
    .select()
    .from(vendorsTable)
    .where(phoneEq(vendorsTable.phone, phone))
    .limit(1);

  if (vendors.length === 0) {
    res.status(401).json({ error: "Compte introuvable." });
    return;
  }

  const vendor = vendors[0];
  const match = await bcrypt.compare(password, vendor.passwordHash);
  if (!match) {
    res.status(401).json({ error: "Mot de passe incorrect." });
    return;
  }

  const listings = await db
    .select()
    .from(listingsTable)
    .where(eq(listingsTable.id, id))
    .limit(1);

  if (listings.length === 0) {
    res.status(404).json({ error: "Annonce introuvable." });
    return;
  }

  if (listings[0].phone !== vendor.phone) {
    res.status(403).json({ error: "Vous ne pouvez pas modifier cette annonce." });
    return;
  }

  const [updated] = await db
    .update(listingsTable)
    .set({ price: String(newPrice) })
    .where(eq(listingsTable.id, id))
    .returning();

  logger.info({ id }, "Listing price updated by vendor");
  res.json(mapListing(updated));
});

router.post("/listings/vendor-delete", async (req, res): Promise<void> => {
  const { id, password } = req.body;
  const phone = normalizePhone(String(req.body.phone ?? ""));
  if (!id || !phone || !password) {
    res.status(400).json({ error: "Champs requis manquants" });
    return;
  }

  const vendors = await db
    .select()
    .from(vendorsTable)
    .where(phoneEq(vendorsTable.phone, phone))
    .limit(1);

  if (vendors.length === 0) {
    res.status(401).json({ error: "Compte introuvable." });
    return;
  }

  const vendor = vendors[0];
  const match = await bcrypt.compare(password, vendor.passwordHash);
  if (!match) {
    res.status(401).json({ error: "Mot de passe incorrect." });
    return;
  }

  const listings = await db
    .select()
    .from(listingsTable)
    .where(eq(listingsTable.id, id))
    .limit(1);

  if (listings.length === 0) {
    res.status(404).json({ error: "Annonce introuvable." });
    return;
  }

  if (listings[0].phone !== vendor.phone) {
    res.status(403).json({ error: "Vous ne pouvez pas supprimer cette annonce." });
    return;
  }

  const deleted = await db
    .delete(listingsTable)
    .where(eq(listingsTable.id, id))
    .returning();

  await objectStorage.deleteObjectEntities(deleted[0].images ?? []);
  logger.info({ id }, "Listing deleted by vendor");
  res.json({ success: true });
});

router.post("/admin/listings/create", async (req, res) => {
  const parsed = AdminCreateListingBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  if (parsed.data.password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const [listing] = await db
    .insert(listingsTable)
    .values({
      name: parsed.data.name,
      price: String(parsed.data.price),
      location: parsed.data.location,
      sector: parsed.data.sector,
      phone: parsed.data.phone,
      images: parsed.data.images,
      approved: true,
    })
    .returning();

  req.log.info({ id: listing.id }, "Listing created by admin");
  return res.status(201).json(mapListing(listing));
});

router.post("/admin/listings/pending", async (req, res): Promise<void> => {
  const parsed = AdminGetPendingListingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.password !== ADMIN_PASSWORD) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const listings = await db
    .select()
    .from(listingsTable)
    .where(eq(listingsTable.approved, false))
    .orderBy(listingsTable.createdAt);

  res.json(AdminGetPendingListingsResponse.parse([...listings].reverse().map(mapListing)));
});

router.post("/admin/listings/approve", async (req, res): Promise<void> => {
  const parsed = AdminApproveListingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.password !== ADMIN_PASSWORD) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const updated = await db
    .update(listingsTable)
    .set({ approved: true })
    .where(eq(listingsTable.id, parsed.data.id))
    .returning();

  if (updated.length === 0) {
    res.status(404).json({ error: "Listing not found" });
    return;
  }

  req.log.info({ id: parsed.data.id }, "Listing approved by admin");
  res.json(AdminDeleteListingResponse.parse({ success: true }));
});

router.post("/admin/listings/delete", async (req, res): Promise<void> => {
  const parsed = AdminDeleteListingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (parsed.data.password !== ADMIN_PASSWORD) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const deleted = await db
    .delete(listingsTable)
    .where(eq(listingsTable.id, parsed.data.id))
    .returning();

  if (deleted.length === 0) {
    res.status(404).json({ error: "Listing not found" });
    return;
  }

  await objectStorage.deleteObjectEntities(deleted[0].images ?? []);

  req.log.info({ id: parsed.data.id }, "Listing deleted by admin");
  res.json(AdminDeleteListingResponse.parse({ success: true }));
});

export default router;
