// Firmas: dibujarlas con el dedo, sacarlas de una foto de una firma en papel y estamparlas en la
// página. La firma se guarda con transparencia (solo la tinta).

export const INKS = { azul: '#1b3a9e', negro: '#15171c' };

// ---------- Panel para firmar con el dedo ----------

export function createPad(canvas) {
  const strokes = [];
  let current = null;
  let color = INKS.azul;
  const BASE = 2.8; // grosor del trazo en px de pantalla

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    redraw();
  }

  // Trazo suavizado (curvas entre puntos medios); más delgado cuando el dedo va rápido.
  function drawStroke(ctx, pts, scale, ox, oy) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const X = (p) => (p.x - ox) * scale, Y = (p) => (p.y - oy) * scale;
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(X(pts[0]), Y(pts[0]), (pts[0].w * scale) / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const prev = i > 1 ? pts[i - 2] : a;
      ctx.beginPath();
      ctx.lineWidth = ((a.w + b.w) / 2) * scale;
      ctx.moveTo((X(prev) + X(a)) / 2, (Y(prev) + Y(a)) / 2);
      ctx.quadraticCurveTo(X(a), Y(a), (X(a) + X(b)) / 2, (Y(a) + Y(b)) / 2);
      if (i === pts.length - 1) ctx.lineTo(X(b), Y(b));
      ctx.stroke();
    }
  }

  function redraw() {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) drawStroke(ctx, s, dpr, 0, 0);
  }

  function point(e, last) {
    const r = canvas.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp };
    let w = BASE;
    if (last) {
      const v = Math.hypot(p.x - last.x, p.y - last.y) / Math.max(1, p.t - last.t); // px/ms
      w = Math.max(BASE * 0.45, Math.min(BASE * 1.15, BASE * (1.15 - v * 0.4)));
      w = last.w * 0.6 + w * 0.4; // cambio de grosor suave
    }
    p.w = w;
    return p;
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    current = [point(e, null)];
    strokes.push(current);
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!current) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs.length ? evs : [e]) {
      const last = current[current.length - 1];
      const p = point(ev, last);
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 1) current.push(p);
    }
    redraw();
  });
  const end = () => { current = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  return {
    resize,
    clear() { strokes.length = 0; redraw(); },
    isEmpty: () => strokes.length === 0,
    setColor(c) { color = c; redraw(); },
    // Firma recortada a la tinta, con fondo transparente (PNG).
    toBlob() {
      if (!strokes.length) return Promise.resolve(null);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of strokes) for (const p of s) {
        x0 = Math.min(x0, p.x - p.w); y0 = Math.min(y0, p.y - p.w);
        x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.w);
      }
      const pad = 6;
      x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
      const scale = Math.min(4, 1400 / (x1 - x0), 420 / (y1 - y0));
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round((x1 - x0) * scale));
      out.height = Math.max(1, Math.round((y1 - y0) * scale));
      const ctx = out.getContext('2d');
      for (const s of strokes) drawStroke(ctx, s, scale, x0, y0);
      return new Promise(resolve => out.toBlob(resolve, 'image/png'));
    },
  };
}

// ---------- Firma tomada de una foto ----------

// Máximo en una ventana (por filas y luego por columnas): borra los trazos finos y deja el papel.
function maxFilter(src, w, h, r) {
  const tmp = new Uint8ClampedArray(src.length), out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r), e = Math.min(w - 1, x + r); k <= e; k++) if (src[row + k] > m) m = src[row + k];
      tmp[row + x] = m;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0;
      for (let k = Math.max(0, y - r), e = Math.min(h - 1, y + r); k <= e; k++) if (tmp[k * w + x] > m) m = tmp[k * w + x];
      out[y * w + x] = m;
    }
  }
  return out;
}

// img: ImageData de la foto (ya reducida). Devuelve un canvas con la tinta sobre transparente,
// o null si no se encontró una firma.
export function signatureFromPhoto(img) {
  const { data, width: w, height: h } = img;
  const n = w * h;
  const gray = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) gray[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
  // Fondo (el papel) sin la tinta; cada píxel se compara con él, así no influyen las sombras.
  const bg = maxFilter(gray, w, h, Math.max(4, Math.round(Math.max(w, h) / 90)));
  const alpha = new Float32Array(n);
  let count = 0, sr = 0, sg = 0, sb = 0, strong = 0;
  for (let i = 0; i < n; i++) {
    const ratio = gray[i] / Math.max(24, bg[i]);
    let a = (0.84 - ratio) / 0.3;
    a = a < 0.12 ? 0 : a > 1 ? 1 : a;
    alpha[i] = a;
    if (a > 0.5) count++;
    if (a > 0.85) { strong++; sr += data[i * 4]; sg += data[i * 4 + 1]; sb += data[i * 4 + 2]; }
  }
  if (count < n * 0.0004 || count > n * 0.3 || !strong) return null;
  // Recuadro de la tinta, sin manchitas sueltas en los bordes (percentiles).
  const xs = new Uint32Array(w), ys = new Uint32Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha[y * w + x] > 0.5) { xs[x]++; ys[y]++; }
  const range = (hist, total) => {
    let acc = 0, lo = 0, hi = hist.length - 1;
    for (let i = 0; i < hist.length; i++) { acc += hist[i]; if (acc > total * 0.002) { lo = i; break; } }
    acc = 0;
    for (let i = hist.length - 1; i >= 0; i--) { acc += hist[i]; if (acc > total * 0.002) { hi = i; break; } }
    return [lo, hi];
  };
  let [x0, x1] = range(xs, count), [y0, y1] = range(ys, count);
  const m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03) + 4;
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  // Tinta azul o negra, según el color medio de los trazos más oscuros.
  const r = sr / strong, g = sg / strong, b = sb / strong;
  const ink = b - r > 18 && b >= g ? INKS.azul : INKS.negro;
  const ir = parseInt(ink.slice(1, 3), 16), ig = parseInt(ink.slice(3, 5), 16), ib = parseInt(ink.slice(5, 7), 16);
  const out = new ImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const a = alpha[(y + y0) * w + x + x0];
      const o = (y * cw + x) * 4;
      out.data[o] = ir; out.data[o + 1] = ig; out.data[o + 2] = ib;
      out.data[o + 3] = Math.round(a * 255);
    }
  }
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  c.getContext('2d').putImageData(out, 0, 0);
  const s = Math.min(1, 1400 / cw, 420 / ch);
  if (s >= 1) return c;
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(cw * s));
  small.height = Math.max(1, Math.round(ch * s));
  const sctx = small.getContext('2d');
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(c, 0, 0, small.width, small.height);
  return small;
}

// ---------- Firmas sobre la página ----------
// Cada firma (mark) se guarda en el marco de la página sin girar: centro (cx, cy) de 0 a 1, ancho w
// como fracción del lado mayor de la página, y su propio giro (rot). Así, si se gira la página, la
// firma gira con ella como si estuviera en el papel.

// Del marco sin girar al marco que se ve (página girada r cuartos de vuelta a la derecha), y al revés.
export const toView = (x, y, r) => [[x, y], [1 - y, x], [1 - x, 1 - y], [y, 1 - x]][r & 3];
export const fromView = (X, Y, r) => [[X, Y], [Y, 1 - X], [1 - X, 1 - Y], [1 - Y, X]][r & 3];

const decoded = new WeakMap();
async function bitmap(blob) {
  if (!decoded.has(blob)) decoded.set(blob, await createImageBitmap(blob));
  return decoded.get(blob);
}

// En páginas en gris o blanco y negro, la firma va en negro.
function monoInk(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = INKS.negro;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

export async function drawMarks(canvas, marks, rotation, mono) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, M = Math.max(W, H);
  for (const m of marks) {
    let img = await bitmap(m.blob);
    if (mono) img = monoInk(img);
    const [X, Y] = toView(m.cx, m.cy, rotation);
    const sw = m.w * M, sh = (sw * img.height) / img.width;
    ctx.save();
    ctx.translate(X * W, Y * H);
    ctx.rotate((((m.rot + rotation) % 4) * Math.PI) / 2);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
  }
}
