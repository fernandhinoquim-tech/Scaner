// Prueba automática: abre todas las vistas, toma capturas y verifica funciones clave.
// Se activa con la variable LANZADERA_SMOKE=<carpeta de salida>.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describePaths } = require('./ipc');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitLoad(win) {
  if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));
  await wait(700);
}

async function run(ctx) {
  const out = path.resolve(process.env.LANZADERA_SMOKE);
  fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
  const report = { platform: process.platform, release: os.release(), version: app.getVersion(), steps: [], consoleErrors: [] };
  const critical = new Set();

  app.on('web-contents-created', (e, wc) => watchConsole(wc));
  for (const w of BrowserWindow.getAllWindows()) watchConsole(w.webContents);
  function watchConsole(wc) {
    wc.on('console-message', (ev) => {
      const level = ev.level ?? ev.params?.level;
      const message = ev.message ?? ev.params?.message;
      if (level === 'error' || level === 3) report.consoleErrors.push(String(message).slice(0, 500));
    });
    wc.on('render-process-gone', (e, d) => report.consoleErrors.push('render-process-gone ' + d.reason));
  }

  const only = process.env.LANZADERA_SMOKE_ONLY ? new RegExp(process.env.LANZADERA_SMOKE_ONLY) : null;
  const step = async (name, fn, isCritical = false) => {
    if (only && !only.test(name)) return;
    const t0 = Date.now();
    console.log('SMOKE paso:', name);
    try {
      const info = await fn();
      report.steps.push({ name, ok: true, ms: Date.now() - t0, info });
    } catch (e) {
      report.steps.push({ name, ok: false, ms: Date.now() - t0, error: String(e?.stack || e) });
      if (isCritical) critical.add(name);
    }
  };
  const shot = async (win, name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
    return img.getSize();
  };
  const dockWin = () => ctx.docks.all()[0];
  const dockEval = (js) => dockWin().webContents.executeJavaScript(js);

  await wait(2500);
  await step('dock-carga', async () => {
    const w = dockWin();
    if (!w) throw new Error('No hay ventana del dock');
    await waitLoad(w);
    await wait(1500);
    const n = await dockEval('document.querySelectorAll(".item").length');
    if (!n) throw new Error('El dock no tiene elementos');
    await shot(w, '01-dock-reposo');
    return { items: n, bounds: w.getBounds() };
  }, true);

  const hoverDock = async (frac = 0.5) =>
    dockEval(`(() => { const r = document.querySelector('.dock-bg').getBoundingClientRect(); const v = ['left','right'].includes(window.__lzTest.edge()); const x = v ? r.left + r.width/2 : r.left + r.width*${frac}; const y = v ? r.top + r.height*${frac} : r.top + r.height/2; window.__lzTest.pointer(x, y); return [x,y]; })()`);

  await step('dock-lupa', async () => {
    await hoverDock(0.3);
    await wait(500);
    await hoverDock(0.32);
    await wait(700);
    await shot(dockWin(), '02-dock-lupa');
  });

  const openByType = async (pred, name, wait2 = 900) => {
    await dockEval(`window.__lzTest.open(${JSON.stringify(pred)})`);
    await wait(wait2);
    await shot(dockWin(), name);
    await dockEval('window.__lzTest.close()');
    await wait(250);
  };
  await step('grupo', () => openByType({ type: 'group' }, '03-grupo'));
  await step('abanico-descargas', () => openByType({ type: 'folderStack', layout: 'fan' }, '04-abanico'));
  await step('calendario', () => openByType({ type: 'widget', widget: 'clock' }, '05-calendario'));
  await step('rendimiento', () => openByType({ type: 'widget', widget: 'system' }, '06-rendimiento', 2200));
  await step('notas', () => openByType({ type: 'widget', widget: 'notes' }, '07-notas'));
  await step('espacios', () => openByType({ type: 'action', action: 'workspaces' }, '08-espacios'));
  await step('ordenar-rapido', () => openByType({ type: 'action', action: 'organize' }, '09-ordenar', 1500));
  await step('menu', async () => {
    await dockEval('window.__lzTest.menu()');
    await wait(400);
    await shot(dockWin(), '10-menu');
    await dockEval('window.__lzTest.close()');
  });

  const cfg0 = JSON.parse(JSON.stringify(ctx.store.get()));
  for (const [i, edge] of ['left', 'top', 'right'].entries()) {
    await step('borde-' + edge, async () => {
      ctx.store.patch({ position: { edge, idle: 'normal' } });
      await wait(1400);
      await hoverDock(0.4);
      await wait(700);
      await shot(dockWin(), `11-borde-${i}-${edge}`);
    });
  }
  await step('modo-mini', async () => {
    ctx.store.patch({ position: { edge: 'bottom', idle: 'mini' } });
    await wait(600);
    await dockEval('window.__lzTest.release()');
    await wait(1200);
    await shot(dockWin(), '12-mini');
  });
  await step('estilo-iconos-diseno', async () => {
    ctx.store.patch({ position: { idle: 'normal' }, appearance: { iconMode: 'designed', tileStyle: 'glass' } });
    await wait(1400);
    await shot(dockWin(), '13-diseno-vidrio');
    ctx.store.patch({ appearance: { tileStyle: 'neon', theme: 'light' } });
    await wait(1400);
    await shot(dockWin(), '14-neon-claro');
  });
  ctx.store.replace(cfg0);
  await wait(800);

  // Panel de configuración
  const routes = ['/bienvenida', '/inicio', '/elementos', '/apariencia', '/posicion', '/comportamiento', '/espacios', '/iconos', '/organizador', '/widgets', '/respaldo', '/acerca', '/agregar'];
  for (const r of routes) {
    await step('panel' + r, async () => {
      const w = ctx.panel.open(r);
      await waitLoad(w);
      w.webContents.send('panel:route', r);
      await wait(r === '/iconos' || r === '/agregar' ? 2200 : 1000);
      await shot(w, '20-panel-' + r.slice(1));
    });
  }
  await step('panel-editor-icono', async () => {
    const it = ctx.store.activeWorkspace().items.find((i) => i.type === 'app' || i.type === 'url');
    const w = ctx.panel.open('/iconos?id=' + (it?.id || ''));
    w.webContents.send('panel:route', '/iconos?id=' + (it?.id || ''));
    await wait(2000);
    await shot(w, '21-panel-editor-icono');
  });

  // Buscador
  await step('buscador', async () => {
    ctx.search.show('');
    const w = ctx.search.win;
    await waitLoad(w);
    await w.webContents.executeJavaScript(`(() => { const i = document.querySelector('#q'); i.value = 'con'; i.dispatchEvent(new Event('input')); })()`);
    await wait(1500);
    await shot(w, '30-buscador');
    await w.webContents.executeJavaScript(`(() => { const i = document.querySelector('#q'); i.value = '12*(3+4)'; i.dispatchEvent(new Event('input')); })()`);
    await wait(600);
    await shot(w, '31-buscador-calculo');
    ctx.search.hide();
  });

  // Organizador real sobre una carpeta temporal
  await step('organizador', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-org-'));
    const names = ['foto.jpg', 'informe.pdf', 'notas.txt', 'tabla.xlsx', 'cancion.mp3', 'video.mp4', 'archivo.zip', 'raro.xyz', 'Acceso.lnk'];
    const old = new Date(Date.now() - 3600 * 1000);
    for (const n of names) {
      fs.writeFileSync(path.join(dir, n), 'x');
      fs.utimesSync(path.join(dir, n), old, old);
    }
    const plan = await ctx.organizer.plan(dir, { mode: 'container', containerName: 'Organizado' });
    if (plan.moves.length !== 8) throw new Error('Plan inesperado: ' + plan.moves.length);
    const res = await ctx.organizer.apply(plan.id, []);
    if (res.moved !== 8) throw new Error('Movidos: ' + res.moved);
    if (!fs.existsSync(path.join(dir, 'Organizado', 'PDF', 'informe.pdf'))) throw new Error('No se creó PDF/informe.pdf');
    const u = await ctx.organizer.undo(res.id);
    if (u.restored !== 8 || !fs.existsSync(path.join(dir, 'informe.pdf'))) throw new Error('Deshacer falló');
    const left = fs.readdirSync(dir).sort();
    fs.rmSync(dir, { recursive: true, force: true });
    return { categories: plan.categories, afterUndo: left };
  }, true);

  await step('describir-rutas', async () => describePaths([os.homedir(), __filename]));

  // Funciones propias de Windows
  if (process.platform === 'win32') {
    let apps = [];
    await step('apps-windows', async () => {
      apps = await ctx.apps.refresh();
      if (!apps.length) throw new Error('Get-StartApps no devolvió aplicaciones');
      return { count: apps.length, sample: apps.slice(0, 25) };
    });
    const sys = process.env.SystemRoot || 'C:\\Windows';
    const txt = path.join(os.tmpdir(), 'lz-prueba.txt');
    fs.writeFileSync(txt, 'hola');
    const calc = apps.find((a) => /calc/i.test(a.appId));
    const targets = [
      { name: 'explorer', src: path.join(sys, 'explorer.exe') },
      { name: 'notepad', src: path.join(sys, 'System32', 'notepad.exe') },
      { name: 'taskmgr', src: path.join(sys, 'System32', 'Taskmgr.exe') },
      { name: 'control', src: path.join(sys, 'System32', 'control.exe') },
      { name: 'este-equipo', src: 'shell:MyComputerFolder' },
      { name: 'papelera', src: 'shell:RecycleBinFolder' },
      { name: 'texto', src: txt },
      { name: 'carpeta', src: os.homedir() },
      ...apps.slice(0, 6).map((a, i) => ({ name: 'app' + i, app: a.appId, label: a.name })),
      ...(calc ? [{ name: 'calculadora', app: calc.appId }] : []),
    ];
    await step('iconos-windows', async () => {
      const t0 = Date.now();
      const results = await Promise.all(
        targets.map(async (t) => {
          const file = await ctx.icons.get({ app: t.app, src: t.src });
          if (file) fs.copyFileSync(file, path.join(out, 'icons', t.name + '.png'));
          return { ...t, ok: !!file };
        })
      );
      const ok = results.filter((r) => r.ok).length;
      if (ok < targets.length / 2) throw new Error(`Solo ${ok} de ${targets.length} iconos`);
      return { ms: Date.now() - t0, results };
    });
    await step('pantalla-completa', async () => {
      const { FullscreenWatcher } = require('./fullscreen');
      const fw = new FullscreenWatcher();
      fw.start();
      await wait(6000);
      const alive = !!fw.child;
      const line = fw.lastLine;
      fw.stop();
      if (!alive) throw new Error('El vigilante de pantalla completa no siguió activo');
      return { line, display: fw.displayId };
    });
    await step('miniatura', async () => {
      const t = await ctx.icons.thumbnail(txt, 128);
      return { ok: !!t };
    });
  }

  report.ok = !critical.size && !report.consoleErrors.length;
  report.critical = [...critical];
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log('SMOKE', report.ok ? 'OK' : 'FALLÓ', JSON.stringify({ critical: report.critical, consoleErrors: report.consoleErrors.slice(0, 10) }));
  ctx.store.flush();
  setTimeout(() => app.exit(report.ok ? 0 : 1), 300);
}

module.exports = { run };
