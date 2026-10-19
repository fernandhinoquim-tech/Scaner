// Almacén de configuración: carga, mezcla con valores por defecto, valida y guarda.
const path = require('path');
const { EventEmitter } = require('events');
const { readJSON, debouncedWriter } = require('./jsonfile');
const { baseConfig, newId } = require('./defaults');

const ITEM_TYPES = new Set(['app', 'file', 'folder', 'url', 'group', 'folderStack', 'recent', 'shelf', 'smart', 'widget', 'action', 'separator']);
const STR_FIELDS = ['name', 'target', 'appId', 'args', 'cwd', 'layout', 'sort', 'widget', 'action'];

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

// Mezcla profunda: objetos se combinan, listas y valores se reemplazan.
function deepMerge(target, src) {
  if (!isPlainObject(src)) return target;
  for (const [k, v] of Object.entries(src)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (isPlainObject(v) && isPlainObject(target[k])) deepMerge(target[k], v);
    else target[k] = clone(v);
  }
  return target;
}

function sanitizeIcon(icon) {
  if (!isPlainObject(icon)) return { kind: 'auto' };
  const out = { kind: String(icon.kind || 'auto') };
  for (const k of ['glyph', 'gradient', 'style', 'emoji', 'text', 'file', 'fit']) if (typeof icon[k] === 'string') out[k] = icon[k].slice(0, 400);
  if (Array.isArray(icon.colors) && icon.colors.length === 2 && icon.colors.every((c) => /^#[\da-f]{6}$/i.test(c))) out.colors = icon.colors;
  return out;
}

function sanitizeItem(it, depth = 0) {
  if (!isPlainObject(it) || !ITEM_TYPES.has(it.type)) return null;
  const out = { id: typeof it.id === 'string' && it.id ? it.id.slice(0, 40) : newId(), type: it.type };
  for (const k of STR_FIELDS) if (typeof it[k] === 'string') out[k] = it[k].slice(0, 2000);
  if (it.admin === true) out.admin = true;
  if (Number.isFinite(it.max)) out.max = Math.max(5, Math.min(200, Math.round(it.max)));
  if (it.icon) out.icon = sanitizeIcon(it.icon);
  if (it.type === 'group') {
    // Los grupos no se anidan: sus subgrupos se aplanan.
    const kids = [];
    for (const k of Array.isArray(it.items) ? it.items : []) {
      if (k?.type === 'group' && depth === 0) kids.push(...(k.items || []));
      else kids.push(k);
    }
    out.items = kids
      .filter((k) => k?.type !== 'group')
      .map((k) => sanitizeItem(k, depth + 1))
      .filter(Boolean)
      .slice(0, 200);
  }
  return out;
}

function sanitizeItems(items) {
  return (Array.isArray(items) ? items : []).map((i) => sanitizeItem(i)).filter(Boolean).slice(0, 300);
}

function sanitizeConfig(c) {
  const base = baseConfig();
  for (const key of Object.keys(base)) {
    if (isPlainObject(base[key]) && !isPlainObject(c[key])) c[key] = clone(base[key]);
    if (Array.isArray(base[key]) && !Array.isArray(c[key])) c[key] = [];
  }
  c.workspaces = c.workspaces
    .filter(isPlainObject)
    .map((w) => ({
      id: typeof w.id === 'string' && w.id ? w.id : newId(),
      name: String(w.name || 'Espacio').slice(0, 60),
      icon: isPlainObject(w.icon) ? { glyph: String(w.icon.glyph || 'layers'), gradient: String(w.icon.gradient || 'violeta') } : { glyph: 'layers', gradient: 'violeta' },
      items: sanitizeItems(w.items),
    }))
    .slice(0, 12);
  if (!c.workspaces.find((w) => w.id === c.activeWorkspace)) c.activeWorkspace = c.workspaces[0]?.id || null;
  c.shelf = c.shelf.filter((p) => typeof p === 'string').slice(0, 200);
  c.notes = c.notes
    .filter(isPlainObject)
    .map((n) => ({ id: String(n.id || newId()), text: String(n.text || '').slice(0, 20000), color: String(n.color || 'ambar'), ts: Number(n.ts) || Date.now() }))
    .slice(0, 30);
  c.customIcons = c.customIcons.filter((i) => isPlainObject(i) && typeof i.file === 'string' && !/[\\/]/.test(i.file));
  const ap = c.appearance;
  ap.iconSize = Math.max(28, Math.min(96, Number(ap.iconSize) || 50));
  ap.magnification = Math.max(1, Math.min(2.6, Number(ap.magnification) || 1));
  ap.magnifyRange = Math.max(1.2, Math.min(5, Number(ap.magnifyRange) || 2.6));
  ap.opacity = Math.max(0.2, Math.min(1, Number(ap.opacity) || 0.86));
  const pos = c.position;
  if (!['bottom', 'top', 'left', 'right'].includes(pos.edge)) pos.edge = 'bottom';
  if (!['start', 'center', 'end'].includes(pos.align)) pos.align = 'center';
  if (!['normal', 'compact', 'mini', 'hidden'].includes(pos.idle)) pos.idle = 'compact';
  pos.margin = Math.max(0, Math.min(80, Number(pos.margin) || 0));
  c.clipboard.max = Math.max(5, Math.min(200, Number(c.clipboard.max) || 40));
  return c;
}

class ConfigStore extends EventEmitter {
  constructor(dir) {
    super();
    this.file = path.join(dir, 'config.json');
    this.data = null;
    this.isNew = false;
    this.writer = debouncedWriter(this.file, () => this.data);
  }

  load() {
    const raw = readJSON(this.file, null);
    this.isNew = !raw;
    this.data = sanitizeConfig(deepMerge(baseConfig(), raw || {}));
    return this.data;
  }

  get() {
    return this.data;
  }

  patch(p) {
    if (!isPlainObject(p)) return this.data;
    deepMerge(this.data, p);
    this.data = sanitizeConfig(this.data);
    this.changed();
    return this.data;
  }

  setItems(wsId, items) {
    const ws = this.data.workspaces.find((w) => w.id === wsId);
    if (!ws) return false;
    ws.items = sanitizeItems(items);
    this.changed();
    return true;
  }

  replace(data) {
    this.data = sanitizeConfig(deepMerge(baseConfig(), data || {}));
    this.changed();
  }

  activeWorkspace() {
    return this.data.workspaces.find((w) => w.id === this.data.activeWorkspace) || this.data.workspaces[0];
  }

  // Todos los elementos lanzables, incluidos los que están dentro de grupos.
  allItems() {
    const out = [];
    for (const ws of this.data.workspaces)
      for (const it of ws.items) {
        out.push({ ws, item: it });
        if (it.type === 'group') for (const k of it.items) out.push({ ws, item: k, group: it });
      }
    return out;
  }

  changed() {
    this.writer.schedule();
    this.emit('change', this.data);
  }

  flush() {
    this.writer.flush();
  }
}

module.exports = { ConfigStore, deepMerge, sanitizeItems, sanitizeConfig };
