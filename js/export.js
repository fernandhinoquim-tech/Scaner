// Exportación a PDF (con texto buscable opcional), imágenes (JPG/PNG/WEBP), ZIP, TXT y Word (.docx).
// PDF y ZIP se generan aquí mismo, sin librerías externas, para que funcione sin conexión.
import { ocrText } from './ocr.js';

const enc = new TextEncoder();

export const PAGE_SIZES = {
  auto: null,
  a4: [595.28, 841.89],
  carta: [612, 792],
  oficio: [612, 1008],
};

export const QUALITY = {
  alta: { maxSide: 2400, q: 0.9 },
  media: { maxSide: 1700, q: 0.75 },
  baja: { maxSide: 1200, q: 0.6 },
};

async function blobToCanvas(blob, maxSide) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  return c;
}

const canvasToBlob = (c, type, q) => new Promise((resolve, reject) =>
  c.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo codificar la imagen'))), type, q));

// Imagen de página en el formato y calidad pedidos. Devuelve {blob, width, height}.
export async function renderPage(page, type, quality) {
  const { maxSide, q } = QUALITY[quality] || QUALITY.alta;
  if (type === 'image/jpeg' && quality === 'alta') {
    return { blob: page.processed, width: page.width, height: page.height };
  }
  const c = await blobToCanvas(page.processed, maxSide);
  const blob = await canvasToBlob(c, type, q);
  if (type === 'image/webp' && blob.type !== 'image/webp') {
    throw new Error('Este navegador no puede crear WEBP');
  }
  return { blob, width: c.width, height: c.height };
}

// ---------- PDF ----------

// Capa de texto invisible (PDF buscable). Fuente estándar Courier con codificación WinAnsi: todas
// sus letras miden 0,6 em y cualquier lector de PDF la convierte a Unicode para buscar y copiar.
// Cada palabra se estira (Tz) para cubrir justo su lugar en la imagen; "3 Tr" la hace invisible.
const WIN_ANSI = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F,
};
const isLatin1 = (c) => (c >= 0x20 && c <= 0x7E) || (c >= 0xA0 && c <= 0xFF);

export function winAnsi(str) {
  const out = [];
  for (const ch of str.normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (isLatin1(c)) out.push(c);
    else if (WIN_ANSI[ch]) out.push(WIN_ANSI[ch]);
    else {
      // Letras fuera de WinAnsi: sin tilde si existe (ő → o); si no, "?".
      for (const b of ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')) {
        const d = b.codePointAt(0);
        out.push(isLatin1(d) ? d : 0x3F);
      }
    }
  }
  return out;
}

const hex = (bytes) => bytes.map(b => b.toString(16).padStart(2, '0')).join('');
const num = (x) => String(Math.round(x * 100) / 100);

// Operadores de la capa de texto para una página dibujada en (dx, dy, dw, dh) puntos.
export function textLayer(ocr, dx, dy, dw, dh) {
  const ops = ['BT', '3 Tr'];
  let size = -1;
  for (const para of ocr.paras) {
    for (const line of para.lines) {
      const fs = Math.max(1, line.rh * dh);
      const [bx0, by0, bx1, by1] = line.bl ||
        [line.box[0], line.box[3] - line.desc, line.box[2], line.box[3] - line.desc];
      const slope = bx1 > bx0 ? (by1 - by0) / (bx1 - bx0) : 0;
      const ang = Math.atan2(-(by1 - by0) * dh, (bx1 - bx0) * dw || 1);
      const cos = Math.cos(ang), sin = Math.sin(ang);
      if (fs !== size) { ops.push(`/F1 ${num(fs)} Tf`); size = fs; }
      line.words.forEach((wd, i) => {
        const last = i === line.words.length - 1;
        // El espacio final (salvo en la última palabra) llena el hueco hasta la siguiente,
        // así al copiar salen las palabras separadas y la selección es continua.
        const bytes = winAnsi(last ? wd.t : wd.t + ' ');
        if (!bytes.length) return;
        const end = last ? wd.b[2] : Math.max(line.words[i + 1].b[0], wd.b[2]);
        const width = Math.max(0.5, (end - wd.b[0]) * dw / Math.max(0.2, cos));
        const tz = 100 * width / (bytes.length * 0.6 * fs);
        const yBase = by0 + slope * (wd.b[0] - bx0);
        ops.push(`${num(tz)} Tz ${cos.toFixed(4)} ${sin.toFixed(4)} ${(-sin).toFixed(4)} ${cos.toFixed(4)} ` +
          `${num(dx + wd.b[0] * dw)} ${num(dy + (1 - yBase) * dh)} Tm <${hex(bytes)}> Tj`);
      });
    }
  }
  ops.push('ET');
  return ops.join('\n');
}

// Texto del PDF (título) en UTF-16 para admitir tildes y eñes.
function pdfString(s) {
  let h = 'FEFF';
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${h.toUpperCase()}>`;
}

// pages: con .processed (JPEG) y, si textLayer, .ocr (texto con posiciones).
export async function buildPdf(pages, { size = 'auto', quality = 'alta', title = '', textLayer: withText = false } = {}, onProgress) {
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    parts.push(bytes);
    length += bytes.length;
  };
  const obj = (n, body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    for (const b of [].concat(body)) push(b);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length;
  const pageObj = i => 5 + i * 3;
  const kids = pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  obj(3, `<< /Title ${pdfString(title)} /Producer (Scaner) >>`);
  obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');

  for (let i = 0; i < n; i++) {
    const { blob, width, height } = await renderPage(pages[i], 'image/jpeg', quality);
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    let pw, ph;
    const fixed = PAGE_SIZES[size];
    if (fixed) {
      [pw, ph] = width > height ? [fixed[1], fixed[0]] : fixed;
    } else {
      // Tamaño automático: la imagen a ~200 ppp, ajustada a un ancho tipo carta.
      const s = 612 / Math.min(width, height);
      pw = width * s; ph = height * s;
    }
    const scale = Math.min(pw / width, ph / height);
    const dw = width * scale, dh = height * scale;
    const dx = (pw - dw) / 2, dy = (ph - dh) / 2;
    let content = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${dx.toFixed(2)} ${dy.toFixed(2)} cm /Im0 Do Q`;
    const ocr = withText && pages[i].ocr;
    if (ocr && ocr.words) {
      // Si el texto se leyó con la página girada (rot), se dibuja en ese marco y se gira de vuelta.
      const k = ocr.rot || 0;
      const cm = [[1, 0, 0, 1, dx, dy], [0, 1, -1, 0, dx + dw, dy], [-1, 0, 0, -1, dx + dw, dy + dh], [0, -1, 1, 0, dx, dy + dh]][k];
      content += `\nq ${cm.map(num).join(' ')} cm\n` + textLayer(ocr, 0, 0, k % 2 ? dh : dw, k % 2 ? dw : dh) + '\nQ';
    }
    const p = pageObj(i);
    obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] ` +
      `/Resources << /XObject << /Im0 ${p + 2} 0 R >> /Font << /F1 4 0 R >> >> /Contents ${p + 1} 0 R >>`);
    obj(p + 1, [`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
    obj(p + 2, [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      jpeg, '\nendstream']);
    onProgress && onProgress((i + 1) / n);
  }

  const total = 5 + n * 3;
  const xref = length;
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) table += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(table);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

// ---------- ZIP (sin compresión: las imágenes ya están comprimidas) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export async function buildZip(files, type = 'application/zip') {
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const f of files) {
    const data = f.data instanceof Uint8Array ? f.data
      : typeof f.data === 'string' ? enc.encode(f.data)
      : new Uint8Array(await f.data.arrayBuffer());
    const name = enc.encode(f.name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, dosTime, true);
    cen.setUint16(14, dosDate, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cenSize = central.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type });
}

// ---------- Texto (TXT / Word) a partir del OCR guardado en cada página ----------

export function buildTxt(pages) {
  const texts = pages.map(p => ocrText(p.ocr));
  const body = texts.length > 1
    ? texts.map((t, i) => `--- Página ${i + 1} ---\n${t}`).join('\n\n')
    : texts[0] || '';
  return new Blob([body + '\n'], { type: 'text/plain;charset=utf-8' });
}

export function buildDocx(pages, title) {
  const x = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  const run = t => `<w:r><w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
  // Cada párrafo del OCR es un párrafo de Word; sus renglones se separan con saltos de línea.
  const para = lines => '<w:p><w:pPr><w:spacing w:after="160"/></w:pPr>' +
    lines.map(run).join('<w:r><w:br/></w:r>') + '</w:p>';
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const body = pages.map(p => {
    const paras = (p.ocr ? p.ocr.paras : []).map(pr => pr.lines.map(l => l.words.map(w => w.t).join(' ')));
    return paras.length ? paras.map(para).join('') : '<w:p/>';
  }).join(pageBreak);
  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/>' +
    '</w:sectPr></w:body></w:document>';
  return buildZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>' },
    { name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + x(title) + '</dc:title></cp:coreProperties>' },
    { name: 'word/document.xml', data: documentXml },
  ], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
