// Acciones sobre elementos: menús contextuales, agregar, quitar y editar.
import { uid } from '../shared/dom.js';
import { S, api, toast, launchItem, findItem, saveItems } from './core.js';
import { openMenu } from './menu.js';
import { togglePopup, closePopup } from './popups.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

export async function addItems(newItems, index = null, groupId = null) {
  const items = clone(S.ws.items);
  const prepared = newItems.map((i) => ({ ...i, id: i.id || uid() }));
  if (groupId) {
    const g = items.find((x) => x.id === groupId);
    if (!g) return;
    g.items = [...(g.items || []), ...prepared.filter((p) => p.type !== 'group')];
  } else if (index === null || index > items.length) items.push(...prepared);
  else items.splice(index, 0, ...prepared);
  await saveItems(items);
  toast(prepared.length === 1 ? `«${prepared[0].name || 'Elemento'}» agregado` : `${prepared.length} elementos agregados`);
}

export async function removeItem(id) {
  const before = clone(S.ws.items);
  const items = clone(S.ws.items).filter((i) => i.id !== id);
  for (const g of items) if (g.type === 'group') g.items = (g.items || []).filter((k) => k.id !== id);
  await saveItems(items);
  const name = findItem(id, before)?.item?.name;
  toast(`${name ? `«${name}»` : 'Elemento'} quitado`, { action: { label: 'Deshacer', fn: () => saveItems(before) } });
}

export async function updateItem(id, patch) {
  const items = clone(S.ws.items);
  const f = findItem(id, items);
  if (!f) return;
  Object.assign(f.item, patch);
  await saveItems(items);
}

async function moveOutOfGroup(id) {
  const items = clone(S.ws.items);
  const f = findItem(id, items);
  if (!f?.parent) return;
  f.parent.items = f.parent.items.filter((k) => k.id !== id);
  const gi = items.indexOf(f.parent);
  items.splice(gi + 1, 0, f.item);
  await saveItems(items);
}

async function moveToWorkspace(id, wsId) {
  const f = findItem(id);
  if (!f) return;
  const target = S.config.workspaces.find((w) => w.id === wsId);
  await api.setItems(wsId, [...clone(target.items), { ...clone(f.item), id: uid() }]);
  toast(`Copiado a «${target.name}»`);
}

const hasPath = (it) => it.target && !/^(shell:|[a-z][a-z0-9+.-]*:\/\/|ms-settings:)/i.test(it.target);

export function itemMenu(item, parent, x, y) {
  const inDock = !!findItem(item.id);
  const others = S.config.workspaces.filter((w) => w.id !== S.ws.id);
  const isLaunchable = ['app', 'file', 'folder', 'url'].includes(item.type);
  const entries = [{ header: item.name || item.target || '' }];

  if (isLaunchable) {
    entries.push({ label: 'Abrir', icon: 'external-link', onClick: () => launchItem(item) });
    if (item.type === 'app' && S.state.env.platform === 'win32' && (item.target || item.appId))
      entries.push({ label: 'Ejecutar como administrador', icon: 'shield', hint: 'Ctrl+Mayús+clic', onClick: () => launchItem(item, { admin: true }) });
    if (hasPath(item)) entries.push({ label: 'Abrir ubicación del archivo', icon: 'folder-search', onClick: () => api.reveal(item.target).catch((e) => toast(e.message, { error: true })) });
  }
  if (item.type === 'group') {
    entries.push({ label: 'Abrir todo', icon: 'rocket', onClick: () => api.launchMany(item.items || []) });
    entries.push({
      label: 'Vista',
      icon: 'layout-grid',
      submenu: [
        ['fan', 'Abanico'],
        ['grid', 'Cuadrícula'],
        ['list', 'Lista'],
      ].map(([v, l]) => ({ label: l, checked: (item.layout || 'grid') === v, onClick: () => updateItem(item.id, { layout: v }) })),
    });
    entries.push({ label: 'Agregar programas al grupo…', icon: 'plus', onClick: () => api.openPanel(`/agregar?grupo=${item.id}`) });
  }
  if (item.type === 'folderStack') {
    entries.push({ label: 'Abrir carpeta', icon: 'folder-open', onClick: () => launchItem({ type: 'folder', target: item.target }) });
    entries.push({
      label: 'Ordenar por',
      icon: 'arrow-down-up',
      submenu: [
        ['date', 'Fecha'],
        ['name', 'Nombre'],
        ['kind', 'Tipo'],
        ['size', 'Tamaño'],
      ].map(([v, l]) => ({ label: l, checked: (item.sort || 'date') === v, onClick: () => updateItem(item.id, { sort: v }) })),
    });
    entries.push({
      label: 'Vista',
      icon: 'layout-grid',
      submenu: [
        ['fan', 'Abanico'],
        ['grid', 'Cuadrícula'],
        ['list', 'Lista'],
      ].map(([v, l]) => ({ label: l, checked: (item.layout || 'grid') === v, onClick: () => updateItem(item.id, { layout: v }) })),
    });
  }
  if (item.type === 'shelf') {
    entries.push({ label: 'Copiar todo a…', icon: 'copy', onClick: () => api.shelfTransfer('copy') });
    entries.push({ label: 'Mover todo a…', icon: 'folder-input', onClick: () => api.shelfTransfer('move') });
    entries.push({ label: 'Vaciar estante', icon: 'trash', onClick: () => api.shelfClear() });
  }
  if (item.type === 'action' && item.action === 'trash') entries.push({ label: 'Abrir papelera', icon: 'trash', onClick: () => launchItem({ type: 'app', target: 'shell:RecycleBinFolder' }) });

  entries.push('-');
  if (inDock) {
    if (item.type !== 'separator') {
      entries.push({ label: 'Editar…', icon: 'pencil', onClick: () => api.openPanel(`/elementos?id=${item.id}`) });
      entries.push({ label: 'Cambiar icono…', icon: 'palette', onClick: () => api.openPanel(`/iconos?id=${item.id}`) });
    }
    if (parent) entries.push({ label: 'Sacar del grupo', icon: 'log-out', onClick: () => moveOutOfGroup(item.id) });
    if (others.length && item.type !== 'separator')
      entries.push({ label: 'Copiar a otro espacio', icon: 'layers', submenu: others.map((w) => ({ label: w.name, onClick: () => moveToWorkspace(item.id, w.id) })) });
    entries.push('-');
    entries.push({ label: parent ? 'Quitar del grupo' : 'Quitar del dock', icon: 'trash', danger: true, onClick: () => removeItem(item.id) });
  } else {
    entries.push({ label: 'Fijar en el dock', icon: 'pin', onClick: () => addItems([{ ...clone(item), id: uid() }]) });
  }
  openMenu(x, y, entries);
}

const WIDGETS = [
  ['clock', 'Reloj y calendario'],
  ['system', 'Rendimiento'],
  ['clipboard', 'Portapapeles'],
  ['notes', 'Notas rápidas'],
];

const SPECIALS = [
  () => ({ type: 'folderStack', name: 'Descargas', target: S.state.env.paths.downloads, layout: 'fan', sort: 'date' }),
  () => ({ type: 'folderStack', name: 'Escritorio', target: S.state.env.paths.desktop, layout: 'grid', sort: 'date' }),
  () => ({ type: 'recent', name: 'Recientes', layout: 'list' }),
  () => ({ type: 'shelf', name: 'Estante' }),
  () => ({ type: 'smart', name: 'Sugeridas', layout: 'grid' }),
  () => ({ type: 'action', action: 'apps', name: 'Todas las apps' }),
  () => ({ type: 'action', action: 'search', name: 'Buscar' }),
  () => ({ type: 'action', action: 'organize', name: 'Ordenar escritorio' }),
  () => ({ type: 'action', action: 'workspaces', name: 'Espacios' }),
  () => ({ type: 'action', action: 'trash', name: 'Papelera' }),
  () => ({ type: 'action', action: 'showDesktop', name: 'Mostrar escritorio' }),
  () => ({ type: 'action', action: 'settings', name: 'Configuración' }),
];

export function addMenuEntries(index = null) {
  const pickAdd = async (kind) => {
    const paths = await api.pick({ kind, multi: true, title: kind === 'folder' ? 'Elegir carpeta' : 'Elegir archivo' });
    if (!paths.length) return;
    const items = await api.describePaths(paths);
    if (items.length) addItems(items, index);
  };
  return [
    { label: 'Programa instalado…', icon: 'app-window', onClick: () => api.openPanel('/agregar') },
    { label: 'Archivo o programa (.exe)…', icon: 'file-plus', onClick: () => pickAdd('file') },
    { label: 'Carpeta…', icon: 'folder-plus', onClick: () => pickAdd('folder') },
    { label: 'Sitio web…', icon: 'globe', onClick: () => api.openPanel('/agregar?tipo=url') },
    { label: 'Nuevo grupo', icon: 'layout-grid', onClick: () => addItems([{ type: 'group', name: 'Nuevo grupo', layout: 'grid', items: [] }], index) },
    {
      label: 'Widget',
      icon: 'gauge',
      submenu: WIDGETS.map(([w, l]) => ({ label: l, onClick: () => addItems([{ type: 'widget', widget: w, name: l }], index) })),
    },
    {
      label: 'Especial',
      icon: 'sparkles',
      submenu: SPECIALS.map((f) => {
        const it = f();
        return { label: it.name, onClick: () => addItems([it], index) };
      }),
    },
    { label: 'Separador', icon: 'separator-vertical', onClick: () => addItems([{ type: 'separator' }], index) },
  ];
}

export function dockMenu(x, y, index = null) {
  const pos = S.config.position;
  const set = (p) => api.patch(p);
  openMenu(x, y, [
    { label: 'Agregar', icon: 'plus', submenu: addMenuEntries(index) },
    '-',
    {
      label: 'Posición',
      icon: 'move',
      submenu: [
        ['bottom', 'Abajo'],
        ['top', 'Arriba'],
        ['left', 'Izquierda'],
        ['right', 'Derecha'],
      ].map(([v, l]) => ({ label: l, checked: pos.edge === v, onClick: () => set({ position: { edge: v } }) })),
    },
    {
      label: 'Al no usarla',
      icon: 'eye',
      submenu: [
        ['normal', 'Siempre visible'],
        ['compact', 'Compacta (crece al pasar)'],
        ['mini', 'Mini (una línea)'],
        ['hidden', 'Ocultar automáticamente'],
      ].map(([v, l]) => ({ label: l, checked: pos.idle === v, onClick: () => set({ position: { idle: v } }) })),
    },
    {
      label: 'Tamaño',
      icon: 'scaling',
      submenu: [
        [36, 'Pequeño'],
        [50, 'Mediano'],
        [62, 'Grande'],
        [76, 'Enorme'],
      ].map(([v, l]) => ({ label: l, checked: Math.abs(S.config.appearance.iconSize - v) < 4, onClick: () => set({ appearance: { iconSize: v } }) })),
    },
    {
      label: 'Espacio de trabajo',
      icon: 'layers',
      submenu: S.config.workspaces.map((w) => ({ label: w.name, checked: w.id === S.config.activeWorkspace, onClick: () => set({ activeWorkspace: w.id }) })),
    },
    { label: S.config.behavior.locked ? 'Desbloquear elementos' : 'Bloquear elementos', icon: S.config.behavior.locked ? 'lock-open' : 'lock', onClick: () => set({ behavior: { locked: !S.config.behavior.locked } }) },
    '-',
    { label: 'Buscar…', icon: 'search', hint: (S.state.env.hotkeys?.searchFallback || S.config.hotkeys.search || '').replace('Control', 'Ctrl').replace('Space', 'Espacio'), onClick: () => api.openSearch() },
    { label: 'Configuración…', icon: 'settings', onClick: () => api.openPanel('/inicio') },
    { label: 'Ocultar el dock', icon: 'eye-off', hint: (S.config.hotkeys.toggleDock || '').replace('Control', 'Ctrl'), onClick: () => api.run('toggleDock') },
    { label: 'Salir de Lanzadera', icon: 'power', onClick: () => api.run('quit') },
  ]);
}

// Clic sobre un elemento del dock.
export async function activate(item, el, ev = {}) {
  switch (item.type) {
    case 'app':
    case 'file':
    case 'folder':
    case 'url': {
      if (S.config.appearance.bounce) {
        el.classList.remove('bounce');
        void el.offsetWidth;
        el.classList.add('bounce');
        setTimeout(() => el.classList.remove('bounce'), 950);
      }
      closePopup();
      return launchItem(item, { admin: ev.ctrlKey && ev.shiftKey });
    }
    case 'separator':
      return;
    case 'action':
      switch (item.action) {
        case 'search':
          closePopup();
          return api.openSearch();
        case 'settings':
          closePopup();
          return api.openPanel('/inicio');
        case 'trash':
          closePopup();
          return launchItem({ type: 'app', target: S.state.env.platform === 'win32' ? 'shell:RecycleBinFolder' : 'trash:///' });
        case 'showDesktop':
          closePopup();
          return api.run('showDesktop');
        default:
          return togglePopup(item, el);
      }
    default:
      return togglePopup(item, el, { hover: ev.hover });
  }
}

export function hasPopup(item) {
  if (['group', 'folderStack', 'recent', 'shelf', 'smart', 'widget'].includes(item.type)) return true;
  return item.type === 'action' && ['workspaces', 'organize', 'apps'].includes(item.action);
}
