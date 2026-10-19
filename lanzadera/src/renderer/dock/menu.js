// Menú contextual propio con estilo Windows 11 y submenús.
import { h, esc } from '../shared/dom.js';
import { S, gl } from './core.js';

let current = null;

export function menuOpen() {
  return !!current;
}

export function closeMenu() {
  if (!current) return;
  current.forEach((m) => m.remove());
  current = null;
  S.hooks.refreshHit?.();
}

// entries: [{ label, icon, hint, onClick, danger, disabled, checked, submenu: [...] } | '-' | { header }]
export function openMenu(x, y, entries) {
  closeMenu();
  document.getElementById('label')?.classList.remove('show');
  current = [];
  const root = build(entries, 0);
  position(root, x, y);
  S.hooks.refreshHit?.();
}

function build(entries, level) {
  const menu = h('div.menu');
  for (const e of entries.filter(Boolean)) {
    if (e === '-') {
      menu.append(h('div.msep'));
      continue;
    }
    if (e.header) {
      menu.append(h('div.mhead', { text: e.header }));
      continue;
    }
    const mi = h('div.mi' + (e.danger ? '.danger' : '') + (e.disabled ? '.disabled' : ''), {
      html:
        (e.checked !== undefined ? `<span class="check">${e.checked ? gl('check') : ''}</span>` : e.icon ? gl(e.icon) : '<span class="check"></span>') +
        `<span class="mlabel">${esc(e.label)}</span>` +
        (e.hint ? `<span class="mhint">${esc(e.hint)}</span>` : '') +
        (e.submenu ? gl('chevron-right') : ''),
    });
    if (e.submenu) {
      let sub = null;
      mi.addEventListener('mouseenter', () => {
        closeLevel(level + 1);
        sub = build(e.submenu, level + 1);
        const r = mi.getBoundingClientRect();
        position(sub, r.right - 4, r.top - 5, r.left + 4);
        mi.classList.add('active');
      });
    } else {
      mi.addEventListener('mouseenter', () => closeLevel(level + 1));
      mi.addEventListener('click', (ev) => {
        ev.stopPropagation();
        closeMenu();
        e.onClick?.();
      });
    }
    menu.append(mi);
  }
  menu.dataset.level = level;
  menu.addEventListener('contextmenu', (ev) => ev.preventDefault());
  S.layer.append(menu);
  current.push(menu);
  return menu;
}

function closeLevel(level) {
  if (!current) return;
  current = current.filter((m) => {
    if (Number(m.dataset.level) >= level) {
      m.remove();
      return false;
    }
    return true;
  });
  current.forEach((m) => {
    if (Number(m.dataset.level) === level - 1) m.querySelectorAll('.mi.active').forEach((x) => x.classList.remove('active'));
  });
}

function position(menu, x, y, altX) {
  const r = menu.getBoundingClientRect();
  let left = x;
  if (left + r.width > innerWidth - 6) left = altX !== undefined ? altX - r.width : innerWidth - r.width - 6;
  let top = y;
  if (top + r.height > innerHeight - 6) top = Math.max(6, (altX !== undefined ? innerHeight - 6 : y) - r.height);
  menu.style.left = Math.max(6, left) + 'px';
  menu.style.top = Math.max(6, top) + 'px';
}
