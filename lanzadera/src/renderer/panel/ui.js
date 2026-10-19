// Componentes del panel (estilo Windows 11).
import { h, esc } from '../shared/dom.js';
import { glyphSVG } from '../shared/tiles.js';

export const gl = (n) => glyphSVG(n);

export function page(title, subtitle, ...children) {
  return h('div.page', h('h1', { html: esc(title) + (subtitle ? `<small>${esc(subtitle)}</small>` : '') }), ...children);
}

export function section(title, ...children) {
  return [h('div.section-title', { text: title }), h('div.cards', ...children)];
}

export function card({ icon, title, desc, control, onClick, col }) {
  const el = h('div.card' + (onClick ? '.click' : '') + (col ? '.col' : ''), { onclick: onClick });
  const head = col ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '16px' } }) : el;
  if (icon) head.append(h('div.cicon', { html: gl(icon) }));
  head.append(h('div.ctext', h('div.ctitle', { text: title }), desc ? h('div.cdesc', { html: desc }) : null));
  if (col) {
    el.append(head);
    if (control) el.append(control);
  } else if (control) {
    el.append(h('div.cctl', control));
  }
  return el;
}

export function toggle(value, onChange, label) {
  const input = h('input', { type: 'checkbox' });
  input.checked = !!value;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label.toggle', label ? h('span', { text: input.checked ? label[0] : label[1] }) : null, input, h('span.sw'));
}

export function seg(options, value, onChange) {
  const box = h('div.seg');
  for (const [v, label, icon] of options) {
    const b = h('button' + (String(v) === String(value) ? '.on' : ''), { html: (icon ? gl(icon) : '') + esc(label) });
    b.addEventListener('click', () => {
      box.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      onChange(v);
    });
    box.append(b);
  }
  return box;
}

export function select(options, value, onChange) {
  const s = h('select');
  for (const [v, label] of options) {
    const o = h('option', { value: String(v), text: label });
    if (String(v) === String(value)) o.selected = true;
    s.append(o);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function slider({ min, max, step = 1, value, format = (v) => v, onChange }) {
  const input = h('input', { type: 'range', min, max, step });
  input.value = value;
  const val = h('span.val', { text: format(Number(value)) });
  const paint = () => input.style.setProperty('--p', ((input.value - min) / (max - min)) * 100 + '%');
  paint();
  input.addEventListener('input', () => {
    val.textContent = format(Number(input.value));
    paint();
  });
  input.addEventListener('change', () => onChange(Number(input.value)));
  return h('div.slider', input, val);
}

export function button(label, onClick, { icon, primary, danger, ghost, title, small } = {}) {
  const cls = 'button.btn' + (primary ? '.primary' : '') + (danger ? '.danger' : '') + (ghost ? '.ghost' : '') + (!label ? '.icon' : '');
  const b = h(cls, { html: (icon ? gl(icon) : '') + (label ? `<span>${esc(label)}</span>` : ''), title: title || label || '' });
  if (small) b.style.height = '28px';
  b.addEventListener('click', onClick);
  return b;
}

let dd = null;
export function dropdown(anchor, entries) {
  closeDropdown();
  dd = h('div.dropdown');
  for (const e of entries.filter(Boolean)) {
    if (e === '-') {
      dd.append(h('div.msep'));
      continue;
    }
    if (e.header) {
      dd.append(h('div.mhead', { text: e.header }));
      continue;
    }
    const mi = h('div.mi', { html: (e.icon ? gl(e.icon) : '') + `<span>${esc(e.label)}</span>` });
    mi.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeDropdown();
      e.onClick();
    });
    dd.append(mi);
  }
  document.body.append(dd);
  const r = anchor.getBoundingClientRect();
  const m = dd.getBoundingClientRect();
  dd.style.left = Math.min(r.left, innerWidth - m.width - 8) + 'px';
  dd.style.top = (r.bottom + 4 + m.height > innerHeight ? Math.max(8, r.top - m.height - 4) : r.bottom + 4) + 'px';
  setTimeout(() => document.addEventListener('click', closeDropdown, { once: true }), 0);
}

export function closeDropdown() {
  dd?.remove();
  dd = null;
}

export function modal({ title, body, buttons = [], size = '', onClose }) {
  const back = h('div.modal-back');
  const box = h('div.modal' + (size ? '.' + size : ''));
  const foot = h('div.modal-foot');
  for (const b of buttons) foot.append(b);
  box.append(h('div.modal-head', { text: title }), h('div.modal-body', body), buttons.length ? foot : null);
  back.append(box);
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => {
    if (e.target === back) close();
  });
  document.body.append(back);
  return { close, box, foot };
}

export function confirmDialog(title, text, okLabel = 'Aceptar', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title,
      size: 'small',
      body: h('p', { style: { margin: 0, color: 'var(--text-2)', lineHeight: 1.5 }, text }),
      buttons: [
        button('Cancelar', () => {
          done = true;
          m.close();
          resolve(false);
        }),
        button(okLabel, () => {
          done = true;
          m.close();
          resolve(true);
        }, { primary: !danger, danger }),
      ],
      onClose: () => !done && resolve(false),
    });
  });
}

let toastT = null;
export function toast(text, error = false) {
  document.querySelector('.toast-p')?.remove();
  const t = h('div.toast-p' + (error ? '.err' : ''), { text });
  document.body.append(t);
  clearTimeout(toastT);
  toastT = setTimeout(() => t.remove(), 2800);
}

export function field(label, control) {
  return h('div.field', h('label', { text: label }), control);
}

export function input(value, onInput, attrs = {}) {
  const i = h('input', { type: 'text', ...attrs });
  i.value = value ?? '';
  if (onInput) i.addEventListener('input', () => onInput(i.value));
  return i;
}
