// Rendimiento del equipo y estadísticas de uso para las sugerencias inteligentes.
const os = require('os');
const fsp = require('fs').promises;
const path = require('path');
const { readJSON, debouncedWriter } = require('./jsonfile');

let lastCpu = null;

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const v of Object.values(c.times)) total += v;
    idle += c.times.idle;
  }
  return { idle, total };
}

async function stats() {
  const now = cpuTimes();
  let cpu = 0;
  if (lastCpu) {
    const dt = now.total - lastCpu.total;
    cpu = dt > 0 ? Math.round(100 * (1 - (now.idle - lastCpu.idle) / dt)) : 0;
  }
  lastCpu = now;
  const total = os.totalmem();
  const free = os.freemem();
  let disk = null;
  try {
    const root = process.platform === 'win32' ? (process.env.SystemDrive || 'C:') + '\\' : '/';
    const s = await fsp.statfs(root);
    disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize, root };
  } catch {}
  return {
    cpu: Math.max(0, Math.min(100, cpu)),
    cpuModel: os.cpus()[0]?.model?.replace(/\s+/g, ' ').trim() || '',
    cores: os.cpus().length,
    mem: Math.round(((total - free) / total) * 100),
    memUsed: total - free,
    memTotal: total,
    disk,
    uptime: os.uptime(),
    host: os.hostname(),
  };
}

// Cuenta cuántas veces se abre cada elemento y a qué hora, para sugerir.
class UsageStats {
  constructor(dir) {
    this.file = path.join(dir, 'stats.json');
    this.data = readJSON(this.file, {});
    this.writer = debouncedWriter(this.file, () => this.data, 2000);
  }

  key(item) {
    return item.appId || item.target || item.id;
  }

  record(item) {
    if (!item || ['separator', 'widget', 'action', 'group', 'folderStack', 'recent', 'shelf', 'smart'].includes(item.type)) return;
    const k = this.key(item);
    if (!k) return;
    const e = (this.data[k] ||= { hours: Array(24).fill(0), total: 0, last: 0, item: null });
    e.hours[new Date().getHours()]++;
    e.total++;
    e.last = Date.now();
    e.item = { type: item.type, name: item.name, target: item.target, appId: item.appId, args: item.args, icon: item.icon };
    this.writer.schedule();
  }

  suggest(n = 8) {
    const h = new Date().getHours();
    const now = Date.now();
    return Object.values(this.data)
      .filter((e) => e.item)
      .map((e) => {
        const near = e.hours[h] * 3 + e.hours[(h + 1) % 24] + e.hours[(h + 23) % 24];
        const recency = Math.max(0, 1 - (now - e.last) / (7 * 86400 * 1000));
        return { e, score: near * 2 + Math.log1p(e.total) + recency * 2 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map(({ e }) => e.item);
  }

  flush() {
    this.writer.flush();
  }
}

module.exports = { stats, UsageStats };
