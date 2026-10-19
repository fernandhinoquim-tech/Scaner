// Elige automáticamente un icono de diseño según el programa, archivo o carpeta.
import { hashGradient } from './tiles.js';
import { basename, extname, normalize, stripExt } from './dom.js';

const APP_RULES = [
  [/excel|libreoffice calc|\bsheets\b|hoja de calculo/, 'sheet', 'esmeralda'],
  [/powerpoint|impress|presentaci|diapositiva/, 'presentation', 'naranja'],
  [/\bword\b|wordpad|writer|google docs/, 'file-text', 'indigo'],
  [/outlook|thunderbird|gmail|\bmail\b|correo/, 'mail', 'oceano'],
  [/onenote|notion|obsidian|evernote|\bkeep\b|bloc de notas|notepad(?!\+)|\bnotas?\b|sticky/, 'notebook-pen', 'ambar'],
  [/teams|zoom|google meet|skype|webex/, 'video', 'violeta'],
  [/whatsapp|telegram|signal|messenger|discord|slack|mensaje|\bchat\b/, 'message-circle', 'menta'],
  [/spotify|music|musica|itunes|deezer|tidal|winamp|groove|foobar|audacity/, 'music', 'rosa'],
  [/clipchamp|premiere|davinci|capcut|filmora|editor de video|shotcut|kdenlive/, 'film', 'uva'],
  [/vlc|video|pelicula|netflix|youtube|prime video|disney|plex|kodi|\bmpc\b|reproductor/, 'clapperboard', 'cereza'],
  [/steam|epic games|xbox|\bgame|juego|battle\.net|riot|ubisoft|\bea app|\bgog\b|minecraft|roblox|playnite|origin/, 'gamepad-2', 'uva'],
  [/photoshop|gimp|lightroom|\bfotos\b|\bphotos\b|krita|affinity photo|irfanview|imagen/, 'image', 'atardecer'],
  [/\bpaint\b|illustrator|inkscape|canva|figma|\bdesign|diseno|coreldraw/, 'palette', 'atardecer'],
  [/notepad\+\+|visual studio|\bvs ?code\b|\bcode\b|intellij|pycharm|webstorm|android studio|sublime|cursor|eclipse|netbeans|arduino/, 'code', 'aurora'],
  [/terminal|powershell|\bcmd\b|simbolo del sistema|command prompt|\bwsl\b|ubuntu|git bash|putty/, 'square-terminal', 'medianoche'],
  [/chrome|edge|firefox|brave|opera|vivaldi|navegador|browser|safari|\btor\b|arc\b/, 'globe', 'oceano'],
  [/calculadora|calculator/, 'calculator', 'grafito'],
  [/configuracion|settings|ajustes|panel de control|control panel/, 'settings', 'grafito'],
  [/explorador|explorer|file manager|este equipo|this pc|mi pc/, 'folder', 'ambar'],
  [/calendario|calendar/, 'calendar-days', 'coral'],
  [/camara|camera|webcam/, 'camera', 'grafito'],
  [/recortes|snipping|captura|screenshot|sharex|lightshot|greenshot/, 'scissors', 'rosa'],
  [/reloj|\bclock\b|alarma|alarms/, 'alarm-clock', 'indigo'],
  [/\bmapas?\b|\bmaps?\b/, 'map', 'esmeralda'],
  [/tienda|\bstore\b|amazon|mercado/, 'shopping-bag', 'oceano'],
  [/tiempo|weather|clima/, 'cloud-sun', 'cielo'],
  [/defender|seguridad|security|antivirus|avast|norton|kaspersky|malwarebytes|bitwarden|1password|keepass|contrasen|password/, 'shield-check', 'esmeralda'],
  [/administrador de tareas|task manager|monitor de recursos|resource monitor|process/, 'activity', 'lima'],
  [/acrobat|\bpdf|foxit|sumatra/, 'file-text', 'cereza'],
  [/7-zip|winrar|winzip|peazip|bandizip/, 'file-archive', 'ambar'],
  [/onedrive|dropbox|google drive|icloud|\bmega\b|\bnube\b|cloud/, 'cloud', 'cielo'],
  [/\bobs\b|stream|grabadora|recorder|grabacion/, 'radio', 'cereza'],
  [/blender|unity|unreal|sketchup|autocad|fusion 360|\b3d\b/, 'box', 'naranja'],
  [/anydesk|teamviewer|remot|\brdp\b|parsec/, 'monitor-smartphone', 'oceano'],
  [/copilot|chatgpt|claude|gemini|perplexity|\bia\b|\bai\b|asistente|assistant/, 'sparkles', 'aurora'],
  [/kindle|\blibro|\bbook|calibre|lector/, 'book-open', 'ambar'],
  [/impresora|printer|\bprint/, 'printer', 'grafito'],
  [/papelera|recycle|trash/, 'trash', 'grafito'],
  [/descargas|downloads|torrent|qbittorrent|jdownloader/, 'download', 'oceano'],
  [/banco|bank|finanzas|finance|wallet/, 'wallet', 'esmeralda'],
  [/correo de voz|telefono|phone link|vincular movil|enlace movil/, 'smartphone', 'indigo'],
];

const FOLDER_RULES = [
  [/descargas|downloads/, 'folder-down', 'oceano'],
  [/documentos|documents/, 'folder-open', 'indigo'],
  [/imagenes|pictures|fotos|photos|capturas|screenshots/, 'images', 'atardecer'],
  [/musica|music/, 'list-music', 'rosa'],
  [/videos|peliculas|movies/, 'clapperboard', 'cereza'],
  [/escritorio|desktop/, 'monitor', 'aurora'],
  [/proyectos|projects|code|codigo|dev|repos/, 'folder-code', 'aurora'],
  [/trabajo|work|oficina|clientes/, 'briefcase', 'violeta'],
  [/juegos|games/, 'gamepad-2', 'uva'],
  [/universidad|escuela|clases|tareas|estudio|school/, 'graduation-cap', 'ambar'],
];

// Tipos de archivo por extensión: [glifo, degradado, etiqueta].
export const FILE_TYPES = {
  imagen: { glyph: 'image', gradient: 'atardecer', exts: 'jpg jpeg png gif bmp webp heic heif tif tiff ico svg raw cr2 nef avif jfif' },
  pdf: { glyph: 'file-text', gradient: 'cereza', exts: 'pdf', label: 'PDF' },
  texto: { glyph: 'file-text', gradient: 'indigo', exts: 'doc docx odt rtf txt md pages log' },
  hoja: { glyph: 'file-spreadsheet', gradient: 'esmeralda', exts: 'xls xlsx xlsm ods csv numbers tsv' },
  presentacion: { glyph: 'presentation', gradient: 'naranja', exts: 'ppt pptx odp key pps ppsx' },
  video: { glyph: 'file-video-camera', gradient: 'uva', exts: 'mp4 mkv avi mov wmv webm flv m4v 3gp mpg mpeg' },
  audio: { glyph: 'file-music', gradient: 'rosa', exts: 'mp3 wav flac aac ogg m4a wma opus mid midi' },
  comprimido: { glyph: 'file-archive', gradient: 'ambar', exts: 'zip rar 7z tar gz bz2 xz iso cab' },
  instalador: { glyph: 'package', gradient: 'oceano', exts: 'exe msi msix appx appxbundle msixbundle' },
  codigo: { glyph: 'file-code', gradient: 'aurora', exts: 'js ts jsx tsx py java c cpp h cs html css json xml php rb go rs sh bat ps1 sql ipynb yml yaml toml' },
  diseno: { glyph: 'pen-tool', gradient: 'violeta', exts: 'psd ai xd fig sketch indd cdr afdesign afphoto blend dwg' },
  fuente: { glyph: 'type', gradient: 'grafito', exts: 'ttf otf woff woff2' },
  libro: { glyph: 'book-open', gradient: 'ambar', exts: 'epub mobi azw3' },
  acceso: { glyph: 'link', gradient: 'cielo', exts: 'lnk url' },
};

const EXT_MAP = {};
for (const [k, v] of Object.entries(FILE_TYPES)) for (const e of v.exts.split(' ')) EXT_MAP[e] = k;

export function fileTypeOf(path) {
  return EXT_MAP[extname(path)] || null;
}

export const THUMB_EXTS = new Set('jpg jpeg png gif bmp webp heic heif tif tiff avif jfif mp4 mkv avi mov wmv webm m4v pdf psd'.split(' '));

export function monogram(name) {
  const clean = stripExt(basename(name || '?')).replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).replace(/^./, (c) => c.toUpperCase());
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function autoDesign(item) {
  const name = normalize(item.name || basename(item.target || ''));
  const target = normalize(item.target || item.appId || '');
  switch (item.type) {
    case 'folder': {
      for (const [re, glyph, gradient] of FOLDER_RULES) if (re.test(name) || re.test(target)) return { glyph, gradient };
      return { glyph: 'folder', gradient: 'ambar' };
    }
    case 'folderStack': {
      for (const [re, glyph, gradient] of FOLDER_RULES) if (re.test(name) || re.test(target)) return { glyph, gradient };
      return { glyph: 'folder-open', gradient: 'ambar' };
    }
    case 'file': {
      const t = fileTypeOf(item.target || item.name);
      if (t) return { glyph: FILE_TYPES[t].glyph, gradient: FILE_TYPES[t].gradient };
      return { glyph: 'file', gradient: 'grafito' };
    }
    case 'url': {
      let host = '';
      try {
        host = new URL(item.target).hostname.replace(/^www\./, '');
      } catch {}
      for (const [re, glyph, gradient] of APP_RULES) if (re.test(name) || re.test(host)) return { glyph, gradient };
      return { text: monogram(item.name || host.split('.')[0] || 'W'), gradient: hashGradient(host || name) };
    }
    case 'group':
      return { glyph: 'layout-grid', gradient: 'aurora' };
    case 'recent':
      return { glyph: 'clock-arrow-down', gradient: 'indigo' };
    case 'shelf':
      return { glyph: 'inbox', gradient: 'menta' };
    case 'smart':
      return { glyph: 'sparkles', gradient: 'aurora' };
    case 'separator':
      return { glyph: 'minus', gradient: 'grafito' };
    default: {
      for (const [re, glyph, gradient] of APP_RULES) if (re.test(name) || re.test(target)) return { glyph, gradient };
      return { text: monogram(item.name || item.target), gradient: hashGradient(name || target) };
    }
  }
}

export const ACTION_DESIGN = {
  search: { glyph: 'search', gradient: 'indigo', name: 'Buscar' },
  organize: { glyph: 'wand-sparkles', gradient: 'aurora', name: 'Ordenar escritorio' },
  settings: { glyph: 'settings', gradient: 'grafito', name: 'Configuración' },
  workspaces: { glyph: 'layers', gradient: 'violeta', name: 'Espacios' },
  trash: { glyph: 'trash', gradient: 'grafito', name: 'Papelera' },
  showDesktop: { glyph: 'monitor', gradient: 'cielo', name: 'Mostrar escritorio' },
  apps: { glyph: 'layout-grid', gradient: 'oceano', name: 'Todas las apps' },
};

export const WIDGET_DESIGN = {
  clock: { glyph: 'clock', gradient: 'medianoche', name: 'Reloj y calendario' },
  system: { glyph: 'gauge', gradient: 'medianoche', name: 'Rendimiento' },
  clipboard: { glyph: 'clipboard-list', gradient: 'oceano', name: 'Portapapeles' },
  notes: { glyph: 'sticky-note', gradient: 'ambar', name: 'Notas rápidas' },
};
