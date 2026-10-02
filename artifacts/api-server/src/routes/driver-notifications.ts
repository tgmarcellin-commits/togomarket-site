import { Router, type IRouter } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, driverNotificationsTable } from "@workspace/db";
import { resolveWorkflowDriverId } from "../lib/driver-workflow-auth";

const router: IRouter = Router();

/**
 * GET /api/driver-connexion/notifications
 * Notifications non lues du livreur connecté (les plus récentes d'abord).
 */
router.get("/driver-connexion/notifications", async (req, res): Promise<void> => {
  const driverId = await resolveWorkflowDriverId(req.headers.authorization);
  if (!driverId) {
    res.status(401).json({ error: "Session livreur invalide" });
    return;
  }
  const rows = await db
    .select({
      id: driverNotificationsTable.id,
      orderId: driverNotificationsTable.orderId,
      kind: driverNotificationsTable.kind,
      title: driverNotificationsTable.title,
      body: driverNotificationsTable.body,
      createdAt: driverNotificationsTable.createdAt,
    })
    .from(driverNotificationsTable)
    .where(and(eq(driverNotificationsTable.driverId, driverId), isNull(driverNotificationsTable.readAt)))
    .orderBy(desc(driverNotificationsTable.createdAt))
    .limit(20);
  res.json({ notifications: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) });
});

/**
 * POST /api/driver-connexion/notifications/:id/read
 * Marque une notification comme lue (uniquement si elle appartient au livreur connecté).
 */
router.post("/driver-connexion/notifications/:id/read", async (req, res): Promise<void> => {
  const driverId = await resolveWorkflowDriverId(req.headers.authorization);
  if (!driverId) {
    res.status(401).json({ error: "Session livreur invalide" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Notification invalide" });
    return;
  }
  await db
    .update(driverNotificationsTable)
    .set({ readAt: new Date() })
    .where(and(eq(driverNotificationsTable.id, id), eq(driverNotificationsTable.driverId, driverId)));
  res.json({ success: true });
});

export default router;
