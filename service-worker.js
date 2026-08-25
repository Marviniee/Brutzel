// ============================================================================
// service-worker.js
//
// Voraussetzung dafür, dass iPad/iPhone/Mac die Seite als "richtige" App
// installierbar machen ("Zum Home-Bildschirm/Dock hinzufügen"), und cached
// den App-Shell für den Offline-Start.
//
// CACHE_NAME hochzählen (z.B. "v2"), wenn App-Shell-Dateien geändert wurden
// und installierte Nutzer die neue Version bekommen sollen.
// ============================================================================

const CACHE_NAME = "brutzel-v1";

const APP_SHELL_DATEIEN = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_DATEIEN))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((namen) =>
      Promise.all(
        namen
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Bei jeder Anfrage: erst im Cache nachschauen, sonst aus dem Netz laden.
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((treffer) => treffer || fetch(event.request))
  );
});
