// Ventanas: el dock (una por pantalla), el panel de configuración y el buscador rápido.
const { BrowserWindow, screen, nativeTheme } = require('electron');
const os = require('os');
const path = require('path');

const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const APP_URL = 'lanz://app';

function webPrefs(extra = {}) {
  return {
    preload: PRELOAD,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false,
    backgroundThrottling: false,
    ...extra,
  };
}

function isWin11() {
  if (process.platform !== 'win32') return false;
  const build = Number(os.release().split('.')[2] || 0);
  return build >= 22000;
}

function hardenWebContents(wc) {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_URL)) e.preventDefault();
  });
}

function dockBounds(display, pos) {
  const area = pos.overTaskbar ? display.bounds : display.workArea;
  const vertical = pos.edge === 'left' || pos.edge === 'right';
  if (vertical) {
    const T = Math.round(Math.min(680, area.width * 0.6));
    return { x: pos.edge === 'left' ? area.x : area.x + area.width - T, y: area.y, width: T, height: area.height };
  }
  const T = Math.round(Math.min(620, area.height * 0.78));
  return { x: area.x, y: pos.edge === 'top' ? area.y : area.y + area.height - T, width: area.width, height: T };
}

class DockManager {
  constructor(store) {
    this.store = store;
    this.wins = new Map();
    this.hidden = false;
    this.fullscreenDisplay = null;
  }

  // Un programa en pantalla completa esconde el dock de esa pantalla.
  setFullscreen(displayId) {
    this.fullscreenDisplay = this.store.get().behavior.hideInFullscreen ? displayId : null;
    this.applyVisibility();
  }

  applyVisibility() {
    for (const [id, w] of this.wins) {
      if (w.isDestroyed()) continue;
      const show = !this.hidden && id !== this.fullscreenDisplay;
      if (show && !w.isVisible()) w.showInactive();
      if (!show && w.isVisible()) w.hide();
    }
  }

  targetDisplays() {
    const pos = this.store.get().position;
    const all = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    if (pos.display === 'all') return all;
    if (pos.display === 'primary') return [primary];
    return [all.find((d) => String(d.id) === String(pos.display)) || primary];
  }

  sync() {
    const displays = this.targetDisplays();
    const ids = new Set(displays.map((d) => String(d.id)));
    for (const [id, win] of this.wins) {
      if (!ids.has(id)) {
        win.destroy();
        this.wins.delete(id);
      }
    }
    for (const d of displays) {
      const id = String(d.id);
      let win = this.wins.get(id);
      if (!win || win.isDestroyed()) {
        win = this.create(d);
        this.wins.set(id, win);
      }
      const b = dockBounds(d, this.store.get().position);
      const cur = win.getBounds();
      if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) win.setBounds(b);
      win.displayId = id;
    }
  }

  create(display) {
    const b = dockBounds(display, this.store.get().position);
    const win = new BrowserWindow({
      ...b,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      title: 'Lanzadera',
      type: process.platform === 'win32' ? 'toolbar' : undefined,
      webPreferences: webPrefs(),
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });
    if (process.platform !== 'win32') win.setVisibleOnAllWorkspaces?.(true);
    hardenWebContents(win.webContents);
    win.loadURL(`${APP_URL}/dock/index.html`);
    win.once('ready-to-show', () => {
      if (!this.hidden && String(display.id) !== this.fullscreenDisplay) win.showInactive();
    });
    win.on('closed', () => {
      for (const [id, w] of this.wins) if (w === win) this.wins.delete(id);
    });
    return win;
  }

  all() {
    return [...this.wins.values()].filter((w) => !w.isDestroyed());
  }

  toggle(force) {
    this.hidden = force === undefined ? !this.hidden : !force;
    this.applyVisibility();
  }

  setInteractive(win, interactive) {
    if (!win || win.isDestroyed()) return;
    if (interactive) win.setIgnoreMouseEvents(false);
    else win.setIgnoreMouseEvents(true, { forward: true });
  }
}

class PanelWindow {
  constructor() {
    this.win = null;
  }

  open(route = '') {
    if (this.win && !this.win.isDestroyed()) {
      if (route) this.win.webContents.send('panel:route', route);
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      this.win.focus();
      return this.win;
    }
    const dark = nativeTheme.shouldUseDarkColors;
    const win11 = isWin11();
    this.win = new BrowserWindow({
      width: 1120,
      height: 780,
      minWidth: 880,
      minHeight: 600,
      show: false,
      title: 'Lanzadera',
      icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
      backgroundColor: win11 ? '#00000000' : dark ? '#1c1c1f' : '#f3f3f5',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#ffffff' : '#1a1a1a', height: 40 },
      backgroundMaterial: win11 ? 'mica' : undefined,
      autoHideMenuBar: true,
      webPreferences: webPrefs(),
    });
    hardenWebContents(this.win.webContents);
    this.win.loadURL(`${APP_URL}/panel/index.html${route ? '#' + route.replace(/^#/, '') : ''}`);
    this.win.once('ready-to-show', () => this.win.show());
    this.win.on('closed', () => (this.win = null));
    return this.win;
  }

  setTheme(dark) {
    if (!this.win || this.win.isDestroyed()) return;
    try {
      this.win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#ffffff' : '#1a1a1a', height: 40 });
    } catch {}
    if (!isWin11()) this.win.setBackgroundColor(dark ? '#1c1c1f' : '#f3f3f5');
  }
}

class SearchWindow {
  constructor() {
    this.win = null;
  }

  ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      width: 760,
      height: 560,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      hasShadow: false,
      title: 'Buscar',
      webPreferences: webPrefs(),
    });
    hardenWebContents(this.win.webContents);
    this.win.loadURL(`${APP_URL}/search/index.html`);
    this.win.on('blur', () => {
      if (this.win && !this.win.webContents.isDevToolsOpened()) this.hide();
    });
    this.win.on('closed', () => (this.win = null));
    return this.win;
  }

  show(query = '') {
    const win = this.ensure();
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const [w, h] = win.getSize();
    win.setPosition(Math.round(d.workArea.x + (d.workArea.width - w) / 2), Math.round(d.workArea.y + d.workArea.height * 0.16));
    const reveal = () => {
      win.show();
      win.focus();
      win.webContents.send('search:shown', { query });
    };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', reveal);
    else reveal();
  }

  toggle() {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.hide();
    else this.show();
  }

  hide() {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      this.win.hide();
      this.win.webContents.send('search:hidden');
    }
  }
}

module.exports = { DockManager, PanelWindow, SearchWindow, isWin11 };
