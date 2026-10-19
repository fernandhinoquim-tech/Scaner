// Selector de iconos: banco de diseño, imágenes subidas, emoji, letras y original.
import { h, esc, debounce } from '../shared/dom.js';
import { GLYPHS } from '../shared/icon-bank.js';
import { GRADIENTS, TILE_STYLES, tileSVG, gradientColors, glyphSVG } from '../shared/tiles.js';
import { iconHTML, designFor, customUrl } from '../shared/icon-view.js';
import { CATEGORY_NAMES, iconsInCategory, searchIcons } from '../shared/icon-es.js';
import { P, api, ap } from './ctx.js';
import { modal, button, seg, toast, gl } from './ui.js';

const EMOJI = (
  '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😎 🤓 🧐 🤔 🤩 🥳 😴 🤯 🤠 👻 👽 🤖 💩 😺 ' +
  '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 ⭐ 🌟 ✨ ⚡ 🔥 💧 🌈 ☀️ 🌙 ☁️ ❄️ 🌊 🌸 🌻 🌵 🌴 🍀 🍁 🍄 ' +
  '🐶 🐱 🦊 🐻 🐼 🐨 🦁 🐯 🐸 🐵 🐧 🦄 🐝 🦋 🐢 🐙 🐬 🐳 ' +
  '🍎 🍊 🍋 🍉 🍇 🍓 🍒 🥑 🍕 🍔 🌮 🍣 🍩 🍪 🎂 🍿 ☕ 🍵 🍺 🍷 ' +
  '⚽ 🏀 🏈 ⚾ 🎾 🏐 🎮 🕹️ 🎲 🧩 🎯 🎳 🎸 🎹 🥁 🎤 🎧 🎬 🎨 📷 📸 🎥 📺 📻 ' +
  '💻 🖥️ ⌨️ 🖱️ 📱 ☎️ 🔋 💡 🔦 🧲 🔧 🔨 ⚙️ 🧰 🔒 🔑 🛡️ ' +
  '📁 📂 🗂️ 📄 📃 📑 📊 📈 📉 📝 ✏️ 🖊️ 📌 📎 ✂️ 📚 📖 📒 📓 🗓️ 📅 ⏰ ⌛ ' +
  '✉️ 📧 📨 💬 💭 📢 🔔 🏠 🏢 🏫 🏥 🏦 🏪 ⛪ 🚗 🚕 🚌 🚲 ✈️ 🚀 🛸 ⛵ 🗺️ 🧭 🌍 ' +
  '💰 💵 💳 🛒 🛍️ 🎁 🏆 🥇 🎉 🎈 👑 💎 ✅ ❌ ⚠️ ❓ 💯 🔴 🟠 🟡 🟢 🔵 🟣'
).split(' ');

function iconToSel(icon, item) {
  const i = icon || { kind: 'auto' };
  if (i.kind && i.kind !== 'auto') return { ...i };
  const d = designFor(item);
  return { kind: 'auto', glyph: d.glyph || 'sparkles', gradient: d.gradient || 'aurora', text: d.text };
}

function previewItem(item, sel) {
  return { ...item, icon: sel.kind === 'auto' ? { kind: 'auto' } : sel };
}

export function openIconPicker({ item, title, onApply }) {
  const sel = iconToSel(item.icon, item);
  let tab = sel.kind === 'custom' ? 'mios' : sel.kind === 'emoji' ? 'emoji' : sel.kind === 'text' ? 'letras' : sel.kind === 'original' || sel.kind === 'auto' ? (item.type === 'app' ? 'original' : 'banco') : 'banco';
  let cat = 'destacados';
  let query = '';

  const big = h('div.big');
  const darkDock = h('div.mini-dock.d');
  const lightDock = h('div.mini-dock.l');
  const left = h(
    'div.ipreview',
    big,
    h('div', { style: { textAlign: 'center', fontWeight: 600 }, text: item.name || 'Elemento' }),
    h('div.docks', darkDock, lightDock),
    h('div.muted', { style: { textAlign: 'center' }, text: 'Así se verá en el dock oscuro y claro.' })
  );
  const tabs = h('div.itabs');
  const body = h('div');
  const styleBox = h('div');
  const right = h('div', { style: { minWidth: 0 } }, tabs, body, styleBox);

  const neighbors = () => {
    const ws = P.config.workspaces.find((w) => w.id === P.config.activeWorkspace) || P.config.workspaces[0];
    return ws.items.filter((i) => i.type !== 'separator' && i.id !== item.id).slice(0, 4);
  };

  const refreshPreview = () => {
    const it = previewItem(item, sel);
    big.innerHTML = iconHTML(it, ap());
    const n = neighbors();
    const row = (dark) => [n[0], it, n[1], n[2]].filter(Boolean).map((x) => `<span class="${x === it ? '' : 'dim'}">${iconHTML(x, ap())}</span>`).join('');
    darkDock.innerHTML = row(true);
    lightDock.innerHTML = row(false);
  };

  const renderTabs = () => {
    tabs.innerHTML = '';
    const list = [
      ['banco', 'Banco de iconos', 'palette'],
      ['mios', 'Mis imágenes', 'image-up'],
      ['emoji', 'Emoji', 'face-slightly-smiling'],
      ['letras', 'Letras', 'type'],
    ];
    if (item.type === 'app' || item.type === 'file' || item.type === 'folder' || item.appId) list.push(['original', 'Original', 'app-window']);
    for (const [k, label, icon] of list) {
      const b = h('button' + (tab === k ? '.on' : ''), { html: `${gl(icon)} ${esc(label)}`, style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } });
      b.addEventListener('click', () => {
        tab = k;
        renderTabs();
        renderBody();
      });
      tabs.append(b);
    }
  };

  const renderStyle = () => {
    styleBox.innerHTML = '';
    const usesTile = ['designed', 'emoji', 'text', 'auto'].includes(sel.kind) || (sel.kind === 'custom' && sel.fit && sel.fit !== 'contain');
    if (!usesTile) return;
    const sample = { glyph: sel.glyph || 'sparkles', emoji: sel.kind === 'emoji' ? sel.emoji : undefined, text: sel.kind === 'text' ? sel.text : undefined };
    const colors = gradientColors(sel.gradient, sel.colors);

    const styles = h('div.styles-row');
    const opt = (id, name) => {
      const st = id || ap().tileStyle;
      const o = h('div.style-opt' + ((sel.style || '') === (id || '') ? '.on' : ''), {
        html: `<span>${tileSVG({ ...sample, colors, style: st, shape: ap().tileShape })}</span>${esc(name)}`,
      });
      o.addEventListener('click', () => {
        if (id) sel.style = id;
        else delete sel.style;
        if (sel.kind === 'auto') sel.kind = 'designed';
        refreshPreview();
        renderStyle();
      });
      styles.append(o);
    };
    opt('', 'Global');
    for (const s of TILE_STYLES) opt(s.id, s.name);

    const grads = h('div.swatches', { style: { marginTop: '6px' } });
    for (const g of GRADIENTS) {
      const sw = h('div.grad' + (!sel.colors && sel.gradient === g.id ? '.on' : ''), { title: g.name, style: { background: `linear-gradient(135deg, ${g.c[0]}, ${g.c[1]})` } });
      sw.addEventListener('click', () => {
        sel.gradient = g.id;
        delete sel.colors;
        if (sel.kind === 'auto') sel.kind = 'designed';
        refreshPreview();
        renderStyle();
      });
      grads.append(sw);
    }
    const c1 = h('input', { type: 'color', value: (sel.colors || colors)[0], title: 'Color 1' });
    const c2 = h('input', { type: 'color', value: (sel.colors || colors)[1], title: 'Color 2' });
    const onColor = () => {
      sel.colors = [c1.value, c2.value];
      if (sel.kind === 'auto') sel.kind = 'designed';
      refreshPreview();
    };
    c1.addEventListener('input', onColor);
    c2.addEventListener('input', onColor);
    for (const c of [c1, c2]) Object.assign(c.style, { width: '34px', height: '30px', padding: '0', border: 'none', background: 'transparent' });
    grads.append(h('span.muted', { style: { marginLeft: '8px', alignSelf: 'center' }, text: 'Personalizado' }), c1, c2);

    styleBox.append(h('div.section-title', { text: 'Estilo' }), styles, h('div.section-title', { text: 'Colores' }), grads);
  };

  const renderBody = () => {
    body.innerHTML = '';
    if (tab === 'banco') {
      const search = h('input', { type: 'search', placeholder: 'Buscar icono (en español o inglés): música, carpeta, juego…', style: { width: '100%' } });
      search.value = query;
      const chips = h('div.chips');
      const grid = h('div.glyphs');
      const drawGrid = () => {
        const names = query ? searchIcons(query) : iconsInCategory(cat);
        grid.innerHTML = names.length
          ? names.map((n) => `<div class="glyph${sel.kind === 'designed' && sel.glyph === n ? ' on' : ''}" data-n="${n}" title="${n}">${glyphSVG(n)}</div>`).join('')
          : `<div class="muted" style="grid-column:1/-1;padding:16px">No encontré iconos para «${esc(query)}». Prueba con otra palabra.</div>`;
      };
      for (const [k, label] of Object.entries(CATEGORY_NAMES)) {
        const c = h('button.chip' + (!query && cat === k ? '.on' : ''), { text: label });
        c.addEventListener('click', () => {
          cat = k;
          query = '';
          search.value = '';
          chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
          drawGrid();
        });
        chips.append(c);
      }
      search.addEventListener(
        'input',
        debounce(() => {
          query = search.value.trim();
          chips.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
          drawGrid();
        }, 120)
      );
      grid.addEventListener('click', (e) => {
        const g = e.target.closest('.glyph');
        if (!g) return;
        sel.kind = 'designed';
        sel.glyph = g.dataset.n;
        sel.gradient ||= 'aurora';
        grid.querySelectorAll('.glyph.on').forEach((x) => x.classList.remove('on'));
        g.classList.add('on');
        refreshPreview();
        renderStyle();
      });
      drawGrid();
      body.append(search, chips, grid);
      setTimeout(() => search.focus(), 50);
    } else if (tab === 'mios') {
      const grid = h('div.uploads');
      const fitBox = h('div', { style: { margin: '10px 0' } });
      const draw = () => {
        grid.innerHTML = '';
        for (const ic of P.config.customIcons) {
          const cell = h('div.upload' + (sel.kind === 'custom' && sel.file === ic.file ? '.on' : ''), { title: ic.name, html: `<img src="${customUrl(ic.file)}" alt="">` });
          const del = button('', async (e) => {
            e.stopPropagation();
            await api.deleteIcon(ic.file);
            setTimeout(draw, 120);
          }, { icon: 'x', title: 'Borrar' });
          del.classList.add('del');
          cell.append(del);
          cell.addEventListener('click', () => {
            sel.kind = 'custom';
            sel.file = ic.file;
            sel.fit ||= 'contain';
            draw();
            refreshPreview();
            renderStyle();
            drawFit();
          });
          grid.append(cell);
        }
        if (!P.config.customIcons.length) grid.append(h('div.muted', { style: { gridColumn: '1/-1' }, text: 'Aún no has subido imágenes.' }));
      };
      const drawFit = () => {
        fitBox.innerHTML = '';
        if (sel.kind !== 'custom') return;
        fitBox.append(
          seg(
            [
              ['contain', 'Tal cual', 'image'],
              ['tile', 'Sobre mosaico', 'square'],
              ['cover', 'Rellenar mosaico', 'maximize'],
            ],
            sel.fit || 'contain',
            (v) => {
              sel.fit = v;
              refreshPreview();
              renderStyle();
            }
          )
        );
      };
      const zone = h('div.dropzone', { html: `${gl('image-up')}<br>Arrastra aquí imágenes PNG, SVG, ICO, JPG o WEBP<br><span class="muted">o</span>` });
      zone.append(
        h('div', { style: { marginTop: '8px' } },
          button('Subir imágenes…', async () => {
            const added = await api.uploadIcons();
            if (added.length) {
              sel.kind = 'custom';
              sel.file = added[0].file;
              sel.fit ||= 'contain';
              setTimeout(() => {
                draw();
                drawFit();
                refreshPreview();
                renderStyle();
              }, 150);
            }
          }, { icon: 'upload', primary: true })
        )
      );
      bindDrop(zone, async (paths) => {
        const added = await api.importIcons(paths);
        if (added.length) {
          sel.kind = 'custom';
          sel.file = added[0].file;
          sel.fit ||= 'contain';
          setTimeout(() => {
            draw();
            drawFit();
            refreshPreview();
            renderStyle();
          }, 150);
        } else toast('Formato no compatible', true);
      });
      draw();
      drawFit();
      body.append(zone, fitBox, grid);
    } else if (tab === 'emoji') {
      const inp = h('input', { type: 'text', placeholder: 'Escribe o pega un emoji (Win + . abre el selector de Windows)', style: { width: '100%', fontSize: '18px' } });
      inp.value = sel.kind === 'emoji' ? sel.emoji : '';
      inp.addEventListener('input', () => {
        const v = [...inp.value.trim()].slice(0, 4).join('');
        if (!v) return;
        sel.kind = 'emoji';
        sel.emoji = v;
        sel.gradient ||= 'ambar';
        refreshPreview();
        renderStyle();
      });
      const grid = h('div.emojis', { style: { marginTop: '10px' } });
      for (const e of EMOJI) {
        const b = h('button', { text: e });
        b.addEventListener('click', () => {
          inp.value = e;
          sel.kind = 'emoji';
          sel.emoji = e;
          sel.gradient ||= 'ambar';
          refreshPreview();
          renderStyle();
        });
        grid.append(b);
      }
      body.append(inp, grid);
    } else if (tab === 'letras') {
      const inp = h('input', { type: 'text', maxlength: '3', placeholder: 'Hasta 3 letras o números, ej. «FC», «W», «24»', style: { width: '100%', fontSize: '18px' } });
      inp.value = sel.kind === 'text' ? sel.text : '';
      inp.addEventListener('input', () => {
        sel.kind = 'text';
        sel.text = inp.value.trim().slice(0, 3) || '?';
        sel.gradient ||= 'indigo';
        refreshPreview();
        renderStyle();
      });
      body.append(inp, h('p.muted', { text: 'Ideal para sitios web o programas sin un icono bonito.' }));
      setTimeout(() => inp.focus(), 50);
    } else if (tab === 'original') {
      const orig = h('div', { style: { width: '96px', height: '96px' }, html: iconHTML({ ...item, icon: { kind: 'original' } }, ap()) });
      body.append(
        h('div.row-flex', { style: { alignItems: 'center' } },
          orig,
          h('div', { style: { flex: 1 } },
            h('p', { style: { margin: '0 0 12px', color: 'var(--text-2)' }, text: 'Usa el icono que trae el programa en Windows (en alta resolución).' }),
            h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
              button('Usar el icono original', () => {
                sel.kind = 'original';
                refreshPreview();
                renderStyle();
              }, { icon: 'app-window', primary: sel.kind === 'original' }),
              button('Automático (según el estilo global)', () => {
                Object.assign(sel, iconToSel({ kind: 'auto' }, item));
                refreshPreview();
                renderStyle();
              }, { icon: 'sparkles' })
            )
          )
        )
      );
    }
  };

  const content = h('div.ipicker', left, right);
  const m = modal({
    title: title || 'Cambiar icono',
    size: 'wide',
    body: content,
    buttons: [
      button('Restablecer', () => {
        onApply({ kind: 'auto' });
        m.close();
      }, { icon: 'rotate-ccw', ghost: true }),
      button('Cancelar', () => m.close()),
      button('Aplicar', () => {
        const out = { ...sel };
        if (out.kind === 'auto') {
          onApply({ kind: 'auto' });
        } else {
          for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === '') delete out[k];
          onApply(out);
        }
        m.close();
      }, { primary: true, icon: 'check' }),
    ],
  });
  m.foot.firstChild.classList.add('left');
  renderTabs();
  renderBody();
  renderStyle();
  refreshPreview();
  return m;
}

// Soltar archivos sobre una zona (desde el Explorador).
export function bindDrop(zone, onPaths) {
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
    if (paths.length) onPaths(paths);
  });
}

// Selector pequeño de glifo + degradado (para espacios de trabajo).
export function openGlyphPicker({ glyph, gradient, onApply }) {
  const item = { type: 'action', name: 'Espacio', icon: { kind: 'designed', glyph, gradient } };
  return openIconPicker({
    item,
    title: 'Icono del espacio',
    onApply: (icon) => onApply({ glyph: icon.glyph || glyph, gradient: icon.gradient || gradient }),
  });
}

export { GLYPHS };
