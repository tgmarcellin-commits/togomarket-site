import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, driverPushSubscriptionsTable } from "@workspace/db";
import { resolveWorkflowDriverId } from "../lib/driver-workflow-auth";
import { isValidPushEndpoint } from "../lib/push-endpoint";

const router: IRouter = Router();

/**
 * POST /api/driver-connexion/push/status      Body: { endpoint }
 * Confirme que l'abonnement de CET appareil appartient bien au livreur connecté.
 */
router.post("/driver-connexion/push/status", async (req, res): Promise<void> => {
  const driverId = await resolveWorkflowDriverId(req.headers.authorization);
  if (!driverId) {
    res.status(401).json({ error: "Session livreur invalide" });
    return;
  }
  const endpoint = (req.body as { endpoint?: string } | undefined)?.endpoint;
  if (!endpoint || !isValidPushEndpoint(endpoint)) {
    res.status(400).json({ error: "endpoint invalide" });
    return;
  }
  const [subscription] = await db
    .select({ id: driverPushSubscriptionsTable.id })
    .from(driverPushSubscriptionsTable)
    .where(and(
      eq(driverPushSubscriptionsTable.endpoint, endpoint),
      eq(driverPushSubscriptionsTable.driverId, driverId),
    ))
    .limit(1);
  res.json({ active: Boolean(subscription) });
});

/**
 * POST /api/driver-connexion/push/subscribe   Body: { endpoint, keys: { auth, p256dh } }
 * Enregistre l'abonnement. Un appareil (endpoint) n'appartient qu'à un seul livreur :
 * si un autre livreur s'est connecté avant sur le même téléphone, il est remplacé.
 */
router.post("/driver-connexion/push/subscribe", async (req, res): Promise<void> => {
  const driverId = await resolveWorkflowDriverId(req.headers.authorization);
  if (!driverId) {
    res.status(401).json({ error: "Session livreur invalide" });
    return;
  }
  const { endpoint, keys } = (req.body ?? {}) as {
    endpoint?: string;
    keys?: { auth?: string; p256dh?: string };
  };
  if (!endpoint || !keys?.auth || !keys?.p256dh) {
    res.status(400).json({ error: "endpoint et keys requis" });
    return;
  }
  if (!isValidPushEndpoint(endpoint)) {
    res.status(400).json({ error: "endpoint non autorisé" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(driverPushSubscriptionsTable)
      .where(eq(driverPushSubscriptionsTable.endpoint, endpoint));
    await tx.insert(driverPushSubscriptionsTable).values({
      driverId,
      endpoint,
      keys: { auth: keys.auth, p256dh: keys.p256dh },
    });
  });
  res.json({ ok: true });
});

/**
 * POST /api/driver-connexion/push/unsubscribe   Body: { endpoint }
 */
router.post("/driver-connexion/push/unsubscribe", async (req, res): Promise<void> => {
  const driverId = await resolveWorkflowDriverId(req.headers.authorization);
  if (!driverId) {
    res.status(401).json({ error: "Session livreur invalide" });
    return;
  }
  const endpoint = (req.body as { endpoint?: string } | undefined)?.endpoint;
  if (!endpoint || !isValidPushEndpoint(endpoint)) {
    res.status(400).json({ error: "endpoint invalide" });
    return;
  }
  await db
    .delete(driverPushSubscriptionsTable)
    .where(and(
      eq(driverPushSubscriptionsTable.endpoint, endpoint),
      eq(driverPushSubscriptionsTable.driverId, driverId),
    ));
  res.json({ ok: true });
});

export default router;
