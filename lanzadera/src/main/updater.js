// Actualizaciones automáticas desde GitHub Releases.
const { app, Notification } = require('electron');
const { EventEmitter } = require('events');

class Updater extends EventEmitter {
  constructor() {
    super();
    this.state = { status: 'idle', current: app.getVersion() };
    this.au = null;
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.state);
  }

  init() {
    if (!app.isPackaged || process.platform !== 'win32' || process.env.LANZADERA_SMOKE) {
      this.set({ status: 'dev' });
      return;
    }
    const { autoUpdater } = require('electron-updater');
    this.au = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }));
    autoUpdater.on('update-available', (i) => this.set({ status: 'downloading', version: i.version, progress: 0 }));
    autoUpdater.on('update-not-available', () => this.set({ status: 'none', checkedAt: Date.now() }));
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', progress: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (i) => {
      this.set({ status: 'ready', version: i.version });
      if (Notification.isSupported()) {
        const n = new Notification({ title: 'Lanzadera se actualizó', body: `La versión ${i.version} está lista. Haz clic para reiniciar ahora (o se instalará al cerrar).` });
        n.on('click', () => this.install());
        n.show();
      }
    });
    autoUpdater.on('error', (e) => this.set({ status: 'error', error: String(e?.message || e).slice(0, 300) }));
    setTimeout(() => this.check(), 20000);
    setInterval(() => this.check(), 6 * 3600 * 1000);
  }

  check(manual = false) {
    if (!this.au) {
      if (manual) this.set({ status: 'dev' });
      return;
    }
    this.au.checkForUpdates().catch((e) => this.set({ status: 'error', error: String(e?.message || e).slice(0, 300) }));
  }

  install() {
    if (this.au && this.state.status === 'ready') this.au.quitAndInstall(true, true);
  }
}

module.exports = { Updater };
