const test = require('node:test');
const assert = require('node:assert');
const { deepMerge, sanitizeItems, sanitizeConfig } = require('../src/main/store');
const { baseConfig, buildWorkspaces } = require('../src/main/defaults');

test('deepMerge combina objetos y reemplaza listas', () => {
  const t = { a: { b: 1, c: 2 }, l: [1, 2] };
  deepMerge(t, { a: { b: 5 }, l: [9], __proto__: { x: 1 } });
  assert.deepEqual(t, { a: { b: 5, c: 2 }, l: [9] });
});

test('sanitizeItems descarta tipos desconocidos y aplana grupos anidados', () => {
  const items = sanitizeItems([
    { type: 'app', name: 'X', target: 'C:\\x.exe' },
    { type: 'malo' },
    { type: 'group', name: 'G', items: [{ type: 'group', items: [{ type: 'url', target: 'https://a' }] }, { type: 'file', target: 'f' }] },
  ]);
  assert.equal(items.length, 2);
  assert.ok(items[0].id);
  assert.deepEqual(items[1].items.map((i) => i.type), ['url', 'file'], 'el subgrupo se aplana dentro del grupo');
});

test('sanitizeConfig corrige valores fuera de rango', () => {
  const c = sanitizeConfig(deepMerge(baseConfig(), { appearance: { iconSize: 900, magnification: 9 }, position: { edge: 'diagonal', margin: -5 } }));
  assert.equal(c.appearance.iconSize, 96);
  assert.equal(c.appearance.magnification, 2.6);
  assert.equal(c.position.edge, 'bottom');
  assert.equal(c.position.margin, 0);
});

test('el dock inicial de Windows usa las apps encontradas', () => {
  const apps = [
    { name: 'Google Chrome', appId: 'Chrome' },
    { name: 'Word', appId: 'Word' },
    { name: 'Excel', appId: 'Excel' },
    { name: 'Calculadora', appId: 'Calc' },
    { name: 'Spotify', appId: 'Spotify' },
  ];
  const paths = { home: 'C:\\U', desktop: 'C:\\U\\Desktop', documents: 'C:\\U\\Docs', downloads: 'C:\\U\\Downloads', pictures: 'P', music: 'M', videos: 'V' };
  const ws = buildWorkspaces({ apps, paths, platform: 'win32' });
  assert.equal(ws.length, 3);
  const principal = ws[0].items;
  assert.ok(principal.some((i) => i.appId === 'Chrome'));
  const oficina = principal.find((i) => i.type === 'group' && i.name === 'Oficina');
  assert.deepEqual(oficina.items.map((i) => i.name), ['Word', 'Excel']);
  assert.ok(ws[2].items.some((i) => i.name === 'Spotify'));
  const c = sanitizeConfig(deepMerge(baseConfig(), { workspaces: ws }));
  assert.equal(c.workspaces[0].items.length, principal.length, 'la configuración inicial es válida');
});
