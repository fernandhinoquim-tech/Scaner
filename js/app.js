import * as db from './db.js';
import { detectDocument, FULL_FRAME, polyArea, orderCorners, warp, applyFilter, rotate } from './imgproc.js';
import * as ex from './export.js';

const $ = (id) => document.getElementById(id);
const MAX_ORIGINAL = 3200;   // lado máximo de la foto original guardada
const MAX_OUTPUT = 2400;     // lado máximo de la página escaneada
const DETECT_SIZE = 360;     // tamaño de trabajo para detectar bordes al capturar
const LIVE_SIZE = 240;       // tamaño de trabajo para la detección en vivo

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

function detectOn(canvas) {
  const small = drawScaled(canvas, canvas.width, canvas.height, DETECT_SIZE);
  return detectDocument(getData(small));
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

async function runProcess(image, corners, filter, rotation) {
  if (worker) {
    try {
      return await new Promise((resolve, reject) => {
        const id = ++jobSeq;
        jobs.set(id, { resolve, reject });
        worker.postMessage({ id, image, corners, filter, rotation, maxSide: MAX_OUTPUT });
      });
    } catch { /* se procesa en el hilo principal */ }
  }
  return rotate(applyFilter(warp(image, corners, MAX_OUTPUT), filter), rotation);
}

// Genera la imagen final y la miniatura de una página.
async function renderPage(page, originalData) {
  const src = originalData || getData(drawScaled(await decodeBlob(page.original), page.ow, page.oh, MAX_ORIGINAL));
  const out = await runProcess(src, page.corners, page.filter, page.rotation);
  const c = makeCanvas(out.width, out.height);
  c.getContext('2d').putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
  page.processed = await canvasToBlob(c, 'image/jpeg', 0.9);
  page.width = out.width;
  page.height = out.height;
  page.thumb = await canvasToBlob(drawScaled(c, c.width, c.height, 360), 'image/jpeg', 0.75);
  await db.putPage(page);
  onPageReady(page);
  return page;
}

// Cola secuencial para no saturar el teléfono al escanear rápido.
let queue = Promise.resolve();
let queued = 0;
function enqueue(fn) {
  queued++;
  queue = queue.then(fn).catch(err => {
    console.error(err);
    toast('Error al procesar una página: ' + err.message);
  }).finally(() => { queued--; });
  return queue;
}

// ---------------- Documento actual ----------------

async function ensureDoc() {
  if (!state.doc) {
    state.doc = { id: db.uid(), name: defaultName(), created: Date.now(), pageIds: [] };
    state.pages = [];
    await db.putDoc(state.doc);
  }
  return state.doc;
}

async function addPage(originalCanvas, corners) {
  const doc = await ensureDoc();
  const original = await canvasToBlob(originalCanvas, 'image/jpeg', 0.92);
  const page = {
    id: db.uid(),
    docId: doc.id,
    original,
    ow: originalCanvas.width,
    oh: originalCanvas.height,
    corners: corners || FULL_FRAME,
    filter: store.get('filter', 'doc'),
    rotation: 0,
    created: Date.now(),
  };
  await db.putPage(page);
  doc.pageIds.push(page.id);
  state.pages.push(page);
  await db.putDoc(doc);
  const data = getData(originalCanvas);
  enqueue(() => renderPage(page, data));
  return page;
}

async function importFiles(files) {
  if (!files.length) return;
  toast(files.length > 1 ? `Importando ${files.length} imágenes…` : 'Importando…');
  await ensureDoc();
  if (state.view === 'camera') {
    if (state.cameraFrom === 'doc') history.back(); else openDocView('replace');
  } else if (state.view !== 'doc') {
    openDocView();
  }
  for (const f of files) {
    try {
      const bmp = await decodeBlob(f);
      const canvas = drawScaled(bmp, bmp.width, bmp.height, MAX_ORIGINAL);
      bmp.close && bmp.close();
      await addPage(canvas, detectOn(canvas));
      renderDoc();
    } catch (err) {
      console.error(err);
      toast('No se pudo abrir una imagen');
    }
  }
}

// ---------------- Navegación ----------------

function setView(name) {
  if (state.view === 'camera' && name !== 'camera') stopCamera();
  state.view = name;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  closeExport();
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

async function renderHome() {
  revokeAll();
  const docs = await db.listDocs();
  const list = $('doc-list');
  list.innerHTML = '';
  $('empty').classList.toggle('hidden', docs.length > 0);
  for (const doc of docs) {
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
    card.append(img, info);
    card.addEventListener('click', async () => {
      state.doc = doc;
      state.pages = await db.getPages(doc);
      openDocView();
    });
    list.appendChild(card);
    if (doc.pageIds[0]) {
      db.getPage(doc.pageIds[0]).then(p => { if (p && p.thumb) img.src = objUrl(p.thumb); });
    }
  }
}

// ---------------- Vista de documento ----------------

function renderDoc() {
  if (state.view !== 'doc' || !state.doc) return;
  revokeAll();
  const doc = state.doc;
  if (document.activeElement !== $('doc-title')) $('doc-title').value = doc.name;
  const n = state.pages.length;
  const pending = state.pages.filter(p => !p.processed).length;
  $('doc-info').textContent = `${n} ${n === 1 ? 'página' : 'páginas'}` +
    (pending ? ` · procesando ${pending}…` : ' · toca una página para editarla');
  const grid = $('page-grid');
  grid.innerHTML = '';
  state.pages.forEach((page, i) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'page-card' + (page.processed ? '' : ' processing');
    card.dataset.id = page.id;
    const img = document.createElement('img');
    img.alt = `Página ${i + 1}`;
    if (page.thumb) img.src = objUrl(page.thumb);
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = i + 1;
    card.append(img, num);
    card.addEventListener('click', () => {
      if (!page.processed) return toast('Esta página aún se está procesando');
      nav('edit', { index: i });
    });
    grid.appendChild(card);
  });
  $('btn-doc-export').disabled = n === 0;
}

function onPageReady(page) {
  if (state.view === 'doc') renderDoc();
  if (state.view === 'camera') updateCamThumb(page);
}

$('doc-title').addEventListener('change', async (e) => {
  if (!state.doc) return;
  state.doc.name = e.target.value.trim() || defaultName();
  e.target.value = state.doc.name;
  await db.putDoc(state.doc);
});
$('doc-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

$('btn-doc-back').addEventListener('click', () => history.back());
$('btn-doc-delete').addEventListener('click', async () => {
  if (!state.doc || !confirm(`¿Eliminar "${state.doc.name}"?`)) return;
  await db.deleteDoc(state.doc);
  state.doc = null;
  nav('home', {}, 'replace');
  toast('Documento eliminado');
});
$('btn-doc-cam').addEventListener('click', () => openCamera('doc'));
$('btn-doc-import').addEventListener('click', () => $('file-input').click());
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

function liveLoop() {
  const video = $('video');
  const tick = () => {
    if (!stream || state.view !== 'camera') return;
    if (video.videoWidth) {
      const small = drawScaled(video, video.videoWidth, video.videoHeight, LIVE_SIZE);
      const found = detectDocument(getData(small));
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
  if (!found || polyArea(found) < 0.2) {
    auto.stableSince = 0;
    auto.last = null;
    if (!found) auto.armed = true;
    $('cam-hint').textContent = found ? 'Acércate un poco más' : 'Apunta al documento';
    return;
  }
  if (!auto.armed) {
    // Espera a que cambie la hoja (se pierde la detección o se mueve bastante).
    if (auto.lastShotCorners && maxShift(found, auto.lastShotCorners) > 0.12) auto.armed = true;
    $('cam-hint').textContent = 'Cambia de hoja';
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
    $('cam-hint').textContent = 'Mantén el teléfono quieto';
  }
  auto.last = found;
}

function updateAutoBtn() {
  const b = $('btn-auto');
  b.setAttribute('aria-pressed', String(auto.on));
  b.textContent = auto.on ? 'Auto: SÍ' : 'Auto: NO';
}

let capturing = false;
async function capture() {
  const video = $('video');
  if (capturing || !stream || !video.videoWidth) return;
  capturing = true;
  $('btn-shutter').classList.add('busy');
  const fx = $('flash-fx');
  fx.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => fx.classList.remove('on')));
  if (navigator.vibrate) navigator.vibrate(30);
  try {
    const canvas = drawScaled(video, video.videoWidth, video.videoHeight, MAX_ORIGINAL);
    let corners = detectOn(canvas);
    if (!corners && liveCorners && performance.now() - liveAt < 600) corners = liveCorners;
    await addPage(canvas, corners);
    state.capturedThisSession++;
    updateCamThumb();
  } catch (err) {
    console.error(err);
    toast('No se pudo capturar: ' + err.message);
  } finally {
    capturing = false;
    $('btn-shutter').classList.remove('busy');
  }
}

function updateCamThumb(page) {
  const n = state.capturedThisSession;
  $('cam-count').textContent = n;
  $('cam-count').classList.toggle('hidden', n === 0);
  const img = $('cam-thumb-img');
  if (n === 0) { img.removeAttribute('src'); return; }
  const last = page || state.pages[state.pages.length - 1];
  if (last && last.thumb && last === state.pages[state.pages.length - 1]) {
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(last.thumb);
  }
}

function finishCamera() {
  if (state.cameraFrom === 'doc') history.back();
  else if (state.capturedThisSession > 0) openDocView('replace');
  else history.back();
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
  $('btn-move-l').disabled = i <= 0;
  $('btn-move-r').disabled = i >= n - 1;
  document.querySelectorAll('#filters button').forEach(b =>
    b.classList.toggle('selected', b.dataset.filter === edit.page.filter));
}

function showResult() {
  const img = $('edit-result');
  if (img.src) URL.revokeObjectURL(img.src);
  img.src = edit.page.processed ? URL.createObjectURL(edit.page.processed) : '';
}

async function loadSource() {
  if (!edit.source) {
    const bmp = await decodeBlob(edit.page.original);
    const full = drawScaled(bmp, edit.page.ow, edit.page.oh, MAX_ORIGINAL);
    edit.source = getData(full);
    edit.preview = drawScaled(full, full.width, full.height, 1400);
    bmp.close && bmp.close();
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
$('btn-rot-l').addEventListener('click', () => { edit.page.rotation = (edit.page.rotation + 3) % 4; reprocess(); });
$('btn-rot-r').addEventListener('click', () => { edit.page.rotation = (edit.page.rotation + 1) % 4; reprocess(); });
$('btn-edit-back').addEventListener('click', () => {
  if (edit.cropping) return setCropMode(false);
  history.back();
});

async function movePage(delta) {
  const i = state.editIndex, j = i + delta;
  if (j < 0 || j >= state.pages.length) return;
  [state.pages[i], state.pages[j]] = [state.pages[j], state.pages[i]];
  state.doc.pageIds = state.pages.map(p => p.id);
  await db.putDoc(state.doc);
  state.editIndex = j;
  history.replaceState({ view: 'edit', docId: state.doc.id, index: j }, '');
  updateEditHeader();
  toast(`Ahora es la página ${j + 1}`, 1200);
}
$('btn-move-l').addEventListener('click', () => movePage(-1));
$('btn-move-r').addEventListener('click', () => movePage(1));

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
  $('edit-busy').classList.remove('hidden');
  try { await loadSource(); } finally { $('edit-busy').classList.add('hidden'); }
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

// ---------------- Exportar ----------------

const exp = { fmt: store.get('fmt', 'pdf'), prepared: null, busy: false };

function openExport() {
  if (!state.pages.length) return;
  exp.prepared = null;
  $('sel-size').value = store.get('size', 'auto');
  $('sel-quality').value = store.get('quality', 'alta');
  selectFormat(exp.fmt);
  $('export-progress').classList.add('hidden');
  $('btn-export-share').textContent = 'Compartir';
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
  $('opt-quality').classList.toggle('hidden', isText);
  const n = state.pages.length;
  let note = '';
  if (isImg && n > 1) note = `Se generarán ${n} imágenes. Al descargar se guardan juntas en un archivo .zip.`;
  if (isText) note = 'Reconoce el texto de las páginas (español e inglés). La primera vez necesita internet para descargar el lector.';
  if (fmt === 'pdf') note = `Un solo PDF con ${n} ${n === 1 ? 'página' : 'páginas'}.`;
  $('export-note').textContent = note;
}

$('formats').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && !exp.busy) selectFormat(b.dataset.fmt);
});
$('sel-size').addEventListener('change', (e) => { store.set('size', e.target.value); exp.prepared = null; });
$('sel-quality').addEventListener('change', (e) => { store.set('quality', e.target.value); exp.prepared = null; });
$('btn-export-cancel').addEventListener('click', () => { if (!exp.busy) closeExport(); });
$('sheet-export').addEventListener('click', (e) => { if (e.target === e.currentTarget && !exp.busy) closeExport(); });

function setExportBusy(on) {
  exp.busy = on;
  ['btn-export-share', 'btn-export-download', 'btn-export-cancel'].forEach(id => { $(id).disabled = on; });
}

function progress(frac, label) {
  const p = $('export-progress');
  p.classList.remove('hidden');
  p.querySelector('div').style.width = Math.round(frac * 100) + '%';
  p.querySelector('span').textContent = `${label || 'Preparando'} ${Math.round(frac * 100)}%`;
}

// Devuelve la lista de archivos a entregar: [{name, blob}]
async function buildFiles() {
  const pages = state.pages.filter(p => p.processed);
  if (pages.length < state.pages.length) throw new Error('Espera a que terminen de procesarse las páginas');
  const base = safeName(state.doc.name);
  const quality = $('sel-quality').value;
  switch (exp.fmt) {
    case 'pdf': {
      const blob = await ex.buildPdf(pages, { size: $('sel-size').value, quality, title: state.doc.name },
        f => progress(f, 'Creando PDF'));
      return [{ name: base + '.pdf', blob }];
    }
    case 'jpg': case 'png': case 'webp': {
      const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[exp.fmt];
      const files = [];
      for (let i = 0; i < pages.length; i++) {
        progress(i / pages.length, 'Creando imágenes');
        const { blob } = await ex.renderPage(pages[i], type, quality);
        const suffix = pages.length > 1 ? `_${String(i + 1).padStart(2, '0')}` : '';
        files.push({ name: `${base}${suffix}.${exp.fmt}`, blob });
      }
      progress(1, 'Creando imágenes');
      return files;
    }
    case 'txt': case 'docx': {
      const texts = await ex.ocrPages(pages, (f, label) => progress(f, label));
      const blob = exp.fmt === 'txt' ? ex.buildTxt(texts) : await ex.buildDocx(texts, state.doc.name);
      return [{ name: `${base}.${exp.fmt}`, blob }];
    }
  }
  throw new Error('Formato desconocido');
}

async function prepare() {
  if (exp.prepared) return exp.prepared;
  setExportBusy(true);
  try {
    progress(0);
    exp.prepared = await buildFiles();
    return exp.prepared;
  } finally {
    setExportBusy(false);
  }
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

$('btn-export-download').addEventListener('click', async () => {
  try {
    const files = await prepare();
    if (files.length === 1) download(files[0].name, files[0].blob);
    else {
      const zip = await ex.buildZip(files.map(f => ({ name: f.name, data: f.blob })));
      download(safeName(state.doc.name) + '.zip', zip);
    }
    $('export-progress').classList.add('hidden');
    toast('Archivo guardado en Descargas');
  } catch (err) {
    console.error(err);
    toast(err.message);
  }
});

$('btn-export-share').addEventListener('click', async () => {
  let files;
  try {
    files = await prepare();
  } catch (err) {
    console.error(err);
    return toast(err.message);
  }
  const shareFiles = files.map(f => new File([f.blob], f.name, { type: f.blob.type }));
  if (!navigator.canShare || !navigator.canShare({ files: shareFiles })) {
    toast('Este navegador no permite compartir archivos; se descargarán');
    return $('btn-export-download').click();
  }
  try {
    await navigator.share({ files: shareFiles, title: state.doc.name });
    closeExport();
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      // El permiso de compartir caducó mientras se preparaba (p. ej. OCR largo): un toque más.
      $('btn-export-share').textContent = 'Listo: toca para compartir';
      $('export-progress').classList.add('hidden');
    } else if (err.name !== 'AbortError') {
      toast('No se pudo compartir: ' + err.message);
    }
  }
});

// ---------------- Inicio / instalación ----------------

$('btn-scan-home').addEventListener('click', () => { state.doc = null; state.pages = []; openCamera('home'); });
$('btn-import-home').addEventListener('click', () => { state.doc = null; state.pages = []; $('file-input').click(); });
$('file-input').addEventListener('change', (e) => { importFiles([...e.target.files]); e.target.value = ''; });
$('native-cam-input').addEventListener('change', (e) => { importFiles([...e.target.files]); e.target.value = ''; });

$('opt-autostart').checked = store.get('autostart', false);
$('opt-autostart').addEventListener('change', (e) => store.set('autostart', e.target.checked));

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
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err));
}
db.requestPersistence();

// Arranque
history.replaceState({ view: 'home' }, '');
applyState({ view: 'home' }).then(() => {
  const params = new URLSearchParams(location.search);
  if (params.has('scan') || store.get('autostart', false)) openCamera('home');
});
