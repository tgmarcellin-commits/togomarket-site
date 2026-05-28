import { Router, type IRouter } from "express";
import { eq, desc, and, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, vendorsTable, publishCodesTable } from "@workspace/db";
import {
  VendorRegisterBody,
  VendorLoginBody,
  VendorLoginResponse,
  VendorUpdateProfileBody,
  VendorUpdateProfileResponse,
  AdminGetVendorsBody,
  AdminGetVendorsResponse,
  AdminActivateVendorBody,
  AdminActivateVendorResponse,
  AdminGenerateVendorCodeBody,
  AdminGenerateVendorCodeResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "17210";

function randomCode(digits: number): string {
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits) - 1;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}

async function getActivePublishCode(vendorId: number) {
  const now = new Date();
  const codes = await db
    .select()
    .from(publishCodesTable)
    .where(and(eq(publishCodesTable.vendorId, vendorId), gt(publishCodesTable.endDate, now)))
    .orderBy(desc(publishCodesTable.endDate))
    .limit(1);
  if (codes.length === 0) return null;
  const c = codes[0];
  const daysLeft = Math.ceil((c.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return { code: c.code, endDate: c.endDate.toISOString(), daysLeft };
}

function mapVendor(v: typeof vendorsTable.$inferSelect, publishCode: { code: string; endDate: string; daysLeft: number } | null) {
  return {
    id: v.id,
    firstName: v.firstName,
    lastName: v.lastName,
    phone: v.phone,
    verified: v.verified,
    profilePhoto: v.profilePhoto ?? null,
    createdAt: v.createdAt.toISOString(),
    publishCode,
  };
}

router.post("/vendors/register", async (req, res) => {
  const parsed = VendorRegisterBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  const { firstName, lastName, phone, password } = parsed.data;

  const existing = await db
    .select({ id: vendorsTable.id })
    .from(vendorsTable)
    .where(eq(vendorsTable.phone, phone))
    .limit(1);

  if (existing.length > 0) {
    return res.status(409).json({ error: "Ce numéro est déjà inscrit." });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const verifyCode = randomCode(6);

    const [vendor] = await db
      .insert(vendorsTable)
      .values({ firstName, lastName, phone, passwordHash, verified: false })
      .returning();

    req.log.info({ id: vendor.id }, "Vendor registered");
    return res.status(201).json({ id: vendor.id, firstName, lastName, phone, verifyCode });
  } catch (err) {
    req.log.error({ err }, "Failed to register vendor");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/vendors/login", async (req, res) => {
  const parsed = VendorLoginBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  const { phone, password } = parsed.data;

  const vendors = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.phone, phone))
    .limit(1);

  if (vendors.length === 0) {
    return res.status(401).json({ error: "Numéro ou mot de passe incorrect." });
  }

  const vendor = vendors[0];
  const match = await bcrypt.compare(password, vendor.passwordHash);
  if (!match) {
    return res.status(401).json({ error: "Numéro ou mot de passe incorrect." });
  }

  try {
    const publishCode = await getActivePublishCode(vendor.id);
    return res.json(VendorLoginResponse.parse(mapVendor(vendor, publishCode)));
  } catch (err) {
    req.log.error({ err }, "Failed to login vendor");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/vendors/profile/update", async (req, res) => {
  const parsed = VendorUpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  const { phone, password, profilePhoto } = parsed.data;

  const vendors = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.phone, phone))
    .limit(1);

  if (vendors.length === 0) {
    return res.status(401).json({ error: "Compte introuvable." });
  }

  const vendor = vendors[0];
  const match = await bcrypt.compare(password, vendor.passwordHash);
  if (!match) {
    return res.status(401).json({ error: "Mot de passe incorrect." });
  }

  try {
    const [updated] = await db
      .update(vendorsTable)
      .set({ profilePhoto: profilePhoto ?? null })
      .where(eq(vendorsTable.id, vendor.id))
      .returning();

    const publishCode = await getActivePublishCode(updated.id);
    return res.json(VendorUpdateProfileResponse.parse(mapVendor(updated, publishCode)));
  } catch (err) {
    req.log.error({ err }, "Failed to update vendor profile");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/admin/vendors", async (req, res) => {
  const parsed = AdminGetVendorsBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  if (parsed.data.password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const vendors = await db
      .select()
      .from(vendorsTable)
      .orderBy(desc(vendorsTable.createdAt));

    const withCodes = await Promise.all(
      vendors.map(async (v) => {
        const publishCode = await getActivePublishCode(v.id);
        return mapVendor(v, publishCode);
      })
    );

    return res.json(AdminGetVendorsResponse.parse(withCodes));
  } catch (err) {
    req.log.error({ err }, "Failed to get vendors");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/admin/vendors/activate", async (req, res) => {
  const parsed = AdminActivateVendorBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  if (parsed.data.password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const vendors = await db
      .select()
      .from(vendorsTable)
      .where(eq(vendorsTable.id, parsed.data.vendorId))
      .limit(1);

    if (vendors.length === 0) {
      return res.status(404).json({ error: "Vendeur introuvable" });
    }

    const vendor = vendors[0];

    await db
      .update(vendorsTable)
      .set({ verified: true })
      .where(eq(vendorsTable.id, vendor.id));

    const code = randomCode(4);
    const now = new Date();
    const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await db.insert(publishCodesTable).values({
      vendorId: vendor.id,
      code,
      startDate: now,
      endDate,
    });

    req.log.info({ vendorId: vendor.id, code }, "Vendor activated with free publish code");
    return res.json(AdminActivateVendorResponse.parse({ success: true, code, vendorPhone: vendor.phone }));
  } catch (err) {
    req.log.error({ err }, "Failed to activate vendor");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

router.post("/admin/vendors/generate-code", async (req, res) => {
  const parsed = AdminGenerateVendorCodeBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  if (parsed.data.password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const vendors = await db
      .select()
      .from(vendorsTable)
      .where(eq(vendorsTable.id, parsed.data.vendorId))
      .limit(1);

    if (vendors.length === 0) {
      return res.status(404).json({ error: "Vendeur introuvable" });
    }

    const vendor = vendors[0];
    const code = randomCode(4);
    const now = new Date();
    const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await db.insert(publishCodesTable).values({
      vendorId: vendor.id,
      code,
      startDate: now,
      endDate,
    });

    req.log.info({ vendorId: vendor.id, code }, "New publish code generated for vendor");
    return res.json(AdminGenerateVendorCodeResponse.parse({ success: true, code, vendorPhone: vendor.phone }));
  } catch (err) {
    req.log.error({ err }, "Failed to generate vendor code");
    return res.status(500).json({ error: "Erreur interne" });
  }
});

export default router;
