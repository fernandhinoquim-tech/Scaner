// Puente con PowerShell para funciones propias de Windows.
const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

const isWin = process.platform === 'win32';

function helperPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'win', 'helper.ps1') : path.join(__dirname, '..', '..', 'resources', 'win', 'helper.ps1');
}

function runPowerShell(args, { env = {}, timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    if (!isWin) return resolve({ code: -1, stdout: '', stderr: 'no-windows' });
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    let child;
    try {
      child = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], {
        windowsHide: true,
        env: { ...process.env, ...env },
      });
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: String(e) });
    }
    const out = [];
    const err = [];
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => err.push(Buffer.from(String(e))));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
    });
  });
}

function runHelper(mode, params = [], opts) {
  return runPowerShell(['-File', helperPath(), '-Mode', mode, ...params], opts);
}

// Ejecuta un script corto; los valores llegan por variables de entorno para evitar inyecciones.
function runCommand(script, env, opts) {
  return runPowerShell(['-Command', script], { env, ...opts });
}

function parseJSON(text) {
  const t = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

module.exports = { isWin, runHelper, runCommand, parseJSON, helperPath };
