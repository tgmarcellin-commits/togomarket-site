import { Router, type IRouter } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, driverSessionsTable } from "@workspace/db";
import { hashOpaqueToken } from "../lib/marketplace-security";
import { parseBearerToken } from "../lib/driver-session";
import { cancelUnpaidAcceptedAssignmentForDriver } from "../lib/delivery-assignment-expiry";

const router: IRouter = Router();

/**
 * POST /api/delivery/assignments/cancel-unpaid
 * Body: { deliveryJobId: number }
 * Le livreur annule une mission acceptée mais non payée, après 10 minutes d'attente.
 */
router.post("/delivery/assignments/cancel-unpaid", async (req, res): Promise<void> => {
  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: "Session livreur invalide" });
    return;
  }

  const [session] = await db
    .select({ driverId: driverSessionsTable.driverId })
    .from(driverSessionsTable)
    .where(and(
      eq(driverSessionsTable.tokenHash, hashOpaqueToken(token)),
      gt(driverSessionsTable.expiresAt, new Date()),
    ))
    .limit(1);
  if (!session) {
    res.status(401).json({ error: "Session livreur invalide" });
    return;
  }

  const deliveryJobId = Number(req.body?.deliveryJobId);
  if (!Number.isInteger(deliveryJobId) || deliveryJobId <= 0) {
    res.status(400).json({ error: "Mission invalide" });
    return;
  }

  const result = await cancelUnpaidAcceptedAssignmentForDriver(deliveryJobId, session.driverId);
  if (result === "not_found") {
    res.status(404).json({ error: "Mission introuvable ou déjà terminée" });
    return;
  }
  if (result === "already_paid") {
    res.status(409).json({ error: "Le paiement est déjà confirmé : annulation impossible" });
    return;
  }
  if (result === "too_early") {
    res.status(409).json({ error: "L'annulation est possible après 10 minutes d'attente" });
    return;
  }
  res.json({ success: true });
});

export default router;
