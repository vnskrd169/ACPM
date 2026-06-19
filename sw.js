const CACHE_NAME = 'acpm-v2'; // Bumped to v2 for updated deployment
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './utils.js',
  './main.js',
  './labor.js',
  './materials.js',
  './billing.js',
  './changeorders.js',
  './sitelog.js',
  './suppliers.js',
  './manifest.json'
  // CDN assets (Firebase, jsPDF, html2canvas) are not cached — let browser handle
];

// Install: Cache app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(ASSETS))
      .catch(err => {
        console.error('Cache install failed:', err);
        // Non-critical: app still works via network
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
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('gstatic.com')) {
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
          // If nothing cached, return offline indicator
          return new Response('Offline \u2014 no cached data available. Please connect to the internet.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
          });
        });
      })
  );
});
