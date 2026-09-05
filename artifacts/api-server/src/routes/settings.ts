import { Router, type IRouter } from "express";
import { db, platformSettingsTable } from "@workspace/db";
import {
  GetAdminSettingsResponse,
  UpdateAdminSettingsBody,
  UpdateAdminSettingsResponse,
  VerifySubAdminBody,
  VerifySubAdminResponse,
} from "@workspace/api-zod";
import { SUB_ADMIN_PASSWORD_DEFAULT, isSuperAdmin } from "../lib/admin-auth";

const router: IRouter = Router();

async function getSettings() {
  const rows = await db.select().from(platformSettingsTable).limit(1);
  if (rows.length === 0) {
    const [row] = await db
      .insert(platformSettingsTable)
      .values({
        commissionRate: 2,
        whatsappCommission: "22870703131",
        whatsappOrders: "22870703131",
        subAdminPassword: SUB_ADMIN_PASSWORD_DEFAULT,
        whatsappAds: "22870703131",
        whatsappServices: "22870703131",
        otpProvider: "WHATSAPP",
        whatsappValidation: "22870703131",
        adVideoPlaybackMode: "AUTOPLAY",
      })
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
    whatsappAds: settings.whatsappAds ?? "22870703131",
    whatsappServices: settings.whatsappServices ?? "22870703131",
    otpProvider: settings.otpProvider ?? "WHATSAPP",
    whatsappValidation: settings.whatsappValidation ?? "22870703131",
    adVideoPlaybackMode: settings.adVideoPlaybackMode === "ECONOMICAL" ? "ECONOMICAL" : "AUTOPLAY",
  }));
});

router.post("/admin/settings", async (req, res): Promise<void> => {
  const parsed = UpdateAdminSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (!await isSuperAdmin(parsed.data.password)) {
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
      ...(parsed.data.subAdminPassword !== undefined
        ? { subAdminPassword: parsed.data.subAdminPassword }
        : {}),
      ...(parsed.data.whatsappAds !== undefined
        ? { whatsappAds: parsed.data.whatsappAds }
        : {}),
      ...(parsed.data.whatsappServices !== undefined
        ? { whatsappServices: parsed.data.whatsappServices }
        : {}),
      ...(parsed.data.otpProvider !== undefined
        ? { otpProvider: parsed.data.otpProvider }
        : {}),
      ...(parsed.data.whatsappValidation !== undefined
        ? { whatsappValidation: parsed.data.whatsappValidation }
        : {}),
      ...(parsed.data.adVideoPlaybackMode !== undefined
        ? { adVideoPlaybackMode: parsed.data.adVideoPlaybackMode }
        : {}),
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
    whatsappAds: updated.whatsappAds ?? "22870703131",
    whatsappServices: updated.whatsappServices ?? "22870703131",
    otpProvider: updated.otpProvider ?? "WHATSAPP",
    whatsappValidation: updated.whatsappValidation ?? "22870703131",
    adVideoPlaybackMode: updated.adVideoPlaybackMode === "ECONOMICAL" ? "ECONOMICAL" : "AUTOPLAY",
  }));
});

router.post("/admin/sub-admin-verify", async (req, res): Promise<void> => {
  const parsed = VerifySubAdminBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const settings = await getSettings();
  const valid = parsed.data.password === settings.subAdminPassword;
  res.json(VerifySubAdminResponse.parse({ valid }));
});

export default router;
