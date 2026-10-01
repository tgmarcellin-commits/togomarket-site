import assert from "node:assert/strict";
import test from "node:test";
import {
  loadAdminDrivers,
  loadAdminAvailableDrivers,
  loadAdminDeliveryOrders,
  saveAdminDriver,
  deleteAdminDriver,
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

test("loadAdminDeliveryOrders falls back to an empty list when payload shape is unexpected", async () => {
  assert.deepEqual(
    await loadAdminDeliveryOrders("secret-code", async () => ({
      ok: true,
      json: async () => ({ orders: "invalid" }),
    } as Response)),
    [],
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

test("loadAdminAvailableDrivers falls back to an empty list when payload shape is unexpected", async () => {
  assert.deepEqual(
    await loadAdminAvailableDrivers("secret-code", async () => ({
      ok: true,
      json: async () => ({ drivers: "invalid" }),
    } as Response)),
    [],
  );
});

test("admin driver listing uses the superadmin endpoint and admin code header", async () => {
  let request: { url?: string; headers?: HeadersInit } = {};
  const drivers = [{ id: 1, firstName: "Afi", idDocumentNumber: "private" }];
  const result = await loadAdminDrivers("super-secret", async (url, init) => {
    request = { url: String(url), headers: init?.headers };
    return { ok: true, json: async () => ({ drivers }) } as Response;
  });
  assert.equal(request.url, "/api/admin/drivers");
  assert.deepEqual(request.headers, { "x-admin-code": "super-secret" });
  assert.deepEqual(result, drivers);
});

test("admin driver create and edit use distinct protected methods", async () => {
  const requests: Array<{ url: string; method: string; body: string }> = [];
  const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(url), method: String(init?.method), body: String(init?.body) });
    return { ok: true, json: async () => ({ driver: { id: 5, firstName: "Afi" } }) } as Response;
  };
  await saveAdminDriver("super-secret", { firstName: "Afi", lastName: "Doe", phone: "+22890000000" }, undefined, fetchImpl);
  await saveAdminDriver("super-secret", { isAvailable: false }, 5, fetchImpl);
  assert.deepEqual(requests.map(({ url, method }) => [url, method]), [
    ["/api/admin/drivers", "POST"],
    ["/api/admin/drivers/5", "PATCH"],
  ]);
});

test("deleteAdminDriver calls the DELETE endpoint with admin header", async () => {
  let request: { url?: string; method?: string; headers?: HeadersInit } = {};
  await deleteAdminDriver("super-secret", 5, async (url, init) => {
    request = { url: String(url), method: String(init?.method), headers: init?.headers };
    return { ok: true, json: async () => ({ success: true }) } as Response;
  });
  assert.equal(request.url, "/api/admin/drivers/5");
  assert.equal(request.method, "DELETE");
  assert.deepEqual(request.headers, { "Content-Type": "application/json", "x-admin-code": "super-secret" });
});

test("deleteAdminDriver surfaces a clear error on failure", async () => {
  await assert.rejects(
    () =>
      deleteAdminDriver("super-secret", 5, async () => ({
        ok: false,
        json: async () => ({ error: "Impossible de supprimer ce livreur : mission active." }),
      } as Response)),
    /mission active\./,
  );
});
