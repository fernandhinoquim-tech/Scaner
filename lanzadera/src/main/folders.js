// Pilas de carpetas en vivo (Descargas, Documentos…) y archivos recientes de Windows.
const { shell } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { EventEmitter } = require('events');

const HIDDEN = new Set(['desktop.ini', 'thumbs.db', '.ds_store', 'ntuser.dat']);

function visible(name) {
  const n = name.toLowerCase();
  return !HIDDEN.has(n) && !n.startsWith('.') && !n.startsWith('~$') && !/\.(tmp|crdownload|part|partial|download|opdownload)$/i.test(n);
}

async function describe(p) {
  try {
    const st = await fsp.stat(p);
    const name = path.basename(p);
    return { name, path: p, isDir: st.isDirectory(), ext: st.isDirectory() ? '' : path.extname(name).slice(1).toLowerCase(), mtime: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

async function listFolder(dir, { sort = 'date', max = 60 } = {}) {
  let ents;
  try {
    ents = await fsp.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return { path: dir, total: 0, entries: [], error: e.code === 'ENOENT' ? 'La carpeta no existe' : 'No se pudo leer la carpeta' };
  }
  const names = ents.filter((e) => visible(e.name)).slice(0, 2000);
  const entries = (await Promise.all(names.map((e) => describe(path.join(dir, e.name))))).filter(Boolean);
  if (sort === 'name') entries.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, 'es', { numeric: true }));
  else if (sort === 'kind') entries.sort((a, b) => (b.isDir - a.isDir) || a.ext.localeCompare(b.ext) || a.name.localeCompare(b.name, 'es'));
  else if (sort === 'size') entries.sort((a, b) => b.size - a.size);
  else entries.sort((a, b) => b.mtime - a.mtime);
  return { path: dir, total: entries.length, entries: entries.slice(0, Math.max(1, Math.min(300, max))) };
}

// Windows guarda accesos directos a los archivos abiertos recientemente.
async function listRecent(max = 30) {
  if (process.platform !== 'win32') return [];
  const dir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Recent');
  let ents;
  try {
    ents = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const links = (
    await Promise.all(
      ents
        .filter((n) => n.toLowerCase().endsWith('.lnk'))
        .map(async (n) => {
          const p = path.join(dir, n);
          try {
            return { p, t: (await fsp.stat(p)).mtimeMs };
          } catch {
            return null;
          }
        })
    )
  )
    .filter(Boolean)
    .sort((a, b) => b.t - a.t)
    .slice(0, max * 3);
  const out = [];
  const seen = new Set();
  for (const { p, t } of links) {
    if (out.length >= max) break;
    let target;
    try {
      target = shell.readShortcutLink(p).target;
    } catch {
      continue;
    }
    if (!target || seen.has(target.toLowerCase())) continue;
    const d = await describe(target);
    if (!d) continue;
    seen.add(target.toLowerCase());
    out.push({ ...d, mtime: t });
  }
  return out;
}

class FolderWatcher extends EventEmitter {
  constructor() {
    super();
    this.watchers = new Map();
    this.timers = new Map();
  }

  set(paths) {
    const want = new Set(paths.filter(Boolean));
    for (const [p, w] of this.watchers) {
      if (!want.has(p)) {
        w.close();
        this.watchers.delete(p);
      }
    }
    for (const p of want) {
      if (this.watchers.has(p)) continue;
      try {
        const w = fs.watch(p, { persistent: false }, () => this.bump(p));
        w.on('error', () => {
          w.close();
          this.watchers.delete(p);
        });
        this.watchers.set(p, w);
      } catch {}
    }
  }

  bump(p) {
    clearTimeout(this.timers.get(p));
    this.timers.set(
      p,
      setTimeout(() => this.emit('change', p), 450)
    );
  }
}

module.exports = { listFolder, listRecent, describe, FolderWatcher, visible };
