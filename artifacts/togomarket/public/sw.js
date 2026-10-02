// TogoMarket Service Worker — Web Push + offline shell

self.addEventListener("push", (event) => {
  let data = { title: "TogoMarket", body: "Nouveau message reçu", conversationId: null };
  try {
    data = { ...data, ...event.data.json() };
  } catch {}

  const options = {
    body: data.body,
    icon: "/logo.jpg",
    badge: "/logo.jpg",
    tag: data.tag ?? `conv-${data.conversationId ?? "general"}`,
    renotify: true,
    data: { conversationId: data.conversationId, url: data.url ?? null },
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const convId = event.notification.data?.conversationId;
  // Notifications livreur : ouvre l'espace livreur (seul chemin /driver-connexion accepté)
  const targetPath = event.notification.data?.url;
  if (typeof targetPath === "string" && targetPath.startsWith("/driver-connexion")) {
    const driverUrl = self.location.origin + targetPath;
    event.waitUntil(
      clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
        const existing = list.find((c) => c.url.startsWith(self.location.origin + "/driver-connexion"));
        if (existing) return existing.focus();
        return clients.openWindow(driverUrl);
      })
    );
    return;
  }
  const url = self.location.origin + (convId ? `/?tab=messages&conv=${convId}` : "/");
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.startsWith(self.location.origin));
      if (existing) {
        existing.focus();
        existing.postMessage({ type: "open_conversation", conversationId: convId });
        return;
      }
      clients.openWindow(url);
    })
  );
});
