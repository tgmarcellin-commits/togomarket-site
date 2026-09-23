import { Router, type IRouter } from "express";
import { db, ordersTable, auditLogsTable } from "@workspace/db";
import { CreateOrderBody } from "@workspace/api-zod";
import { computeLockedDeliveryPricing } from "../lib/distance-pricing";

const router: IRouter = Router();

function validCoordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

router.post("/orders", async (req, res): Promise<void> => {
  const forbiddenClientPricingFields = ["distanceLockedKm", "transportFeeLocked", "distanceActualKm", "distanceSource"];
  const forbiddenFields = forbiddenClientPricingFields.filter((field) => Object.prototype.hasOwnProperty.call(req.body, field));
  if (forbiddenFields.length > 0) {
    await db.insert(auditLogsTable).values({
      actorType: "buyer",
      action: "order_payload_rejected_locked_fields",
      metadata: { forbiddenFields },
    });
    res.status(400).json({ error: "Les champs de distance/tarif sont calculés uniquement côté serveur." });
    return;
  }

  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid order body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const articlePriceLockedRaw = req.body.articlePriceLocked;
  if (
    articlePriceLockedRaw !== undefined &&
    (!Number.isInteger(articlePriceLockedRaw) || articlePriceLockedRaw < 0)
  ) {
    res.status(400).json({ error: "articlePriceLocked doit être un entier FCFA >= 0." });
    return;
  }
  const articlePriceLocked = articlePriceLockedRaw === undefined ? 0 : Number(articlePriceLockedRaw);
  const pickupLatitude = req.body.pickupLatitude;
  const pickupLongitude = req.body.pickupLongitude;
  const dropoffLatitude = req.body.dropoffLatitude;
  const dropoffLongitude = req.body.dropoffLongitude;

  const hasAllCoordinates =
    pickupLatitude !== undefined &&
    pickupLongitude !== undefined &&
    dropoffLatitude !== undefined &&
    dropoffLongitude !== undefined;
  if (
    hasAllCoordinates &&
    (!validCoordinate(pickupLatitude, -90, 90) ||
      !validCoordinate(pickupLongitude, -180, 180) ||
      !validCoordinate(dropoffLatitude, -90, 90) ||
      !validCoordinate(dropoffLongitude, -180, 180))
  ) {
    res.status(400).json({ error: "Coordonnées GPS invalides." });
    return;
  }

  const pricing = hasAllCoordinates
    ? await computeLockedDeliveryPricing({
      fromLat: pickupLatitude,
      fromLon: pickupLongitude,
      toLat: dropoffLatitude,
      toLon: dropoffLongitude,
    })
    : null;

  const [order] = await db
    .insert(ordersTable)
    .values({
      lastName: parsed.data.lastName,
      firstName: parsed.data.firstName,
      phone: parsed.data.phone,
      description: parsed.data.description,
      articlePriceLocked,
      distanceLockedKm: pricing?.distanceLockedKm,
      transportFeeLocked: pricing?.transportFeeLocked,
      distanceSource: pricing?.distanceSource,
    })
    .returning();

  req.log.info({ id: order.id }, "Order created");

  res.status(201).json({
    id: order.id,
    lastName: order.lastName,
    firstName: order.firstName,
    phone: order.phone,
    description: order.description,
    articlePriceLocked: order.articlePriceLocked,
    distanceLockedKm: order.distanceLockedKm,
    transportFeeLocked: order.transportFeeLocked,
    distanceSource: order.distanceSource,
    createdAt: order.createdAt.toISOString(),
  });
});

export default router;
