import { Router, type IRouter } from "express";
import { eq, ilike, and, or, desc, sql, gt, inArray, ne, type SQL } from "drizzle-orm";
import { normalizePhone, phoneEq } from "../lib/phone";
import {
  db,
  adsTable,
  eventsTable,
  listingsTable,
  messagesTable,
  servicesTable,
  vendorsTable,
  reviewsTable,
} from "@workspace/db";
import {
  CreateListingBody,
  GetListingsQueryParams,
  GetListingsResponse,
  AdminDeleteListingBody,
  AdminDeleteListingResponse,
  AdminApproveListingBody,
  AdminGetPendingListingsBody,
  AdminGetPendingListingsResponse,
  AdminGetListingsBody,
  AdminGetListingsResponse,
  AdminCreateListingBody,
  AdminPinListingBody,
  UpdateTourismeListingBody,
  UpdateTourismeListingParams,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { normalizeObjectStoragePath, ObjectStorageService } from "../lib/objectStorage";
import { deleteCloudinaryImage, isCloudinaryImageOwnedBy, parseCloudinaryImageUrl } from "../lib/cloudinary-image";
import { getObjectAclPolicy } from "../lib/objectAcl";
import { isSuperAdmin } from "../lib/admin-auth";
import { authenticateVendorRequest } from "../lib/vendor-auth";

const objectStorage = new ObjectStorageService();

const router: IRouter = Router();

function storagePath(mediaPath: string): string {
  return normalizeObjectStoragePath(mediaPath) ?? mediaPath;
}

async function vendorCanUseMedia(
  vendorId: number,
  mediaPaths: string[],
  existingMediaPaths: string[] = [],
): Promise<boolean> {
  const existingPaths = new Set(existingMediaPaths.map(storagePath));

  for (const mediaPath of mediaPaths) {
    const objectPath = storagePath(mediaPath);
    if (existingPaths.has(objectPath)) continue;
    if (parseCloudinaryImageUrl(mediaPath)) {
      try {
        if (!await isCloudinaryImageOwnedBy(mediaPath, `vendor:${vendorId}`)) return false;
      } catch {
        return false;
      }
      continue;
    }
    if (!normalizeObjectStoragePath(mediaPath)) return false;

    try {
      const objectFile = await objectStorage.getObjectEntityFile(objectPath);
      const policy = await getObjectAclPolicy(objectFile);
      if (policy?.owner !== `vendor:${vendorId}`) return false;
    } catch {
      return false;
    }
  }

  return true;
}

async function deleteUnreferencedListingMedia(mediaPaths: string[]): Promise<{ failed: string[] }> {
  const [remainingListings, ads, vendors, messages, services, events] = await Promise.all([
    db.select({ images: listingsTable.images }).from(listingsTable),
    db.select({ image: adsTable.image, videoPath: adsTable.videoPath }).from(adsTable),
    db.select({ profilePhoto: vendorsTable.profilePhoto }).from(vendorsTable),
    db.select({ fileUrl: messagesTable.fileUrl }).from(messagesTable),
    db.select({ image: servicesTable.image, videoPath: servicesTable.videoPath }).from(servicesTable),
    db.select({ flyerImage: eventsTable.flyerImage, videoPath: eventsTable.videoPath }).from(eventsTable),
  ]);
  const referencedPaths = new Set(
    [
      ...remainingListings.flatMap((listing) => listing.images ?? []),
      ...ads.flatMap((ad) => [ad.image, ad.videoPath]),
      ...vendors.map((vendor) => vendor.profilePhoto),
      ...messages.map((message) => message.fileUrl),
      ...services.flatMap((service) => [service.image, service.videoPath]),
      ...events.flatMap((event) => [event.flyerImage, event.videoPath]),
    ]
      .filter((path): path is string => Boolean(path))
      .map(storagePath),
  );
  const unreferencedPaths = Array.from(new Set(mediaPaths.map(storagePath)))
    .filter((path) => !referencedPaths.has(path));
  const objectResult = await objectStorage.deleteObjectEntities(unreferencedPaths);
  const cloudinaryPaths = unreferencedPaths.filter((path) => parseCloudinaryImageUrl(path)?.deliveryType === "upload");
  const cloudinaryResults = await Promise.allSettled(cloudinaryPaths.map(deleteCloudinaryImage));
  return {
    failed: [
      ...objectResult.failed,
      ...cloudinaryResults.flatMap((result, index) => result.status === "rejected" ? [cloudinaryPaths[index]] : []),
    ],
  };
}

function mapListing(
  l: typeof listingsTable.$inferSelect,
  vendorId?: number | null,
  stats?: { avgRating: number | null; reviewCount: number },
) {
  return {
    id: l.id,
    name: l.name,
    price: parseFloat(l.price),
    promoPrice: l.promoPrice != null ? parseFloat(l.promoPrice) : null,
    description: l.description ?? null,
    location: l.location,
    country: l.country ?? "Togo",
    sector: l.sector,
    images: l.images,
    createdAt: l.createdAt.toISOString(),
    phone: l.phone,
    approved: l.approved,
    pinned: l.pinned ?? false,
    vendorId: vendorId ?? null,
    avgRating: stats?.avgRating ?? null,
    reviewCount: stats?.reviewCount ?? 0,
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

  // Sous-requête : téléphones des vendeurs avec abonnement actif
  const activeVendorPhones = db
    .select({ phone: vendorsTable.phone })
    .from(vendorsTable)
    .where(and(
      eq(vendorsTable.isPublished, true),
      gt(vendorsTable.expiryDate, sql`now()`),
    ));

  const conditions: SQL[] = [
    eq(listingsTable.approved, true),
    inArray(listingsTable.phone, activeVendorPhones),
  ];
  if (sector) conditions.push(eq(listingsTable.sector, sector));
  else conditions.push(ne(listingsTable.sector, "Tourisme")); // Tourisme has its own catalog endpoint
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
      .select({
        listing: listingsTable,
        vendorId: vendorsTable.id,
        avgRating: sql<string | null>`(select round(avg(${reviewsTable.rating})::numeric, 1) from ${reviewsTable} where ${reviewsTable.listingId} = ${listingsTable.id})`,
        reviewCount: sql<string>`(select count(*) from ${reviewsTable} where ${reviewsTable.listingId} = ${listingsTable.id})`,
      })
      .from(listingsTable)
      .leftJoin(vendorsTable, eq(vendorsTable.phone, listingsTable.phone))
      .where(and(...conditions))
      .orderBy(desc(listingsTable.pinned), desc(listingsTable.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  const total = Number(countResult[0]?.count ?? 0);

  res.json(GetListingsResponse.parse({
    items: listings.map((row) => mapListing(row.listing, row.vendorId, {
      avgRating: row.avgRating != null ? Number(row.avgRating) : null,
      reviewCount: Number(row.reviewCount ?? 0),
    })),
    total,
    page,
    hasMore: offset + listings.length < total,
    ...(shopVendorName ? { vendorName: shopVendorName } : {}),
  }));
});

/* ──────────────────────────────────────────────────────────────
   GET /api/listings/tourisme  — Tourisme catalogs grouped by (phone, name)
   ────────────────────────────────────────────────────────────── */
router.get("/listings/tourisme", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      listing: listingsTable,
      vendorId: vendorsTable.id,
      vendorFirstName: vendorsTable.firstName,
      vendorLastName: vendorsTable.lastName,
      vendorShopName: vendorsTable.shopName,
    })
    .from(listingsTable)
    .leftJoin(vendorsTable, eq(vendorsTable.phone, listingsTable.phone))
    .where(and(
      eq(listingsTable.approved, true),
      eq(listingsTable.sector, "Tourisme"),
    ))
    .orderBy(desc(listingsTable.createdAt));

  interface CatalogEntry {
    catalogName: string;
    description: string;
    vendorName: string;
    vendorId: number | null;
    phone: string;
    images: string[];
    createdAt: string;
  }

  const map = new Map<string, CatalogEntry>();

  for (const { listing, vendorId, vendorFirstName, vendorLastName, vendorShopName } of rows) {
    const key = `${listing.phone}::${listing.name.toLowerCase().trim()}`;
    if (!map.has(key)) {
      map.set(key, {
        catalogName: listing.name,
        description: listing.location,
        vendorName: vendorShopName ?? `${vendorFirstName ?? ""} ${vendorLastName ?? ""}`.trim(),
        vendorId: vendorId ?? null,
        phone: listing.phone,
        images: [...listing.images],
        createdAt: listing.createdAt.toISOString(),
      });
    } else {
      map.get(key)!.images.push(...listing.images);
    }
  }

  res.json(Array.from(map.values()));
});

router.post("/listings", async (req, res): Promise<void> => {
  const parsed = CreateListingBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid listing body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const vendorPhone = normalizePhone(parsed.data.vendorPhone);
  const { vendorPassword } = parsed.data;

  const vendor = await authenticateVendorRequest(req, { phone: vendorPhone, password: vendorPassword });
  if (!vendor) {
    res.status(403).json({ error: "Compte vendeur introuvable." });
    return;
  }

  if (!vendor.verified) {
    res.status(403).json({ error: "Votre compte n'est pas encore activé. Contactez l'administrateur." });
    return;
  }

  if (
    !vendor.isPublished ||
    !vendor.expiryDate ||
    vendor.expiryDate.getTime() <= Date.now()
  ) {
    res.status(403).json({ error: "Votre boutique est expirée ou désactivée. Renouvelez-la avant de publier." });
    return;
  }

  if (!await vendorCanUseMedia(vendor.id, parsed.data.images)) {
    res.status(400).json({ error: "Un ou plusieurs médias ne vous appartiennent pas." });
    return;
  }

  const [listing] = await db
    .insert(listingsTable)
    .values({
      name: parsed.data.name,
      price: String(parsed.data.price),
      location: parsed.data.location,
      country: parsed.data.country ?? "Togo",
      sector: parsed.data.sector,
      phone: vendor.phone,
      images: parsed.data.images,
      description: parsed.data.description?.trim() || null,
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

  const vendor = await authenticateVendorRequest(req, { phone, password });
  if (!vendor) {
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

  // Champs optionnels : prix promo (null = retirer) et description
  const updateSet: Partial<typeof listingsTable.$inferInsert> = { price: String(newPrice) };
  if ("promoPrice" in req.body) {
    const pp = req.body.promoPrice;
    if (pp === null || pp === "" || pp === undefined) {
      updateSet.promoPrice = null;
    } else {
      const parsedPromo = Number(pp);
      if (!Number.isFinite(parsedPromo) || parsedPromo <= 0) {
        res.status(400).json({ error: "Prix promotionnel invalide." });
        return;
      }
      if (parsedPromo >= Number(newPrice)) {
        res.status(400).json({ error: "Le prix promotionnel doit être inférieur au prix réel." });
        return;
      }
      updateSet.promoPrice = String(parsedPromo);
    }
  }
  if ("description" in req.body) {
    const d = req.body.description;
    updateSet.description = typeof d === "string" && d.trim() ? d.trim() : null;
  }

  const [updated] = await db
    .update(listingsTable)
    .set(updateSet)
    .where(eq(listingsTable.id, id))
    .returning();

  logger.info({ id }, "Listing price updated by vendor");
  res.json(mapListing(updated));
});

router.patch("/listings/:listingId", async (req, res): Promise<void> => {
  const params = UpdateTourismeListingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTourismeListingBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid Tourisme catalog update body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const vendor = await authenticateVendorRequest(req, {
    phone: normalizePhone(parsed.data.phone),
    password: parsed.data.password,
  });
  if (!vendor) {
    res.status(401).json({ error: "Mot de passe incorrect." });
    return;
  }

  const [listing] = await db
    .select()
    .from(listingsTable)
    .where(eq(listingsTable.id, params.data.listingId))
    .limit(1);

  if (!listing) {
    res.status(404).json({ error: "Catalogue introuvable." });
    return;
  }

  if (listing.phone !== vendor.phone) {
    res.status(403).json({ error: "Vous ne pouvez pas modifier ce catalogue." });
    return;
  }

  if (listing.sector !== "Tourisme") {
    res.status(400).json({ error: "Cette annonce n'est pas un catalogue Tourisme." });
    return;
  }

  const normalizedCatalogName = listing.name.toLowerCase().trim();
  const catalogRows = await db
    .select()
    .from(listingsTable)
    .where(and(
      eq(listingsTable.sector, "Tourisme"),
      phoneEq(listingsTable.phone, normalizePhone(vendor.phone)),
      sql`lower(trim(${listingsTable.name})) = ${normalizedCatalogName}`,
    ));
  const previousImages = catalogRows.flatMap((row) => row.images ?? []);
  const updatedImages = parsed.data.images;
  const updatedStoragePaths = new Set(updatedImages.map(storagePath));
  const removedImages = previousImages.filter((image) => !updatedStoragePaths.has(storagePath(image)));

  if (!await vendorCanUseMedia(vendor.id, updatedImages, previousImages)) {
    res.status(400).json({ error: "Un ou plusieurs médias ne vous appartiennent pas." });
    return;
  }

  const updated = await db.transaction(async (tx) => {
    const [updatedRow] = await tx
      .update(listingsTable)
      .set({
        name: parsed.data.name.trim(),
        location: parsed.data.description.trim() || "Catalogue Tourisme",
        images: updatedImages,
        approved: catalogRows.some((row) => row.approved),
        pinned: catalogRows.some((row) => row.pinned),
      })
      .where(eq(listingsTable.id, params.data.listingId))
      .returning();

    await tx
      .delete(listingsTable)
      .where(and(
        eq(listingsTable.sector, "Tourisme"),
        phoneEq(listingsTable.phone, normalizePhone(vendor.phone)),
        sql`lower(trim(${listingsTable.name})) = ${normalizedCatalogName}`,
        ne(listingsTable.id, params.data.listingId),
      ));

    return updatedRow;
  });

  const cleanup = await deleteUnreferencedListingMedia(removedImages);
  if (cleanup.failed.length > 0) {
    req.log.error(
      { id: params.data.listingId, failedMediaPaths: cleanup.failed },
      "Tourisme catalog update left media pending cleanup",
    );
  }

  req.log.info(
    { id: params.data.listingId, removedMediaCount: removedImages.length },
    "Tourisme catalog updated by vendor",
  );
  res.json(mapListing(updated));
});

router.post("/listings/vendor-delete", async (req, res): Promise<void> => {
  const { id, password } = req.body;
  const phone = normalizePhone(String(req.body.phone ?? ""));
  if (!id || !phone || !password) {
    res.status(400).json({ error: "Champs requis manquants" });
    return;
  }

  const vendor = await authenticateVendorRequest(req, { phone, password });
  if (!vendor) {
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

  if (normalizePhone(listings[0].phone) !== normalizePhone(vendor.phone)) {
    res.status(403).json({ error: "Vous ne pouvez pas supprimer cette annonce." });
    return;
  }

  const target = listings[0];
  const deleted = target.sector === "Tourisme"
    ? await db
      .delete(listingsTable)
      .where(and(
        eq(listingsTable.sector, "Tourisme"),
        phoneEq(listingsTable.phone, normalizePhone(vendor.phone)),
        sql`lower(trim(${listingsTable.name})) = ${target.name.toLowerCase().trim()}`,
      ))
      .returning()
    : await db
      .delete(listingsTable)
      .where(eq(listingsTable.id, id))
      .returning();

  const cleanup = await deleteUnreferencedListingMedia(
    deleted.flatMap((deletedListing) => deletedListing.images ?? []),
  );
  if (cleanup.failed.length > 0) {
    req.log.error(
      { id, failedMediaPaths: cleanup.failed },
      "Vendor listing delete left media pending cleanup",
    );
  }
  logger.info({ id, deletedRows: deleted.length }, "Listing deleted by vendor");
  res.json({ success: true });
});

router.post("/admin/listings/create", async (req, res) => {
  const parsed = AdminCreateListingBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  if (!await isSuperAdmin(parsed.data.password)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const [listing] = await db
    .insert(listingsTable)
    .values({
      name: parsed.data.name,
      price: String(parsed.data.price),
      location: parsed.data.location,
      country: "Togo",
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
  if (!await isSuperAdmin(parsed.data.password)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const listings = await db
    .select()
    .from(listingsTable)
    .where(eq(listingsTable.approved, false))
    .orderBy(listingsTable.createdAt);

  res.json(AdminGetPendingListingsResponse.parse([...listings].reverse().map((l) => mapListing(l))));
});

router.post("/admin/listings/manage", async (req, res): Promise<void> => {
  const parsed = AdminGetListingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!await isSuperAdmin(parsed.data.password)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const page = parsed.data.page ?? 1;
  const limit = parsed.data.limit ?? 20;
  const offset = (page - 1) * limit;
  const conditions: SQL[] = [eq(listingsTable.approved, true)];
  const search = parsed.data.search?.trim();
  if (search) {
    const searchCondition = or(
      ilike(listingsTable.name, `%${search}%`),
      ilike(listingsTable.phone, `%${search}%`),
      ilike(listingsTable.sector, `%${search}%`),
      ilike(listingsTable.location, `%${search}%`),
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  const [countResult, listings, pinnedListings] = await Promise.all([
    db
      .select({ count: sql<string>`count(*)` })
      .from(listingsTable)
      .where(and(...conditions)),
    db
      .select({ listing: listingsTable, vendorId: vendorsTable.id })
      .from(listingsTable)
      .leftJoin(vendorsTable, eq(vendorsTable.phone, listingsTable.phone))
      .where(and(...conditions))
      .orderBy(desc(listingsTable.pinned), desc(listingsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ listing: listingsTable, vendorId: vendorsTable.id })
      .from(listingsTable)
      .leftJoin(vendorsTable, eq(vendorsTable.phone, listingsTable.phone))
      .where(and(
        eq(listingsTable.approved, true),
        eq(listingsTable.pinned, true),
      ))
      .orderBy(desc(listingsTable.createdAt)),
  ]);

  const total = Number(countResult[0]?.count ?? 0);
  res.json(AdminGetListingsResponse.parse({
    items: listings.map((row) => mapListing(row.listing, row.vendorId)),
    pinnedItems: pinnedListings.map((row) => mapListing(row.listing, row.vendorId)),
    total,
    page,
    hasMore: offset + listings.length < total,
  }));
});

router.post("/admin/listings/approve", async (req, res): Promise<void> => {
  const parsed = AdminApproveListingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!await isSuperAdmin(parsed.data.password)) {
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

  if (!await isSuperAdmin(parsed.data.password)) {
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

  await deleteUnreferencedListingMedia(deleted[0].images ?? []);

  req.log.info({ id: parsed.data.id }, "Listing deleted by admin");
  res.json(AdminDeleteListingResponse.parse({ success: true }));
});

/* ──────────────────────────────────────────────────────────────
   POST /api/admin/listings/pin — épingle / désépingle une annonce
   ────────────────────────────────────────────────────────────── */
router.post("/admin/listings/pin", async (req, res): Promise<void> => {
  const parsed = AdminPinListingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (!await isSuperAdmin(parsed.data.password)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rows = await db.select().from(listingsTable).where(eq(listingsTable.id, parsed.data.id)).limit(1);
  if (rows.length === 0) {
    res.status(404).json({ error: "Annonce introuvable." });
    return;
  }

  const newPinned = !rows[0].pinned;
  const [updated] = await db
    .update(listingsTable)
    .set({ pinned: newPinned })
    .where(eq(listingsTable.id, parsed.data.id))
    .returning();

  req.log.info({ id: parsed.data.id, pinned: newPinned }, "Listing pin toggled by admin");
  res.json(mapListing(updated));
});

/* ──────────────────────────────────────────────────────────────
   POST /api/admin/tourisme/delete — supprime un catalogue Tourisme
   complet (toutes les lignes groupées par téléphone + nom).
   ────────────────────────────────────────────────────────────── */
router.post("/admin/tourisme/delete", async (req, res): Promise<void> => {
  const { password, phone, catalogName } = (req.body ?? {}) as {
    password?: unknown; phone?: unknown; catalogName?: unknown;
  };
  if (typeof password !== "string" || typeof phone !== "string" || typeof catalogName !== "string" || !phone || !catalogName) {
    res.status(400).json({ error: "password, phone et catalogName sont requis" });
    return;
  }

  if (!await isSuperAdmin(password)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const normalizedName = catalogName.toLowerCase().trim();
  const deleted = await db
    .delete(listingsTable)
    .where(and(
      eq(listingsTable.sector, "Tourisme"),
      phoneEq(listingsTable.phone, normalizePhone(phone)),
      sql`lower(trim(${listingsTable.name})) = ${normalizedName}`,
    ))
    .returning();

  if (deleted.length === 0) {
    res.status(404).json({ error: "Catalogue introuvable" });
    return;
  }

  const allImages = deleted.flatMap((row) => row.images ?? []);
  await deleteUnreferencedListingMedia(allImages).catch((err) => {
    req.log.warn({ err }, "Tourisme catalog delete: échec suppression médias");
  });

  req.log.info(
    { phone, catalogName, rows: deleted.length },
    "Tourisme catalog deleted by admin"
  );
  res.json({ success: true, deletedRows: deleted.length });
});

export default router;
