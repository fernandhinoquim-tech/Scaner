// Páginas: Organizador de escritorio y Bienvenida.
import { h, esc, formatSize, timeAgo } from '../shared/dom.js';
import { tileSVG, gradientColors, TILE_STYLES } from '../shared/tiles.js';
import { iconHTML } from '../shared/icon-view.js';
import { P, api, ap, patch, activeWs } from './ctx.js';
import { page, section, card, toggle, seg, button, toast, confirmDialog, gl } from './ui.js';

const CAT_DESIGN = {
  Imágenes: ['image', 'atardecer'],
  PDF: ['file-text', 'cereza'],
  Documentos: ['file-text', 'indigo'],
  'Hojas de cálculo': ['file-spreadsheet', 'esmeralda'],
  Presentaciones: ['presentation', 'naranja'],
  Videos: ['clapperboard', 'uva'],
  Música: ['music', 'rosa'],
  Comprimidos: ['file-archive', 'ambar'],
  Instaladores: ['package', 'oceano'],
  Código: ['file-code', 'aurora'],
  Diseño: ['pen-tool', 'violeta'],
  Fuentes: ['type', 'grafito'],
  Libros: ['book-open', 'ambar'],
  'Accesos directos': ['link', 'cielo'],
  Carpetas: ['folder', 'ambar'],
  Otros: ['file', 'grafito'],
};

let orgState = { folderKey: 'desktop', custom: '', plan: null, excluded: new Set(), result: null, busy: false };

function folderPath() {
  const p = P.env.paths;
  return { desktop: p.desktop, downloads: p.downloads, documents: p.documents, custom: orgState.custom }[orgState.folderKey];
}

export function organizerPage() {
  const o = P.config.organizer;
  const set = (p) => patch({ organizer: p });
  const wrap = h('div');

  const folderSeg = seg(
    [
      ['desktop', 'Escritorio', 'monitor'],
      ['downloads', 'Descargas', 'download'],
      ['documents', 'Documentos', 'folder-open'],
      ['custom', orgState.custom ? orgState.custom.split(/[\\/]/).pop() : 'Otra carpeta…', 'folder-search'],
    ],
    orgState.folderKey,
    async (v) => {
      if (v === 'custom') {
        const [p] = await api.pick({ kind: 'folder', title: 'Carpeta a ordenar' });
        if (!p) return P.rerender();
        orgState.custom = p;
      }
      orgState.folderKey = v;
      orgState.plan = null;
      orgState.result = null;
      P.rerender();
    }
  );

  const rules = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
  const drawRules = () => {
    rules.innerHTML = '';
    (o.rules || []).forEach((r, i) => {
      const name = h('input', { type: 'text', placeholder: 'Carpeta, ej. Planos', style: { width: '180px' } });
      name.value = r.name;
      const exts = h('input', { type: 'text', placeholder: 'Extensiones, ej. dwg, dxf', style: { flex: 1 } });
      exts.value = r.exts;
      const save = () => {
        const list = JSON.parse(JSON.stringify(o.rules));
        list[i] = { name: name.value, exts: exts.value };
        set({ rules: list });
      };
      name.addEventListener('change', save);
      exts.addEventListener('change', save);
      rules.append(h('div', { style: { display: 'flex', gap: '8px' } }, name, exts, button('', () => set({ rules: o.rules.filter((_, j) => j !== i) }), { icon: 'x', title: 'Quitar regla' })));
    });
    rules.append(h('div', button('Agregar regla', () => set({ rules: [...(o.rules || []), { name: '', exts: '' }] }), { icon: 'plus', small: true })));
  };
  drawRules();

  const analyze = async () => {
    orgState.busy = true;
    orgState.result = null;
    P.rerender();
    try {
      orgState.plan = await api.orgPlan(folderPath(), {});
      orgState.excluded = new Set();
    } catch (e) {
      toast(e.message, true);
    }
    orgState.busy = false;
    P.rerender();
  };

  const apply = async () => {
    const n = orgState.plan.moves.length - orgState.excluded.size;
    if (!n) return;
    orgState.busy = true;
    P.rerender();
    try {
      const r = await api.orgApply(orgState.plan.id, [...orgState.excluded]);
      orgState.result = { ...r, base: orgState.plan.base };
      orgState.plan = null;
    } catch (e) {
      toast(e.message, true);
    }
    orgState.busy = false;
    P.rerender();
  };

  // Resultado del análisis
  const preview = h('div');
  if (orgState.result) {
    const r = orgState.result;
    preview.append(
      h('div.result-card',
        h('div', { style: { width: '48px', height: '48px' }, html: tileSVG({ glyph: 'circle-check', colors: gradientColors('esmeralda'), style: 'fluent', shape: ap().tileShape }) }),
        h('div', { style: { flex: 1 } }, h('h3', { text: `¡Listo! ${r.moved} archivos ordenados` }), h('p', { text: r.failed.length ? `${r.failed.length} no se pudieron mover (quizá estaban abiertos): ${r.failed.slice(0, 3).map((f) => f.name).join(', ')}` : 'Todo quedó en su carpeta.' })),
        button('Abrir carpeta', () => api.launch({ type: 'folder', target: r.base }), { icon: 'folder-open' }),
        button('Deshacer', async () => {
          const u = await api.orgUndo(r.id);
          toast(`${u.restored} archivos regresaron a su lugar`);
          orgState.result = null;
          P.rerender();
        }, { icon: 'undo-2' })
      )
    );
  } else if (orgState.plan) {
    const plan = orgState.plan;
    const groups = {};
    plan.moves.forEach((m, i) => (groups[m.category] ||= []).push([m, i]));
    const n = plan.moves.length - orgState.excluded.size;
    if (!plan.moves.length) {
      preview.append(h('div.result-card', h('div', h('h3', { text: '¡Esta carpeta ya está ordenada! ✨' }), h('p', { text: 'No hay archivos sueltos para acomodar.' }))));
    } else {
      preview.append(
        h('div.toolbar',
          h('div', { style: { fontWeight: 600 }, text: `${n} de ${plan.moves.length} archivos se moverán` }),
          h('div.grow'),
          button('Cancelar', () => {
            orgState.plan = null;
            P.rerender();
          }),
          button(`Ordenar ${n} archivos`, apply, { primary: true, icon: 'wand-sparkles' })
        )
      );
      const cats = h('div.org-cats');
      for (const [cat, list] of Object.entries(groups)) {
        const [glyph, grad] = CAT_DESIGN[cat] || ['folder', 'aurora'];
        const ul = h('ul');
        for (const [m, i] of list) {
          const cb = h('input', { type: 'checkbox' });
          cb.checked = !orgState.excluded.has(i);
          const li = h('li' + (cb.checked ? '' : '.off'), cb, h('span', { text: m.name, title: m.from }), h('small.muted', { text: m.isDir ? '' : formatSize(m.size) }));
          cb.addEventListener('change', () => {
            cb.checked ? orgState.excluded.delete(i) : orgState.excluded.add(i);
            li.classList.toggle('off', !cb.checked);
            preview.querySelector('.toolbar .btn.primary span').textContent = `Ordenar ${plan.moves.length - orgState.excluded.size} archivos`;
            preview.querySelector('.toolbar > div').textContent = `${plan.moves.length - orgState.excluded.size} de ${plan.moves.length} archivos se moverán`;
          });
          ul.append(li);
        }
        cats.append(h('div.org-cat', h('header', h('i', { html: tileSVG({ glyph, colors: gradientColors(grad), style: 'fluent', shape: ap().tileShape }) }), h('span', { text: cat }), h('span.n', { text: String(list.length) })), ul));
      }
      preview.append(cats);
      if (plan.skipped.length) preview.append(h('p.muted', { text: `Se omitieron ${plan.skipped.length} archivos modificados hace menos de un minuto (pueden estar descargándose).` }));
    }
  }

  const history = h('div.cards');
  api.orgHistory().then((list) => {
    if (!list.length) return history.append(card({ icon: 'clock-fading', title: 'Aún no has ordenado ninguna carpeta' }));
    for (const e of list.slice(0, 8))
      history.append(
        card({
          icon: e.undone ? 'undo-2' : 'circle-check',
          title: `${e.count} archivos · ${e.folder.split(/[\\/]/).pop()}`,
          desc: `${timeAgo(e.date)}${e.undone ? ' · deshecho' : ''}`,
          control: e.undone ? null : button('Deshacer', async () => {
            if (!(await confirmDialog('¿Deshacer este orden?', `Los ${e.count} archivos volverán a «${e.folder}».`, 'Deshacer'))) return;
            try {
              const u = await api.orgUndo(e.id);
              toast(`${u.restored} archivos regresaron`);
              P.rerender();
            } catch (er) {
              toast(er.message, true);
            }
          }),
        })
      );
  });

  wrap.append(
    ...section('¿Qué carpeta ordeno?',
      card({ icon: 'folder', title: 'Carpeta', desc: esc(folderPath() || ''), control: folderSeg }),
      card({ icon: 'folder-tree', title: 'Dónde poner los archivos', control: seg([['container', `Dentro de «${o.containerName}»`], ['inplace', 'Carpetas aquí mismo']], o.mode, (v) => set({ mode: v })) }),
      o.mode === 'container' ? card({ icon: 'pencil', title: 'Nombre de la carpeta', control: (() => {
        const i = h('input', { type: 'text' });
        i.value = o.containerName;
        i.addEventListener('change', () => set({ containerName: i.value.trim() || 'Organizado' }));
        return i;
      })() }) : null,
      card({ icon: 'calendar-days', title: 'Separar también por mes', desc: 'Ej. Imágenes › 2026-10', control: toggle(o.byMonth, (v) => set({ byMonth: v })) }),
      card({ icon: 'link', title: 'Incluir accesos directos', desc: 'Los íconos de programas del escritorio normalmente se dejan donde están.', control: toggle(o.includeShortcuts, (v) => set({ includeShortcuts: v })) }),
      card({ icon: 'folders', title: 'Incluir carpetas sueltas', control: toggle(o.includeFolders, (v) => set({ includeFolders: v })) }),
      card({ icon: 'list-plus', title: 'Reglas personalizadas', desc: 'Manda ciertas extensiones a la carpeta que tú digas.', col: true, control: rules })
    ),
    h('div.toolbar', { style: { margin: '18px 0 12px' } },
      button(orgState.busy ? 'Trabajando…' : 'Analizar carpeta', analyze, { primary: !orgState.plan, icon: 'scan-search' }),
      h('span.muted', { text: 'Primero verás qué se moverá; nada se mueve sin tu confirmación.' })
    ),
    preview,
    ...section('Historial', history)
  );
  return page('Ordenar escritorio', 'Acomoda archivos sueltos en carpetas por tipo: Imágenes, PDF, Documentos, Música… Siempre puedes deshacer.', wrap);
}

// ---------- Bienvenida ----------
let step = 0;
export function welcomePage() {
  const c = P.config;
  const dots = () => h('div.steps-dots', [0, 1, 2, 3].map((i) => h('i' + (i === step ? '.on' : ''))));
  const go = (n) => {
    step = n;
    P.rerender();
  };
  const T = (glyph, grad) => tileSVG({ glyph, colors: gradientColors(grad), style: 'fluent', shape: 'squircle' });
  const box = h('div.welcome');

  if (step === 0) {
    const feats = [
      ['zoom-in', 'oceano', 'Efecto lupa', 'Los iconos crecen al pasar el mouse.'],
      ['layout-grid', 'aurora', 'Grupos', 'Un icono que abre muchos más, en abanico o cuadrícula.'],
      ['layers', 'violeta', 'Espacios', 'Un dock para Trabajo, otro para Ocio…'],
      ['search', 'indigo', 'Buscador', 'Alt + Espacio: apps, archivos, ajustes y cuentas.'],
      ['wand-sparkles', 'menta', 'Ordena tu escritorio', 'Archivos sueltos a carpetas, con deshacer.'],
      ['palette', 'atardecer', 'Iconos bonitos', '1.850 iconos de diseño, 7 estilos o los tuyos.'],
    ];
    box.append(
      h('img.wlogo', { src: 'lanz://asset/icon.png', alt: '', onerror: (e) => (e.target.outerHTML = `<div class="wlogo">${T('rocket', 'aurora')}</div>`) }),
      h('h1', { text: '¡Hola! Soy Lanzadera' }),
      h('p.lead', { text: 'Tu nuevo dock para Windows: una barra con tus programas, carpetas y archivos favoritos que crece cuando la tocas. Te ayudo a dejarla a tu gusto en tres pasos.' }),
      h('div.features', feats.map(([g, gr, t, d]) => h('div.feature', h('span.fi', { html: T(g, gr) }), h('div', h('b', { text: t }), h('span', { text: d }))))),
      h('div.actions', button('Empezar', () => go(1), { primary: true, icon: 'arrow-right' })),
      dots()
    );
  } else if (step === 1) {
    const edges = h('div.picks');
    for (const [e, t, d] of [['bottom', 'Abajo', 'Como en Mac, sobre la barra de tareas'], ['top', 'Arriba', 'Libre de la barra de tareas'], ['left', 'Izquierda', 'Vertical, ocupa poco'], ['right', 'Derecha', 'Vertical, del otro lado']]) {
      const p = h('div.pick' + (c.position.edge === e ? '.on' : ''), { html: `<b>${t}</b><small>${d}</small>` });
      p.addEventListener('click', () => patch({ position: { edge: e } }));
      edges.append(p);
    }
    const modes = h('div.picks', { style: { marginTop: '12px' } });
    for (const [v, t, d] of [['compact', 'Compacta', 'Pequeña; crece al pasar el mouse (recomendado)'], ['normal', 'Siempre visible', 'Tamaño completo todo el tiempo'], ['mini', 'Mini', 'Solo una línea de color'], ['hidden', 'Ocultar', 'Aparece al llevar el mouse al borde']]) {
      const p = h('div.pick' + (c.position.idle === v ? '.on' : ''), { html: `<b>${t}</b><small>${d}</small>` });
      p.addEventListener('click', () => patch({ position: { idle: v } }));
      modes.append(p);
    }
    box.append(
      h('h1', { text: '¿Dónde quieres tu dock?' }),
      h('p.lead', { text: 'Elige un borde: lo verás moverse al instante. Puedes cambiarlo cuando quieras con clic derecho sobre el dock.' }),
      edges,
      modes,
      h('div.actions', button('Atrás', () => go(0)), button('Siguiente', () => go(2), { primary: true, icon: 'arrow-right' })),
      dots()
    );
  } else if (step === 2) {
    const ws = activeWs();
    const apps = ws.items.filter((i) => i.type === 'app').slice(0, 4);
    const demo = apps.length ? apps : [{ type: 'app', name: 'Programa', target: 'x' }];
    const cmp = h('div.style-compare');
    for (const [v, t, d] of [['original', 'Originales de Windows', 'Cada programa con su icono de siempre.'], ['designed', 'Diseño Lanzadera', 'Todo con el mismo estilo y colores.']]) {
      const p = h('div.pick' + (c.appearance.iconMode === v ? '.on' : ''), { html: `<div class="pv">${demo.map((x) => `<span>${iconHTML(x, { ...c.appearance, iconMode: v })}</span>`).join('')}</div><b>${t}</b><small>${d}</small>` });
      p.addEventListener('click', () => patch({ appearance: { iconMode: v } }));
      cmp.append(p);
    }
    const styles = h('div.picks');
    for (const st of TILE_STYLES) {
      const p = h('div.pick' + (c.appearance.tileStyle === st.id ? '.on' : ''), { html: `<div class="pv">${[['folder', 'ambar'], ['music', 'rosa'], ['globe', 'oceano']].map(([g, gr]) => `<span>${tileSVG({ glyph: g, colors: gradientColors(gr), style: st.id, shape: c.appearance.tileShape })}</span>`).join('')}</div>${st.name}` });
      p.addEventListener('click', () => patch({ appearance: { tileStyle: st.id } }));
      styles.append(p);
    }
    box.append(
      h('h1', { text: 'Elige el estilo de tus iconos' }),
      h('p.lead', { text: 'Puedes cambiar cualquier icono después con clic derecho › Cambiar icono.' }),
      cmp,
      styles,
      h('div', { style: { marginTop: '16px' } }, seg([['system', 'Tema de Windows'], ['light', 'Claro'], ['dark', 'Oscuro']], c.appearance.theme, (v) => patch({ appearance: { theme: v } }))),
      h('div.actions', button('Atrás', () => go(1)), button('Siguiente', () => go(3), { primary: true, icon: 'arrow-right' })),
      dots()
    );
  } else {
    const tips = [
      ['search', 'indigo', 'Alt + Espacio', 'Abre el buscador desde cualquier lugar.'],
      ['mouse-pointer-2', 'oceano', 'Arrastra y suelta', 'Archivos o programas sobre el dock para fijarlos.'],
      ['mouse-pointer-click', 'violeta', 'Clic derecho', 'Sobre el dock o un icono: todas las opciones.'],
      ['layers', 'atardecer', 'Ctrl + Alt + 1, 2, 3', 'Cambia de espacio de trabajo.'],
      ['inbox', 'menta', 'Estante', 'Suelta archivos ahí para tenerlos a mano.'],
      ['wand-sparkles', 'aurora', 'Ordenar escritorio', 'Un clic y todo queda en su carpeta.'],
    ];
    box.append(
      h('h1', { text: '¡Todo listo! 🎉' }),
      h('p.lead', { text: 'Tu dock ya está funcionando. Algunos trucos para sacarle provecho:' }),
      h('div.features', tips.map(([g, gr, t, d]) => h('div.feature', h('span.fi', { html: T(g, gr) }), h('div', h('b', { text: t }), h('span', { text: d }))))),
      h('div.actions',
        button('Atrás', () => go(2)),
        button('Personalizar más', () => {
          patch({ firstRun: false });
          P.navigate('/inicio');
        }),
        button('Empezar a usar', () => {
          patch({ firstRun: false });
          api.closeWindow();
        }, { primary: true, icon: 'check' })
      ),
      dots()
    );
  }
  return box;
}
