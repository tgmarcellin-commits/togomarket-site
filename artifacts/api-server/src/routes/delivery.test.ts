import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";
process.env.WHATSAPP_UTILITY_TEMPLATE_NAME = "test_driver_assignment";
process.env.TOGOMARKET_DATABASE_URL ??= "postgresql://localhost:5432/test";

const { notifyDriverAssignment } = await import("./delivery");
const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

test("driver assignment notification sends only the driver first name as {{1}}", async () => {
  let requestBody: Record<string, any> | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, any>;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const result = await notifyDriverAssignment("22890123456", "Marcelle", "test route");

  assert.equal(result.status, "sent");
  assert.equal(requestBody?.template.name, "test_driver_assignment");
  assert.deepEqual(requestBody?.template.components[0].parameters, [
    { type: "text", text: "Marcelle" },
  ]);
});

test("driver assignment notification falls back to a generic label when first name is missing", async () => {
  let requestBody: Record<string, any> | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, any>;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  await notifyDriverAssignment("22890123456", "  ", "test route");

  assert.deepEqual(requestBody?.template.components[0].parameters, [
    { type: "text", text: "Livreur" },
  ]);
});
