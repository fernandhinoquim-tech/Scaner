// Service worker: permite usar la app sin conexión y abrirla al instante.
const VERSION = 'scaner-v6';
const APP_SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/db.js',
  'js/export.js',
  'js/idcard.js',
  'js/imgproc.js',
  'js/ocr.js',
  'js/pdfcrypt.js',
  'js/pdfimport.js',
  'js/sign.js',
  'js/text.js',
  'js/worker.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' evita copiar archivos viejos de la caché HTTP al actualizar.
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(APP_SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

// Lector de texto y de PDF de las versiones en uso (lo demás se borra al actualizar).
const CDN_CURRENT = /tesseract\.js(-core)?@v?7\.0\.0\/|pdfjs-dist@6\.4\.299\//;

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'scaner-cdn').map(k => caches.delete(k))))
      .then(() => caches.open('scaner-cdn'))
      .then(cdn => cdn.keys().then(reqs => Promise.all(reqs.filter(r => !CDN_CURRENT.test(r.url)).map(r => cdn.delete(r)))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Lectores de texto (Tesseract) y de PDF (pdf.js), versiones fijas: se descargan una vez y quedan.
  // Se pide siempre con CORS para poder comprobar que la respuesta es válida antes de guardarla.
  // Los idiomas no se guardan aquí: Tesseract ya los guarda en su propia base de datos.
  if (url.hostname === 'cdn.jsdelivr.net' && CDN_CURRENT.test(url.pathname)) {
    e.respondWith(caches.open('scaner-cdn').then(async cache => {
      const hit = await cache.match(url.href);
      if (hit) return hit;
      const res = await fetch(url.href, { mode: 'cors', credentials: 'omit' });
      if (res.ok) cache.put(url.href, res.clone()).catch(() => {});
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  // Archivos de la app: responde desde caché y actualiza en segundo plano.
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || fresh;
  }));
});
