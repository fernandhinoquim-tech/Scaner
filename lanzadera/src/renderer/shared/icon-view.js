// Convierte un elemento del dock en el HTML de su icono, según su configuración.
import { tileSVG, gradientColors } from './tiles.js';
import { autoDesign, fileTypeOf, THUMB_EXTS, ACTION_DESIGN, WIDGET_DESIGN } from './autoicon.js';
import { esc, extname } from './dom.js';

const fallbacks = new Map();
let fbSeq = 0;

export function iconUrl(item) {
  const q = new URLSearchParams();
  if (item.appId) q.set('app', item.appId);
  if (item.target) q.set('src', item.target);
  if (!q.toString()) return null;
  return `lanz://icon/i?${q}`;
}

export function thumbUrl(path, size = 256) {
  return `lanz://thumb/t?${new URLSearchParams({ p: path, s: String(size) })}`;
}

export function customUrl(file) {
  return `lanz://custom/${encodeURIComponent(file)}`;
}

// Descripción de diseño (sin imagen) para un elemento, usada también como respaldo.
export function designFor(item) {
  if (item.type === 'action') return ACTION_DESIGN[item.action] || { glyph: 'sparkles', gradient: 'aurora' };
  if (item.type === 'widget') return WIDGET_DESIGN[item.widget] || { glyph: 'sparkles', gradient: 'aurora' };
  return autoDesign(item);
}

function tileFrom(d, ap, extra = {}) {
  return tileSVG({
    glyph: d.glyph,
    text: d.text,
    emoji: d.emoji,
    colors: gradientColors(d.gradient, d.colors),
    style: d.style || ap.tileStyle,
    shape: ap.tileShape,
    ...extra,
  });
}

function imgTag(src, fbDesign, ap, cls = 'ico-img') {
  const id = 'f' + ++fbSeq;
  fallbacks.set(id, { d: fbDesign, ap });
  if (fallbacks.size > 4000) fallbacks.delete(fallbacks.keys().next().value);
  return `<img class="${cls}" src="${esc(src)}" data-fb="${id}" draggable="false" alt="" loading="lazy" decoding="async">`;
}

/** HTML del icono. opts.mini evita vistas compuestas (para miniaturas de grupo). */
export function iconHTML(item, ap, opts = {}) {
  const ic = item.icon || { kind: 'auto' };
  const auto = designFor(item);

  switch (ic.kind) {
    case 'designed':
      return tileFrom({ glyph: ic.glyph, gradient: ic.gradient, colors: ic.colors, style: ic.style }, ap);
    case 'emoji':
      return tileFrom({ emoji: ic.emoji, gradient: ic.gradient, colors: ic.colors, style: ic.style }, ap);
    case 'text':
      return tileFrom({ text: ic.text, gradient: ic.gradient, colors: ic.colors, style: ic.style }, ap);
    case 'custom': {
      const url = customUrl(ic.file);
      if ((ic.fit || 'contain') === 'contain') return imgTag(url, auto, ap);
      return tileFrom({ gradient: ic.gradient, colors: ic.colors, style: ic.style }, ap, { image: url, imageFit: ic.fit });
    }
    case 'original': {
      const url = iconUrl(item);
      return url ? imgTag(url, auto, ap) : tileFrom(auto, ap);
    }
  }

  // Automático
  if (item.type === 'group' && !opts.mini && (item.items || []).length) return groupPreview(item, ap);
  if (item.type === 'app' && ap.iconMode !== 'designed') {
    const url = iconUrl(item);
    if (url) return imgTag(url, auto, ap);
  }
  if (item.type === 'file' && item.target) {
    const ext = extname(item.target);
    if (ap.thumbnails !== false && THUMB_EXTS.has(ext)) return imgTag(thumbUrl(item.target), auto, ap, 'ico-img thumb');
    if ((ext === 'exe' || ext === 'lnk') && ap.iconMode !== 'designed') return imgTag(iconUrl(item), auto, ap);
  }
  if (item.type === 'folder' && ap.iconMode === 'original' && item.target) return imgTag(iconUrl(item), auto, ap);
  return tileFrom(auto, ap);
}

function groupPreview(item, ap) {
  const kids = item.items.slice(0, 4);
  const cells = kids.map((k) => `<span class="gp-cell">${iconHTML(k, ap, { mini: true })}</span>`).join('');
  const bg = tileSVG({ content: '', colors: gradientColors(item.icon?.gradient || 'grafito'), style: 'glass', shape: ap.tileShape });
  return `<span class="group-ico">${bg}<span class="gp-grid">${cells}</span></span>`;
}

// Icono para un archivo listado en una pila de carpeta.
export function fileIconHTML(entry, ap) {
  const item = {
    type: entry.isDir ? 'folder' : entry.ext === 'exe' || entry.ext === 'lnk' ? 'app' : 'file',
    name: entry.name,
    target: entry.path,
  };
  if (!entry.isDir && ap.thumbnails !== false && THUMB_EXTS.has(entry.ext)) {
    return imgTag(thumbUrl(entry.path), designFor(item), ap, 'ico-img thumb');
  }
  if (item.type === 'app') return imgTag(iconUrl(item), designFor(item), ap);
  return tileFrom(designFor(item), ap);
}

export { fileTypeOf };

// Sustituye imágenes rotas por su icono de diseño.
export function installIconFallbacks(root = document) {
  root.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.dataset.fb) return;
      const fb = fallbacks.get(img.dataset.fb);
      if (!fb) return;
      const span = document.createElement('span');
      span.className = 'ico-fb';
      span.innerHTML = tileFrom(fb.d, fb.ap);
      img.replaceWith(span);
    },
    true
  );
}
