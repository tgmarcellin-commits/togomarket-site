import { Router, type IRouter } from "express";
import { and, desc, eq, gt, lt } from "drizzle-orm";
import {
  deliveryAuditLogsTable,
  db,
  deliveryWorkflowJobsTable,
  driversTable,
  otpCodesTable,
  ordersTable,
  paymentWebhooksTable,
  whatsappNotificationsTable,
} from "@workspace/db";
import { normalizePhone } from "../lib/phone";
import { paymentWebhookEventHash, verifyFedapayDriverWebhookSignature } from "../lib/fedapay-driver-webhook";
import { sendWhatsAppText } from "../lib/whatsapp-api";
import { computeLockedDeliveryPricing } from "../lib/distance-pricing";

const router: IRouter = Router();
const ASSIGNMENT_TTL_MS = 15 * 60 * 1000;
const DRIVER_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const WEBHOOK_RATE_LIMIT = { limit: 120, windowMs: 60_000 };
const webhookRateEntries = new Map<string, { count: number; resetAt: number }>();

type AssignDriverInput = {
  orderId: number;
  driverId: number;
  pickupLatitude?: number;
  pickupLongitude?: number;
  dropoffLatitude?: number;
  dropoffLongitude?: number;
};

function asIntegerPositive(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

function asCoordinate(value: unknown, min: number, max: number): number | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

function parseAssignDriverBody(body: Record<string, unknown>): AssignDriverInput | null {
  const orderId = asIntegerPositive(body.orderId);
  const driverId = asIntegerPositive(body.driverId);
  const pickupLatitude = asCoordinate(body.pickupLatitude, -90, 90);
  const pickupLongitude = asCoordinate(body.pickupLongitude, -180, 180);
  const dropoffLatitude = asCoordinate(body.dropoffLatitude, -90, 90);
  const dropoffLongitude = asCoordinate(body.dropoffLongitude, -180, 180);
  if (!orderId || !driverId) return null;
  if (pickupLatitude === null || pickupLongitude === null || dropoffLatitude === null || dropoffLongitude === null) return null;
  return { orderId, driverId, pickupLatitude, pickupLongitude, dropoffLatitude, dropoffLongitude };
}

function randomCode(digits: number): string {
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits) - 1;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}

function allowWebhookRequest(ip: string): boolean {
  const now = Date.now();
  const current = webhookRateEntries.get(ip);
  const entry = !current || current.resetAt <= now
    ? { count: 1, resetAt: now + WEBHOOK_RATE_LIMIT.windowMs }
    : { count: current.count + 1, resetAt: current.resetAt };
  webhookRateEntries.set(ip, entry);
  if (webhookRateEntries.size > 20_000) {
    for (const [key, value] of webhookRateEntries) {
      if (value.resetAt <= now) webhookRateEntries.delete(key);
    }
  }
  return entry.count <= WEBHOOK_RATE_LIMIT.limit;
}

async function notifyDriverAssignment(
  driverPhone: string,
  orderId: number,
): Promise<"sent" | "failed" | "fallback_triggered"> {
  const templateName = process.env.WHATSAPP_UTILITY_TEMPLATE_NAME?.trim() || "driver_assignment_utility";
  const message = `[${templateName}] Nouvelle assignation TogoMarket pour commande #${orderId}. Connectez-vous à /driver-connexion pour accepter ou refuser.`;
  try {
    await sendWhatsAppText(driverPhone, message);
    return "sent";
  } catch {
    return "fallback_triggered";
  }
}

router.post("/delivery/assignments", async (req, res) => {
  const parsed = parseAssignDriverBody(req.body as Record<string, unknown>);
  if (!parsed) return res.status(400).json({ error: "Requête invalide." });

  const [driver] = await db
    .select()
    .from(driversTable)
    .where(eq(driversTable.id, parsed.driverId))
    .limit(1);
  if (!driver || !driver.isAvailable) {
    return res.status(400).json({ error: "Livreur indisponible." });
  }

  const activeCourse = await db
    .select({ id: deliveryWorkflowJobsTable.id })
    .from(deliveryWorkflowJobsTable)
    .where(and(eq(deliveryWorkflowJobsTable.driverId, driver.id), eq(deliveryWorkflowJobsTable.acceptanceStatus, "accepted_by_driver")))
    .limit(1);
  if (activeCourse.length > 0) {
    return res.status(400).json({ error: "Livreur déjà en course." });
  }

  const [existingJob] = await db
    .select()
    .from(deliveryWorkflowJobsTable)
    .where(eq(deliveryWorkflowJobsTable.orderId, parsed.orderId))
    .limit(1);

  if (existingJob && existingJob.acceptanceStatus === "accepted_by_driver") {
    return res.status(409).json({ error: "Commande déjà verrouillée par un livreur." });
  }

  const assignmentExpiresAt = new Date(Date.now() + ASSIGNMENT_TTL_MS);
  const [job] = existingJob
    ? await db
      .update(deliveryWorkflowJobsTable)
      .set({
        driverId: parsed.driverId,
        acceptanceStatus: "pending_driver_response",
        assignmentExpiresAt,
        cancelledAt: null,
        acceptedAt: null,
        refusedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(deliveryWorkflowJobsTable.id, existingJob.id))
      .returning()
    : await db
      .insert(deliveryWorkflowJobsTable)
      .values({
        orderId: parsed.orderId,
        driverId: parsed.driverId,
        acceptanceStatus: "pending_driver_response",
        assignmentExpiresAt,
      })
      .returning();

  if (
    parsed.pickupLatitude !== undefined &&
    parsed.pickupLongitude !== undefined &&
    parsed.dropoffLatitude !== undefined &&
    parsed.dropoffLongitude !== undefined
  ) {
    const pricing = await computeLockedDeliveryPricing({
      fromLat: parsed.pickupLatitude,
      fromLon: parsed.pickupLongitude,
      toLat: parsed.dropoffLatitude,
      toLon: parsed.dropoffLongitude,
      orderId: parsed.orderId,
    });
    await db
      .update(ordersTable)
      .set({
        distanceLockedKm: pricing.distanceLockedKm,
        transportFeeLocked: pricing.transportFeeLocked,
        distanceSource: pricing.distanceSource,
        status: "ASSIGNED",
      })
      .where(eq(ordersTable.id, parsed.orderId));
  } else {
    await db.update(ordersTable).set({ status: "ASSIGNED" }).where(eq(ordersTable.id, parsed.orderId));
  }

  const status = await notifyDriverAssignment(normalizePhone(driver.whatsappNumber || driver.phone), parsed.orderId);
  await db.insert(whatsappNotificationsTable).values({
    recipientPhone: normalizePhone(driver.whatsappNumber || driver.phone),
    messageContent: `Assignation commande #${parsed.orderId}`,
    deliveryStatus: status,
  });

  await db.update(deliveryWorkflowJobsTable)
    .set({
      whatsappNotifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(deliveryWorkflowJobsTable.id, job.id));

  return res.status(201).json({
    id: job.id,
    orderId: job.orderId,
    driverId: job.driverId,
    acceptanceStatus: job.acceptanceStatus,
    assignmentExpiresAt,
  });
});

router.post("/driver-connexion/request-otp", async (req, res) => {
  if (typeof req.body?.phone !== "string" || req.body.phone.trim().length < 8) {
    return res.status(400).json({ error: "Numéro invalide." });
  }
  const normalized = normalizePhone(req.body.phone);
  const [driver] = await db.select().from(driversTable).where(eq(driversTable.phone, normalized)).limit(1);
  if (!driver) return res.status(404).json({ error: "Livreur introuvable." });
  const otp = randomCode(6);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await db.update(otpCodesTable).set({ used: true }).where(and(eq(otpCodesTable.phone, normalized), eq(otpCodesTable.used, false)));
  await db.insert(otpCodesTable).values({ phone: normalized, code: otp, expiresAt });
  let sentStatus: "sent" | "fallback_triggered" = "sent";
  try {
    await sendWhatsAppText(normalized, `Votre code OTP livreur TogoMarket est ${otp}. Il expire dans 5 minutes.`);
  } catch {
    sentStatus = "fallback_triggered";
  }
  await db.insert(whatsappNotificationsTable).values({
    recipientPhone: normalized,
    messageContent: `Votre code OTP livreur TogoMarket est ${otp}.`,
    deliveryStatus: sentStatus,
  });
  return res.json({ sent: true });
});

router.post("/driver-connexion/verify-otp", async (req, res) => {
  if (
    typeof req.body?.phone !== "string" ||
    req.body.phone.trim().length < 8 ||
    typeof req.body?.otp !== "string" ||
    req.body.otp.trim().length !== 6
  ) {
    return res.status(400).json({ error: "Paramètres OTP invalides." });
  }
  const normalized = normalizePhone(req.body.phone);
  const [driver] = await db.select().from(driversTable).where(eq(driversTable.phone, normalized)).limit(1);
  if (!driver) {
    return res.status(401).json({ error: "OTP invalide." });
  }
  const now = new Date();
  const [otpRecord] = await db.select().from(otpCodesTable).where(and(
    eq(otpCodesTable.phone, normalized),
    eq(otpCodesTable.used, false),
    gt(otpCodesTable.expiresAt, now),
    lt(otpCodesTable.attempts, 3),
  )).orderBy(desc(otpCodesTable.createdAt)).limit(1);
  if (!otpRecord) {
    return res.status(400).json({ error: "Code expiré ou invalide." });
  }
  if (otpRecord.code !== req.body.otp) {
    await db.update(otpCodesTable).set({ attempts: otpRecord.attempts + 1 }).where(eq(otpCodesTable.id, otpRecord.id));
    return res.status(400).json({ error: "Code OTP incorrect." });
  }
  await db.update(otpCodesTable).set({ used: true }).where(eq(otpCodesTable.id, otpRecord.id));
  const sessionToken = Buffer.from(`${driver.id}:${req.body.otp}:${Date.now()}`).toString("base64url").slice(0, 48);
  await db.update(driversTable).set({
    otpSessionTokenHash: sessionToken,
    otpSessionExpiresAt: new Date(Date.now() + DRIVER_SESSION_TTL_MS),
    updatedAt: new Date(),
  }).where(eq(driversTable.id, driver.id));
  return res.json({ token: sessionToken, driverId: driver.id });
});

router.post("/delivery/assignments/respond", async (req, res) => {
  const deliveryJobId = asIntegerPositive(req.body?.deliveryJobId);
  const action = req.body?.action === "accept" || req.body?.action === "refuse" ? req.body.action : null;
  if (!deliveryJobId || !action) return res.status(400).json({ error: "Requête invalide." });
  const [job] = await db.select().from(deliveryWorkflowJobsTable).where(eq(deliveryWorkflowJobsTable.id, deliveryJobId)).limit(1);
  if (!job) return res.status(404).json({ error: "Assignation introuvable." });
  if (job.acceptanceStatus !== "pending_driver_response") {
    return res.status(409).json({ error: "Assignation déjà traitée." });
  }
  if (job.assignmentExpiresAt && job.assignmentExpiresAt.getTime() < Date.now()) {
    await db.update(deliveryWorkflowJobsTable).set({ acceptanceStatus: "expired", updatedAt: new Date() }).where(eq(deliveryWorkflowJobsTable.id, job.id));
    return res.status(409).json({ error: "Assignation expirée." });
  }
  if (action === "refuse") {
    await db.update(deliveryWorkflowJobsTable).set({
      acceptanceStatus: "refused_by_driver",
      refusedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(deliveryWorkflowJobsTable.id, job.id));
    return res.json({ status: "refused_by_driver" });
  }
  await db.update(deliveryWorkflowJobsTable).set({
    acceptanceStatus: "accepted_by_driver",
    acceptedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(deliveryWorkflowJobsTable.id, job.id));
  await db.update(ordersTable).set({ status: "IN_TRANSIT" }).where(eq(ordersTable.id, job.orderId));
  await db.insert(deliveryAuditLogsTable).values({
    actorType: "driver",
    actorId: String(job.driverId),
    orderId: job.orderId,
    action: "driver_acceptance_locked",
  });
  return res.json({ status: "accepted_by_driver", paymentPendingWebhookConfirmation: true });
});

router.post("/fedapay-driver-callback", async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (!allowWebhookRequest(ip)) {
    return res.status(429).json({ error: "Trop de requêtes webhook." });
  }
  const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
  const signature = typeof req.headers["x-fedapay-signature"] === "string" ? req.headers["x-fedapay-signature"] : undefined;
  if (!rawBody || !verifyFedapayDriverWebhookSignature(rawBody, signature)) {
    return res.status(400).json({ error: "Signature webhook invalide" });
  }
  const eventHash = paymentWebhookEventHash(rawBody);
  const [existing] = await db.select({ id: paymentWebhooksTable.id }).from(paymentWebhooksTable)
    .where(eq(paymentWebhooksTable.eventHash, eventHash))
    .limit(1);
  if (existing) return res.status(200).json({ received: true, duplicate: true });

  const payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
  const eventName = String(payload.name ?? payload.event ?? "unknown");
  await db.insert(paymentWebhooksTable).values({
    eventHash,
    eventName,
    payload,
    processed: true,
    processedAt: new Date(),
  });

  const tx = payload.data as Record<string, unknown> | undefined;
  const metadata = (tx?.object as Record<string, unknown> | undefined)?.custom_metadata as Record<string, unknown> | undefined;
  const orderId = Number(metadata?.orderId ?? 0);
  if (Number.isInteger(orderId) && orderId > 0 && eventName.includes("approved")) {
    await db.update(ordersTable).set({ status: "IN_TRANSIT" }).where(eq(ordersTable.id, orderId));
  }
  return res.status(200).json({ received: true });
});

router.get("/drivers/available", async (_req, res) => {
  const drivers = await db
    .select({
      id: driversTable.id,
      firstName: driversTable.firstName,
      lastName: driversTable.lastName,
      phone: driversTable.phone,
      photoUrl: driversTable.photoUrl,
      whatsappNumber: driversTable.whatsappNumber,
      isAvailable: driversTable.isAvailable,
    })
    .from(driversTable)
    .where(eq(driversTable.isAvailable, true));

  const activeDriverIds = await db.select({ driverId: deliveryWorkflowJobsTable.driverId })
    .from(deliveryWorkflowJobsTable)
    .where(eq(deliveryWorkflowJobsTable.acceptanceStatus, "accepted_by_driver"));
  const busyIds = new Set(activeDriverIds.map((row) => row.driverId));
  const filtered = drivers.filter((driver) => !busyIds.has(driver.id));
  return res.json(filtered);
});

router.post("/drivers/:driverId/availability", async (req, res) => {
  const driverId = Number(req.params.driverId);
  if (
    !Number.isInteger(driverId) ||
    driverId <= 0 ||
    typeof req.body?.isAvailable !== "boolean"
  ) {
    return res.status(400).json({ error: "Requête invalide." });
  }
  await db.update(driversTable).set({
    isAvailable: req.body.isAvailable,
    updatedAt: new Date(),
  }).where(eq(driversTable.id, driverId));
  return res.json({ success: true });
});

export default router;
