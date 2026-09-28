// Exportación a PDF, imágenes (JPG/PNG/WEBP), ZIP, texto (OCR) y Word (.docx).
// PDF y ZIP se generan aquí mismo, sin librerías externas, para que funcione sin conexión.

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

export async function buildPdf(pages, { size = 'auto', quality = 'alta', title = '' } = {}, onProgress) {
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
  const pageObj = i => 4 + i * 3;
  const kids = pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  const esc = s => s.replace(/[\\()]/g, m => '\\' + m).replace(/[^\x20-\x7E]/g, '');
  obj(3, `<< /Title (${esc(title)}) /Producer (Scaner) >>`);

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
    const content = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${dx.toFixed(2)} ${dy.toFixed(2)} cm /Im0 Do Q`;
    const p = pageObj(i);
    obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] ` +
      `/Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`);
    obj(p + 1, [`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
    obj(p + 2, [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      jpeg, '\nendstream']);
    onProgress && onProgress((i + 1) / n);
  }

  const total = 4 + n * 3;
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

// ---------- OCR (Tesseract.js, se descarga solo cuando se usa) ----------

let tesseractLoading;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tesseractLoading) {
    tesseractLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => { tesseractLoading = null; reject(new Error('Se necesita internet la primera vez para el reconocimiento de texto')); };
      document.head.appendChild(s);
    });
  }
  return tesseractLoading;
}

export async function ocrPages(pages, onProgress) {
  const Tesseract = await loadTesseract();
  let current = 0;
  const worker = await Tesseract.createWorker('spa+eng', 1, {
    logger: m => {
      if (m.status === 'recognizing text') onProgress && onProgress((current + m.progress) / pages.length, 'Leyendo texto');
      else onProgress && onProgress(current / pages.length, 'Preparando lector de texto');
    },
  });
  const texts = [];
  try {
    for (current = 0; current < pages.length; current++) {
      const { data } = await worker.recognize(pages[current].processed);
      texts.push(data.text.trim());
    }
  } finally {
    await worker.terminate();
  }
  return texts;
}

export function buildTxt(texts) {
  const body = texts.length > 1
    ? texts.map((t, i) => `--- Página ${i + 1} ---\n${t}`).join('\n\n')
    : texts[0] || '';
  return new Blob([body + '\n'], { type: 'text/plain;charset=utf-8' });
}

export function buildDocx(texts, title) {
  const x = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  const para = t => `<w:p><w:r><w:t xml:space="preserve">${x(t)}</w:t></w:r></w:p>`;
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const body = texts.map(t => t.split('\n').map(para).join('')).join(pageBreak);
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
