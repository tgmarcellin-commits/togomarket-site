import assert from "node:assert/strict";
import test from "node:test";
import {
  canRequestDeliveryQr,
  canWithdrawWallet,
  createSingleFlightGuard,
  getQrRemainingSeconds,
  type GpsWatchApi,
  getDeliveryRoutePhase,
  isLocationStale,
  shouldTrackDelivery,
  startAutomaticGpsTracking,
  toDriverSafeAssignment,
  toPublicDeliveryDriver,
} from "./delivery-ui";

test("driver mission view model excludes item price and buyer totals", () => {
  const mission = toDriverSafeAssignment({
    id: 4,
    orderId: 9,
    acceptanceStatus: "accepted_by_driver",
    order: {
      id: 9,
      firstName: "Ama",
      lastName: "Doe",
      phone: "+22890000000",
      description: "Rice — 750 000 FCFA",
      articlePriceLocked: 750_000,
      amountPaidByBuyer: 760_000,
      transportFeeLocked: 4_000,
      roundTripFeeLocked: 8_000,
      status: "IN_TRANSIT",
    },
  });

  assert.equal(mission.order?.transportFeeLocked, 4_000);
  assert.equal("articlePriceLocked" in (mission.order ?? {}), false);
  assert.equal("amountPaidByBuyer" in (mission.order ?? {}), false);
  assert.equal("description" in (mission.order ?? {}), false);
});

test("public driver model strips contact and identity-document fields", () => {
  const driver = toPublicDeliveryDriver({
    id: 2,
    firstName: "Afi",
    lastName: "Mensah",
    photoUrl: "/photo.jpg",
    workZone: "Lomé",
    isAvailable: true,
    ratingAverage: 4.5,
    ratingCount: 12,
    phone: "+22890000000",
    whatsappNumber: "+22890000000",
    idDocumentNumber: "ID-SECRET",
    idDocumentPhotoUrl: "/private.jpg",
  });

  assert.equal(driver.workZone, "Lomé");
  assert.equal("phone" in driver, false);
  assert.equal("whatsappNumber" in driver, false);
  assert.equal("idDocumentNumber" in driver, false);
  assert.equal("idDocumentPhotoUrl" in driver, false);
});

test("route phase and location freshness use backend statuses and timestamps", () => {
  assert.equal(getDeliveryRoutePhase("accepted_by_driver", "ASSIGNED"), "to-seller");
  assert.equal(getDeliveryRoutePhase("accepted_by_driver", "IN_TRANSIT"), "to-buyer");
  assert.equal(getDeliveryRoutePhase("accepted_by_driver", "RETURNING_TO_SELLER"), "returning");
  assert.equal(getDeliveryRoutePhase("accepted_by_driver", "DELIVERED"), "delivered");
  assert.equal(isLocationStale("2026-10-01T00:00:00Z", Date.parse("2026-10-01T00:02:00Z")), true);
  assert.equal(isLocationStale("2026-10-01T00:01:30Z", Date.parse("2026-10-01T00:02:00Z")), false);
  assert.equal(getQrRemainingSeconds("2026-10-01T00:03:00Z", Date.parse("2026-10-01T00:00:00Z")), 180);
  assert.equal(getQrRemainingSeconds("2026-10-01T00:00:00Z", Date.parse("2026-10-01T00:00:01Z")), 0);
});

test("GPS tracking throttles updates and clears its watcher", () => {
  let onPosition: ((position: Parameters<GpsWatchApi["watchPosition"]>[0]) => void) | null = null;
  let clearedId = -1;
  let currentTime = 5_000;
  const sent: number[] = [];
  const stop = startAutomaticGpsTracking(
    {
      watchPosition(success) {
        onPosition = success;
        return 17;
      },
      clearWatch(id) {
        clearedId = id;
      },
    },
    (position) => sent.push(position.timestamp),
    () => {},
    () => currentTime,
  );
  const position = (timestamp: number) => ({
    coords: { latitude: 6, longitude: 1, accuracy: 12, speed: null, heading: null },
    timestamp,
  });

  onPosition?.(position(1));
  currentTime += 1_000;
  onPosition?.(position(2));
  currentTime += 1_000;
  onPosition?.(position(3));
  stop();
  currentTime += 2_000;
  onPosition?.(position(4));

  assert.deepEqual(sent, [1, 3]);
  assert.equal(clearedId, 17);
});

test("terminal delivery statuses stop automatic GPS and QR stage gates are explicit", () => {
  assert.equal(shouldTrackDelivery("accepted_by_driver", "IN_TRANSIT"), true);
  assert.equal(shouldTrackDelivery("accepted_by_driver", "RETURNING_TO_SELLER"), true);
  assert.equal(shouldTrackDelivery("accepted_by_driver", "RETURN_AT_SELLER"), true);
  assert.equal(shouldTrackDelivery("accepted_by_driver", "DELIVERED"), false);
  assert.equal(shouldTrackDelivery("pending_driver_response", "ASSIGNED"), false);
  assert.equal(canRequestDeliveryQr("delivery", "IN_TRANSIT"), true);
  assert.equal(canRequestDeliveryQr("return", "RETURNING_TO_SELLER"), true);
  assert.equal(canRequestDeliveryQr("return", "IN_TRANSIT"), false);
  assert.equal(canRequestDeliveryQr("delivery", "DELIVERED"), false);
});

test("withdrawal requires explicit server readiness", () => {
  assert.equal(canWithdrawWallet({ withdrawalReadiness: { canWithdraw: false } }), false);
  assert.equal(canWithdrawWallet({ withdrawalAvailability: { canWithdraw: true } }), true);
  assert.equal(canWithdrawWallet({}), false);
});

test("single-flight guard prevents duplicate withdrawal submissions", async () => {
  const guard = createSingleFlightGuard();
  let requestCount = 0;
  let complete: (() => void) | undefined;
  const request = () => guard.run(() => {
    requestCount += 1;
    return new Promise<void>((resolve) => { complete = resolve; });
  });
  const first = request();
  const duplicate = await request();
  assert.equal(guard.isPending(), true);
  assert.equal(duplicate, undefined);
  assert.equal(requestCount, 1);
  complete?.();
  await first;
  assert.equal(guard.isPending(), false);
});
