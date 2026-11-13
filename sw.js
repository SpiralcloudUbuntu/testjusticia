/* sw.js — Service Worker: cache-first para los assets de la app.
   Sube CACHE_NAME en CADA deploy (incluidos reverts). */
const CACHE_NAME = 'testjusticia-v18';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './db.js',
  './app.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './manifest.json',
  './datos/examenes.js',
  './datos/banco.js',
  './datos/casos.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS).catch((e) => console.warn('asset no cacheado', e)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves.filter((c) => c !== CACHE_NAME).map((c) => caches.delete(c))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // El HTML va SIEMPRE a red primero: si no, el service worker sirve para
  // siempre el index.html viejo y la app parece que no se actualiza.
  const esHtml = req.mode === 'navigate' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('sw.js');
  if (esHtml) {
    event.respondWith(
      fetch(req).then((resp) => {
        if (resp && resp.status === 200) {
          const copia = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copia));
        }
        return resp;
      }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cacheado) => {
      if (cacheado) return cacheado;
      return fetch(req).then((resp) => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const copia = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copia));
        }
        return resp;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
