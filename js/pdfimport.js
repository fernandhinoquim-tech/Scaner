// Abre documentos PDF y convierte cada página en una imagen, para escanear, reordenar e insertar
// páginas entre ellas. Usa pdf.js (el lector de PDF de Firefox), incluido en la app (carpeta vendor/,
// copia verificada del paquete oficial). Se descarga del mismo sitio de la app la primera vez que se
// importa un PDF (unos 2 MB) y después queda guardado.

const BASE = new URL('../vendor/pdfjs-6.4.299/', import.meta.url).href;

export class PdfImportError extends Error {}

let libPromise = null;

function loadPdfjs() {
  if (!libPromise) {
    libPromise = import(BASE + 'pdf.min.js')
      .then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.js';
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
// askPassword(incorrecta): si el PDF tiene contraseña, la pide (null = no abrirlo).
// onOpen(páginas): se llama al abrirlo; si devuelve false, no se importa nada.
export async function renderPdf(file, maxSide, onPage, askPassword, onOpen) {
  const lib = await loadPdfjs();
  let pdf, task, gaveUp = false;
  try {
    task = lib.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      cMapUrl: BASE + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: BASE + 'standard_fonts/',
      wasmUrl: BASE + 'wasm/',
      iccUrl: BASE + 'iccs/',
      // Defensa ante PDF maliciosos: sin formularios XFA (los scripts de los PDF nunca se ejecutan:
      // la app no carga el motor de scripts) y sin imágenes gigantes que agoten la memoria.
      enableXfa: false,
      maxImageSize: 50e6,
    });
    task.onPassword = async (update, reason) => {
      const pw = askPassword ? await askPassword(reason === lib.PasswordResponses.INCORRECT_PASSWORD) : null;
      if (pw == null) { gaveUp = true; task.destroy(); } else update(pw);
    };
    pdf = await task.promise;
  } catch (err) {
    if (gaveUp) throw new PdfImportError('No se abrió el PDF (tiene contraseña).');
    console.warn('PDF:', err);
    if (err && err.name === 'PasswordException') throw new PdfImportError('Ese PDF tiene contraseña: quítasela y vuelve a intentarlo.');
    throw new PdfImportError('No se pudo abrir el PDF (puede estar dañado).');
  }
  try {
    if (onOpen && !(await onOpen(pdf.numPages))) return;
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
    task.destroy(); // libera la memoria del documento y su proceso
  }
}
