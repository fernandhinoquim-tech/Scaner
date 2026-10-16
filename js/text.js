// Utilidades sobre el texto leído: título automático del documento y búsqueda.

// ---------- Título automático ----------

const SMALL = new Set(['a', 'al', 'de', 'del', 'el', 'la', 'las', 'los', 'en', 'y', 'e', 'o', 'u', 'para', 'por',
  'con', 'sin', 'un', 'una', 'su', 'sus', 'the', 'of', 'and', 'to', 'for', 'in']);

// Renglón que no sirve como título: fechas, correos, páginas, teléfonos, casi todo números...
const JUNK = /@|www\.|https?:|\.com\b|\bp[aá]g(ina)?\.?\s*\d|\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}|\d{6,}/i;

function cleanLine(s) {
  return s.replace(/[|_~«»"“”•·*=<>[\]{}]+/g, ' ').replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:;,.]+|[\s\-–—:;,]+$/g, '').trim();
}

// MAYÚSCULAS → "Tipo título" (con artículos y preposiciones en minúscula).
function titleCase(s) {
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (!letters || letters !== letters.toUpperCase()) return s; // ya viene con mayúsculas y minúsculas
  return s.toLowerCase().split(' ').map((w, i) =>
    i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function lineInfo(line) {
  const text = cleanLine(line.words.map(w => w.t).join(' '));
  const chars = text.replace(/\s/g, '');
  const letters = (text.match(/\p{L}/gu) || []).length;
  const conf = line.words.reduce((a, w) => a + w.c, 0) / line.words.length;
  const words = text.split(' ').filter(w => /\p{L}{2,}/u.test(w));
  const ok = text.length >= 3 && letters >= 4 && conf >= 70 && letters / Math.max(1, chars.length) >= 0.7 &&
    words.length >= 1 && (words.length >= 2 || letters >= 5) && !JUNK.test(text);
  return { text, ok, rh: line.rh, top: line.box[1], bottom: line.box[3] };
}

// Elige el renglón más grande de la parte de arriba de la página (el título suele serlo) y, si el
// siguiente es del mismo tamaño y va pegado, lo agrega ("Colegio … – Informe …").
export function suggestTitle(ocr, maxLen = 60) {
  if (!ocr || !ocr.words) return '';
  const lines = ocr.paras.flatMap(p => p.lines).map(lineInfo);
  if (!lines.length) return '';
  const sizes = lines.map(l => l.rh).sort((a, b) => a - b);
  const median = sizes[sizes.length >> 1];
  const top = lines.filter(l => l.ok && l.top < 0.45);
  if (!top.length) return '';
  // Más grande que el texto normal: el mayor; si todo es del mismo tamaño, el primero.
  const biggest = top.reduce((a, b) => (b.rh > a.rh ? b : a));
  const pick = biggest.rh >= median * 1.15 ? biggest : top[0];
  let title = titleCase(pick.text);
  const i = lines.indexOf(pick), next = lines[i + 1];
  if (next && next.ok && Math.abs(next.rh - pick.rh) <= pick.rh * 0.2 && next.top - pick.bottom < pick.rh * 1.5) {
    const both = `${title} – ${titleCase(next.text)}`;
    if (both.length <= maxLen) title = both;
  }
  if (title.length > maxLen) title = title.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
  return title;
}

// ---------- Búsqueda ----------

// Sin tildes ni mayúsculas, guardando para cada letra su posición en el texto original
// (para mostrar el fragmento con la palabra encontrada resaltada).
export function fold(s) {
  let out = '';
  const map = [];
  let i = 0;
  for (const ch of s) {
    const f = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (let k = 0; k < f.length; k++) { out += f[k]; map.push(i); }
    i += ch.length;
  }
  map.push(s.length);
  return { text: out, map };
}

export const terms = (q) => fold(q.trim()).text.split(/\s+/).filter(Boolean);

// Fragmento alrededor de la primera coincidencia: {before, match, after}.
export function snippet(text, folded, term, radius = 48) {
  const at = folded.text.indexOf(term);
  if (at < 0) return null;
  const s = folded.map[at], e = folded.map[at + term.length];
  let from = Math.max(0, s - radius), to = Math.min(text.length, e + radius);
  if (from > 0) from = text.indexOf(' ', from) + 1 || from;
  if (to < text.length) { const sp = text.lastIndexOf(' ', to); if (sp > e) to = sp; }
  const flat = (t) => t.replace(/\s+/g, ' ');
  return {
    before: (from > 0 ? '…' : '') + flat(text.slice(from, s)),
    match: text.slice(s, e),
    after: flat(text.slice(e, to)) + (to < text.length ? '…' : ''),
  };
}

// docs: [{id, name, pageIds}], texts: [{id (página), docId, text}].
// Devuelve [{doc, page (índice de la página que mejor coincide, o -1), hits (páginas con todas las
// palabras), snip (fragmento), byName}].
export function search(query, docs, texts) {
  const qs = terms(query);
  if (!qs.length) return [];
  const byDoc = new Map();
  for (const t of texts) {
    if (!t.text) continue;
    if (!byDoc.has(t.docId)) byDoc.set(t.docId, new Map());
    byDoc.get(t.docId).set(t.id, t.text);
  }
  const results = [];
  for (const doc of docs) {
    const name = fold(doc.name || '');
    const pages = byDoc.get(doc.id) || new Map();
    const folded = doc.pageIds.map(id => (pages.has(id) ? fold(pages.get(id)) : null));
    // Cada palabra buscada debe estar en el nombre o en alguna página.
    const all = qs.every(q => name.text.includes(q) || folded.some(f => f && f.text.includes(q)));
    if (!all) continue;
    const full = folded.map((f, i) => (f && qs.every(q => f.text.includes(q)) ? i : -1)).filter(i => i >= 0);
    const page = full.length ? full[0] : folded.findIndex(f => f && qs.some(q => f.text.includes(q)));
    let snip = null;
    if (page >= 0) {
      const f = folded[page];
      snip = snippet(pages.get(doc.pageIds[page]), f, qs.find(x => f.text.includes(x)));
    }
    results.push({ doc, page, hits: full.length, snip, byName: qs.every(q => name.text.includes(q)) });
  }
  // Primero los que coinciden por nombre, luego por cantidad de páginas que tienen todo.
  return results.sort((a, b) => (b.byName - a.byName) || (b.hits - a.hits) || (b.doc.updated - a.doc.updated));
}
