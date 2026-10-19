// Páginas: Inicio, Apariencia, Posición, Comportamiento, Widgets, Iconos, Respaldo y Acerca de.
import { h, esc, debounce } from '../shared/dom.js';
import { iconHTML, customUrl } from '../shared/icon-view.js';
import { tileSVG, gradientColors, TILE_STYLES, glyphSVG } from '../shared/tiles.js';
import { CATEGORY_NAMES, iconsInCategory, searchIcons } from '../shared/icon-es.js';
import { LUCIDE_VERSION } from '../shared/icon-bank.js';
import { P, api, ap, patch, activeWs, findAnywhere, updateAnywhere } from './ctx.js';
import { page, section, card, toggle, seg, select, slider, button, modal, confirmDialog, toast, gl } from './ui.js';
import { openIconPicker, bindDrop } from './iconpicker.js';

const ACCENTS = ['#6366F1', '#0EA5E9', '#14B8A6', '#22C55E', '#EAB308', '#F97316', '#EF4444', '#EC4899', '#A855F7', '#64748B'];
const SAMPLE = [
  { glyph: 'folder', gradient: 'ambar' },
  { glyph: 'globe', gradient: 'oceano' },
  { glyph: 'music', gradient: 'rosa' },
  { glyph: 'gamepad-2', gradient: 'uva' },
];

function tile(glyph, gradient, style, size) {
  return tileSVG({ glyph, colors: gradientColors(gradient), style: style || ap().tileStyle, shape: ap().tileShape, size });
}

function hk(name) {
  const v = P.config.hotkeys[name];
  return v ? v.replace(/Control/g, 'Ctrl').replace(/Space/g, 'Espacio').replace(/Shift/g, 'Mayús').replace(/\+/g, ' + ') : 'Sin atajo';
}

// ---------- Inicio ----------
export function homePage() {
  const env = P.env;
  const c = P.config;
  const banners = [];
  if (env.updater?.status === 'ready')
    banners.push(h('div.banner', h('span', { html: gl('download') }), h('div.grow', { text: `La versión ${env.updater.version} está lista para instalar.` }), button('Reiniciar y actualizar', () => api.installUpdate(), { primary: true })));
  if (env.hotkeys && env.hotkeys.search === false)
    banners.push(h('div.banner.warn', h('span', { html: gl('triangle-alert') }), h('div.grow', { text: `El atajo del buscador (${hk('search')}) lo usa otro programa. Elige otro en Comportamiento.` }), button('Cambiar', () => P.navigate('/comportamiento'))));
  if (env.hotkeys?.searchFallback)
    banners.push(h('div.banner', h('span', { html: gl('info') }), h('div.grow', { text: `Alt + Espacio está ocupado por otro programa; el buscador usa ${env.hotkeys.searchFallback.replace('Control', 'Ctrl')}.` })));

  const q = (glyph, grad, title, text, route, fn) => {
    const el = h('div.qcard', { html: `<span class="qi">${tile(glyph, grad, 'fluent')}</span><b>${esc(title)}</b><span>${esc(text)}</span>` });
    el.addEventListener('click', fn || (() => P.navigate(route)));
    return el;
  };
  const ws = activeWs();
  return page(
    '',
    '',
    ...banners,
    h('div.hero', h('img', { src: 'lanz://asset/icon.png', alt: '', onerror: (e) => (e.target.style.display = 'none') }),
      h('div', h('h2', { text: saludo() }), h('p', { html: `Estás usando el espacio <b>${esc(ws?.name || '')}</b> con ${ws?.items.length || 0} elementos. Pasa el mouse por tu dock para agrandarlo.` }))),
    h('div.qgrid',
      q('layout-grid', 'aurora', 'Elementos', 'Agrega programas, carpetas, grupos y widgets.', '/elementos'),
      q('palette', 'atardecer', 'Iconos', 'Banco de 1.850 iconos, 7 estilos o sube los tuyos.', '/iconos'),
      q('move', 'oceano', 'Posición', 'Abajo, arriba o a los lados; modo compacto o mini.', '/posicion'),
      q('layers', 'violeta', 'Espacios', 'Un dock para cada actividad.', '/espacios'),
      q('wand-sparkles', 'menta', 'Ordenar escritorio', 'Acomoda archivos sueltos por tipo, con deshacer.', '/organizador'),
      q('search', 'indigo', 'Buscador', `Pulsa ${hk('search')} en cualquier momento.`, null, () => api.openSearch())
    ),
    ...section('Atajos útiles',
      card({ icon: 'keyboard', title: 'Teclado y mouse', col: true, control: h('div.keys', { html: [
        [hk('search'), 'Buscar apps, archivos, ajustes y hacer cuentas'],
        [hk('toggleDock'), 'Mostrar u ocultar el dock'],
        ['Ctrl + Alt + 1…9', 'Cambiar de espacio de trabajo'],
        ['Clic derecho', 'Menú con todas las opciones (sobre el dock o un icono)'],
        ['Arrastrar', 'Suelta archivos sobre el dock, un grupo, el estante o la papelera'],
        ['Ctrl + Mayús + clic', 'Abrir un programa como administrador'],
      ].map(([k, t]) => `<kbd>${esc(k)}</kbd><span>${esc(t)}</span>`).join('') }) })
    ),
    ...section('Rápido',
      card({ icon: 'move', title: 'Posición del dock', control: seg([['bottom', 'Abajo'], ['top', 'Arriba'], ['left', 'Izquierda'], ['right', 'Derecha']], c.position.edge, (v) => patch({ position: { edge: v } })) }),
      card({ icon: 'eye', title: 'Cuando no lo uso', control: seg([['normal', 'Visible'], ['compact', 'Compacto'], ['mini', 'Mini'], ['hidden', 'Oculto']], c.position.idle, (v) => patch({ position: { idle: v } })) }),
      card({ icon: 'sun-moon', title: 'Tema', control: seg([['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']], c.appearance.theme, (v) => patch({ appearance: { theme: v } })) }),
      card({ icon: env.dockHidden ? 'eye-off' : 'eye', title: env.dockHidden ? 'El dock está oculto' : 'El dock está visible', control: button(env.dockHidden ? 'Mostrar' : 'Ocultar', () => api.run('toggleDock')) })
    )
  );
}

function saludo() {
  const hr = new Date().getHours();
  return hr < 12 ? '¡Buenos días! ☀️' : hr < 19 ? '¡Buenas tardes! 👋' : '¡Buenas noches! 🌙';
}

// ---------- Apariencia ----------
export function appearancePage() {
  const a = ap();
  const set = (p) => patch({ appearance: p });
  const accent = h('div.swatches');
  const sys = h('div.swatch.sys' + (a.accent === 'system' ? '.on' : ''), { title: 'Color de Windows' });
  sys.addEventListener('click', () => set({ accent: 'system' }));
  accent.append(sys);
  for (const c of ACCENTS) {
    const s = h('div.swatch' + (a.accent === c ? '.on' : ''), { style: { background: c }, title: c });
    s.addEventListener('click', () => set({ accent: c }));
    accent.append(s);
  }
  const styles = h('div.picks');
  for (const st of TILE_STYLES) {
    const p = h('div.pick' + (a.tileStyle === st.id ? '.on' : ''), { html: `<div class="pv">${SAMPLE.slice(0, 3).map((s) => `<span>${tile(s.glyph, s.gradient, st.id)}</span>`).join('')}</div>${esc(st.name)}` });
    p.addEventListener('click', () => set({ tileStyle: st.id }));
    styles.append(p);
  }
  const mode = h('div.picks', { style: { gridTemplateColumns: '1fr 1fr' } });
  const ws = activeWs();
  const apps = ws.items.filter((i) => i.type === 'app').slice(0, 4);
  const demo = apps.length ? apps : [{ type: 'app', name: 'Programa', target: 'x' }];
  for (const [v, t, d] of [['original', 'Originales de Windows', 'Cada programa con su icono de siempre, en alta resolución.'], ['designed', 'Diseño Lanzadera', 'Todos los iconos con el mismo estilo, colores y forma.']]) {
    const p = h('div.pick' + (a.iconMode === v ? '.on' : ''), { html: `<div class="pv">${demo.map((x) => `<span>${iconHTML(x, { ...a, iconMode: v })}</span>`).join('')}</div><b>${t}</b><small>${d}</small>` });
    p.addEventListener('click', () => set({ iconMode: v }));
    mode.append(p);
  }
  return page(
    'Apariencia',
    'Colores, tamaño, efecto lupa y estilo de los iconos.',
    ...section('Tema',
      card({ icon: 'sun-moon', title: 'Modo de color', control: seg([['system', 'Como Windows'], ['light', 'Claro'], ['dark', 'Oscuro']], a.theme, (v) => set({ theme: v })) }),
      card({ icon: 'droplet', title: 'Color de acento', desc: 'Se usa en botones, indicadores y el estilo «Acento».', col: true, control: accent }),
      card({ icon: 'panel-bottom', title: 'Fondo de la barra', control: seg([['glass', 'Vidrio'], ['solid', 'Sólido'], ['accent', 'Acento'], ['clear', 'Sin fondo']], a.dockStyle, (v) => set({ dockStyle: v })) }),
      card({ icon: 'blend', title: 'Opacidad del fondo', control: slider({ min: 0.2, max: 1, step: 0.02, value: a.opacity, format: (v) => Math.round(v * 100) + ' %', onChange: (v) => set({ opacity: v }) }) })
    ),
    ...section('Tamaño y lupa',
      card({ icon: 'scaling', title: 'Tamaño de los iconos', control: slider({ min: 28, max: 96, value: a.iconSize, format: (v) => v + ' px', onChange: (v) => set({ iconSize: v }) }) }),
      card({ icon: 'zoom-in', title: 'Efecto lupa', desc: 'Cuánto crecen los iconos bajo el puntero.', control: slider({ min: 1, max: 2.4, step: 0.05, value: a.magnification, format: (v) => (v <= 1.01 ? 'Apagado' : '×' + v.toFixed(2)), onChange: (v) => set({ magnification: v }) }) }),
      card({ icon: 'move-horizontal', title: 'Alcance de la lupa', desc: 'Cuántos iconos vecinos también crecen.', control: slider({ min: 1.2, max: 5, step: 0.1, value: a.magnifyRange, format: (v) => v.toFixed(1), onChange: (v) => set({ magnifyRange: v }) }) }),
      card({ icon: 'tag', title: 'Nombres de los iconos', control: seg([['hover', 'Al pasar'], ['always', 'Siempre'], ['never', 'Nunca']], a.labels, (v) => set({ labels: v })) })
    ),
    ...section('Iconos',
      card({ icon: 'app-window', title: 'Iconos de los programas', col: true, control: mode }),
      card({ icon: 'palette', title: 'Estilo de los iconos de diseño', desc: 'Se aplica a carpetas, widgets, grupos y a los iconos del banco que no tengan un estilo propio.', col: true, control: styles }),
      card({ icon: 'shapes', title: 'Forma', control: seg([['squircle', 'Squircle'], ['rounded', 'Redondeada'], ['circle', 'Círculo']], a.tileShape, (v) => set({ tileShape: v })) }),
      card({ icon: 'image', title: 'Miniaturas de fotos y videos', desc: 'Muestra la imagen real en carpetas y estante.', control: toggle(a.thumbnails !== false, (v) => set({ thumbnails: v })) })
    ),
    ...section('Movimiento',
      card({ icon: 'sparkles', title: 'Animaciones', control: toggle(a.animations, (v) => set({ animations: v })) }),
      card({ icon: 'arrow-up-from-line', title: 'Rebote al abrir un programa', control: toggle(a.bounce, (v) => set({ bounce: v })) })
    )
  );
}

// ---------- Posición ----------
export function positionPage() {
  const pos = P.config.position;
  const set = (p) => patch({ position: p });
  const scr = h('div.screen-pick');
  for (const [e, label] of [['bottom', 'Abajo'], ['top', 'Arriba'], ['left', 'Izquierda'], ['right', 'Derecha']]) {
    const el = h(`div.edge.e-${e}` + (pos.edge === e ? '.on' : ''), { title: label, html: '<i></i><i></i><i></i>' });
    el.addEventListener('click', () => set({ edge: e }));
    scr.append(el);
  }
  const displays = [['primary', 'Pantalla principal'], ['all', 'Todas las pantallas'], ...P.env.displays.map((d) => [d.id, `${d.label} (${d.size})${d.primary ? ' · principal' : ''}`])];
  const modes = h('div.picks');
  for (const [v, t, d] of [
    ['normal', 'Siempre visible', 'La barra completa, siempre a la vista.'],
    ['compact', 'Compacta', 'Pequeña en reposo; crece al pasar el mouse.'],
    ['mini', 'Mini', 'Solo una línea de color; se abre al tocarla.'],
    ['hidden', 'Ocultar', 'Desaparece; vuelve al llevar el mouse al borde.'],
  ]) {
    const p = h('div.pick' + (pos.idle === v ? '.on' : ''), { html: `<b>${t}</b><small>${d}</small>` });
    p.addEventListener('click', () => set({ idle: v }));
    modes.append(p);
  }
  return page(
    'Posición',
    'Elige en qué borde vive tu dock y cómo se comporta cuando no lo usas.',
    h('div.card', { style: { padding: '28px 24px 40px', gap: '40px', flexWrap: 'wrap', justifyContent: 'center' } },
      scr,
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px', minWidth: '260px' } },
        h('div', h('div.ctitle', { text: 'Borde', style: { marginBottom: '6px' } }), seg([['bottom', 'Abajo'], ['top', 'Arriba'], ['left', 'Izq.'], ['right', 'Der.']], pos.edge, (v) => set({ edge: v }))),
        h('div', h('div.ctitle', { text: 'Alineación', style: { marginBottom: '6px' } }), seg([['start', 'Inicio'], ['center', 'Centro'], ['end', 'Final']], pos.align, (v) => set({ align: v }))),
        h('div.muted', { text: 'Haz clic en un borde de la pantalla dibujada.' })
      )
    ),
    ...section('Cuando no lo uso', card({ icon: 'eye', title: 'Modo de reposo', col: true, control: modes })),
    ...section('Ajuste fino',
      card({ icon: 'monitor', title: 'Pantalla', desc: 'Con varios monitores puedes tener un dock en cada uno.', control: select(displays, pos.display, (v) => set({ display: v })) }),
      card({ icon: 'panel-bottom', title: 'Encima de la barra de tareas de Windows', desc: 'Usa todo el borde de la pantalla (tapa la barra de tareas si está en el mismo borde).', control: toggle(pos.overTaskbar, (v) => set({ overTaskbar: v })) }),
      card({ icon: 'move-vertical', title: 'Separación del borde', control: slider({ min: 0, max: 60, value: pos.margin, format: (v) => v + ' px', onChange: (v) => set({ margin: v }) }) }),
      card({ icon: 'timer', title: 'Retardo para mostrar', desc: 'En modos Mini y Ocultar.', control: slider({ min: 0, max: 1000, step: 20, value: pos.showDelay, format: (v) => v + ' ms', onChange: (v) => set({ showDelay: v }) }) }),
      card({ icon: 'timer-off', title: 'Retardo para ocultar', control: slider({ min: 100, max: 2500, step: 50, value: pos.hideDelay, format: (v) => v + ' ms', onChange: (v) => set({ hideDelay: v }) }) })
    )
  );
}

// ---------- Comportamiento ----------
function hotkeyInput(name) {
  const b = h('button.btn.hk', { text: hk(name) });
  let rec = false;
  const onKey = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return stop();
    if (e.key === 'Backspace' || e.key === 'Delete') {
      patch({ hotkeys: { [name]: '' } });
      return stop();
    }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
    if (!mods.length) return toast('Usa al menos Ctrl, Alt o Mayús', true);
    let key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
    patch({ hotkeys: { [name]: [...mods, key].join('+') } });
    stop();
  };
  const stop = () => {
    rec = false;
    b.classList.remove('rec');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => P.rerender(), 50);
  };
  b.addEventListener('click', () => {
    if (rec) return stop();
    rec = true;
    b.classList.add('rec');
    b.textContent = 'Pulsa la combinación… (Esc cancela, Supr borra)';
    document.addEventListener('keydown', onKey, true);
  });
  return b;
}

export function behaviorPage() {
  const b = P.config.behavior;
  const hkSt = P.env.hotkeys || {};
  const warn = (n) => (hkSt[n] === false ? ' <span style="color:var(--danger)">· No se pudo activar: otro programa lo usa</span>' : '');
  const set = (p) => patch({ behavior: p });
  return page(
    'Comportamiento',
    'Cómo se abren las cosas, atajos de teclado y el buscador.',
    ...section('Dock',
      card({ icon: 'mouse-pointer-click', title: 'Abrir grupos y carpetas', control: seg([['click', 'Al hacer clic'], ['hover', 'Al pasar el mouse']], b.openStacksOn, (v) => set({ openStacksOn: v })) }),
      card({ icon: 'lock', title: 'Bloquear elementos', desc: 'Evita mover o quitar iconos sin querer.', control: toggle(b.locked, (v) => set({ locked: v })) }),
      card({ icon: 'power', title: 'Iniciar con Windows', control: toggle(b.launchAtLogin, (v) => set({ launchAtLogin: v })) }),
      card({ icon: 'fullscreen', title: 'Esconder en pantalla completa', desc: 'Mientras ves un video o juegas, el dock de esa pantalla se esconde solo.', control: toggle(b.hideInFullscreen !== false, (v) => set({ hideInFullscreen: v })) }),
      card({ icon: 'sparkles', title: 'Sugerencias inteligentes', desc: 'Aprende qué programas usas a cada hora para el icono «Sugeridas» y el buscador.', control: toggle(b.suggestions, (v) => set({ suggestions: v })) })
    ),
    ...section('Atajos de teclado',
      card({ icon: 'search', title: 'Abrir el buscador', desc: 'Recomendado: Alt + Espacio.' + warn('search'), control: hotkeyInput('search') }),
      card({ icon: 'eye-off', title: 'Mostrar u ocultar el dock', desc: warn('toggleDock'), control: hotkeyInput('toggleDock') }),
      card({ icon: 'wand-sparkles', title: 'Ordenar el escritorio', desc: 'Opcional.' + warn('organize'), control: hotkeyInput('organize') }),
      card({ icon: 'layers', title: 'Cambiar de espacio con Ctrl + Alt + 1…9', control: toggle(P.config.hotkeys.workspaces, (v) => patch({ hotkeys: { workspaces: v } })) })
    ),
    ...section('Buscador',
      card({ icon: 'globe', title: 'Buscar en la web con', control: select([['google', 'Google'], ['bing', 'Bing'], ['duckduckgo', 'DuckDuckGo']], b.webSearch, (v) => set({ webSearch: v })) }),
      card({ icon: 'file-search', title: 'Incluir archivos', desc: 'Busca en Escritorio, Documentos, Descargas, Imágenes, Música y Videos.', control: toggle(b.fileSearch, (v) => set({ fileSearch: v })) })
    )
  );
}

// ---------- Widgets ----------
export function widgetsPage() {
  const c = P.config;
  return page(
    'Widgets',
    'Pequeñas herramientas que viven en tu dock. Agrégalas desde Elementos › Agregar › Widgets.',
    ...section('Portapapeles',
      card({ icon: 'clipboard-list', title: 'Guardar historial de lo que copias', desc: 'Respeta los gestores de contraseñas que piden no ser registrados.', control: toggle(c.clipboard.enabled, (v) => patch({ clipboard: { enabled: v } })) }),
      card({ icon: 'list-ordered', title: 'Cuántos recordar', control: slider({ min: 10, max: 200, step: 5, value: c.clipboard.max, onChange: (v) => patch({ clipboard: { max: v } }) }) }),
      card({ icon: 'save', title: 'Conservar al reiniciar', desc: 'Si está apagado, solo se guardan los elementos fijados.', control: toggle(c.clipboard.persist, (v) => patch({ clipboard: { persist: v } })) }),
      card({ icon: 'trash', title: 'Borrar historial', control: button('Borrar', () => api.clipClear().then(() => toast('Historial borrado'))) })
    ),
    ...section('Reloj',
      card({ icon: 'clock', title: 'Formato de 12 horas (a. m. / p. m.)', control: toggle(c.clock.hour12, (v) => patch({ clock: { hour12: v } })) })
    ),
    ...section('Notas rápidas',
      card({ icon: 'sticky-note', title: `${c.notes.filter((n) => n.text.trim()).length} notas guardadas`, desc: 'Se guardan en tu equipo y se incluyen en la copia de seguridad.', control: button('Borrar todas', async () => {
        if (await confirmDialog('¿Borrar todas las notas?', 'Esta acción no se puede deshacer.', 'Borrar', true)) patch({ notes: [] });
      }, { danger: true }) })
    )
  );
}

// ---------- Iconos ----------
let bankCat = 'destacados';
let bankQuery = '';
export function iconsPage(params) {
  const a = ap();
  const id = params.get('id');
  if (id) {
    setTimeout(() => {
      const f = findAnywhere(id);
      if (f) openIconPicker({ item: f.item, onApply: (icon) => updateAnywhere(id, (x) => (x.icon = icon)).then(() => toast('Icono actualizado')) });
    }, 60);
  }
  const uploads = h('div.uploads');
  for (const ic of P.config.customIcons) {
    const cell = h('div.upload', { title: ic.name, html: `<img src="${customUrl(ic.file)}" alt="">` });
    const del = button('', async () => {
      await api.deleteIcon(ic.file);
      toast('Imagen borrada');
    }, { icon: 'x', title: 'Borrar' });
    del.classList.add('del');
    cell.append(del);
    cell.addEventListener('click', () => applyToItem({ kind: 'custom', file: ic.file, fit: 'contain' }));
    uploads.append(cell);
  }
  const zone = h('div.dropzone', { html: `${gl('image-up')} Arrastra aquí tus imágenes (PNG, SVG, ICO, JPG, WEBP) ` });
  zone.append(button('Subir imágenes…', async () => {
    const added = await api.uploadIcons();
    if (added.length) toast(`${added.length} imágenes agregadas`);
  }, { icon: 'upload', primary: true, small: true }));
  bindDrop(zone, async (paths) => {
    const added = await api.importIcons(paths);
    toast(added.length ? `${added.length} imágenes agregadas` : 'Formato no compatible', !added.length);
  });

  const search = h('input', { type: 'search', placeholder: 'Buscar en el banco (en español): casa, música, juego, dinero…', style: { width: '100%' } });
  search.value = bankQuery;
  const chips = h('div.chips');
  const grid = h('div.glyphs', { style: { maxHeight: '420px' } });
  const draw = () => {
    const names = bankQuery ? searchIcons(bankQuery) : iconsInCategory(bankCat);
    grid.innerHTML = names.map((n) => `<div class="glyph" data-n="${n}" title="${n}">${glyphSVG(n)}</div>`).join('') || '<div class="muted" style="grid-column:1/-1;padding:12px">Sin resultados</div>';
  };
  for (const [k, label] of Object.entries(CATEGORY_NAMES)) {
    const c = h('button.chip' + (!bankQuery && bankCat === k ? '.on' : ''), { text: label });
    c.addEventListener('click', () => {
      bankCat = k;
      bankQuery = '';
      search.value = '';
      chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
      draw();
    });
    chips.append(c);
  }
  search.addEventListener('input', debounce(() => {
    bankQuery = search.value.trim();
    chips.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
    draw();
  }, 120));
  grid.addEventListener('click', (e) => {
    const g = e.target.closest('.glyph');
    if (g) applyToItem({ kind: 'designed', glyph: g.dataset.n, gradient: 'aurora' });
  });
  draw();

  const styles = h('div.picks');
  for (const st of TILE_STYLES) {
    const p = h('div.pick' + (a.tileStyle === st.id ? '.on' : ''), { html: `<div class="pv">${SAMPLE.slice(0, 3).map((s) => `<span>${tile(s.glyph, s.gradient, st.id)}</span>`).join('')}</div>${esc(st.name)}` });
    p.addEventListener('click', () => patch({ appearance: { tileStyle: st.id } }));
    styles.append(p);
  }

  return page(
    'Iconos',
    `Haz clic derecho en cualquier icono del dock › «Cambiar icono…», o elige uno aquí y dinos a qué elemento ponérselo.`,
    ...section('Estilo general',
      card({ icon: 'app-window', title: 'Iconos de los programas', control: seg([['original', 'Originales de Windows'], ['designed', 'Diseño Lanzadera']], a.iconMode, (v) => patch({ appearance: { iconMode: v } })) }),
      card({ icon: 'palette', title: 'Estilo de los mosaicos', col: true, control: styles })
    ),
    ...section('Banco de iconos', card({ icon: 'library', title: `${Object.keys(CATEGORY_NAMES).length - 1} categorías · Lucide ${LUCIDE_VERSION}`, desc: 'Haz clic en un icono para ponérselo a un elemento del dock.', col: true, control: h('div', search, chips, grid) })),
    ...section('Mis imágenes', card({ icon: 'image-up', title: `${P.config.customIcons.length} imágenes subidas`, desc: 'Haz clic en una para ponérsela a un elemento.', col: true, control: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, zone, uploads) })),
    ...section('Mantenimiento',
      card({ icon: 'refresh-cw', title: 'Volver a cargar los iconos de Windows', desc: 'Útil si actualizaste un programa y cambió su icono.', control: button('Actualizar', () => api.clearIconCache().then(() => toast('Iconos actualizados'))) })
    )
  );
}

function applyToItem(icon) {
  const ws = activeWs();
  const list = h('div.ilist', { style: { maxHeight: '420px', overflow: 'auto' } });
  const all = [];
  for (const it of ws.items) {
    if (it.type === 'separator') continue;
    all.push([it, null]);
    if (it.type === 'group') for (const k of it.items || []) all.push([k, it]);
  }
  let m;
  for (const [it, parent] of all) {
    const prev = { ...it, icon };
    const r = h('div.irow' + (parent ? '.child' : ''), {
      html: `<div class="iico">${iconHTML(it, ap())}</div><span style="opacity:.5">${gl('arrow-right')}</span><div class="iico">${iconHTML(prev, ap())}</div><div class="itext"><div class="iname">${esc(it.name || '')}</div></div>`,
    });
    r.addEventListener('click', async () => {
      await updateAnywhere(it.id, (x) => (x.icon = icon));
      toast(`Icono aplicado a «${it.name}»`);
      m.close();
    });
    list.append(r);
  }
  m = modal({
    title: '¿A qué elemento le pongo este icono?',
    body: h('div', h('p.muted', { text: `Espacio «${ws.name}». Luego puedes ajustar colores y estilo con clic derecho › Cambiar icono.` }), list),
    size: 'small',
    buttons: [button('Cancelar', () => m.close())],
  });
}

// ---------- Respaldo ----------
export function backupPage() {
  return page(
    'Copia de seguridad',
    'Guarda toda tu configuración (dock, espacios, iconos subidos y notas) en un archivo.',
    ...section('Copia',
      card({ icon: 'download', title: 'Exportar configuración', desc: 'Crea un archivo .json que puedes guardar o llevar a otro PC.', control: button('Exportar…', async () => {
        try {
          const r = await api.exportBackup();
          if (r.file) toast('Copia guardada');
        } catch (e) {
          toast(e.message, true);
        }
      }, { primary: true }) }),
      card({ icon: 'upload', title: 'Importar configuración', desc: 'Reemplaza tu configuración actual por la del archivo.', control: button('Importar…', async () => {
        try {
          const r = await api.importBackup();
          if (r.ok) toast('Configuración restaurada');
        } catch (e) {
          toast(e.message, true);
        }
      }) })
    ),
    ...section('Zona de cuidado',
      card({ icon: 'rotate-ccw', title: 'Restablecer todo', desc: 'Vuelve a la configuración inicial. Tus archivos no se tocan.', control: button('Restablecer…', async () => {
        if (await confirmDialog('¿Restablecer Lanzadera?', 'Se borrarán tus espacios, iconos personalizados y ajustes. Te recomendamos exportar una copia antes.', 'Restablecer', true)) api.resetAll();
      }, { danger: true }) })
    )
  );
}

// ---------- Acerca de ----------
export function aboutPage() {
  const u = P.env.updater || {};
  const st = {
    dev: 'Las actualizaciones automáticas funcionan en la versión instalada.',
    idle: 'Buscando actualizaciones al iniciar…',
    checking: 'Buscando actualizaciones…',
    none: 'Tienes la última versión.',
    downloading: `Descargando la versión ${u.version || ''}… ${u.progress || 0} %`,
    ready: `La versión ${u.version} está lista para instalar.`,
    error: `No se pudo comprobar: ${u.error || ''}`,
  }[u.status || 'idle'];
  return page(
    'Acerca de',
    '',
    h('div.hero', h('img', { src: 'lanz://asset/icon.png', alt: '', onerror: (e) => (e.target.style.display = 'none') }), h('div', h('h2', { text: 'Lanzadera' }), h('p', { text: `Versión ${P.env.version} · Dock organizador para Windows 11` }))),
    ...section('Actualizaciones',
      card({ icon: 'refresh-cw', title: 'Estado', desc: esc(st), control: u.status === 'ready' ? button('Reiniciar y actualizar', () => api.installUpdate(), { primary: true }) : button('Buscar ahora', () => api.checkUpdate()) })
    ),
    ...section('Proyecto',
      card({ icon: 'git-branch', title: 'Código fuente y descargas', desc: 'github.com/fernandhinoquim-tech/lanzadera', onClick: () => api.run('openExternal', 'https://github.com/fernandhinoquim-tech/lanzadera') }),
      card({ icon: 'bug', title: 'Reportar un problema o pedir una función', onClick: () => api.run('openExternal', 'https://github.com/fernandhinoquim-tech/lanzadera/issues') }),
      card({ icon: 'heart', title: 'Créditos', desc: `Iconos del banco: Lucide ${LUCIDE_VERSION} (licencia ISC). Hecho con Electron.` })
    )
  );
}
