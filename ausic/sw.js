const CACHE = 'ausic-shell-v5';
const BASE_URL = new URL('./', self.location.href);
const SHELL = ['index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'favicon.svg'].map(file => new URL(file, BASE_URL).href);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE_URL.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    } catch (error) {
      const fallback = await cache.match(new URL('index.html', BASE_URL).href);
      if (fallback && request.mode === 'navigate') return fallback;
      throw error;
    }
  })());
});
