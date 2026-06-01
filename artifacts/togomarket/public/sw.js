// Service worker minimal — permet l'installation PWA sans mettre en cache
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  // Supprime tous les anciens caches sans exception
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Aucune mise en cache — tout passe directement par le réseau
self.addEventListener("fetch", () => {});
