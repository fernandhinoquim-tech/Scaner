import test from 'node:test';
import assert from 'node:assert';
import { calculate, looksLikeMath } from '../src/renderer/shared/calc.js';
import { search, scoreText } from '../src/renderer/shared/fuzzy.js';
import { tileSVG, TILE_STYLES, GRADIENTS } from '../src/renderer/shared/tiles.js';
import { autoDesign, fileTypeOf } from '../src/renderer/shared/autoicon.js';
import { searchIcons } from '../src/renderer/shared/icon-es.js';
import { GLYPHS } from '../src/renderer/shared/icon-bank.js';

test('calculadora segura', () => {
  assert.equal(calculate('12*(3+4)'), 84);
  assert.equal(calculate('2^10'), 1024);
  assert.equal(calculate('80*15%'), 12);
  assert.equal(calculate('-3+5'), 2);
  assert.equal(calculate('1,5 x 2'), 3);
  assert.throws(() => calculate('alert(1)'));
  assert.ok(looksLikeMath('2+2'));
  assert.ok(!looksLikeMath('chrome'));
  assert.ok(!looksLikeMath('2026'));
});

test('búsqueda difusa insensible a tildes', () => {
  assert.ok(scoreText('Configuración', 'configuracion') > 90);
  const entries = [{ title: 'Visual Studio Code', kind: 'app' }, { title: 'Calculadora', kind: 'app' }, { title: 'Música', kind: 'folder' }];
  assert.equal(search(entries, 'vsc')[0].title, 'Visual Studio Code');
  assert.equal(search(entries, 'musica')[0].title, 'Música');
});

test('los mosaicos se generan en todos los estilos sin glifos inválidos', () => {
  for (const s of TILE_STYLES) for (const g of GRADIENTS.slice(0, 3)) {
    const svg = tileSVG({ glyph: 'folder', colors: g.c, style: s.id });
    assert.match(svg, /^<svg class="tile"/);
    assert.ok(!svg.includes('undefined'));
  }
});

test('iconos automáticos usan glifos existentes', () => {
  const samples = [
    { type: 'app', name: 'Google Chrome' }, { type: 'app', name: 'Excel' }, { type: 'app', name: 'Steam' }, { type: 'app', name: 'Programa raro' },
    { type: 'folder', name: 'Descargas' }, { type: 'file', name: 'x.pdf', target: 'x.pdf' }, { type: 'url', name: 'YouTube', target: 'https://youtube.com' },
  ];
  for (const s of samples) {
    const d = autoDesign(s);
    if (d.glyph) assert.ok(GLYPHS[d.glyph], `${s.name} → ${d.glyph}`);
    else assert.ok(d.text);
  }
  assert.equal(fileTypeOf('foto.JPEG'), 'imagen');
});

test('el banco de iconos busca en español', () => {
  assert.ok(searchIcons('musica').includes('music'));
  assert.ok(searchIcons('carpeta').includes('folder'));
  assert.ok(searchIcons('juego').some((n) => n.startsWith('gamepad')));
});
