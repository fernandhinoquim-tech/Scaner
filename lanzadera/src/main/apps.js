// Descubre las aplicaciones instaladas (menú Inicio y Microsoft Store).
const fs = require('fs');
const path = require('path');
const { isWin, runHelper, parseJSON } = require('./winhelper');
const { readJSON, writeJSONSync } = require('./jsonfile');

const env = process.env;
const KNOWN_FOLDERS = {
  '{6D809377-6AF0-444B-8957-A3773F02200E}': env.ProgramW6432 || env.ProgramFiles,
  '{905E63B6-C1BF-494E-B29C-65B732D3D21A}': env.ProgramFiles,
  '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}': env['ProgramFiles(x86)'],
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}': env.SystemRoot && path.join(env.SystemRoot, 'System32'),
  '{D65231B0-B2F1-4857-A4CE-A8E7C6EA7D27}': env.SystemRoot && path.join(env.SystemRoot, 'SysWOW64'),
  '{F38BF404-1D43-42F2-9305-67DE0B28FC23}': env.SystemRoot,
  '{F7F1ED05-9F6D-47A2-AAAE-29D317C6F066}': env.CommonProgramFiles,
  '{6365D5A7-0F0D-45E5-87F6-0DA56B6A4F7D}': env.CommonProgramW6432,
  '{DE974D24-D9C6-4D3E-BF91-F4455120B917}': env['CommonProgramFiles(x86)'],
  '{5CD7AEE2-2219-4A67-B85D-6C9CE15660CB}': env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'),
  '{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}': env.LOCALAPPDATA,
  '{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}': env.APPDATA,
};

const JUNK = /uninstall|desinstal|readme|l[eé]ame|\bhelp\b|ayuda|documentation|documentaci[oó]n|manual|license|licencia|release notes|notas de la versi[oó]n|website|sitio web|\bweb site\b/i;

function resolveAppPath(appId) {
  if (!appId) return '';
  const m = /^(\{[0-9A-F-]{36}\})\\(.+)$/i.exec(appId);
  if (m) {
    const base = KNOWN_FOLDERS[m[1].toUpperCase()];
    if (base) {
      const p = path.join(base, m[2]);
      if (fs.existsSync(p)) return p;
    }
    return '';
  }
  if (/^[a-z]:\\/i.test(appId) && fs.existsSync(appId)) return appId;
  return '';
}

class AppCatalog {
  constructor(dir) {
    this.file = path.join(dir, 'apps-cache.json');
    this.apps = readJSON(this.file, []);
    this.loadedAt = 0;
    this.loading = null;
  }

  async list({ refresh = false } = {}) {
    if (!refresh && this.loadedAt && Date.now() - this.loadedAt < 30 * 60 * 1000) return this.apps;
    if (!refresh && this.apps.length && !this.loading) {
      this.refresh();
      return this.apps;
    }
    return this.refresh();
  }

  refresh() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        if (!isWin) return this.apps;
        const res = await runHelper('apps', [], { timeout: 45000 });
        let list = parseJSON(res.stdout);
        if (list && !Array.isArray(list)) list = [list];
        if (!Array.isArray(list)) {
          console.error('Lista de apps no disponible', res.stderr);
          return this.apps;
        }
        const seen = new Set();
        const apps = [];
        for (const a of list) {
          const name = String(a.name || '').trim();
          const appId = String(a.appId || '').trim();
          if (!name || !appId || JUNK.test(name)) continue;
          if (/^https?:/i.test(appId) || /\.(url|chm|txt|html?|pdf|rtf)$/i.test(appId)) continue;
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          apps.push({ name, appId, path: resolveAppPath(appId) });
        }
        apps.sort((x, y) => x.name.localeCompare(y.name, 'es'));
        this.apps = apps;
        this.loadedAt = Date.now();
        try {
          writeJSONSync(this.file, apps);
        } catch {}
        return apps;
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }
}

module.exports = { AppCatalog, resolveAppPath };
