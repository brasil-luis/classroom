/* Service worker: deixa o app funcionando sem internet. */
const CACHE = 'chamada-0.1.0';
const SHELL = [
  './', 'index.html', 'css/app.css', 'js/core.js', 'js/app.js', 'manifest.webmanifest',
  'js/cursos-uff.js', 'icons/icon-192.png', 'icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js'
];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Arquivos do app: rede primeiro (pega atualizações), cache se offline.
// Biblioteca da CDN: cache primeiro (versão fixa).
self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) {
    ev.respondWith(caches.match(req).then(r => r || fetch(req)));
    return;
  }
  ev.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
