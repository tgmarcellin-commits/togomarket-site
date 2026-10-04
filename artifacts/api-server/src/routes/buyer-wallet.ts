import { Router, type IRouter } from "express";
import { and, eq, gte, notInArray, sql } from "drizzle-orm";
import { db, deliveryWithdrawalTicketsTable } from "@workspace/db";
import { resolveBuyerConversationId } from "../lib/conversation-access";
import { getBuyerAccountView, isBuyerWalletByPhoneEnabled } from "../lib/buyer-accounts";
import { maskPhone, sendBuyerPhoneCode, verifyBuyerPhoneCode } from "../lib/buyer-phone";
import { BusinessRuleError } from "../lib/route-errors";
import { getWalletSummary, requestWalletWithdrawal } from "../lib/wallet-service";
import { isFedapayPayoutsEnabled } from "../lib/fedapay-payouts";
import { requestAutomaticWithdrawal } from "../lib/wallet-payouts";

const router: IRouter = Router();

const VERIFY_MESSAGE = "Vérifiez votre numéro de téléphone par code WhatsApp pour accéder à votre portefeuille.";

async function authorize(conversationId: number, header: unknown): Promise<number | null> {
  if (!Number.isInteger(conversationId) || conversationId <= 0 || typeof header !== "string" || !header) return null;
  return resolveBuyerConversationId(conversationId, header);
}

/**
 * GET /api/delivery/conversations/:conversationId/buyer-balance    (header x-buyer-token)
 * État du portefeuille unique du numéro. Aucun montant n'est révélé tant que le numéro n'est pas vérifié :
 * un numéro saisi à la main ne prouve pas qu'il appartient à celui qui écrit.
 */
router.get("/delivery/conversations/:conversationId/buyer-balance", async (req, res): Promise<void> => {
  const conversationId = await authorize(Number(req.params.conversationId), req.headers["x-buyer-token"]);
  if (!conversationId) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  if (!isBuyerWalletByPhoneEnabled()) {
    // Mode actuel : portefeuille propre à la conversation, aucune vérification de numéro
    res.json({ enabled: false });
    return;
  }
  const view = await getBuyerAccountView(conversationId);
  if (!view?.verified) {
    res.json({ enabled: true, verified: false, phoneMasked: null, availableFcfa: 0, lockedFcfa: 0, pendingFcfa: 0 });
    return;
  }
  res.json({
    enabled: true,
    verified: true,
    phoneMasked: maskPhone(view.phone),
    availableFcfa: view.balance,
    lockedFcfa: view.lockedBalance,
    pendingFcfa: view.pendingPayoutBalance,
  });
});

/** POST /api/delivery/conversations/:conversationId/buyer-phone/send-code */
router.post("/delivery/conversations/:conversationId/buyer-phone/send-code", async (req, res): Promise<void> => {
  if (!isBuyerWalletByPhoneEnabled()) {
    res.status(404).json({ error: "Fonction non activée" });
    return;
  }
  const conversationId = await authorize(Number(req.params.conversationId), req.headers["x-buyer-token"]);
  if (!conversationId) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }
  try {
    const result = await sendBuyerPhoneCode(conversationId);
    res.json({ sent: true, ...result });
  } catch (err) {
    if (err instanceof BusinessRuleError) {
      const rule = err as BusinessRuleError;
      res.status(rule.status).json({ error: rule.message });
      return;
    }
    req.log?.error({ err, conversationId }, "Envoi du code de vérification du numéro impossible");
    res.status(500).json({ error: "Envoi du code momentanément indisponible, réessayez" });
  }
});

/** POST /api/delivery/conversations/:conversationId/buyer-phone/verify   Body: { code } */
router.post("/delivery/conversations/:conversationId/buyer-phone/verify", async (req, res): Promise<void> => {
  if (!isBuyerWalletByPhoneEnabled()) {
    res.status(404).json({ error: "Fonction non activée" });
    return;
  }
  const conversationId = await authorize(Number(req.params.conversationId), req.headers["x-buyer-token"]);
  if (!conversationId) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }
  const code = String((req.body as { code?: unknown } | undefined)?.code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "Le code comporte 6 chiffres." });
    return;
  }
  const result = await verifyBuyerPhoneCode(conversationId, code);
  if (result.verified) {
    res.json({ verified: true });
    return;
  }
  const messages = {
    no_code: "Aucun code en attente. Demandez un nouveau code.",
    expired: "Ce code a expiré. Demandez un nouveau code.",
    too_many_attempts: "Trop d'essais. Demandez un nouveau code.",
    wrong_code: "Code incorrect.",
  } as const;
  res.status(400).json({ error: messages[result.reason], attemptsLeft: result.attemptsLeft ?? 0 });
});

/**
 * GET /api/wallets/buyer/:conversationId — remplace la lecture par conversation :
 * le portefeuille affiché est celui du NUMÉRO (tous vendeurs confondus), après vérification du numéro.
 * Toute requête sans jeton acheteur est laissée au routeur d'origine.
 */
router.get("/wallets/buyer/:conversationId", async (req, res, next): Promise<void> => {
  if (!isBuyerWalletByPhoneEnabled() || typeof req.headers["x-buyer-token"] !== "string") {
    next();
    return;
  }
  const conversationId = await authorize(Number(req.params.conversationId), req.headers["x-buyer-token"]);
  if (!conversationId) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }
  const view = await getBuyerAccountView(conversationId);
  res.setHeader("Cache-Control", "no-store");
  if (!view?.verified) {
    res.json({
      verificationRequired: true,
      availableBalance: 0,
      lockedBalance: 0,
      pendingPayoutBalance: 0,
      paidOutBalance: 0,
      withdrawalReadiness: { canWithdraw: false, maxWithdrawableAmount: 0 },
      withdrawalAvailability: {
        canWithdraw: false,
        availableForWithdrawal: 0,
        lockedAmount: 0,
        pendingPayout: 0,
        statusLabel: VERIFY_MESSAGE,
      },
      recentMovements: [],
    });
    return;
  }
  const summary = await getWalletSummary("buyer", view.accountId);
  res.json({ ...summary, verificationRequired: false });
});

type WithdrawalLimits = { perOperation: number; daily: number; monthly: number };
const DEFAULT_LIMITS: WithdrawalLimits = { perOperation: 50_000, daily: 100_000, monthly: 500_000 };

/** Plafonds des retraits acheteur (platform_settings) ; valeurs du cahier des charges si les colonnes n'existent pas. */
async function readWithdrawalLimits(): Promise<WithdrawalLimits> {
  try {
    const result = await db.execute(sql`
      select buyer_withdrawal_per_operation_limit as per_operation,
             buyer_withdrawal_daily_cumulative_limit as daily,
             buyer_withdrawal_monthly_rolling_limit as monthly
      from platform_settings limit 1`);
    const row = result.rows[0] as { per_operation?: unknown; daily?: unknown; monthly?: unknown } | undefined;
    const positive = (value: unknown, fallback: number) => (Number(value) > 0 ? Number(value) : fallback);
    return {
      perOperation: positive(row?.per_operation, DEFAULT_LIMITS.perOperation),
      daily: positive(row?.daily, DEFAULT_LIMITS.daily),
      monthly: positive(row?.monthly, DEFAULT_LIMITS.monthly),
    };
  } catch {
    return DEFAULT_LIMITS;
  }
}

async function withdrawnSince(accountId: number, since: Date): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${deliveryWithdrawalTicketsTable.amount}), 0)` })
    .from(deliveryWithdrawalTicketsTable)
    .where(and(
      eq(deliveryWithdrawalTicketsTable.ownerType, "buyer"),
      eq(deliveryWithdrawalTicketsTable.ownerId, accountId),
      gte(deliveryWithdrawalTicketsTable.createdAt, since),
      notInArray(deliveryWithdrawalTicketsTable.status, ["failed", "cancelled"]),
    ));
  return Number(row?.total ?? 0);
}

const fcfa = (value: number) => `${new Intl.NumberFormat("fr-FR").format(value)} FCFA`;

/**
 * POST /api/wallets/withdraw — retrait d'un acheteur sur le TOTAL de son portefeuille unique.
 * Conditions : numéro vérifié ; le virement part uniquement vers ce numéro vérifié (le numéro envoyé par le
 * navigateur est ignoré) ; plafonds par opération / par jour / sur 30 jours glissants.
 * Les retraits vendeur et livreur sont laissés au routeur d'origine.
 */
router.post("/wallets/withdraw", async (req, res, next): Promise<void> => {
  const body = (req.body ?? {}) as { ownerType?: unknown; ownerId?: unknown; amount?: unknown };
  if (!isBuyerWalletByPhoneEnabled() || body.ownerType !== "buyer") {
    next();
    return;
  }
  const conversationId = await authorize(Number(body.ownerId), req.headers["x-buyer-token"]);
  if (!conversationId) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }
  const view = await getBuyerAccountView(conversationId);
  if (!view?.verified) {
    res.status(409).json({ error: VERIFY_MESSAGE });
    return;
  }
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount <= 0) {
    res.status(400).json({ error: "Montant de retrait invalide. Saisissez un nombre entier de FCFA." });
    return;
  }

  const limits = await readWithdrawalLimits();
  if (amount > limits.perOperation) {
    res.status(409).json({ error: `Retrait limité à ${fcfa(limits.perOperation)} par opération.` });
    return;
  }
  const now = new Date();
  const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [dailyUsed, monthlyUsed] = await Promise.all([
    withdrawnSince(view.accountId, dayStart),
    withdrawnSince(view.accountId, monthStart),
  ]);
  if (dailyUsed + amount > limits.daily) {
    res.status(409).json({
      error: `Plafond journalier atteint : ${fcfa(limits.daily)} par 24 h (déjà retiré : ${fcfa(dailyUsed)}).`,
    });
    return;
  }

  try {
    const monthlyExceeded = monthlyUsed + amount > limits.monthly;
    // Virement automatique FedaPay sur le numéro vérifié ; au-delà du plafond mensuel, la validation manuelle reste obligatoire
    if (isFedapayPayoutsEnabled() && !monthlyExceeded) {
      const automatic = await requestAutomaticWithdrawal({
        ownerType: "buyer",
        ownerId: view.accountId,
        amount,
        phoneNumber: view.phone,
      });
      await db
        .update(deliveryWithdrawalTicketsTable)
        .set({ dailyCumulativeAmount: dailyUsed + amount, monthlyCumulativeAmount: monthlyUsed + amount, updatedAt: new Date() })
        .where(eq(deliveryWithdrawalTicketsTable.id, automatic.ticketId));
      res.status(201).json({ ...automatic, withdrawal: { status: automatic.status } });
      return;
    }
    const result = await requestWalletWithdrawal({
      ownerType: "buyer",
      ownerId: view.accountId,
      amount,
      phoneNumber: view.phone,
    });
    // Cumuls et motif de revue : au-delà du plafond mensuel, la validation manuelle du superadmin reste obligatoire
    await db
      .update(deliveryWithdrawalTicketsTable)
      .set({
        dailyCumulativeAmount: dailyUsed + amount,
        monthlyCumulativeAmount: monthlyUsed + amount,
        reviewReason: monthlyExceeded
          ? "Plafond mensuel glissant dépassé : validation manuelle du superadmin requise"
          : "Retrait acheteur : validation manuelle",
        updatedAt: new Date(),
      })
      .where(eq(deliveryWithdrawalTicketsTable.id, result.ticketId));
    res.status(201).json({ ...result, withdrawal: { status: result.status } });
  } catch (err) {
    if (err instanceof BusinessRuleError) {
      const rule = err as BusinessRuleError;
      res.status(rule.status).json({ error: rule.message });
      return;
    }
    req.log?.error({ err, conversationId }, "Retrait acheteur impossible");
    res.status(500).json({ error: "Retrait momentanément indisponible, réessayez" });
  }
});

export default router;
