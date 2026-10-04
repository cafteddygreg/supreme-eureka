const CACHE_NAME = 'igitoro-fast-v3';
const STATIC_ASSETS = [
  '/',
  '/signaler',
  '/partager',
  '/notifications',
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
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch (_) {}
      }
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // 1. Assets statiques (CSS, JS, Icônes, Manifest) -> Cache-First + mise à jour en arrière-plan (< 5ms au démarrage)
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
            if (res && res.ok) {
              cache.put(event.request, res.clone()).catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkPromise;
      })
    );
    return;
  }

  // 2. Pages principales à l'ouverture depuis l'écran d'accueil -> Réseau rapide (850ms max) sinon affichage instantané du cache + rafraîchissement en arrière-plan
  const isFastShellRoute =
    event.request.mode === 'navigate' &&
    (url.pathname === '/' ||
      url.pathname === '/signaler' ||
      url.pathname === '/partager' ||
      url.pathname === '/share' ||
      url.pathname === '/notifications');

  if (isFastShellRoute) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedPage = await cache.match(url.pathname);

        const fetchAndUpdate = (async () => {
          const preloadRes = await event.preloadResponse;
          if (preloadRes && preloadRes.ok) {
            cache.put(url.pathname, preloadRes.clone()).catch(() => {});
            return preloadRes;
          }
          const netRes = await fetch(event.request);
          if (netRes && netRes.ok) {
            cache.put(url.pathname, netRes.clone()).catch(() => {});
          }
          return netRes;
        })();

        if (!cachedPage) {
          return fetchAndUpdate;
        }

        // Course entre le réseau (max 850ms) et le cache local instantané pour éviter tout écran blanc au lancement
        const timeoutPromise = new Promise((resolve) =>
          setTimeout(() => resolve(cachedPage), 850)
        );

        return Promise.race([fetchAndUpdate.catch(() => cachedPage), timeoutPromise]);
      })()
    );
  }
});
