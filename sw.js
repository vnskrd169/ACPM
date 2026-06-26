// ════════════════════════════════════════════════════════════
//  ACPM Service Worker
//  Self-clearing: purges ALL old caches on activate and forces
//  the new version to take over immediately (clients.claim).
//  This guarantees users get fresh code after ONE page refresh,
//  without needing to manually unregister the SW.
// ════════════════════════════════════════════════════════════

// Bump this EVERY time you deploy changed files.
const CACHE_NAME = 'acpm-v31';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './utils.js',
  './auth.js',
  './main.js',
  './labor.js',
  './materials.js',
  './billing.js',
  './changeorders.js',
  './sitelog.js',
  './suppliers.js',
  './equipment.js',
  './compliance.js',
  './defects.js',
  './tasks.js',
  './notifications.js',
  './report.js',
  './manifest.json'
  // CDN assets (Firebase, jsPDF, html2canvas) are not cached — let browser handle
];

// Install: pre-cache the app shell. skipWaiting() makes the new SW
// take over from the old one as soon as it's installed, instead of
// waiting for all tabs to close.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(ASSETS))
      .catch(err => { console.error('Cache install failed:', err); })
  );
  self.skipWaiting();
});

// Activate: DELETE EVERY cache that isn't the current version.
// This is the key fix — old 'acpm-v2'/'acpm-v3' caches (with the
// broken main.js) get wiped on every version bump.
// clients.claim() forces the new SW to control the page immediately.
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(k => {
          if (k !== CACHE_NAME) {
            return caches.delete(k);   // purge stale caches
          }
          return null;
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: Network-first for app files, cache fallback offline.
// On a successful network fetch, refresh the cache so the next
// load is fast AND current.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // Skip Firebase API calls (Realtime DB uses WebSockets)
  const url = new URL(e.request.url);
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('gstatic.com')) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(network => {
        if (network.ok) {
          const clone = network.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return network;
      })
      .catch(() => {
        return caches.match(e.request).then(cached => {
          if (cached) return cached;
          return new Response('Offline — no cached data available. Please connect to the internet.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
          });
        });
      })
  );
});
