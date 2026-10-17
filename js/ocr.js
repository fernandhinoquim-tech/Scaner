// Lector de texto (OCR) con Tesseract.js, incluido en la app (carpeta vendor/, copia verificada del
// paquete oficial): nada se pide a otros servidores. Se descarga del mismo sitio de la app solo
// cuando se usa (unos 9 MB la primera vez: motor + español + inglés) y después queda guardado.

const BASE = new URL('../vendor/tesseract-7.0.0/', import.meta.url).href;
const SCRIPT_URL = BASE + 'tesseract.min.js';
const LANGS = 'spa+eng';
const IDLE_MS = 90000; // libera la memoria del lector tras un rato sin uso

// Cambia este número si cambian la preparación de imagen o los parámetros del OCR:
// así se descartan los textos guardados que se leyeron con la versión anterior.
export const OCR_REVISION = 1;

export class OcrUnavailableError extends Error {}
export class OcrCancelledError extends Error {}

const UNAVAILABLE = 'No se pudo descargar el lector de texto. Se necesita internet la primera vez.';

let scriptPromise = null;
let workerPromise = null;
let idleTimer = null;
let listener = null;       // progreso del trabajo actual
let initFailed = null;     // rechaza la creación si Tesseract informa un error al iniciar
let cancelWait = null;     // rechaza la espera actual si se cancela

function loadScript() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_URL;
      s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new OcrUnavailableError(UNAVAILABLE)));
      s.onerror = () => {
        scriptPromise = null;
        s.remove();
        reject(new OcrUnavailableError(UNAVAILABLE));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

function getWorker() {
  clearTimeout(idleTimer);
  if (!workerPromise) {
    const attempt = loadScript().then(Tesseract => new Promise((resolve, reject) => {
      // Si falla la descarga del idioma, Tesseract.js no rechaza: solo avisa por errorHandler.
      initFailed = () => reject(new OcrUnavailableError(UNAVAILABLE));
      Tesseract.createWorker(LANGS, 1, {
        workerPath: BASE + 'worker.min.js',
        corePath: BASE + 'core',  // carpeta: Tesseract elige el motor que soporte el teléfono
        langPath: BASE + 'lang',
        workerBlobURL: false,     // proceso normal del mismo sitio (la política de seguridad no admite blob:)
        logger: (m) => listener && listener(m),
        errorHandler: (err) => {
          console.warn('OCR:', err);
          if (initFailed) initFailed();
        },
      }).then(resolve, (err) => {
        console.warn('OCR:', err);
        reject(new OcrUnavailableError(UNAVAILABLE));
      });
    })).finally(() => { initFailed = null; });
    workerPromise = attempt;
    attempt.catch(() => { if (workerPromise === attempt) workerPromise = null; });
  }
  return workerPromise;
}

// Espera una promesa, pero permite abandonarla con cancel().
function cancellable(promise) {
  return new Promise((resolve, reject) => {
    cancelWait = () => reject(new OcrCancelledError('Cancelado'));
    promise.then(resolve, reject);
  }).finally(() => { cancelWait = null; });
}

const STATUS = {
  'loading tesseract core': 'Descargando lector de texto',
  'loading language traineddata': 'Descargando idiomas',
  'loading language traineddata (from cache)': 'Cargando idiomas',
  'initializing tesseract': 'Preparando lector de texto',
  'initializing api': 'Preparando lector de texto',
  'recognizing text': 'Leyendo texto',
};

// Lee una imagen (Blob). onProgress(fracción 0..1 de esta imagen, etiqueta).
export async function recognize(image, width, height, onProgress) {
  listener = (m) => {
    if (!onProgress) return;
    const label = STATUS[m.status] || 'Preparando lector de texto';
    onProgress(m.status === 'recognizing text' ? m.progress || 0 : 0, label);
  };
  try {
    const worker = await cancellable(getWorker());
    const { data } = await cancellable(worker.recognize(image, {}, { text: false, blocks: true }));
    return compact(data, width, height);
  } finally {
    listener = null;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(release, IDLE_MS);
  }
}

// Detiene lo que se esté leyendo y libera el lector.
export function cancel() {
  if (cancelWait) cancelWait();
  release();
}

export function release() {
  clearTimeout(idleTimer);
  const p = workerPromise;
  workerPromise = null;
  if (p) p.then(w => w.terminate()).catch(() => {});
}

// ---------- Resultado compacto ----------
// Coordenadas normalizadas (0..1) respecto a la imagen de la página, para guardarlo junto a
// la página y reutilizarlo en PDF, TXT y Word sin volver a leer.

const r5 = (x) => Math.round(x * 1e5) / 1e5;

// Renglones de "ruido" (manchas leídas como letras): baja confianza y casi todo símbolos sueltos.
function isNoise(words) {
  const conf = words.reduce((a, w) => a + w.c, 0) / words.length;
  const short = words.filter(w => w.t.replace(/[^\p{L}\p{N}]/gu, '').length <= 2).length;
  return conf < 50 && short / words.length >= 0.6;
}

function compact(data, w, h) {
  const paras = [];
  let n = 0, sum = 0;
  // Totales sin filtrar (incluye ruido): sirven para decidir si la página está girada.
  let rawN = 0, rawSum = 0, rawLettered = 0;
  for (const block of data.blocks || []) {
    for (const par of block.paragraphs || []) {
      const lines = [];
      for (const line of par.lines || []) {
        const words = [];
        for (const wd of line.words || []) {
          const t = (wd.text || '').trim();
          if (!t) continue;
          rawN++; rawSum += wd.confidence;
          if (/\p{L}{3,}/u.test(t)) rawLettered++;
          const b = wd.bbox;
          words.push({ t, b: [r5(b.x0 / w), r5(b.y0 / h), r5(b.x1 / w), r5(b.y1 / h)], c: Math.round(wd.confidence) });
        }
        if (!words.length || isNoise(words)) continue;
        const bb = line.bbox, bl = line.baseline, ra = line.rowAttributes || {};
        lines.push({
          words,
          box: [r5(bb.x0 / w), r5(bb.y0 / h), r5(bb.x1 / w), r5(bb.y1 / h)],
          bl: bl && bl.x1 > bl.x0 ? [r5(bl.x0 / w), r5(bl.y0 / h), r5(bl.x1 / w), r5(bl.y1 / h)] : null,
          rh: r5((ra.rowHeight || (bb.y1 - bb.y0)) / h),
          desc: r5(Math.abs(ra.descenders || 0) / h),
        });
        for (const wd of words) { n++; sum += wd.c; }
      }
      if (lines.length) paras.push({ lines });
    }
  }
  return {
    paras,
    conf: n ? Math.round(sum / n) : 0,
    words: n,
    raw: { words: rawN, conf: rawN ? Math.round(rawSum / rawN) : 0, lettered: rawN ? rawLettered / rawN : 0 },
  };
}

// Texto plano: renglones separados por salto de línea y párrafos por una línea en blanco.
export function ocrText(ocr) {
  if (!ocr) return '';
  return ocr.paras.map(p => p.lines.map(l => l.words.map(w => w.t).join(' ')).join('\n')).join('\n\n');
}
