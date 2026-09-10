/* Liber service worker — cache-first app shell for offline-first use. */
const CACHE_NAME = "liber-shell-v7";

const SHELL_FILES = [
  "index.html",
  "manifest.json",
  "css/style.css",
  "js/db.js",
  "js/reader-epub.js",
  "js/reader-pdf.js",
  "js/app.js",
  "icons/icon.svg",
  "lib/jszip.min.js",
  "lib/epub.min.js",
  "lib/pdf.min.js",
  "lib/pdf.worker.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Cache what exists; don't fail install if one file is briefly missing.
      Promise.all(
        SHELL_FILES.map((url) => cache.add(url).catch(() => {}))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => cached);
    })
  );
});
