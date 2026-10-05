import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { buyerAccountsTable, db } from "@workspace/db";
import { getVerifiedBuyerPhone } from "../lib/buyer-phone";
import { resolveBuyerConversationId } from "../lib/conversation-access";
import { respondToRouteError } from "../lib/route-errors";

/**
 * GET /api/delivery/conversations/:conversationId/game-balance   (en-tête x-buyer-token)
 *   -> { verified: boolean, balanceFcfa: number }
 *
 * Solde « 10défis » de l'acheteur, affiché dans « Mon portefeuille ». Il appartient au compte-numéro de l'acheteur :
 * il n'est donc montré que si le numéro de CETTE conversation a été prouvé (code WhatsApp). Sinon, 0 et verified=false,
 * sans jamais révéler le solde d'un numéro non prouvé.
 */
const router: IRouter = Router();

router.get("/delivery/conversations/:conversationId/game-balance", async (req, res): Promise<void> => {
  const requested = Number(req.params.conversationId);
  const token = req.headers["x-buyer-token"];
  const conversationId = Number.isInteger(requested) && requested > 0 && typeof token === "string" && token
    ? await resolveBuyerConversationId(requested, token)
    : null;
  if (!conversationId) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }
  try {
    res.setHeader("Cache-Control", "no-store");
    const phone = await getVerifiedBuyerPhone(conversationId);
    if (!phone) {
      res.json({ verified: false, balanceFcfa: 0 });
      return;
    }
    const [account] = await db
      .select({ balance: buyerAccountsTable.solde10defisFcfa })
      .from(buyerAccountsTable)
      .where(eq(buyerAccountsTable.phone, phone))
      .limit(1);
    res.json({ verified: true, balanceFcfa: Math.max(0, account?.balance ?? 0) });
  } catch (err) {
    respondToRouteError(req, res, err, { route: "GET /delivery/conversations/:id/game-balance", message: "Solde 10défis momentanément indisponible." });
  }
});

export default router;
