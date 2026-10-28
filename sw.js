/* HabitFlow: service worker
   ⚠️ Cada vez que publiques cambios, sube el número de VERSION
   (1.0.1 → 1.0.2 → 1.0.3...). Así el iPhone sabe que hay una versión nueva. */
const VERSION = 'habitflow-v1.1.0';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './sync.js',
  './config.js',
  './vendor/supabase.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      // cache: 'reload' obliga a descargar los archivos nuevos y no copias viejas guardadas por el navegador
      .then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Responde al instante desde la caché (funciona sin internet)
// y actualiza en segundo plano para la próxima vez que abras la app.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // cache: 'no-cache' pregunta siempre al servidor si hay una versión más nueva
  const network = fetch(req.url, { cache: 'no-cache' })
    .then(async res => {
      if (res && res.ok) {
        const copy = res.clone();
        const cache = await caches.open(VERSION);
        await cache.put(req, copy);
      }
      return res;
    })
    .catch(() => null);
  event.waitUntil(network);

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const res = await network;
    if (res) return res;
    if (req.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    return Response.error();
  })());
});

/* ---------- Listo para la Fase 2: notificaciones push ---------- */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'HabitFlow', {
      body: data.body || 'Tu rutina te espera 🔥',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { url: data.url || './' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of windows) {
      if ('focus' in w) return w.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
