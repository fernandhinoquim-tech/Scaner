// Iconos de programas y archivos: extracción en alta resolución con caché en disco.
const { app, nativeImage, shell } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { isWin, runHelper, parseJSON } = require('./winhelper');
const { resolveAppPath } = require('./apps');

const NEGATIVE_TTL = 3 * 24 * 3600 * 1000;
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif', jfif: 'image/jpeg' };

function expandEnv(p) {
  return String(p || '').replace(/%([^%]+)%/g, (m, k) => process.env[k] ?? process.env[k.toUpperCase()] ?? m);
}

class IconService {
  constructor(dir) {
    this.dir = path.join(dir, 'icon-cache');
    fs.mkdirSync(this.dir, { recursive: true });
    this.pending = new Map();
    this.running = false;
    this.timer = null;
    this.thumbs = new Map();
  }

  key(app, src) {
    return crypto.createHash('sha1').update(JSON.stringify(['v2', app || '', src || ''])).digest('hex').slice(0, 24);
  }

  // Devuelve la ruta del PNG o null.
  async get({ app: appId, src }) {
    const key = this.key(appId, src);
    const file = path.join(this.dir, key + '.png');
    if (fs.existsSync(file)) return file;
    const none = path.join(this.dir, key + '.none');
    try {
      const st = fs.statSync(none);
      if (Date.now() - st.mtimeMs < NEGATIVE_TTL) return null;
    } catch {}

    const source = this.resolveSource(appId, src);
    if (!source) return null;
    let ok = false;
    if (isWin) ok = await this.extractWin(key, source);
    if (!ok && source.fsPath) ok = await this.extractElectron(source.fsPath, file);
    if (ok && fs.existsSync(file)) return file;
    try {
      fs.writeFileSync(none, '');
    } catch {}
    return null;
  }

  resolveSource(appId, src) {
    if (appId) {
      const p = resolveAppPath(appId);
      if (p) return { path: p, fsPath: p };
      return isWin ? { path: 'shell:AppsFolder\\' + appId } : null;
    }
    if (!src) return null;
    const s = expandEnv(src);
    if (/^shell:/i.test(s)) return isWin ? { path: s } : null;
    if (/^[a-z][a-z0-9+.-]+:/i.test(s) && !/^[a-z]:[\\/]/i.test(s)) return null;
    if (isWin && /\.lnk$/i.test(s)) {
      try {
        const l = shell.readShortcutLink(s);
        const icon = expandEnv(l.icon);
        if (icon && fs.existsSync(icon)) return { path: icon, index: l.iconIndex || 0, useIndex: true, fsPath: s };
        const target = expandEnv(l.target);
        if (target && fs.existsSync(target)) return { path: target, fsPath: target };
      } catch {}
    }
    return { path: s, fsPath: s };
  }

  extractWin(key, source) {
    return new Promise((resolve) => {
      const entry = this.pending.get(key);
      if (entry) entry.waiters.push(resolve);
      else this.pending.set(key, { source, waiters: [resolve] });
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 60);
    });
  }

  async flush() {
    if (this.running || !this.pending.size) return;
    this.running = true;
    const batch = [...this.pending.entries()].slice(0, 60);
    for (const [k] of batch) this.pending.delete(k);
    const input = path.join(os.tmpdir(), `lanzadera-icons-${process.pid}-${Date.now()}.json`);
    let results = [];
    try {
      const payload = batch.map(([key, { source }]) => ({ key, path: source.path, index: source.index || 0, useIndex: !!source.useIndex }));
      await fsp.writeFile(input, JSON.stringify(payload), 'utf8');
      const res = await runHelper('icons', ['-In', input, '-Out', this.dir, '-Size', '256'], { timeout: 120000 });
      const parsed = parseJSON(res.stdout);
      results = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      if (!results.length && res.stderr) console.error('Extracción de iconos:', res.stderr.slice(0, 2000));
    } catch (e) {
      console.error('Extracción de iconos falló', e);
    } finally {
      fsp.unlink(input).catch(() => {});
    }
    const okKeys = new Set(results.filter((r) => r.ok).map((r) => r.key));
    for (const [key, { waiters }] of batch) for (const w of waiters) w(okKeys.has(key));
    this.running = false;
    if (this.pending.size) this.flush();
  }

  async extractElectron(p, file) {
    try {
      if (!fs.existsSync(p)) return false;
      const img = await app.getFileIcon(p, { size: 'large' });
      if (img.isEmpty()) return false;
      await fsp.writeFile(file, img.toPNG());
      return true;
    } catch {
      return false;
    }
  }

  async thumbnail(p, size = 256) {
    let st;
    try {
      st = await fsp.stat(p);
    } catch {
      return null;
    }
    const k = `${p}|${size}|${st.mtimeMs}`;
    if (this.thumbs.has(k)) return this.thumbs.get(k);
    let out = null;
    if (process.platform === 'win32' || process.platform === 'darwin') {
      try {
        const img = await nativeImage.createThumbnailFromPath(p, { width: size, height: size });
        if (!img.isEmpty()) out = { mime: 'image/png', data: img.toPNG() };
      } catch {}
    }
    if (!out) {
      const ext = path.extname(p).slice(1).toLowerCase();
      if (IMAGE_MIME[ext] && st.size < 25 * 1024 * 1024) {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) {
          const { width, height } = img.getSize();
          const r = Math.min(1, size / Math.max(width, height));
          out = { mime: 'image/png', data: img.resize({ width: Math.round(width * r), height: Math.round(height * r), quality: 'good' }).toPNG() };
        } else if (ext === 'svg' || ext === 'gif' || ext === 'webp') {
          out = { mime: IMAGE_MIME[ext], data: await fsp.readFile(p) };
        }
      }
    }
    if (out) {
      this.thumbs.set(k, out);
      if (this.thumbs.size > 160) this.thumbs.delete(this.thumbs.keys().next().value);
    }
    return out;
  }

  async clear() {
    this.thumbs.clear();
    const files = await fsp.readdir(this.dir).catch(() => []);
    await Promise.all(files.map((f) => fsp.unlink(path.join(this.dir, f)).catch(() => {})));
  }
}

module.exports = { IconService, IMAGE_MIME, expandEnv };
