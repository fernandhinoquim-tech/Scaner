// Lanzadera — panel de configuración: navegación y estado.
import { h, esc, applyTheme } from '../shared/dom.js';
import { installIconFallbacks } from '../shared/icon-view.js';
import { glyphSVG } from '../shared/tiles.js';
import { P, api } from './ctx.js';
import { homePage, appearancePage, positionPage, behaviorPage, widgetsPage, iconsPage, backupPage, aboutPage } from './pages-main.js';
import { itemsPage, workspacesPage, openAddDialog } from './pages-items.js';
import { organizerPage, welcomePage } from './pages-org.js';

const ROUTES = {
  '/inicio': ['Inicio', 'house', homePage],
  '/elementos': ['Elementos del dock', 'layout-grid', itemsPage],
  '/apariencia': ['Apariencia', 'palette', appearancePage],
  '/posicion': ['Posición', 'move', positionPage],
  '/comportamiento': ['Comportamiento', 'mouse-pointer-click', behaviorPage],
  '/espacios': ['Espacios de trabajo', 'layers', workspacesPage],
  '/iconos': ['Iconos', 'shapes', iconsPage],
  '/organizador': ['Ordenar escritorio', 'wand-sparkles', organizerPage],
  '/widgets': ['Widgets', 'gauge', widgetsPage],
  '/respaldo': ['Copia de seguridad', 'archive', backupPage],
  '/acerca': ['Acerca de', 'info', aboutPage],
};
const NAV = ['/inicio', '/elementos', '/apariencia', '/posicion', '/comportamiento', '-', '/espacios', '/iconos', '/organizador', '/widgets', '-', '/respaldo', '/acerca'];

const nav = document.getElementById('nav');
const content = document.getElementById('content');
let path = '/inicio';
let params = new URLSearchParams();
let lastRendered = '';

installIconFallbacks(document);

function parseHash() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, '')) || '/inicio';
  const [p, q] = raw.split('?');
  return [p || '/inicio', new URLSearchParams(q || '')];
}

function navigate(route) {
  const r = route.startsWith('/') ? route : '/' + route;
  if (location.hash === '#' + r) onRoute();
  else location.hash = r;
}
P.navigate = navigate;

function renderNav() {
  nav.innerHTML = '';
  nav.append(
    h('div.nav-profile', h('img.logo', { src: 'lanz://asset/icon.png', alt: '', onerror: (e) => (e.target.style.visibility = 'hidden') }), h('div', h('b', { text: 'Lanzadera' }), h('span', { text: `Versión ${P.env.version}` })))
  );
  for (const r of NAV) {
    if (r === '-') {
      nav.append(h('div.nav-sep'));
      continue;
    }
    const [label, icon] = ROUTES[r];
    const a = h('a.nav-item' + (r === path ? '.active' : ''), { html: `${glyphSVG(icon)}<span>${esc(label)}</span>`, href: '#' + r });
    nav.append(a);
  }
}

function render(force = false) {
  const welcome = path === '/bienvenida';
  document.getElementById('app').classList.toggle('welcome-mode', welcome);
  nav.style.display = welcome ? 'none' : '';
  if (!welcome) renderNav();
  // Redibujar mientras se escribe borraría el texto: se espera a que termine.
  const active = document.activeElement;
  if (!force && active && content.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName) && active.type !== 'checkbox' && active.type !== 'range') return;
  const scroll = content.scrollTop;
  const fn = welcome ? welcomePage : ROUTES[path]?.[2] || homePage;
  let el;
  try {
    el = fn(params);
  } catch (e) {
    console.error(e);
    el = h('div.page', h('h1', { text: 'Ups' }), h('p', { text: e.message }));
  }
  content.innerHTML = '';
  content.append(el);
  if (lastRendered === path) content.scrollTop = scroll;
  else content.scrollTop = 0;
  lastRendered = path;
}

P.rerender = () => render(true);

function onRoute() {
  [path, params] = parseHash();
  if (path === '/agregar') {
    const ws = P.config.workspaces.find((w) => w.items.some((i) => i.id === params.get('grupo'))) || null;
    path = lastRendered && lastRendered !== '/agregar' ? lastRendered : '/elementos';
    render(true);
    openAddDialog({ ws, groupId: params.get('grupo'), tab: params.get('tipo') === 'url' ? 'web' : 'apps' });
    history.replaceState(null, '', '#' + path);
    return;
  }
  render(true);
}

window.addEventListener('hashchange', onRoute);

(async () => {
  P.state = await api.getState();
  applyTheme(P.state);
  if (P.env.win11) document.body.classList.add('mica');
  api.onState((s) => {
    P.state = s;
    applyTheme(s);
    if (!document.querySelector('.modal-back')) render(false);
  });
  api.onUpdate(() => {});
  api.onRoute((r) => navigate(r));
  onRoute();
})();

window.addEventListener('keydown', (e) => {
  if (e.key === 'F5') location.reload();
});
