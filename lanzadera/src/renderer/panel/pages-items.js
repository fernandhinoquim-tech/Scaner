// Páginas: Elementos del dock, editor, agregar y espacios de trabajo.
import { h, esc, uid, normalize, debounce } from '../shared/dom.js';
import { iconHTML } from '../shared/icon-view.js';
import { tileSVG, gradientColors } from '../shared/tiles.js';
import { ACTION_DESIGN, WIDGET_DESIGN } from '../shared/autoicon.js';
import { P, api, ap, patch, findAnywhere, updateAnywhere, removeAnywhere, activeWs, TYPE_LABEL } from './ctx.js';
import { page, card, toggle, seg, select, slider, button, dropdown, modal, confirmDialog, toast, field, input, gl } from './ui.js';
import { openIconPicker, openGlyphPicker, bindDrop } from './iconpicker.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
let currentWsId = null;
let expanded = new Set();

function describe(it) {
  switch (it.type) {
    case 'app':
      return it.appId ? 'Aplicación instalada' : it.target || '';
    case 'file':
    case 'folder':
    case 'folderStack':
      return it.target || '';
    case 'url':
      return it.target || '';
    case 'group':
      return `${(it.items || []).length} elementos · vista ${({ fan: 'abanico', grid: 'cuadrícula', list: 'lista' })[it.layout || 'grid']}`;
    case 'widget':
      return WIDGET_DESIGN[it.widget]?.name || 'Widget';
    case 'action':
      return ACTION_DESIGN[it.action]?.name || 'Acción';
    default:
      return TYPE_LABEL[it.type] || '';
  }
}

async function saveWs(ws, items) {
  await api.setItems(ws.id, items);
}

export function addEntries(ws, groupId = null) {
  const target = async (newItems) => {
    const items = clone(ws.items);
    const prepared = newItems.map((i) => ({ ...i, id: uid() }));
    if (groupId) {
      const g = items.find((i) => i.id === groupId);
      g.items = [...(g.items || []), ...prepared.filter((p) => p.type !== 'group')];
    } else items.push(...prepared);
    await saveWs(ws, items);
    toast(prepared.length === 1 ? `«${prepared[0].name || TYPE_LABEL[prepared[0].type]}» agregado` : `${prepared.length} elementos agregados`);
  };
  const pickAdd = async (kind) => {
    const paths = await api.pick({ kind, multi: true });
    if (paths.length) target(await api.describePaths(paths));
  };
  const base = [
    { label: 'Programa instalado…', icon: 'app-window', onClick: () => openAddDialog({ ws, groupId }) },
    { label: 'Archivo o programa (.exe)…', icon: 'file-plus', onClick: () => pickAdd('file') },
    { label: 'Carpeta…', icon: 'folder-plus', onClick: () => pickAdd('folder') },
    { label: 'Sitio web…', icon: 'globe', onClick: () => openAddDialog({ ws, groupId, tab: 'web' }) },
  ];
  if (groupId) return base;
  return [
    ...base,
    '-',
    { label: 'Grupo (abre más iconos)', icon: 'layout-grid', onClick: () => target([{ type: 'group', name: 'Nuevo grupo', layout: 'grid', items: [] }]) },
    { label: 'Carpeta en vivo (Descargas…)', icon: 'folder-down', onClick: async () => {
      const [p] = await api.pick({ kind: 'folder', title: 'Carpeta para mostrar en vivo' });
      if (p) target([{ type: 'folderStack', name: p.split(/[\\/]/).pop(), target: p, layout: 'grid', sort: 'date' }]);
    } },
    { header: 'Widgets' },
    ...Object.entries(WIDGET_DESIGN).map(([w, d]) => ({ label: d.name, icon: d.glyph, onClick: () => target([{ type: 'widget', widget: w, name: d.name }]) })),
    { header: 'Especiales' },
    { label: 'Archivos recientes', icon: 'clock-arrow-down', onClick: () => target([{ type: 'recent', name: 'Recientes', layout: 'list' }]) },
    { label: 'Estante temporal', icon: 'inbox', onClick: () => target([{ type: 'shelf', name: 'Estante' }]) },
    { label: 'Sugeridas (inteligente)', icon: 'sparkles', onClick: () => target([{ type: 'smart', name: 'Sugeridas', layout: 'grid' }]) },
    ...Object.entries(ACTION_DESIGN).map(([a, d]) => ({ label: d.name, icon: d.glyph, onClick: () => target([{ type: 'action', action: a, name: d.name }]) })),
    { label: 'Separador', icon: 'separator-vertical', onClick: () => target([{ type: 'separator' }]) },
  ];
}

export function itemsPage(params) {
  const wss = P.config.workspaces;
  if (!wss.find((w) => w.id === currentWsId)) currentWsId = P.config.activeWorkspace;
  const ws = wss.find((w) => w.id === currentWsId) || wss[0];

  const tabs = seg(
    wss.map((w) => [w.id, w.name, w.icon?.glyph]),
    ws.id,
    (v) => {
      currentWsId = v;
      P.rerender();
    }
  );
  const addBtn = button('Agregar', (e) => dropdown(e.currentTarget, addEntries(ws)), { icon: 'plus', primary: true });
  const toolbar = h('div.toolbar', tabs, h('div.grow'), ws.id !== P.config.activeWorkspace ? button('Mostrar en el dock', () => patch({ activeWorkspace: ws.id }), { icon: 'eye' }) : null, addBtn);

  const list = h('div.ilist');
  let dragId = null;
  const row = (it, parent) => {
    const r = h('div.irow' + (parent ? '.child' : '') + (it.type === 'separator' ? '.sep-row' : ''), { dataset: { id: it.id } });
    r.innerHTML =
      (parent ? '' : `<span class="grip">${gl('grip-vertical')}</span>`) +
      `<div class="iico">${it.type === 'separator' ? '' : iconHTML(it, ap())}</div>` +
      `<div class="itext"><div class="iname">${esc(it.type === 'separator' ? '— Separador —' : it.name || it.target || TYPE_LABEL[it.type])}</div><div class="imeta">${esc(TYPE_LABEL[it.type] || '')}${describe(it) && it.type !== 'separator' && describe(it) !== TYPE_LABEL[it.type] ? ' · ' + esc(describe(it)) : ''}</div></div>`;
    const act = h('div.iact');
    if (it.type === 'group') {
      act.append(button('', () => {
        expanded.has(it.id) ? expanded.delete(it.id) : expanded.add(it.id);
        P.rerender();
      }, { icon: expanded.has(it.id) ? 'chevron-up' : 'chevron-down', title: 'Ver contenido' }));
      act.append(button('', (e) => dropdown(e.currentTarget, addEntries(ws, it.id)), { icon: 'plus', title: 'Agregar al grupo' }));
    }
    if (it.type !== 'separator') {
      act.append(button('', () => openEditor(it.id), { icon: 'pencil', title: 'Editar' }));
      act.append(button('', () => openIconPicker({ item: it, onApply: (icon) => updateAnywhere(it.id, (x) => (x.icon = icon)) }), { icon: 'palette', title: 'Cambiar icono' }));
    }
    act.append(button('', async () => {
      const before = clone(ws.items);
      await removeAnywhere(it.id);
      toast('Quitado del dock');
      P.lastUndo = () => api.setItems(ws.id, before);
    }, { icon: 'trash', title: 'Quitar' }));
    r.append(act);
    r.addEventListener('dblclick', () => it.type !== 'separator' && openEditor(it.id));
    if (!parent) {
      r.draggable = true;
      r.addEventListener('dragstart', (e) => {
        dragId = it.id;
        r.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      r.addEventListener('dragend', () => r.classList.remove('dragging'));
      r.addEventListener('dragover', (e) => {
        if (!dragId) return;
        e.preventDefault();
        r.classList.add('drag-over');
      });
      r.addEventListener('dragleave', () => r.classList.remove('drag-over'));
      r.addEventListener('drop', async (e) => {
        e.preventDefault();
        r.classList.remove('drag-over');
        if (!dragId || dragId === it.id) return;
        const items = clone(ws.items);
        const from = items.findIndex((x) => x.id === dragId);
        const [moved] = items.splice(from, 1);
        items.splice(items.findIndex((x) => x.id === it.id), 0, moved);
        dragId = null;
        await saveWs(ws, items);
      });
    }
    return r;
  };
  for (const it of ws.items) {
    list.append(row(it, null));
    if (it.type === 'group' && expanded.has(it.id)) {
      for (const k of it.items || []) list.append(row(k, it));
      if (!(it.items || []).length) list.append(h('div.irow.child', h('div.itext.muted', { text: 'Grupo vacío. Usa + para agregar programas.' })));
    }
  }
  if (!ws.items.length) list.append(h('div.card', h('div.ctext.muted', { text: 'Este espacio está vacío. Usa «Agregar» para poner programas, carpetas, widgets…' })));

  const drop = h('div.dropzone', { style: { marginTop: '14px' }, html: `${gl('mouse-pointer-2')} También puedes arrastrar archivos, carpetas y accesos directos aquí o directamente sobre el dock.` });
  bindDrop(drop, async (paths) => {
    const items = await api.describePaths(paths);
    await saveWs(ws, [...clone(ws.items), ...items.map((i) => ({ ...i, id: uid() }))]);
    toast(`${items.length} agregados`);
  });

  const pg = page('Elementos del dock', 'Ordena arrastrando, agrupa, cambia iconos y nombres. Los cambios se ven al instante.', toolbar, list, drop);
  if (params.get('id')) setTimeout(() => openEditor(params.get('id')), 50);
  return pg;
}

export function openEditor(id) {
  const f = findAnywhere(id);
  if (!f) return toast('No se encontró el elemento', true);
  const it = clone(f.item);
  const isWin = P.env.platform === 'win32';
  const preview = h('div', { style: { width: '72px', height: '72px', flex: 'none' } });
  const paint = () => (preview.innerHTML = iconHTML(it, ap()));
  paint();

  const fields = h('div');
  fields.append(field('Nombre', input(it.name, (v) => (it.name = v))));

  const pathField = (label, kind) => {
    const i = input(it.target, (v) => (it.target = v));
    return field(label, h('div.inline', i, button('Examinar…', async () => {
      const [p] = await api.pick({ kind, defaultPath: it.target || undefined });
      if (p) {
        i.value = p;
        it.target = p;
        paint();
      }
    })));
  };

  if (it.type === 'app' || it.type === 'file') {
    if (it.appId && !it.target) fields.append(h('p.muted', { text: 'Aplicación instalada (se abre como en el menú Inicio).' }));
    else fields.append(pathField('Ruta del programa o archivo', 'file'));
    if (it.type === 'app') {
      fields.append(field('Argumentos (opcional)', input(it.args, (v) => (it.args = v), { placeholder: 'ej. --incognito' })));
      fields.append(field('Iniciar en (opcional)', input(it.cwd, (v) => (it.cwd = v), { placeholder: 'Carpeta de trabajo' })));
      if (isWin) fields.append(card({ icon: 'shield', title: 'Ejecutar siempre como administrador', desc: 'Windows pedirá confirmación cada vez.', control: toggle(it.admin, (v) => (it.admin = v)) }));
    }
  } else if (it.type === 'folder') {
    fields.append(pathField('Carpeta', 'folder'));
  } else if (it.type === 'url') {
    fields.append(field('Dirección web', input(it.target, (v) => (it.target = v), { placeholder: 'https://…' })));
  } else if (it.type === 'folderStack') {
    fields.append(pathField('Carpeta a mostrar', 'folder'));
    fields.append(field('Ordenar por', select([['date', 'Fecha (más nuevos primero)'], ['name', 'Nombre'], ['kind', 'Tipo'], ['size', 'Tamaño']], it.sort || 'date', (v) => (it.sort = v))));
    fields.append(field('Máximo de elementos', slider({ min: 10, max: 120, step: 5, value: it.max || 40, onChange: (v) => (it.max = v) })));
  }
  if (['group', 'folderStack', 'recent', 'smart'].includes(it.type)) {
    fields.append(field('Al abrir, mostrar como', seg([['fan', 'Abanico', 'chart-no-axes-gantt'], ['grid', 'Cuadrícula', 'layout-grid'], ['list', 'Lista', 'list']], it.layout || 'grid', (v) => (it.layout = v))));
    if (it.type === 'group') fields.append(h('p.muted', { text: 'El abanico se usa con el dock arriba o abajo y hasta 14 elementos; si no, se muestra como cuadrícula o lista.' }));
  }

  const head = h('div.row-flex', { style: { marginBottom: '16px', gap: '16px' } },
    preview,
    h('div', h('div', { style: { fontWeight: 600, fontSize: '15px' }, text: TYPE_LABEL[it.type] }), h('div.muted', { text: f.parent ? `Dentro del grupo «${f.parent.name}»` : `Espacio «${f.ws.name}»` })),
    h('div', { style: { marginLeft: 'auto' } },
      button('Cambiar icono…', () => openIconPicker({ item: it, onApply: (icon) => {
        it.icon = icon;
        paint();
      } }), { icon: 'palette' }))
  );

  const m = modal({
    title: 'Editar elemento',
    body: h('div', head, fields),
    size: 'small',
    buttons: [
      button('Quitar', async () => {
        if (await confirmDialog('¿Quitar este elemento?', `«${it.name || 'Elemento'}» se quitará del dock (el programa o archivo no se borra).`, 'Quitar', true)) {
          await removeAnywhere(id);
          m.close();
        }
      }, { danger: true, icon: 'trash' }),
      button('Cancelar', () => m.close()),
      button('Guardar', async () => {
        await updateAnywhere(id, (x) => Object.assign(x, it));
        m.close();
        toast('Guardado');
      }, { primary: true }),
    ],
  });
  m.foot.firstChild.classList.add('left');
}

export function openAddDialog({ ws, groupId, tab = 'apps' }) {
  ws = ws || activeWs();
  const chosen = new Map();
  const body = h('div');
  const tabsEl = h('div.itabs');
  let cur = tab;
  let apps = [];
  const g = groupId ? ws.items.find((i) => i.id === groupId) : null;

  const draw = () => {
    tabsEl.innerHTML = '';
    for (const [k, label, icon] of [['apps', 'Programas instalados', 'app-window'], ['web', 'Sitio web', 'globe'], ['files', 'Archivos y carpetas', 'folder']]) {
      const b = h('button' + (cur === k ? '.on' : ''), { html: `${gl(icon)} ${label}`, style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } });
      b.addEventListener('click', () => {
        cur = k;
        draw();
      });
      tabsEl.append(b);
    }
    body.innerHTML = '';
    if (cur === 'apps') {
      const search = h('input', { type: 'search', placeholder: 'Buscar programa…', style: { width: '100%', marginBottom: '10px' } });
      const list = h('div.ilist', { style: { maxHeight: '420px', overflow: 'auto' } });
      const drawList = () => {
        const q = normalize(search.value);
        list.innerHTML = '';
        const shown = apps.filter((a) => !q || normalize(a.name).includes(q));
        if (!shown.length) list.append(h('div.muted', { style: { padding: '12px' }, text: apps.length ? 'Sin resultados' : P.env.platform === 'win32' ? 'Buscando programas…' : 'La lista de programas está disponible en Windows.' }));
        for (const a of shown.slice(0, 300)) {
          const item = { type: 'app', name: a.name, appId: a.appId, target: a.path || '' };
          const cb = h('input', { type: 'checkbox' });
          cb.checked = chosen.has(a.appId);
          const r = h('label.irow', { style: { minHeight: '48px' } }, cb, h('div.iico', { style: { width: '32px', height: '32px' }, html: iconHTML(item, ap()) }), h('div.itext', h('div.iname', { text: a.name })));
          cb.addEventListener('change', () => {
            cb.checked ? chosen.set(a.appId, item) : chosen.delete(a.appId);
            okBtn.querySelector('span').textContent = chosen.size ? `Agregar (${chosen.size})` : 'Agregar';
          });
          list.append(r);
        }
      };
      search.addEventListener('input', debounce(drawList, 100));
      body.append(search, list);
      drawList();
      if (!apps.length)
        api.apps(false).then((l) => {
          apps = l;
          drawList();
        });
      setTimeout(() => search.focus(), 50);
    } else if (cur === 'web') {
      const name = input('', null, { placeholder: 'Ej. YouTube' });
      const url = input('', null, { placeholder: 'https://www.youtube.com' });
      body.append(field('Nombre', name), field('Dirección', url), button('Agregar sitio', async () => {
        let u = url.value.trim();
        if (!u) return toast('Escribe la dirección', true);
        if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
        let n = name.value.trim();
        if (!n) {
          try {
            n = new URL(u).hostname.replace(/^www\./, '');
            n = n.charAt(0).toUpperCase() + n.slice(1);
          } catch {
            n = u;
          }
        }
        await addTo([{ type: 'url', name: n, target: u }]);
        m.close();
      }, { primary: true, icon: 'plus' }));
    } else {
      body.append(
        h('div.row-flex', { style: { gap: '10px' } },
          button('Elegir archivos o programas…', async () => {
            const paths = await api.pick({ kind: 'file', multi: true });
            if (paths.length) {
              await addTo(await api.describePaths(paths));
              m.close();
            }
          }, { icon: 'file-plus' }),
          button('Elegir carpeta…', async () => {
            const paths = await api.pick({ kind: 'folder' });
            if (paths.length) {
              await addTo(await api.describePaths(paths));
              m.close();
            }
          }, { icon: 'folder-plus' })
        ),
        h('p.muted', { text: 'Consejo: también puedes arrastrar archivos desde el Explorador directamente sobre el dock.' })
      );
    }
  };

  const addTo = async (items) => {
    const fresh = findAnywhere(groupId || '')?.ws || P.config.workspaces.find((w) => w.id === ws.id);
    const list = clone(fresh.items);
    const prepared = items.map((i) => ({ ...i, id: uid() }));
    if (groupId) {
      const gg = list.find((i) => i.id === groupId);
      gg.items = [...(gg.items || []), ...prepared];
    } else list.push(...prepared);
    await api.setItems(fresh.id, list);
    toast(prepared.length === 1 ? `«${prepared[0].name}» agregado` : `${prepared.length} agregados`);
  };

  const okBtn = button('Agregar', async () => {
    if (cur !== 'apps' || !chosen.size) return m.close();
    await addTo([...chosen.values()]);
    m.close();
  }, { primary: true });
  const m = modal({
    title: g ? `Agregar al grupo «${g.name}»` : `Agregar a «${ws.name}»`,
    body: h('div', tabsEl, body),
    buttons: [button('Cancelar', () => m.close()), okBtn],
  });
  draw();
  return m;
}

export function workspacesPage(params) {
  const wss = P.config.workspaces;
  const cards = h('div.ws-cards');
  const save = (list) => patch({ workspaces: list });
  for (const [i, w] of wss.entries()) {
    const active = w.id === P.config.activeWorkspace;
    const ico = h('div.wico', { title: 'Cambiar icono', html: tileSVG({ glyph: w.icon?.glyph || 'layers', colors: gradientColors(w.icon?.gradient || 'violeta'), style: ap().tileStyle === 'minimal' ? 'fluent' : ap().tileStyle, shape: ap().tileShape }) });
    ico.addEventListener('click', () =>
      openGlyphPicker({ glyph: w.icon?.glyph || 'layers', gradient: w.icon?.gradient || 'violeta', onApply: (icon) => {
        const list = clone(wss);
        list[i].icon = icon;
        save(list);
      } })
    );
    const name = h('input', { type: 'text' });
    name.value = w.name;
    name.addEventListener('change', () => {
      const list = clone(wss);
      list[i].name = name.value.trim() || 'Espacio';
      save(list);
    });
    const strip = h('div.ws-strip', { html: w.items.filter((x) => x.type !== 'separator').slice(0, 10).map((x) => `<span>${iconHTML(x, ap())}</span>`).join('') });
    cards.append(
      h('div.ws-card' + (active ? '.active' : ''),
        h('div.top', ico, h('div', { style: { flex: 1, minWidth: 0 } }, name, h('div.muted', { style: { marginTop: '4px' }, text: `${w.items.length} elementos${i < 9 ? ` · Ctrl+Alt+${i + 1}` : ''}` }))),
        strip,
        h('div.acts',
          active ? h('span.muted', { style: { alignSelf: 'center', marginRight: 'auto' }, html: `${gl('check')} En uso` }) : button('Usar ahora', () => patch({ activeWorkspace: w.id }), { primary: true, icon: 'eye' }),
          button('Editar elementos', () => P.navigate(`/elementos`), { icon: 'pencil' }),
          button('', () => {
            const list = clone(wss);
            list.splice(i + 1, 0, { ...clone(w), id: uid(), name: w.name + ' (copia)', items: clone(w.items).map((x) => ({ ...x, id: uid() })) });
            save(list);
          }, { icon: 'copy', title: 'Duplicar' }),
          i > 0 ? button('', () => {
            const list = clone(wss);
            [list[i - 1], list[i]] = [list[i], list[i - 1]];
            save(list);
          }, { icon: 'arrow-left', title: 'Mover antes' }) : null,
          wss.length > 1 ? button('', async () => {
            if (await confirmDialog('¿Eliminar espacio?', `Se eliminará «${w.name}» con sus ${w.items.length} elementos.`, 'Eliminar', true)) {
              const list = clone(wss).filter((x) => x.id !== w.id);
              patch({ workspaces: list, activeWorkspace: active ? list[0].id : P.config.activeWorkspace });
            }
          }, { icon: 'trash', title: 'Eliminar', danger: true }) : null
        )
      )
    );
  }
  const newWs = (copy) => {
    if (wss.length >= 12) return toast('Máximo 12 espacios', true);
    const glyphs = ['star', 'briefcase', 'graduation-cap', 'gamepad-2', 'palette', 'code', 'music', 'heart', 'rocket', 'coffee'];
    const grads = ['indigo', 'esmeralda', 'atardecer', 'cielo', 'rosa', 'ambar', 'uva', 'menta'];
    const items = copy
      ? clone(activeWs().items).map((x) => ({ ...x, id: uid() }))
      : [
          { id: uid(), type: 'action', action: 'search', name: 'Buscar' },
          { id: uid(), type: 'action', action: 'workspaces', name: 'Espacios' },
        ];
    const w = { id: uid(), name: `Espacio ${wss.length + 1}`, icon: { glyph: glyphs[wss.length % glyphs.length], gradient: grads[wss.length % grads.length] }, items };
    patch({ workspaces: [...clone(wss), w], activeWorkspace: w.id });
    toast(`«${w.name}» creado: ya está en tu dock`);
  };
  const pg = page(
    'Espacios de trabajo',
    'Cada espacio es un dock distinto: Trabajo, Estudio, Juegos… Cambia con Ctrl+Alt+1…9, la rueda del mouse sobre el icono de Espacios o desde la bandeja.',
    h('div.toolbar', button('Nuevo espacio vacío', () => newWs(false), { icon: 'plus', primary: true }), button('Duplicar el actual', () => newWs(true), { icon: 'copy' })),
    cards
  );
  if (params.get('nuevo')) setTimeout(() => newWs(false), 100);
  return pg;
}
