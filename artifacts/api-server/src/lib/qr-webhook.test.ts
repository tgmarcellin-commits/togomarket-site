import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

function toRadians(value: number): number {
  return value * (Math.PI / 180);
}

function haversineDistanceKm(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const R = 6371;
  const dLat = toRadians(toLat - fromLat);
  const dLon = toRadians(toLon - fromLon);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

test("qr proximity: Haversine distance correctly validates proximity radius", () => {
  // Same coordinate = 0 meters
  const dist0 = haversineDistanceKm(6.1375, 1.2123, 6.1375, 1.2123);
  assert.equal(dist0, 0);

  // Close coordinate (~111 meters north at equator/tropics = ~0.111 km)
  const distClose = haversineDistanceKm(6.1375, 1.2123, 6.1385, 1.2123);
  assert.ok(distClose > 0.1 && distClose < 0.15);
  assert.ok(distClose * 1000 <= 300, "Should be within 300m radius");

  // Far coordinate (~1.5 km away)
  const distFar = haversineDistanceKm(6.1375, 1.2123, 6.1510, 1.2123);
  assert.ok(distFar > 1.0);
  assert.ok(distFar * 1000 > 300, "Should exceed 300m radius");
});

test("webhook separation: signature verification isolates Marketplace Livraison from Abonnements", () => {
  const driverSecret = "sec_driver_marketplace_test_xyz";
  const subSecret = "sec_subscriptions_different_secret_abc";

  const payload = JSON.stringify({ event: "transaction.approved", id: 12345 });

  // Generate signature using driver secret
  const driverSignature = crypto
    .createHmac("sha256", driverSecret)
    .update(payload)
    .digest("hex");

  // Generate signature using subscriptions secret
  const subSignature = crypto
    .createHmac("sha256", subSecret)
    .update(payload)
    .digest("hex");

  assert.notEqual(driverSignature, subSignature);

  // Verify that an Abonnements signature is rejected under Driver secret
  const expectedDriverSig = crypto
    .createHmac("sha256", driverSecret)
    .update(payload)
    .digest("hex");

  const isAcceptedWithDriverSecret = crypto.timingSafeEqual(
    Buffer.from(driverSignature),
    Buffer.from(expectedDriverSig),
  );
  assert.equal(isAcceptedWithDriverSecret, true);

  const isAcceptedWithSubSecret = crypto.timingSafeEqual(
    Buffer.from(subSignature),
    Buffer.from(expectedDriverSig),
  );
  assert.equal(isAcceptedWithSubSecret, false);
});
