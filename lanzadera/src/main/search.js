// Índice del buscador rápido: apps, elementos del dock, archivos, ajustes de Windows y comandos.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { visible } = require('./folders');

const WIN_SETTINGS = [
  ['Pantalla', 'display', 'monitor brillo resolucion escala'],
  ['Sonido', 'sound', 'volumen audio altavoces microfono'],
  ['Wi-Fi', 'network-wifi', 'internet red inalambrica'],
  ['Red e Internet', 'network', 'ethernet conexion'],
  ['Bluetooth y dispositivos', 'bluetooth', 'audifonos auriculares mouse teclado'],
  ['Windows Update', 'windowsupdate', 'actualizaciones actualizar'],
  ['Aplicaciones instaladas', 'appsfeatures', 'desinstalar programas'],
  ['Aplicaciones de inicio', 'startupapps', 'arranque inicio automatico'],
  ['Aplicaciones predeterminadas', 'defaultapps', 'abrir con navegador predeterminado'],
  ['Fondo de escritorio', 'personalization-background', 'wallpaper imagen fondo'],
  ['Colores', 'colors', 'modo oscuro claro acento'],
  ['Temas', 'themes', 'personalizar'],
  ['Barra de tareas', 'taskbar', 'inicio iconos'],
  ['Energía y batería', 'powersleep', 'suspender apagar pantalla bateria'],
  ['Almacenamiento', 'storagesense', 'disco espacio liberar'],
  ['Impresoras y escáneres', 'printers', 'imprimir'],
  ['Mouse', 'mousetouchpad', 'raton puntero touchpad'],
  ['Escritura y teclado', 'typing', 'teclado autocorreccion'],
  ['Fecha y hora', 'dateandtime', 'reloj zona horaria'],
  ['Idioma y región', 'regionlanguage', 'idioma'],
  ['Notificaciones', 'notifications', 'avisos no molestar'],
  ['Privacidad y seguridad', 'privacy', 'permisos camara ubicacion'],
  ['Tu información', 'yourinfo', 'cuenta usuario'],
  ['Opciones de inicio de sesión', 'signinoptions', 'pin contrasena huella windows hello'],
  ['Información del sistema', 'about', 'acerca de especificaciones nombre del equipo'],
  ['Accesibilidad', 'easeofaccess', 'lupa narrador contraste'],
  ['Modo de juego', 'gaming-gamemode', 'juegos'],
  ['Proyectar en otra pantalla', 'project', 'proyector monitor'],
  ['Portapapeles de Windows', 'clipboard', 'historial'],
  ['Luz nocturna', 'nightlight', 'luz azul'],
  ['VPN', 'network-vpn', 'red privada'],
  ['Modo avión', 'network-airplanemode', 'avion'],
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'appdata', '$recycle.bin', 'system volume information', '__pycache__']);

class SearchIndex {
  constructor({ store, apps, paths }) {
    this.store = store;
    this.apps = apps;
    this.paths = paths;
    this.files = [];
    this.filesAt = 0;
    this.scanning = null;
  }

  async build() {
    const cfg = this.store.get();
    const out = [];
    const seen = new Set();
    const push = (e) => {
      const k = (e.item?.appId || e.item?.target || e.key || e.title).toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(e);
    };

    for (const { ws, item, group } of this.store.allItems()) {
      if (['separator', 'widget', 'action', 'smart', 'shelf', 'recent'].includes(item.type)) continue;
      push({ key: 'it:' + item.id, kind: item.type === 'group' ? 'group' : 'pinned', title: item.name || item.target, subtitle: `${ws.name}${group ? ' › ' + group.name : ''}`, item, wsId: ws.id });
    }
    for (const a of await this.apps.list()) {
      push({ key: 'app:' + a.appId, kind: 'app', title: a.name, subtitle: 'Aplicación', item: { type: 'app', name: a.name, appId: a.appId, target: a.path || '' } });
    }
    const known = [
      ['Escritorio', this.paths.desktop],
      ['Documentos', this.paths.documents],
      ['Descargas', this.paths.downloads],
      ['Imágenes', this.paths.pictures],
      ['Música', this.paths.music],
      ['Videos', this.paths.videos],
      ['Carpeta personal', this.paths.home],
    ];
    for (const [name, p] of known) if (p) push({ key: 'kf:' + p, kind: 'folder', title: name, subtitle: p, item: { type: 'folder', name, target: p } });

    if (process.platform === 'win32') {
      for (const [title, uri, kw] of WIN_SETTINGS)
        push({ key: 'set:' + uri, kind: 'setting', title, subtitle: 'Configuración de Windows', keywords: kw, item: { type: 'url', name: title, target: 'ms-settings:' + uri, icon: { kind: 'designed', glyph: 'settings', gradient: 'grafito' } } });
      push({ key: 'set:defender', kind: 'setting', title: 'Seguridad de Windows', subtitle: 'Antivirus y protección', keywords: 'defender antivirus', item: { type: 'url', name: 'Seguridad de Windows', target: 'windowsdefender:', icon: { kind: 'designed', glyph: 'shield-check', gradient: 'esmeralda' } } });
    }

    const cmd = (key, title, subtitle, glyph, gradient, keywords = '') => out.push({ key: 'cmd:' + key, kind: 'command', command: key, title, subtitle, keywords, item: { type: 'action', name: title, icon: { kind: 'designed', glyph, gradient } } });
    cmd('organize', 'Ordenar escritorio', 'Lanzadera · organiza archivos sueltos por tipo', 'wand-sparkles', 'aurora', 'organizar limpiar acomodar');
    cmd('settings', 'Configuración de Lanzadera', 'Apariencia, posición, atajos…', 'settings', 'grafito', 'ajustes preferencias opciones dock');
    cmd('icons', 'Banco de iconos', 'Lanzadera · elige o sube iconos', 'palette', 'atardecer', 'iconos diseno');
    cmd('showDesktop', 'Mostrar escritorio', 'Minimiza todas las ventanas', 'monitor', 'cielo', 'minimizar');
    cmd('lock', 'Bloquear equipo', 'Windows + L', 'lock', 'medianoche', 'bloquear pantalla');
    cmd('toggleDock', 'Mostrar u ocultar el dock', 'Lanzadera', 'panel-bottom', 'indigo', 'barra');
    cmd('clearShelf', 'Vaciar estante', 'Lanzadera · quita los archivos del estante', 'inbox', 'menta');
    for (const ws of cfg.workspaces) cmd('ws:' + ws.id, `Cambiar a «${ws.name}»`, 'Espacio de trabajo', ws.icon?.glyph || 'layers', ws.icon?.gradient || 'violeta', 'espacio workspace');

    if (cfg.behavior.fileSearch) {
      this.scanFiles();
      for (const f of this.files) push(f);
    }
    return out;
  }

  scanFiles() {
    if (this.scanning || Date.now() - this.filesAt < 5 * 60 * 1000) return this.scanning;
    this.scanning = (async () => {
      const roots = [this.paths.desktop, this.paths.documents, this.paths.downloads, this.paths.pictures, this.paths.music, this.paths.videos].filter(Boolean);
      const found = [];
      const limit = 6000;
      const walk = async (dir, depth) => {
        if (found.length >= limit) return;
        let ents;
        try {
          ents = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of ents) {
          if (found.length >= limit) return;
          if (!visible(e.name)) continue;
          const p = path.join(dir, e.name);
          const isDir = e.isDirectory();
          if (isDir && SKIP_DIRS.has(e.name.toLowerCase())) continue;
          const isLnk = /\.lnk$/i.test(e.name);
          found.push({
            key: 'f:' + p,
            kind: isDir ? 'folder' : 'file',
            title: isLnk ? e.name.slice(0, -4) : e.name,
            subtitle: dir,
            item: { type: isDir ? 'folder' : isLnk ? 'app' : 'file', name: isLnk ? e.name.slice(0, -4) : e.name, target: p },
          });
          if (isDir && depth < 3) await walk(p, depth + 1);
        }
      };
      for (const r of [...new Set(roots)]) await walk(r, 0);
      this.files = found;
      this.filesAt = Date.now();
      this.scanning = null;
    })();
    return this.scanning;
  }
}

module.exports = { SearchIndex };
