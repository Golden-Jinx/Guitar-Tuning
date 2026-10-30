const CACHE = 'stringroom-v7';
const FILES = ['./', './index.html', './style.css', './app.mjs', './pitch.mjs', './tunings.mjs', './library.mjs', './reorder.mjs', './interaction.mjs', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png', './manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('stringroom-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  const allowed = new Set(FILES.map(file => new URL(file, self.registration.scope).href));
  if (!allowed.has(new URL(event.request.url).href)) return;
  event.respondWith(fetch(event.request).then(response => { if (response.ok && response.type !== 'opaqueredirect') { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); } return response; }).catch(() => caches.match(event.request)));
});
