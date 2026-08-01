import webpush from "web-push";
import { logger } from "./logger";

const vapidPublicKey = process.env["VAPID_PUBLIC_KEY"] ?? "";
const vapidPrivateKey = process.env["VAPID_PRIVATE_KEY"] ?? "";
const vapidEmail = process.env["VAPID_EMAIL"] ?? "";

let _vapidReady = false;

if (vapidPublicKey && vapidPrivateKey && vapidEmail) {
  try {
    webpush.setVapidDetails(`mailto:${vapidEmail}`, vapidPublicKey, vapidPrivateKey);
    _vapidReady = true;
  } catch (err) {
    logger.warn({ err }, "VAPID configuration invalid — push notifications disabled");
  }
} else {
  logger.warn("VAPID env vars missing — push notifications disabled");
}

export { webpush, vapidPublicKey };
export const vapidReady = _vapidReady;
