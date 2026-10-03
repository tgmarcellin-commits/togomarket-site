import { Router, type IRouter, type Request, type Response } from "express";
import { resolveWorkflowDriverId } from "../lib/driver-workflow-auth";
import { resolveConversationActor } from "../lib/conversation-actor";
import { findLatestOrderIdForConversation } from "../lib/party-locations";
import { BusinessRuleError } from "../lib/route-errors";
import {
  abandonAcceptedAssignment,
  cancelTransferOffer,
  createTransferOffer,
  getDriverNotice,
  getTransferOverview,
  isTransferOffer,
  respondToTransferOffer,
  updateDriverPresence,
} from "../lib/driver-transfer";

const router: IRouter = Router();

function fail(err: unknown, req: Request, res: Response, context: string): void {
  if (err instanceof BusinessRuleError) {
    const rule = err as BusinessRuleError;
    res.status(rule.status).json({ error: rule.message });
    return;
  }
  req.log?.error({ err }, context);
  res.status(500).json({ error: "Opération momentanément indisponible, réessayez." });
}

async function authDriver(req: Request, res: Response): Promise<number | null> {
  const driverId = await resolveWorkflowDriverId(req.headers.authorization);
  if (!driverId) res.status(401).json({ error: "Session livreur invalide" });
  return driverId;
}

function jobIdParam(req: Request, res: Response): number | null {
  const id = Number(req.params.deliveryJobId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Mission invalide" });
    return null;
  }
  return id;
}

/** POST /api/driver-connexion/presence  { latitude, longitude, accuracyMeters? } — dernière position d'un livreur disponible */
router.post("/driver-connexion/presence", async (req, res): Promise<void> => {
  const driverId = await authDriver(req, res);
  if (!driverId) return;
  const body = (req.body ?? {}) as { latitude?: unknown; longitude?: unknown; accuracyMeters?: unknown };
  try {
    await updateDriverPresence(driverId, body.latitude, body.longitude, body.accuracyMeters);
    res.json({ ok: true });
  } catch (err) {
    fail(err, req, res, "Mise à jour de la position du livreur impossible");
  }
});

/** GET /api/driver-connexion/assignments/:deliveryJobId/transfer-candidates — collègues disponibles près du vendeur */
router.get("/driver-connexion/assignments/:deliveryJobId/transfer-candidates", async (req, res): Promise<void> => {
  const driverId = await authDriver(req, res);
  if (!driverId) return;
  const jobId = jobIdParam(req, res);
  if (!jobId) return;
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(await getTransferOverview(driverId, jobId));
  } catch (err) {
    fail(err, req, res, "Liste des collègues pour le transfert impossible");
  }
});

/** POST /api/driver-connexion/assignments/:deliveryJobId/transfer  { toDriverId } — « Transférer la commande » */
router.post("/driver-connexion/assignments/:deliveryJobId/transfer", async (req, res): Promise<void> => {
  const driverId = await authDriver(req, res);
  if (!driverId) return;
  const jobId = jobIdParam(req, res);
  if (!jobId) return;
  try {
    const result = await createTransferOffer({
      driverId,
      jobId,
      toDriverId: Number((req.body as { toDriverId?: unknown } | undefined)?.toDriverId),
    });
    res.status(201).json(result);
  } catch (err) {
    fail(err, req, res, "Transfert de course impossible");
  }
});

/** POST /api/driver-connexion/assignments/:deliveryJobId/transfer/cancel — « Reprendre la commande » */
router.post("/driver-connexion/assignments/:deliveryJobId/transfer/cancel", async (req, res): Promise<void> => {
  const driverId = await authDriver(req, res);
  if (!driverId) return;
  const jobId = jobIdParam(req, res);
  if (!jobId) return;
  try {
    res.json(await cancelTransferOffer(driverId, jobId));
  } catch (err) {
    fail(err, req, res, "Annulation du transfert impossible");
  }
});

/** POST /api/driver-connexion/assignments/:deliveryJobId/abandon — « Refuser la commande » après acceptation */
router.post("/driver-connexion/assignments/:deliveryJobId/abandon", async (req, res): Promise<void> => {
  const driverId = await authDriver(req, res);
  if (!driverId) return;
  const jobId = jobIdParam(req, res);
  if (!jobId) return;
  try {
    res.json({ success: true, ...(await abandonAcceptedAssignment(driverId, jobId)) });
  } catch (err) {
    fail(err, req, res, "Refus de la course impossible");
  }
});

/**
 * POST /api/delivery/assignments/respond — interception : seules les OFFRES DE TRANSFERT sont traitées ici
 * (le collègue accepte ou refuse). Toute autre assignation est laissée au routeur d'origine.
 */
router.post("/delivery/assignments/respond", async (req, res, next): Promise<void> => {
  try {
    const driverId = await resolveWorkflowDriverId(req.headers.authorization);
    const body = (req.body ?? {}) as { deliveryJobId?: unknown; action?: unknown };
    const jobId = Number(body.deliveryJobId);
    const action = body.action === "accept" || body.action === "refuse" ? body.action : null;
    if (!driverId || !Number.isInteger(jobId) || jobId <= 0 || !action || !(await isTransferOffer(jobId, driverId))) {
      next();
      return;
    }
    const result = await respondToTransferOffer({ driverId, jobId, action });
    res.json({ success: true, transfer: true, ...result });
  } catch (err) {
    fail(err, req, res, "Réponse à une offre de transfert impossible");
  }
});

/**
 * GET /api/delivery/conversations/:conversationId/driver-notice — pour l'acheteur ET le vendeur :
 * « Assigner nouveau livreur : livreur indisponible » ou « Nouveau livreur : X ».
 */
router.get("/delivery/conversations/:conversationId/driver-notice", async (req, res): Promise<void> => {
  const caller = await resolveConversationActor(req, Number(req.params.conversationId));
  if (!caller) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }
  try {
    const orderId = await findLatestOrderIdForConversation(caller.conversationId);
    res.setHeader("Cache-Control", "no-store");
    res.json({ notice: orderId ? await getDriverNotice(orderId) : null });
  } catch (err) {
    fail(err, req, res, "Avis de changement de livreur indisponible");
  }
});

export default router;
