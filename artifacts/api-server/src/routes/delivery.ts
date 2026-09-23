import { Router, type IRouter } from "express";
import { and, desc, eq, gt, inArray, isNotNull, lt, or } from "drizzle-orm";
import {
  deliveryAuditLogsTable,
  db,
  deliveryWorkflowJobsTable,
  driverSessionsTable,
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
import { verifyAdminCode } from "../lib/admin-auth";
import { createDriverSessionToken, isDriverSessionTokenMatch, parseBearerToken } from "../lib/driver-session";
import { hashOpaqueToken } from "../lib/marketplace-security";

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

async function authenticateDriverSession(authorization: string | undefined) {
  const token = parseBearerToken(authorization);
  if (!token) return null;
  const now = new Date();
  const tokenHash = hashOpaqueToken(token);
  const [row] = await db
    .select({
      sessionTokenHash: driverSessionsTable.tokenHash,
      driver: driversTable,
    })
    .from(driverSessionsTable)
    .innerJoin(driversTable, eq(driverSessionsTable.driverId, driversTable.id))
    .where(and(eq(driverSessionsTable.tokenHash, tokenHash), gt(driverSessionsTable.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  if (!isDriverSessionTokenMatch(token, row.sessionTokenHash)) return null;
  return row.driver;
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
  const adminCode = String(req.headers["x-admin-code"] ?? "").trim();
  if (!adminCode || !await verifyAdminCode(adminCode)) {
    return res.status(403).json({ error: "Accès administrateur requis." });
  }
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
    .orderBy(desc(deliveryWorkflowJobsTable.updatedAt), desc(deliveryWorkflowJobsTable.createdAt))
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

router.get("/admin/delivery/orders", async (req, res) => {
  const adminCode = String(req.headers["x-admin-code"] ?? "").trim();
  if (!adminCode || !await verifyAdminCode(adminCode)) {
    return res.status(403).json({ error: "Accès administrateur requis." });
  }

  const orders = await db
    .select({
      id: ordersTable.id,
      firstName: ordersTable.firstName,
      lastName: ordersTable.lastName,
      phone: ordersTable.phone,
      description: ordersTable.description,
      articlePriceLocked: ordersTable.articlePriceLocked,
      distanceLockedKm: ordersTable.distanceLockedKm,
      transportFeeLocked: ordersTable.transportFeeLocked,
      distanceSource: ordersTable.distanceSource,
      status: ordersTable.status,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .where(and(
      inArray(ordersTable.status, ["PENDING", "ASSIGNED", "IN_TRANSIT"]),
      or(
        isNotNull(ordersTable.distanceLockedKm),
        isNotNull(ordersTable.transportFeeLocked),
        eq(ordersTable.buyerConsented, true),
        eq(ordersTable.sellerConsented, true),
      ),
    ))
    .orderBy(desc(ordersTable.createdAt))
    .limit(100);

  if (orders.length === 0) {
    return res.json({ orders: [] });
  }

  const orderIds = orders.map((order) => order.id);
  const jobs = await db
    .select()
    .from(deliveryWorkflowJobsTable)
    .where(inArray(deliveryWorkflowJobsTable.orderId, orderIds))
    .orderBy(desc(deliveryWorkflowJobsTable.updatedAt), desc(deliveryWorkflowJobsTable.createdAt));

  const driverIds = [...new Set(jobs.map((job) => job.driverId))];
  const drivers = driverIds.length > 0
    ? await db
      .select({
        id: driversTable.id,
        firstName: driversTable.firstName,
        lastName: driversTable.lastName,
        phone: driversTable.phone,
        isAvailable: driversTable.isAvailable,
      })
      .from(driversTable)
      .where(inArray(driversTable.id, driverIds))
    : [];

  const jobByOrderId = new Map<number, typeof jobs[number]>();
  for (const job of jobs) {
    if (!jobByOrderId.has(job.orderId)) {
      jobByOrderId.set(job.orderId, job);
    }
  }
  const driverById = new Map(drivers.map((driver) => [driver.id, driver]));

  return res.json({
    orders: orders.map((order) => {
      const job = jobByOrderId.get(order.id) ?? null;
      const driver = job ? driverById.get(job.driverId) ?? null : null;
      return {
        ...order,
        createdAt: order.createdAt.toISOString(),
        assignment: !job ? null : {
          id: job.id,
          driverId: job.driverId,
          acceptanceStatus: job.acceptanceStatus,
          assignmentExpiresAt: job.assignmentExpiresAt?.toISOString() ?? null,
          acceptedAt: job.acceptedAt?.toISOString() ?? null,
          refusedAt: job.refusedAt?.toISOString() ?? null,
          driver,
        },
      };
    }),
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
  const deliveryPhone = normalizePhone(driver.whatsappNumber || driver.phone);
  let sentStatus: "sent" | "fallback_triggered" = "sent";
  try {
    await sendWhatsAppText(deliveryPhone, `Votre code OTP livreur TogoMarket est ${otp}. Il expire dans 5 minutes.`);
  } catch {
    sentStatus = "fallback_triggered";
  }
  await db.insert(whatsappNotificationsTable).values({
    recipientPhone: deliveryPhone,
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
  const session = createDriverSessionToken(DRIVER_SESSION_TTL_MS);
  await db.delete(driverSessionsTable).where(eq(driverSessionsTable.driverId, driver.id));
  await db.insert(driverSessionsTable).values({
    driverId: driver.id,
    tokenHash: session.tokenHash,
    expiresAt: session.expiresAt,
  });
  return res.json({
    token: session.rawToken,
    driverId: driver.id,
    driver: {
      id: driver.id,
      firstName: driver.firstName,
      lastName: driver.lastName,
      phone: driver.phone,
      isAvailable: driver.isAvailable,
    },
  });
});

router.post("/driver-connexion/logout", async (req, res) => {
  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: "Session livreur invalide." });
  }
  const tokenHash = hashOpaqueToken(token);
  await db.delete(driverSessionsTable).where(eq(driverSessionsTable.tokenHash, tokenHash));
  return res.json({ success: true });
});

router.get("/driver-connexion/session", async (req, res) => {
  const driver = await authenticateDriverSession(req.headers.authorization);
  if (!driver) {
    return res.status(401).json({ error: "Session livreur invalide." });
  }
  return res.json({
    driver: {
      id: driver.id,
      firstName: driver.firstName,
      lastName: driver.lastName,
      phone: driver.phone,
      isAvailable: driver.isAvailable,
    },
  });
});

router.get("/driver-connexion/assignments", async (req, res) => {
  const driver = await authenticateDriverSession(req.headers.authorization);
  if (!driver) {
    return res.status(401).json({ error: "Session livreur invalide." });
  }

  const jobs = await db
    .select()
    .from(deliveryWorkflowJobsTable)
    .where(eq(deliveryWorkflowJobsTable.driverId, driver.id))
    .orderBy(desc(deliveryWorkflowJobsTable.createdAt))
    .limit(20);

  if (jobs.length === 0) {
    return res.json({ assignments: [] });
  }

  const orders = await db
    .select({
      id: ordersTable.id,
      firstName: ordersTable.firstName,
      lastName: ordersTable.lastName,
      phone: ordersTable.phone,
      description: ordersTable.description,
      articlePriceLocked: ordersTable.articlePriceLocked,
      distanceLockedKm: ordersTable.distanceLockedKm,
      transportFeeLocked: ordersTable.transportFeeLocked,
      status: ordersTable.status,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .where(inArray(ordersTable.id, jobs.map((job) => job.orderId)));

  const orderById = new Map(orders.map((order) => [order.id, order]));

  return res.json({
    assignments: jobs.map((job) => ({
      id: job.id,
      orderId: job.orderId,
      acceptanceStatus: job.acceptanceStatus,
      assignmentExpiresAt: job.assignmentExpiresAt?.toISOString() ?? null,
      acceptedAt: job.acceptedAt?.toISOString() ?? null,
      refusedAt: job.refusedAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      order: (() => {
        const order = orderById.get(job.orderId);
        if (!order) return null;
        return {
          ...order,
          createdAt: order.createdAt.toISOString(),
        };
      })(),
    })),
  });
});

router.post("/driver-connexion/availability", async (req, res) => {
  const driver = await authenticateDriverSession(req.headers.authorization);
  if (!driver) {
    return res.status(401).json({ error: "Session livreur invalide." });
  }
  if (typeof req.body?.isAvailable !== "boolean") {
    return res.status(400).json({ error: "Requête invalide." });
  }
  await db.update(driversTable).set({
    isAvailable: req.body.isAvailable,
    updatedAt: new Date(),
  }).where(eq(driversTable.id, driver.id));
  return res.json({ success: true, driverId: driver.id, isAvailable: req.body.isAvailable });
});

router.post("/delivery/assignments/respond", async (req, res) => {
  const driver = await authenticateDriverSession(req.headers.authorization);
  if (!driver) {
    return res.status(401).json({ error: "Session livreur invalide." });
  }
  const deliveryJobId = asIntegerPositive(req.body?.deliveryJobId);
  const action = req.body?.action === "accept" || req.body?.action === "refuse" ? req.body.action : null;
  if (!deliveryJobId || !action) return res.status(400).json({ error: "Requête invalide." });
  const [job] = await db.select().from(deliveryWorkflowJobsTable).where(eq(deliveryWorkflowJobsTable.id, deliveryJobId)).limit(1);
  if (!job) return res.status(404).json({ error: "Assignation introuvable." });
  if (job.driverId !== driver.id) {
    return res.status(403).json({ error: "Cette assignation n'appartient pas à ce livreur." });
  }
  if (job.assignmentExpiresAt && job.assignmentExpiresAt.getTime() < Date.now()) {
    await db.update(deliveryWorkflowJobsTable).set({ acceptanceStatus: "expired", updatedAt: new Date() }).where(eq(deliveryWorkflowJobsTable.id, job.id));
    return res.status(409).json({ error: "Assignation expirée." });
  }
  if (job.acceptanceStatus !== "pending_driver_response") {
    return res.status(409).json({ error: "Assignation déjà traitée." });
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
  const adminCode = String(_req.headers["x-admin-code"] ?? "").trim();
  if (!adminCode || !await verifyAdminCode(adminCode)) {
    return res.status(403).json({ error: "Accès administrateur requis." });
  }
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
  const adminCode = String(req.headers["x-admin-code"] ?? req.body?.code ?? req.body?.password ?? "").trim();
  if (!adminCode || !await verifyAdminCode(adminCode)) {
    return res.status(403).json({ error: "Accès administrateur requis." });
  }
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
