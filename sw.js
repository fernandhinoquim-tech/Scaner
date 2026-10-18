// Service worker: permite usar la app sin conexión y abrirla al instante.
const VERSION = 'scaner-v10';
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

// Huella SHA-256 de cada archivo de código de vendor/ (se generan desde los mismos archivos; ver
// vendor/README.md). Lo que no coincida no se usa: así nadie puede dejar código alterado guardado.
const VENDOR_SHA256 = {
  'vendor/pdfjs-6.4.299/pdf.min.js': 'vMwk6nEduORFA2KVGZBKUpLXO52qohS7583MKCsPQlk=',
  'vendor/pdfjs-6.4.299/pdf.worker.min.js': 'FF0t06sMhhUQEdupWs+i1TNuKszVk4jqQ9vuDv3arsY=',
  'vendor/pdfjs-6.4.299/wasm/jbig2.wasm': 'Rm9FwqYaaYFS+1QAwn5W/yzrc9y3H94/w2alAjCOqrA=',
  'vendor/pdfjs-6.4.299/wasm/jbig2_nowasm_fallback.js': 'aGhs7WJKSMQvhM2qSC7ES3Kw3k3ISg35A68ft7RbXZo=',
  'vendor/pdfjs-6.4.299/wasm/openjpeg.wasm': 'leUAJZevCCQASqV7GQD+AZcV2zieN2QLHlg5XkLwDMU=',
  'vendor/pdfjs-6.4.299/wasm/openjpeg_nowasm_fallback.js': 'kEezS2vBQtheSwqhsIsLm6rUxvi3rIdkG56PkOtv0j4=',
  'vendor/pdfjs-6.4.299/wasm/qcms_bg.wasm': 'Zj2GEm1fX8scYUkPlDU+KoN1ZguMVJirPrq1o0sIgA4=',
  'vendor/tesseract-7.0.0/core/tesseract-core-lstm.wasm.js': '7vX4svjiDhUGgLIK2uxKYLq6/uOtvoqUWDyB/uRuhoA=',
  'vendor/tesseract-7.0.0/core/tesseract-core-relaxedsimd-lstm.wasm.js': 'hhpTbPnvjmPLZE1XurOcOI8399a29gAkt0HF9rOaWbM=',
  'vendor/tesseract-7.0.0/core/tesseract-core-simd-lstm.wasm.js': 'xYtGpMeWwLivzPd1kdW4dbaJa0XUArvOjKpvU2JEezg=',
  'vendor/tesseract-7.0.0/tesseract.min.js': 'AAwn2c0N72Vfd7NscqOJwKsTeTqjHLTXqrVtCcCvvH4=',
  'vendor/tesseract-7.0.0/worker.min.js': 'V2t99+M5PhN+UYSTV8mttT/nrBu2m/oGzz1hUg8YLG0=',
};
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
async function intact(res, key) {
  const want = VENDOR_SHA256[key];
  if (!want) return true; // datos (idiomas, fuentes, tablas): no son código
  return b64(await crypto.subtle.digest('SHA-256', await res.clone().arrayBuffer())) === want;
}

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
      const key = url.pathname.slice(url.pathname.indexOf('vendor/'));
      const hit = await cache.match(url.pathname);
      if (hit && await intact(hit, key)) return hit;
      if (hit) await cache.delete(url.pathname); // alterado: se descarta y se vuelve a pedir
      const res = await fetch(req, { cache: 'no-cache' });
      if (!res.ok || res.type !== 'basic' || !await intact(res, key)) return Response.error();
      cache.put(url.pathname, res.clone()).catch(() => {});
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
