// Abre documentos PDF y convierte cada página en una imagen, para escanear, reordenar e insertar
// páginas entre ellas. Usa pdf.js (el lector de PDF de Firefox), que se descarga solo la primera
// vez que se importa un PDF (unos 2 MB) y después queda guardado.

const VERSION = '6.4.299';
const BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${VERSION}/`;

export class PdfImportError extends Error {}

let libPromise = null;

function loadPdfjs() {
  if (!libPromise) {
    libPromise = import(BASE + 'legacy/build/pdf.min.mjs')
      .then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = BASE + 'legacy/build/pdf.worker.min.mjs';
        return lib;
      })
      .catch((err) => {
        console.warn('PDF:', err);
        libPromise = null;
        throw new PdfImportError('No se pudo descargar el lector de PDF. Se necesita internet la primera vez.');
      });
  }
  return libPromise;
}

export const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');

// Recorre las páginas del PDF: onPage(canvas, número, total) por cada una, en orden.
// maxSide: lado mayor de la imagen de cada página (≈ 250-300 ppp en una hoja carta).
export async function renderPdf(file, maxSide, onPage) {
  const lib = await loadPdfjs();
  let pdf;
  try {
    pdf = await lib.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      cMapUrl: BASE + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: BASE + 'standard_fonts/',
      wasmUrl: BASE + 'wasm/',
      iccUrl: BASE + 'iccs/',
    }).promise;
  } catch (err) {
    console.warn('PDF:', err);
    if (err && err.name === 'PasswordException') throw new PdfImportError('Ese PDF tiene contraseña: quítasela y vuelve a intentarlo.');
    throw new PdfImportError('No se pudo abrir el PDF (puede estar dañado).');
  }
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(6, maxSide / Math.max(base.width, base.height)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      await page.render({ canvas, viewport }).promise;
      page.cleanup();
      await onPage(canvas, n, pdf.numPages);
    }
  } finally {
    pdf.destroy();
  }
}
