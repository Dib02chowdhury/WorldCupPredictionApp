const CACHE_NAME = 'worldcup-pulse-v2';
const CORE_ASSETS = ['./', './index.html', './manifest.json', './css/styles.css', './js/app.js', './assets/icons/favicon.svg', './assets/icons/icon-192.svg', './assets/icons/icon-512.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  let requestUrl;
  try {
    requestUrl = new URL(event.request.url);
  } catch (error) {
    return;
  }
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy).catch(() => {}));
      return response;
    }).catch(() => caches.match('./index.html')))
  );
});
