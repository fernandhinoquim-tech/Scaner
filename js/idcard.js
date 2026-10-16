// Modo cédula: frente y reverso de una tarjeta de tamaño estándar (ID-1: 85,6 × 54 mm, como la
// cédula, la licencia o un carné) en una sola hoja carta, a tamaño real o ampliada.

const CARD_W = 85.6, CARD_H = 54, CARD_R = 3.18; // mm
const PAGE_W = 215.9, PAGE_H = 279.4;           // hoja carta en mm
export const ID_PAGE = [1855, 2400];             // px (≈ 218 ppp, igual que las demás páginas)

// ¿El recorte tiene forma de tarjeta? (proporción 1,59, con margen por la perspectiva)
export function looksLikeCard(w, h) {
  const r = Math.max(w, h) / Math.min(w, h);
  return r > 1.3 && r < 1.95;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// cards: canvas de cada cara ya recortada. scale: 1 = tamaño real, 1.5 = ampliada al 150 %.
export function composeIdPage(cards, scale = 1) {
  const [PW, PH] = ID_PAGE;
  const k = PH / PAGE_H; // px por mm
  const c = document.createElement('canvas');
  c.width = PW; c.height = PH;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, PW, PH);
  const boxes = cards.map(card => (card.width >= card.height
    ? [CARD_W * scale, CARD_H * scale] : [CARD_H * scale, CARD_W * scale]));
  const top = 22, gap = 14;
  const stackH = boxes.reduce((a, b) => a + b[1], 0) + gap * (boxes.length - 1);
  // Una debajo de otra; si no caben (tarjetas verticales ampliadas), una al lado de la otra.
  const stacked = top + stackH <= PAGE_H - 15;
  const rowW = boxes.reduce((a, b) => a + b[0], 0) + gap * (boxes.length - 1);
  let x = (PAGE_W - rowW) / 2, y = top;
  cards.forEach((card, i) => {
    const [w, h] = boxes[i];
    const bx = stacked ? (PAGE_W - w) / 2 : x, by = stacked ? y : top;
    ctx.save();
    roundRect(ctx, bx * k, by * k, w * k, h * k, CARD_R * scale * k);
    ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(card, bx * k, by * k, w * k, h * k);
    ctx.restore();
    // Borde suave, para que una tarjeta clara se distinga de la hoja.
    roundRect(ctx, bx * k, by * k, w * k, h * k, CARD_R * scale * k);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#c9ccd2';
    ctx.stroke();
    if (stacked) y += h + gap; else x += w + gap;
  });
  return c;
}
