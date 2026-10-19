// Detecta programas en pantalla completa (videos, juegos) para esconder el dock como la barra de tareas.
const { screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');
const { isWin, helperPath } = require('./winhelper');

class FullscreenWatcher extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.displayId = null;
    this.restarts = 0;
    this.lastLine = '';
  }

  start() {
    if (!isWin || this.child) return;
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    try {
      this.child = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath(), '-Mode', 'watch', '-ParentPid', String(process.pid)], { windowsHide: true });
    } catch {
      return;
    }
    let buf = '';
    this.child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        this.handle(buf.slice(0, i).trim());
        buf = buf.slice(i + 1);
      }
    });
    this.child.on('error', () => {});
    this.child.on('exit', () => {
      this.child = null;
      this.set(null);
      if (!this.stopped && this.restarts++ < 3) setTimeout(() => this.start(), 5000);
    });
  }

  handle(line) {
    this.lastLine = line;
    if (!line.startsWith('1,')) return this.set(null);
    const [l, t, r, b] = line.slice(2).split(',').map(Number);
    if (![l, t, r, b].every(Number.isFinite)) return this.set(null);
    let rect = { x: l, y: t, width: r - l, height: b - t };
    try {
      rect = screen.screenToDipRect(null, rect);
    } catch {}
    this.set(String(screen.getDisplayMatching(rect).id));
  }

  set(displayId) {
    if (this.displayId === displayId) return;
    this.displayId = displayId;
    this.emit('change', displayId);
  }

  stop() {
    this.stopped = true;
    this.child?.kill();
    this.child = null;
  }
}

module.exports = { FullscreenWatcher };
