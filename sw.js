const CACHE_NAME = 'acpm-v1'; // Bump version when you deploy updates
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './main.js',
  './labor.js',
  './materials.js',
  './billing.js',
  './changeorders.js',
  './sitelog.js',
  './suppliers.js'
  // Removed Firebase CDN — let browser handle these, or use local copies
];

// Install: Cache app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(ASSETS))
      .catch(err => {
        console.error('Cache install failed:', err);
        // Don't fail install if some assets can't cache
      })
  );
  self.skipWaiting();
});

// Activate: Clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: Network-first for app, cache fallback
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  
  // Skip Firebase API calls (Realtime DB uses WebSockets)
  const url = new URL(e.request.url);
  if (url.hostname.includes('firebaseio.com') || 
      url.hostname.includes('googleapis.com')) {
    return; // Let Firebase handle these natively
  }

  e.respondWith(
    fetch(e.request)
      .then(network => {
        // Update cache with fresh response
        if (network.ok) {
          const clone = network.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return network;
      })
      .catch(() => {
        // Fallback to cache
        return caches.match(e.request).then(cached => {
          if (cached) return cached;
          // If nothing cached, return offline page (optional)
          return new Response('Offline — no cached data available', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
          });
        });
      })
  );
});