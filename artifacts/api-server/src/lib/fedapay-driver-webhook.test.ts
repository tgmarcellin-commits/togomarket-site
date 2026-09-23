import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { paymentWebhookEventHash, verifyFedapayDriverWebhookSignature } from "./fedapay-driver-webhook";

test("verifyFedapayDriverWebhookSignature validates signed payload", () => {
  process.env.FEDAPAY_DRIVER_WEBHOOK_SECRET = "driver-secret";
  const payload = Buffer.from(JSON.stringify({ hello: "world" }));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", process.env.FEDAPAY_DRIVER_WEBHOOK_SECRET!)
    .update(`${timestamp}.${payload.toString("utf8")}`, "utf8")
    .digest("hex");
  const header = `t=${timestamp},s=${signature}`;
  assert.equal(verifyFedapayDriverWebhookSignature(payload, header), true);
});

test("verifyFedapayDriverWebhookSignature rejects tampered payload", () => {
  process.env.FEDAPAY_DRIVER_WEBHOOK_SECRET = "driver-secret";
  const payload = Buffer.from(JSON.stringify({ hello: "world" }));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", process.env.FEDAPAY_DRIVER_WEBHOOK_SECRET!)
    .update(`${timestamp}.${Buffer.from(JSON.stringify({ hello: "tampered" })).toString("utf8")}`, "utf8")
    .digest("hex");
  const header = `t=${timestamp},s=${signature}`;
  assert.equal(verifyFedapayDriverWebhookSignature(payload, header), false);
});

test("paymentWebhookEventHash is deterministic", () => {
  const payload = Buffer.from("abc");
  assert.equal(paymentWebhookEventHash(payload), paymentWebhookEventHash(Buffer.from("abc")));
});
