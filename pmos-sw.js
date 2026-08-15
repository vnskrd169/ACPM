// -----------------------------------------------------------------------------
//  ACPM PMOS Service Worker
//  Standalone worker scoped to pmos.html only.
//  Does NOT interfere with ACPM's sw.js, caches, or cache cleanup.
//
//  Cache strategy: Network-first with offline fallback.
//  PMOS_CACHE is the only cache managed by this worker.
//  All old PMOS caches are purged on activate.
// -----------------------------------------------------------------------------

const PMOS_CACHE = 'pmos-cache-v7';

const PMOS_ASSETS = [
  './pmos.html',
  './acpm-shell.js',
  './pmos.js',
  './pmos-office.js',
  './meeting-notes.js',
  './pmos-manifest.json',
  './manifest-staging.json',
  './environment.js',
  './assets/brand/acpm-brand.css',
  './assets/brand/pmos-app.css',
  './assets/brand/acpm/favicon.svg',
  './assets/brand/acpm/logo-mark.svg',
  './assets/brand/acpm/logo-horizontal.svg'
];

// Install: pre-cache PMOS app shell assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(PMOS_CACHE)
      .then(c => c.addAll(PMOS_ASSETS))
      .catch(err => { console.warn('PMOS SW: Cache install failed:', err); })
  );
  self.skipWaiting();
});

// Listen for skipWaiting message from the PMOS update button
self.addEventListener('message', e => {
  if (e.data && e.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});

// Activate: delete only PMOS caches that are not the current version
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(k => {
          if (k.startsWith('pmos-cache-') && k !== PMOS_CACHE) {
            return caches.delete(k);
          }
          return null;
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first with offline fallback for PMOS assets only
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Skip Firebase and Google API calls
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('gstatic.com') ||
      (url.hostname.includes('google.com') && url.pathname.includes('/macros/'))) {
    return;
  }

  // Only handle requests for our own origin
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then(network => {
        if (network.ok) {
          const clone = network.clone();
          caches.open(PMOS_CACHE).then(c => c.put(e.request, clone));
        }
        return network;
      })
      .catch(() => {
        return caches.match(e.request, { ignoreSearch: true }).then(cached => {
          if (cached) return cached;
          return caches.match(e.request);
        });
      })
  );
});
