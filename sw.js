// -----------------------------------------------------------------------------
//  ACPM Service Worker
//  Self-clearing: purges ALL old caches on activate and forces
//  the new version to take over immediately (clients.claim).
//  This guarantees users get fresh code after ONE page refresh,
//  without needing to manually unregister the SW.
// -----------------------------------------------------------------------------

// Bump this EVERY time you deploy changed files.
const CACHE_NAME = 'acpm-v146';

const ASSETS = [
  './',
  './index.html',
  './login.html',
  './pmos.html',
  './dashboard.html',
  './workspace.html',
  './environment.js?v=1',
  './style.css?v=114',
  './assets/brand/ai-command-center.css?v=4',
  './utils.js?v=87',
  './auth.js?v=99',
  './main.js?v=112',
  './payroll-math.js?v=3',
  './labor.js?v=100',
  './materials.js?v=97',
  './billing.js?v=76',
  './changeorders.js?v=95',
  './sitelog.js?v=95',
  './suppliers.js?v=94',
  './equipment.js?v=94',
  './compliance.js?v=88',
  './defects.js?v=94',
  './tasks.js?v=96',
  './notifications.js?v=86',
  './ux-palette.js?v=1',
  './report.js?v=98',
  './pmos.js?v=4',
  './pmos-subscription-manager.js?v=1',
  './pmos-photo-lightbox.js?v=1',
  './pmos-office.js?v=5',
  './ai-attention.js?v=2',
  './ai-command-center.js?v=5',
  './apm-workspace-vnext.js?v=1',
  './face-attendance.js?v=1',
  './pmos-task-adapter.js?v=2',
  './manifest.json',
  './manifest-staging.json'
  // CDN assets (Firebase, jsPDF, html2canvas) are not cached; let browser handle them.
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
// This is the key fix: old 'acpm-v2'/'acpm-v3' caches (with the
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
  if (url.pathname === '/pmos/' || url.pathname.startsWith('/pmos/')) {
    return;
  }
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
          return new Response('Offline: no cached data available. Please connect to the internet.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
          });
        });
      })
  );
});
