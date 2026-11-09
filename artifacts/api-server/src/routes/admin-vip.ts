import { Router, type IRouter } from "express";
import { isSuperAdmin } from "../lib/admin-auth";
import { listVipVendors, addVipVendor, removeVipVendor } from "../lib/vip-vendors";

const router: IRouter = Router();

function parseVendorId(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// POST /api/admin/vip-vendors/list — liste des boutiques VIP (superadmin)
router.post("/admin/vip-vendors/list", async (req, res): Promise<void> => {
  if (!await isSuperAdmin(String(req.body?.password ?? ""))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const rows = await listVipVendors();
    res.json(rows.map((r) => ({ ...r, addedAt: r.addedAt.toISOString(), vipUntil: r.vipUntil?.toISOString() ?? null })));
  } catch (err) {
    req.log.error({ err }, "Failed to list VIP vendors");
    res.status(500).json({ error: "Erreur interne" });
  }
});

// POST /api/admin/vip-vendors/add — ajoute une boutique VIP par son numéro
router.post("/admin/vip-vendors/add", async (req, res): Promise<void> => {
  if (!await isSuperAdmin(String(req.body?.password ?? ""))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const vendorId = parseVendorId(req.body?.vendorId);
  if (!vendorId) {
    res.status(400).json({ error: "Numéro de boutique invalide" });
    return;
  }
  // years : absent/null = illimité ; 1 = un an
  const rawYears = req.body?.years;
  const years = rawYears === undefined || rawYears === null ? null : Number(rawYears);
  if (years !== null && years !== 1) {
    res.status(400).json({ error: "Durée invalide" });
    return;
  }
  try {
    const result = await addVipVendor(vendorId, years);
    if (result === "not_found") {
      res.status(404).json({ error: "Boutique introuvable" });
      return;
    }
    if (result === "already_vip") {
      res.status(409).json({ error: "Cette boutique est déjà VIP" });
      return;
    }
    req.log.info({ vendorId }, "Vendor added to VIP list");
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to add VIP vendor");
    res.status(500).json({ error: "Erreur interne" });
  }
});

// POST /api/admin/vip-vendors/remove — retire une boutique de la liste VIP
router.post("/admin/vip-vendors/remove", async (req, res): Promise<void> => {
  if (!await isSuperAdmin(String(req.body?.password ?? ""))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const vendorId = parseVendorId(req.body?.vendorId);
  if (!vendorId) {
    res.status(400).json({ error: "Numéro de boutique invalide" });
    return;
  }
  try {
    const result = await removeVipVendor(vendorId);
    if (result === "not_vip") {
      res.status(404).json({ error: "Cette boutique n'est pas dans la liste VIP" });
      return;
    }
    req.log.info({ vendorId }, "Vendor removed from VIP list");
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to remove VIP vendor");
    res.status(500).json({ error: "Erreur interne" });
  }
});

export default router;
