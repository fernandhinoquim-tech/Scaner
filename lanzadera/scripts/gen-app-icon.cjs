// Genera los PNG del logo a partir de assets/*.svg (requiere Playwright con Chromium).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const render = async (svgFile, size, out) => {
    const svg = fs.readFileSync(path.join(root, 'assets', svgFile), 'utf8');
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(root, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  };
  await render('icon.svg', 512, 'assets/icon.png');
  await render('icon.svg', 1024, 'build/icon.png');
  await render('tray.svg', 16, 'assets/tray.png');
  await render('tray.svg', 32, 'assets/tray@2x.png');
  await render('tray.svg', 48, 'assets/drag.png');
  await browser.close();
  console.log('Iconos generados');
})();
