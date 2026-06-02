import { Router, type IRouter } from "express";
import { db, platformSettingsTable } from "@workspace/db";
import {
  GetAdminSettingsResponse,
  UpdateAdminSettingsBody,
  UpdateAdminSettingsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "17210";

async function getSettings() {
  const rows = await db.select().from(platformSettingsTable).limit(1);
  if (rows.length === 0) {
    const [row] = await db
      .insert(platformSettingsTable)
      .values({ commissionRate: 2, whatsappCommission: "22870703131", whatsappOrders: "22870703131" })
      .returning();
    return row;
  }
  return rows[0];
}

router.get("/admin/settings", async (_req, res): Promise<void> => {
  const settings = await getSettings();
  res.json(GetAdminSettingsResponse.parse({
    commissionRate: settings.commissionRate,
    whatsappCommission: settings.whatsappCommission,
    whatsappOrders: settings.whatsappOrders,
  }));
});

router.post("/admin/settings", async (req, res): Promise<void> => {
  const parsed = UpdateAdminSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (parsed.data.password !== ADMIN_PASSWORD) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await getSettings();
  const [updated] = await db
    .update(platformSettingsTable)
    .set({
      commissionRate: parsed.data.commissionRate,
      whatsappCommission: parsed.data.whatsappCommission,
      whatsappOrders: parsed.data.whatsappOrders,
    })
    .returning();

  if (!updated) {
    res.status(500).json({ error: "Failed to update settings" });
    return;
  }

  res.json(UpdateAdminSettingsResponse.parse({
    commissionRate: updated.commissionRate,
    whatsappCommission: updated.whatsappCommission,
    whatsappOrders: updated.whatsappOrders,
  }));
});

export default router;
