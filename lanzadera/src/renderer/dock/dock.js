// Lanzadera — la barra (dock): render, efecto lupa, modos de reposo, arrastrar y soltar.
import { h, esc, applyTheme, clamp } from '../shared/dom.js';
import { iconHTML, installIconFallbacks } from '../shared/icon-view.js';
import { S, api, ap, isVertical, findItem, saveItems, toast } from './core.js';
import { openMenu, closeMenu, menuOpen } from './menu.js';
import { closePopup, popupOpen, popupItemId, popupIsHover, openPopup, refreshIfShowing } from './popups.js';
import { widgetTile, refreshSystem } from './widgets.js';
import { itemMenu, dockMenu, activate, hasPopup, addItems, updateItem } from './actions.js';

const stage = document.getElementById('stage');
const dock = document.getElementById('dock');
const itemsEl = document.getElementById('items');
const label = document.getElementById('label');
const handle = document.getElementById('handle');
S.layer = document.getElementById('layer');
S.stage = stage;

let renderKey = '';
let els = []; // [{ item, el }]
let ks = []; // escala actual por elemento
let targets = [];
let pointer = null; // { x, y } dentro de la ventana
let lastMove = 0;
let expanded = false;
let hideTimer = null;
let showTimer = null;
let raf = 0;
let interactive = false;
let hoverIdx = -1;
let hoverOpenTimer = null;
let badges = {};

installIconFallbacks(document);

// ---------- Estado ----------

function setState(st) {
  S.state = st;
  S.config = st.config;
  S.ws = st.config.workspaces.find((w) => w.id === st.config.activeWorkspace) || st.config.workspaces[0];
  S.edge = st.config.position.edge;
  applyTheme(st);
  const key = JSON.stringify([S.ws?.id, S.ws?.items, st.config.appearance, st.config.position, st.config.clock, st.env.dark, st.env.accent, st.config.behavior.locked]);
  const seenKey = JSON.stringify(st.config.stackSeen || {});
  if (key !== renderKey) {
    renderKey = key;
    render();
    if (seenKey !== lastSeenKey) computeStackBadges();
  } else if (seenKey !== lastSeenKey) {
    computeStackBadges();
  } else {
    updateBadges();
  }
  lastSeenKey = seenKey;
  refreshIfShowing((it) => it.type === 'shelf' && st.config.shelf.length !== lastShelfLen);
  lastShelfLen = st.config.shelf.length;
}
let lastShelfLen = 0;
let lastSeenKey = '';

// ---------- Render ----------

function tileFor(item) {
  if (item.type === 'widget') {
    const t = widgetTile(item);
    if (t) return t;
  }
  return iconHTML(item, ap());
}

function render() {
  const c = S.config;
  const pos = c.position;
  closeMenu();
  closePopup();
  stage.className = [`edge-${pos.edge}`, `align-${pos.align}`, `mode-${pos.idle}`, `style-${c.appearance.dockStyle}`, expanded ? 'expanded' : '', c.appearance.labels === 'always' && !isVertical() ? 'captions' : ''].join(' ');
  stage.style.setProperty('--margin', pos.margin + 'px');
  stage.style.setProperty('--dock-alpha', c.appearance.opacity);

  const items = S.ws?.items || [];
  const size = fitSize(items);
  dock.style.setProperty('--s-full', size + 'px');
  dock.style.setProperty('--s-idle', Math.round(size * 0.64) + 'px');

  itemsEl.innerHTML = '';
  els = items.map((item) => {
    const el = h('div.item' + (item.type === 'separator' ? '.sep' : ''), { dataset: { id: item.id, type: item.type } });
    if (item.type !== 'separator') {
      el.innerHTML = `<div class="ico">${tileFor(item)}</div><span class="badge"></span>`;
      if (c.appearance.labels === 'always' && !isVertical()) el.append(h('span.caption', { text: item.name || '' }));
    }
    itemsEl.append(el);
    return { item, el };
  });
  ks = els.map(() => 1);
  targets = els.map(() => 1);
  hoverIdx = -1;
  label.classList.remove('show');
  if (!els.length) {
    const empty = h('div.item', { dataset: { id: '__add', type: 'add' }, html: `<div class="ico">${iconHTML({ type: 'action', action: 'settings', icon: { kind: 'designed', glyph: 'plus', gradient: 'aurora' } }, ap())}</div>` });
    itemsEl.append(empty);
    els = [{ item: { id: '__add', type: 'add', name: 'Agregar elementos' }, el: empty }];
    ks = [1];
    targets = [1];
  }
  watchFolders();
  updateBadges();
  layoutHandle();
  refreshHit();
}

// Reduce el tamaño si los iconos no caben a lo largo del borde.
function fitSize(items) {
  const base = S.config.appearance.iconSize;
  const length = isVertical() ? innerHeight : innerWidth;
  const units = items.reduce((n, i) => n + (i.type === 'separator' ? 0.22 + 0.12 : 1.12), 0) + 0.32;
  // La lupa agranda la barra unos (M-1)·alcance iconos; también debe caber.
  const ap0 = S.config.appearance;
  const grow = Math.max(0, ap0.magnification - 1) * ap0.magnifyRange;
  const max = (length - 40) / Math.max(1, units + grow);
  return Math.round(clamp(Math.min(base, max), 24, 110));
}

function layoutHandle() {
  handle.title = 'Lanzadera';
}

// ---------- Insignias y carpetas vigiladas ----------

function watchFolders() {
  const paths = (S.ws?.items || []).filter((i) => i.type === 'folderStack' && i.target).map((i) => i.target);
  api.watchFolders(paths);
}

async function updateBadges() {
  for (const { item, el } of els) {
    const b = el.querySelector('.badge');
    if (!b) continue;
    if (item.type === 'shelf') {
      b.textContent = S.config.shelf.length || '';
      b.classList.add('soft');
    } else if (item.type === 'folderStack') {
      b.textContent = badges[item.id] || '';
    }
  }
}

async function computeStackBadges(onlyPath) {
  for (const { item } of els) {
    if (item.type !== 'folderStack' || (onlyPath && item.target !== onlyPath)) continue;
    const seen = S.config.stackSeen?.[item.id];
    if (!seen) {
      badges[item.id] = 0;
      continue;
    }
    try {
      const res = await api.listFolder(item.target, { sort: 'date', max: 60 });
      badges[item.id] = res.entries.filter((e) => e.mtime > seen).length;
      if (badges[item.id] > 99) badges[item.id] = '99+';
    } catch {}
  }
  updateBadges();
}

// ---------- Efecto lupa ----------

function along(p) {
  return isVertical() ? p.y : p.x;
}

function restCenters() {
  const S0 = parseFloat(dock.style.getPropertyValue('--s-full')) || 50;
  const gap = S0 * 0.12;
  const pad = S0 * 0.16;
  const sizes = els.map(({ item }) => (item.type === 'separator' ? S0 * 0.22 : S0));
  const total = sizes.reduce((a, b) => a + b, 0) + gap * Math.max(0, sizes.length - 1) + pad * 2;
  const L = isVertical() ? innerHeight : innerWidth;
  const align = S.config.position.align;
  let start = align === 'start' ? 16 : align === 'end' ? L - 16 - total : (L - total) / 2;
  start += pad;
  return sizes.map((s) => {
    const c = start + s / 2;
    start += s + gap;
    return c;
  });
}

function computeTargets() {
  const M = S.config.appearance.magnification;
  if (!pointer || !expanded || S.frozen || S.dragging || M <= 1.01 || !overDockZone(pointer)) {
    targets = els.map(() => 1);
    return;
  }
  const S0 = parseFloat(dock.style.getPropertyValue('--s-full')) || 50;
  const range = S.config.appearance.magnifyRange * S0;
  const centers = restCenters();
  const p = along(pointer);
  targets = els.map(({ item }, i) => {
    if (item.type === 'separator') return 1;
    const d = Math.abs(p - centers[i]) / range;
    return d >= 1 ? 1 : 1 + (M - 1) * ((Math.cos(Math.PI * d) + 1) / 2);
  });
}

function tick() {
  raf = 0;
  computeTargets();
  const anim = S.config.appearance.animations;
  let moving = false;
  for (let i = 0; i < els.length; i++) {
    const t = targets[i];
    let k = ks[i];
    k = anim ? k + (t - k) * 0.32 : t;
    if (Math.abs(t - k) < 0.002) k = t;
    else moving = true;
    if (k !== ks[i]) {
      ks[i] = k;
      els[i].el.style.setProperty('--k', k.toFixed(4));
    }
  }
  updateLabel();
  if (moving) schedule();
}

function schedule() {
  if (!raf) raf = requestAnimationFrame(tick);
}

function updateLabel() {
  const c = S.config.appearance.labels;
  const idx = hoverIdx;
  if (c === 'never' || idx < 0 || !els[idx] || !expanded || S.dragging || popupOpen() || menuOpen() || els[idx].item.type === 'separator') {
    label.classList.remove('show');
    return;
  }
  if (c === 'always' && !isVertical()) {
    label.classList.remove('show');
    return;
  }
  const { item, el } = els[idx];
  const text = labelText(item);
  if (label.dataset.text !== text) {
    label.innerHTML = text;
    label.dataset.text = text;
  }
  const r = el.getBoundingClientRect();
  const l = label.getBoundingClientRect();
  const gap = 10;
  let x;
  let y;
  if (S.edge === 'bottom') {
    x = r.left + r.width / 2 - l.width / 2;
    y = r.top - l.height - gap;
  } else if (S.edge === 'top') {
    x = r.left + r.width / 2 - l.width / 2;
    y = r.bottom + gap;
  } else if (S.edge === 'left') {
    x = r.right + gap;
    y = r.top + r.height / 2 - l.height / 2;
  } else {
    x = r.left - l.width - gap;
    y = r.top + r.height / 2 - l.height / 2;
  }
  label.style.left = Math.round(clamp(x, 4, innerWidth - l.width - 4)) + 'px';
  label.style.top = Math.round(clamp(y, 4, innerHeight - l.height - 4)) + 'px';
  label.classList.add('show');
}

function labelText(item) {
  const name = esc(item.name || item.target || '');
  if (item.type === 'group') return `${name}<small>${(item.items || []).length} elementos</small>`;
  if (item.type === 'folderStack' && badges[item.id]) return `${name}<small>${badges[item.id]} nuevos</small>`;
  if (item.type === 'shelf' && S.config.shelf.length) return `${name}<small>${S.config.shelf.length}</small>`;
  if (item.type === 'widget' && item.widget === 'clock') return esc(new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }));
  return name;
}

// ---------- Zonas y modo de reposo ----------

function rectOf(el, pad = 0) {
  const r = el.getBoundingClientRect();
  return { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad };
}

function inRect(p, r) {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

// Zona que mantiene la barra abierta: la barra más el espacio que ocupan los iconos agrandados.
function overDockZone(p) {
  const r = rectOf(dock, 4);
  const S0 = parseFloat(dock.style.getPropertyValue('--s-full')) || 50;
  const grow = S0 * (S.config.appearance.magnification - 1) + 8;
  if (S.edge === 'bottom') r.top -= grow;
  if (S.edge === 'top') r.bottom += grow;
  if (S.edge === 'left') r.right += grow;
  if (S.edge === 'right') r.left -= grow;
  return inRect(p, r);
}

function overBar(p) {
  return inRect(p, rectOf(dock.querySelector('.dock-bg'), 2)) || els.some(({ el }) => inRect(p, rectOf(el)));
}

function overLayer(p) {
  return [...S.layer.children].some((c) => {
    if (c.classList.contains('fan')) return [...c.children].some((r) => inRect(p, rectOf(r, 4)));
    return inRect(p, rectOf(c, 2));
  });
}

function atEdge(p) {
  const t = 4;
  const r = rectOf(dock, 60);
  if (S.edge === 'bottom') return p.y >= innerHeight - t && p.x >= r.left && p.x <= r.right;
  if (S.edge === 'top') return p.y <= t && p.x >= r.left && p.x <= r.right;
  if (S.edge === 'left') return p.x <= t && p.y >= r.top && p.y <= r.bottom;
  return p.x >= innerWidth - t && p.y >= r.top && p.y <= r.bottom;
}

function setExpanded(v) {
  if (expanded === v) return;
  expanded = v;
  stage.classList.toggle('expanded', v);
  if (v) api.raise();
  if (!v) {
    hoverIdx = -1;
    label.classList.remove('show');
  }
  schedule();
  refreshHit();
}

function wantsOpen(p) {
  const mode = S.config.position.idle;
  if (S.dragging || popupOpen() || menuOpen()) return true;
  if (!p) return false;
  if (expanded) return overDockZone(p) || overLayer(p);
  if (mode === 'mini') return inRect(p, rectOf(handle, 10));
  if (mode === 'hidden') return atEdge(p);
  return overBar(p);
}

function evaluate() {
  const want = wantsOpen(pointer);
  const mode = S.config.position.idle;
  if (want && !expanded) {
    clearTimeout(hideTimer);
    hideTimer = null;
    if (!showTimer) {
      const delay = mode === 'hidden' || mode === 'mini' ? S.config.position.showDelay : 40;
      showTimer = setTimeout(() => {
        showTimer = null;
        if (wantsOpen(pointer)) setExpanded(true);
      }, delay);
    }
  } else if (!want && expanded) {
    clearTimeout(showTimer);
    showTimer = null;
    if (!hideTimer) {
      hideTimer = setTimeout(() => {
        hideTimer = null;
        if (!wantsOpen(pointer)) setExpanded(false);
      }, mode === 'normal' ? 80 : S.config.position.hideDelay);
    }
  } else if (want && expanded) {
    clearTimeout(hideTimer);
    hideTimer = null;
  } else {
    clearTimeout(showTimer);
    showTimer = null;
  }
}

// Decide si la ventana debe recibir el mouse o dejarlo pasar al escritorio.
function refreshHit() {
  const p = pointer;
  const mode = S.config?.position.idle;
  let need = false;
  if (S.dragging || externalDrag) need = true;
  else if (p) {
    if (overLayer(p)) need = true;
    else if (expanded) need = overBar(p);
    else if (mode === 'mini') need = inRect(p, rectOf(handle, 10));
    else if (mode !== 'hidden') need = overBar(p);
  }
  if (need !== interactive) {
    interactive = need;
    api.setInteractive(need);
  }
}
S.hooks.refreshHit = refreshHit;

function indexAt(p) {
  let best = -1;
  let bestD = Infinity;
  els.forEach(({ el }, i) => {
    const r = el.getBoundingClientRect();
    if (!inRect(p, { left: r.left - 3, right: r.right + 3, top: r.top - 3, bottom: r.bottom + 3 })) return;
    const c = isVertical() ? r.top + r.height / 2 : r.left + r.width / 2;
    const d = Math.abs(along(p) - c);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

let hoverCloseTimer = null;

function onPointer(x, y) {
  pointer = { x, y };
  lastMove = Date.now();
  const prev = hoverIdx;
  hoverIdx = expanded && overDockZone(pointer) ? indexAt(pointer) : -1;
  if (prev !== hoverIdx) maybeHoverOpen();
  checkHoverPopup();
  evaluate();
  refreshHit();
  schedule();
}

// Las ventanas abiertas al pasar el mouse se cierran al alejarse.
function checkHoverPopup() {
  if (!popupIsHover()) return clearTimeout(hoverCloseTimer);
  const inside = pointer && (overLayer(pointer) || (hoverIdx >= 0 && els[hoverIdx]?.item.id === popupItemId()));
  if (inside) {
    clearTimeout(hoverCloseTimer);
    hoverCloseTimer = null;
  } else if (!hoverCloseTimer) {
    hoverCloseTimer = setTimeout(() => {
      hoverCloseTimer = null;
      if (popupIsHover()) closePopup();
    }, 380);
  }
}

function maybeHoverOpen() {
  clearTimeout(hoverOpenTimer);
  if (S.config.behavior.openStacksOn !== 'hover' || hoverIdx < 0 || S.dragging) return;
  const { item, el } = els[hoverIdx];
  if (!hasPopup(item) || item.type === 'widget') return;
  hoverOpenTimer = setTimeout(() => {
    if (hoverIdx >= 0 && els[hoverIdx]?.item.id === item.id && popupItemId() !== item.id) openPopup(item, el, { hover: true });
  }, 320);
}

document.addEventListener('mousemove', (e) => {
  if (S.testHold) return;
  onPointer(e.clientX, e.clientY);
});
document.documentElement.addEventListener('mouseleave', () => {
  if (S.dragging || S.testHold) return;
  pointer = null;
  hoverIdx = -1;
  checkHoverPopup();
  evaluate();
  refreshHit();
  schedule();
});

// Si el mouse salió muy rápido de la ventana, se consulta su posición real.
setInterval(async () => {
  if (!pointer || S.dragging || S.testHold || Date.now() - lastMove < 300) return;
  if (!expanded && !interactive) return;
  try {
    const c = await api.cursor();
    if (c && Date.now() - lastMove >= 300) {
      if (c.x < 0 || c.y < 0 || c.x > innerWidth || c.y > innerHeight) {
        pointer = null;
        hoverIdx = -1;
      } else pointer = c;
      checkHoverPopup();
      evaluate();
      refreshHit();
      schedule();
    }
  } catch {}
}, 350);

window.addEventListener('blur', () => {
  if (S.dragging) return;
  closeMenu();
  if (popupOpen()) closePopup();
});

S.hooks.popupClosed = () => {
  evaluate();
  schedule();
};

// ---------- Clics, menú y rueda ----------

let press = null;

itemsEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const el = e.target.closest('.item');
  if (!el) return;
  const idx = els.findIndex((x) => x.el === el);
  if (idx < 0) return;
  press = { idx, x: e.clientX, y: e.clientY, id: e.pointerId, started: false, ev: e };
  el.setPointerCapture(e.pointerId);
});

itemsEl.addEventListener('pointermove', (e) => {
  if (!press || press.id !== e.pointerId) return;
  onPointer(e.clientX, e.clientY);
  if (!press.started && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) {
    if (S.config.behavior.locked || els[press.idx].item.type === 'add') return;
    startDrag(press, e);
  }
  if (press.started) moveDrag(e);
});

itemsEl.addEventListener('pointerup', (e) => {
  if (!press || press.id !== e.pointerId) return;
  const p = press;
  press = null;
  if (p.started) return endDrag(e);
  const { item, el } = els[p.idx] || {};
  if (!item) return;
  if (item.type === 'add') return dockMenu(e.clientX, e.clientY);
  activate(item, el, e);
});

itemsEl.addEventListener('pointercancel', () => {
  if (press?.started) cancelDrag();
  press = null;
});

stage.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (e.target.closest('#layer')) return;
  const el = e.target.closest('.item');
  const idx = el ? els.findIndex((x) => x.el === el) : -1;
  closePopup();
  if (idx >= 0 && els[idx].item.type !== 'add') itemMenu(els[idx].item, null, e.clientX, e.clientY);
  else dockMenu(e.clientX, e.clientY, insertIndexAt({ x: e.clientX, y: e.clientY }));
});

stage.addEventListener('mousedown', (e) => {
  if (e.button !== 0 && e.button !== 2) return;
  if (menuOpen() && !e.target.closest('.menu')) closeMenu();
  if (popupOpen() && !e.target.closest('#layer') && !e.target.closest('.item')) closePopup();
});

itemsEl.addEventListener(
  'wheel',
  (e) => {
    const el = e.target.closest('.item');
    const it = el && els.find((x) => x.el === el)?.item;
    if (it?.type !== 'action' || it.action !== 'workspaces') return;
    e.preventDefault();
    const list = S.config.workspaces;
    const i = list.findIndex((w) => w.id === S.config.activeWorkspace);
    const next = list[(i + (e.deltaY > 0 ? 1 : -1) + list.length) % list.length];
    if (next && next.id !== S.config.activeWorkspace) {
      api.patch({ activeWorkspace: next.id });
      toast(next.name, { timeout: 1000 });
    }
  },
  { passive: false }
);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMenu();
    closePopup();
  }
});

// ---------- Reordenar arrastrando ----------

let ghost = null;
let drag = null;

function startDrag(p, e) {
  p.started = true;
  S.dragging = true;
  closePopup();
  closeMenu();
  const { item, el } = els[p.idx];
  const r = el.getBoundingClientRect();
  ghost = h('div.drag-ghost', { html: el.querySelector('.ico').innerHTML + `<span class="poof-mark">${'✕'}</span>` });
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  S.layer.append(ghost);
  drag = { item, el, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, overGroup: null, groupTimer: null, poof: false };
  el.classList.add('dragging');
  targets = els.map(() => 1);
  schedule();
  refreshHit();
  moveDrag(e);
}

function flip(mutate) {
  const before = new Map(els.map(({ el }) => [el, el.getBoundingClientRect()]));
  mutate();
  for (const { el } of els) {
    const a = before.get(el);
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (!dx && !dy) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0,0)' }], { duration: 180, easing: 'cubic-bezier(.2,.9,.25,1)' });
  }
}

function moveDrag(e) {
  if (!drag) return;
  ghost.style.left = e.clientX - drag.dx + 'px';
  ghost.style.top = e.clientY - drag.dy + 'px';
  const p = { x: e.clientX, y: e.clientY };
  const S0 = parseFloat(dock.style.getPropertyValue('--s-full')) || 50;
  const r = rectOf(dock);
  const away = S.edge === 'bottom' ? r.top - p.y : S.edge === 'top' ? p.y - r.bottom : S.edge === 'left' ? p.x - r.right : r.left - p.x;
  drag.poof = away > S0 * 1.4;
  ghost.classList.toggle('poof', drag.poof);
  if (drag.poof) return setGroupTarget(null);

  // ¿Encima del centro de un grupo? → soltar dentro.
  const overIdx = els.findIndex(({ el, item }) => {
    if (item.type !== 'group' || el === drag.el || drag.item.type === 'group') return false;
    const q = el.getBoundingClientRect();
    const m = q.width * 0.22;
    return inRect(p, { left: q.left + m, right: q.right - m, top: q.top + m, bottom: q.bottom - m });
  });
  if (overIdx >= 0) return setGroupTarget(els[overIdx]);
  setGroupTarget(null);

  const from = els.findIndex((x) => x.el === drag.el);
  let to = insertIndexAt(p);
  if (to > from) to--;
  if (to !== from && to >= 0) {
    flip(() => {
      const [moved] = els.splice(from, 1);
      els.splice(to, 0, moved);
      const [mk] = ks.splice(from, 1);
      ks.splice(to, 0, mk);
      itemsEl.insertBefore(moved.el, els[to + 1]?.el || null);
    });
  }
}

function setGroupTarget(entry) {
  if (drag.overGroup === entry) return;
  drag.overGroup?.el.classList.remove('drop-into');
  drag.overGroup = entry;
  entry?.el.classList.add('drop-into');
}

function insertIndexAt(p) {
  let idx = els.length;
  for (let i = 0; i < els.length; i++) {
    const r = els[i].el.getBoundingClientRect();
    const c = isVertical() ? r.top + r.height / 2 : r.left + r.width / 2;
    if (along(p) < c) {
      idx = i;
      break;
    }
  }
  return idx;
}

async function endDrag() {
  const d = drag;
  cleanupDrag();
  if (!d) return;
  if (d.poof) {
    const { removeItem } = await import('./actions.js');
    return removeItem(d.item.id);
  }
  if (d.overGroup) {
    const items = JSON.parse(JSON.stringify(S.ws.items)).filter((i) => i.id !== d.item.id);
    const g = items.find((i) => i.id === d.overGroup.item.id);
    g.items = [...(g.items || []), d.item];
    toast(`Movido al grupo «${g.name}»`);
    return saveItems(items);
  }
  const order = els.map((x) => x.item);
  if (order.map((i) => i.id).join() !== S.ws.items.map((i) => i.id).join()) await saveItems(order);
}

function cancelDrag() {
  cleanupDrag();
  render();
}

function cleanupDrag() {
  drag?.el.classList.remove('dragging');
  drag?.overGroup?.el.classList.remove('drop-into');
  ghost?.remove();
  ghost = null;
  S.dragging = false;
  setTimeout(() => {
    evaluate();
    refreshHit();
  }, 30);
  const d = drag;
  drag = null;
  return d;
}

// ---------- Soltar archivos desde el Explorador ----------

let externalDrag = false;
let dropTarget = null;

function setDropTarget(entry) {
  if (dropTarget === entry) return;
  dropTarget?.el.classList.remove('drop-into');
  dropTarget = entry;
  entry?.el.classList.add('drop-into');
}

const DROP_INTO = (item) => ['group', 'shelf', 'folderStack'].includes(item.type) || (item.type === 'action' && item.action === 'trash');

stage.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('text/uri-list')) return;
  externalDrag = true;
  refreshHit();
  if (!expanded) setExpanded(true);
});

stage.addEventListener('dragover', (e) => {
  if (!externalDrag) return;
  e.preventDefault();
  pointer = { x: e.clientX, y: e.clientY };
  const idx = indexAt(pointer);
  const entry = idx >= 0 && DROP_INTO(els[idx].item) ? els[idx] : null;
  setDropTarget(entry);
  e.dataTransfer.dropEffect = entry?.item.type === 'folderStack' ? 'copy' : entry?.item.action === 'trash' ? 'move' : 'link';
});

stage.addEventListener('dragleave', (e) => {
  if (e.relatedTarget && stage.contains(e.relatedTarget)) return;
  externalDrag = false;
  setDropTarget(null);
  setTimeout(() => {
    evaluate();
    refreshHit();
  }, 50);
});

stage.addEventListener('drop', async (e) => {
  e.preventDefault();
  externalDrag = false;
  const target = dropTarget;
  setDropTarget(null);
  const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
  const urls = paths.length
    ? []
    : (e.dataTransfer.getData('text/uri-list') || '')
        .split(/\r?\n/)
        .filter((l) => l && !l.startsWith('#') && /^https?:/i.test(l));
  const p = { x: e.clientX, y: e.clientY };
  try {
    if (target && paths.length) {
      const it = target.item;
      if (it.type === 'shelf') {
        const n = await api.shelfAdd(paths);
        toast(n ? `${n} en el estante` : 'Ya estaban en el estante');
      } else if (it.type === 'folderStack') {
        const n = await api.copyInto(paths, it.target);
        toast(`${n} copiados a «${it.name}»`);
      } else if (it.type === 'action' && it.action === 'trash') {
        await api.trash(paths);
        toast('Enviado a la papelera');
      } else if (it.type === 'group') {
        await addItems(await api.describePaths(paths), null, it.id);
      }
    } else if (paths.length) {
      await addItems(await api.describePaths(paths), insertIndexAt(p));
    } else if (urls.length) {
      const items = urls.map((u) => {
        let name = u;
        try {
          name = new URL(u).hostname.replace(/^www\./, '');
          name = name.charAt(0).toUpperCase() + name.slice(1);
        } catch {}
        return { type: 'url', name, target: u };
      });
      await addItems(items, insertIndexAt(p));
    }
  } catch (er) {
    toast(er.message, { error: true });
  }
  setTimeout(() => {
    evaluate();
    refreshHit();
  }, 50);
});

// ---------- Ganchos para otros módulos ----------

S.hooks.itemMenu = itemMenu;
S.hooks.addItems = (items) => addItems(items);
S.hooks.updateItem = updateItem;

// Ganchos para la prueba automática (solo lectura y simulación de mouse).
window.__lzTest = {
  edge: () => S.edge,
  pointer: (x, y) => {
    S.testHold = true;
    onPointer(x, y);
  },
  open: (pred) => {
    const e = els.find(({ item }) => Object.entries(pred).every(([k, v]) => item[k] === v));
    if (!e) throw new Error('No hay elemento ' + JSON.stringify(pred));
    setExpanded(true);
    return activate(e.item, e.el, {});
  },
  close: () => {
    closeMenu();
    closePopup();
  },
  release: () => {
    S.testHold = false;
    pointer = null;
    hoverIdx = -1;
    evaluate();
    schedule();
  },
  menu: () => {
    const r = dock.getBoundingClientRect();
    dockMenu(r.left + r.width / 2, r.top - 10);
  },
};

// ---------- Arranque ----------

function refreshWidgets() {
  for (const { item, el } of els) {
    if (item.type !== 'widget' || (item.widget !== 'clock' && item.widget !== 'system')) continue;
    const ico = el.querySelector('.ico');
    if (ico) ico.innerHTML = widgetTile(item);
  }
}

async function boot() {
  setState(await api.getState());
  api.onState(setState);
  api.onFolderChanged((p) => {
    computeStackBadges(p);
    refreshIfShowing((it) => it.type === 'folderStack' && it.target === p);
  });
  api.onIconsRefresh(() => {
    renderKey = '';
    setState(S.state);
  });
  computeStackBadges();
  setInterval(refreshWidgets, 10000);
  setInterval(async () => {
    if (els.some((x) => x.item.type === 'widget' && x.item.widget === 'system')) {
      await refreshSystem();
      refreshWidgets();
    }
  }, 3000);
  refreshSystem().then(refreshWidgets);
  window.addEventListener('resize', () => {
    renderKey = '';
    setState(S.state);
  });
  document.body.classList.add('ready');
}

boot();
