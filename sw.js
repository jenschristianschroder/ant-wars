const CACHE = 'ant-wars-picnic-v1.0.2';
const FILES = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './src/app.js', './src/engine.js', './src/memory.js', './src/art.js',
  './assets/picnic-clearing.webp', './assets/field-sprites.png', './assets/ant-mark.png',
  './assets/icon-192.png', './assets/icon-512.png', './assets/fonts/nest-block.woff',
  './assets/fonts/barlow-400.woff', './assets/fonts/barlow-600.woff', './assets/fonts/barlow-800.woff',
  './assets/fonts/space-mono-400.woff'
];
const assets = new Set(FILES.map(file => new URL(file,self.registration.scope).href));
const entry = new URL('./index.html',self.registration.scope);
const documents = new Set([new URL(self.registration.scope).pathname,entry.pathname]);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([...assets].map(url => new Request(url,{cache:'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(n => n.startsWith('ant-wars-picnic-') && n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return;
  if (req.mode === 'navigate' && documents.has(new URL(req.url).pathname)) {
    event.respondWith(caches.open(CACHE).then(async c => await c.match(entry.href) || fetch(req)));
  } else if (assets.has(req.url)) {
    event.respondWith(caches.open(CACHE).then(async c => await c.match(req) || fetch(req)));
  }
});
