// Lectura y escritura segura de archivos JSON (escritura atómica con respaldo).
const fs = require('fs');
const path = require('path');

function readJSON(file, fallback) {
  for (const f of [file, file + '.bak']) {
    try {
      const txt = fs.readFileSync(f, 'utf8');
      if (txt.trim()) return JSON.parse(txt);
    } catch {}
  }
  return fallback;
}

function writeJSONSync(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
  } catch {}
  fs.renameSync(tmp, file);
}

// Guarda con retraso para agrupar cambios seguidos.
function debouncedWriter(file, getData, ms = 300) {
  let timer = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    try {
      writeJSONSync(file, getData());
    } catch (e) {
      console.error('No se pudo guardar', file, e);
    }
  };
  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, ms);
    },
    flush,
    pending: () => !!timer,
  };
}

module.exports = { readJSON, writeJSONSync, debouncedWriter };
