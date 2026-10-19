// Widgets del dock: reloj con calendario, rendimiento, portapapeles y notas rápidas.
import { h, esc, timeAgo, formatSize, uid, debounce } from '../shared/dom.js';
import { tileSVG, gradientColors } from '../shared/tiles.js';
import { S, api, ap, gl, toast } from './core.js';

const FONT = "'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif";
let sysCache = { cpu: 0, mem: 0 };

export function widgetTile(item) {
  const a = ap();
  const colors = gradientColors(item.icon?.gradient || 'medianoche', item.icon?.colors);
  const style = item.icon?.style || (a.tileStyle === 'minimal' ? 'glass' : a.tileStyle);
  if (item.widget === 'clock') {
    const now = new Date();
    const time = now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: !!S.config.clock.hour12 }).replace(/\s?(a|p)\.?\s?m\.?/i, '');
    const day = now.toLocaleDateString('es', { weekday: 'short', day: 'numeric' }).replace('.', '').toUpperCase();
    const content =
      `<text x="50" y="45" text-anchor="middle" font-size="${time.length > 5 ? 26 : 29}" font-weight="650" letter-spacing="-.5" fill="currentColor" font-family="${FONT}">${esc(time)}</text>` +
      `<text x="50" y="70" text-anchor="middle" font-size="14" font-weight="600" letter-spacing="1" fill="currentColor" opacity=".72" font-family="${FONT}">${esc(day)}</text>`;
    return tileSVG({ content, colors, style, shape: a.tileShape });
  }
  if (item.widget === 'system') {
    const ring = (r, pct, color, w) => {
      const c = 2 * Math.PI * r;
      return (
        `<circle cx="50" cy="50" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".16" stroke-width="${w}"/>` +
        `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${((c * pct) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/>`
      );
    };
    const content =
      ring(31, sysCache.cpu, '#22d3ee', 7) +
      ring(21, sysCache.mem, '#a78bfa', 7) +
      `<text x="50" y="51" text-anchor="middle" dominant-baseline="central" font-size="15" font-weight="700" fill="currentColor" font-family="${FONT}">${sysCache.cpu}</text>`;
    return tileSVG({ content, colors, style, shape: a.tileShape });
  }
  return null;
}

export async function refreshSystem() {
  try {
    const s = await api.sysStats();
    sysCache = s;
    return s;
  } catch {
    return sysCache;
  }
}

// ---------- Contenido de ventanas emergentes ----------

export function calendarView() {
  const box = h('div.cal');
  let ref = new Date();
  ref.setDate(1);
  const draw = () => {
    const today = new Date();
    const y = ref.getFullYear();
    const m = ref.getMonth();
    const first = (new Date(y, m, 1).getDay() + 6) % 7;
    const days = new Date(y, m + 1, 0).getDate();
    const prevDays = new Date(y, m, 0).getDate();
    const title = ref.toLocaleDateString('es', { month: 'long', year: 'numeric' });
    const cells = [];
    for (const wd of ['L', 'M', 'X', 'J', 'V', 'S', 'D']) cells.push(`<div class="wd">${wd}</div>`);
    for (let i = 0; i < 42; i++) {
      const d = i - first + 1;
      let cls = 'd';
      let label = d;
      if (d < 1) {
        cls += ' other';
        label = prevDays + d;
      } else if (d > days) {
        cls += ' other';
        label = d - days;
      } else if (d === today.getDate() && m === today.getMonth() && y === today.getFullYear()) cls += ' today';
      cells.push(`<div class="${cls}">${label}</div>`);
      if (i >= 34 && d >= days) break;
    }
    const now = today.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: !!S.config.clock.hour12 });
    const long = today.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    box.innerHTML =
      `<div class="cal-now"><div class="big">${esc(now)}</div><div class="sub">${esc(long)}</div></div>` +
      `<div class="cal-top"><span class="cal-title">${esc(title)}</span>` +
      `<button class="btn icon ghost" data-a="prev" title="Mes anterior">${gl('chevron-left')}</button>` +
      `<button class="btn icon ghost" data-a="today" title="Hoy">${gl('calendar-check')}</button>` +
      `<button class="btn icon ghost" data-a="next" title="Mes siguiente">${gl('chevron-right')}</button></div>` +
      `<div class="cal-grid">${cells.join('')}</div>`;
  };
  box.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'prev') ref.setMonth(ref.getMonth() - 1);
    if (a === 'next') ref.setMonth(ref.getMonth() + 1);
    if (a === 'today') {
      ref = new Date();
      ref.setDate(1);
    }
    if (a) draw();
  });
  draw();
  const t = setInterval(draw, 15000);
  box.cleanup = () => clearInterval(t);
  return box;
}

function ringSVG(pct, color) {
  const r = 40;
  const c = 2 * Math.PI * r;
  return `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".12" stroke-width="10"/><circle cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${((c * pct) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)" style="transition:stroke-dasharray .6s"/><text x="50" y="52" text-anchor="middle" dominant-baseline="central" font-size="20" font-weight="700" fill="currentColor" font-family="${FONT}">${pct}%</text></svg>`;
}

function fmtUptime(s) {
  const d = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return d ? `${d} d ${hh} h` : hh ? `${hh} h ${mm} min` : `${mm} min`;
}

export function systemView() {
  const box = h('div.sys');
  let battery = null;
  navigator.getBattery?.().then((b) => {
    battery = b;
    draw(sysCache);
  });
  const draw = (s) => {
    const disk = s.disk ? Math.round(((s.disk.total - s.disk.free) / s.disk.total) * 100) : null;
    const bat = battery && !(battery.charging && battery.level === 1 && battery.chargingTime === 0) ? battery : null;
    box.innerHTML =
      `<div class="rings"><div class="ring">${ringSVG(s.cpu || 0, '#22d3ee')}Procesador</div><div class="ring">${ringSVG(s.mem || 0, '#a78bfa')}Memoria</div></div>` +
      `<div><div class="kv"><span>Memoria en uso</span><b>${formatSize(s.memUsed)} de ${formatSize(s.memTotal)}</b></div></div>` +
      (disk !== null ? `<div><div class="kv"><span>Disco ${esc(s.disk.root)}</span><b>${formatSize(s.disk.free)} libres</b></div><div class="bar"><i style="width:${disk}%"></i></div></div>` : '') +
      (bat ? `<div><div class="kv"><span>Batería ${bat.charging ? '· cargando' : ''}</span><b>${Math.round(bat.level * 100)}%</b></div><div class="bar"><i style="width:${Math.round(bat.level * 100)}%;background:linear-gradient(90deg,#4ade80,#16a34a)"></i></div></div>` : '') +
      `<div class="kv"><span>Encendido desde hace</span><b>${fmtUptime(s.uptime || 0)}</b></div>` +
      `<div class="kv"><span>${esc(s.cpuModel || 'Procesador')}</span><b>${s.cores || ''} núcleos</b></div>`;
  };
  draw(sysCache);
  const tick = async () => draw(await refreshSystem());
  tick();
  const t = setInterval(tick, 1500);
  box.cleanup = () => clearInterval(t);
  return box;
}

export function clipboardView(onClose) {
  const box = h('div', { style: { width: '380px' } });
  const search = h('input.searchbox', { type: 'search', placeholder: 'Buscar en el historial…' });
  const list = h('div.list');
  box.append(search, list);
  let data = { items: [], enabled: true, paused: false };
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const items = data.items.filter((i) => !q || i.text.toLowerCase().includes(q));
    list.innerHTML = '';
    if (!data.enabled) {
      list.append(h('div.empty', { text: 'El historial está desactivado. Actívalo en Configuración › Widgets.' }));
      return;
    }
    if (!items.length) {
      list.append(h('div.empty', { text: q ? 'Sin resultados' : 'Copia un texto (Ctrl+C) y aparecerá aquí.' }));
      return;
    }
    for (const it of items) {
      const row = h('div.row.clip-item', {
        html:
          `<div class="rtext"><div class="rname">${it.pinned ? `<span class="pinned-mark">${gl('pin')}</span> ` : ''}${esc(it.text.slice(0, 300))}</div><div class="rmeta">${timeAgo(it.ts)} · ${it.text.length} caracteres</div></div>` +
          `<div class="ract"><button class="btn" data-a="pin" title="${it.pinned ? 'Desfijar' : 'Fijar'}">${gl(it.pinned ? 'pin-off' : 'pin')}</button><button class="btn" data-a="del" title="Quitar">${gl('x')}</button></div>`,
      });
      row.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        e.stopPropagation();
        if (a === 'pin') return api.clipPin(it.id);
        if (a === 'del') return api.clipRemove(it.id);
        await api.clipCopy(it.id);
        toast('Copiado al portapapeles');
        onClose?.();
      });
      list.append(row);
    }
  };
  search.addEventListener('input', draw);
  const off = api.onClip((d) => {
    data = d;
    draw();
  });
  api.clipList().then((d) => {
    data = d;
    draw();
  });
  box.cleanup = off;
  box.focusEl = search;
  box.headButtons = () => [
    h('button.btn.ghost', {
      html: gl(data.paused ? 'play' : 'pause'),
      title: data.paused ? 'Reanudar' : 'Pausar',
      class: 'icon',
      onclick: async (e) => {
        await api.clipPause(!data.paused);
        e.currentTarget.innerHTML = gl(!data.paused ? 'play' : 'pause');
      },
    }),
    h('button.btn.ghost', { text: 'Limpiar', onclick: () => api.clipClear() }),
  ];
  box.foot = S.config.clipboard.persist ? 'Los elementos fijados y recientes se guardan en este equipo.' : 'Solo se guarda en memoria: se borra al cerrar Lanzadera (los fijados se conservan).';
  return box;
}

const NOTE_COLORS = { ambar: '#fde68a', rosa: '#fbcfe8', menta: '#a7f3d0', cielo: '#bae6fd', lila: '#ddd6fe', blanco: '#f8fafc' };

export function notesView() {
  const box = h('div.notes');
  let notes = (S.config.notes || []).map((n) => ({ ...n }));
  if (!notes.length) notes = [{ id: uid(), text: '', color: 'ambar', ts: Date.now() }];
  const save = debounce(() => api.patch({ notes }), 400);
  const draw = () => {
    box.innerHTML = '';
    for (const n of notes) {
      const ta = h('textarea', { placeholder: 'Escribe una nota…', spellcheck: 'true' });
      ta.value = n.text;
      ta.addEventListener('input', () => {
        n.text = ta.value;
        n.ts = Date.now();
        save();
      });
      const tools = h('div.ntools');
      for (const [k, c] of Object.entries(NOTE_COLORS)) {
        tools.append(
          h('span.sw', {
            style: { background: c },
            title: k,
            onclick: () => {
              n.color = k;
              save();
              draw();
            },
          })
        );
      }
      tools.append(
        h('button.btn', {
          html: gl('copy'),
          title: 'Copiar',
          onclick: () => navigator.clipboard?.writeText(n.text).then(() => toast('Nota copiada')),
        }),
        h('button.btn', {
          html: gl('trash'),
          title: 'Borrar nota',
          onclick: () => {
            notes = notes.filter((x) => x !== n);
            if (!notes.length) notes = [{ id: uid(), text: '', color: 'ambar', ts: Date.now() }];
            save();
            draw();
          },
        })
      );
      box.append(h('div.note', { style: { background: NOTE_COLORS[n.color] || NOTE_COLORS.ambar } }, ta, tools));
    }
    box.focusEl = box.querySelector('textarea');
  };
  draw();
  box.headButtons = () => [
    h('button.btn.ghost', {
      html: gl('plus') + ' Nueva',
      onclick: () => {
        notes.unshift({ id: uid(), text: '', color: Object.keys(NOTE_COLORS)[notes.length % 6], ts: Date.now() });
        save();
        draw();
        box.querySelector('textarea')?.focus();
      },
    }),
  ];
  box.cleanup = () => save();
  return box;
}
