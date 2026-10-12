/* Service worker: deixa o app funcionando sem internet. */
const VERSAO = '0.3.1';
const CACHE = 'chamada-' + VERSAO;
const v = arq => arq + '?v=' + VERSAO;  // mesmos endereços usados no index.html
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  v('css/app.css'), v('js/cursos-uff.js'), v('js/core.js'), v('js/ocr.js'), v('js/pasta.js'), v('js/app.js'),
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
// Bibliotecas da CDN (versões fixas): cache primeiro; o que for baixado depois (leitor de
// texto e modelo de português, na 1ª leitura de folha) também fica guardado para uso offline.
self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) {
    ev.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      if (res.ok && res.type === 'cors') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  ev.respondWith(
    fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
