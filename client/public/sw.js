// SYNCRO PWA Service Worker
// Handles caching for offline support.

/* global self, caches */

// Bumped from syncro-v1 so the activate handler purges caches that held
// subscription data from the torn-down v2 dashboard (#1498).
const CACHE_NAME = 'syncro-v2';
const CACHED_ROUTES = ['/', '/dashboard', '/offline', '/login'];

// Install event - cache essential routes
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHED_ROUTES))
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
      .catch(() => caches.match('/offline'))
  );
});
