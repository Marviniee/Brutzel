// ============================================================================
// service-worker.js
//
// Voraussetzung dafür, dass iPad/iPhone/Mac die Seite als "richtige" App
// installierbar machen ("Zum Home-Bildschirm/Dock hinzufügen"), und cached
// den App-Shell für den Offline-Start.
//
// PFLICHT-REGEL, keine Ausnahme: bei JEDER Änderung an index.html,
// style.css, app.js oder manifest.json MUSS CACHE_NAME hier hochgezählt
// werden (z.B. "brutzel-v2" -> "brutzel-v3"). Diese Datei selbst ändert
// sich sonst nicht, der Browser erkennt also gar kein Update und liefert
// installierten Nutzern dauerhaft die alte gecachte Version aus — auch
// wenn GitHub Pages längst den neuen Stand ausliefert. Im selben Zug
// APP_BUILD in app.js mit hochzählen.
// ============================================================================

const CACHE_NAME = "brutzel-v3";

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
