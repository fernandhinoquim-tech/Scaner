// Protocolo interno lanz:// — sirve la interfaz, los iconos, miniaturas e iconos subidos.
const { protocol } = require('electron');
const fsp = require('fs').promises;
const path = require('path');
const { IMAGE_MIME } = require('./icons');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets');
const MIME = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  woff2: 'font/woff2',
  ...IMAGE_MIME,
};

function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'lanz', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
  ]);
}

function notFound() {
  return new Response('No encontrado', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

async function serveFile(file, cache = 'no-cache') {
  try {
    const data = await fsp.readFile(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    return new Response(data, { headers: { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': cache } });
  } catch {
    return notFound();
  }
}

function handleProtocol({ icons, customDir }) {
  protocol.handle('lanz', async (req) => {
    let url;
    try {
      url = new URL(req.url);
    } catch {
      return notFound();
    }
    switch (url.host) {
      case 'app': {
        const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        const file = path.normalize(path.join(RENDERER_DIR, rel));
        if (!file.startsWith(RENDERER_DIR + path.sep)) return notFound();
        return serveFile(file);
      }
      case 'icon': {
        const file = await icons.get({ app: url.searchParams.get('app'), src: url.searchParams.get('src') });
        return file ? serveFile(file, 'max-age=86400') : notFound();
      }
      case 'thumb': {
        const p = url.searchParams.get('p');
        const size = Math.max(32, Math.min(512, Number(url.searchParams.get('s')) || 256));
        const t = p ? await icons.thumbnail(p, size) : null;
        return t ? new Response(t.data, { headers: { 'content-type': t.mime, 'cache-control': 'max-age=600' } }) : notFound();
      }
      case 'asset': {
        return serveFile(path.join(ASSETS_DIR, path.basename(decodeURIComponent(url.pathname))), 'max-age=86400');
      }
      case 'custom': {
        const name = path.basename(decodeURIComponent(url.pathname));
        return serveFile(path.join(customDir, name), 'max-age=86400');
      }
      default:
        return notFound();
    }
  });
}

module.exports = { registerSchemes, handleProtocol };
