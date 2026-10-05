import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, gameRulesAcceptancesTable } from "@workspace/db";
import { canonicalPhone } from "../lib/game-wallet";
import { CURRENT_GAME_RULES_VERSION, parseAcceptRulesInput } from "../lib/game-rules";
import { issueLaunchToken } from "../lib/game-launch";
import { verifyPhoneProof } from "../lib/phone-proof";
import { respondToRouteError } from "../lib/route-errors";

/**
 * POST /api/game/accept-rules — { accepted: true, rulesVersion, phoneNumber }
 * Enregistre la date d'acceptation du règlement du challenge « 10Défis » (preuve en cas de litige) et confirme que le
 * site peut rediriger vers le jeu, avec un jeton de lancement signé que le jeu échangera contre le numéro prouvé. Le site ne redirige QU'APRÈS une réponse positive : le serveur re-vérifie l'acceptation,
 * l'état du bouton dans le navigateur ne suffit pas.
 */
const router: IRouter = Router();

// Limite simple par adresse (en mémoire) : 20 demandes toutes les 10 minutes
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, { count: number; resetAt: number }>();

function tooManyRequests(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    if (hits.size > 5000) for (const [key, value] of hits) if (value.resetAt < now) hits.delete(key);
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

router.post("/game/accept-rules", async (req, res): Promise<void> => {
  const ip = req.ip ?? "inconnue";
  if (tooManyRequests(ip)) {
    res.status(429).json({ error: "Trop de tentatives. Réessayez dans quelques minutes." });
    return;
  }

  const parsed = parseAcceptRulesInput(req.body);
  if (!parsed.ok) {
    const messages = {
      not_accepted: "Vous devez accepter le règlement pour jouer.",
      outdated_version: "Le règlement a changé : rechargez la page puis acceptez-le à nouveau.",
      invalid: "Requête invalide. Vérifiez votre numéro (avec l'indicatif, par exemple +22897000000).",
      phone_not_verified: "Vérifiez votre numéro avec le code reçu sur WhatsApp avant de jouer.",
    } as const;
    res.status(parsed.reason === "outdated_version" ? 409 : parsed.reason === "phone_not_verified" ? 403 : 400).json({
      error: messages[parsed.reason],
      ...(parsed.reason === "phone_not_verified" ? { code: "phone_not_verified" } : {}),
    });
    return;
  }

  const phone = canonicalPhone(parsed.value.phoneNumber);
  if (!phone) {
    res.status(400).json({ error: "Numéro invalide. Saisissez-le avec l'indicatif, par exemple +22897000000." });
    return;
  }

  // La preuve doit être valide ET porter exactement ce numéro : on n'enregistre jamais l'acceptation d'un numéro non vérifié
  const proof = verifyPhoneProof(parsed.value.proof, process.env.SESSION_SECRET);
  if (!proof || proof.phone !== phone) {
    res.status(403).json({ error: "Vérifiez votre numéro avec le code reçu sur WhatsApp avant de jouer.", code: "phone_not_verified" });
    return;
  }

  try {
    const [inserted] = await db
      .insert(gameRulesAcceptancesTable)
      .values({
        phoneNumber: phone,
        rulesVersion: CURRENT_GAME_RULES_VERSION,
        sourceIp: ip.slice(0, 64),
        userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300) || null,
      })
      .onConflictDoNothing()
      .returning({ acceptedAt: gameRulesAcceptancesTable.acceptedAt });

    // Déjà accepté pour cette version : on renvoie la date d'origine (la preuve n'est jamais réécrite)
    const acceptedAt = inserted?.acceptedAt ?? (await db
      .select({ acceptedAt: gameRulesAcceptancesTable.acceptedAt })
      .from(gameRulesAcceptancesTable)
      .where(and(
        eq(gameRulesAcceptancesTable.phoneNumber, phone),
        eq(gameRulesAcceptancesTable.rulesVersion, CURRENT_GAME_RULES_VERSION),
      ))
      .limit(1))[0]?.acceptedAt;

    // Jeton de lancement : prouve au jeu, sans ressaisie, que ce numéro vient d'être vérifié (valable 10 minutes, une seule fois)
    const launchToken = await issueLaunchToken(phone);
    if (!launchToken) throw new Error("Jeton de lancement impossible à émettre (SESSION_SECRET)");
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, acceptedAt: acceptedAt?.toISOString() ?? null, launchToken });
  } catch (err) {
    respondToRouteError(req, res, err, { route: "POST /game/accept-rules", message: "Enregistrement impossible pour le moment, réessayez." });
  }
});

export default router;
