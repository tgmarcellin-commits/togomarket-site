import { Router, type IRouter } from "express";
import { eq, ilike, and, type SQL } from "drizzle-orm";
import { db, listingsTable, platformSettingsTable } from "@workspace/db";
import {
  CreateListingBody,
  GetListingsQueryParams,
  GetListingsResponseItem,
  GetListingsResponse,
  AdminDeleteListingBody,
  AdminDeleteListingResponse,
  AdminApproveListingBody,
  AdminGetPendingListingsBody,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

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

  const { sector, search } = parsed.data;

  const conditions: SQL[] = [eq(listingsTable.approved, true)];
  if (sector) {
    conditions.push(eq(listingsTable.sector, sector));
  }
  if (search) {
    conditions.push(ilike(listingsTable.name, `%${search}%`));
  }

  const listings = await db
    .select()
    .from(listingsTable)
    .where(and(...conditions))
    .orderBy(listingsTable.createdAt);

  const reversed = [...listings].reverse();
  res.json(GetListingsResponse.parse(reversed.map(mapListing)));
});

router.post("/listings", async (req, res): Promise<void> => {
  const parsed = CreateListingBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid listing body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const settings = await db.select().from(platformSettingsTable).limit(1);
  const expectedCode = settings[0]?.publishCode ?? "TOGO2026";

  if (parsed.data.publishCode !== expectedCode) {
    res.status(403).json({ error: "Code de publication invalide" });
    return;
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
      approved: false,
    })
    .returning();

  req.log.info({ id: listing.id }, "Listing created (pending approval)");
  res.status(201).json(GetListingsResponseItem.parse(mapListing(listing)));
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

  res.json(GetListingsResponse.parse([...listings].reverse().map(mapListing)));
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

  req.log.info({ id: parsed.data.id }, "Listing deleted by admin");
  res.json(AdminDeleteListingResponse.parse({ success: true }));
});

export default router;
