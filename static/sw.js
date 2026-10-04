const CACHE_NAME = 'igitoro-clean-v5';
const STATIC_ASSETS = [
  '/static/css/app.css?v=3',
  '/static/css/app.css',
  '/static/css/share.css',
  '/static/js/search.js',
  '/static/js/reports.js',
  '/static/js/profile.js',
  '/static/js/share.js',
  '/static/manifest.json?v=3',
  '/static/manifest.json',
  '/static/icons/favicon-32.png?v=2',
  '/static/icons/icon-180.png?v=2',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/static/icons/icon-maskable-512.png',
  '/static/icons/icon.svg?v=2'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Purge intégrale de tous les anciens caches (notamment igitoro-fast-v3)
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Ne jamais intercepter les navigations de pages HTML pour garantir un affichage direct text/html
  if (event.request.mode === 'navigate') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Cache-First uniquement pour les fichiers statiques (CSS, JS, Icônes, Manifest)
  if (
    (url.pathname.startsWith('/static/') && !url.pathname.startsWith('/static/uploads/')) ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/favicon.ico' ||
    url.pathname.startsWith('/apple-touch-icon')
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        const networkPromise = fetch(event.request)
          .then((res) => {
            const ct = (res && res.headers && res.headers.get('content-type')) || '';
            if (res && res.ok && !ct.includes('octet-stream')) {
              cache.put(event.request, res.clone()).catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkPromise;
      })
    );
  }
});
