import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import {
  isBridgeSecretConfigured,
  isValidBridgeSecret,
  parseCreditInput,
  parseVerifyInput,
} from "../lib/game-bridge-security";
import { consumeLaunchToken } from "../lib/game-launch";
import { parseLaunchTokenInput } from "../lib/game-launch-token";
import { creditGameWallet, verifyBuyerPhone } from "../lib/game-wallet";
import { respondToRouteError } from "../lib/route-errors";

/**
 * Pont avec le mini-jeu « Les 10 Super Défis » (service séparé) : routes INTERNES, protégées par un secret partagé.
 * Montées sous /api comme toutes les routes du dépôt : https://<site>/api/internal/...
 * Aucune route ne renvoie jamais le solde, le nom ou l'identité d'un acheteur autre que celui désigné par son numéro.
 */
const router: IRouter = Router();

const UNAUTHORIZED = { error: "Non autorisé" };

function requireBridgeSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.GAME_BRIDGE_SECRET?.trim();
  if (!isBridgeSecretConfigured(expected)) {
    (req.log ?? logger).error("Pont jeu : GAME_BRIDGE_SECRET absent ou trop court, routes fermées");
    res.status(401).json(UNAUTHORIZED);
    return;
  }
  if (!isValidBridgeSecret(req.headers["x-internal-secret"], expected)) {
    (req.log ?? logger).warn({ route: req.path, ip: req.ip }, "Pont jeu : secret invalide");
    res.status(401).json(UNAUTHORIZED);
    return;
  }
  next();
}

/** POST /api/internal/verify-phone — { phoneNumber } -> { exists: true, buyerId } | { exists: false } */
router.post("/internal/verify-phone", requireBridgeSecret, async (req: Request, res: Response): Promise<void> => {
  const parsed = parseVerifyInput(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "Requête invalide" });
    return;
  }
  try {
    const buyerId = await verifyBuyerPhone(parsed.value.phoneNumber, req.ip ?? null);
    res.json(buyerId === null ? { exists: false } : { exists: true, buyerId });
  } catch (err) {
    respondToRouteError(req, res, err, { route: "POST /internal/verify-phone", message: "Erreur interne" });
  }
});

/**
 * POST /api/internal/verify-launch-token — { token } -> { valid: true, phoneNumber, buyerId, name } | { valid: false }
 * Le jeu échange le jeton reçu dans l'adresse de redirection (fragment « #tm_launch= ») contre le numéro PROUVÉ du joueur.
 * Le jeton est signé, valable 10 minutes et ne s'échange qu'une fois : le jeu doit ensuite ouvrir sa propre session.
 * Ne renvoie que ce qui désigne CE joueur : son numéro, l'identifiant de son compte et le nom de son compte acheteur
 * (null s'il n'en a pas) : jamais de solde ni d'information sur un autre acheteur.
 */
router.post("/internal/verify-launch-token", requireBridgeSecret, async (req: Request, res: Response): Promise<void> => {
  const parsed = parseLaunchTokenInput(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "Requête invalide" });
    return;
  }
  try {
    const result = await consumeLaunchToken(parsed.value.token, req.ip ?? null);
    (req.log ?? logger).info({ valid: result !== null }, "Pont jeu : jeton de lancement présenté");
    res.setHeader("Cache-Control", "no-store");
    res.json(result ? { valid: true, phoneNumber: `+${result.phone}`, buyerId: result.buyerId, name: result.name } : { valid: false });
  } catch (err) {
    respondToRouteError(req, res, err, { route: "POST /internal/verify-launch-token", message: "Erreur interne" });
  }
});

/**
 * POST /api/internal/wallet/credit
 * { idempotencyKey, phoneNumber, amountFcfa, period, reason: "weekly" | "podium" | "monthly" }
 *   -> { status: "credited", newBalance } | { status: "already_processed" }
 */
router.post("/internal/wallet/credit", requireBridgeSecret, async (req: Request, res: Response): Promise<void> => {
  const parsed = parseCreditInput(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "Requête invalide" });
    return;
  }
  try {
    const result = await creditGameWallet(parsed.value);
    (req.log ?? logger).info(
      { reason: parsed.value.reason, period: parsed.value.period, amountFcfa: parsed.value.amountFcfa, result: result.kind },
      "Pont jeu : crédit traité",
    );
    switch (result.kind) {
      case "credited":
        res.json({ status: "credited", newBalance: result.newBalance });
        return;
      case "already_processed":
        res.json({ status: "already_processed" });
        return;
      case "buyer_not_found":
        res.status(404).json({ error: "Introuvable" });
        return;
      case "idempotency_conflict":
      case "limit_reached":
        res.status(409).json({ error: "Conflit" });
        return;
    }
  } catch (err) {
    respondToRouteError(req, res, err, { route: "POST /internal/wallet/credit", message: "Erreur interne" });
  }
});

export default router;
