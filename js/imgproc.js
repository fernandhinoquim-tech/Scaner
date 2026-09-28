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

// Detecta el documento en una imagen pequeña. Devuelve 4 esquinas normalizadas (0..1) o null.
export function detectDocument(img) {
  const { width: w, height: h } = img;
  const gray = boxBlur(toGray(img), w, h, 2);
  const t = otsu(gray);
  let best = null;
  for (const bright of [true, false]) {
    let bin = new Uint8Array(w * h);
    for (let i = 0; i < bin.length; i++) bin[i] = bright ? gray[i] > t : gray[i] <= t;
    bin = morph(morph(bin, w, h, true), w, h, true);
    bin = morph(morph(bin, w, h, false), w, h, false);
    const c = candidate(bin, w, h);
    if (c && (!best || c.score > best.score)) best = c;
  }
  if (!best) return null;
  // La erosión deja el contorno ~1 px por dentro de la hoja: así no se cuela el fondo.
  return best.quad.map(([x, y]) => [
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

// Elimina sombras e iluminación desigual: divide cada canal por un fondo estimado.
function normalizeBackground(img) {
  const { data, width: w, height: h } = img;
  const bs = Math.max(8, Math.round(Math.max(w, h) / 28));
  const gw = Math.ceil(w / bs), gh = Math.ceil(h / bs);
  const grid = [new Float32Array(gw * gh), new Float32Array(gw * gh), new Float32Array(gw * gh)];
  // Percentil alto por bloque (aprox: máximo de medias 2x2 para evitar ruido).
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x0 = gx * bs, y0 = gy * bs;
      const x1 = Math.min(w, x0 + bs), y1 = Math.min(h, y0 + bs);
      let m0 = 0, m1 = 0, m2 = 0;
      for (let y = y0; y < y1 - 1; y += 2) {
        for (let x = x0; x < x1 - 1; x += 2) {
          const a = (y * w + x) * 4, b = a + w * 4;
          const r = (data[a] + data[a + 4] + data[b] + data[b + 4]) >> 2;
          const g = (data[a + 1] + data[a + 5] + data[b + 1] + data[b + 5]) >> 2;
          const bl = (data[a + 2] + data[a + 6] + data[b + 2] + data[b + 6]) >> 2;
          if (r + g + bl > m0 + m1 + m2) { m0 = r; m1 = g; m2 = bl; }
        }
      }
      const gi = gy * gw + gx;
      grid[0][gi] = m0; grid[1][gi] = m1; grid[2][gi] = m2;
    }
  }
  // Dilatación + suavizado de la rejilla para ignorar bloques ocupados por texto/imágenes.
  const smooth = (g, op) => {
    const out = new Float32Array(g.length);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        let acc = op === 'max' ? 0 : 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
            const v = g[yy * gw + xx];
            if (op === 'max') acc = Math.max(acc, v); else { acc += v; n++; }
          }
        }
        out[y * gw + x] = op === 'max' ? acc : acc / n;
      }
    }
    return out;
  };
  for (let c = 0; c < 3; c++) grid[c] = smooth(smooth(smooth(grid[c], 'max'), 'mean'), 'mean');
  // Evita que zonas oscuras grandes se conviertan en "papel".
  let paper = 0;
  for (let i = 0; i < gw * gh; i++) paper = Math.max(paper, (grid[0][i] + grid[1][i] + grid[2][i]) / 3);
  const floor = paper * 0.45;

  for (let y = 0; y < h; y++) {
    const gyf = Math.min(gh - 1, Math.max(0, (y + 0.5) / bs - 0.5));
    const gy0 = gyf | 0, gy1 = Math.min(gh - 1, gy0 + 1), fy = gyf - gy0;
    for (let x = 0; x < w; x++) {
      const gxf = Math.min(gw - 1, Math.max(0, (x + 0.5) / bs - 0.5));
      const gx0 = gxf | 0, gx1 = Math.min(gw - 1, gx0 + 1), fx = gxf - gx0;
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const g = grid[c];
        const t = g[gy0 * gw + gx0] + (g[gy0 * gw + gx1] - g[gy0 * gw + gx0]) * fx;
        const b = g[gy1 * gw + gx0] + (g[gy1 * gw + gx1] - g[gy1 * gw + gx0]) * fx;
        const bg = Math.max(floor, t + (b - t) * fy, 1);
        data[i + c] = data[i + c] * 255 / bg;
      }
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
  t = Math.min(215, Math.max(130, t + 15));
  // Umbral adaptativo local combinado con el global para trazos finos.
  const local = boxBlur(gray, w, h, Math.max(6, Math.round(Math.max(w, h) / 120)));
  for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
    const v = gray[p] < t && gray[p] < local[p] - 6 ? 0 : 255;
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
