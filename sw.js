// Service worker: caches the app shell so the interface loads instantly and
// keeps working offline. Business data is NOT cached here - it lives in
// IndexedDB (js/db.js) and is replicated by js/sync.js. API requests always
// go straight to the network.

const VERSION = 'tukent-v4';

const SHELL = [
  '/',
  '/index.html',
  '/sign-in.html',
  '/create-account.html',
  '/recover.html',
  '/dashboard.html',
  '/shop.html',
  '/transport.html',
  '/restaurant.html',
  '/employees.html',
  '/security.html',
  '/activity.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
  '/js/db.js',
  '/js/api.js',
  '/js/auth.js',
  '/js/sync.js',
  '/js/ui.js',
  '/js/landing.js',
  '/js/auth-pages.js',
  '/js/dashboard.js',
  '/js/shop.js',
  '/js/transport.js',
  '/js/restaurant.js',
  '/js/employees.js',
  '/js/security.js',
  '/js/activity.js',
  '/js/recover.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API traffic is never cached; the app handles offline via IndexedDB.
  if (url.pathname.startsWith('/api/')) return;

  // Pages: network first, fall back to the cached copy when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match('/index.html')))
    );
    return;
  }

  // Static assets: serve from cache, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
