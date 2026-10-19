// Exportar e importar toda la configuración (incluidos los iconos subidos).
const { app, dialog } = require('electron');
const fsp = require('fs').promises;
const path = require('path');

function createBackup({ store, customDir }) {
  return {
    async exportTo(win) {
      const date = new Date().toISOString().slice(0, 10);
      const r = await dialog.showSaveDialog(win, {
        title: 'Guardar copia de seguridad',
        defaultPath: path.join(app.getPath('documents'), `Lanzadera-respaldo-${date}.json`),
        filters: [{ name: 'Respaldo de Lanzadera', extensions: ['json'] }],
      });
      if (r.canceled || !r.filePath) return { canceled: true };
      const cfg = store.get();
      const icons = [];
      for (const ic of cfg.customIcons) {
        try {
          icons.push({ file: ic.file, data: (await fsp.readFile(path.join(customDir, ic.file))).toString('base64') });
        } catch {}
      }
      const data = { app: 'lanzadera', version: app.getVersion(), date: Date.now(), config: cfg, icons };
      await fsp.writeFile(r.filePath, JSON.stringify(data, null, 1), 'utf8');
      return { file: r.filePath };
    },

    async importFrom(win) {
      const r = await dialog.showOpenDialog(win, { title: 'Restaurar copia de seguridad', properties: ['openFile'], filters: [{ name: 'Respaldo de Lanzadera', extensions: ['json'] }] });
      if (r.canceled || !r.filePaths[0]) return { canceled: true };
      let data;
      try {
        data = JSON.parse(await fsp.readFile(r.filePaths[0], 'utf8'));
      } catch {
        throw new Error('El archivo no es un respaldo válido');
      }
      if (data?.app !== 'lanzadera' || !data.config) throw new Error('El archivo no es un respaldo de Lanzadera');
      await fsp.mkdir(customDir, { recursive: true });
      for (const ic of data.icons || []) {
        const name = path.basename(String(ic.file || ''));
        if (!/^[\w.-]+\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i.test(name)) continue;
        await fsp.writeFile(path.join(customDir, name), Buffer.from(String(ic.data || ''), 'base64'));
      }
      store.replace({ ...data.config, firstRun: false });
      return { ok: true };
    },
  };
}

module.exports = { createBackup };
