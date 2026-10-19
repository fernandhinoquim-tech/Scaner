// Motor de iconos de diseño: dibuja mosaicos SVG con degradados, estilos y formas.
import { GLYPHS } from './icon-bank.js';
import { esc } from './dom.js';

export const GRADIENTS = [
  { id: 'oceano', name: 'Océano', c: ['#38BDF8', '#2563EB'] },
  { id: 'indigo', name: 'Índigo', c: ['#818CF8', '#4338CA'] },
  { id: 'violeta', name: 'Violeta', c: ['#C084FC', '#7C3AED'] },
  { id: 'uva', name: 'Uva', c: ['#A78BFA', '#DB2777'] },
  { id: 'rosa', name: 'Rosa', c: ['#F9A8D4', '#DB2777'] },
  { id: 'coral', name: 'Coral', c: ['#FDA4AF', '#E11D48'] },
  { id: 'cereza', name: 'Cereza', c: ['#F87171', '#B91C1C'] },
  { id: 'atardecer', name: 'Atardecer', c: ['#FDBA74', '#E11D48'] },
  { id: 'naranja', name: 'Naranja', c: ['#FDBA74', '#EA580C'] },
  { id: 'ambar', name: 'Ámbar', c: ['#FDE68A', '#F59E0B'] },
  { id: 'fuego', name: 'Fuego', c: ['#FDE047', '#DC2626'] },
  { id: 'lima', name: 'Lima', c: ['#D9F99D', '#65A30D'] },
  { id: 'bosque', name: 'Bosque', c: ['#86EFAC', '#15803D'] },
  { id: 'esmeralda', name: 'Esmeralda', c: ['#6EE7B7', '#059669'] },
  { id: 'menta', name: 'Menta', c: ['#5EEAD4', '#0D9488'] },
  { id: 'cielo', name: 'Cielo', c: ['#A5F3FC', '#0891B2'] },
  { id: 'aurora', name: 'Aurora', c: ['#22D3EE', '#8B5CF6'] },
  { id: 'grafito', name: 'Grafito', c: ['#94A3B8', '#334155'] },
  { id: 'medianoche', name: 'Medianoche', c: ['#475569', '#0F172A'] },
];

export const TILE_STYLES = [
  { id: 'fluent', name: 'Degradado' },
  { id: 'gloss', name: 'Brillante 3D' },
  { id: 'glass', name: 'Vidrio' },
  { id: 'neon', name: 'Neón' },
  { id: 'pastel', name: 'Pastel' },
  { id: 'solid', name: 'Sólido' },
  { id: 'minimal', name: 'Mínimo' },
];

export const SHAPES = [
  { id: 'squircle', name: 'Squircle' },
  { id: 'rounded', name: 'Redondeado' },
  { id: 'circle', name: 'Círculo' },
];

let seq = 0;

export function gradientColors(g, custom) {
  if (Array.isArray(custom) && custom.length === 2) return custom;
  if (Array.isArray(g)) return g;
  return (GRADIENTS.find((x) => x.id === g) || GRADIENTS[0]).c;
}

export function hashGradient(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const pool = GRADIENTS.filter((g) => g.id !== 'medianoche');
  return pool[h % pool.length].id;
}

function rgb(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(hex) || [0, 'ff', 'ff', 'ff'];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

export function mix(a, b, t) {
  const x = rgb(a);
  const y = rgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function shapeMarkup(shape, attrs) {
  if (shape === 'circle') return `<circle cx="50" cy="50" r="50" ${attrs}/>`;
  if (shape === 'rounded') return `<rect width="100" height="100" rx="24" ${attrs}/>`;
  return `<path d="M50 0C9 0 0 9 0 50s9 50 50 50 50-9 50-50S91 0 50 0z" ${attrs}/>`;
}

function glyphGroup(name, { stroke, color, scale = 2.25, width = 2, filter = '' }) {
  const inner = GLYPHS[name] || GLYPHS['sparkles'];
  const size = 24 * scale;
  const off = (100 - size) / 2;
  return `<g transform="translate(${off} ${off}) scale(${scale})" fill="none" stroke="${stroke}" color="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${filter ? ` filter="url(#${filter})"` : ''}>${inner}</g>`;
}

// Color del contenido (glifo o texto) según el estilo.
export function contentColor(style, colors) {
  const [c1, c2] = colors;
  if (style === 'pastel') return mix(c2, '#000000', 0.25);
  if (style === 'glass' || style === 'minimal') return mix(c1, c2, 0.5);
  if (style === 'neon') return mix(c1, '#ffffff', 0.15);
  return '#ffffff';
}

/**
 * Dibuja un mosaico.
 * o: { glyph | text | emoji | image | content, colors:[c1,c2], style, shape, imageFit, scale }
 */
export function tileSVG(o = {}) {
  const id = 'z' + (++seq).toString(36);
  const colors = o.colors || GRADIENTS[0].c;
  const [c1, c2] = colors;
  const style = o.style || 'fluent';
  const shape = o.shape || 'squircle';
  const defs = [];
  const layers = [];
  const fg = contentColor(style, colors);
  let glyphStroke = fg;

  defs.push(
    `<filter id="${id}d" x="-25%" y="-25%" width="150%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="3.2" flood-color="#000" flood-opacity="${style === 'minimal' ? 0.32 : 0.3}"/></filter>`,
    `<filter id="${id}g" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="${style === 'gloss' ? 0.9 : 0.5}" stdDeviation="${style === 'gloss' ? 0.7 : 0.45}" flood-color="#000" flood-opacity="${style === 'gloss' ? 0.35 : 0.22}"/></filter>`,
    `<linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`,
    `<linearGradient id="${id}u" gradientUnits="userSpaceOnUse" x1="2" y1="2" x2="22" y2="22"><stop offset="0" stop-color="${style === 'glass' ? mix(c1, '#ffffff', 0.15) : c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`
  );

  switch (style) {
    case 'gloss':
      defs.push(
        `<linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>`,
        `<linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient>`,
        `<radialGradient id="${id}r" cx=".3" cy=".18" r=".55"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`
      );
      layers.push(
        shapeMarkup(shape, `fill="url(#${id}a)" filter="url(#${id}d)"`),
        shapeMarkup(shape, `fill="url(#${id}b)"`),
        shapeMarkup(shape, `fill="url(#${id}h)"`),
        shapeMarkup(shape, `fill="url(#${id}r)"`),
        shapeMarkup(shape, `fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="1.6"`)
      );
      break;
    case 'glass':
      defs.push(
        `<linearGradient id="${id}h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset="1" stop-color="#fff" stop-opacity=".1"/></linearGradient>`
      );
      layers.push(
        shapeMarkup(shape, `fill="${c1}" fill-opacity=".22" filter="url(#${id}d)"`),
        shapeMarkup(shape, `fill="url(#${id}h)"`),
        shapeMarkup(shape, `fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.6"`)
      );
      glyphStroke = `url(#${id}u)`;
      break;
    case 'neon':
      defs.push(
        `<linearGradient id="${id}n" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b2033"/><stop offset="1" stop-color="#0b0d16"/></linearGradient>`,
        `<filter id="${id}w" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation=".9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
      );
      layers.push(
        shapeMarkup(shape, `fill="url(#${id}n)" filter="url(#${id}d)"`),
        shapeMarkup(shape, `fill="none" stroke="${c1}" stroke-opacity=".55" stroke-width="1.8"`)
      );
      glyphStroke = `url(#${id}u)`;
      break;
    case 'pastel':
      defs.push(
        `<linearGradient id="${id}p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mix(c1, '#ffffff', 0.72)}"/><stop offset="1" stop-color="${mix(c2, '#ffffff', 0.62)}"/></linearGradient>`
      );
      layers.push(
        shapeMarkup(shape, `fill="url(#${id}p)" filter="url(#${id}d)"`),
        shapeMarkup(shape, `fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.4"`)
      );
      break;
    case 'solid':
      layers.push(shapeMarkup(shape, `fill="${mix(c1, c2, 0.6)}" filter="url(#${id}d)"`));
      break;
    case 'minimal':
      glyphStroke = `url(#${id}u)`;
      break;
    default: // fluent
      defs.push(
        `<linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".32"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>`
      );
      layers.push(
        shapeMarkup(shape, `fill="url(#${id}a)" filter="url(#${id}d)"`),
        shapeMarkup(shape, `fill="url(#${id}h)"`),
        shapeMarkup(shape, `fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="1.5"`)
      );
  }

  const big = style === 'minimal';
  let content = '';
  if (o.content) {
    content = o.content.replace(/currentColor/g, fg);
  } else if (o.image) {
    const fit = o.imageFit || 'tile';
    if (fit === 'cover' && style !== 'minimal') {
      defs.push(`<clipPath id="${id}c">${shapeMarkup(shape, '')}</clipPath>`);
      content = `<image href="${esc(o.image)}" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id}c)"/>`;
    } else {
      const pad = big ? 4 : 18;
      content = `<image href="${esc(o.image)}" x="${pad}" y="${pad}" width="${100 - pad * 2}" height="${100 - pad * 2}" preserveAspectRatio="xMidYMid meet" filter="url(#${id}g)"/>`;
    }
  } else if (o.emoji) {
    content = `<text x="50" y="54" text-anchor="middle" dominant-baseline="central" font-size="${big ? 76 : 54}" font-family="'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif">${esc(o.emoji)}</text>`;
  } else if (o.text != null && o.text !== '') {
    const t = String(o.text).slice(0, 3);
    const fs = t.length === 1 ? 52 : t.length === 2 ? 42 : 32;
    const fill = style === 'glass' || style === 'minimal' || style === 'neon' ? `url(#${id}a)` : fg;
    content = `<text x="50" y="53" text-anchor="middle" dominant-baseline="central" font-size="${big ? fs * 1.35 : fs}" font-weight="650" letter-spacing="-1" font-family="'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif" fill="${fill}" filter="url(#${id}g)">${esc(t)}</text>`;
  } else {
    content = glyphGroup(o.glyph || 'sparkles', {
      stroke: glyphStroke,
      color: fg,
      scale: big ? 3.3 : o.scale || 2.25,
      width: big ? 1.9 : 2,
      filter: style === 'neon' ? `${id}w` : `${id}g`,
    });
  }

  const pad = big ? 0 : 6;
  const s = (100 - pad * 2) / 100;
  return `<svg class="tile" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>${defs.join('')}</defs><g transform="translate(${pad} ${pad - 1}) scale(${s})">${layers.join('')}${content}</g></svg>`;
}

// Glifo simple (sin mosaico) para menús y botones; usa currentColor.
export function glyphSVG(name, cls = 'gl') {
  const inner = GLYPHS[name] || GLYPHS['circle'];
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
