import { Router, type IRouter } from "express";
import { eq, ilike, and, type SQL } from "drizzle-orm";
import { db, listingsTable } from "@workspace/db";
import {
  CreateListingBody,
  GetListingsQueryParams,
  GetListingsResponseItem,
  GetListingsResponse,
  AdminDeleteListingBody,
  AdminDeleteListingResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "17210";

router.get("/listings", async (req, res): Promise<void> => {
  const parsed = GetListingsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { sector, search } = parsed.data;

  const conditions: SQL[] = [];
  if (sector) {
    conditions.push(eq(listingsTable.sector, sector));
  }
  if (search) {
    conditions.push(ilike(listingsTable.name, `%${search}%`));
  }

  const listings = await db
    .select()
    .from(listingsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(listingsTable.createdAt);

  const reversed = [...listings].reverse();

  res.json(GetListingsResponse.parse(reversed.map((l) => ({
    id: l.id,
    name: l.name,
    price: parseFloat(l.price),
    location: l.location,
    sector: l.sector,
    images: l.images,
    createdAt: l.createdAt.toISOString(),
    phone: l.phone,
  }))));
});

router.post("/listings", async (req, res): Promise<void> => {
  const parsed = CreateListingBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid listing body");
    res.status(400).json({ error: parsed.error.message });
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
    })
    .returning();

  req.log.info({ id: listing.id }, "Listing created");

  res.status(201).json(GetListingsResponseItem.parse({
    id: listing.id,
    name: listing.name,
    price: parseFloat(listing.price),
    location: listing.location,
    sector: listing.sector,
    images: listing.images,
    createdAt: listing.createdAt.toISOString(),
    phone: listing.phone,
  }));
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
