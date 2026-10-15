// Procesamiento de imagen puro sobre objetos tipo ImageData ({data, width, height}).
// Se usa tanto en el hilo principal (detección en vivo) como en el worker (recorte y filtros).

export const FILTERS = ['doc', 'enhance', 'gray', 'bw', 'original'];

// ---------- Utilidades ----------

function toGray(img) {
  const { data, width, height } = img;
  const g = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; p < g.length; i += 4, p++) {
    g[p] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }
  return g;
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Uint8ClampedArray(w * h);
  const size = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / size;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / size;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function otsu(values, from = 0, to = values.length) {
  const hist = new Uint32Array(256);
  for (let i = from; i < to; i++) hist[values[i]]++;
  const total = to - from;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

function morph(bin, w, h, erode) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = erode ? 1 : 0;
      for (let dy = -1; dy <= 1 && v === (erode ? 1 : 0); dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) { if (erode) v = 0; continue; }
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) { if (erode) { v = 0; break; } continue; }
          const b = bin[yy * w + xx];
          if (erode && !b) { v = 0; break; }
          if (!erode && b) { v = 1; break; }
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function polyArea(q) {
  let a = 0;
  for (let i = 0; i < q.length; i++) {
    const p = q[i], n = q[(i + 1) % q.length];
    a += p[0] * n[1] - n[0] * p[1];
  }
  return Math.abs(a) / 2;
}

// Ordena 4 puntos como: arriba-izq, arriba-der, abajo-der, abajo-izq.
export function orderCorners(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4;
  const cy = pts.reduce((s, p) => s + p[1], 0) / 4;
  const sorted = pts.slice().sort((a, b) =>
    Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  // Empieza por el de menor x+y (arriba-izquierda).
  let start = 0;
  for (let i = 1; i < 4; i++) {
    if (sorted[i][0] + sorted[i][1] < sorted[start][0] + sorted[start][1]) start = i;
  }
  return [0, 1, 2, 3].map(i => sorted[(start + i) % 4]);
}

// Cuadrilátero de área máxima inscrito en el casco convexo.
function fitQuad(hull) {
  const n = hull.length;
  if (n < 4) return null;
  const dirs = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const idx = dirs.map(([dx, dy]) => {
    let best = 0, bv = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = hull[i][0] * dx + hull[i][1] * dy;
      if (v > bv) { bv = v; best = i; }
    }
    return best;
  });
  let area = polyArea(idx.map(i => hull[i]));
  for (let iter = 0; iter < 6; iter++) {
    let improved = false;
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < n; i++) {
        if (idx.includes(i)) continue;
        const trial = idx.slice();
        trial[k] = i;
        const q = orderCorners(trial.map(t => hull[t]));
        const a = polyArea(q);
        if (a > area + 1e-6) {
          // Mantener el orden de índices consistente con el cuadrilátero ordenado.
          const ordered = q.map(p => hull.indexOf(p));
          idx.splice(0, 4, ...ordered);
          area = a;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return orderCorners(idx.map(i => hull[i]));
}

// Componente conexa más grande (bin = 1). Devuelve {area, points(extremos por fila), touches}.
function largestComponent(bin, w, h) {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let next = 0, bestLabel = 0, bestArea = 0;
  for (let s = 0; s < bin.length; s++) {
    if (!bin[s] || labels[s]) continue;
    next++;
    let sp = 0, area = 0;
    stack[sp++] = s;
    labels[s] = next;
    while (sp) {
      const p = stack[--sp];
      area++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && bin[p - 1] && !labels[p - 1]) { labels[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && bin[p + 1] && !labels[p + 1]) { labels[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && bin[p - w] && !labels[p - w]) { labels[p - w] = next; stack[sp++] = p - w; }
      if (y < h - 1 && bin[p + w] && !labels[p + w]) { labels[p + w] = next; stack[sp++] = p + w; }
    }
    if (area > bestArea) { bestArea = area; bestLabel = next; }
  }
  if (!bestLabel) return null;
  const points = [];
  for (let y = 0; y < h; y++) {
    let minX = -1, maxX = -1;
    for (let x = 0; x < w; x++) {
      if (labels[y * w + x] === bestLabel) { if (minX < 0) minX = x; maxX = x; }
    }
    if (minX >= 0) { points.push([minX, y]); if (maxX !== minX) points.push([maxX, y]); }
  }
  return { area: bestArea, points };
}

function candidate(bin, w, h) {
  const comp = largestComponent(bin, w, h);
  if (!comp) return null;
  const hull = convexHull(comp.points);
  const quad = fitQuad(hull);
  if (!quad) return null;
  const qa = polyArea(quad);
  const total = w * h;
  if (qa < total * 0.12 || qa > total * 0.985) return null;
  const fill = comp.area / qa; // qué tan "rectangular" es la mancha
  if (fill < 0.8) return null;
  return { quad, score: qa * fill * fill };
}

// Método 1: la hoja como la mancha clara (u oscura) más grande. Devuelve el cuadrilátero en píxeles.
function detectByBrightness(gray, w, h) {
  const g = boxBlur(gray, w, h, 2);
  const t = otsu(g);
  let best = null;
  for (const bright of [true, false]) {
    let bin = new Uint8Array(w * h);
    for (let i = 0; i < bin.length; i++) bin[i] = bright ? g[i] > t : g[i] <= t;
    bin = morph(morph(bin, w, h, true), w, h, true);
    bin = morph(morph(bin, w, h, false), w, h, false);
    const c = candidate(bin, w, h);
    if (c && (!best || c.score > best.score)) best = c;
  }
  return best && best.quad;
}

// Método 2: bordes rectos. Gradiente (Sobel) en cada canal de color, quedándose con el más
// fuerte: así se ve el borde aunque papel y mesa tengan casi el mismo brillo pero distinto tono
// (mesa blanca). Supresión de no-máximos; guarda la dirección del gradiente (grados 0..359,
// apunta hacia lo más claro en ese canal) en cada píxel de borde, o -1.
function edgeMap(img, w, h) {
  const n = w * h, d = img.data;
  const chans = [0, 1, 2].map(c => {
    const g = new Uint8ClampedArray(n);
    for (let i = c, p = 0; p < n; i += 4, p++) g[p] = d[i];
    return boxBlur(boxBlur(g, w, h, 1), w, h, 1);
  });
  const mag = new Float32Array(n), gxs = new Float32Array(n), gys = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      let best = -1, bx = 0, by = 0;
      for (const g of chans) {
        const a = g[i - w - 1], b = g[i - w], c = g[i - w + 1];
        const e = g[i - 1], f = g[i + 1];
        const k = g[i + w - 1], l = g[i + w], m = g[i + w + 1];
        const gx = (c + 2 * f + m) - (a + 2 * e + k);
        const gy = (k + 2 * l + m) - (a + 2 * b + c);
        const mm = gx * gx + gy * gy;
        if (mm > best) { best = mm; bx = gx; by = gy; }
      }
      gxs[i] = bx; gys[i] = by;
      mag[i] = Math.sqrt(best);
    }
  }
  // Umbral relativo al ruido: en las zonas planas el gradiente solo mide ruido.
  const sample = [];
  for (let i = 0; i < n; i += 5) sample.push(mag[i]);
  sample.sort((p, q) => p - q);
  const thr = Math.max(14, sample[sample.length >> 1] * 3.5);
  const ang = new Int16Array(n).fill(-1);
  const pts = [];
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x, m = mag[i];
      if (m < thr) continue;
      const gx = gxs[i], gy = gys[i], ax = Math.abs(gx), ay = Math.abs(gy);
      const o = ay <= ax * 0.4142 ? 1 : ax <= ay * 0.4142 ? w : (gx > 0) === (gy > 0) ? w + 1 : w - 1;
      if (m < mag[i - o] || m <= mag[i + o]) continue;
      let deg = Math.round(Math.atan2(gy, gx) * 180 / Math.PI);
      if (deg < 0) deg += 360;
      ang[i] = deg % 360;
      pts.push(i);
    }
  }
  return { ang, pts };
}

const DEG = Math.PI / 180;
const COS = new Float32Array(180), SIN = new Float32Array(180);
for (let t = 0; t < 180; t++) { COS[t] = Math.cos(t * DEG); SIN[t] = Math.sin(t * DEG); }

const angDiff180 = (a, b) => { const d = Math.abs(a - b) % 180; return d > 90 ? 180 - d : d; };
const angDiff360 = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

function sameLine(a, b) {
  let dt = Math.abs(a.t - b.t), rb = b.rho;
  if (dt > 90) { dt = 180 - dt; rb = -rb; } // cruce 0°/180°: misma recta con ρ de signo opuesto
  return dt <= 5 && Math.abs(a.rho - rb) <= 8;
}

// Transformada de Hough dirigida por el gradiente: cada píxel de borde vota solo por
// rectas casi perpendiculares a su gradiente. Devuelve las rectas más votadas.
function houghLines({ ang, pts }, w, h, maxLines = 24) {
  const diag = Math.ceil(Math.hypot(w, h));
  const NR = diag * 2 + 1;
  const acc = new Uint16Array(180 * NR);
  for (const i of pts) {
    const x = i % w, y = (i - x) / w, t0 = ang[i] % 180;
    for (let dt = -3; dt <= 3; dt++) {
      const t = (t0 + dt + 180) % 180;
      acc[t * NR + Math.round(x * COS[t] + y * SIN[t]) + diag]++;
    }
  }
  const minVotes = Math.max(10, Math.round(Math.min(w, h) * 0.05));
  const cand = [];
  for (let t = 0; t < 180; t++) {
    for (let r = 0; r < NR; r++) {
      const v = acc[t * NR + r];
      if (v < minVotes) continue;
      let isMax = true;
      for (let dt = -2; dt <= 2 && isMax; dt++) {
        const tt = t + dt;
        if (tt < 0 || tt >= 180) continue;
        for (let dr = -2; dr <= 2; dr++) {
          const rr = r + dr;
          if ((!dt && !dr) || rr < 0 || rr >= NR) continue;
          const u = acc[tt * NR + rr];
          if (u > v || (u === v && (dt < 0 || (!dt && dr < 0)))) { isMax = false; break; }
        }
      }
      if (isMax) cand.push({ t, rho: r - diag, v });
    }
  }
  cand.sort((a, b) => b.v - a.v);
  const lines = [];
  for (const c of cand) {
    if (lines.some(l => sameLine(l, c))) continue;
    lines.push({ ...c, c: COS[c.t], s: SIN[c.t] });
    if (lines.length >= maxLines) break;
  }
  return lines;
}

function intersect(a, b) {
  const det = a.c * b.s - a.s * b.c;
  if (Math.abs(det) < 1e-6) return null;
  return [(a.rho * b.s - a.s * b.rho) / det, (a.c * b.rho - a.rho * b.c) / det];
}

function validQuad(q, w, h) {
  const mx = w * 0.03, my = h * 0.03;
  for (const [x, y] of q) if (!(x >= -mx && x <= w - 1 + mx && y >= -my && y <= h - 1 + my)) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const s = Math.sign((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]));
    if (!s || (sign && s !== sign)) return false;
    sign = s;
  }
  if (polyArea(q) < w * h * 0.07) return false;
  const len = i => Math.hypot(q[(i + 1) % 4][0] - q[i][0], q[(i + 1) % 4][1] - q[i][1]);
  const minSide = Math.min(w, h) * 0.12;
  for (let i = 0; i < 4; i++) {
    if (len(i) < minSide) return false;
    const a = q[i], b = q[(i + 1) % 4], p = q[(i + 3) % 4];
    const v1x = p[0] - a[0], v1y = p[1] - a[1], v2x = b[0] - a[0], v2y = b[1] - a[1];
    const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y));
    if (Math.abs(cos) > 0.82) return false; // ángulos interiores entre ~35° y ~145°
  }
  const r1 = len(0) / len(2), r2 = len(1) / len(3);
  return r1 >= 0.5 && r1 <= 2 && r2 >= 0.5 && r2 <= 2;
}

// Geometría de cada lado: normal hacia afuera y direcciones esperadas del gradiente.
function sideInfo(q) {
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
  const cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  return [0, 1, 2, 3].map(k => {
    const a = q[k], b = q[(k + 1) % 4];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    let nx = dy / len, ny = -dx / len;
    if (((a[0] + b[0]) / 2 - cx) * nx + ((a[1] + b[1]) / 2 - cy) * ny < 0) { nx = -nx; ny = -ny; }
    let out = Math.round(Math.atan2(ny, nx) / DEG);
    if (out < 0) out += 360;
    return { a, dx, dy, len, nx, ny, out: out % 360, in: (out + 180) % 360 };
  });
}

const OFFS = [0, -1, 1, -2, 2];

// Qué tanto del perímetro coincide con bordes reales de polaridad constante
// (la hoja suele ser más clara que la mesa, o toda más oscura). Puntaje = 2·apoyo − perímetro.
// Devuelve null si no puede superar `minScore` (para descartar candidatos rápido).
function quadSupport(q, { ang }, w, h, minScore = -Infinity) {
  const sides = sideInfo(q);
  const steps = sides.map(sd => Math.max(1, Math.floor(sd.len)));
  const total = steps.reduce((a, n) => a + n + 1, 0);
  let pos = 0, neg = 0, left = total;
  for (let k = 0; k < 4; k++) {
    const sd = sides[k], n = steps[k];
    for (let s = 0; s <= n; s++) {
      const px = sd.a[0] + sd.dx * s / n, py = sd.a[1] + sd.dy * s / n;
      for (const t of OFFS) {
        const x = Math.round(px + sd.nx * t), y = Math.round(py + sd.ny * t);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const g = ang[y * w + x];
        if (g < 0) continue;
        if (angDiff360(g, sd.in) <= 20) { pos++; break; }
        if (angDiff360(g, sd.out) <= 20) { neg++; break; }
      }
    }
    left -= n + 1;
    if (2 * (Math.max(pos, neg) + left) - total <= minScore) return null;
  }
  const S = Math.max(pos, neg);
  return { S, P: total, score: 2 * S - total, polarity: pos >= neg ? 1 : -1 };
}

// ¿Algún lado corta a través del contenido? Si del otro lado del borde sigue habiendo texto
// (muchos bordes pequeños), ese lado no es el borde de la hoja sino un renglón o una sombra.
function cutsContent(q, { ang }, w, h) {
  for (const sd of sideInfo(q)) {
    const steps = Math.max(1, Math.floor(sd.len));
    let inside = 0, outside = 0, n = 0;
    for (let s = Math.ceil(steps * 0.1); s <= steps * 0.9; s += 2) {
      const px = sd.a[0] + sd.dx * s / steps, py = sd.a[1] + sd.dy * s / steps;
      n++;
      for (let t = 3; t <= 10; t++) {
        const xo = Math.round(px + sd.nx * t), yo = Math.round(py + sd.ny * t);
        const xi = Math.round(px - sd.nx * t), yi = Math.round(py - sd.ny * t);
        if (xo >= 0 && yo >= 0 && xo < w && yo < h && ang[yo * w + xo] >= 0) outside++;
        if (xi >= 0 && yi >= 0 && xi < w && yi < h && ang[yi * w + xi] >= 0) inside++;
      }
    }
    const din = inside / (n * 8), dout = outside / (n * 8);
    if (din > 0.15 && dout > din * 0.6) return true;
  }
  return false;
}

// Ajusta cada lado a los píxeles de borde cercanos (mínimos cuadrados) y lo mete ~1 px hacia adentro.
function refineQuad(q, { ang }, w, h, polarity) {
  const lines = sideInfo(q).map(sd => {
    const want = polarity > 0 ? sd.in : sd.out;
    const steps = Math.max(1, Math.floor(sd.len));
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let s = Math.ceil(steps * 0.04); s <= steps * 0.96; s++) {
      const px = sd.a[0] + sd.dx * s / steps, py = sd.a[1] + sd.dy * s / steps;
      for (const t of [0, -1, 1, -2, 2, -3, 3]) {
        const x = Math.round(px + sd.nx * t), y = Math.round(py + sd.ny * t);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const g = ang[y * w + x];
        if (g >= 0 && angDiff360(g, want) <= 20) {
          n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
          break;
        }
      }
    }
    let c = sd.nx, s = sd.ny, rho = sd.a[0] * sd.nx + sd.a[1] * sd.ny;
    if (n >= 8) {
      const mx = sx / n, my = sy / n;
      const cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
      // Normal = autovector del menor autovalor de la covarianza.
      const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
      let ncx = -Math.sin(th), ncy = Math.cos(th);
      if (ncx * sd.nx + ncy * sd.ny < 0) { ncx = -ncx; ncy = -ncy; }
      if (ncx * sd.nx + ncy * sd.ny > 0.97) { c = ncx; s = ncy; rho = mx * ncx + my * ncy; }
    }
    return { c, s, rho: rho - 1 };
  });
  const out = [0, 1, 2, 3].map(k => intersect(lines[(k + 3) % 4], lines[k]));
  if (out.some(p => !p) || !validQuad(out, w, h)) return q;
  return out;
}

// Detecta el documento en una imagen pequeña (~240-400 px). Devuelve 4 esquinas normalizadas (0..1) o null.
export function detectDocument(img) {
  const { width: w, height: h } = img;
  const gray = toGray(img);
  const edges = edgeMap(img, w, h);
  const L = houghLines(edges, w, h);

  // Candidatos: dos pares de rectas casi paralelas que se cruzan.
  const pairs = [];
  for (let i = 0; i < L.length; i++) {
    for (let j = i + 1; j < L.length; j++) if (angDiff180(L[i].t, L[j].t) <= 30) pairs.push([i, j]);
  }
  const quads = [];
  for (let p = 0; p < pairs.length; p++) {
    for (let r = p + 1; r < pairs.length; r++) {
      const [a, b] = pairs[p], [c, d] = pairs[r];
      if (a === c || a === d || b === c || b === d) continue;
      if (Math.min(angDiff180(L[a].t, L[c].t), angDiff180(L[a].t, L[d].t),
        angDiff180(L[b].t, L[c].t), angDiff180(L[b].t, L[d].t)) < 45) continue;
      const q = [intersect(L[a], L[c]), intersect(L[a], L[d]), intersect(L[b], L[d]), intersect(L[b], L[c])];
      if (q.some(pt => !pt) || !validQuad(q, w, h)) continue;
      quads.push({ q, votes: L[a].v + L[b].v + L[c].v + L[d].v });
    }
  }
  quads.sort((x, y) => y.votes - x.votes);

  // Solo cuentan los candidatos con al menos 60 % del perímetro apoyado en bordes reales.
  const accepted = (b) => b && b.S >= b.P * 0.6;
  // Se guardan los mejores candidatos y gana el primero que no corta a través del contenido.
  const top = [], K = 6;
  for (const { q } of quads.slice(0, 600)) {
    const min = top.length >= K ? top[K - 1].score : -Infinity;
    const sup = quadSupport(q, edges, w, h, min);
    if (!accepted(sup) || sup.score <= min) continue;
    top.push({ q, ...sup });
    top.sort((a, b) => b.score - a.score);
    if (top.length > K) top.pop();
  }
  let best = top.find(c => !cutsContent(c.q, edges, w, h)) || null;
  if (!best) {
    // Respaldo (p. ej. hojas curvas): la mancha clara más grande, validada con el mismo criterio.
    const bq = detectByBrightness(gray, w, h);
    const sup = bq && quadSupport(bq, edges, w, h);
    if (accepted(sup) && !cutsContent(bq, edges, w, h)) best = { q: bq, ...sup };
  }
  if (!best) return null;
  const quad = orderCorners(refineQuad(best.q, edges, w, h, best.polarity));
  return quad.map(([x, y]) => [
    Math.min(1, Math.max(0, (x + 0.5) / w)),
    Math.min(1, Math.max(0, (y + 0.5) / h)),
  ]);
}

export const FULL_FRAME = [[0, 0], [1, 0], [1, 1], [0, 1]];

// ---------- Corrección de perspectiva ----------

function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let max = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[max][i])) max = r;
    [A[i], A[max]] = [A[max], A[i]];
    [b[i], b[max]] = [b[max], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

// Homografía que lleva (u,v) del destino a (x,y) del origen.
function homography(dst, src) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = dst[i], [x, y] = src[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  const h = solve(A, b);
  h.push(1);
  return h;
}

export function outputSize(corners, w, h, maxSide) {
  const p = corners.map(([x, y]) => [x * w, y * h]);
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let ow = Math.max(d(p[0], p[1]), d(p[3], p[2]));
  let oh = Math.max(d(p[0], p[3]), d(p[1], p[2]));
  const s = Math.min(1, maxSide / Math.max(ow, oh));
  return [Math.max(1, Math.round(ow * s)), Math.max(1, Math.round(oh * s))];
}

export function warp(img, corners, maxSide = 2400) {
  const { data, width: sw, height: sh } = img;
  const [ow, oh] = outputSize(corners, sw, sh, maxSide);
  const src = corners.map(([x, y]) => [x * sw - 0.5, y * sh - 0.5]);
  const H = homography([[0, 0], [ow, 0], [ow, oh], [0, oh]], src);
  const out = new Uint8ClampedArray(ow * oh * 4);
  const maxX = sw - 1, maxY = sh - 1;
  for (let v = 0; v < oh; v++) {
    const vv = v + 0.5;
    for (let u = 0; u < ow; u++) {
      const uu = u + 0.5;
      const z = H[6] * uu + H[7] * vv + 1;
      let x = (H[0] * uu + H[1] * vv + H[2]) / z;
      let y = (H[3] * uu + H[4] * vv + H[5]) / z;
      if (x < 0) x = 0; else if (x > maxX) x = maxX;
      if (y < 0) y = 0; else if (y > maxY) y = maxY;
      const x0 = x | 0, y0 = y | 0;
      const x1 = x0 < maxX ? x0 + 1 : x0, y1 = y0 < maxY ? y0 + 1 : y0;
      const fx = x - x0, fy = y - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const o = (v * ow + u) * 4;
      for (let c = 0; c < 3; c++) {
        const top = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * fx;
        const bot = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * fx;
        out[o + c] = top + (bot - top) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: ow, height: oh };
}

// ---------- Filtros ----------

function percentileLevels(img, lo = 0.01, hi = 0.99) {
  const hist = new Uint32Array(256);
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    hist[(data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8]++;
  }
  const total = data.length / 4;
  let acc = 0, low = 0, high = 255;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * lo) { low = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= total * (1 - hi)) { high = i; break; } }
  if (high - low < 20) { low = 0; high = 255; }
  return [low, high];
}

function enhance(img) {
  const [lo, hi] = percentileLevels(img);
  const k = 255 / (hi - lo);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = (d[i] - lo) * k, g = (d[i + 1] - lo) * k, b = (d[i + 2] - lo) * k;
    const l = (r + g + b) / 3;
    d[i] = l + (r - l) * 1.2;
    d[i + 1] = l + (g - l) * 1.2;
    d[i + 2] = l + (b - l) * 1.2;
  }
  return img;
}

// Rellena los bloques desconocidos de una o varias rejillas con el promedio de sus vecinos conocidos.
function fillFromNeighbors(grids, known, gw, gh) {
  let pending = known.length - known.reduce((a, b) => a + b, 0);
  while (pending > 0) {
    const add = [];
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const b = y * gw + x;
        if (known[b]) continue;
        let n = 0;
        const sums = grids.map(() => 0);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= gw || yy >= gh || !known[yy * gw + xx]) continue;
            n++;
            grids.forEach((g, c) => { sums[c] += g[yy * gw + xx]; });
          }
        }
        if (n) add.push([b, sums.map(v => v / n)]);
      }
    }
    if (!add.length) break;
    for (const [b, vals] of add) { grids.forEach((g, c) => { g[b] = vals[c]; }); known[b] = 1; pending--; }
  }
}

// Elimina sombras e iluminación desigual sin "lavar" fotos ni colores.
// 1) Por bloques: color del fondo (percentil 95 de cada canal) y si el bloque es papel: parejo y
//    con poco color (tolera el tinte de una luz de color). Un bloque liso rodeado de contenido
//    (el cielo de una foto) cuenta como contenido. 2) Los bloques de contenido toman la
//    iluminación de sus vecinos de papel. 3) Cada píxel se divide por esa iluminación y el grano
//    del papel se lleva a blanco según el ruido de cada zona (sin aclarar grises de verdad).
function normalizeBackground(img) {
  const { data, width: w, height: h } = img;
  const bs = Math.max(8, Math.round(Math.max(w, h) / 28));
  const gw = Math.ceil(w / bs), gh = Math.ceil(h / bs), G = gw * gh;
  const grids = [new Float32Array(G), new Float32Array(G), new Float32Array(G)];
  const paper = new Uint8Array(G);
  const hc = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)], hl = new Uint32Array(256);
  const pct = (hist, cnt, q) => {
    let acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= cnt * (1 - q)) return i; }
    return 0;
  };
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      for (const hh of hc) hh.fill(0);
      hl.fill(0);
      let cnt = 0;
      const x0 = gx * bs, y0 = gy * bs, x1 = Math.min(w, x0 + bs), y1 = Math.min(h, y0 + bs);
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * w + x) * 4;
          hc[0][data[i]]++; hc[1][data[i + 1]]++; hc[2][data[i + 2]]++;
          hl[(data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8]++;
          cnt++;
        }
      }
      const b = gy * gw + gx;
      for (let c = 0; c < 3; c++) grids[c][b] = Math.max(8, pct(hc[c], cnt, 0.95));
      const l95 = pct(hl, cnt, 0.95), l50 = pct(hl, cnt, 0.5);
      const chroma = Math.max(grids[0][b], grids[1][b], grids[2][b]) - Math.min(grids[0][b], grids[1][b], grids[2][b]);
      paper[b] = l95 > 25 && l95 - l50 <= 0.12 * l95 && chroma <= 0.25 * l95 ? 1 : 0;
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const prev = paper.slice();
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (!prev[y * gw + x]) continue;
        let content = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if ((dx || dy) && xx >= 0 && yy >= 0 && xx < gw && yy < gh && !prev[yy * gw + xx]) content++;
          }
        }
        if (content >= 3) paper[y * gw + x] = 0;
      }
    }
  }
  if (!paper.some(Boolean)) paper.fill(1);
  fillFromNeighbors(grids, paper.slice(), gw, gh);
  const bg = grids.map(g => gridFilter(gridFilter(gridFilter(g, gw, gh, true), gw, gh, false), gw, gh, false));
  let top = 0;
  for (let b = 0; b < G; b++) top = Math.max(top, (bg[0][b] + bg[1][b] + bg[2][b]) / 3);
  const floor = top * 0.12;
  // Interpolación bilineal de las rejillas: índices por columna una vez, y por fila una vez.
  const cx0 = new Int32Array(w), cx1 = new Int32Array(w), cfx = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const f = Math.min(gw - 1, Math.max(0, (x + 0.5) / bs - 0.5));
    cx0[x] = f | 0; cx1[x] = Math.min(gw - 1, cx0[x] + 1); cfx[x] = f - cx0[x];
  }
  const rowOf = (grid, y, row) => {
    const f = Math.min(gh - 1, Math.max(0, (y + 0.5) / bs - 0.5));
    const y0 = f | 0, y1 = Math.min(gh - 1, y0 + 1), fy = f - y0;
    for (let i = 0; i < gw; i++) row[i] = grid[y0 * gw + i] + (grid[y1 * gw + i] - grid[y0 * gw + i]) * fy;
  };
  const rR = new Float32Array(gw), rG = new Float32Array(gw), rB = new Float32Array(gw), rW = new Float32Array(gw);
  // Inverso de la iluminación (con piso) por fila y canal.
  const invRow = (y) => {
    rowOf(bg[0], y, rR); rowOf(bg[1], y, rG); rowOf(bg[2], y, rB);
    for (let i = 0; i < gw; i++) { rR[i] = 1 / Math.max(floor, rR[i]); rG[i] = 1 / Math.max(floor, rG[i]); rB[i] = 1 / Math.max(floor, rB[i]); }
  };

  // Punto blanco de cada bloque de papel ya corregido: mediana − 1,5 × ruido (p84 − p50), ≥ 0,9.
  const wpGrid = new Float32Array(G), wpKnown = new Uint8Array(G);
  for (let gy = 0; gy < gh; gy++) {
    const counts = Array.from({ length: gw }, () => new Uint32Array(256));
    for (let y = gy * bs; y < Math.min(h, gy * bs + bs); y += 2) {
      invRow(y);
      for (let x = 0; x < w; x += 2) {
        const bx = (x / bs) | 0;
        if (!paper[gy * gw + bx]) continue;
        const a = cx0[x], b = cx1[x], f = cfx[x], i = (y * w + x) * 4;
        const lum = data[i] * 77 * (rR[a] + (rR[b] - rR[a]) * f) + data[i + 1] * 150 * (rG[a] + (rG[b] - rG[a]) * f) +
          data[i + 2] * 29 * (rB[a] + (rB[b] - rB[a]) * f);
        counts[bx][Math.min(255, (lum * 255 / 256) | 0)]++;
      }
    }
    for (let gx = 0; gx < gw; gx++) {
      const b = gy * gw + gx, c = counts[gx];
      if (!paper[b]) continue;
      let cnt = 0;
      for (let i = 0; i < 256; i++) cnt += c[i];
      if (!cnt) continue;
      let acc = 0, p50 = -1, p84 = 255;
      for (let i = 0; i < 256; i++) {
        acc += c[i];
        if (p50 < 0 && acc >= cnt * 0.5) p50 = i;
        if (acc >= cnt * 0.84) { p84 = i; break; }
      }
      wpGrid[b] = Math.min(1, Math.max(0.9, (p50 - 1.5 * Math.max(0, p84 - p50)) / 255));
      wpKnown[b] = 1;
    }
  }
  fillFromNeighbors([wpGrid], wpKnown, gw, gh);
  for (let b = 0; b < G; b++) if (!wpKnown[b]) wpGrid[b] = 1;
  const wp = gridFilter(gridFilter(wpGrid, gw, gh, false), gw, gh, false);

  for (let y = 0; y < h; y++) {
    invRow(y);
    rowOf(wp, y, rW);
    for (let i = 0; i < gw; i++) { const k = 255 / rW[i]; rR[i] *= k; rG[i] *= k; rB[i] *= k; }
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      const a = cx0[x], b = cx1[x], f = cfx[x];
      data[i] *= rR[a] + (rR[b] - rR[a]) * f;
      data[i + 1] *= rG[a] + (rG[b] - rG[a]) * f;
      data[i + 2] *= rB[a] + (rB[b] - rB[a]) * f;
    }
  }
  return img;
}

function docLook(img) {
  normalizeBackground(img);
  const d = img.data;
  // Curva: papel a blanco, texto más oscuro, colores algo más vivos.
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const v = Math.min(1, Math.max(0, (i - 60) / (235 - 60)));
    lut[i] = 255 * Math.pow(v, 1.35);
  }
  for (let i = 0; i < d.length; i += 4) {
    const r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
    const l = (r + g + b) / 3;
    d[i] = l + (r - l) * 1.3;
    d[i + 1] = l + (g - l) * 1.3;
    d[i + 2] = l + (b - l) * 1.3;
    // Casi blanco y casi sin color → blanco neutro: quita el tinte de la luz y conserva colores reales.
    const ln = (d[i] + d[i + 1] + d[i + 2]) / 3;
    const ch = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
    const t = Math.min(1, Math.max(0, (ln - 190) / 40)) * Math.min(1, Math.max(0, 1 - ch / 70));
    if (t > 0) { d[i] += (ln - d[i]) * t; d[i + 1] += (ln - d[i + 1]) * t; d[i + 2] += (ln - d[i + 2]) * t; }
  }
  return img;
}

function grayscale(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    d[i] = d[i + 1] = d[i + 2] = l;
  }
  return img;
}

function blackWhite(img) {
  normalizeBackground(img);
  const { data: d, width: w, height: h } = img;
  const gray = toGray(img);
  let t = otsu(gray);
  t = Math.min(205, Math.max(120, t + 15));
  // Umbral adaptativo local combinado con el global para trazos finos (sin que el grano que
  // deja una sombra se vuelva puntos negros).
  const local = boxBlur(gray, w, h, Math.max(6, Math.round(Math.max(w, h) / 120)));
  for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
    const v = gray[p] < t && gray[p] < local[p] - 8 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  return img;
}

export function applyFilter(img, filter) {
  switch (filter) {
    case 'enhance': return enhance(img);
    case 'doc': return docLook(img);
    case 'gray': return grayscale(docLook(img));
    case 'bw': return blackWhite(img);
    default: return img;
  }
}

export function rotate(img, turns) {
  turns = ((turns % 4) + 4) % 4;
  if (!turns) return img;
  const { data, width: w, height: h } = img;
  const ow = turns % 2 ? h : w, oh = turns % 2 ? w : h;
  const out = new Uint8ClampedArray(data.length);
  const src32 = new Uint32Array(data.buffer, data.byteOffset, w * h);
  const dst32 = new Uint32Array(out.buffer);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx, ny;
      if (turns === 1) { nx = h - 1 - y; ny = x; }
      else if (turns === 2) { nx = w - 1 - x; ny = h - 1 - y; }
      else { nx = y; ny = w - 1 - x; }
      dst32[ny * ow + nx] = src32[y * w + x];
    }
  }
  return { data: out, width: ow, height: oh };
}

// ---------- Preparación para OCR ----------
// Gris con la iluminación aplanada: cada píxel se divide por el fondo local (el papel) y el
// "blanco" de cada zona se fija justo debajo de su ruido. Así desaparecen sombras y grano sin
// adelgazar las letras. Parámetros elegidos midiendo el error de Tesseract en fotos de prueba.

function gridFilter(g, gw, gh, median) {
  const out = new Float32Array(g.length), win = [];
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      win.length = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) win.push(g[yy * gw + xx]);
        }
      }
      if (median) { win.sort((a, b) => a - b); out[y * gw + x] = win[win.length >> 1]; }
      else out[y * gw + x] = win.reduce((a, b) => a + b, 0) / win.length;
    }
  }
  return out;
}

// Interpolación bilineal de una rejilla de bloques, recorriendo la imagen por filas.
function gridSampler(gw, gh, bs, w) {
  const x0 = new Int32Array(w), x1 = new Int32Array(w), fx = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const f = Math.min(gw - 1, Math.max(0, (x + 0.5) / bs - 0.5));
    x0[x] = f | 0; x1[x] = Math.min(gw - 1, x0[x] + 1); fx[x] = f - x0[x];
  }
  return (grid, y, row) => {
    const f = Math.min(gh - 1, Math.max(0, (y + 0.5) / bs - 0.5));
    const y0 = f | 0, y1 = Math.min(gh - 1, y0 + 1), fy = f - y0;
    for (let i = 0; i < gw; i++) row[i] = grid[y0 * gw + i] + (grid[y1 * gw + i] - grid[y0 * gw + i]) * fy;
    return (x) => row[x0[x]] + (row[x1[x]] - row[x0[x]]) * fx[x];
  };
}

export const OCR_MAX_SIDE = 3508; // ~300 ppp en una hoja A4/Carta

export function prepareForOcr(img) {
  const { width: w, height: h } = img;
  const gray = toGray(img);
  const smooth = boxBlur(gray, w, h, 1);
  const bs = Math.max(8, Math.round(Math.max(w, h) / 28));
  const gw = Math.ceil(w / bs), gh = Math.ceil(h / bs);
  const sampler = gridSampler(gw, gh, bs, w);
  const rowA = new Float32Array(gw), rowB = new Float32Array(gw);

  // 1) Fondo: percentil 95 de cada bloque; mediana y promedios entre bloques vecinos.
  let bg = new Float32Array(gw * gh);
  const hist = new Uint32Array(256);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      hist.fill(0);
      let cnt = 0;
      const x0 = gx * bs, y0 = gy * bs, x1 = Math.min(w, x0 + bs), y1 = Math.min(h, y0 + bs);
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { hist[smooth[y * w + x]]++; cnt++; }
      let acc = 0, v = 255;
      for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= cnt * 0.05) { v = i; break; } }
      bg[gy * gw + gx] = Math.max(8, v);
    }
  }
  bg = gridFilter(gridFilter(gridFilter(bg, gw, gh, true), gw, gh, false), gw, gh, false);

  // 2) Punto blanco local: mediana del cociente menos 2 veces su ruido (p84 − p50).
  const wpGrid = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const y0 = gy * bs, y1 = Math.min(h, y0 + bs);
    const counts = Array.from({ length: gw }, () => new Uint32Array(320));
    for (let y = y0; y < y1; y += 2) {
      const bgAt = sampler(bg, y, rowA);
      for (let x = 0; x < w; x += 2) {
        const r = gray[y * w + x] / bgAt(x);
        counts[(x / bs) | 0][Math.min(319, (r * 200) | 0)]++;
      }
    }
    for (let gx = 0; gx < gw; gx++) {
      const c = counts[gx];
      let cnt = 0;
      for (let i = 0; i < 320; i++) cnt += c[i];
      if (!cnt) { // bloque de 1 px al borde sin muestras: igual que el vecino
        wpGrid[gy * gw + gx] = gx ? wpGrid[gy * gw + gx - 1] : 0.9;
        continue;
      }
      let acc = 0, p50 = -1, p84 = -1;
      for (let i = 0; i < 320; i++) {
        acc += c[i];
        if (p50 < 0 && acc >= cnt * 0.5) p50 = (i + 0.5) / 200;
        if (acc >= cnt * 0.84) { p84 = (i + 0.5) / 200; break; }
      }
      wpGrid[gy * gw + gx] = Math.min(0.97, Math.max(0.5, p50 - 2 * (p84 - p50)));
    }
  }
  const wp = gridFilter(gridFilter(wpGrid, gw, gh, false), gw, gh, false);

  // 3) Salida: 0 en la tinta, 255 en el papel.
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const bgAt = sampler(bg, y, rowA), wpAt = sampler(wp, y, rowB);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = 255 * (gray[i] / bgAt(x) - 0.1) / (wpAt(x) - 0.1);
    }
  }
  return { data: out, width: w, height: h };
}

// Gira una imagen en gris (1 byte por píxel) k × 90° en sentido horario (como rotate()).
export function rotateGray(img, k) {
  k = ((k % 4) + 4) % 4;
  if (!k) return img;
  const { data, width: w, height: h } = img;
  const ow = k % 2 ? h : w, oh = k % 2 ? w : h;
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = k === 1 ? x * ow + (h - 1 - y) : k === 2 ? (h - 1 - y) * ow + (w - 1 - x) : (w - 1 - x) * ow + y;
      out[i] = data[y * w + x];
    }
  }
  return { data: out, width: ow, height: oh };
}

// Banda de la página con más tinta (renglones completos), reducida si hace falta, para probar
// rápido un giro. Horizontal para probar 0°/180°; vertical para 90°/270° (en una página de lado
// los renglones son verticales en la imagen sin girar).
export function inkBand(img, vertical, frac = 0.35, maxSide = 2400) {
  const { data, width: w, height: h } = img;
  const n = vertical ? w : h;
  const prof = new Float64Array(n);
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) if (data[y * w + x] < 128) prof[vertical ? x : y]++;
  }
  const size = Math.max(1, Math.round(n * frac));
  let acc = 0;
  for (let i = 0; i < size; i++) acc += prof[i];
  let best = acc, start = 0;
  for (let i = size; i < n; i++) {
    acc += prof[i] - prof[i - size];
    if (acc > best) { best = acc; start = i - size + 1; }
  }
  const x0 = vertical ? start : 0, y0 = vertical ? 0 : start;
  const cw = vertical ? size : w, ch = vertical ? h : size;
  const s = Math.min(1, maxSide / Math.max(cw, ch));
  const ow = Math.max(1, Math.round(cw * s)), oh = Math.max(1, Math.round(ch * s));
  const out = new Uint8ClampedArray(ow * oh);
  for (let y = 0; y < oh; y++) {
    const sy0 = y0 + Math.floor(y / s), sy1 = Math.max(sy0 + 1, Math.min(y0 + ch, y0 + Math.floor((y + 1) / s)));
    for (let x = 0; x < ow; x++) {
      const sx0 = x0 + Math.floor(x / s), sx1 = Math.max(sx0 + 1, Math.min(x0 + cw, x0 + Math.floor((x + 1) / s)));
      let sum = 0, cnt = 0;
      for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) { sum += data[yy * w + xx]; cnt++; }
      out[y * ow + x] = sum / cnt;
    }
  }
  return { data: out, width: ow, height: oh };
}
