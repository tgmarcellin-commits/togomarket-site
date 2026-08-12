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
    tag: `conv-${data.conversationId ?? "general"}`,
    renotify: true,
    data: { conversationId: data.conversationId },
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const convId = event.notification.data?.conversationId;
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
