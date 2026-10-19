// Estado compartido del dock y utilidades comunes.
import { h, esc } from '../shared/dom.js';
import { glyphSVG } from '../shared/tiles.js';

export const S = {
  state: null,
  config: null,
  ws: null,
  edge: 'bottom',
  layer: null,
  stage: null,
  dragging: false,
  frozen: false,
  hooks: {},
};

export const api = window.lanz;

export function ap() {
  return S.config.appearance;
}

export function isVertical() {
  return S.edge === 'left' || S.edge === 'right';
}

export function findItem(id, items = S.ws?.items || []) {
  for (const it of items) {
    if (it.id === id) return { item: it, parent: null };
    if (it.type === 'group') for (const k of it.items || []) if (k.id === id) return { item: k, parent: it };
  }
  return null;
}

export async function saveItems(items) {
  S.ws.items = items;
  await api.setItems(S.ws.id, items);
}

let toastEl = null;
let toastTimer = null;

export function toast(text, opts = {}) {
  toastEl?.remove();
  clearTimeout(toastTimer);
  const el = h('div.toast' + (opts.error ? '.err' : ''), { html: `<span>${esc(text)}</span>` });
  if (opts.action) {
    el.append(
      h('button.btn', {
        text: opts.action.label,
        onclick: () => {
          el.remove();
          opts.action.fn();
        },
      })
    );
  }
  S.layer.append(el);
  placeNearDock(el);
  toastEl = el;
  toastTimer = setTimeout(() => el.remove(), opts.timeout || (opts.action ? 6000 : 2600));
  S.hooks.refreshHit?.();
}

// Coloca un elemento centrado junto a la barra, del lado de la pantalla.
export function placeNearDock(el) {
  const dock = document.getElementById('dock').getBoundingClientRect();
  const W = innerWidth;
  const H = innerHeight;
  const r = el.getBoundingClientRect();
  const gap = 14;
  let x;
  let y;
  if (S.edge === 'bottom') {
    x = dock.left + dock.width / 2 - r.width / 2;
    y = dock.top - r.height - gap - S.config.appearance.iconSize * 0.4;
  } else if (S.edge === 'top') {
    x = dock.left + dock.width / 2 - r.width / 2;
    y = dock.bottom + gap + S.config.appearance.iconSize * 0.4;
  } else if (S.edge === 'left') {
    x = dock.right + gap + S.config.appearance.iconSize * 0.4;
    y = dock.top + dock.height / 2 - r.height / 2;
  } else {
    x = dock.left - r.width - gap - S.config.appearance.iconSize * 0.4;
    y = dock.top + dock.height / 2 - r.height / 2;
  }
  el.style.left = Math.max(8, Math.min(W - r.width - 8, x)) + 'px';
  el.style.top = Math.max(8, Math.min(H - r.height - 8, y)) + 'px';
}

export async function launchItem(item, opts = {}) {
  try {
    await api.launch(item, opts);
    return true;
  } catch (e) {
    toast(e.message || 'No se pudo abrir', { error: true });
    return false;
  }
}

export function gl(name) {
  return glyphSVG(name);
}

export function confirmText(item) {
  return item.name || item.target || 'elemento';
}
