/**
 * Abonnement Web Push du livreur (espace /driver-connexion).
 * Le jeton de session livreur est envoyé en `Authorization: Bearer`.
 */

export type DriverPushState =
  | "checking"
  | "unsupported"
  | "denied"
  | "needs-activation"
  | "active";

type PushPayload = { endpoint: string; keys: { auth: string; p256dh: string } };

export function supportsDriverPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function toPayload(subscription: PushSubscription): PushPayload {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.auth || !json.keys.p256dh) {
    throw new Error("push-subscription-incomplete");
  }
  return { endpoint: json.endpoint, keys: { auth: json.keys.auth, p256dh: json.keys.p256dh } };
}

function headers(token: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: "Bearer " + token };
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js");
  return await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("service-worker-timeout")), 8_000)),
  ]);
}

async function serverConfirms(subscription: PushSubscription, token: string): Promise<boolean> {
  const response = await fetch("/api/driver-connexion/push/status", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  if (!response.ok) return false;
  const result = await response.json() as { active?: boolean };
  return result.active === true;
}

async function save(subscription: PushSubscription, token: string): Promise<void> {
  const response = await fetch("/api/driver-connexion/push/subscribe", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(toPayload(subscription)),
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

/**
 * Vérifie l'état du push À CHAQUE connexion du livreur.
 * - autorisé + abonnement connu du serveur -> "active" (plus aucun rappel)
 * - autorisé mais abonnement perdu / inconnu du serveur -> réparé automatiquement, sans rien demander
 * - jamais demandé -> "needs-activation" (rappel affiché avec le bouton)
 */
export async function checkDriverPush(token: string): Promise<DriverPushState> {
  if (!supportsDriverPush()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "needs-activation";

  try {
    const registration = await getRegistration();
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      if (await serverConfirms(subscription, token)) return "active";
      try {
        await save(subscription, token); // le navigateur a l'abonnement, le serveur non : on le réenregistre
        return "active";
      } catch {
        await subscription.unsubscribe();
        subscription = null;
      }
    }
    subscription = await createSubscription(registration);
    await save(subscription, token);
    return "active";
  } catch {
    return "needs-activation";
  }
}

/**
 * À appeler directement depuis le clic sur le bouton « Activer les notifications » :
 * la permission est demandée en premier, avant tout autre traitement asynchrone.
 */
export async function activateDriverPush(token: string): Promise<DriverPushState> {
  if (!supportsDriverPush()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "needs-activation";

  const registration = await getRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && await serverConfirms(subscription, token)) return "active";
  if (subscription) await subscription.unsubscribe();
  subscription = await createSubscription(registration);
  await save(subscription, token);
  return "active";
}

export async function deactivateDriverPush(token: string): Promise<void> {
  if (!supportsDriverPush()) return;
  const registration = await getRegistration();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await fetch("/api/driver-connexion/push/unsubscribe", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);
  await subscription.unsubscribe();
}
