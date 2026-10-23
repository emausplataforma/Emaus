// Service worker do MomoEquilibrio: cache offline e notificações push.
const CACHE = 'momoequilibrio-v13';
const ARQUIVOS = ['./', './index.html', './manifest.json', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || e.request.url.includes('/api/')) return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const rede = fetch(e.request).then((resp) => {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return resp;
      }).catch(() => cached);
      return cached || rede;
    })
  );
});

// Notificação enviada pelo servidor (funciona com o app fechado).
self.addEventListener('push', (e) => {
  let d = { titulo: 'MomoEquilibrio', corpo: 'Você tem um lembrete.', tag: 'lembrete' };
  try { d = Object.assign(d, e.data.json()); } catch (err) {}
  e.waitUntil(self.registration.showNotification(d.titulo, {
    body: d.corpo, icon: './icon.svg', badge: './icon.svg', tag: d.tag, renotify: true
  }));
});

// Ao tocar na notificação, abre ou foca o app.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      if (lista.length) return lista[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
