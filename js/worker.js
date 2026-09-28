// Worker: recorte con perspectiva + filtro + rotación, fuera del hilo principal.
import { warp, applyFilter, rotate } from './imgproc.js';

self.onmessage = (e) => {
  const { id, image, corners, filter, rotation, maxSide } = e.data;
  try {
    let out = warp(image, corners, maxSide);
    out = applyFilter(out, filter);
    out = rotate(out, rotation || 0);
    self.postMessage({ id, image: out }, [out.data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
