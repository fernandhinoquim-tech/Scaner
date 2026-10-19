// Puntuación de coincidencias para el buscador (insensible a mayúsculas y tildes).
import { normalize } from './dom.js';

const KIND_BOOST = { pinned: 9, group: 7, app: 6, command: 4, setting: 2, folder: 1, file: 0 };

export function scoreText(text, q) {
  const t = normalize(text);
  if (!q || !t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 85 - Math.min(10, t.length * 0.15);
  const words = t.split(/[\s\-_.()]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return 68;
  const initials = words.map((w) => w[0]).join('');
  if (q.length >= 2 && initials.startsWith(q)) return 62;
  if (t.includes(q)) return 52;
  let j = 0;
  for (const ch of t) if (ch === q[j]) j++;
  if (j === q.length && q.length >= 3) return 18 + (q.length / t.length) * 12;
  return 0;
}

export function scoreEntry(e, q) {
  let s = scoreText(e.title, q);
  if (e.keywords) s = Math.max(s, scoreText(e.keywords, q) * 0.7);
  if (!s) return 0;
  return s + (KIND_BOOST[e.kind] || 0);
}

export function search(entries, query, limit = 12) {
  const q = normalize(query);
  if (!q) return [];
  return entries
    .map((e) => ({ e, s: scoreEntry(e, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.e);
}
