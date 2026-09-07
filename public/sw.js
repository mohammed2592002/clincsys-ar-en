const CACHE_NAME = 'crowndent-cache-v3';
const OFFLINE_URL = '/';

// List of critical static assets to cache immediately on install
const ASSETS_TO_PRECACHE = [
  '/',
  '/index.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching critical assets');
      return cache.addAll(ASSETS_TO_PRECACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Helper to determine if a request is for Firestore/Firebase auth/analytics APIs
function isFirebaseOrApi(url) {
  return (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    url.hostname.includes('analytics.coredentsys.cloud') ||
    url.pathname.startsWith('/__/auth/') ||
    url.pathname.startsWith('/api/sync/') ||
    url.hostname.includes('ws') || // Dev server HMR
    url.hostname.includes('chrome-extension')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Skip caching entirely in development or for Vite-specific files and dependencies
  if (
    url.pathname.includes('/@vite/') ||
    url.pathname.includes('/@id/') ||
    url.pathname.includes('/@react-refresh') ||
    url.pathname.includes('/src/') ||
    url.pathname.includes('/node_modules/') ||
    url.search.includes('import') ||
    url.search.includes('v=') ||
    url.pathname.endsWith('.ts') ||
    url.pathname.endsWith('.tsx')
  ) {
    return;
  }

  // Skip Firebase auth, Firestore, realtime DB, web sockets, development HMR, extensions, etc.
  if (isFirebaseOrApi(url)) {
    return;
  }

  // 1. Navigation requests (HTML pages) -> Network First, Fallback to Cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone).catch(err => {
                console.log('[Service Worker] Cache put failed (non-critical):', err);
              });
            });
          }
          return response;
        })
        .catch(() => {
          // Offline, serve index.html
          return caches.match(OFFLINE_URL).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            // Fallback if index.html is somehow not matched
            return caches.match(request);
          });
        })
    );
    return;
  }

  // 2. Static Assets (JS, CSS, Fonts, Images, Icons, JSON) -> Stale-While-Revalidate
  // This delivers lightning-fast subsecond loads from cache while updating in the background.
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone).catch(err => {
                console.log('[Service Worker] Cache put failed (non-critical):', err);
              });
            });
          }
          return networkResponse;
        })
        .catch((err) => {
          // Return the cached response if network fails
          if (cachedResponse) return cachedResponse;
          return new Response('Network error - asset unavailable offline', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' }
          });
        });

      // Serve instantly from cache if available, otherwise wait for network
      return cachedResponse || fetchPromise;
    })
  );
});
