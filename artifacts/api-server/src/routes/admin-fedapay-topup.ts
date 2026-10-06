import { Router, type IRouter, type Request, type Response } from "express";
import { isSuperAdmin, verifyAdminCode } from "../lib/admin-auth";
import { createMarketplaceTopupLink } from "../lib/course-payment";
import { getTopupOverview } from "../lib/marketplace-topup";
import { TOPUP_ENTITY_TYPE, parseTopupInput } from "../lib/marketplace-topup-core";
import { logAndRespondInternalError } from "../lib/route-errors";

/**
 * Alimentation du compte FedaPay « Marketplace » — réservé au SUPERADMIN (en-tête x-admin-code).
 *   GET  /api/admin/fedapay-topup  -> soldes chez FedaPay, réserve du jeu, dernières alimentations
 *   POST /api/admin/fedapay-topup  -> { amountFcfa, target: "reserve" | "treasury" } : crée le paiement FedaPay et renvoie son adresse
 * L'argent n'est inscrit (réserve, grand livre) que lorsque FedaPay confirme le paiement par webhook.
 */
const router: IRouter = Router();

async function requireSuperAdmin(req: Request, res: Response): Promise<{ username: string } | null> {
  const code = req.headers["x-admin-code"];
  if (typeof code !== "string" || code.length === 0 || !(await isSuperAdmin(code))) {
    res.status(403).json({ error: "Accès refusé — superadmin requis" });
    return null;
  }
  const account = await verifyAdminCode(code).catch(() => null);
  return { username: account?.username ?? "superadmin" };
}

router.get("/admin/fedapay-topup", async (req, res): Promise<void> => {
  if (!(await requireSuperAdmin(req, res))) return;
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(await getTopupOverview());
  } catch (err) {
    logAndRespondInternalError(req, res, { route: "GET /admin/fedapay-topup", message: "Soldes indisponibles", err });
  }
});

router.post("/admin/fedapay-topup", async (req, res): Promise<void> => {
  const admin = await requireSuperAdmin(req, res);
  if (!admin) return;

  const parsed = parseTopupInput(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const link = await createMarketplaceTopupLink({
      amount: parsed.value.amountFcfa,
      target: parsed.value.target,
      entityType: TOPUP_ENTITY_TYPE,
    });
    (req.log ?? console).info?.(
      { amountFcfa: parsed.value.amountFcfa, target: parsed.value.target, transactionId: link.transactionId, admin: admin.username },
      "Alimentation du compte Marketplace : paiement FedaPay créé",
    );
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ transactionId: link.transactionId, paymentUrl: link.paymentUrl });
  } catch (err) {
    logAndRespondInternalError(req, res, { route: "POST /admin/fedapay-topup", message: "Création du paiement FedaPay impossible pour le moment", err });
  }
});

export default router;
