// Ventanas emergentes del dock: grupos, pilas de carpetas, estante, widgets y más.
import { h, esc, timeAgo, formatSize, normalize, extname } from '../shared/dom.js';
import { iconHTML, fileIconHTML } from '../shared/icon-view.js';
import { tileSVG, gradientColors } from '../shared/tiles.js';
import { S, api, ap, gl, toast, launchItem, isVertical } from './core.js';
import { calendarView, systemView, clipboardView, notesView } from './widgets.js';
import { openMenu } from './menu.js';

let cur = null;

export function popupOpen() {
  return !!cur;
}

export function popupItemId() {
  return cur?.item?.id || null;
}

export function popupEls() {
  return cur ? [cur.el] : [];
}

export function closePopup() {
  if (!cur) return;
  const c = cur;
  cur = null;
  c.content?.cleanup?.();
  c.anchor?.classList.remove('open-indicator');
  c.el.classList.add('closing');
  setTimeout(() => c.el.remove(), 140);
  S.frozen = false;
  S.hooks.popupClosed?.();
  S.hooks.refreshHit?.();
}

export function popupIsHover() {
  return !!cur?.hover;
}

export function togglePopup(item, anchor, opts = {}) {
  if (cur && cur.item.id === item.id) {
    if (cur.hover && !opts.hover) {
      cur.hover = false;
      return;
    }
    return closePopup();
  }
  return openPopup(item, anchor, opts);
}

function maxSize() {
  const a = cur?.anchorRect;
  const pad = 16;
  if (!a) return { w: innerWidth - pad * 2, h: innerHeight - pad * 2 };
  if (S.edge === 'bottom') return { w: innerWidth - pad * 2, h: a.top - pad - 14 };
  if (S.edge === 'top') return { w: innerWidth - pad * 2, h: innerHeight - a.bottom - pad - 14 };
  if (S.edge === 'left') return { w: innerWidth - a.right - pad - 14, h: innerHeight - pad * 2 };
  return { w: a.left - pad - 14, h: innerHeight - pad * 2 };
}

function place(el, a) {
  const r = el.getBoundingClientRect();
  const gap = 14;
  let x;
  let y;
  let ox = '0px';
  let oy = '0px';
  if (S.edge === 'bottom') {
    x = a.left + a.width / 2 - r.width / 2;
    y = a.top - gap - r.height;
    oy = '12px';
  } else if (S.edge === 'top') {
    x = a.left + a.width / 2 - r.width / 2;
    y = a.bottom + gap;
    oy = '-12px';
  } else if (S.edge === 'left') {
    x = a.right + gap;
    y = a.top + a.height / 2 - r.height / 2;
    ox = '-12px';
  } else {
    x = a.left - gap - r.width;
    y = a.top + a.height / 2 - r.height / 2;
    ox = '12px';
  }
  el.style.left = Math.round(Math.max(8, Math.min(innerWidth - r.width - 8, x))) + 'px';
  el.style.top = Math.round(Math.max(8, Math.min(innerHeight - r.height - 8, y))) + 'px';
  el.style.setProperty('--ox', ox);
  el.style.setProperty('--oy', oy);
}

// ---------- Entradas y vistas ----------

function itemEntry(it, parent) {
  return {
    name: it.name || it.target || 'Sin nombre',
    ico: iconHTML(it, ap()),
    open: (ev) => launchItem(it, { admin: ev?.ctrlKey && ev?.shiftKey }),
    menu: (x, y) => S.hooks.itemMenu?.(it, parent, x, y),
    dragPath: ['file', 'folder'].includes(it.type) || (it.type === 'app' && it.target && !it.appId) ? it.target : null,
  };
}

function fileEntry(e, extra = {}) {
  const name = e.ext === 'lnk' || e.ext === 'url' ? e.name.replace(/\.(lnk|url)$/i, '') : e.name;
  const item = { type: e.isDir ? 'folder' : e.ext === 'lnk' || e.ext === 'exe' ? 'app' : 'file', name, target: e.path };
  return {
    name,
    ico: fileIconHTML(e, ap()),
    meta: [e.mtime ? timeAgo(e.mtime) : '', !e.isDir && Number.isFinite(e.size) ? formatSize(e.size) : ''].filter(Boolean).join(' · '),
    open: () => launchItem(item),
    menu: (x, y) => fileMenu(e, item, x, y, extra),
    dragPath: e.path,
    remove: extra.remove,
  };
}

function fileMenu(e, item, x, y, extra) {
  openMenu(x, y, [
    { label: 'Abrir', icon: 'external-link', onClick: () => launchItem(item) },
    { label: 'Mostrar en la carpeta', icon: 'folder-search', onClick: () => api.reveal(e.path).catch((er) => toast(er.message, { error: true })) },
    { label: 'Copiar ruta', icon: 'copy', onClick: () => navigator.clipboard.writeText(e.path).then(() => toast('Ruta copiada')) },
    '-',
    { label: 'Fijar en el dock', icon: 'pin', onClick: () => S.hooks.addItems?.([item]) },
    { label: 'Añadir al estante', icon: 'inbox', onClick: () => api.shelfAdd([e.path]).then(() => toast('Añadido al estante')) },
    extra.remove ? { label: 'Quitar del estante', icon: 'x', onClick: extra.remove } : null,
    '-',
    {
      label: 'Enviar a la papelera',
      icon: 'trash',
      danger: true,
      onClick: () =>
        api
          .trash([e.path])
          .then(() => {
            toast('Enviado a la papelera');
            if (cur) refresh();
          })
          .catch((er) => toast(er.message, { error: true })),
    },
  ]);
}

function bindEntry(el, entry) {
  el.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-a]')) return;
    entry.open(ev);
    closePopup();
  });
  el.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    entry.menu?.(ev.clientX, ev.clientY);
  });
  if (entry.dragPath) {
    el.draggable = true;
    el.addEventListener('dragstart', (ev) => {
      ev.preventDefault();
      api.startDrag([entry.dragPath]);
    });
  }
}

function gridView(entries) {
  const cols = Math.max(3, Math.min(6, Math.ceil(Math.sqrt(entries.length * 1.6))));
  const grid = h('div.grid', { style: { '--cols': Math.min(cols, Math.max(1, entries.length)) } });
  grid.style.setProperty('--cols', String(Math.max(Math.min(cols, entries.length), 3)));
  for (const e of entries) {
    const cell = h('div.cell', { title: e.meta ? `${e.name}\n${e.meta}` : e.name, html: `<div class="cico">${e.ico}</div><div class="cname">${esc(e.name)}</div>` });
    bindEntry(cell, e);
    grid.append(cell);
  }
  return grid;
}

function listView(entries) {
  const list = h('div.list', { style: { width: '340px' } });
  for (const e of entries) {
    const row = h('div.row', {
      html:
        `<div class="rico">${e.ico}</div><div class="rtext"><div class="rname">${esc(e.name)}</div>${e.meta ? `<div class="rmeta">${esc(e.meta)}</div>` : ''}</div>` +
        (e.remove ? `<div class="ract"><button class="btn" data-a="rm" title="Quitar">${gl('x')}</button></div>` : ''),
    });
    if (e.remove) row.querySelector('[data-a=rm]').addEventListener('click', (ev) => (ev.stopPropagation(), e.remove()));
    bindEntry(row, e);
    list.append(row);
  }
  return list;
}

function fanView(entries, anchorRect, more) {
  const fan = h('div.fan');
  const rowH = 62;
  const room = maxSize().h - 10;
  const maxRows = Math.max(3, Math.floor(room / rowH));
  const shown = entries.slice(0, entries.length > maxRows ? maxRows - 1 : maxRows);
  const cx = anchorRect.left + anchorRect.width / 2;
  const down = S.edge === 'top';
  const rows = [...shown.map((e) => ({ e })), ...(entries.length > shown.length || more ? [{ more: true }] : [])];
  rows.forEach((r, i) => {
    const curve = Math.pow(i, 1.75) * 0.9;
    const row = h('div.fan-row');
    row.style.animationDelay = `${i * 22}ms`;
    if (r.more) {
      row.classList.add('fan-more');
      row.innerHTML = `<span class="fname">${esc(more?.label || `Ver los ${entries.length}`)} →</span><div class="fico">${tileSVG({ glyph: 'layout-grid', colors: gradientColors('grafito'), style: 'glass', shape: ap().tileShape })}</div>`;
      row.addEventListener('click', () => (more?.fn ? more.fn() : null));
    } else {
      row.innerHTML = `<span class="fname">${esc(r.e.name)}</span><div class="fico">${r.e.ico}</div>`;
      bindEntry(row, r.e);
    }
    const iconRight = cx + 27 + curve;
    row.style.left = `${iconRight}px`;
    row.style.transform = 'translateX(-100%)';
    if (down) row.style.top = `${anchorRect.bottom + 16 + i * rowH}px`;
    else row.style.top = `${anchorRect.top - 16 - (i + 1) * rowH + 4}px`;
    fan.append(row);
  });
  fan.style.inset = '0';
  return fan;
}

// ---------- Apertura ----------

export async function openPopup(item, anchor, opts = {}) {
  if (cur) closePopup();
  const anchorRect = anchor.getBoundingClientRect();
  cur = { item, anchor, anchorRect, hover: !!opts.hover, el: null, content: null };
  const token = cur;
  S.frozen = true;
  anchor.classList.add('open-indicator');
  document.getElementById('label')?.classList.remove('show');

  const built = await buildContent(item, anchorRect);
  if (cur !== token || !built) {
    if (cur === token) closePopup();
    return;
  }
  if (built.fan) {
    cur.el = built.fan;
    S.layer.append(built.fan);
  } else {
    const el = h('div.popup');
    const head = h('div.pop-head', { html: `<h3>${esc(built.title)}${built.meta ? `<span class="meta">${esc(built.meta)}</span>` : ''}</h3>` });
    for (const b of built.buttons || []) head.append(b);
    const body = h('div.pop-body');
    body.append(built.body);
    el.append(head, body);
    if (built.foot) el.append(h('div.pop-foot', { text: built.foot }));
    const m = maxSize();
    el.style.maxHeight = Math.max(200, m.h) + 'px';
    el.style.maxWidth = Math.max(280, m.w) + 'px';
    S.layer.append(el);
    place(el, anchorRect);
    cur.el = el;
    if (built.focus) {
      api.focusDock();
      setTimeout(() => built.focus.focus(), 60);
    }
  }
  cur.content = built.body || built;
  cur.cleanup = built.cleanup;
  S.hooks.refreshHit?.();
}

async function refresh() {
  if (!cur) return;
  const { item, anchor } = cur;
  closePopup();
  await openPopup(item, anchor);
}

export function refreshIfShowing(predicate) {
  if (cur && predicate(cur.item)) refresh();
}

function headBtn(icon, label, fn, title) {
  return h('button.btn.ghost' + (label ? '' : '.icon'), { html: gl(icon) + (label ? ' ' + esc(label) : ''), title: title || label, onclick: fn });
}

async function buildContent(item, anchorRect) {
  const layout = (n) => {
    const l = item.layout || 'grid';
    if (l === 'fan' && (isVertical() || n > 14 || n === 0)) return n > 10 ? 'grid' : 'list';
    return l;
  };
  const wrap = (entries, base) => {
    const l = layout(entries.length);
    if (!entries.length) return { ...base, body: h('div.empty', { text: base.emptyText || 'Vacío' }) };
    if (l === 'fan') return { fan: fanView(entries, anchorRect, base.more) };
    return { ...base, body: l === 'list' ? listView(entries) : gridView(entries) };
  };

  switch (item.type) {
    case 'group': {
      const entries = (item.items || []).map((k) => itemEntry(k, item));
      return wrap(entries, {
        title: item.name || 'Grupo',
        meta: `${entries.length}`,
        emptyText: 'Grupo vacío: arrastra programas o archivos sobre su icono.',
        buttons: [
          headBtn('rocket', 'Abrir todo', async () => {
            closePopup();
            const r = await api.launchMany(item.items || []);
            if (r.errors.length) toast(r.errors[0], { error: true });
          }),
          headBtn('pencil', '', () => api.openPanel(`/elementos?id=${item.id}`), 'Editar grupo'),
        ],
        more: { label: 'Editar grupo', fn: () => api.openPanel(`/elementos?id=${item.id}`) },
      });
    }
    case 'folderStack': {
      const res = await api.listFolder(item.target, { sort: item.sort || 'date', max: item.max || 40 });
      api.patch({ stackSeen: { [item.id]: Date.now() } });
      const entries = res.entries.map((e) => fileEntry(e));
      const sortNames = { date: 'Fecha', name: 'Nombre', kind: 'Tipo', size: 'Tamaño' };
      return wrap(entries, {
        title: item.name,
        meta: res.error || `${res.total} elementos`,
        emptyText: res.error || 'Esta carpeta está vacía.',
        buttons: [
          headBtn('arrow-down-up', sortNames[item.sort || 'date'], () => {
            const order = ['date', 'name', 'kind', 'size'];
            const next = order[(order.indexOf(item.sort || 'date') + 1) % order.length];
            S.hooks.updateItem?.(item.id, { sort: next });
            item.sort = next;
            refresh();
          }, 'Ordenar por'),
          headBtn('folder-open', 'Abrir carpeta', () => {
            closePopup();
            launchItem({ type: 'folder', target: item.target });
          }),
        ],
        more: { label: 'Abrir en el Explorador', fn: () => (closePopup(), launchItem({ type: 'folder', target: item.target })) },
      });
    }
    case 'recent': {
      const list = await api.recent();
      const entries = list.map((e) => fileEntry(e));
      return wrap(entries, {
        title: item.name || 'Recientes',
        meta: `${entries.length}`,
        emptyText: S.state.env.platform === 'win32' ? 'Aún no hay archivos recientes.' : 'Los archivos recientes están disponibles en Windows.',
      });
    }
    case 'shelf': {
      const paths = S.config.shelf || [];
      const items = await api.describePaths(paths);
      const entries = items.map((it) =>
        fileEntry({ name: it.name, path: it.target, isDir: it.type === 'folder', ext: extname(it.target) }, { remove: () => api.shelfRemove([it.target]).then(refresh) })
      );
      const body = entries.length ? listView(entries) : h('div.dropzone', { html: `${gl('inbox')}<br>Arrastra archivos sobre el icono del estante para tenerlos a mano.<br>Luego arrástralos desde aquí a cualquier carpeta o correo.` });
      return {
        title: item.name || 'Estante',
        meta: `${entries.length}`,
        body,
        buttons: entries.length
          ? [
              headBtn('copy', 'Copiar a…', () => api.shelfTransfer('copy').then((r) => r.count && toast(`${r.count} copiados`))),
              headBtn('folder-input', 'Mover a…', () => api.shelfTransfer('move').then((r) => r.count && toast(`${r.count} movidos`))),
              headBtn('trash', '', () => api.shelfClear().then(closePopup), 'Vaciar estante'),
            ]
          : [],
        foot: 'El estante guarda accesos a tus archivos, no copias.',
      };
    }
    case 'smart': {
      const sug = await api.suggestions();
      const entries = sug.map((it) => itemEntry(it, null));
      return wrap(entries, { title: item.name || 'Sugeridas', meta: 'para esta hora', emptyText: 'Usa tus programas unos días y aquí aparecerán los que más abres a esta hora.' });
    }
    case 'widget': {
      const titles = { clock: 'Calendario', system: 'Rendimiento', clipboard: 'Portapapeles', notes: 'Notas rápidas' };
      const views = { clock: calendarView, system: systemView, clipboard: () => clipboardView(closePopup), notes: notesView };
      const body = views[item.widget]?.();
      if (!body) return null;
      const buttons = body.headButtons?.() || [];
      if (item.widget === 'system' && S.state.env.platform === 'win32')
        buttons.push(headBtn('activity', 'Administrador', () => launchItem({ type: 'app', target: 'C:\\Windows\\System32\\Taskmgr.exe' })));
      return { title: titles[item.widget], body, buttons, foot: body.foot, focus: body.focusEl, cleanup: body.cleanup };
    }
    case 'action':
      if (item.action === 'workspaces') return workspacesView();
      if (item.action === 'organize') return organizeView();
      if (item.action === 'apps') return appsView();
      return null;
  }
  return null;
}

function workspacesView() {
  const list = h('div.list', { style: { width: '300px' } });
  for (const [i, ws] of S.config.workspaces.entries()) {
    const active = ws.id === S.config.activeWorkspace;
    const row = h('div.row.ws-row' + (active ? '.active' : ''), {
      html:
        `<div class="rico">${tileSVG({ glyph: ws.icon?.glyph || 'layers', colors: gradientColors(ws.icon?.gradient || 'violeta'), style: ap().tileStyle === 'minimal' ? 'fluent' : ap().tileStyle, shape: ap().tileShape })}</div>` +
        `<div class="rtext"><div class="rname">${esc(ws.name)}</div><div class="rmeta">${ws.items.length} elementos${i < 9 ? ` · Ctrl+Alt+${i + 1}` : ''}</div></div>` +
        (active ? `<span style="color:var(--accent)">${gl('check')}</span>` : ''),
    });
    row.addEventListener('click', () => {
      closePopup();
      api.patch({ activeWorkspace: ws.id });
    });
    list.append(row);
  }
  return {
    title: 'Espacios de trabajo',
    body: list,
    buttons: [headBtn('plus', 'Nuevo', () => (closePopup(), api.openPanel('/espacios?nuevo=1'))), headBtn('settings-2', '', () => (closePopup(), api.openPanel('/espacios')), 'Administrar')],
    foot: 'Consejo: gira la rueda del mouse sobre este icono para cambiar de espacio.',
  };
}

async function organizeView() {
  const box = h('div.org');
  const desktop = S.state.env.paths.desktop;
  let plan;
  try {
    plan = await api.orgPlan(desktop, {});
  } catch (e) {
    box.append(h('div.empty', { text: e.message }));
    return { title: 'Ordenar escritorio', body: box };
  }
  const draw = () => {
    box.innerHTML = '';
    if (!plan.moves.length) {
      box.append(h('h4', { text: '¡Tu escritorio ya está ordenado! ✨' }), h('p', { style: { color: 'var(--text-2)', margin: '0 0 12px' }, text: 'No hay archivos sueltos para acomodar.' }));
    } else {
      box.append(
        h('h4', { text: `${plan.moves.length} archivos sueltos` }),
        h('div', { style: { color: 'var(--text-2)', fontSize: '13px' }, text: plan.mode === 'container' ? `Se moverán a «${plan.base.split(/[\\/]/).pop()}», en carpetas por tipo.` : 'Se moverán a carpetas por tipo en el mismo escritorio.' }),
        h(
          'div.chips',
          Object.entries(plan.categories).map(([k, v]) => h('span.chip', { text: `${k} · ${v}` }))
        ),
        h(
          'div.actions',
          h('button.btn.primary', {
            html: gl('wand-sparkles') + ' Ordenar ahora',
            onclick: async (e) => {
              e.currentTarget.disabled = true;
              try {
                const r = await api.orgApply(plan.id, []);
                box.innerHTML = '';
                box.append(
                  h('h4', { text: `Listo: ${r.moved} archivos ordenados` }),
                  r.failed.length ? h('p', { style: { color: 'var(--danger)' }, text: `${r.failed.length} no se pudieron mover (pueden estar abiertos).` }) : '',
                  h(
                    'div.actions',
                    h('button.btn', {
                      html: gl('undo-2') + ' Deshacer',
                      onclick: async () => {
                        const u = await api.orgUndo(r.id);
                        toast(`Deshecho: ${u.restored} archivos regresaron`);
                        closePopup();
                      },
                    }),
                    h('button.btn', { html: gl('folder-open') + ' Ver carpeta', onclick: () => (closePopup(), launchItem({ type: 'folder', target: plan.base })) })
                  )
                );
              } catch (er) {
                toast(er.message, { error: true });
              }
            },
          }),
          h('button.btn', { text: 'Ver detalle…', onclick: () => (closePopup(), api.openPanel('/organizador')) })
        )
      );
    }
  };
  draw();
  return { title: 'Ordenar escritorio', body: box, foot: 'Siempre puedes deshacer desde Configuración › Organizador.' };
}

async function appsView() {
  const box = h('div', { style: { width: '600px' } });
  const search = h('input.searchbox', { type: 'search', placeholder: 'Buscar aplicación…' });
  const gridBox = h('div');
  box.append(search, gridBox);
  let apps = [];
  const draw = () => {
    const q = normalize(search.value);
    const list = apps.filter((a) => !q || normalize(a.name).includes(q)).slice(0, 120);
    gridBox.innerHTML = '';
    if (!list.length) {
      gridBox.append(h('div.empty', { text: apps.length ? 'Sin resultados' : S.state.env.platform === 'win32' ? 'Buscando aplicaciones…' : 'La lista de aplicaciones está disponible en Windows.' }));
      return;
    }
    const entries = list.map((a) => itemEntry({ type: 'app', name: a.name, appId: a.appId, target: a.path || '' }, null));
    const g = gridView(entries);
    g.style.setProperty('--cols', '6');
    gridBox.append(g);
  };
  search.addEventListener('input', draw);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') gridBox.querySelector('.cell')?.click();
  });
  draw();
  api.apps(false).then((l) => {
    apps = l;
    draw();
  });
  return { title: 'Todas las aplicaciones', body: box, focus: search, foot: 'Clic derecho sobre una app para fijarla en el dock.' };
}
