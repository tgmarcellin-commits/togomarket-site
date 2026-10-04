import { Router, type IRouter } from "express";
import { authenticateVendorRequest } from "../lib/vendor-auth";
import { resolveBuyerConversationId } from "../lib/conversation-access";
import { resolveWorkflowDriverId } from "../lib/driver-workflow-auth";
import { isBuyerWalletByPhoneEnabled } from "../lib/buyer-accounts";
import { isFedapayPayoutsEnabled } from "../lib/fedapay-payouts";
import {
  applyCapacityToWalletSummary,
  getFedapayWithdrawalCapacity,
  requestAutomaticWithdrawal,
} from "../lib/wallet-payouts";
import { BusinessRuleError } from "../lib/route-errors";

const router: IRouter = Router();

/**
 * GET /api/wallets/... — enrichit la réponse du routeur d'origine : le bouton « Retirer » ne devient actif que si
 * les fonds sont aussi disponibles chez FedaPay. Sans FEDAPAY_PAYOUTS_ENABLED=true, la réponse est inchangée.
 */
router.use("/wallets", async (req, res, next): Promise<void> => {
  if (req.method !== "GET" || !isFedapayPayoutsEnabled()) {
    next();
    return;
  }
  const capacity = await getFedapayWithdrawalCapacity();
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => originalJson(applyCapacityToWalletSummary(body, capacity))) as typeof res.json;
  next();
});

/**
 * POST /api/wallets/withdraw — retrait automatique par FedaPay pour les livreurs, les vendeurs et les acheteurs
 * (acheteurs en mode « une conversation = un portefeuille » ; avec le portefeuille par numéro, c'est buyer-wallet.ts).
 * L'identité du portefeuille vient de la session, jamais du corps de la requête.
 */
router.post("/wallets/withdraw", async (req, res, next): Promise<void> => {
  if (!isFedapayPayoutsEnabled()) {
    next();
    return;
  }
  const body = (req.body ?? {}) as { ownerType?: unknown; ownerId?: unknown; amount?: unknown; phoneNumber?: unknown };
  const ownerType = body.ownerType;

  let ownerId: number | null = null;
  if (ownerType === "driver") {
    ownerId = await resolveWorkflowDriverId(req.headers.authorization);
  } else if (ownerType === "seller") {
    const vendor = await authenticateVendorRequest(req);
    ownerId = vendor?.id ?? null;
  } else if (ownerType === "buyer") {
    if (isBuyerWalletByPhoneEnabled()) {
      next(); // géré par buyer-wallet.ts (numéro vérifié)
      return;
    }
    const conversationId = Number(body.ownerId);
    const token = req.headers["x-buyer-token"];
    ownerId = Number.isInteger(conversationId) && conversationId > 0 && typeof token === "string"
      ? await resolveBuyerConversationId(conversationId, token)
      : null;
  } else {
    next();
    return;
  }

  if (!ownerId) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }

  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount <= 0) {
    res.status(400).json({ error: "Montant de retrait invalide. Saisissez un nombre entier de FCFA." });
    return;
  }

  try {
    const result = await requestAutomaticWithdrawal({
      ownerType,
      ownerId,
      amount,
      phoneNumber: String(body.phoneNumber ?? ""),
    });
    res.status(201).json({ ...result, withdrawal: { status: result.status } });
  } catch (err) {
    if (err instanceof BusinessRuleError) {
      const rule = err as BusinessRuleError;
      res.status(rule.status).json({ error: rule.message });
      return;
    }
    req.log?.error({ err, ownerType }, "Retrait automatique impossible");
    res.status(500).json({ error: "Retrait momentanément indisponible, réessayez" });
  }
});

export default router;
