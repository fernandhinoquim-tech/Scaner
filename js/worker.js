// Worker: recorte con perspectiva + filtro + rotación, fuera del hilo principal.
// También prepara la imagen para el OCR (gris aplanado a la máxima resolución disponible) y mide
// si una foto salió borrosa.
import { warp, applyFilter, rotate, prepareForOcr, OCR_MAX_SIDE, blurriness, SHARP_SIZE } from './imgproc.js';

self.onmessage = (e) => {
  const { id, type, image, corners, filter, rotation, maxSide } = e.data;
  try {
    if (type === 'sharp') {
      self.postMessage({ id, value: blurriness(warp(image, corners, SHARP_SIZE)) });
      return;
    }
    if (type === 'ocr') {
      const out = prepareForOcr(rotate(warp(image, corners, OCR_MAX_SIDE), rotation || 0));
      self.postMessage({ id, image: out }, [out.data.buffer]);
      return;
    }
    let out = warp(image, corners, maxSide);
    out = applyFilter(out, filter);
    out = rotate(out, rotation || 0);
    self.postMessage({ id, image: out }, [out.data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
