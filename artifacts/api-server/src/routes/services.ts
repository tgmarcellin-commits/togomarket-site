import { Router, type IRouter } from "express";
import { gt, eq, and } from "drizzle-orm";
import { db, servicesTable } from "@workspace/db";
import { getAdminRole } from "../lib/admin-auth";

async function canManageServices(password: unknown): Promise<boolean> {
  const role = await getAdminRole(String(password ?? ""));
  return role === "superadmin" || role === "admin_service";
}

const FEDAPAY_SECRET_KEY_SV = process.env.FEDAPAY_SECRET_KEY ?? "";
function getFedapayBaseUrlSv(): string {
  return FEDAPAY_SECRET_KEY_SV.startsWith("sk_live")
    ? "https://api.fedapay.com/v1"
    : "https://sandbox-api.fedapay.com/v1";
}

function getPhoneCountrySv(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("228")) return "TG";
  if (d.startsWith("229")) return "BJ";
  if (d.startsWith("225")) return "CI";
  if (d.startsWith("221")) return "SN";
  if (d.startsWith("227")) return "NE";
  return "TG";
}

const router: IRouter = Router();

function mapService(s: typeof servicesTable.$inferSelect) {
  return {
    id: s.id,
    type: s.type,
    title: s.title,
    description: s.description,
    contact: s.contact,
    quartier: s.quartier,
    ville: s.ville,
    image: s.image ?? null,
    videoPath: s.videoPath ?? null,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    isPublished: s.isPublished,
    paymentStatus: s.paymentStatus,
    validationMethod: s.validationMethod,
    fedapayTransactionId: s.fedapayTransactionId ?? null,
  };
}

router.get("/services", async (req, res) => {
  try {
    const now = new Date();
    const services = await db
      .select()
      .from(servicesTable)
      .where(and(gt(servicesTable.expiresAt, now), eq(servicesTable.isPublished, true)))
      .orderBy(servicesTable.createdAt);
    res.json(services.map(mapService));
  } catch (err) {
    req.log.error({ err }, "Failed to get services");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/services", async (req, res) => {
  const { password, type, title, description, contact, quartier, ville, image, videoPath } = req.body;
  if (!await canManageServices(password)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!type || !title || !description || !contact || !quartier || !ville) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (type !== "seeker" && type !== "offer" && type !== "atelier") {
    return res.status(400).json({ error: "type must be seeker, offer or atelier" });
  }
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const [service] = await db
      .insert(servicesTable)
      .values({
        type, title, description, contact, quartier, ville,
        image: image ?? null,
        videoPath: videoPath ?? null,
        createdAt: now,
        expiresAt,
        isPublished: false,
        paymentStatus: "unpaid",
        validationMethod: "pending",
      })
      .returning();
    return res.status(201).json(mapService(service));
  } catch (err) {
    req.log.error({ err }, "Failed to create service");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/services/all", async (req, res) => {
  const { password } = req.body;
  if (!await canManageServices(password)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const services = await db.select().from(servicesTable).orderBy(servicesTable.expiresAt);
    return res.json(services.map(mapService));
  } catch (err) {
    req.log.error({ err }, "Failed to get all services");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/services/delete", async (req, res) => {
  const { id, password } = req.body;
  if (!await canManageServices(password)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    await db.delete(servicesTable).where(eq(servicesTable.id, id));
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete service");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/services/renewal-link/:serviceId
router.get("/services/renewal-link/:serviceId", async (req, res) => {
  const serviceId = parseInt(req.params.serviceId, 10);
  if (isNaN(serviceId) || serviceId <= 0) {
    return res.status(400).send("Identifiant service invalide");
  }
  const services = await db.select().from(servicesTable).where(eq(servicesTable.id, serviceId)).limit(1);
  if (services.length === 0) {
    return res.status(404).send("Service introuvable");
  }
  const svc = services[0];
  try {
    const callbackUrl = `https://togomarket.site/api/fedapay-callback`;
    const txRes = await fetch(`${getFedapayBaseUrlSv()}/transactions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${FEDAPAY_SECRET_KEY_SV}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        description: `Renouvellement service TogoMarket — #${svc.id}`,
        amount: 1000,
        currency: { iso: "XOF" },
        callback_url: callbackUrl,
        customer: {
          firstname: svc.title,
          phone_number: { number: svc.contact.replace(/\D/g, "") || "00228", country: getPhoneCountrySv(svc.contact) },
        },
        custom_metadata: { entityType: "service", entityId: String(svc.id) },
        include_fees: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!txRes.ok) {
      req.log.error({ serviceId, status: txRes.status }, "Services renewal-link: FedaPay error");
      return res.redirect("https://togomarket.site");
    }
    const json = await txRes.json() as Record<string, unknown>;
    const txRaw = (json["v1/transaction"] ?? (json["v1"] as Record<string, unknown> | undefined)?.["transaction"] ?? json["transaction"] ?? json) as Record<string, unknown>;
    const paymentUrl = String(txRaw["payment_url"] ?? "");
    if (!paymentUrl) {
      req.log.error({ serviceId, json }, "Services renewal-link: no payment_url");
      return res.redirect("https://togomarket.site");
    }
    return res.redirect(302, paymentUrl);
  } catch (err) {
    req.log.error({ err, serviceId }, "Services renewal-link: unexpected error");
    return res.redirect("https://togomarket.site");
  }
});

export default router;
