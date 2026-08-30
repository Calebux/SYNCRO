// SYNCRO PWA Service Worker
// Handles caching for offline support and push notifications for reminders
// Enhanced for offline-first subscription dashboard with mutation sync

/* global self, clients, caches, indexedDB */

const CACHE_NAME = 'syncro-v1';
const CACHED_ROUTES = ['/', '/dashboard', '/offline', '/login'];

const REMINDER_MESSAGE_TYPE = 'SYNCRO_REMINDER';
const SYNC_CHANNEL = new BroadcastChannel('syncro-sync');

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
  const url = new URL(event.request.url);
  
  // Handle API requests for subscriptions with cache-first strategy when offline
  if (url.pathname.startsWith('/api/subscriptions')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache successful responses
          if (response.ok) {
            const clone = response.clone();
            clone.json().then(data => {
              if (data?.subscriptions) {
                storeSubscriptionsInCache(data.subscriptions);
              }
            }).catch(() => {});
          }
          return response;
        })
        .catch(() => {
          // When offline, try to return cached data
          return caches.match(event.request).then(cached => {
            if (cached) return cached;
            // Return empty subscriptions array as fallback
            return new Response(JSON.stringify({ subscriptions: [] }), {
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
    );
    return;
  }
  
  // Regular cache-first strategy for other requests
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
      .catch(() => caches.match('/offline'))
  );
});

// Background sync for pending mutations
self.addEventListener('sync', (event) => {
  if (event.tag === 'syncro-subscription-sync') {
    event.waitUntil(processPendingMutations());
  }
});

// Handle subscription data storage in IndexedDB
async function storeSubscriptionsInCache(subscriptions) {
  const db = await openIndexedDB();
  const tx = db.transaction('subscriptions', 'readwrite');
  const store = tx.objectStore('subscriptions');
  
  // Clear existing and store new
  await store.clear();
  for (const sub of subscriptions) {
    await store.put({ ...sub, updated_at: new Date().toISOString() });
  }
}

// Open IndexedDB connection
function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('syncro-offline', 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Process pending mutations from IndexedDB
async function processPendingMutations() {
  const db = await openIndexedDB();
  const tx = db.transaction('pending-mutations', 'readwrite');
  const store = tx.objectStore('pending-mutations');
  
  const allMutations = await store.getAll();
  
  for (const mutation of allMutations) {
    try {
      const response = await fetch('/api/sync/offline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mutation),
      });
      
      if (response.ok) {
        await store.delete(mutation.id);
      } else {
        mutation.attempts = (mutation.attempts || 0) + 1;
        if (mutation.attempts >= 3) {
          await store.delete(mutation.id);
        } else {
          await store.put(mutation);
        }
      }
    } catch {
      mutation.attempts = (mutation.attempts || 0) + 1;
      if (mutation.attempts >= 3) {
        await store.delete(mutation.id);
      } else {
        await store.put(mutation);
      }
    }
  }
}

// Message handling for sync requests from clients
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SYNCRO_TRIGGER_SYNC') {
    processPendingMutations().then(() => {
      event.source?.postMessage({ type: 'SYNCRO_SYNC_COMPLETE' });
    });
  }
});

// Push event - handle renewal reminders
self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  let payload;
  try {
    payload = event.data.json();
  } catch (error) {
    console.error('[SYNCRO] Invalid push payload', error);
    return;
  }

  const notificationData = payload && payload.data ? payload.data : {};
  const {
    subscriptionId,
    renewalDate,
    reminderType,
    url,
  } = notificationData;

  // Only forward renewal reminders
  if (!subscriptionId || !renewalDate || reminderType !== 'renewal') {
    return;
  }

  const title = payload.title || 'Subscription Renewal Reminder';
  const options = {
    body: payload.body || 'You have an upcoming subscription renewal.',
    icon: payload.icon || '/icon.svg',
    badge: payload.badge || '/icon.svg',
    data: {
      url: url || '/dashboard',
    },
    requireInteraction: payload.requireInteraction === true,
  };

  event.waitUntil(
    (async () => {
      // Show a standard browser notification
      await self.registration.showNotification(title, options);
    })()
  );
});

// Notification click event - open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

// Handle offline mutations endpoint registration
self.addEventListener('message', (event) => {
  if (event.data?.type === 'REGISTER_SYNC_ENDPOINT') {
    // Acknowledge registration
    event.source?.postMessage({ type: 'SYNC_ENDPOINT_REGISTERED' });
  }
});