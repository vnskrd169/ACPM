
# COMPLETE ACPM v8 — All files rewritten with every improvement
# This is the master build — everything in one shot

# ============ sw.js (NEW — Service Worker for offline) ============
sw_js = '''const CACHE = 'acpm-v8';
const ASSETS = [
  './','./index.html','./style.css',
  './main.js','./labor.js','./materials.js',
  './billing.js','./changeorders.js','./sitelog.js','./suppliers.js',
  'https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/8.10.1/firebase-database.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(network => {
        if (network.ok) caches.open(CACHE).then(c => c.put(e.request, network.clone()));
        return network;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
'''

with open('/mnt/agents/output/sw.js', 'w') as f:
    f.write(sw_js)

print("✅ sw.js created")
