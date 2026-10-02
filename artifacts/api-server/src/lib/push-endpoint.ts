/**
 * Hôtes autorisés pour les endpoints Web Push (services push des navigateurs majeurs).
 * Même règle que routes/push.ts : toute autre URL est rejetée (prévention SSRF).
 */
const ALLOWED_PUSH_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "notify.windows.com",
  "push.apple.com",
  "push.samsungosp.com",
  "push.opera.com",
];

export function isValidPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return false;
    const host = url.hostname;
    if (/^[\d.]+$/.test(host)) return false;
    if (host.startsWith("[") || host === "localhost") return false;
    return ALLOWED_PUSH_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}
