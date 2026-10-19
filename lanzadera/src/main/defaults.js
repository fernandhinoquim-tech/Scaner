// Configuración inicial y dock de bienvenida armado con las apps encontradas en el equipo.
const path = require('path');
const crypto = require('crypto');

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

function baseConfig() {
  return {
    schema: 1,
    firstRun: true,
    appearance: {
      theme: 'system', // system | dark | light
      accent: 'system',
      dockStyle: 'glass', // glass | solid | clear | accent
      opacity: 0.86,
      iconSize: 50,
      magnification: 1.75,
      magnifyRange: 2.6,
      iconMode: 'original', // original | designed
      tileStyle: 'fluent',
      tileShape: 'squircle',
      labels: 'hover', // hover | always | never
      animations: true,
      bounce: true,
      thumbnails: true,
    },
    position: {
      edge: 'bottom', // bottom | top | left | right
      align: 'center', // start | center | end
      display: 'primary', // primary | all | <id de pantalla>
      overTaskbar: false,
      margin: 10,
      idle: 'compact', // normal | compact | mini | hidden
      showDelay: 120,
      hideDelay: 450,
    },
    behavior: {
      openStacksOn: 'click', // click | hover
      launchAtLogin: true,
      locked: false,
      webSearch: 'google',
      suggestions: true,
      fileSearch: true,
      hideInFullscreen: true,
    },
    hotkeys: {
      search: 'Alt+Space',
      toggleDock: 'Control+Alt+D',
      organize: '',
      workspaces: true,
    },
    clipboard: { enabled: true, max: 40, persist: false },
    clock: { hour12: false, seconds: false },
    workspaces: [],
    activeWorkspace: null,
    shelf: [],
    notes: [],
    organizer: { mode: 'container', containerName: 'Organizado', includeShortcuts: false, includeFolders: false, byMonth: false, rules: [] },
    customIcons: [],
    stackSeen: {},
  };
}

function findApp(apps, re) {
  return apps.find((a) => re.test(a.name));
}

function appItem(a, name) {
  if (!a) return null;
  return { id: id(), type: 'app', name: name || a.name, appId: a.appId, target: a.path || '' };
}

const sep = () => ({ id: id(), type: 'separator' });
const action = (act, name) => ({ id: id(), type: 'action', action: act, name });
const widget = (w, name) => ({ id: id(), type: 'widget', widget: w, name });
const stack = (name, target, layout = 'grid') => ({ id: id(), type: 'folderStack', name, target, layout, sort: 'date', max: 40 });
const group = (name, items, gradient, layout = 'grid') => ({
  id: id(),
  type: 'group',
  name,
  layout,
  items: items.filter(Boolean),
  icon: { kind: 'auto', gradient },
});

function windowsWorkspaces(apps, paths) {
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const sys32 = path.join(sysRoot, 'System32');
  const A = (re) => findApp(apps, re);

  const explorer = { id: id(), type: 'app', name: 'Explorador de archivos', target: path.join(sysRoot, 'explorer.exe') };
  const browserApp = A(/google chrome/i) || A(/^microsoft edge$/i) || A(/firefox/i) || A(/brave/i) || A(/^opera/i);
  const browser = () => appItem(browserApp);
  const office = [/^word\b|microsoft word/i, /^excel\b|microsoft excel/i, /^powerpoint\b|microsoft powerpoint/i, /^outlook|microsoft outlook/i, /^onenote|microsoft onenote/i, /teams/i]
    .map(A)
    .filter(Boolean);
  const notepad = A(/^(bloc de notas|notepad)$/i);
  const tools = [
    appItem(A(/^(calculadora|calculator)$/i)),
    appItem(A(/herramienta recortes|recortes|snipping/i)),
    appItem(A(/^paint$/i)),
    appItem(A(/^terminal$|windows terminal/i)),
    { id: id(), type: 'app', name: 'Administrador de tareas', target: path.join(sys32, 'Taskmgr.exe') },
    { id: id(), type: 'app', name: 'Panel de control', target: path.join(sys32, 'control.exe') },
    { id: id(), type: 'app', name: 'Este equipo', target: 'shell:MyComputerFolder' },
    { id: id(), type: 'url', name: 'Configuración de Windows', target: 'ms-settings:', icon: { kind: 'designed', glyph: 'settings', gradient: 'grafito' } },
  ].filter(Boolean);

  const officeGroup = office.length
    ? group('Oficina', [...office.map((a) => appItem(a)), appItem(notepad)], 'indigo')
    : group('Notas y documentos', [appItem(notepad), appItem(A(/^wordpad$/i))], 'indigo');

  const principal = [
    explorer,
    browser(),
    officeGroup.items.length ? officeGroup : null,
    group('Herramientas', tools, 'grafito'),
    sep(),
    stack('Descargas', paths.downloads, 'fan'),
    stack('Documentos', paths.documents, 'grid'),
    { id: id(), type: 'recent', name: 'Recientes', layout: 'list' },
    { id: id(), type: 'shelf', name: 'Estante' },
    sep(),
    widget('clock', 'Reloj'),
    widget('system', 'Rendimiento'),
    widget('clipboard', 'Portapapeles'),
    widget('notes', 'Notas'),
    sep(),
    action('search', 'Buscar'),
    action('organize', 'Ordenar escritorio'),
    action('workspaces', 'Espacios'),
    action('trash', 'Papelera'),
  ].filter(Boolean);

  const trabajo = [
    { ...explorer, id: id() },
    browser(),
    ...office.map((a) => appItem(a)),
    appItem(notepad),
    sep(),
    stack('Documentos', paths.documents, 'grid'),
    stack('Escritorio', paths.desktop, 'grid'),
    { id: id(), type: 'recent', name: 'Recientes', layout: 'list' },
    sep(),
    widget('clock', 'Reloj'),
    widget('notes', 'Notas'),
    widget('clipboard', 'Portapapeles'),
    sep(),
    { id: id(), type: 'smart', name: 'Sugeridas', layout: 'grid' },
    action('search', 'Buscar'),
    action('workspaces', 'Espacios'),
  ].filter(Boolean);

  const fun = [/spotify/i, /^steam$/i, /^xbox$/i, /discord/i, /whatsapp/i, /netflix/i, /^(fotos|photos|microsoft fotos)$/i, /reproductor multimedia|media player/i, /^epic games/i]
    .map(A)
    .filter(Boolean)
    .map((a) => appItem(a));
  const ocio = [
    browser(),
    ...fun,
    sep(),
    stack('Música', paths.music, 'grid'),
    stack('Videos', paths.videos, 'grid'),
    stack('Imágenes', paths.pictures, 'grid'),
    sep(),
    widget('clock', 'Reloj'),
    { id: id(), type: 'smart', name: 'Sugeridas', layout: 'grid' },
    action('search', 'Buscar'),
    action('workspaces', 'Espacios'),
  ].filter(Boolean);

  return [
    { id: id(), name: 'Principal', icon: { glyph: 'house', gradient: 'oceano' }, items: principal },
    { id: id(), name: 'Trabajo', icon: { glyph: 'briefcase', gradient: 'violeta' }, items: trabajo },
    { id: id(), name: 'Ocio', icon: { glyph: 'gamepad-2', gradient: 'atardecer' }, items: ocio },
  ];
}

// Para desarrollo en Linux/macOS: elementos genéricos que existen en cualquier equipo.
function genericWorkspaces(paths) {
  const principal = [
    { id: id(), type: 'folder', name: 'Carpeta personal', target: paths.home },
    { id: id(), type: 'url', name: 'Navegador', target: 'https://www.google.com' },
    group(
      'Oficina',
      [
        { id: id(), type: 'url', name: 'Word', target: 'https://www.office.com/launch/word' },
        { id: id(), type: 'url', name: 'Excel', target: 'https://www.office.com/launch/excel' },
        { id: id(), type: 'url', name: 'PowerPoint', target: 'https://www.office.com/launch/powerpoint' },
        { id: id(), type: 'url', name: 'Outlook', target: 'https://outlook.live.com' },
        { id: id(), type: 'url', name: 'Bloc de notas', target: 'https://www.google.com/keep' },
      ],
      'indigo'
    ),
    group(
      'Herramientas',
      [
        { id: id(), type: 'url', name: 'Calculadora', target: 'https://www.google.com/search?q=calculadora' },
        { id: id(), type: 'url', name: 'Terminal', target: 'https://example.com' },
        { id: id(), type: 'url', name: 'Configuración', target: 'https://example.com' },
        { id: id(), type: 'url', name: 'Spotify', target: 'https://open.spotify.com' },
      ],
      'grafito'
    ),
    sep(),
    stack('Descargas', paths.downloads, 'fan'),
    stack('Documentos', paths.documents, 'grid'),
    { id: id(), type: 'recent', name: 'Recientes', layout: 'list' },
    { id: id(), type: 'shelf', name: 'Estante' },
    sep(),
    widget('clock', 'Reloj'),
    widget('system', 'Rendimiento'),
    widget('clipboard', 'Portapapeles'),
    widget('notes', 'Notas'),
    sep(),
    action('search', 'Buscar'),
    action('organize', 'Ordenar escritorio'),
    action('workspaces', 'Espacios'),
    action('trash', 'Papelera'),
  ];
  return [
    { id: id(), name: 'Principal', icon: { glyph: 'house', gradient: 'oceano' }, items: principal },
    { id: id(), name: 'Trabajo', icon: { glyph: 'briefcase', gradient: 'violeta' }, items: [widget('clock', 'Reloj'), action('search', 'Buscar'), action('workspaces', 'Espacios')] },
  ];
}

function buildWorkspaces({ apps, paths, platform }) {
  return platform === 'win32' ? windowsWorkspaces(apps || [], paths) : genericWorkspaces(paths);
}

module.exports = { baseConfig, buildWorkspaces, newId: id };
