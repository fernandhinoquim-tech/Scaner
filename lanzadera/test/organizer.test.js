const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Organizer, categorize, safeFolderName } = require('../src/main/organizer');

function tempFolder(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-test-'));
  const old = new Date(Date.now() - 3600 * 1000);
  for (const n of names) {
    fs.writeFileSync(path.join(dir, n), 'x');
    fs.utimesSync(path.join(dir, n), old, old);
  }
  return dir;
}

test('clasifica por extensión', () => {
  assert.equal(categorize('foto.JPG', false, {}).name, 'Imágenes');
  assert.equal(categorize('informe.pdf', false, {}).name, 'PDF');
  assert.equal(categorize('x.unknownext', false, {}).name, 'Otros');
  assert.equal(categorize('acceso.lnk', false, {}), null);
  assert.equal(categorize('acceso.lnk', false, { includeShortcuts: true }).name, 'Accesos directos');
  assert.equal(categorize('carpeta', true, {}), null);
  assert.equal(categorize('plano.dwg', false, { rules: [{ name: 'Planos', exts: '*.dwg, dxf' }] }).name, 'Planos');
});

test('nombres de carpeta seguros', () => {
  assert.equal(safeFolderName('Mis: cosas?*', 'X'), 'Mis cosas');
  assert.equal(safeFolderName('   ', 'Organizado'), 'Organizado');
  assert.equal(safeFolderName('..', 'Organizado'), 'Organizado');
});

test('ordena, evita choques de nombre y deshace', async () => {
  const dir = tempFolder(['a.jpg', 'b.pdf', 'c.txt', 'd.lnk', 'nuevo.png']);
  fs.utimesSync(path.join(dir, 'nuevo.png'), new Date(), new Date());
  fs.mkdirSync(path.join(dir, 'Organizado', 'PDF'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Organizado', 'PDF', 'b.pdf'), 'existente');
  const hist = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-hist-'));
  const org = new Organizer(hist);
  const plan = await org.plan(dir, { mode: 'container', containerName: 'Organizado' });
  assert.equal(plan.moves.length, 3, 'a.jpg, b.pdf y c.txt (el .lnk y el archivo nuevo se omiten)');
  assert.equal(plan.skipped.length, 1);
  const res = await org.apply(plan.id, []);
  assert.equal(res.moved, 3);
  assert.ok(fs.existsSync(path.join(dir, 'Organizado', 'PDF', 'b (2).pdf')), 'no sobrescribe archivos existentes');
  assert.equal(fs.readFileSync(path.join(dir, 'Organizado', 'PDF', 'b.pdf'), 'utf8'), 'existente');
  const u = await org.undo(res.id);
  assert.equal(u.restored, 3);
  for (const n of ['a.jpg', 'b.pdf', 'c.txt', 'd.lnk']) assert.ok(fs.existsSync(path.join(dir, n)), n + ' regresó');
  assert.ok(fs.existsSync(path.join(dir, 'Organizado', 'PDF', 'b.pdf')), 'el archivo que ya estaba no se toca');
  assert.ok(!fs.existsSync(path.join(dir, 'Organizado', 'Imágenes')), 'borra carpetas vacías creadas');
  await assert.rejects(() => org.undo(res.id));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('excluir movimientos y modo "aquí mismo" con meses', async () => {
  const dir = tempFolder(['a.mp3', 'b.mp4']);
  const org = new Organizer(fs.mkdtempSync(path.join(os.tmpdir(), 'lz-hist-')));
  const plan = await org.plan(dir, { mode: 'inplace', byMonth: true });
  const idx = plan.moves.findIndex((m) => m.name === 'a.mp3');
  const res = await org.apply(plan.id, [idx]);
  assert.equal(res.moved, 1);
  assert.ok(fs.existsSync(path.join(dir, 'a.mp3')));
  const vids = fs.readdirSync(path.join(dir, 'Videos'));
  assert.match(vids[0], /^\d{4}-\d{2}$/);
  fs.rmSync(dir, { recursive: true, force: true });
});
