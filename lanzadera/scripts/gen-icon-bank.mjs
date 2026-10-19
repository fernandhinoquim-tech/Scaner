// Genera src/renderer/shared/icon-bank.js a partir de lucide-static.
// Uso: npm run gen:icons
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nodes = require('lucide-static/icon-nodes.json');
const tags = require('lucide-static/tags.json');
const version = require('lucide-static/package.json').version;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function toMarkup(list) {
  return list
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .filter(([k]) => k !== 'key')
        .map(([k, v]) => `${k}="${esc(v)}"`)
        .join(' ');
      return `<${tag} ${a}/>`;
    })
    .join('');
}

// Categorías del banco: palabras clave buscadas en el nombre y etiquetas.
const CATEGORIES = {
  apps: ['app', 'window', 'settings', 'cog', 'gear', 'terminal', 'monitor', 'laptop', 'computer', 'keyboard', 'mouse', 'power', 'battery', 'wifi', 'bluetooth', 'cpu', 'server', 'database', 'hard-drive', 'usb', 'printer', 'smartphone', 'tablet', 'lock', 'shield', 'key', 'bell', 'search', 'layout', 'grid', 'panel', 'toggle', 'gauge'],
  archivos: ['file', 'folder', 'archive', 'document', 'paper', 'clipboard', 'save', 'download', 'upload', 'inbox', 'package', 'box', 'files', 'notebook', 'book', 'library', 'sticky'],
  multimedia: ['music', 'video', 'film', 'camera', 'image', 'photo', 'picture', 'play', 'audio', 'headphone', 'mic', 'speaker', 'volume', 'radio', 'tv', 'disc', 'clapperboard', 'aperture', 'gallery', 'podcast', 'guitar', 'piano', 'drum'],
  comunicacion: ['message', 'mail', 'chat', 'phone', 'send', 'share', 'at-sign', 'contact', 'user', 'users', 'video', 'voicemail', 'megaphone', 'rss', 'bell', 'inbox', 'speech'],
  trabajo: ['briefcase', 'calendar', 'chart', 'presentation', 'sheet', 'table', 'kanban', 'clipboard', 'list', 'todo', 'notebook', 'pen', 'pencil', 'calculator', 'building', 'landmark', 'signature', 'stamp', 'timer', 'clock', 'target', 'trending'],
  ocio: ['gamepad', 'joystick', 'dice', 'puzzle', 'trophy', 'medal', 'ticket', 'popcorn', 'party', 'gift', 'sword', 'ghost', 'castle', 'drama', 'theater', 'ball', 'dumbbell', 'bike', 'tent', 'crown', 'skull', 'rocket'],
  web: ['globe', 'earth', 'cloud', 'link', 'wifi', 'network', 'server', 'rss', 'share', 'chrome', 'browser', 'download', 'upload', 'qr', 'webhook'],
  desarrollo: ['code', 'terminal', 'git', 'bug', 'braces', 'brackets', 'binary', 'database', 'server', 'cpu', 'component', 'blocks', 'bot', 'brain', 'variable', 'function', 'regex', 'webhook', 'file-code', 'square-code'],
  diseno: ['palette', 'brush', 'paint', 'pen-tool', 'pencil', 'shapes', 'swatch', 'pipette', 'crop', 'layers', 'frame', 'figma', 'type', 'baseline', 'spline', 'wand', 'sparkle', 'scissors', 'ruler'],
  naturaleza: ['leaf', 'tree', 'flower', 'sprout', 'sun', 'moon', 'cloud', 'rain', 'snow', 'wind', 'mountain', 'waves', 'droplet', 'flame', 'planet', 'star', 'rainbow', 'bird', 'fish', 'cat', 'dog', 'rabbit', 'bug', 'squirrel', 'turtle', 'clover', 'shell'],
  compras: ['shopping', 'cart', 'store', 'wallet', 'credit-card', 'dollar', 'euro', 'coins', 'banknote', 'receipt', 'tag', 'gift', 'piggy', 'badge-percent', 'bitcoin', 'landmark', 'hand-coins'],
  lugares: ['map', 'pin', 'plane', 'car', 'bus', 'train', 'ship', 'sailboat', 'bike', 'house', 'building', 'hotel', 'hospital', 'school', 'church', 'castle', 'compass', 'navigation', 'route', 'luggage', 'tent', 'globe', 'earth', 'fuel'],
  comida: ['utensils', 'coffee', 'pizza', 'apple', 'cherry', 'grape', 'citrus', 'carrot', 'sandwich', 'cake', 'ice-cream', 'wine', 'beer', 'cup', 'cookie', 'croissant', 'egg', 'fish', 'salad', 'soup', 'chef', 'beef', 'milk', 'popsicle', 'candy', 'donut', 'banana', 'drumstick'],
  salud: ['heart', 'activity', 'stethoscope', 'pill', 'syringe', 'hospital', 'dumbbell', 'bike', 'footprints', 'brain', 'bone', 'baby', 'accessibility', 'thermometer', 'cross', 'hand-heart', 'smile', 'bed'],
  formas: ['square', 'circle', 'triangle', 'hexagon', 'pentagon', 'octagon', 'diamond', 'star', 'heart', 'arrow', 'chevron', 'shapes', 'infinity', 'spade', 'club', 'cone', 'cylinder', 'torus', 'cuboid', 'pyramid'],
};

const DESTACADOS = 'house folder folder-open folder-down download file-text file-spreadsheet presentation globe music clapperboard image gamepad-2 code terminal calculator settings mail calendar message-circle video notebook-pen camera trash search sparkles layers clock activity clipboard-list sticky-note archive package monitor briefcase scissors paintbrush palette shopping-bag cloud shield cpu printer map book-open graduation-cap wand-sparkles layout-grid app-window rocket star heart zap flame leaf sun moon gauge headphones mic film tv pen-tool lightbulb bot brain database server git-branch bug puzzle trophy gift crown gem plane car utensils coffee dumbbell dog cat flower tree-pine mountain smartphone laptop keyboard wallet credit-card chart-bar chart-pie trending-up users user phone send link lock key bell bookmark tag newspaper library feather languages earth map-pin compass building school hospital party-popper guitar piano disc-3 popcorn ticket joystick dice-5 swords ghost'.split(' ');

const names = Object.keys(nodes).sort();
const glyphs = {};
for (const name of names) glyphs[name] = toMarkup(nodes[name]);

const cats = { destacados: DESTACADOS.filter((n) => glyphs[n]) };
for (const [cat, words] of Object.entries(CATEGORIES)) {
  cats[cat] = names.filter((n) => {
    const hay = [n, ...(tags[n] || [])].join(' ').toLowerCase();
    return words.some((w) => hay.includes(w));
  });
}

const compactTags = {};
for (const n of names) if (tags[n]?.length) compactTags[n] = tags[n].join(',');

const out = `// Archivo generado por scripts/gen-icon-bank.mjs — no editar a mano.
// Iconos: Lucide ${version} (licencia ISC, https://lucide.dev). Ver THIRD_PARTY_NOTICES.md.
export const LUCIDE_VERSION = ${JSON.stringify(version)};
export const GLYPHS = ${JSON.stringify(glyphs)};
export const TAGS = ${JSON.stringify(compactTags)};
export const CATEGORIES = ${JSON.stringify(cats)};
`;
writeFileSync(join(root, 'src/renderer/shared/icon-bank.js'), out);
const missing = DESTACADOS.filter((n) => !glyphs[n]);
console.log(`icon-bank.js: ${names.length} iconos, ${(out.length / 1024).toFixed(0)} KB`);
if (missing.length) console.log('Destacados inexistentes:', missing.join(' '));
for (const [c, l] of Object.entries(cats)) console.log(`  ${c}: ${l.length}`);
