import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";
process.env.WHATSAPP_TEMPLATE_OTP = "test_driver_otp";
process.env.WHATSAPP_UTILITY_TEMPLATE_NAME = "test_driver_assignment";

const { sendWhatsAppOTP, sendWhatsAppUtilityTemplate, WhatsAppMetaError } = await import("./whatsapp-api");
const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

test("sends driver OTP with the configured authentication template", async () => {
  let requestBody: Record<string, any> | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, any>;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  await sendWhatsAppOTP("+228 90 12 34 56", "123456", "Kossi");

  assert.equal(requestBody?.type, "template");
  assert.equal(requestBody?.to, "22890123456");
  assert.equal(requestBody?.template.name, "test_driver_otp");
  assert.equal(requestBody?.template.language.code, "fr");
  assert.deepEqual(requestBody?.template.components[0].parameters, [
    { type: "text", text: "123456" },
  ]);
  assert.equal(requestBody?.template.components[1].type, "button");
});

test("sends driver assignment with the configured utility template", async () => {
  let requestBody: Record<string, any> | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, any>;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  await sendWhatsAppUtilityTemplate("22890123456", "test_driver_assignment", ["35"]);

  assert.equal(requestBody?.type, "template");
  assert.equal(requestBody?.template.name, "test_driver_assignment");
  assert.equal(requestBody?.template.language.code, "fr");
  assert.deepEqual(requestBody?.template.components[0].parameters, [
    { type: "text", text: "35" },
  ]);
});

test("preserves Meta error status and response body without falling back", async () => {
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return new Response('{"error":{"message":"Template rejected"}}', { status: 400 });
  }) as typeof fetch;

  await assert.rejects(
    sendWhatsAppOTP("22890123456", "123456", "Kossi"),
    (err: unknown) => {
      assert.ok(err instanceof WhatsAppMetaError);
      assert.equal(err.status, 400);
      assert.match(err.responseBody, /Template rejected/);
      return true;
    },
  );
  assert.equal(requestCount, 1);
});
