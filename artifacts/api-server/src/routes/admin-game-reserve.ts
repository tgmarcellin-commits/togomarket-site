import { Router, type IRouter, type Request, type Response } from "express";
import { isSuperAdmin, verifyAdminCode } from "../lib/admin-auth";
import { verifyCourseTransaction } from "../lib/course-payment";
import { getReserveOverview, topUpReserve } from "../lib/game-reserve";
import { isGameSpendingEnabled } from "../lib/game-spend";
import { logAndRespondInternalError } from "../lib/route-errors";

/**
 * Réserve TogoMarket (fonds qui couvrent les achats payés en 10défis) — réservé au SUPERADMIN.
 * Authentification : en-tête x-admin-code (comme les autres routes d'administration).
 *   GET  /api/admin/game-reserve         -> solde, seuil d'alerte, derniers mouvements
 *   POST /api/admin/game-reserve/topup   -> { amountFcfa, fedapayReference } : enregistre une recharge manuelle
 */
const router: IRouter = Router();

const MAX_TOPUP_FCFA = 50_000_000;

async function requireSuperAdmin(req: Request, res: Response): Promise<{ username: string } | null> {
  const code = req.headers["x-admin-code"];
  if (typeof code !== "string" || code.length === 0 || !(await isSuperAdmin(code))) {
    res.status(403).json({ error: "Accès refusé — superadmin requis" });
    return null;
  }
  const account = await verifyAdminCode(code).catch(() => null);
  return { username: account?.username ?? "superadmin" };
}

router.get("/admin/game-reserve", async (req, res): Promise<void> => {
  if (!(await requireSuperAdmin(req, res))) return;
  try {
    const overview = await getReserveOverview();
    res.setHeader("Cache-Control", "no-store");
    res.json({ ...overview, spendingEnabled: isGameSpendingEnabled() });
  } catch (err) {
    logAndRespondInternalError(req, res, { route: "GET /admin/game-reserve", message: "Réserve indisponible", err });
  }
});

router.post("/admin/game-reserve/topup", async (req, res): Promise<void> => {
  const admin = await requireSuperAdmin(req, res);
  if (!admin) return;

  const body = (req.body ?? {}) as { amountFcfa?: unknown; fedapayReference?: unknown };
  const amount = body.amountFcfa;
  const reference = typeof body.fedapayReference === "string" ? body.fedapayReference.trim() : "";
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0 || amount > MAX_TOPUP_FCFA) {
    res.status(400).json({ error: "Montant invalide : un nombre entier de FCFA, supérieur à 0." });
    return;
  }
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(reference)) {
    res.status(400).json({ error: "Référence de la transaction FedaPay invalide (lettres, chiffres, _ et - uniquement)." });
    return;
  }

  try {
    // Contrôle chez FedaPay quand la transaction est lisible avec la clé Marketplace :
    //  - jamais une transaction liée à une commande client (cet argent appartient au séquestre de la commande) ;
    //  - la transaction doit être approuvée et son montant identique à celui saisi.
    // Transaction illisible (autre compte, référence textuelle) : la recharge est enregistrée, marquée « non vérifiée ».
    const fedapay = await verifyCourseTransaction(reference);
    if (fedapay) {
      if (fedapay.entityType) {
        res.status(409).json({ error: "Cette transaction correspond au paiement d'une commande : elle ne peut pas alimenter la réserve." });
        return;
      }
      if (!fedapay.approved || fedapay.amount !== amount) {
        res.status(409).json({
          error: `La transaction FedaPay ne correspond pas (statut ${fedapay.approved ? "approuvé" : "non approuvé"}, montant ${fedapay.amount} FCFA).`,
        });
        return;
      }
    }

    const result = await topUpReserve({
      amountFcfa: amount,
      reference,
      actor: admin.username,
      metadata: { fedapayVerified: Boolean(fedapay) },
    });
    if (result.kind === "already_recorded") {
      res.status(409).json({ error: "Cette référence de transaction FedaPay a déjà été enregistrée." });
      return;
    }
    (req.log ?? console).info?.({ amountFcfa: amount, reserveFcfa: result.balanceAfter, verified: Boolean(fedapay) }, "Recharge de la réserve TogoMarket enregistrée");
    res.status(201).json({
      success: true,
      balanceBeforeFcfa: result.balanceBefore,
      balanceAfterFcfa: result.balanceAfter,
      fedapayVerified: Boolean(fedapay),
    });
  } catch (err) {
    logAndRespondInternalError(req, res, { route: "POST /admin/game-reserve/topup", message: "Recharge impossible pour le moment", err });
  }
});

export default router;
