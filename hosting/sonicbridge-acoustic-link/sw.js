// Generated from the entire production output. Never caches payloads or microphone data.
const CACHE = 'sonicbridge-15e7e011251ebe99';
const ASSETS = ["./","./assets/index-BEzxvTsA.css","./assets/index-CDU6kiOr.js","./assets/modem-worker-Dwqcb70j.js","./capture-worklet.js","./icons/icon-180.png","./icons/icon-192.png","./icons/icon-512.png","./index.html","./manifest.webmanifest","./vendor/LICENSE.ggwave","./vendor/LICENSE.reed-solomon","./vendor/THIRD_PARTY_NOTICES.txt","./vendor/ggwave-module.mjs","./vendor/ggwave.js","./offline-assets.json"].map(path => new URL(path, self.registration.scope).href);
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
// Updates wait until tabs close or a visible, user-triggered stop-and-reload action.
self.addEventListener('message', event => { if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('activate', event => event.waitUntil((async () => {
  const older = (await caches.keys()).filter(key => key.startsWith('sonicbridge-') && key !== CACHE);
  await Promise.all(older.slice(0, -1).map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(new URL('index.html', self.registration.scope).href)).then(cached => cached || fetch(request)));
  } else if (ASSETS.includes(request.url)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(request)).then(cached => cached || fetch(request)));
  } else if (request.url.includes('/assets/')) {
    // Allow a still-open previous build to finish using its hashed assets.
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
  }
});
