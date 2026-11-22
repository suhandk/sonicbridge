import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, sep } from 'node:path';
const root = resolve('dist');
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]))).flat();
}
const files = (await walk(root)).filter(p => !['sw.js', 'offline-assets.json'].includes(relative(root, p))).sort();
const hash = createHash('sha256');
for (const file of files) { hash.update(relative(root, file)); hash.update(await readFile(file)); }
const version = hash.digest('hex').slice(0, 16);
const resources = files.map(f => './' + relative(root, f).split(sep).join('/'));
const optional = resources.filter(path => /^\.\/(models\/|speech-runtime\/|assets\/(speech-worker-|ort-wasm-))/.test(path));
const paths = ['./', ...resources.filter(path => !optional.includes(path))];
await writeFile(resolve(root, 'offline-assets.json'), JSON.stringify({ version, assets: paths, optionalSpeech: optional }, null, 2));
paths.push('./offline-assets.json');
await writeFile(resolve(root, 'sw.js'), `// Generated from the entire production output. Never caches payloads or microphone data.
const CACHE = 'sonicbridge-${version}';
const ASSETS = ${JSON.stringify(paths)}.map(path => new URL(path, self.registration.scope).href);
const SPEECH = new Set(${JSON.stringify(optional)}.map(path => new URL(path, self.registration.scope).href));
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
  } else if (SPEECH.has(request.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.status === 200) {
        try { await cache.put(request, response.clone()); } catch { /* Dictation can still run if storage is full. */ }
      }
      return response;
    })());
  } else if (request.url.includes('/assets/')) {
    // Allow a still-open previous build to finish using its hashed assets.
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
  }
});
`);
console.log(`Offline build ${version}: ${paths.length} local resources precached, ${optional.length} speech resources cached on use.`);
