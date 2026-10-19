// Abre programas, archivos, carpetas y enlaces.
const { shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { isWin, runCommand } = require('./winhelper');
const { resolveAppPath } = require('./apps');
const { expandEnv } = require('./icons');

const BLOCKED_SCHEMES = /^(javascript|data|vbscript|blob|about|chrome|devtools):/i;

function isDrivePath(p) {
  return /^[a-z]:[\\/]/i.test(p) || /^\\\\/.test(p) || p.startsWith('/');
}

function spawnDetached(cmd, args) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
}

async function openUrl(url) {
  if (BLOCKED_SCHEMES.test(url)) throw new Error('Dirección no permitida');
  if (/^file:/i.test(url)) {
    const err = await shell.openPath(decodeURIComponent(new URL(url).pathname.replace(/^\/([a-z]:)/i, '$1')));
    if (err) throw new Error(err);
    return;
  }
  await shell.openExternal(url);
}

async function startProcess(file, args, cwd, admin) {
  if (!isWin) {
    spawnDetached(file, args ? args.split(' ').filter(Boolean) : []);
    return;
  }
  const script =
    '$p=@{FilePath=$env:LZ_FILE};' +
    'if($env:LZ_ARGS){$p.ArgumentList=$env:LZ_ARGS};' +
    'if($env:LZ_CWD){$p.WorkingDirectory=$env:LZ_CWD};' +
    "if($env:LZ_ADMIN -eq '1'){$p.Verb='RunAs'};" +
    'Start-Process @p';
  const res = await runCommand(script, { LZ_FILE: file, LZ_ARGS: args || '', LZ_CWD: cwd || '', LZ_ADMIN: admin ? '1' : '0' }, { timeout: 120000 });
  if (res.code !== 0) {
    const msg = res.stderr.split('\n').find((l) => l.trim()) || 'No se pudo abrir';
    if (/cancel/i.test(res.stderr)) throw new Error('Cancelado por el usuario');
    throw new Error(msg.trim());
  }
}

async function launch(item, opts = {}) {
  const admin = !!(opts.admin || item.admin);
  if (item.type === 'url') return openUrl(String(item.target || ''));

  if (item.appId && !admin && !item.args && isWin) {
    spawnDetached(path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), ['shell:AppsFolder\\' + item.appId]);
    return;
  }

  let target = expandEnv(item.target || (item.appId ? resolveAppPath(item.appId) : ''));
  if (!target) throw new Error('Este elemento no tiene destino');

  if (/^shell:/i.test(target)) {
    if (!isWin) throw new Error('Solo disponible en Windows');
    spawnDetached(path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), [target]);
    return;
  }
  if (!isDrivePath(target) && /^[a-z][a-z0-9+.-]*:/i.test(target)) return openUrl(target);
  if (!fs.existsSync(target)) throw new Error(`No se encontró: ${target}`);

  if (admin || item.args || item.cwd) return startProcess(target, item.args, item.cwd, admin);
  const err = await shell.openPath(target);
  if (err) throw new Error(err);
}

async function showDesktop() {
  if (!isWin) return;
  await runCommand('(New-Object -ComObject Shell.Application).ToggleDesktop()', {}, { timeout: 15000 });
}

async function lockComputer() {
  if (!isWin) return;
  spawnDetached(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe'), ['user32.dll,LockWorkStation']);
}

module.exports = { launch, openUrl, showDesktop, lockComputer };
