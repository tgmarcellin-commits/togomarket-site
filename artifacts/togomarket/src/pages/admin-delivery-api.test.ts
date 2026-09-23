import assert from "node:assert/strict";
import test from "node:test";
import {
  loadAdminAvailableDrivers,
  loadAdminDeliveryOrders,
} from "./admin-delivery-api";

test("loadAdminDeliveryOrders uses admin header and returns parsed orders", async () => {
  let request: { input?: string; headers?: HeadersInit } = {};
  const orders = [{ id: 1, status: "PENDING" }];

  const result = await loadAdminDeliveryOrders("secret-code", async (input, init) => {
    request = { input: String(input), headers: init?.headers };
    return {
      ok: true,
      json: async () => ({ orders }),
    } as Response;
  });

  assert.equal(request.input, "/api/admin/delivery/orders");
  assert.deepEqual(request.headers, { "x-admin-code": "secret-code" });
  assert.deepEqual(result, orders);
});

test("loadAdminDeliveryOrders surfaces a clear error on failure", async () => {
  await assert.rejects(
    () => loadAdminDeliveryOrders("secret-code", async () => ({ ok: false } as Response)),
    /Impossible de charger les commandes livraison\./,
  );
});

test("loadAdminAvailableDrivers uses admin header and returns parsed drivers", async () => {
  let request: { input?: string; headers?: HeadersInit } = {};
  const drivers = [{ id: 7, firstName: "Afi" }];

  const result = await loadAdminAvailableDrivers("secret-code", async (input, init) => {
    request = { input: String(input), headers: init?.headers };
    return {
      ok: true,
      json: async () => drivers,
    } as Response;
  });

  assert.equal(request.input, "/api/drivers/available");
  assert.deepEqual(request.headers, { "x-admin-code": "secret-code" });
  assert.deepEqual(result, drivers);
});

test("loadAdminAvailableDrivers surfaces a clear error on failure", async () => {
  await assert.rejects(
    () => loadAdminAvailableDrivers("secret-code", async () => ({ ok: false } as Response)),
    /Impossible de charger les livreurs disponibles\./,
  );
});
