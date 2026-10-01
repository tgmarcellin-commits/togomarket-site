import assert from "node:assert/strict";
import test from "node:test";
import { requestDriverDeliveryQr, scanDeliveryQr } from "./delivery-api";

test("driver QR request uses the authenticated on-demand endpoint and explicit stage", async () => {
  let request: { url?: string; init?: RequestInit } = {};
  await requestDriverDeliveryQr(
    18,
    "return",
    "driver-session",
    { latitude: 6.1, longitude: 1.2 },
    async (url, init) => {
      request = { url: String(url), init };
      return {
        ok: true,
        json: async () => ({
          rawToken: "qr-token",
          stage: "return",
          orderId: 2,
          deliveryJobId: 18,
          expiresAt: "2026-10-01T00:03:00.000Z",
          expiresInSeconds: 180,
        }),
      } as Response;
    },
  );
  assert.equal(request.url, "/api/delivery/jobs/18/qr/request");
  assert.equal(request.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(request.init?.body)), {
    stage: "return",
    latitude: 6.1,
    longitude: 1.2,
  });
  assert.equal(new Headers(request.init?.headers).get("authorization"), ["Bearer", "driver-session"].join(" "));
});

test("delivery QR scan sends buyer role and current geolocation to the scan API", async () => {
  let request: { url?: string; init?: RequestInit } = {};
  await scanDeliveryQr(
    "qr-token",
    "buyer",
    { latitude: 6.12, longitude: 1.23 },
    async (url, init) => {
      request = { url: String(url), init };
      return {
        ok: true,
        json: async () => ({
          success: true,
          stage: "delivery",
          orderId: 2,
          proximityDistanceMeters: 40,
          settlement: {},
        }),
      } as Response;
    },
    { "x-buyer-token": "buyer-session", "x-conversation-id": "2" },
  );
  assert.equal(request.url, "/api/delivery/qr/scan");
  assert.equal(request.init?.method, "POST");
  assert.deepEqual(request.init?.headers, {
    "x-buyer-token": "buyer-session",
    "x-conversation-id": "2",
    "Content-Type": "application/json",
  });
  assert.deepEqual(
    ((JSON.parse(String(request.init?.body)) as Record<string, unknown>)),
    {
      rawToken: "qr-token",
      scannerRole: "buyer",
      scannerLatitude: 6.12,
      scannerLongitude: 1.23,
      idempotencyKey: (JSON.parse(String(request.init?.body)) as { idempotencyKey: string }).idempotencyKey,
    },
  );
});

test("QR scanner role remains seller for a return scan and backend errors are surfaced", async () => {
  let payload: Record<string, unknown> | null = null;
  await scanDeliveryQr("return-token", "seller", { latitude: 6, longitude: 1 }, async (_url, init) => {
    payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return {
      ok: true,
      json: async () => ({
        success: true,
        stage: "return",
        orderId: 2,
        proximityDistanceMeters: 10,
        settlement: {},
      }),
    } as Response;
  }, { "x-vendor-phone": "+22890000000", "x-vendor-password": "seller-session" });
  assert.equal(payload?.scannerRole, "seller");

  await assert.rejects(
    scanDeliveryQr("expired", "buyer", { latitude: 6, longitude: 1 }, async () => ({
      ok: false,
      json: async () => ({ error: "QR code expiré." }),
    } as Response)),
    /QR code expiré/,
  );
});
