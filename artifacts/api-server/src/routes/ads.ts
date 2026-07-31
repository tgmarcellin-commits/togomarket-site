import { Router, type IRouter } from "express";
import { gt, eq, and, count, desc, isNotNull } from "drizzle-orm";
import { db, adsTable } from "@workspace/db";
import { isAdminOrSubAdmin } from "../lib/auth-sub";

const FEDAPAY_SECRET_KEY_ADS = process.env.FEDAPAY_SECRET_KEY ?? "";
function getFedapayBaseUrlAds(): string {
  return FEDAPAY_SECRET_KEY_ADS.startsWith("sk_live")
    ? "https://api.fedapay.com/v1"
    : "https://sandbox-api.fedapay.com/v1";
}

function getPhoneCountryAds(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("228")) return "TG";
  if (d.startsWith("229")) return "BJ";
  if (d.startsWith("225")) return "CI";
  if (d.startsWith("221")) return "SN";
  if (d.startsWith("227")) return "NE";
  return "TG";
}

const router: IRouter = Router();

function mapAd(a: typeof adsTable.$inferSelect) {
  return {
    id: a.id,
    advertiserName: a.advertiserName,
    advertiserPhone: a.advertiserPhone,
    message: a.message,
    image: a.image ?? null,
    videoPath: a.videoPath ?? null,
    startDate: a.startDate.toISOString(),
    endDate: a.endDate.toISOString(),
    isPublished: a.isPublished,
    paymentStatus: a.paymentStatus,
    validationMethod: a.validationMethod,
    fedapayTransactionId: a.fedapayTransactionId ?? null,
    category: a.category ?? "Agence",
    isPinned: a.isPinned ?? false,
  };
}

// GET /ads — active published video ads only, pinned first
router.get("/ads", async (req, res) => {
  try {
    const now = new Date();
    const ads = await db
      .select()
      .from(adsTable)
      .where(and(
        gt(adsTable.endDate, now),
        eq(adsTable.isPublished, true),
        isNotNull(adsTable.videoPath),
      ));
    // Séparer épinglées / non-épinglées
    const pinned = ads
      .filter((a) => a.isPinned)
      .sort((a, b) => a.id - b.id); // ordre stable par id

    const unpinned = ads
      .filter((a) => !a.isPinned)
      .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());

    // Rotation quotidienne des épinglées : chaque jour une vidéo différente commence en tête
    let rotatedPinned = pinned;
    if (pinned.length > 1) {
      const dayIndex = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
      const offset = dayIndex % pinned.length;
      rotatedPinned = [...pinned.slice(offset), ...pinned.slice(0, offset)];
    }

    res.json([...rotatedPinned, ...unpinned].map(mapAd));
  } catch (err) {
    req.log.error({ err }, "Failed to get ads");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/ads", async (req, res) => {
  const { password, advertiserName, advertiserPhone, videoPath } = req.body;
  if (!await isAdminOrSubAdmin(password)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!advertiserPhone || !videoPath) {
    return res.status(400).json({ error: "Numéro WhatsApp et vidéo requis" });
  }
  try {
    const now = new Date();
    const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const [ad] = await db
      .insert(adsTable)
      .values({
        advertiserName: advertiserName || advertiserPhone,
        advertiserPhone,
        message: "",
        image: null,
        videoPath,
        startDate: now,
        endDate,
        isPublished: false,
        paymentStatus: "unpaid",
        validationMethod: "pending",
        category: "Agence",
        isPinned: false,
      })
      .returning();
    return res.status(201).json(mapAd(ad));
  } catch (err) {
    req.log.error({ err }, "Failed to create ad");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/ads/all", async (req, res) => {
  const { password } = req.body;
  if (!await isAdminOrSubAdmin(password)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const ads = await db.select().from(adsTable).orderBy(desc(adsTable.isPinned), adsTable.endDate);
    return res.json(ads.map(mapAd));
  } catch (err) {
    req.log.error({ err }, "Failed to get all ads");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/ads/delete", async (req, res) => {
  const { id, password } = req.body;
  if (!await isAdminOrSubAdmin(password)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    await db.delete(adsTable).where(eq(adsTable.id, id));
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete ad");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/ads/pin — toggle pin on an ad (max 5 pinned per category)
router.post("/admin/ads/pin", async (req, res) => {
  const { id, password } = req.body;
  if (!await isAdminOrSubAdmin(password)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!id) {
    return res.status(400).json({ error: "Missing id" });
  }
  try {
    const [ad] = await db.select().from(adsTable).where(eq(adsTable.id, id));
    if (!ad) {
      return res.status(404).json({ error: "Ad not found" });
    }
    // If currently pinned → unpin directly
    if (ad.isPinned) {
      const [updated] = await db
        .update(adsTable)
        .set({ isPinned: false })
        .where(eq(adsTable.id, id))
        .returning();
      return res.json(mapAd(updated));
    }
    // Check how many pinned ads in the same category
    const [{ pinnedCount }] = await db
      .select({ pinnedCount: count() })
      .from(adsTable)
      .where(and(eq(adsTable.category, ad.category), eq(adsTable.isPinned, true)));
    if (pinnedCount >= 5) {
      return res.status(400).json({ error: `Maximum 5 publicités épinglées par catégorie (${ad.category}). Désépinglez-en une d'abord.` });
    }
    const [updated] = await db
      .update(adsTable)
      .set({ isPinned: true })
      .where(eq(adsTable.id, id))
      .returning();
    return res.json(mapAd(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to pin ad");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/ads/renewal-link/:adId
// Crée une transaction FedaPay de renouvellement et redirige vers la page de paiement
router.get("/ads/renewal-link/:adId", async (req, res) => {
  const adId = parseInt(req.params.adId, 10);
  if (isNaN(adId) || adId <= 0) {
    return res.status(400).send("Identifiant publicité invalide");
  }
  const ads = await db.select().from(adsTable).where(eq(adsTable.id, adId)).limit(1);
  if (ads.length === 0) {
    return res.status(404).send("Publicité introuvable");
  }
  const ad = ads[0];
  try {
    const callbackUrl = `https://togomarket.site/api/fedapay-callback`;
    const txRes = await fetch(`${getFedapayBaseUrlAds()}/transactions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${FEDAPAY_SECRET_KEY_ADS}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        description: `Renouvellement publicité TogoMarket — annonce #${ad.id}`,
        amount: 1000,
        currency: { iso: "XOF" },
        callback_url: callbackUrl,
        customer: {
          firstname: ad.advertiserName ?? ad.advertiserPhone,
          phone_number: { number: ad.advertiserPhone, country: getPhoneCountryAds(ad.advertiserPhone) },
        },
        custom_metadata: { entityType: "ad", entityId: String(ad.id) },
        include_fees: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!txRes.ok) {
      req.log.error({ adId, status: txRes.status }, "Ads renewal-link: FedaPay error");
      return res.redirect("https://togomarket.site");
    }
    const json = await txRes.json() as Record<string, unknown>;
    const txRaw = (json["v1/transaction"] ?? (json["v1"] as Record<string, unknown> | undefined)?.["transaction"] ?? json["transaction"] ?? json) as Record<string, unknown>;
    const paymentUrl = String(txRaw["payment_url"] ?? "");
    if (!paymentUrl) {
      req.log.error({ adId, json }, "Ads renewal-link: no payment_url");
      return res.redirect("https://togomarket.site");
    }
    return res.redirect(302, paymentUrl);
  } catch (err) {
    req.log.error({ err, adId }, "Ads renewal-link: unexpected error");
    return res.redirect("https://togomarket.site");
  }
});

export default router;
