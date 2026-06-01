const CACHE_NAME = "togomarket-v2";

// Ne met en cache que les ressources statiques avec hash Vite (JS/CSS)
// Les pages HTML sont toujours chargées depuis le réseau
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Ne jamais mettre en cache les appels API
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Les navigations HTML (pages) → toujours réseau en premier
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Ressources avec hash Vite (ex: assets/index-abc123.js) → cache first
  if (url.pathname.includes("/assets/")) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((res) => {
            cache.put(event.request, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  // Tout le reste → réseau, sans cache
  event.respondWith(fetch(event.request));
});
