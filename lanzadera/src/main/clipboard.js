// Historial del portapapeles (texto). Solo en memoria salvo que el usuario pida recordarlo.
const { clipboard } = require('electron');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { readJSON, debouncedWriter } = require('./jsonfile');

// Formatos con los que los gestores de contraseñas piden no ser registrados.
function isExcluded() {
  try {
    if (clipboard.has('ExcludeClipboardContentFromMonitorProcessing')) return true;
    if (clipboard.has('Clipboard Viewer Ignore')) return true;
    const b = clipboard.readBuffer('CanIncludeInClipboardHistory');
    if (b && b.length >= 4 && b.readUInt32LE(0) === 0) return true;
  } catch {}
  return false;
}

class ClipboardHistory extends EventEmitter {
  constructor(dir, getConfig) {
    super();
    this.getConfig = getConfig;
    this.file = path.join(dir, 'clipboard.json');
    this.items = [];
    this.last = '';
    this.timer = null;
    this.paused = false;
    this.writer = debouncedWriter(this.file, () => this.items.filter((i) => i.pinned || this.cfg().persist), 800);
  }

  cfg() {
    return this.getConfig().clipboard;
  }

  start() {
    this.items = readJSON(this.file, []).filter((i) => i && typeof i.text === 'string');
    try {
      const t = clipboard.readText();
      this.last = typeof t === 'string' ? t : '';
    } catch {}
    this.apply();
  }

  apply() {
    const on = this.cfg().enabled;
    if (on && !this.timer) this.timer = setInterval(() => this.poll(), 900);
    if (!on && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.cfg().persist) this.writer.schedule();
  }

  poll() {
    if (this.paused) return;
    let text;
    try {
      text = clipboard.readText();
    } catch {
      return;
    }
    if (typeof text !== 'string' || !text || text === this.last) return;
    this.last = text;
    if (!text.trim() || text.length > 100000 || isExcluded()) return;
    const existing = this.items.find((i) => i.text === text);
    if (existing) {
      existing.ts = Date.now();
      this.items = [existing, ...this.items.filter((i) => i !== existing)];
    } else {
      this.items.unshift({ id: crypto.randomUUID().slice(0, 12), text, ts: Date.now(), pinned: false });
    }
    this.trim();
    this.changed();
  }

  trim() {
    const max = this.cfg().max;
    const pinned = this.items.filter((i) => i.pinned);
    const rest = this.items.filter((i) => !i.pinned).slice(0, Math.max(0, max - pinned.length));
    this.items = this.items.filter((i) => i.pinned || rest.includes(i));
  }

  list() {
    return { items: this.items, enabled: this.cfg().enabled, paused: this.paused };
  }

  copy(id) {
    const it = this.items.find((i) => i.id === id);
    if (!it) return false;
    this.last = it.text;
    clipboard.writeText(it.text);
    it.ts = Date.now();
    this.items = [it, ...this.items.filter((i) => i !== it)];
    this.changed();
    return true;
  }

  pin(id) {
    const it = this.items.find((i) => i.id === id);
    if (it) it.pinned = !it.pinned;
    this.changed();
  }

  remove(id) {
    this.items = this.items.filter((i) => i.id !== id);
    this.changed();
  }

  clear() {
    this.items = this.items.filter((i) => i.pinned);
    this.changed();
  }

  setPaused(v) {
    this.paused = !!v;
    this.changed();
  }

  changed() {
    this.writer.schedule();
    this.emit('change', this.list());
  }

  flush() {
    this.writer.flush();
  }
}

module.exports = { ClipboardHistory };
