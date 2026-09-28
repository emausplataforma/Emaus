const CACHE_NAME = 'emaus-shell-v68-visitor-delete';
const APP_SHELL = ['./', './index.html', './styles.css', './splash.css', './splash.js', './app.js', './api-config.js', './manifest.json', './bethesda-logo.png', './recepcao.html', './reception.js', './admin.html', './admin.css', './admin.js', './emaus-admin-logo.png', './publica.html', './publica.css', './publica.js', './visita.html', './pagamento.html', './privacidade.html'];

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
  const request = event.request;
  if (request.method !== 'GET') return;

  // A API nunca passa por aqui: dados da igreja (visitantes, agenda, presence)
  // precisam ser sempre a resposta mais recente do servidor. Guardar GET da API
  // no cache fazia um cadastro novo da recepcao nao aparecer na area do pastor.
  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }
  if (url.origin !== self.location.origin) return;

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
