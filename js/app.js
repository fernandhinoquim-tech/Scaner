import * as db from './db.js';
import {
  detectDocument, FULL_FRAME, polyArea, orderCorners, warp, applyFilter, rotate, prepareForOcr, OCR_MAX_SIDE,
  rotateGray, inkBand,
} from './imgproc.js';
import * as ex from './export.js';
import * as ocr from './ocr.js';
import { isPdf, renderPdf } from './pdfimport.js';
import { suggestTitle, search, terms } from './text.js';
import { createPad, signatureFromPhoto, drawMarks, toView, fromView, INKS } from './sign.js';
import { composeIdPage, looksLikeCard } from './idcard.js';

const $ = (id) => document.getElementById(id);
const MAX_ORIGINAL = 3200;   // lado máximo de la foto original guardada
const MAX_OUTPUT = 2400;     // lado máximo de la página escaneada
const DETECT_SIZE = 360;     // tamaño de trabajo para detectar bordes al capturar
const LIVE_SIZE = 240;       // tamaño de trabajo para la detección en vivo
const LIVE_SIZE_CARD = 300;  // ídem en modo cédula

const store = {
  get(k, d) { try { const v = localStorage.getItem('scaner.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('scaner.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

const state = {
  doc: null,
  pages: [],
  view: 'home',
  editIndex: -1,
  cameraFrom: 'home',
  capturedThisSession: 0,
};

// ---------------- Utilidades ----------------

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

const canvasToBlob = (c, type = 'image/jpeg', q = 0.9) => new Promise((resolve, reject) =>
  c.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo codificar la imagen'))), type, q));

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

async function decodeBlob(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

// Dibuja una imagen/video en un canvas limitado a maxSide.
function drawScaled(source, sw, sh, maxSide) {
  const s = Math.min(1, maxSide / Math.max(sw, sh));
  const c = makeCanvas(Math.max(1, Math.round(sw * s)), Math.max(1, Math.round(sh * s)));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

const getData = (c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);

function detectOn(canvas, opts = {}) {
  // En modo cédula, con el mismo detalle que la vista previa: se recorta lo que se vio.
  const small = drawScaled(canvas, canvas.width, canvas.height, opts.card ? LIVE_SIZE_CARD : DETECT_SIZE);
  return detectDocument(getData(small), opts);
}

function formatDate(ts) {
  return new Date(ts).toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function defaultName() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `Escaneo ${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

const safeName = (s) => (s || 'Escaneo').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Escaneo';

// ---------------- Worker de procesamiento ----------------

let worker = null;
let jobSeq = 0;
const jobs = new Map();
try {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const job = jobs.get(e.data.id);
    if (!job) return;
    jobs.delete(e.data.id);
    e.data.error ? job.reject(new Error(e.data.error)) : job.resolve(e.data.image);
  };
  worker.onerror = () => {
    worker = null;
    for (const job of jobs.values()) job.reject(new Error('worker'));
    jobs.clear();
  };
} catch { worker = null; }

function workerJob(msg) {
  return new Promise((resolve, reject) => {
    const id = ++jobSeq;
    jobs.set(id, { resolve, reject });
    worker.postMessage({ id, ...msg });
  });
}

async function runProcess(image, corners, filter, rotation) {
  if (worker) {
    try {
      return await workerJob({ image, corners, filter, rotation, maxSide: MAX_OUTPUT });
    } catch { /* se procesa en el hilo principal */ }
  }
  return rotate(applyFilter(warp(image, corners, MAX_OUTPUT), filter), rotation);
}

// Imagen para el OCR: gris con sombras aplanadas, a la máxima resolución disponible.
async function runOcrPrep(image, corners, rotation) {
  if (worker) {
    try {
      return await workerJob({ type: 'ocr', image, corners, rotation });
    } catch { /* se procesa en el hilo principal */ }
  }
  return prepareForOcr(rotate(warp(image, corners, OCR_MAX_SIDE), rotation));
}

async function originalData(page) {
  const bmp = await decodeBlob(page.original);
  const data = getData(drawScaled(bmp, page.ow, page.oh, MAX_ORIGINAL));
  bmp.close && bmp.close();
  return data;
}

// Página recortada, con filtro y girada, sin firmas.
async function plainCanvas(page, src) {
  const out = await runProcess(src || await originalData(page), page.corners, page.filter, page.rotation);
  const c = makeCanvas(out.width, out.height);
  c.getContext('2d').putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
  return c;
}

// Guarda la página sobre su registro actual: respeta el documento al que pertenece ahora (por si se
// movió o se unió a otro mientras se procesaba) y no revive una página que se borró en el intermedio.
// Devuelve false si la página ya no existe.
async function savePage(page) {
  const saved = await db.updatePage(page.id, (rec) => { Object.assign(rec, page, { docId: rec.docId }); });
  if (saved) page.docId = saved.docId;
  return !!saved;
}

// Genera la imagen final y la miniatura de una página.
async function renderPage(page, src) {
  const c = await plainCanvas(page, src);
  if (page.marks && page.marks.length) {
    await drawMarks(c, page.marks, page.rotation, page.filter === 'gray' || page.filter === 'bw');
  }
  page.processed = await canvasToBlob(c, 'image/jpeg', 0.9);
  page.width = c.width;
  page.height = c.height;
  page.thumb = await canvasToBlob(drawScaled(c, c.width, c.height, 360), 'image/jpeg', 0.75);
  if (!await savePage(page)) return page; // se borró mientras se procesaba
  // Si se procesó una copia leída de la base (p. ej. al enderezar en segundo plano) y ese
  // documento está abierto, se actualiza también la copia en pantalla.
  const live = state.pages.find(p => p.id === page.id);
  if (live && live !== page) Object.assign(live, page);
  onPageReady(live || page);
  return page;
}

// Páginas en la cola de procesamiento, y las que fallaron (no se reintentan solas en esta sesión).
const pendingRender = new Set();
const failedRender = new Set();
function queueRender(page, data) {
  pendingRender.add(page.id);
  enqueue(async () => {
    try { await renderPage(page, data); } catch (err) { failedRender.add(page.id); throw err; }
  }).finally(() => pendingRender.delete(page.id));
}

// Cola secuencial para no saturar el teléfono al escanear rápido.
let queue = Promise.resolve();
let queued = 0;
function enqueue(fn) {
  queued++;
  queue = queue.then(fn).catch(err => {
    console.error(err);
    toast('Error al procesar una página: ' + err.message);
  }).finally(() => {
    queued--;
    if (!queued) bgKick();
  });
  return queue;
}

// ---------------- Documento actual ----------------

// autoName: el nombre se reemplaza por el título de la primera página cuando se lea su texto.
const newDoc = () => ({ id: db.uid(), name: defaultName(), created: Date.now(), pageIds: [], autoName: true });

async function ensureDoc() {
  if (!state.doc) {
    state.doc = newDoc();
    state.pages = [];
    await db.putDoc(state.doc);
  }
  return state.doc;
}

// Dónde van las páginas nuevas: al final, o en la posición elegida con "＋" (insertar entre
// páginas). La posición avanza con cada página para que varias queden en el orden en que llegan.
function nextIndex(doc) {
  if (state.insertAt == null || state.insertAt > doc.pageIds.length) return doc.pageIds.length;
  return state.insertAt++;
}

// doc: documento al que va la página (por defecto, el abierto). Si mientras tanto se salió de él (por
// ejemplo, a mitad de una importación larga), la página se agrega igual a ese documento, al final.
async function addPage(originalCanvas, corners, { filter, source, doc: target } = {}) {
  const doc = target || await ensureDoc();
  const original = await canvasToBlob(originalCanvas, 'image/jpeg', 0.92);
  const page = {
    id: db.uid(),
    docId: doc.id,
    original,
    ow: originalCanvas.width,
    oh: originalCanvas.height,
    corners: corners || FULL_FRAME,
    filter: filter || store.get('filter', 'doc'),
    rotation: 0,
    created: Date.now(),
    ...(source ? { source } : {}),
  };
  pendingRender.add(page.id); // ya cuenta como "en la cola" (renderDoc no debe procesarla de nuevo)
  await db.putPage(page);
  if (state.doc && state.doc.id === doc.id) {
    const live = state.doc;
    const at = nextIndex(live);
    live.pageIds.splice(at, 0, page.id);
    state.pages.splice(at, 0, page);
    await db.putDoc(live);
  } else if (await db.updateDoc(doc.id, (d) => { d.pageIds.push(page.id); })) {
    if (state.view === 'home') renderHome();
  } else {
    pendingRender.delete(page.id);
    await db.deletePage(page.id); // el documento se borró mientras tanto
    return null;
  }
  state.lastAdded = page;
  queueRender(page, getData(originalCanvas));
  return page;
}

const PDF_MAX_SIDE = 2800; // ~250 ppp en una hoja carta: nítido para leer y para el OCR
const isImage = (f) => (f.type || '').startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(f.name || '');
const isWord = (f) => /\.(docx?|odt|rtf|pages)$/i.test(f.name || '');

async function importFiles(files) {
  if (!files.length) return endInsert(0);
  const usable = files.filter(f => isPdf(f) || isImage(f));
  if (!usable.length) {
    endInsert(0);
    return toast(files.some(isWord)
      ? 'Los archivos de Word aún no se pueden abrir aquí. En Word usa Archivo → Guardar como → PDF y súbelo.'
      : 'Ese tipo de archivo no se puede agregar: elige imágenes o documentos PDF.', 7000);
  }
  toast(usable.length > 1 ? `Importando ${usable.length} archivos…` : 'Importando…');
  state.importing = true; // al salir de la cámara para importar, no se cierra la inserción
  const created = !state.doc;
  const target = await ensureDoc();
  if (state.view === 'camera') {
    if (state.cameraFrom === 'doc') history.back(); else openDocView('replace');
  } else if (state.view !== 'doc') {
    openDocView();
  }
  let added = 0;
  for (const f of usable) {
    try {
      if (isPdf(f)) {
        // Un documento nuevo hecho con un PDF se llama como el archivo.
        const name = (f.name || '').replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
        if (created && !added && name) {
          const saved = await db.updateDoc(target.id, (d) => {
            if (!d.autoName || d.pageIds.length) return false;
            d.name = name;
            d.autoName = false;
          });
          if (saved && state.doc && state.doc.id === saved.id) {
            Object.assign(state.doc, { name: saved.name, autoName: false });
            renderDoc();
          }
        }
        // Las páginas de un PDF ya están derechas y limpias: sin recorte ni filtro.
        await renderPdf(f, PDF_MAX_SIDE, async (canvas, n, total) => {
          if (total > 1) toast(`Importando PDF: página ${n} de ${total}…`, 4000);
          if (await addPage(canvas, FULL_FRAME, { filter: 'original', source: 'pdf', doc: target })) added++;
          renderDoc();
        }, (wrong) => askPassword(f.name, wrong),
        (n) => n <= 60 || confirm(`"${f.name}" tiene ${n} páginas. Importarlas todas puede tardar varios minutos y ocupar bastante espacio. ¿Continuar?`));
      } else {
        const bmp = await decodeBlob(f);
        const canvas = drawScaled(bmp, bmp.width, bmp.height, MAX_ORIGINAL);
        bmp.close && bmp.close();
        if (await addPage(canvas, detectOn(canvas), { doc: target })) added++;
        renderDoc();
      }
    } catch (err) {
      console.error(err);
      toast(err.message && isPdf(f) ? err.message : `No se pudo abrir "${f.name}"`, 6000);
    }
  }
  state.importing = false;
  if (created && !added) {
    // No se pudo agregar nada a un documento nuevo: no dejarlo vacío.
    const open = state.doc && state.doc.id === target.id;
    const doc = await db.getDoc(target.id);
    if (doc && !doc.pageIds.length) {
      await db.deleteDoc(doc);
      if (open) {
        state.doc = null;
        state.insertAt = null;
        if (state.view === 'doc') return history.back();
      }
      if (state.view === 'home') renderHome();
    }
  }
  const skipped = files.length - usable.length;
  endInsert(added, skipped ? `${skipped} archivo(s) no se agregaron: solo se aceptan imágenes y PDF.` : '');
}

// Preguntas abiertas (contraseña, elegir documento o firma): al cambiar de pantalla se responden
// "cancelar", para que lo que estaba esperando la respuesta no quede colgado.
const prompts = new Set();
function cancelPrompts() { for (const cancel of [...prompts]) cancel(); }

// Pide la contraseña de un PDF. Devuelve null si se cancela.
function askPassword(fileName, wrong) {
  return new Promise((resolve) => {
    const panel = $('sheet-pass'), input = $('pass-input');
    $('pass-title').textContent = wrong ? 'Contraseña incorrecta' : 'Este PDF tiene contraseña';
    $('pass-note').textContent = wrong ? 'Revisa mayúsculas y minúsculas y vuelve a intentarlo.'
      : `Escribe la contraseña de "${fileName}" para agregar sus páginas.`;
    input.value = '';
    panel.classList.remove('hidden');
    setTimeout(() => input.focus(), 50);
    const cancel = () => done(null);
    const done = (value) => {
      prompts.delete(cancel);
      panel.classList.add('hidden');
      $('pass-form').onsubmit = null;
      $('btn-pass-cancel').onclick = null;
      input.value = '';
      resolve(value);
    };
    prompts.add(cancel);
    $('pass-form').onsubmit = (e) => { e.preventDefault(); done(input.value); };
    $('btn-pass-cancel').onclick = cancel;
  });
}

// Fin de una inserción entre páginas: avisa dónde quedaron y vuelve a agregar al final.
function endInsert(added, extra = '') {
  let msg = '';
  if (state.insertAt != null && added) {
    const first = state.insertAt - added + 1;
    msg = added === 1 ? `Se agregó la página ${first}.` : `Se agregaron las páginas ${first} a ${first + added - 1}.`;
  }
  state.insertAt = null;
  if (msg || extra) toast([msg, extra].filter(Boolean).join(' '), extra ? 6000 : 3000);
}

// ---------------- Navegación ----------------

function setView(name) {
  cancelPrompts();
  if (state.view === 'camera' && name !== 'camera') {
    stopCamera();
    if (!state.importing) endInsert(state.capturedThisSession);
  }
  if (state.view === 'edit' && name !== 'edit' && sig.active) endSign(false);
  if (name !== 'doc') state.selected = null;
  state.view = name;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  closeExport();
  ['sheet-menu', 'sheet-pick', 'sheet-insert', 'sheet-text', 'sheet-sigs', 'sheet-pad', 'sheet-pass']
    .forEach(id => $(id).classList.add('hidden'));
  if (textView.busy) { textView.stop = true; ocr.cancel(); }
  bgKick();
}

function nav(view, extra = {}, mode = 'push') {
  const s = { view, docId: state.doc && state.doc.id, ...extra };
  if (mode === 'replace') history.replaceState(s, ''); else history.pushState(s, '');
  applyState(s);
}

async function applyState(s) {
  s = s || { view: 'home' };
  if (s.view === 'home') {
    setView('home');
    state.doc = null;
    state.pages = [];
    renderHome();
  } else if (s.view === 'doc' || s.view === 'edit') {
    if (!state.doc || state.doc.id !== s.docId) {
      const doc = s.docId && await db.getDoc(s.docId);
      if (!doc) { history.replaceState({ view: 'home' }, ''); return applyState({ view: 'home' }); }
      state.doc = doc;
      state.pages = await db.getPages(doc);
    }
    if (s.view === 'doc') { setView('doc'); renderDoc(); }
    else openEditor(s.index);
  } else if (s.view === 'camera') {
    setView('camera');
    startCamera();
  }
}

window.addEventListener('popstate', (e) => applyState(e.state));

function openDocView(mode = 'push') { nav('doc', {}, mode); }

function openCamera(from) {
  state.cameraFrom = from;
  state.capturedThisSession = 0;
  state.warnedNoEdges = false;
  setCamMode('doc');
  updateCamThumb();
  nav('camera');
}

// ---------------- Inicio ----------------

const urls = new Set();
function objUrl(blob) {
  const u = URL.createObjectURL(blob);
  urls.add(u);
  return u;
}
function revokeAll() {
  for (const u of urls) URL.revokeObjectURL(u);
  urls.clear();
}

let homeSeq = 0;
async function renderHome() {
  const seq = ++homeSeq;
  const docs = await db.listDocs();
  const query = $('search').value.trim();
  const results = query ? search(query, docs, await db.listTexts()) : null;
  if (seq !== homeSeq || state.view !== 'home') return; // llegó otra búsqueda o ya se salió del inicio
  revokeAll();
  const list = $('doc-list');
  list.innerHTML = '';
  $('empty').classList.toggle('hidden', docs.length > 0);
  $('search-box').classList.toggle('hidden', docs.length === 0);
  updateSearchStatus(results);
  const items = results || docs.map(doc => ({ doc, page: -1 }));
  for (const { doc, page, snip, hits } of items) {
    const card = document.createElement('button');
    card.className = 'doc-card';
    card.type = 'button';
    const img = document.createElement('img');
    img.alt = '';
    const info = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = doc.name;
    const small = document.createElement('small');
    const n = doc.pageIds.length;
    small.textContent = `${n} ${n === 1 ? 'página' : 'páginas'} · ${formatDate(doc.updated)}`;
    info.append(b, small);
    if (snip) {
      // Fragmento del texto con la palabra encontrada resaltada.
      const p = document.createElement('span');
      p.className = 'snip';
      const mark = document.createElement('mark');
      mark.textContent = snip.match;
      const more = hits > 1 ? ` (y ${hits - 1} ${hits === 2 ? 'página' : 'páginas'} más)` : '';
      p.append(`Pág. ${page + 1}: ${snip.before}`, mark, snip.after + more);
      info.append(p);
    }
    card.append(img, info);
    card.addEventListener('click', async () => {
      state.doc = doc;
      state.pages = await db.getPages(doc);
      state.highlight = page >= 0 ? doc.pageIds[page] : null;
      openDocView();
    });
    list.appendChild(card);
    const thumbId = doc.pageIds[page >= 0 ? page : 0];
    if (thumbId) db.getPage(thumbId).then(p => { if (p && p.thumb && seq === homeSeq) img.src = objUrl(p.thumb); });
  }
}

function updateSearchStatus(results) {
  const el = $('search-status');
  let msg = '';
  if (results && !results.length) msg = 'No encontré documentos con eso.';
  if (results && bg.pending > 0 && bg.on) {
    msg += `${msg ? ' ' : ''}Aún estoy leyendo el texto de ${bg.pending} ${bg.pending === 1 ? 'página' : 'páginas'}: puede haber más resultados en un momento.`;
  } else if (results && !bg.on) {
    msg += `${msg ? ' ' : ''}Solo se busca en el texto de las páginas ya leídas (activa la lectura automática abajo).`;
  }
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

let searchTimer;
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderHome, 160);
});
$('search').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

// ---------------- Vista de documento ----------------

function renderDoc() {
  if (state.view !== 'doc' || !state.doc) return;
  if (drag) { drag.rerender = true; return; } // no rehacer la cuadrícula a mitad de un arrastre
  // Páginas que quedaron sin procesar (por ejemplo, si se cerró la app mientras se procesaban).
  for (const p of state.pages) if (!p.processed && !pendingRender.has(p.id) && !failedRender.has(p.id)) queueRender(p);
  revokeAll();
  const doc = state.doc;
  if (document.activeElement !== $('doc-title')) $('doc-title').value = doc.name;
  const n = state.pages.length;
  const pending = state.pages.filter(p => !p.processed).length;
  const sel = state.selected;
  const info = $('doc-info');
  info.textContent = '';
  if (sel) {
    // Modo selección: cuántas hay y botón para elegir todas.
    info.append(`${sel.size} de ${n} seleccionadas · `);
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'link-btn';
    all.textContent = sel.size === n ? 'Quitar selección' : 'Seleccionar todas';
    all.addEventListener('click', () => {
      state.selected = new Set(sel.size === n ? [] : state.pages.map(p => p.id));
      renderDoc();
    });
    info.append(all);
  } else {
    info.textContent = `${n} ${n === 1 ? 'página' : 'páginas'}` + (pending ? ` · procesando ${pending}…`
      : n > 1 ? ' · toca para editar, mantén presionada para mover, ＋ para insertar' : ' · toca para editar, ＋ para insertar');
  }
  $('doc-bar').classList.toggle('hidden', !!sel);
  $('select-bar').classList.toggle('hidden', !sel);
  if (sel) {
    $('btn-sel-move').disabled = !sel.size;
    $('btn-sel-delete').disabled = !sel.size;
  }
  const grid = $('page-grid');
  grid.innerHTML = '';
  let hitCard = null;
  state.pages.forEach((page, i) => {
    const card = document.createElement('div');
    card.className = 'page-card' + (page.processed ? '' : ' processing') +
      (sel && sel.has(page.id) ? ' selected' : '') + (state.highlight === page.id ? ' hit' : '');
    if (state.highlight === page.id) hitCard = card;
    card.dataset.id = page.id;
    card.setAttribute('role', sel ? 'checkbox' : 'button');
    if (sel) card.setAttribute('aria-checked', String(sel.has(page.id)));
    card.tabIndex = 0;
    const img = document.createElement('img');
    img.alt = `Página ${i + 1}`;
    img.draggable = false;
    if (page.thumb) img.src = objUrl(page.thumb);
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = i + 1;
    card.append(img, num);
    if (sel) {
      const check = document.createElement('span');
      check.className = 'check';
      check.textContent = sel.has(page.id) ? '✓' : '';
      card.append(check);
    } else {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'page-add';
      add.textContent = '＋';
      add.setAttribute('aria-label', `Insertar después de la página ${i + 1}`);
      add.addEventListener('click', (e) => { e.stopPropagation(); openInsert(i + 1); });
      card.append(add);
    }
    const open = () => {
      if (state.selected) {
        if (state.selected.has(page.id)) state.selected.delete(page.id); else state.selected.add(page.id);
        return renderDoc();
      }
      if (!page.processed) return toast('Esta página aún se está procesando');
      nav('edit', { index: state.pages.indexOf(page) });
    };
    card.addEventListener('click', () => { if (!dragJustEnded()) open(); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    if (!sel) card.addEventListener('pointerdown', (e) => dragDown(card, e));
    card.addEventListener('contextmenu', (e) => e.preventDefault());
    grid.appendChild(card);
  });
  $('btn-doc-export').disabled = n === 0;
  if (hitCard) {
    // Página encontrada con el buscador: se muestra y se resalta un momento.
    state.highlight = null;
    requestAnimationFrame(() => hitCard.scrollIntoView({ block: 'center' }));
    setTimeout(() => hitCard.classList.remove('hit'), 2500);
  }
}

// ---- Reordenar: mantener presionada una página y arrastrarla ----
let drag = null;
let dragEndedAt = 0;
const dragJustEnded = () => performance.now() - dragEndedAt < 400;

function dragDown(card, e) {
  if (e.button > 0 || e.target.closest('.page-add') || state.pages.length < 2) return;
  const start = { card, id: card.dataset.id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, active: false };
  const cancel = () => {
    clearTimeout(start.timer);
    card.removeEventListener('pointermove', early);
    card.removeEventListener('pointerup', cancel);
    card.removeEventListener('pointercancel', cancel);
  };
  // Si el dedo se mueve antes de tiempo, es desplazamiento normal de la lista.
  const early = (ev) => { if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 10) cancel(); };
  card.addEventListener('pointermove', early);
  card.addEventListener('pointerup', cancel);
  card.addEventListener('pointercancel', cancel);
  start.timer = setTimeout(() => { cancel(); beginDrag(start); }, 350);
}

function beginDrag(start) {
  const { card } = start;
  const r = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.classList.add('drag-ghost');
  Object.assign(ghost.style, { width: r.width + 'px', height: r.height + 'px', left: r.left + 'px', top: r.top + 'px' });
  document.body.appendChild(ghost);
  card.classList.add('drag-placeholder');
  drag = { ...start, ghost, dx: start.x - r.left, dy: start.y - r.top, x: start.x, y: start.y, rerender: false };
  if (navigator.vibrate) navigator.vibrate(20);
  // Se escucha en todo el documento: al mover la tarjeta en la lista, el navegador suelta la
  // captura del dedo y los eventos ya no le llegarían a ella.
  document.addEventListener('pointermove', dragMove);
  document.addEventListener('pointerup', dragEnd);
  document.addEventListener('pointercancel', dragEnd);
  drag.raf = requestAnimationFrame(dragScroll);
}

// Mientras se arrastra, que el dedo no desplace la página.
document.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });

function dragMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.x = e.clientX; drag.y = e.clientY;
  drag.ghost.style.left = (e.clientX - drag.dx) + 'px';
  drag.ghost.style.top = (e.clientY - drag.dy) + 'px';
  dragPlace();
}

// Pone el hueco de la página arrastrada antes o después de la tarjeta que está bajo el dedo.
function dragPlace() {
  const target = document.elementFromPoint(drag.x, drag.y);
  const over = target && target.closest('.page-card');
  if (!over || over === drag.card || over.classList.contains('drag-ghost')) return;
  const r = over.getBoundingClientRect();
  const after = drag.x > r.left + r.width / 2;
  $('page-grid').insertBefore(drag.card, after ? over.nextSibling : over);
}

// Desplaza la lista sola cuando el dedo llega al borde de arriba o de abajo.
function dragScroll() {
  if (!drag) return;
  const grid = $('page-grid'), r = grid.getBoundingClientRect(), zone = 70, before = grid.scrollTop;
  if (drag.y < r.top + zone) grid.scrollTop -= Math.ceil((r.top + zone - drag.y) / 6);
  else if (drag.y > r.bottom - zone) grid.scrollTop += Math.ceil((drag.y - (r.bottom - zone)) / 6);
  if (grid.scrollTop !== before) dragPlace(); // la lista se movió bajo el dedo quieto
  drag.raf = requestAnimationFrame(dragScroll);
}

async function dragEnd(e) {
  if (!drag || (e && e.pointerId !== drag.pointerId)) return;
  const d = drag;
  drag = null;
  dragEndedAt = performance.now();
  cancelAnimationFrame(d.raf);
  d.ghost.remove();
  d.card.classList.remove('drag-placeholder');
  document.removeEventListener('pointermove', dragMove);
  document.removeEventListener('pointerup', dragEnd);
  document.removeEventListener('pointercancel', dragEnd);
  const order = [...$('page-grid').querySelectorAll('.page-card')].map(c => c.dataset.id);
  const byId = new Map(state.pages.map(p => [p.id, p]));
  const moved = order.join() !== state.doc.pageIds.join();
  state.pages = order.map(id => byId.get(id)).filter(Boolean);
  state.doc.pageIds = state.pages.map(p => p.id);
  renderDoc();
  if (moved) {
    await db.putDoc(state.doc);
    toast(`Página movida a la posición ${state.doc.pageIds.indexOf(d.id) + 1}`, 1500);
  }
}

// ---- Insertar páginas después de una página ----
function openInsert(at) {
  state.pendingInsert = at;
  $('insert-title').textContent = `Insertar después de la página ${at}`;
  $('sheet-insert').classList.remove('hidden');
}
const closeInsert = () => $('sheet-insert').classList.add('hidden');
$('btn-insert-cam').addEventListener('click', () => {
  closeInsert();
  openCamera('doc');
  state.insertAt = state.pendingInsert;
});
$('btn-insert-file').addEventListener('click', () => {
  closeInsert();
  state.insertAt = state.pendingInsert;
  $('file-input').click();
});
$('btn-insert-cancel').addEventListener('click', closeInsert);
$('sheet-insert').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeInsert(); });

function onPageReady(page) {
  if (state.view === 'doc') renderDoc();
  if (state.view === 'camera') updateCamThumb(page);
  if (state.view === 'edit' && edit.page === page && !sig.active && !edit.cropping) { showResult(); updateEditHeader(); }
  bgKick();
}

$('doc-title').addEventListener('change', async (e) => {
  if (!state.doc) return;
  state.doc.name = e.target.value.trim() || defaultName();
  state.doc.autoName = false; // el nombre lo puso la persona: ya no se cambia solo
  e.target.value = state.doc.name;
  await db.putDoc(state.doc);
});
$('doc-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

$('btn-doc-back').addEventListener('click', () => {
  if (state.selected) return endSelect();
  history.back();
});

// ---- Menú del documento ----
const sheet = (id, on) => $(id).classList.toggle('hidden', !on);
$('btn-doc-menu').addEventListener('click', () => sheet('sheet-menu', true));
$('sheet-menu').addEventListener('click', (e) => { if (e.target === e.currentTarget) sheet('sheet-menu', false); });
$('m-cancel').addEventListener('click', () => sheet('sheet-menu', false));
$('m-delete').addEventListener('click', async () => {
  sheet('sheet-menu', false);
  if (!state.doc || !confirm(`¿Eliminar "${state.doc.name}"?`)) return;
  await db.deleteDoc(state.doc);
  state.doc = null;
  nav('home', {}, 'replace');
  toast('Documento eliminado');
});
$('m-select').addEventListener('click', () => {
  sheet('sheet-menu', false);
  if (!state.pages.length) return toast('Este documento no tiene páginas');
  state.selected = new Set();
  renderDoc();
});
$('m-text').addEventListener('click', () => {
  sheet('sheet-menu', false);
  openText('doc');
});
$('m-merge').addEventListener('click', async () => {
  sheet('sheet-menu', false);
  const other = await pickDoc('Unir a este documento', false);
  if (!other) return;
  const what = other.pageIds.length === 1 ? 'La página' : `Las ${other.pageIds.length} páginas`;
  if (!confirm(`${what} de "${other.name}" ${other.pageIds.length === 1 ? 'pasará' : 'pasarán'} al final de "${state.doc.name}" ` +
    `y "${other.name}" dejará de existir como documento aparte. ¿Continuar?`)) return;
  const pages = await db.getPages(other);
  const doc = state.doc;
  const before = doc.pageIds.length;
  doc.pageIds.push(...pages.map(p => p.id));
  other.pageIds = [];
  await db.movePages(pages, other, doc);
  state.pages.push(...pages);
  renderDoc();
  const added = doc.pageIds.length - before;
  toast(`Se unió "${other.name}": ${added === 1 ? `página ${before + 1}` : `páginas ${before + 1} a ${doc.pageIds.length}`}.`, 4000);
  bgKick();
});

// ---- Seleccionar páginas: mover a otro documento o eliminar varias ----
function endSelect() {
  state.selected = null;
  renderDoc();
}
$('btn-sel-cancel').addEventListener('click', endSelect);
$('btn-sel-delete').addEventListener('click', async () => {
  const ids = state.selected;
  if (!ids || !ids.size) return;
  if (!confirm(ids.size === 1 ? '¿Eliminar la página seleccionada?' : `¿Eliminar las ${ids.size} páginas seleccionadas?`)) return;
  state.pages = state.pages.filter(p => !ids.has(p.id));
  state.doc.pageIds = state.pages.map(p => p.id);
  for (const id of ids) await db.deletePage(id);
  await db.putDoc(state.doc);
  toast(ids.size === 1 ? 'Página eliminada' : `${ids.size} páginas eliminadas`);
  endSelect();
});
$('btn-sel-move').addEventListener('click', async () => {
  const ids = state.selected;
  if (!ids || !ids.size) return;
  const picked = await pickDoc(ids.size === 1 ? 'Mover la página a…' : `Mover ${ids.size} páginas a…`, true);
  if (!picked) return;
  const target = picked === 'new' ? newDoc() : picked;
  const from = state.doc;
  const moving = state.pages.filter(p => ids.has(p.id));
  target.pageIds.push(...moving.map(p => p.id));
  state.pages = state.pages.filter(p => !ids.has(p.id));
  from.pageIds = state.pages.map(p => p.id);
  await db.movePages(moving, from, target);
  const msg = `${moving.length === 1 ? 'Se movió 1 página' : `Se movieron ${moving.length} páginas`} a "${target.name}".`;
  state.selected = null;
  if (picked === 'new') {
    // Un documento nuevo toma su nombre del texto de su primera página, si ya se leyó.
    if (hasOcr(moving[0])) await maybeAutoName(moving[0]);
  }
  if (!from.pageIds.length) {
    // No quedó nada: se abre el documento al que se pasaron.
    state.doc = await db.getDoc(target.id);
    state.pages = await db.getPages(state.doc);
    nav('doc', {}, 'replace');
    toast(msg + ' Este documento quedó vacío y se eliminó.', 5000);
  } else {
    renderDoc();
    toast(msg, 3500);
  }
});

// Elegir otro documento (o uno nuevo). Devuelve el documento, 'new' o null.
function pickDoc(title, allowNew) {
  return new Promise(async (resolve) => {
    $('pick-title').textContent = title;
    const list = $('pick-list');
    list.innerHTML = '';
    const urls = [];
    const cancel = () => done(null);
    const done = (v) => {
      prompts.delete(cancel);
      sheet('sheet-pick', false);
      $('btn-pick-cancel').onclick = null;
      $('sheet-pick').onclick = null;
      urls.forEach(u => URL.revokeObjectURL(u));
      resolve(v);
    };
    if (allowNew) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'doc-card new';
      b.textContent = '+ Documento nuevo';
      b.addEventListener('click', () => done('new'));
      list.append(b);
    }
    const docs = (await db.listDocs()).filter(d => !state.doc || d.id !== state.doc.id);
    if (!docs.length && !allowNew) {
      done(null);
      return toast('No tienes otros documentos para unir');
    }
    for (const doc of docs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'doc-card';
      const img = document.createElement('img');
      img.alt = '';
      const info = document.createElement('div');
      const name = document.createElement('b');
      name.textContent = doc.name;
      const small = document.createElement('small');
      small.textContent = `${doc.pageIds.length} ${doc.pageIds.length === 1 ? 'página' : 'páginas'} · ${formatDate(doc.updated)}`;
      info.append(name, small);
      b.append(img, info);
      b.addEventListener('click', () => done(doc));
      list.append(b);
      if (doc.pageIds[0]) db.getPage(doc.pageIds[0]).then(p => {
        if (p && p.thumb) { const u = URL.createObjectURL(p.thumb); urls.push(u); img.src = u; }
      });
    }
    $('btn-pick-cancel').onclick = cancel;
    $('sheet-pick').onclick = (e) => { if (e.target === e.currentTarget) done(null); };
    prompts.add(cancel);
    sheet('sheet-pick', true);
  });
}

$('btn-doc-cam').addEventListener('click', () => { state.insertAt = null; openCamera('doc'); });
$('btn-doc-import').addEventListener('click', () => { state.insertAt = null; $('file-input').click(); });
$('btn-doc-export').addEventListener('click', () => openExport());

// ---------------- Cámara ----------------

let stream = null;
let liveTimer = null;
let liveCorners = null;
let liveAt = 0;
const auto = { on: store.get('auto', false), stableSince: 0, last: null, armed: true, lastShot: 0 };

async function startCamera() {
  $('cam-error').classList.add('hidden');
  $('cam-hint').textContent = 'Apunta al documento';
  updateAutoBtn();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return cameraFailed();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
    });
  } catch (err) {
    console.warn(err);
    return cameraFailed();
  }
  if (state.view !== 'camera') return stopCamera();
  const video = $('video');
  video.srcObject = stream;
  try { await video.play(); } catch { /* autoplay */ }
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  $('btn-torch').classList.toggle('hidden', !caps.torch);
  $('btn-torch').setAttribute('aria-pressed', 'false');
  $('btn-torch').textContent = 'Flash: NO';
  if (caps.focusMode && caps.focusMode.includes('continuous')) {
    track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  }
  liveLoop();
}

function cameraFailed() {
  $('cam-error').classList.remove('hidden');
  $('cam-hint').textContent = '';
}

function stopCamera() {
  clearTimeout(liveTimer);
  liveTimer = null;
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  $('video').srcObject = null;
  liveCorners = null;
  const o = $('overlay');
  o.getContext('2d').clearRect(0, 0, o.width, o.height);
}

function videoRect() {
  const video = $('video');
  const cw = video.clientWidth, ch = video.clientHeight;
  const vw = video.videoWidth, vh = video.videoHeight;
  const s = Math.min(cw / vw, ch / vh);
  return { x: (cw - vw * s) / 2, y: (ch - vh * s) / 2, w: vw * s, h: vh * s };
}

const maxShift = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));

const NO_EDGE_HINT = 'No veo los bordes: pon la hoja sobre algo más oscuro, o toma la foto y ajusta las esquinas después';

function liveLoop() {
  const video = $('video');
  const started = performance.now();
  let lastSeen = 0;
  const tick = () => {
    if (!stream || state.view !== 'camera') return;
    if (video.videoWidth) {
      // La tarjeta ocupa menos de la imagen que una hoja: se mira con un poco más de detalle.
      const small = drawScaled(video, video.videoWidth, video.videoHeight, idc.on ? LIVE_SIZE_CARD : LIVE_SIZE);
      const found = detectDocument(getData(small), { card: idc.on });
      const now = performance.now();
      if (found) {
        // Suavizado para que el contorno no tiemble.
        liveCorners = liveCorners && maxShift(found, liveCorners) < 0.08
          ? liveCorners.map((p, i) => [p[0] * 0.5 + found[i][0] * 0.5, p[1] * 0.5 + found[i][1] * 0.5])
          : found;
        liveAt = now;
      } else if (now - liveAt > 400) {
        liveCorners = null;
      }
      drawOverlay();
      if (found) lastSeen = now;
      // Consejo si no se ve la hoja hace rato (típico: hoja blanca sobre mesa blanca).
      if (!auto.on) {
        $('cam-hint').textContent = found ? idStep() : now - Math.max(started, lastSeen) > 3000 ? noEdgeHint() : aimHint();
      }
      autoCapture(found, now);
    }
    liveTimer = setTimeout(tick, 110);
  };
  tick();
}

function drawOverlay() {
  const o = $('overlay');
  const dpr = window.devicePixelRatio || 1;
  const w = o.clientWidth * dpr, h = o.clientHeight * dpr;
  if (o.width !== w || o.height !== h) { o.width = w; o.height = h; }
  const ctx = o.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!liveCorners) return;
  const r = videoRect();
  ctx.beginPath();
  liveCorners.forEach(([x, y], i) => {
    const px = (r.x + x * r.w) * dpr, py = (r.y + y * r.h) * dpr;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  });
  ctx.closePath();
  ctx.fillStyle = 'rgba(28, 92, 255, 0.22)';
  ctx.fill();
  ctx.lineWidth = 3 * dpr;
  ctx.strokeStyle = auto.on && auto.stableSince ? '#ffd23f' : '#4d7dff';
  ctx.stroke();
}

function autoCapture(found, now) {
  if (!auto.on) return;
  if (!found || polyArea(found) < (idc.on ? 0.08 : 0.2)) {
    auto.stableSince = 0;
    auto.last = null;
    if (!found) auto.armed = true;
    $('cam-hint').textContent = found ? 'Acércate un poco más' : now - liveAt > 3000 ? noEdgeHint() : aimHint();
    return;
  }
  if (!auto.armed) {
    // Espera a que cambie la hoja (se pierde la detección o se mueve bastante).
    if (auto.lastShotCorners && maxShift(found, auto.lastShotCorners) > 0.12) auto.armed = true;
    $('cam-hint').textContent = idc.on ? 'Voltea la tarjeta' : 'Cambia de hoja';
    return;
  }
  if (auto.last && maxShift(found, auto.last) < 0.025) {
    if (!auto.stableSince) auto.stableSince = now;
    $('cam-hint').textContent = 'Quieto…';
    if (now - auto.stableSince > 900 && now - auto.lastShot > 1500) {
      auto.lastShot = now;
      auto.armed = false;
      auto.lastShotCorners = found;
      auto.stableSince = 0;
      capture();
    }
  } else {
    auto.stableSince = 0;
    $('cam-hint').textContent = idc.on ? `${idStep()} · Mantén el teléfono quieto` : 'Mantén el teléfono quieto';
  }
  auto.last = found;
}

function updateAutoBtn() {
  const b = $('btn-auto');
  b.setAttribute('aria-pressed', String(auto.on));
  b.textContent = auto.on ? 'Auto: SÍ' : 'Auto: NO';
}

let capturing = false;
let captureDone = Promise.resolve(); // se cumple cuando termina la foto en curso
async function capture() {
  const video = $('video');
  if (capturing || !stream || !video.videoWidth) return;
  capturing = true;
  let release;
  captureDone = new Promise(r => { release = r; });
  $('btn-shutter').classList.add('busy');
  const fx = $('flash-fx');
  fx.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => fx.classList.remove('on')));
  if (navigator.vibrate) navigator.vibrate(30);
  try {
    const canvas = drawScaled(video, video.videoWidth, video.videoHeight, MAX_ORIGINAL);
    let corners = detectOn(canvas, { card: idc.on });
    if (!corners && liveCorners && performance.now() - liveAt < 600) corners = liveCorners;
    if (idc.on) return await captureCard(canvas, corners);
    if (!corners && !state.warnedNoEdges) {
      state.warnedNoEdges = true;
      toast('No encontré los bordes de la hoja: se guardó la foto completa. Toca la página después y usa Recortar.', 6000);
    }
    await addPage(canvas, corners);
    state.capturedThisSession++;
    updateCamThumb();
  } catch (err) {
    console.error(err);
    toast('No se pudo capturar: ' + err.message);
  } finally {
    capturing = false;
    $('btn-shutter').classList.remove('busy');
    release();
  }
}

function updateCamThumb(page) {
  const n = state.capturedThisSession;
  $('cam-count').textContent = n;
  $('cam-count').classList.toggle('hidden', n === 0);
  const img = $('cam-thumb-img');
  if (n === 0) { img.removeAttribute('src'); return; }
  const last = page || state.lastAdded;
  if (last && last.thumb && last === state.lastAdded) {
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(last.thumb);
  }
}

// ---- Modo cédula: frente y reverso en una sola hoja ----
const idc = { on: false, sides: [], scale: store.get('idScale', 1) };
const idStep = () => (!idc.on ? '' : idc.sides.length ? 'Ahora la cara de atrás (2 de 2)' : 'Cara frontal de la tarjeta (1 de 2)');
const aimHint = () => (idc.on ? `${idStep()}: ponla sobre algo oscuro y que se vea completa` : 'Apunta al documento');
const noEdgeHint = () => (idc.on ? 'No veo la tarjeta: ponla sobre una superficie oscura, sin reflejos' : NO_EDGE_HINT);
const idSizeLabel = () => (idc.scale > 1 ? 'Ampliada 150 %' : 'Tamaño real');

function setCamMode(mode) {
  idc.on = mode === 'id';
  idc.sides = [];
  document.querySelectorAll('.cam-modes button').forEach(b => b.classList.toggle('selected', b.dataset.mode === mode));
  $('btn-idsize').classList.toggle('hidden', !idc.on);
  $('btn-idsize').textContent = idSizeLabel();
  $('cam-hint').textContent = aimHint();
  auto.armed = true;
}
document.querySelector('.cam-modes').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.classList.contains('selected')) return;
  if (idc.sides.length && !confirm('Se descartará la cara frontal que ya tomaste. ¿Cambiar de modo?')) return;
  setCamMode(b.dataset.mode);
  if (idc.on) toast('Modo cédula: toma el frente y luego el reverso; quedan juntos en una hoja.', 4000);
});
$('btn-idsize').addEventListener('click', () => {
  idc.scale = idc.scale > 1 ? 1 : 1.5;
  store.set('idScale', idc.scale);
  $('btn-idsize').textContent = idSizeLabel();
  toast(idc.scale > 1 ? 'Las caras se ampliarán al 150 % (lo que suelen pedir para trámites)' : 'Las caras quedarán a tamaño real');
});

async function captureCard(canvas, corners) {
  if (!corners) {
    return toast('No encontré la tarjeta. Ponla sobre una superficie oscura, que se vea completa, y vuelve a intentarlo.', 5000);
  }
  // Recorte de la tarjeta con color mejorado.
  const out = await runProcess(getData(canvas), corners, 'enhance', 0);
  if (!looksLikeCard(out.width, out.height)) {
    return toast('Eso no parece una tarjeta completa: encuádrala entera, sin cortar los bordes.', 5000);
  }
  const card = makeCanvas(out.width, out.height);
  card.getContext('2d').putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
  idc.sides.push(card);
  if (idc.sides.length === 1) {
    const thumb = await canvasToBlob(drawScaled(card, card.width, card.height, 240), 'image/jpeg', 0.8);
    const img = $('cam-thumb-img');
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(thumb);
    $('cam-hint').textContent = idStep();
    return toast('Frente listo. Ahora voltea la tarjeta y toma el reverso.', 3500);
  }
  await saveIdPage();
  toast('Listo: las dos caras quedaron juntas en una página.', 3500);
}

async function saveIdPage() {
  const sides = idc.sides;
  idc.sides = [];
  $('cam-hint').textContent = aimHint();
  await addPage(composeIdPage(sides, idc.scale), FULL_FRAME, { filter: 'original', source: 'id' });
  state.capturedThisSession++;
  updateCamThumb();
}

let finishing = false;
async function finishCamera() {
  if (finishing || state.view !== 'camera') return; // doble toque
  finishing = true;
  try {
    await captureDone; // que termine la foto que se está procesando (p. ej. el reverso de la cédula)
    if (idc.on && idc.sides.length) {
      // Solo se tomó el frente: se guarda así.
      await saveIdPage();
      toast('Se guardó solo la cara frontal.', 3000);
    }
    if (state.cameraFrom === 'doc') history.back();
    else if (state.capturedThisSession > 0) openDocView('replace');
    else history.back();
  } finally {
    finishing = false;
  }
}

$('btn-shutter').addEventListener('click', capture);
$('btn-cam-done').addEventListener('click', finishCamera);
$('btn-cam-thumb').addEventListener('click', () => { if (state.capturedThisSession) finishCamera(); });
$('btn-cam-close').addEventListener('click', finishCamera);
$('btn-auto').addEventListener('click', () => {
  auto.on = !auto.on;
  auto.armed = true;
  auto.stableSince = 0;
  store.set('auto', auto.on);
  updateAutoBtn();
  toast(auto.on ? 'Disparo automático: toma la foto cuando la hoja esté quieta' : 'Disparo automático desactivado');
});
$('btn-torch').addEventListener('click', async () => {
  const b = $('btn-torch');
  const on = b.getAttribute('aria-pressed') !== 'true';
  try {
    await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: on }] });
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? 'Flash: SÍ' : 'Flash: NO';
  } catch { toast('No se pudo usar el flash'); }
});
$('btn-native-cam').addEventListener('click', () => $('native-cam-input').click());
// Teclas de volumen / espacio como disparador (útil con palos selfie o teclados).
document.addEventListener('keydown', (e) => {
  if (state.view === 'camera' && (e.key === ' ' || e.key === 'Enter' || e.key === 'AudioVolumeUp' || e.key === 'AudioVolumeDown')) {
    e.preventDefault();
    capture();
  }
});

// ---------------- Editor de página ----------------

const edit = { page: null, source: null, preview: null, cropping: false, corners: null, drag: null };

async function openEditor(index) {
  const page = state.pages[index];
  if (!page) return openDocView('replace');
  state.editIndex = index;
  if (sig.active) endSign(false);
  setView('edit');
  edit.page = page;
  edit.source = null;
  edit.preview = null;
  setCropMode(false);
  showResult();
  updateEditHeader();
}

function updateEditHeader() {
  const n = state.pages.length, i = state.editIndex;
  $('edit-title').textContent = `Página ${i + 1} de ${n}`;
  document.querySelectorAll('#filters button').forEach(b =>
    b.classList.toggle('selected', b.dataset.filter === edit.page.filter));
}

function showResult() {
  const img = $('edit-result');
  if (img.src) URL.revokeObjectURL(img.src);
  img.src = edit.page.processed ? URL.createObjectURL(edit.page.processed) : '';
}

async function loadSource() {
  const page = edit.page;
  if (!edit.source || edit.sourcePage !== page) {
    const bmp = await decodeBlob(page.original);
    const full = drawScaled(bmp, page.ow, page.oh, MAX_ORIGINAL);
    bmp.close && bmp.close();
    const data = getData(full);
    // Si mientras tanto se abrió otra página, esta foto no se guarda como la del editor.
    if (edit.page !== page) return data;
    edit.source = data;
    edit.preview = drawScaled(full, full.width, full.height, 1400);
    edit.sourcePage = page;
  }
  return edit.source;
}

async function reprocess() {
  const busy = $('edit-busy');
  busy.classList.remove('hidden');
  try {
    const page = edit.page;
    await renderPage(page, await loadSource());
    if (edit.page === page) showResult();
  } catch (err) {
    console.error(err);
    toast('Error: ' + err.message);
  } finally {
    busy.classList.add('hidden');
  }
}

$('filters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !edit.page || b.dataset.filter === edit.page.filter) return;
  edit.page.filter = b.dataset.filter;
  store.set('filter', b.dataset.filter);
  updateEditHeader();
  reprocess();
});
// Girar a mano: desde entonces la app no endereza sola esa página.
const turn = (k) => { edit.page.rotation = (edit.page.rotation + k) % 4; edit.page.userRotated = true; reprocess(); };
$('btn-rot-l').addEventListener('click', () => turn(3));
$('btn-rot-r').addEventListener('click', () => turn(1));
$('btn-edit-back').addEventListener('click', () => {
  if (edit.cropping) return setCropMode(false);
  if (sig.active) return endSign(false);
  history.back();
});

$('btn-page-delete').addEventListener('click', async () => {
  if (!confirm('¿Eliminar esta página?')) return;
  const page = edit.page;
  state.pages = state.pages.filter(p => p !== page);
  state.doc.pageIds = state.pages.map(p => p.id);
  await db.deletePage(page.id);
  await db.putDoc(state.doc);
  toast('Página eliminada');
  history.back();
});

// --- Recorte manual ---

function setCropMode(on) {
  edit.cropping = on;
  $('crop-canvas').classList.toggle('hidden', !on);
  $('edit-result').classList.toggle('hidden', on);
  $('crop-tools').classList.toggle('hidden', !on);
  $('edit-tools').classList.toggle('hidden', on);
  if (on) drawCrop();
}

$('btn-crop').addEventListener('click', async () => {
  const page = edit.page;
  $('edit-busy').classList.remove('hidden');
  try { await loadSource(); } finally { $('edit-busy').classList.add('hidden'); }
  if (edit.page !== page || state.view !== 'edit') return;
  edit.corners = edit.page.corners.map(p => p.slice());
  setCropMode(true);
});

function cropGeometry() {
  const c = $('crop-canvas');
  const dpr = window.devicePixelRatio || 1;
  const W = c.clientWidth, H = c.clientHeight;
  const pad = 28;
  const iw = edit.preview.width, ih = edit.preview.height;
  const s = Math.min((W - pad * 2) / iw, (H - pad * 2) / ih);
  return { dpr, W, H, s, ox: (W - iw * s) / 2, oy: (H - ih * s) / 2, iw: iw * s, ih: ih * s };
}

function drawCrop() {
  if (!edit.cropping || !edit.preview) return;
  const c = $('crop-canvas');
  const g = cropGeometry();
  if (c.width !== Math.round(g.W * g.dpr) || c.height !== Math.round(g.H * g.dpr)) {
    c.width = Math.round(g.W * g.dpr);
    c.height = Math.round(g.H * g.dpr);
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
  ctx.clearRect(0, 0, g.W, g.H);
  ctx.drawImage(edit.preview, g.ox, g.oy, g.iw, g.ih);
  const pts = edit.corners.map(([x, y]) => [g.ox + x * g.iw, g.oy + y * g.ih]);
  // Oscurece lo que queda fuera del recorte.
  ctx.beginPath();
  ctx.rect(g.ox, g.oy, g.iw, g.ih);
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fill('evenodd');
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#4d7dff';
  ctx.stroke();
  pts.forEach(([x, y], i) => {
    ctx.beginPath();
    ctx.arc(x, y, edit.drag && edit.drag.i === i ? 16 : 13, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(77,125,255,0.35)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  });
  // Lupa mientras se arrastra una esquina.
  if (edit.drag) {
    const [px, py] = pts[edit.drag.i];
    const R = 56, zoom = 2.5;
    const cx = px < g.W / 2 ? g.W - R - 12 : R + 12, cy = R + 12;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    const sx = (px - g.ox) / g.s, sy = (py - g.oy) / g.s;
    const half = R / (g.s * zoom);
    ctx.drawImage(edit.preview, sx - half, sy - half, half * 2, half * 2, cx - R, cy - R, R * 2, R * 2);
    ctx.strokeStyle = '#4d7dff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
}

const cropCanvas = $('crop-canvas');
cropCanvas.addEventListener('pointerdown', (e) => {
  const g = cropGeometry();
  const r = cropCanvas.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  let best = -1, bd = 48;
  edit.corners.forEach(([cx, cy], i) => {
    const d = Math.hypot(g.ox + cx * g.iw - x, g.oy + cy * g.ih - y);
    if (d < bd) { bd = d; best = i; }
  });
  if (best < 0) return;
  const [cx, cy] = edit.corners[best];
  edit.drag = { i: best, dx: g.ox + cx * g.iw - x, dy: g.oy + cy * g.ih - y };
  cropCanvas.setPointerCapture(e.pointerId);
  drawCrop();
});
cropCanvas.addEventListener('pointermove', (e) => {
  if (!edit.drag) return;
  const g = cropGeometry();
  const r = cropCanvas.getBoundingClientRect();
  const x = e.clientX - r.left + edit.drag.dx, y = e.clientY - r.top + edit.drag.dy;
  edit.corners[edit.drag.i] = [
    Math.min(1, Math.max(0, (x - g.ox) / g.iw)),
    Math.min(1, Math.max(0, (y - g.oy) / g.ih)),
  ];
  drawCrop();
});
const endDrag = () => { if (edit.drag) { edit.drag = null; drawCrop(); } };
cropCanvas.addEventListener('pointerup', endDrag);
cropCanvas.addEventListener('pointercancel', endDrag);
window.addEventListener('resize', () => { drawCrop(); drawOverlay(); });

$('btn-crop-auto').addEventListener('click', () => {
  const found = detectOn(edit.preview);
  if (found) { edit.corners = found; drawCrop(); } else toast('No encontré los bordes; ajústalos a mano');
});
$('btn-crop-full').addEventListener('click', () => { edit.corners = FULL_FRAME.map(p => p.slice()); drawCrop(); });
$('btn-crop-ok').addEventListener('click', async () => {
  const ordered = orderCorners(edit.corners);
  if (polyArea(ordered) < 0.01) return toast('El recorte es demasiado pequeño');
  edit.page.corners = ordered;
  setCropMode(false);
  await reprocess();
});

// ---------------- Firmas ----------------
// Las firmas se colocan sobre la página (se pueden mover, agrandar y quitar) y se estampan en la
// imagen final. Se guardan en la página aparte, así se conservan al cambiar el filtro o girarla.

const sig = { active: false, marks: [], urls: [] };
const MAX_SIGS = 6;

$('btn-sign').addEventListener('click', () => { if (edit.page && edit.page.processed && !sig.active) startSign(); });

async function startSign() {
  const page = edit.page;
  const busy = $('edit-busy');
  busy.classList.remove('hidden');
  try {
    // De fondo, la página sin firmas: las firmas se muestran encima para poder moverlas.
    const c = await plainCanvas(page, await loadSource());
    if (edit.page !== page || state.view !== 'edit') return;
    const img = $('edit-result');
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(await canvasToBlob(c, 'image/jpeg', 0.85));
    await img.decode().catch(() => {});
  } catch (err) {
    console.error(err);
    return toast('Error: ' + err.message);
  } finally {
    busy.classList.add('hidden');
  }
  if (edit.page !== page || state.view !== 'edit') return;
  sig.active = true;
  sig.marks = (page.marks || []).map(m => ({ ...m }));
  $('edit-tools').classList.add('hidden');
  $('sign-tools').classList.remove('hidden');
  $('sign-layer').classList.remove('hidden');
  renderMarks();
  if (!sig.marks.length) {
    const blob = await chooseSignature();
    if (!blob) return endSign(false);
    await addMark(blob);
  }
}

async function endSign(apply) {
  if (!sig.active) return;
  sig.active = false;
  $('sign-layer').classList.add('hidden');
  $('sign-layer').innerHTML = '';
  sig.urls.forEach(u => URL.revokeObjectURL(u));
  sig.urls = [];
  $('sign-tools').classList.add('hidden');
  $('edit-tools').classList.remove('hidden');
  if (!apply) return showResult();
  const had = (edit.page.marks || []).length;
  edit.page.marks = sig.marks;
  await reprocess();
  toast(sig.marks.length ? (sig.marks.length === 1 ? 'Firma lista' : `${sig.marks.length} firmas listas`)
    : had ? 'Firma quitada' : 'Sin firma', 2000);
  bgKick();
}

$('btn-sign-ok').addEventListener('click', () => endSign(true));
$('btn-sign-add').addEventListener('click', async () => {
  const blob = await chooseSignature();
  if (blob) await addMark(blob);
});

// Nueva firma centrada abajo, a un tercio del ancho de la página, derecha tal como se ve.
async function addMark(blob) {
  const bmp = await createImageBitmap(blob);
  const ar = bmp.width / bmp.height;
  bmp.close && bmp.close();
  const page = edit.page, r = page.rotation;
  const W = page.width, H = page.height;
  const [cx, cy] = fromView(0.5, 0.8, r);
  sig.marks.push({ blob, ar, cx, cy, w: (0.34 * W) / Math.max(W, H), rot: (4 - r) % 4 });
  renderMarks();
}

function layerBox() {
  const img = $('edit-result'), stage = $('edit-stage'), layer = $('sign-layer');
  const ir = img.getBoundingClientRect(), sr = stage.getBoundingClientRect();
  Object.assign(layer.style, {
    left: ir.left - sr.left + 'px', top: ir.top - sr.top + 'px', width: ir.width + 'px', height: ir.height + 'px',
  });
  return { w: ir.width, h: ir.height };
}

function placeMark(el, m, box) {
  const r = edit.page.rotation;
  const [X, Y] = toView(m.cx, m.cy, r);
  const sw = m.w * Math.max(box.w, box.h), sh = sw / m.ar;
  Object.assign(el.style, {
    left: X * box.w - sw / 2 + 'px', top: Y * box.h - sh / 2 + 'px', width: sw + 'px', height: sh + 'px',
    transform: `rotate(${((m.rot + r) % 4) * 90}deg)`,
  });
}

function renderMarks() {
  if (!sig.active) return;
  const layer = $('sign-layer');
  layer.innerHTML = '';
  sig.urls.forEach(u => URL.revokeObjectURL(u));
  sig.urls = [];
  const box = layerBox();
  sig.marks.forEach((m) => {
    const el = document.createElement('div');
    el.className = 'sig-mark';
    const img = document.createElement('img');
    const u = URL.createObjectURL(m.blob);
    sig.urls.push(u);
    img.src = u;
    img.alt = 'Firma';
    const resize = document.createElement('span');
    resize.className = 'sig-resize';
    resize.textContent = '⤡';
    resize.setAttribute('aria-label', 'Cambiar tamaño');
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sig-del';
    del.textContent = '×';
    del.setAttribute('aria-label', 'Quitar firma');
    del.addEventListener('pointerdown', (e) => e.stopPropagation());
    del.addEventListener('click', () => { sig.marks.splice(sig.marks.indexOf(m), 1); renderMarks(); });
    el.append(img, resize, del);
    placeMark(el, m, box);
    // Mover (arrastrando la firma) o cambiar tamaño (arrastrando el círculo de la esquina).
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const r = edit.page.rotation;
      const [X0, Y0] = toView(m.cx, m.cy, r);
      const lr = layer.getBoundingClientRect();
      const center = [lr.left + X0 * box.w, lr.top + Y0 * box.h];
      const start = { x: e.clientX, y: e.clientY, w: m.w, d: Math.hypot(e.clientX - center[0], e.clientY - center[1]) };
      const resizing = e.target === resize;
      const move = (ev) => {
        let X = X0, Y = Y0;
        if (resizing) {
          const d = Math.hypot(ev.clientX - center[0], ev.clientY - center[1]);
          m.w = Math.min(0.95, Math.max(0.04, start.w * d / Math.max(8, start.d)));
        } else {
          X = X0 + (ev.clientX - start.x) / box.w;
          Y = Y0 + (ev.clientY - start.y) / box.h;
        }
        // Que la firma no se salga de la hoja (si es más grande que la hoja, queda centrada).
        const sw = m.w * Math.max(box.w, box.h), sh = sw / m.ar;
        const odd = (m.rot + r) % 2 === 1;
        const hx = (odd ? sh : sw) / 2 / box.w, hy = (odd ? sw : sh) / 2 / box.h;
        X = Math.min(Math.max(X, Math.min(hx, 0.5)), Math.max(1 - hx, 0.5));
        Y = Math.min(Math.max(Y, Math.min(hy, 0.5)), Math.max(1 - hy, 0.5));
        [m.cx, m.cy] = fromView(X, Y, r);
        placeMark(el, m, box);
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    layer.append(el);
  });
}
window.addEventListener('resize', () => { if (sig.active) renderMarks(); });

// ---- Elegir, dibujar o fotografiar una firma ----

async function saveSignature(blob) {
  await db.putMeta({ id: 'sig:' + db.uid(), blob, created: Date.now() });
  const all = await db.listMeta('sig:');
  for (const old of all.slice(MAX_SIGS)) await db.deleteMeta(old.id);
}

function chooseSignature() {
  return new Promise(async (resolve) => {
    const list = $('sig-list');
    const urls = [];
    const cancel = () => done(null);
    const done = (blob) => {
      prompts.delete(cancel);
      sheet('sheet-sigs', false);
      urls.forEach(u => URL.revokeObjectURL(u));
      $('btn-sig-draw').onclick = $('btn-sig-photo').onclick = $('btn-sigs-cancel').onclick = null;
      resolve(blob);
    };
    const fill = async () => {
      list.innerHTML = '';
      const saved = await db.listMeta('sig:');
      list.classList.toggle('hidden', !saved.length);
      $('sigs-title').textContent = saved.length ? 'Elige tu firma' : 'Agrega tu firma';
      for (const s of saved) {
        const b = document.createElement('div');
        b.className = 'sig-item';
        b.setAttribute('role', 'button');
        b.tabIndex = 0;
        b.setAttribute('aria-label', 'Usar esta firma');
        const img = document.createElement('img');
        const u = URL.createObjectURL(s.blob);
        urls.push(u);
        img.src = u;
        img.alt = '';
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'sig-del';
        del.textContent = '×';
        del.setAttribute('aria-label', 'Borrar esta firma guardada');
        del.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('¿Borrar esta firma guardada? (no se quita de las páginas ya firmadas)')) return;
          await db.deleteMeta(s.id);
          fill();
        });
        b.append(img, del);
        b.addEventListener('click', () => done(s.blob));
        list.append(b);
      }
    };
    await fill();
    $('btn-sig-draw').onclick = async () => {
      prompts.delete(cancel);
      sheet('sheet-sigs', false);
      const blob = await drawSignature();
      if (blob) await saveSignature(blob);
      done(blob);
    };
    $('btn-sig-photo').onclick = async () => {
      prompts.delete(cancel);
      sheet('sheet-sigs', false);
      const blob = await photoSignature();
      if (blob) await saveSignature(blob);
      done(blob);
    };
    $('btn-sigs-cancel').onclick = cancel;
    prompts.add(cancel);
    sheet('sheet-sigs', true);
  });
}

let pad = null;
function drawSignature() {
  return new Promise((resolve) => {
    if (!pad) pad = createPad($('sig-pad'));
    const ink = store.get('ink', 'azul');
    document.querySelectorAll('#sig-ink button').forEach(b => b.classList.toggle('selected', b.dataset.ink === ink));
    sheet('sheet-pad', true);
    requestAnimationFrame(() => { pad.resize(); pad.clear(); pad.setColor(INKS[ink]); });
    const cancel = () => done(false);
    const done = async (ok) => {
      const blob = ok ? await pad.toBlob() : null;
      if (ok && !blob) return toast('Primero firma en el recuadro blanco');
      prompts.delete(cancel);
      sheet('sheet-pad', false);
      $('btn-pad-ok').onclick = $('btn-pad-cancel').onclick = null;
      resolve(blob);
    };
    prompts.add(cancel);
    $('btn-pad-ok').onclick = () => done(true);
    $('btn-pad-cancel').onclick = cancel;
  });
}
$('btn-pad-clear').addEventListener('click', () => pad && pad.clear());
$('sig-ink').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !pad) return;
  store.set('ink', b.dataset.ink);
  document.querySelectorAll('#sig-ink button').forEach(x => x.classList.toggle('selected', x === b));
  pad.setColor(INKS[b.dataset.ink]);
});

// Foto de una firma hecha en papel: se separa la tinta del papel.
function photoSignature() {
  return new Promise((resolve) => {
    const input = $('sig-photo-input');
    const finish = (v) => { input.onchange = input.oncancel = null; input.value = ''; resolve(v); };
    input.oncancel = () => finish(null);
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return finish(null);
      const busy = $('edit-busy');
      busy.classList.remove('hidden');
      try {
        const bmp = await decodeBlob(file);
        let canvas = drawScaled(bmp, bmp.width, bmp.height, 1200);
        bmp.close && bmp.close();
        // Si se ve el borde de la hoja, se recorta primero a la hoja.
        const corners = detectOn(canvas);
        let data = getData(canvas);
        if (corners && polyArea(corners) < 0.9) {
          const out = await runProcess(data, corners, 'original', 0);
          data = new ImageData(out.data, out.width, out.height);
        }
        const ink = signatureFromPhoto(data);
        if (!ink) {
          toast('No encontré la firma. Firma con lapicero oscuro en papel blanco y toma la foto de cerca, con buena luz.', 6000);
          return finish(null);
        }
        finish(await canvasToBlob(ink, 'image/png'));
      } catch (err) {
        console.error(err);
        toast('No se pudo usar esa foto');
        finish(null);
      } finally {
        busy.classList.add('hidden');
      }
    };
    input.click();
  });
}

// ---------------- Texto (OCR) ----------------

// El texto leído se guarda con la página y solo se vuelve a leer si cambian el recorte o el giro.
const ocrKey = (page) => `${ocr.OCR_REVISION}|${page.rotation}|` +
  page.corners.map(p => p.map(v => v.toFixed(4)).join(',')).join(';');
const hasOcr = (page) => !!(page.ocr && page.ocr.key === ocrKey(page));

// Imagen para el lector en formato PGM (gris sin compresión: se lee rapidísimo).
const pgm = (g) => new Blob([new TextEncoder().encode(`P5\n${g.width} ${g.height}\n255\n`), g.data]);

async function ocrImage(page) {
  return runOcrPrep(await originalData(page), page.corners, page.rotation);
}

// Lee una página en el giro correcto. Si el texto sale con poca confianza, quizá la página está
// de lado o al revés: se prueban los otros giros en una banda de la página (más rápido) y, si uno
// se lee claramente mejor, se relee completa así. El giro usado se guarda (rot) para ubicar el
// texto sobre la imagen en el PDF.
async function readPage(gray, step) {
  const res = await ocr.recognize(pgm(gray), gray.width, gray.height, step);
  store.set('ocrReady', true);
  const { raw } = res;
  if (raw.words < 3 || raw.conf >= 70) return res;
  step(1, 'Revisando orientación');
  // Al revés, el lector aún encuentra palabras con letras; de lado, casi solo símbolos sueltos.
  let best = 0, bestConf = raw.conf;
  for (const k of raw.lettered < 0.25 ? [1, 3, 2] : [2, 1, 3]) {
    const band = rotateGray(inkBand(gray, k % 2 === 1), k);
    const r = await ocr.recognize(pgm(band), band.width, band.height, null);
    const conf = r.raw.words >= 3 ? r.raw.conf : 0;
    if (conf > bestConf) { best = k; bestConf = conf; }
    if (conf >= 80) break; // se lee claramente bien así: no hace falta probar más
  }
  if (!best || bestConf < raw.conf + 15) return res;
  const turned = rotateGray(gray, best);
  const res2 = await ocr.recognize(pgm(turned), turned.width, turned.height,
    (f) => step(f, 'Leyendo texto (página girada)'));
  return res2.raw.conf > raw.conf + 10 ? { ...res2, rot: best } : res;
}

// Un solo trabajo de lectura a la vez (en segundo plano, al exportar, al copiar el texto).
let ocrChain = Promise.resolve();
function withOcr(fn) {
  const run = ocrChain.then(fn);
  ocrChain = run.catch(() => {});
  return run;
}

// Se puede enderezar sola si nadie la giró a mano y no tiene firmas (ni es una hoja de cédula,
// con poco texto, donde la orientación es menos segura).
const canStraighten = (p) => !p.userRotated && !(p.marks && p.marks.length) && p.source !== 'id' &&
  // ni la que está abierta en el editor (no cambiarla mientras se mira, gira o firma)
  !(state.view === 'edit' && edit.page && edit.page.id === p.id);

// Guarda el texto leído con la clave con que se leyó (recorte y giro). Si la página cambió en el
// intermedio, se descarta. Devuelve {page, turned} o null.
async function storeOcr(id, key, res) {
  let page = state.pages.find(p => p.id === id);
  if (page) {
    if (ocrKey(page) !== key) return null;
    page.ocr = { ...res, key };
    if (!await savePage(page)) return null;
  } else {
    page = await db.updatePage(id, (rec) => {
      if (ocrKey(rec) !== key) return false;
      rec.ocr = { ...res, key };
    });
    if (!page) return null;
    // Por si se abrió su documento mientras se leía.
    const live = state.pages.find(p => p.id === id);
    if (live) { live.ocr = page.ocr; page = live; }
  }
  let turned = 0;
  if (page.ocr.rot && canStraighten(page)) {
    // Estaba de lado o al revés: se endereza. El texto ya se leyó en ese giro.
    turned = page.ocr.rot;
    page.rotation = (page.rotation + turned) % 4;
    page.ocr = { ...page.ocr, rot: 0, key: ocrKey(page) };
    if (!await savePage(page)) return null;
    await enqueue(() => renderPage(page));
  }
  await db.putText({ id: page.id, docId: page.docId, text: ocr.ocrText(page.ocr), key: page.ocr.key });
  await maybeAutoName(page);
  return { page, turned };
}

// Documento nuevo: toma como nombre el título de su primera página (una sola vez).
async function maybeAutoName(page) {
  const live = state.doc && state.doc.id === page.docId ? state.doc : null;
  const doc = live || await db.getDoc(page.docId);
  if (!doc || !doc.autoName || doc.pageIds[0] !== page.id) return;
  const title = suggestTitle(page.ocr);
  const saved = await db.updateDoc(doc.id, (d) => {
    if (!d.autoName || d.pageIds[0] !== page.id) return false;
    d.autoName = false;
    if (title) d.name = title;
  });
  if (!saved) return;
  if (state.doc && state.doc.id === saved.id) {
    state.doc.autoName = false;
    state.doc.name = saved.name;
    state.doc.updated = saved.updated;
    if (state.view === 'doc' && document.activeElement !== $('doc-title')) $('doc-title').value = saved.name;
  }
  if (state.view === 'home') renderHome();
}

// Lee las páginas que falten (pages: las del documento abierto). Devuelve los números de las
// páginas que se enderezaron.
function ensureOcr(pages, onProgress, stopped) {
  return withOcr(async () => {
    const turned = [];
    const todo = pages.filter(p => !hasOcr(p));
    for (let i = 0; i < todo.length; i++) {
      const page = todo[i];
      const suffix = pages.length > 1 ? ` · página ${pages.indexOf(page) + 1} de ${pages.length}` : '';
      let done = 0; // la barra no retrocede si la página se relee girada
      const step = (f, label) => { done = Math.max(done, f); onProgress((i + done) / todo.length, label + suffix); };
      if (stopped()) throw new ocr.OcrCancelledError('Cancelado');
      step(0, 'Preparando imagen');
      const key = ocrKey(page);
      const gray = await ocrImage(page);
      if (stopped()) throw new ocr.OcrCancelledError('Cancelado');
      const r = await storeOcr(page.id, key, await readPage(gray, step));
      if (r && r.turned) turned.push(pages.indexOf(page) + 1);
    }
    return turned;
  });
}

// Avisos tras leer: páginas con poca confianza (foto borrosa u oscura), enderezadas o giradas.
function ocrNotice(pages, straightened = []) {
  const list = (nums) => `${nums.length > 1 ? 'las páginas' : 'la página'} ${nums.join(', ')}`;
  const cap = (t) => t[0].toUpperCase() + t.slice(1);
  const bad = pages.map((p, i) => (p.ocr && p.ocr.words && p.ocr.conf < 60 ? i + 1 : 0)).filter(Boolean);
  const turned = pages.map((p, i) => (p.ocr && p.ocr.rot ? i + 1 : 0)).filter(Boolean);
  const msgs = [];
  if (bad.length) msgs.push(`Revisa ${list(bad)}: el texto puede tener errores (foto borrosa u oscura).`);
  if (straightened.length) msgs.push(`Enderecé ${list(straightened)}: ${straightened.length > 1 ? 'estaban' : 'estaba'} de lado o al revés.`);
  if (turned.length) msgs.push(`${cap(list(turned))} ${turned.length > 1 ? 'están giradas' : 'está girada'}; el texto se leyó bien, pero puedes enderezarla${turned.length > 1 ? 's' : ''} con Girar.`);
  return msgs.join(' ');
}

// ---- Lectura en segundo plano ----
// Lee el texto de las páginas sin esperar a exportar: así se puede buscar, el documento se nombra
// solo y las páginas de lado se enderezan. Primero el documento abierto, después los demás. Se
// pausa con la cámara abierta, al exportar, al recortar o firmar, y con la app en segundo plano.

const bg = { on: store.get('bgOcr', true), running: false, dirty: true, timer: 0, pausedUntil: 0, pending: 0, failed: new Set() };

function bgKick(delay = 1500) {
  bg.dirty = true;
  if (!bg.on) return;
  clearTimeout(bg.timer);
  bg.timer = setTimeout(bgRun, delay);
}

function bgReady() {
  const conn = navigator.connection;
  const firstTime = !store.get('ocrReady', false);
  return bg.on && !document.hidden && !exp.busy && !textView.busy && queued === 0 && Date.now() >= bg.pausedUntil &&
    state.view !== 'camera' && !(state.view === 'edit' && (edit.cropping || sig.active)) &&
    // La primera vez hay que descargar el lector (9 MB): no sin internet ni con "ahorro de datos".
    !(firstTime && (navigator.onLine === false || (conn && conn.saveData)));
}

async function bgList() {
  const ids = [];
  const seen = new Set();
  const add = (id) => { if (!seen.has(id) && !bg.failed.has(id)) { seen.add(id); ids.push(id); } };
  for (const p of state.pages) if (p.processed && !hasOcr(p)) add(p.id);
  // Otros documentos: las páginas sin texto guardado.
  const texts = new Set((await db.listTexts()).map(t => t.id));
  for (const doc of await db.listDocs()) {
    if (state.doc && doc.id === state.doc.id) continue;
    for (const id of doc.pageIds) if (!texts.has(id)) add(id);
  }
  return ids;
}

async function bgRun() {
  if (bg.running || !bgReady()) return;
  bg.running = true;
  let list = [];
  try {
    for (;;) {
      if (bg.dirty || !list.length) {
        bg.dirty = false;
        list = await bgList();
        bg.pending = list.length;
        if (!list.length) break;
      }
      if (!bgReady()) break;
      const id = list.shift();
      await withOcr(() => bgReadOne(id));
      bg.pending = list.length;
      if (state.view === 'home' && $('search').value.trim()) renderHome();
    }
  } catch (err) {
    if (err instanceof ocr.OcrUnavailableError) bg.pausedUntil = Date.now() + 10 * 60000; // sin internet: más tarde
    else if (!(err instanceof ocr.OcrCancelledError)) console.warn('Lectura en segundo plano:', err);
  } finally {
    bg.running = false;
    if (!list.length) bg.pending = 0;
  }
}

async function bgReadOne(id) {
  if (!bgReady()) return; // empezó otra cosa mientras esperaba su turno
  const live = state.pages.find(p => p.id === id);
  const page = live || await db.getPage(id);
  if (!page || !page.processed) {
    if (!live) bg.failed.add(id); // borrada o sin imagen: no volver a intentarlo
    return;
  }
  if (hasOcr(page)) {
    await db.putText({ id: page.id, docId: page.docId, text: ocr.ocrText(page.ocr), key: page.ocr.key });
    return;
  }
  const key = ocrKey(page);
  try {
    const res = await readPage(await ocrImage(page), () => {});
    const r = await storeOcr(id, key, res);
    if (r && r.turned && state.doc && r.page.docId === state.doc.id && (state.view === 'doc' || state.view === 'edit')) {
      toast(`Enderecé la página ${state.pages.indexOf(r.page) + 1}: estaba de lado o al revés.`, 3500);
    }
  } catch (err) {
    if (err instanceof ocr.OcrUnavailableError || err instanceof ocr.OcrCancelledError) throw err;
    bg.failed.add(id);
    console.warn('No se pudo leer la página', id, err);
  }
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) bgKick(); });
window.addEventListener('online', () => { bg.pausedUntil = 0; bgKick(); });

// ---- Copiar el texto (de la página o de todo el documento) ----

const textView = { busy: false, stop: false, scope: 'page' };

async function openText(scope) {
  textView.scope = scope;
  $('text-scope').classList.toggle('hidden', state.view !== 'edit');
  document.querySelectorAll('#text-scope button').forEach(b => b.classList.toggle('selected', b.dataset.scope === scope));
  $('text-out').value = '';
  $('text-note').textContent = '';
  sheet('sheet-text', true);
  await loadText();
}

async function loadText() {
  const scope = textView.scope;
  const pages = (scope === 'page' ? [edit.page] : state.pages).filter(p => p && p.processed);
  $('text-title').textContent = scope === 'page' ? `Texto de la página ${state.editIndex + 1}` : 'Texto del documento';
  const out = $('text-out');
  if (!pages.length) {
    out.value = '';
    $('text-note').textContent = 'Todavía no hay páginas listas para leer.';
    return;
  }
  textView.stop = false;
  textView.busy = true;
  $('btn-text-copy').disabled = $('btn-text-share').disabled = true;
  $('btn-text-close').textContent = 'Detener';
  const bar = $('text-progress');
  let straightened = [];
  try {
    if (pages.some(p => !hasOcr(p))) {
      out.value = '';
      out.placeholder = 'Leyendo el texto…';
      const progress = (f, label) => {
        bar.classList.remove('hidden');
        bar.querySelector('div').style.width = Math.round(f * 100) + '%';
        bar.querySelector('span').textContent = `${label} ${Math.round(f * 100)}%`;
      };
      progress(0, 'Preparando');
      straightened = await ensureOcr(pages, progress, () => textView.stop);
    }
    if (textView.scope !== scope) return;
    const texts = pages.map(p => ocr.ocrText(p.ocr).trim());
    out.value = pages.length > 1 ? texts.map((t, i) => `--- Página ${i + 1} ---\n${t}`).join('\n\n') : texts[0] || '';
    out.placeholder = '';
    const empty = texts.every(t => !t);
    $('text-note').textContent = empty ? 'No encontré texto en ' + (pages.length > 1 ? 'estas páginas.' : 'esta página.')
      : [ocrNotice(pages, straightened), 'Puedes corregir el texto aquí antes de copiarlo.'].filter(Boolean).join(' ');
  } catch (err) {
    if (textView.stop || err instanceof ocr.OcrCancelledError) {
      $('text-note').textContent = 'Lectura detenida.';
    } else {
      console.error(err);
      $('text-note').textContent = err.message;
    }
  } finally {
    textView.busy = false;
    bar.classList.add('hidden');
    $('btn-text-copy').disabled = $('btn-text-share').disabled = false;
    $('btn-text-close').textContent = 'Cerrar';
    bgKick();
  }
}

$('btn-text').addEventListener('click', () => { if (edit.page && edit.page.processed) openText('page'); });
$('text-scope').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || textView.busy || b.dataset.scope === textView.scope) return;
  textView.scope = b.dataset.scope;
  document.querySelectorAll('#text-scope button').forEach(x => x.classList.toggle('selected', x === b));
  loadText();
});
$('btn-text-close').addEventListener('click', () => {
  if (textView.busy) {
    textView.stop = true;
    ocr.cancel();
    return;
  }
  sheet('sheet-text', false);
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Navegadores sin portapapeles moderno: se selecciona el texto y se copia.
    const out = $('text-out');
    out.focus();
    out.select();
    try { return document.execCommand('copy'); } catch { return false; }
  }
}
$('btn-text-copy').addEventListener('click', async () => {
  const text = $('text-out').value;
  if (!text.trim()) return toast('No hay texto para copiar');
  toast(await copyText(text) ? 'Texto copiado: ya puedes pegarlo donde quieras' : 'No se pudo copiar: mantén presionado el texto y elige Copiar', 3500);
});
$('btn-text-share').addEventListener('click', async () => {
  const text = $('text-out').value;
  if (!text.trim()) return toast('No hay texto para compartir');
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  toast(await copyText(text) ? 'Tu navegador no permite compartir: el texto se copió' : 'No se pudo compartir el texto', 3500);
});

// ---------------- Exportar ----------------

const exp = { fmt: store.get('fmt', 'pdf'), prepared: null, busy: false, stop: false, notice: '' };

function openExport() {
  if (!state.pages.length) return;
  exp.prepared = null;
  $('sel-size').value = store.get('size', 'auto');
  $('sel-quality').value = store.get('quality', 'alta');
  $('opt-ocr').checked = store.get('pdfOcr', true);
  // La contraseña nunca se guarda: hay que escribirla cada vez.
  $('opt-pass').checked = false;
  $('pdf-pass').value = '';
  $('pdf-pass').type = 'password';
  $('btn-pass-show').setAttribute('aria-pressed', 'false');
  selectFormat(exp.fmt);
  $('export-progress').classList.add('hidden');
  setExportBusy(false);
  $('sheet-export').classList.remove('hidden');
}

function closeExport() {
  $('sheet-export').classList.add('hidden');
}

function selectFormat(fmt) {
  exp.fmt = fmt;
  exp.prepared = null;
  $('btn-export-share').textContent = 'Compartir';
  store.set('fmt', fmt);
  document.querySelectorAll('#formats button').forEach(b => b.classList.toggle('selected', b.dataset.fmt === fmt));
  const isImg = ['jpg', 'png', 'webp'].includes(fmt);
  const isText = fmt === 'txt' || fmt === 'docx';
  $('opt-size').classList.toggle('hidden', fmt !== 'pdf');
  $('opt-ocr-row').classList.toggle('hidden', fmt !== 'pdf');
  $('opt-pass-row').classList.toggle('hidden', fmt !== 'pdf');
  $('pass-fields').classList.toggle('hidden', fmt !== 'pdf' || !$('opt-pass').checked);
  $('opt-quality').classList.toggle('hidden', isText);
  const n = state.pages.length;
  const firstTime = store.get('ocrReady', false) ? '' : ' La primera vez descarga el lector de texto (unos 9 MB).';
  let note = '';
  if (isImg && n > 1) note = `Se generarán ${n} imágenes. Al descargar se guardan juntas en un archivo .zip.`;
  if (isText) note = 'Reconoce el texto de las páginas (español e inglés).' + firstTime;
  if (fmt === 'docx' && /Android/i.test(navigator.userAgent)) {
    note += ' En Android, Chrome no deja compartir archivos de Word directamente: usa Descargar y envíalo desde tus archivos.';
  }
  if (fmt === 'pdf') {
    note = `Un solo PDF con ${n} ${n === 1 ? 'página' : 'páginas'}.`;
    if ($('opt-ocr').checked) note += ' Con texto buscable: podrás buscar y copiar palabras.' + firstTime;
    if ($('opt-pass').checked) {
      note += ` Guarda bien la contraseña: sin ella no se podrá abrir el PDF. El archivo se llamará "${PROTECTED_NAME}.pdf" para no revelar su contenido.`;
    }
  }
  $('export-note').textContent = note;
}

$('formats').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && !exp.busy) selectFormat(b.dataset.fmt);
});
$('sel-size').addEventListener('change', (e) => { store.set('size', e.target.value); exp.prepared = null; });
$('sel-quality').addEventListener('change', (e) => { store.set('quality', e.target.value); exp.prepared = null; });
$('opt-ocr').addEventListener('change', (e) => { store.set('pdfOcr', e.target.checked); selectFormat(exp.fmt); });
$('opt-pass').addEventListener('change', () => {
  selectFormat(exp.fmt);
  if ($('opt-pass').checked) $('pdf-pass').focus();
});
$('pdf-pass').addEventListener('input', () => { exp.prepared = null; $('btn-export-share').textContent = 'Compartir'; });
$('btn-pass-show').addEventListener('click', () => {
  const show = $('pdf-pass').type === 'password';
  $('pdf-pass').type = show ? 'text' : 'password';
  $('btn-pass-show').setAttribute('aria-pressed', String(show));
  $('btn-pass-show').textContent = show ? 'Ocultar' : 'Ver';
});
$('btn-export-cancel').addEventListener('click', () => {
  if (!exp.busy) return closeExport();
  // Detener lo que se está preparando (por ejemplo, la lectura de texto).
  exp.stop = true;
  ocr.cancel();
  $('btn-export-cancel').disabled = true;
});
$('sheet-export').addEventListener('click', (e) => { if (e.target === e.currentTarget && !exp.busy) closeExport(); });

function setExportBusy(on) {
  exp.busy = on;
  $('btn-export-share').disabled = on;
  $('btn-export-download').disabled = on;
  $('btn-export-cancel').disabled = false;
  $('btn-export-cancel').textContent = on ? 'Detener' : 'Cancelar';
  document.querySelectorAll('#formats button, #sel-size, #sel-quality, #opt-ocr, #opt-pass, #pdf-pass').forEach(el => { el.disabled = on; });
  if (!on) bgKick();
}

function progress(frac, label) {
  const p = $('export-progress');
  p.classList.remove('hidden');
  p.querySelector('div').style.width = Math.round(frac * 100) + '%';
  p.querySelector('span').textContent = `${label || 'Preparando'} ${Math.round(frac * 100)}%`;
}

const checkStop = () => { if (exp.stop) throw new ocr.OcrCancelledError('Cancelado'); };

// Contraseña del PDF: suficientemente larga para que no se pueda adivinar probando, y sin símbolos de
// "compatibilidad" (º, ª, ², ½, espacios especiales…) que unos lectores convierten (º → o) y otros no:
// con ellos, el PDF no abriría en todos (por ejemplo, en Chrome o el visor de Android).
function passwordProblem(pw) {
  if (!pw) return 'Escribe la contraseña para el PDF (o desmarca "Proteger con contraseña").';
  if ([...pw].length < 8) return 'La contraseña debe tener al menos 8 caracteres (mejor, una frase de varias palabras).';
  if (pw.normalize('NFKC') !== pw.normalize('NFC')) {
    return 'La contraseña tiene símbolos como º, ª o ² que algunos lectores de PDF no aceptan: usa letras, números y signos comunes.';
  }
  return '';
}
const PROTECTED_NAME = 'Documento protegido';

// Devuelve la lista de archivos a entregar: [{name, blob}]
async function buildFiles() {
  const pages = state.pages.filter(p => p.processed);
  if (pages.length < state.pages.length) throw new Error('Espera a que terminen de procesarse las páginas');
  const base = safeName(state.doc.name);
  const quality = $('sel-quality').value;
  const stopped = () => exp.stop;
  exp.notice = '';
  switch (exp.fmt) {
    case 'pdf': {
      const withText = $('opt-ocr').checked;
      const password = $('opt-pass').checked ? $('pdf-pass').value.normalize('NFC') : '';
      const problem = $('opt-pass').checked ? passwordProblem(password) : '';
      if (problem) {
        $('pdf-pass').focus();
        throw Object.assign(new Error(problem), { user: true });
      }
      if (withText) {
        try {
          exp.notice = ocrNotice(pages, await ensureOcr(pages, (f, label) => progress(f * 0.9, label), stopped));
        } catch (err) {
          if (exp.stop || err instanceof ocr.OcrCancelledError) throw err;
          // Sin lector (p. ej. sin internet): el PDF se guarda igual, con texto donde ya se había leído.
          console.warn(err);
          const missing = pages.filter(p => !hasOcr(p)).length;
          exp.notice = (missing === pages.length ? 'El PDF se guardó sin texto buscable. '
            : `${missing} de ${pages.length} páginas quedaron sin texto buscable. `) + err.message;
        }
      }
      // Solo se usa el texto leído con el recorte y giro actuales de cada página.
      const pdfPages = pages.map(p => ({ ...p, ocr: withText && hasOcr(p) ? p.ocr : null }));
      const start = withText ? 0.9 : 0;
      const blob = await ex.buildPdf(pdfPages, { size: $('sel-size').value, quality, title: state.doc.name, textLayer: withText, password },
        f => { checkStop(); progress(start + f * (1 - start), 'Creando PDF'); });
      // Con contraseña, el nombre del archivo no revela de qué se trata.
      return [{ name: (password ? PROTECTED_NAME : base) + '.pdf', blob, protected: !!password }];
    }
    case 'jpg': case 'png': case 'webp': {
      const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[exp.fmt];
      const files = [];
      for (let i = 0; i < pages.length; i++) {
        checkStop();
        progress(i / pages.length, 'Creando imágenes');
        const { blob } = await ex.renderPage(pages[i], type, quality);
        const suffix = pages.length > 1 ? `_${String(i + 1).padStart(2, '0')}` : '';
        files.push({ name: `${base}${suffix}.${exp.fmt}`, blob });
      }
      progress(1, 'Creando imágenes');
      return files;
    }
    case 'txt': case 'docx': {
      exp.notice = ocrNotice(pages, await ensureOcr(pages, (f, label) => progress(f, label), stopped));
      const blob = exp.fmt === 'txt' ? ex.buildTxt(pages) : await ex.buildDocx(pages, state.doc.name);
      return [{ name: `${base}.${exp.fmt}`, blob }];
    }
  }
  throw new Error('Formato desconocido');
}

async function prepare() {
  if (exp.prepared) return exp.prepared;
  exp.stop = false;
  setExportBusy(true);
  try {
    progress(0);
    const files = await buildFiles();
    checkStop();
    exp.prepared = files;
    return files;
  } catch (err) {
    $('export-progress').classList.add('hidden');
    throw err;
  } finally {
    setExportBusy(false);
  }
}

function exportFailed(err) {
  if (exp.stop || err instanceof ocr.OcrCancelledError) return toast('Cancelado');
  if (!err.user) console.error(err);
  toast(err.message, 5000);
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// Guarda los archivos en el teléfono (si son varios, juntos en un .zip).
async function saveFiles(files) {
  if (files.length === 1) download(files[0].name, files[0].blob);
  else download(safeName(state.doc.name) + '.zip', await ex.buildZip(files.map(f => ({ name: f.name, data: f.blob }))));
  $('export-progress').classList.add('hidden');
}

$('btn-export-download').addEventListener('click', async () => {
  try {
    await saveFiles(await prepare());
    if (exp.notice) toast('Archivo guardado. ' + exp.notice, 8000);
    else toast('Archivo guardado en Descargas');
  } catch (err) {
    exportFailed(err);
  }
});

// Chrome comparte hasta 10 archivos y solo de ciertos tipos (PDF, imágenes, TXT...; no Word).
const MAX_SHARE_FILES = 10;

$('btn-export-share').addEventListener('click', async () => {
  const wasReady = !!exp.prepared;
  let files;
  try {
    files = await prepare();
  } catch (err) {
    return exportFailed(err);
  }
  const fallback = async (why) => {
    await saveFiles(files);
    toast(`${why} Se guardó en Descargas: ábrelo desde ahí para enviarlo.`, 9000);
  };
  // Tipo exacto, sin parámetros: Chrome rechaza por ejemplo "text/plain;charset=utf-8".
  const shareFiles = files.map(f => new File([f.blob], f.name, { type: f.blob.type.split(';')[0] }));
  if (!navigator.canShare || !navigator.canShare({ files: shareFiles })) {
    return fallback('Este navegador no permite compartir archivos.');
  }
  if (shareFiles.length > MAX_SHARE_FILES) {
    return fallback(`Solo se pueden compartir hasta ${MAX_SHARE_FILES} imágenes a la vez.`);
  }
  try {
    await navigator.share({ files: shareFiles, title: files.some(f => f.protected) ? PROTECTED_NAME : state.doc.name });
    closeExport();
    if (exp.notice) toast(exp.notice, 8000);
  } catch (err) {
    if (err.name === 'AbortError') return; // se cerró el menú de compartir
    if (err.name === 'NotAllowedError' && !wasReady && exp.fmt !== 'docx') {
      // El permiso para compartir caducó mientras se preparaba (p. ej. leyendo el texto): un toque más.
      $('btn-export-share').textContent = 'Listo: toca para compartir';
      $('export-progress').classList.add('hidden');
      return;
    }
    // El navegador no deja compartir este tipo de archivo (Chrome no comparte Word, por ejemplo).
    await fallback(exp.fmt === 'docx' ? 'Tu navegador no permite compartir archivos de Word directamente.'
      : 'No se pudo compartir este archivo.');
  }
});

// ---------------- Inicio / instalación ----------------

$('btn-scan-home').addEventListener('click', () => { state.doc = null; state.pages = []; state.insertAt = null; openCamera('home'); });
$('btn-import-home').addEventListener('click', () => { state.doc = null; state.pages = []; state.insertAt = null; $('file-input').click(); });
$('file-input').addEventListener('change', (e) => { importFiles([...e.target.files]); e.target.value = ''; });
$('native-cam-input').addEventListener('change', (e) => { importFiles([...e.target.files]); e.target.value = ''; });

window.addEventListener('scaner-db-closed', () =>
  toast('La app se actualizó en otra ventana: ciérrala y vuelve a abrirla.', 10000));

$('opt-autostart').checked = store.get('autostart', false);
$('opt-autostart').addEventListener('change', (e) => store.set('autostart', e.target.checked));
$('opt-bgocr').checked = bg.on;
$('opt-bgocr').addEventListener('change', (e) => {
  bg.on = e.target.checked;
  store.set('bgOcr', bg.on);
  if (bg.on) {
    bg.pausedUntil = 0;
    bgKick(0);
    if (!store.get('ocrReady', false)) toast('Se descargará el lector de texto (unos 9 MB) una sola vez.', 4000);
  }
  renderHome();
});

let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $('btn-install').classList.remove('hidden');
});
$('btn-install').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $('btn-install').classList.add('hidden');
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err));
  // Se instaló una versión nueva mientras la app estaba abierta: se ofrece recargar.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) $('update-bar').classList.remove('hidden');
  });
}
$('update-bar').addEventListener('click', () => location.reload());
db.requestPersistence();

// Arranque
history.replaceState({ view: 'home' }, '');
applyState({ view: 'home' }).then(() => {
  const params = new URLSearchParams(location.search);
  if (params.has('scan') || store.get('autostart', false)) openCamera('home');
  bgKick(4000);
});
