import { pgTable, integer, timestamp } from "drizzle-orm/pg-core";
import { eq, sql } from "drizzle-orm";
import { db, vendorsTable } from "@workspace/db";

/**
 * Boutiques VIP : leur abonnement n'expire plus (illimité) ou pour une durée choisie (ex. 1 an).
 * Illimité : date d'expiration très lointaine (VIP_EXPIRY_DATE) ; sinon : maintenant + durée.
 * l'ancienne date est conservée pour être restaurée si on la retire de la liste VIP.
 * La table est créée automatiquement (create table if not exists) : aucune migration manuelle.
 */
export const VIP_EXPIRY_DATE = new Date("2099-12-31T23:59:59.000Z");

export const vipVendorsTable = pgTable("vip_vendors", {
  vendorId: integer("vendor_id").primaryKey(),
  previousExpiry: timestamp("previous_expiry", { withTimezone: true }),
  /** Fin du statut VIP (null = illimité). Passé ce délai, la boutique redevient normale. */
  vipUntil: timestamp("vip_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

let tableReady: Promise<void> | null = null;

export function ensureVipTable(): Promise<void> {
  if (!tableReady) {
    tableReady = db
      .execute(sql`
        create table if not exists vip_vendors (
          vendor_id integer primary key references vendors(id) on delete cascade,
          previous_expiry timestamptz,
          created_at timestamptz not null default now()
        )`)
      .then(() => db.execute(sql`alter table vip_vendors add column if not exists vip_until timestamptz`))
      .then(() => undefined)
      .catch((err) => {
        tableReady = null;
        throw err;
      });
  }
  return tableReady;
}

export async function isVipVendor(vendorId: number): Promise<boolean> {
  try {
    await ensureVipTable();
    const rows = await db
      .select({ vipUntil: vipVendorsTable.vipUntil })
      .from(vipVendorsTable)
      .where(eq(vipVendorsTable.vendorId, vendorId))
      .limit(1);
    if (rows.length === 0) return false;
    // VIP à durée limitée : une fois terminée, un paiement/une activation peut renouveler normalement.
    const until = rows[0].vipUntil;
    return !until || until.getTime() > Date.now();
  } catch {
    return false;
  }
}

export async function listVipVendors() {
  await ensureVipTable();
  return db
    .select({
      vendorId: vipVendorsTable.vendorId,
      addedAt: vipVendorsTable.createdAt,
      vipUntil: vipVendorsTable.vipUntil,
      firstName: vendorsTable.firstName,
      lastName: vendorsTable.lastName,
      shopName: vendorsTable.shopName,
      phone: vendorsTable.phone,
    })
    .from(vipVendorsTable)
    .innerJoin(vendorsTable, eq(vendorsTable.id, vipVendorsTable.vendorId))
    .orderBy(vipVendorsTable.createdAt);
}

export type AddVipResult = "added" | "already_vip" | "not_found";

/** years : null = illimité ; 1 = un an. */
export async function addVipVendor(vendorId: number, years: number | null = null): Promise<AddVipResult> {
  await ensureVipTable();
  return db.transaction(async (tx) => {
    const [vendor] = await tx
      .select({ id: vendorsTable.id, expiryDate: vendorsTable.expiryDate })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, vendorId))
      .limit(1);
    if (!vendor) return "not_found";
    const [existing] = await tx
      .select({ vendorId: vipVendorsTable.vendorId })
      .from(vipVendorsTable)
      .where(eq(vipVendorsTable.vendorId, vendorId))
      .limit(1);
    if (existing) return "already_vip";
    let vipUntil: Date | null = null;
    if (years) {
      vipUntil = new Date();
      vipUntil.setFullYear(vipUntil.getFullYear() + years);
    }
    await tx.insert(vipVendorsTable).values({ vendorId, previousExpiry: vendor.expiryDate, vipUntil });
    await tx.update(vendorsTable).set({ expiryDate: vipUntil ?? VIP_EXPIRY_DATE }).where(eq(vendorsTable.id, vendorId));
    return "added";
  });
}

export type RemoveVipResult = "removed" | "not_vip";

/**
 * Retire une boutique de la liste VIP et rétablit une expiration normale :
 * l'ancienne date si elle est encore dans le futur, sinon 30 jours à partir d'aujourd'hui.
 */
export async function removeVipVendor(vendorId: number): Promise<RemoveVipResult> {
  await ensureVipTable();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(vipVendorsTable)
      .where(eq(vipVendorsTable.vendorId, vendorId))
      .limit(1);
    if (!row) return "not_vip";
    const now = new Date();
    let restored: Date | null;
    if (!row.previousExpiry) restored = null;
    else if (row.previousExpiry.getTime() > now.getTime()) restored = row.previousExpiry;
    else restored = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await tx.update(vendorsTable).set({ expiryDate: restored }).where(eq(vendorsTable.id, vendorId));
    await tx.delete(vipVendorsTable).where(eq(vipVendorsTable.vendorId, vendorId));
    return "removed";
  });
}
