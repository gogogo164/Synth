/*
 * sw.js — Service Worker: legt die App vollständig in den Cache, damit sie
 * nach der Installation ohne Netz startet.
 *
 * Strategie: für die eigenen Dateien "cache first, danach im Hintergrund
 * auffrischen" — der Start bleibt sofort, neue Fassungen kommen beim
 * übernächsten Aufruf an. Beim Wechsel der Version wird alles Alte verworfen.
 */

const VERSION = 'model-d-v1';

// Alles relativ zum Geltungsbereich, damit die App auch in einem
// Unterverzeichnis liegen darf (z. B. bei GitHub Pages).
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/synth.css',
  'js/main.js',
  'js/engine.js',
  'js/presets.js',
  'js/ui/controls.js',
  'js/ui/keyboard.js',
  'js/worklets/voice-processor.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Einzeln laden: eine fehlende Datei soll nicht die ganze Installation kippen
    await Promise.all(SHELL.map(async (path) => {
      try {
        const url = new URL(path, self.registration.scope).href;
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok) await cache.put(url, response);
      } catch { /* beim nächsten Aufruf erneut versuchen */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(request, { ignoreSearch: true });

    const network = fetch(request).then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(network);   // im Hintergrund auffrischen
      return cached;
    }

    const response = await network;
    if (response) return response;

    // Ohne Netz und ohne Treffer: bei Seitenaufrufen die Startseite liefern
    if (request.mode === 'navigate') {
      const fallback = await cache.match(new URL('index.html', self.registration.scope).href);
      if (fallback) return fallback;
    }
    return new Response('Offline und nicht im Zwischenspeicher.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  })());
});
