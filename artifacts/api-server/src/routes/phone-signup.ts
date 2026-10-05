import { Router, type IRouter } from "express";
import { resolveBuyerConversationId } from "../lib/conversation-access";
import { createRateLimiter, parseSendInput, parseVerifyInput } from "../lib/phone-signup-core";
import { linkConversationWithProof, sendSignupCode, verifySignupCode } from "../lib/phone-signup";
import { respondToRouteError } from "../lib/route-errors";

/**
 * Inscription par numéro (challenge « 10Défis »), sans conversation :
 *   POST /api/phone/send-code    { phoneNumber, name }        -> { sent, phoneMasked, expiresInSeconds }
 *   POST /api/phone/verify-code  { phoneNumber, name, code }  -> { ok, proof, expiresAt }   (compte acheteur créé)
 *   POST /api/delivery/conversations/:id/buyer-phone/link-proof { proof }  (x-buyer-token) -> { linked }
 * Les réponses sont identiques que le compte existe déjà ou non (aucune information sur les comptes n'est donnée).
 */
const router: IRouter = Router();

// Anti-abus : l'envoi d'un code WhatsApp coûte de l'argent et dérange un tiers
const sendLimiter = createRateLimiter({ max: 8, windowMs: 60 * 60 * 1000 });
const verifyLimiter = createRateLimiter({ max: 40, windowMs: 60 * 60 * 1000 });
const linkLimiter = createRateLimiter({ max: 60, windowMs: 60 * 60 * 1000 });

router.post("/phone/send-code", async (req, res): Promise<void> => {
  if (sendLimiter.hit(req.ip ?? "inconnue")) {
    res.status(429).json({ error: "Trop de demandes. Réessayez dans une heure." });
    return;
  }
  const parsed = parseSendInput(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "Saisissez votre nom et votre numéro avec l'indicatif, par exemple +22897000000." });
    return;
  }
  try {
    const result = await sendSignupCode(parsed.value.phoneNumber, parsed.value.name);
    res.json({ sent: true, ...result });
  } catch (err) {
    respondToRouteError(req, res, err, { route: "POST /phone/send-code", message: "Envoi du code momentanément indisponible, réessayez." });
  }
});

router.post("/phone/verify-code", async (req, res): Promise<void> => {
  if (verifyLimiter.hit(req.ip ?? "inconnue")) {
    res.status(429).json({ error: "Trop d'essais. Réessayez dans une heure." });
    return;
  }
  const parsed = parseVerifyInput(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "Le code comporte 6 chiffres." });
    return;
  }
  try {
    const result = await verifySignupCode(parsed.value.phoneNumber, parsed.value.name, parsed.value.code);
    if (result.kind === "verified") {
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, proof: result.proof, expiresAt: result.expiresAt });
      return;
    }
    const messages = {
      no_code: "Aucun code en attente. Demandez un nouveau code.",
      expired: "Ce code a expiré. Demandez un nouveau code.",
      too_many_attempts: "Trop d'essais. Demandez un nouveau code.",
      wrong_code: "Code incorrect.",
    } as const;
    res.status(400).json({
      error: messages[result.kind],
      ...(result.kind === "wrong_code" ? { attemptsLeft: result.attemptsLeft } : {}),
    });
  } catch (err) {
    respondToRouteError(req, res, err, { route: "POST /phone/verify-code", message: "Vérification momentanément indisponible, réessayez." });
  }
});

router.post("/delivery/conversations/:conversationId/buyer-phone/link-proof", async (req, res): Promise<void> => {
  if (linkLimiter.hit(req.ip ?? "inconnue")) {
    res.status(429).json({ error: "Trop de demandes." });
    return;
  }
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
    // « false » sans détail : une preuve invalide, expirée ou d'un autre numéro ne se distingue pas
    const linked = await linkConversationWithProof(conversationId, (req.body as { proof?: unknown } | undefined)?.proof);
    res.setHeader("Cache-Control", "no-store");
    res.json({ linked });
  } catch (err) {
    respondToRouteError(req, res, err, { route: "POST /delivery/conversations/:id/buyer-phone/link-proof", message: "Liaison impossible pour le moment." });
  }
});

export default router;
