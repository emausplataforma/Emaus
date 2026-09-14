const CACHE_NAME = 'emaus-shell-v46';
const APP_SHELL = ['./', './index.html', './styles.css', './splash.css', './splash.js', './app.js', './api-config.js', './manifest.json', './bethesda-logo.png', './recepcao.html', './reception.js', './admin.html', './admin.css', './admin.js', './emaus-admin-logo.png', './publica.html', './publica.css', './publica.js'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const request = event.request;
  const isNavigation = request.mode === 'navigate';
  event.respondWith(
    (isNavigation ? fetch(request) : caches.match(request).then(cached => cached || fetch(request)))
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then(cached => cached || caches.match('./index.html')))
  );
});
