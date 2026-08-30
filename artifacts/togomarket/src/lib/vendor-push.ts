import { vendorAuthHeaders } from "@/lib/vendor-auth";

interface VendorPushIdentity {
  phone: string;
  password: string;
}

interface PushPayload {
  endpoint: string;
  keys: {
    auth: string;
    p256dh: string;
  };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function pushPayload(subscription: PushSubscription): PushPayload {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.auth || !json.keys.p256dh) {
    throw new Error("push-subscription-incomplete");
  }
  return {
    endpoint: json.endpoint,
    keys: {
      auth: json.keys.auth,
      p256dh: json.keys.p256dh,
    },
  };
}

async function serverConfirmsSubscription(
  subscription: PushSubscription,
  identity: VendorPushIdentity,
): Promise<boolean> {
  const response = await fetch("/api/push/status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...vendorAuthHeaders(identity.phone, identity.password),
    },
    credentials: "include",
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  if (!response.ok) return false;
  const result = await response.json() as { active?: boolean };
  return result.active === true;
}

async function saveSubscription(
  subscription: PushSubscription,
  identity: VendorPushIdentity,
): Promise<void> {
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...vendorAuthHeaders(identity.phone, identity.password),
    },
    credentials: "include",
    body: JSON.stringify(pushPayload(subscription)),
  });
  if (!response.ok) throw new Error("subscribe-save-failed");
}

async function createSubscription(registration: ServiceWorkerRegistration): Promise<PushSubscription> {
  const keyResponse = await fetch("/api/push/vapid-public-key");
  if (!keyResponse.ok) throw new Error("vapid-key-fetch-failed");
  const { key } = await keyResponse.json() as { key?: string };
  if (!key) throw new Error("vapid-key-empty");

  const keyBytes = urlBase64ToUint8Array(key);
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes.buffer as ArrayBuffer,
  });
}

export function supportsVendorPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/**
 * Confirme côté serveur que l'abonnement local appartient au vendeur.
 * Si le serveur ne le connaît plus, recrée l'abonnement puis le réinscrit.
 */
export async function confirmOrRepairVendorPush(
  identity: VendorPushIdentity,
): Promise<boolean> {
  if (!supportsVendorPush() || Notification.permission !== "granted") return false;

  await navigator.serviceWorker.register("/sw.js");
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;

  if (await serverConfirmsSubscription(subscription, identity)) return true;

  await subscription.unsubscribe();
  subscription = await createSubscription(registration);
  await saveSubscription(subscription, identity);
  return true;
}

export async function activateVendorPush(identity: VendorPushIdentity): Promise<void> {
  if (!supportsVendorPush()) throw new Error("push-not-supported");

  await navigator.serviceWorker.register("/sw.js");
  const registration = await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(`push-permission-${permission}`);

  let subscription = await registration.pushManager.getSubscription();
  if (subscription && await serverConfirmsSubscription(subscription, identity)) return;
  if (subscription) await subscription.unsubscribe();

  subscription = await createSubscription(registration);
  await saveSubscription(subscription, identity);
}