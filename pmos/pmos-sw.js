// -----------------------------------------------------------------------------
//  ACPM PMOS Service Worker — scoped to /pmos/
//  Does NOT interfere with ACPM's root sw.js, caches, or cache cleanup.
//
//  Cache strategy: Network-first with offline fallback.
//  Only caches PMOS assets under PMOS_CACHE namespace.
//  Only deletes caches starting with 'pmos-cache-'.
// -----------------------------------------------------------------------------

var PMOS_CACHE = 'pmos-cache-v6';

var PMOS_ASSETS = [
  './',
  './index.html',
  './offline.html',
  './pmos-sw.js',
  './pmos-manifest.json',
  './pmos-manifest-staging.json',
  '../environment.js',
  '../acpm-shell.js',
  '../pmos.js',
  '../pmos-office.js',
  '../meeting-notes.js',
  '../pmos-subscription-manager.js',
  '../pmos-photo-lightbox.js',
  '../assets/brand/acpm-brand.css',
  '../assets/brand/pmos-app.css',
  '../assets/brand/acpm/favicon.svg',
  '../assets/brand/acpm/logo-mark.svg',
  '../assets/brand/acpm/logo-horizontal.svg'
];

// Install: pre-cache PMOS app shell
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(PMOS_CACHE)
      .then(function(c) { return c.addAll(PMOS_ASSETS); })
      ['catch'](function(err) { console.warn('PMOS SW: Cache install failed:', err); })
  );
  self.skipWaiting();
});

// Listen for skipWaiting message from PMOS update button
self.addEventListener('message', function(e) {
  if (e.data && e.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});

// Activate: delete only PMOS caches that are not the current version
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.map(function(k) {
          if (k.indexOf('pmos-cache-') === 0 && k !== PMOS_CACHE) {
            return caches.delete(k);
          }
          return null;
        })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

// Fetch: network-first with offline fallback for PMOS origin requests only
self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;

  var url = new URL(e.request.url);

  // Only handle requests for our own origin
  if (url.origin !== self.location.origin) return;

  // Skip Firebase and Google API calls
  if (url.hostname.indexOf('firebaseio.com') >= 0 ||
      url.hostname.indexOf('googleapis.com') >= 0 ||
      url.hostname.indexOf('gstatic.com') >= 0 ||
      (url.hostname.indexOf('google.com') >= 0 && url.pathname.indexOf('/macros/') >= 0)) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(function(network) {
        if (network.ok) {
          var clone = network.clone();
          caches.open(PMOS_CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return network;
      })
      ['catch'](function() {
        return caches.match(e.request, { ignoreSearch: true }).then(function(cached) {
          if (cached) return cached;
          return caches.match(e.request);
        });
      })
  );
});
