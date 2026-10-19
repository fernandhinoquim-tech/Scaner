// Buscador rápido (Alt+Espacio).
import { h, esc, applyTheme, normalize, uid, extname } from '../shared/dom.js';
import { iconHTML, fileIconHTML, installIconFallbacks } from '../shared/icon-view.js';
import { tileSVG, gradientColors, glyphSVG } from '../shared/tiles.js';
import { search } from '../shared/fuzzy.js';
import { looksLikeMath, calculate, formatNumber } from '../shared/calc.js';

const api = window.lanz;
const q = document.getElementById('q');
const results = document.getElementById('results');
document.getElementById('sicon').innerHTML = glyphSVG('search');
installIconFallbacks(document);

let state = null;
let index = [];
let indexAt = 0;
let rows = [];
let sel = 0;

const KIND_LABEL = { pinned: 'En el dock', group: 'Grupo', app: 'App', command: 'Comando', setting: 'Ajuste', folder: 'Carpeta', file: 'Archivo' };
const ENGINES = {
  google: ['Google', 'https://www.google.com/search?q='],
  bing: ['Bing', 'https://www.bing.com/search?q='],
  duckduckgo: ['DuckDuckGo', 'https://duckduckgo.com/?q='],
};

function ap() {
  return state.config.appearance;
}

async function loadIndex(force) {
  if (!force && Date.now() - indexAt < 30000 && index.length) return;
  try {
    index = await api.searchIndex();
    indexAt = Date.now();
  } catch {}
}

function iconFor(e) {
  const it = e.item;
  if (e.kind === 'file' || (e.kind === 'folder' && it.target && e.key?.startsWith('f:'))) {
    return fileIconHTML({ name: it.name, path: it.target, isDir: e.kind === 'folder', ext: extname(it.target) }, ap());
  }
  return iconHTML(it, ap());
}

function highlight(text, query) {
  const t = String(text);
  const i = normalize(t).indexOf(normalize(query));
  if (i < 0 || !query) return esc(t);
  return esc(t.slice(0, i)) + '<b>' + esc(t.slice(i, i + query.length)) + '</b>' + esc(t.slice(i + query.length));
}

function render() {
  const query = q.value.trim();
  rows = [];
  results.innerHTML = '';
  if (!query) return renderEmpty();

  if (looksLikeMath(query)) {
    try {
      const v = calculate(query);
      rows.push({ kind: 'calc', title: '= ' + formatNumber(v), subtitle: 'Enter para copiar el resultado', value: String(Math.round(v * 1e10) / 1e10), icon: tileSVG({ glyph: 'calculator', colors: gradientColors('grafito'), style: 'fluent', shape: ap().tileShape }) });
    } catch {}
  }
  let list = index;
  let text = query;
  if (query.startsWith('>')) {
    list = index.filter((e) => e.kind === 'command');
    text = query.slice(1).trim();
  }
  const found = text ? search(list, text, 12) : list.slice(0, 12);
  for (const e of found) rows.push({ ...e, icon: iconFor(e) });
  const [ename, eurl] = ENGINES[state.config.behavior.webSearch] || ENGINES.google;
  rows.push({ kind: 'web', title: `Buscar «${query}» en ${ename}`, subtitle: 'Navegador predeterminado', url: eurl + encodeURIComponent(query), icon: tileSVG({ glyph: 'globe', colors: gradientColors('oceano'), style: 'fluent', shape: ap().tileShape }) });

  sel = 0;
  for (const [i, r] of rows.entries()) {
    const el = h('div.res' + (r.kind === 'calc' ? '.calc' : ''), {
      html:
        `<div class="ri">${r.icon}</div><div class="rt"><div class="rn">${r.kind === 'calc' || r.kind === 'web' ? esc(r.title) : highlight(r.title, text)}</div><div class="rs">${esc(r.subtitle || '')}</div></div>` +
        (KIND_LABEL[r.kind] ? `<span class="rk">${KIND_LABEL[r.kind]}</span>` : '') +
        (r.item && r.kind !== 'command' && r.kind !== 'pinned' && r.kind !== 'group' ? `<button class="btn ghost pin" title="Fijar en el dock (Ctrl+P)">${glyphSVG('pin')}</button>` : ''),
    });
    el.addEventListener('mousemove', () => select(i));
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.pin')) return pin(r);
      open(r, ev);
    });
    results.append(el);
  }
  select(0);
}

async function renderEmpty() {
  const tips = [
    ['calculator', 'grafito', 'Escribe una cuenta: 15% de 80 → 80*15%'],
    ['terminal', 'medianoche', 'Empieza con > para ver comandos'],
    ['pin', 'violeta', 'Ctrl+P fija el resultado en el dock'],
    ['folder-search', 'ambar', 'Encuentra archivos de Escritorio, Documentos y Descargas'],
  ];
  let sug = [];
  try {
    sug = await api.suggestions();
  } catch {}
  if (q.value.trim()) return;
  results.innerHTML = '';
  if (sug.length) {
    results.append(h('div.sec', { text: 'Sugeridas para esta hora' }));
    rows = sug.slice(0, 5).map((it) => ({ kind: 'app', title: it.name, subtitle: it.target || '', item: it, icon: iconHTML(it, ap()) }));
    for (const [i, r] of rows.entries()) {
      const el = h('div.res', { html: `<div class="ri">${r.icon}</div><div class="rt"><div class="rn">${esc(r.title)}</div><div class="rs">${esc(r.subtitle)}</div></div>` });
      el.addEventListener('mousemove', () => select(i));
      el.addEventListener('click', (ev) => open(r, ev));
      results.append(el);
    }
    select(0);
  }
  const grid = h('div.tips');
  for (const [g, c, t] of tips) grid.append(h('div.tip', { html: `<span class="ti">${tileSVG({ glyph: g, colors: gradientColors(c), style: 'fluent', shape: ap().tileShape })}</span><span>${esc(t)}</span>` }));
  results.append(grid);
}

function select(i) {
  const els = results.querySelectorAll('.res');
  if (!els.length) return;
  sel = (i + els.length) % els.length;
  els.forEach((e, j) => e.classList.toggle('sel', j === sel));
  els[sel].scrollIntoView({ block: 'nearest' });
}

async function open(r, ev = {}) {
  try {
    if (r.kind === 'calc') {
      await navigator.clipboard.writeText(r.value);
      q.value = r.value;
      render();
      return;
    }
    if (r.kind === 'web') {
      api.hideSearch();
      return api.launch({ type: 'url', target: r.url });
    }
    if (r.kind === 'command') {
      api.hideSearch();
      return runCommand(r.command);
    }
    api.hideSearch();
    if (ev.ctrlKey && r.item?.target && !/^[a-z-]+:(?!\\)/i.test(r.item.target)) return api.reveal(r.item.target);
    if (r.kind === 'group' && r.wsId) {
      await api.patch({ activeWorkspace: r.wsId });
      return;
    }
    await api.launch(r.item, { admin: ev.ctrlKey && ev.shiftKey });
  } catch (e) {
    console.warn(e);
  }
}

function runCommand(cmd) {
  if (cmd.startsWith('ws:')) return api.patch({ activeWorkspace: cmd.slice(3) });
  switch (cmd) {
    case 'organize':
      return api.openPanel('/organizador');
    case 'settings':
      return api.openPanel('/inicio');
    case 'icons':
      return api.openPanel('/iconos');
    default:
      return api.run(cmd);
  }
}

async function pin(r) {
  if (!r.item) return;
  const st = await api.getState();
  const ws = st.config.workspaces.find((w) => w.id === st.config.activeWorkspace);
  if (!ws) return;
  await api.setItems(ws.id, [...ws.items, { ...JSON.parse(JSON.stringify(r.item)), id: uid() }]);
  const el = results.querySelectorAll('.res')[sel];
  if (el) el.querySelector('.rs').textContent = `Fijado en «${ws.name}» ✓`;
  indexAt = 0;
}

q.addEventListener('input', render);
q.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    select(sel + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    select(sel - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (rows[sel]) open(rows[sel], e);
  } else if (e.key === 'Escape') {
    if (q.value) {
      q.value = '';
      render();
    } else api.hideSearch();
  } else if (e.key.toLowerCase() === 'p' && e.ctrlKey) {
    e.preventDefault();
    if (rows[sel]) pin(rows[sel]);
  }
});

api.onSearchShown(async ({ query }) => {
  q.value = query || '';
  q.focus();
  q.select();
  render();
  await loadIndex();
  render();
});
api.onSearchHidden(() => {
  q.value = '';
  results.innerHTML = '';
});

(async () => {
  state = await api.getState();
  applyTheme(state);
  api.onState((s) => {
    state = s;
    applyTheme(s);
    indexAt = 0;
  });
  loadIndex(true);
})();
