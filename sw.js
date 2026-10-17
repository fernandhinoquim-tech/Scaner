// Service worker: permite usar la app sin conexión y abrirla al instante.
const VERSION = 'scaner-v7';
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

// Lector de texto y de PDF incluidos en la app (vendor/), versiones en uso: se guardan la primera vez
// que se usan y sobreviven a las actualizaciones de la app (lo de otras versiones se borra).
const VENDOR_CACHE = 'scaner-vendor';
const VENDOR_CURRENT = /\/vendor\/(tesseract-7\.0\.0|pdfjs-6\.4\.299)\//;

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // Borra las versiones viejas de la app y la caché del CDN que se usaba antes.
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== VENDOR_CACHE).map(k => caches.delete(k))))
      .then(() => caches.open(VENDOR_CACHE))
      .then(c => c.keys().then(reqs => Promise.all(reqs.filter(r => !VENDOR_CURRENT.test(r.url)).map(r => c.delete(r)))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== location.origin) return;

  // Lectores de texto (Tesseract) y de PDF (pdf.js), versiones fijas: se descargan una vez y quedan.
  // Los idiomas no se guardan aquí: Tesseract ya los guarda en su propia base de datos.
  if (VENDOR_CURRENT.test(url.pathname)) {
    if (url.pathname.endsWith('.traineddata.gz')) return;
    e.respondWith(caches.open(VENDOR_CACHE).then(async cache => {
      const hit = await cache.match(url.pathname);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(url.pathname, res.clone()).catch(() => {});
      return res;
    }));
    return;
  }

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
