// Organizador: ordena los archivos sueltos de una carpeta en subcarpetas por tipo, con deshacer.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { readJSON, writeJSONSync } = require('./jsonfile');

const CATEGORIES = [
  { id: 'imagenes', name: 'Imágenes', exts: 'jpg jpeg png gif bmp webp heic heif svg tif tiff ico raw cr2 nef avif jfif' },
  { id: 'pdf', name: 'PDF', exts: 'pdf' },
  { id: 'documentos', name: 'Documentos', exts: 'doc docx odt rtf txt md pages log' },
  { id: 'hojas', name: 'Hojas de cálculo', exts: 'xls xlsx xlsm ods csv numbers tsv' },
  { id: 'presentaciones', name: 'Presentaciones', exts: 'ppt pptx odp key pps ppsx' },
  { id: 'videos', name: 'Videos', exts: 'mp4 mkv avi mov wmv webm flv m4v 3gp mpg mpeg' },
  { id: 'musica', name: 'Música', exts: 'mp3 wav flac aac ogg m4a wma opus mid midi' },
  { id: 'comprimidos', name: 'Comprimidos', exts: 'zip rar 7z tar gz bz2 xz iso cab' },
  { id: 'instaladores', name: 'Instaladores', exts: 'exe msi msix appx appxbundle msixbundle' },
  { id: 'codigo', name: 'Código', exts: 'js ts jsx tsx py java c cpp h cs html css json xml php rb go rs sh bat ps1 sql ipynb yml yaml toml' },
  { id: 'diseno', name: 'Diseño', exts: 'psd ai xd fig sketch indd cdr afdesign afphoto blend dwg' },
  { id: 'fuentes', name: 'Fuentes', exts: 'ttf otf woff woff2' },
  { id: 'libros', name: 'Libros', exts: 'epub mobi azw3' },
];
const SHORTCUTS = { id: 'accesos', name: 'Accesos directos' };
const FOLDERS = { id: 'carpetas', name: 'Carpetas' };
const OTHERS = { id: 'otros', name: 'Otros' };

const SKIP_NAMES = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);
const SKIP_EXT = /\.(tmp|crdownload|part|partial|download|opdownload)$/i;
const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

function safeFolderName(s, fallback) {
  const clean = String(s || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 80);
  return clean || fallback;
}

function categorize(name, isDir, opts) {
  if (isDir) return opts.includeFolders ? FOLDERS : null;
  const ext = path.extname(name).slice(1).toLowerCase();
  if (ext === 'lnk' || ext === 'url') return opts.includeShortcuts ? SHORTCUTS : null;
  for (const r of opts.rules || []) {
    const exts = String(r.exts || '')
      .toLowerCase()
      .split(/[\s,;]+/)
      .map((e) => e.replace(/^\*?\./, ''))
      .filter(Boolean);
    if (exts.includes(ext)) return { id: 'regla-' + safeFolderName(r.name, 'Regla'), name: safeFolderName(r.name, 'Regla') };
  }
  for (const c of CATEGORIES) if (c.exts.split(' ').includes(ext)) return c;
  return OTHERS;
}

function uniquePath(p, taken) {
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  let cand = p;
  for (let i = 2; taken.has(cand.toLowerCase()) || fs.existsSync(cand); i++) cand = path.join(dir, `${base} (${i})${ext}`);
  taken.add(cand.toLowerCase());
  return cand;
}

async function plan(folder, opts = {}) {
  const mode = opts.mode === 'inplace' ? 'inplace' : 'container';
  const containerName = safeFolderName(opts.containerName, 'Organizado');
  const base = mode === 'container' ? path.join(folder, containerName) : folder;
  const ents = await fsp.readdir(folder, { withFileTypes: true });
  const categoryNames = new Set([...CATEGORIES, SHORTCUTS, FOLDERS, OTHERS].map((c) => c.name.toLowerCase()));
  for (const r of opts.rules || []) categoryNames.add(safeFolderName(r.name, 'Regla').toLowerCase());
  const moves = [];
  const skipped = [];
  const taken = new Set();
  const minAge = Date.now() - 60 * 1000;

  for (const e of ents) {
    const name = e.name;
    const lower = name.toLowerCase();
    const from = path.join(folder, name);
    if (SKIP_NAMES.has(lower) || lower.startsWith('~$') || SKIP_EXT.test(lower)) continue;
    if (mode === 'container' && lower === containerName.toLowerCase()) continue;
    const isDir = e.isDirectory();
    if (isDir && categoryNames.has(lower)) continue;
    const cat = categorize(name, isDir, opts);
    if (!cat) continue;
    let st;
    try {
      st = await fsp.stat(from);
    } catch {
      continue;
    }
    if (st.mtimeMs > minAge && !isDir) {
      skipped.push({ name, reason: 'Modificado hace menos de un minuto' });
      continue;
    }
    let dir = path.join(base, cat.name);
    if (opts.byMonth && !isDir) {
      const d = new Date(st.mtimeMs);
      dir = path.join(dir, `${d.getFullYear()}-${MONTHS[d.getMonth()]}`);
    }
    moves.push({ from, to: uniquePath(path.join(dir, name), taken), name, category: cat.name, size: st.size, isDir });
  }
  moves.sort((a, b) => a.category.localeCompare(b.category, 'es') || a.name.localeCompare(b.name, 'es'));
  const categories = {};
  for (const m of moves) categories[m.category] = (categories[m.category] || 0) + 1;
  return { id: crypto.randomUUID(), folder, base, mode, moves, skipped, categories, createdAt: Date.now() };
}

async function moveFile(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  try {
    await fsp.rename(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fsp.cp(from, to, { recursive: true, errorOnExist: true, force: false });
    await fsp.rm(from, { recursive: true, force: true });
  }
}

async function removeEmptyDirs(dirs) {
  const sorted = [...new Set(dirs)].sort((a, b) => b.length - a.length);
  for (const d of sorted) {
    try {
      const left = (await fsp.readdir(d)).filter((n) => !SKIP_NAMES.has(n.toLowerCase()));
      if (!left.length) await fsp.rm(d, { recursive: true, force: true });
    } catch {}
  }
}

class Organizer {
  constructor(dir) {
    this.file = path.join(dir, 'organizer-history.json');
    this.history = readJSON(this.file, []);
    this.plans = new Map();
  }

  async plan(folder, opts) {
    const p = await plan(folder, opts);
    this.plans.set(p.id, p);
    if (this.plans.size > 10) this.plans.delete(this.plans.keys().next().value);
    return p;
  }

  // Aplica un plan previamente calculado; "exclude" son índices de movimientos omitidos.
  async apply(planId, exclude = []) {
    const p = this.plans.get(planId);
    if (!p) throw new Error('El análisis expiró; vuelve a analizar la carpeta.');
    const skip = new Set(exclude);
    const done = [];
    const failed = [];
    const createdDirs = new Set();
    for (const [i, m] of p.moves.entries()) {
      if (skip.has(i)) continue;
      try {
        if (!fs.existsSync(m.from)) throw new Error('Ya no existe');
        let dir = path.dirname(m.to);
        while (dir.length > p.folder.length && !fs.existsSync(dir)) {
          createdDirs.add(dir);
          dir = path.dirname(dir);
        }
        const to = fs.existsSync(m.to) ? uniquePath(m.to, new Set()) : m.to;
        await moveFile(m.from, to);
        done.push({ from: m.from, to });
      } catch (e) {
        failed.push({ name: m.name, error: e.message });
      }
    }
    this.plans.delete(planId);
    const entry = { id: crypto.randomUUID(), date: Date.now(), folder: p.folder, moves: done, createdDirs: [...createdDirs], undone: false };
    if (done.length) {
      this.history.unshift(entry);
      this.history = this.history.slice(0, 30);
      this.save();
    }
    return { id: entry.id, moved: done.length, failed };
  }

  async undo(id) {
    const entry = this.history.find((h) => h.id === id);
    if (!entry || entry.undone) throw new Error('No hay nada que deshacer');
    let restored = 0;
    const failed = [];
    for (const m of [...entry.moves].reverse()) {
      try {
        if (!fs.existsSync(m.to)) throw new Error('Ya no está en la carpeta ordenada');
        const back = fs.existsSync(m.from) ? uniquePath(m.from, new Set()) : m.from;
        await moveFile(m.to, back);
        restored++;
      } catch (e) {
        failed.push({ name: path.basename(m.from), error: e.message });
      }
    }
    await removeEmptyDirs(entry.createdDirs || []);
    entry.undone = true;
    this.save();
    return { restored, failed };
  }

  list() {
    return this.history.map((h) => ({ id: h.id, date: h.date, folder: h.folder, count: h.moves.length, undone: h.undone }));
  }

  save() {
    try {
      writeJSONSync(this.file, this.history);
    } catch (e) {
      console.error(e);
    }
  }
}

module.exports = { Organizer, plan, categorize, CATEGORIES, safeFolderName };
