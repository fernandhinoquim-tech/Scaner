// Almacenamiento local en IndexedDB: documentos y páginas (sin límite de escaneos), el texto
// leído de cada página (para buscar) y datos sueltos como las firmas guardadas.
import { ocrText } from './ocr.js';

const DB_NAME = 'scaner';
const DB_VERSION = 2;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (e.oldVersion < 1) {
          db.createObjectStore('docs', { keyPath: 'id' });
          const pages = db.createObjectStore('pages', { keyPath: 'id' });
          pages.createIndex('docId', 'docId');
        }
        if (e.oldVersion < 2) {
          const texts = db.createObjectStore('texts', { keyPath: 'id' });
          texts.createIndex('docId', 'docId');
          db.createObjectStore('meta', { keyPath: 'id' });
          // Índice de las páginas que ya se habían leído antes de esta versión.
          req.transaction.objectStore('pages').openCursor().onsuccess = (ev) => {
            const cur = ev.target.result;
            if (!cur) return;
            const p = cur.value;
            if (p.ocr) texts.put({ id: p.id, docId: p.docId, text: ocrText(p.ocr), key: p.ocr.key });
            cur.continue();
          };
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Si otra pestaña abre una versión más nueva, se cierra esta conexión para no bloquearla y
        // se avisa a la app (hay que recargarla para seguir guardando).
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
          window.dispatchEvent(new Event('scaner-db-closed'));
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => console.warn('IndexedDB: cierra las otras pestañas de Scaner para actualizar');
    });
  }
  return dbPromise;
}

async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const req2p = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function listDocs() {
  return tx(['docs'], 'readonly', t => req2p(t.objectStore('docs').getAll()))
    .then(docs => docs.sort((a, b) => b.updated - a.updated));
}

export function getDoc(id) {
  return tx(['docs'], 'readonly', t => req2p(t.objectStore('docs').get(id)));
}

export function putDoc(doc) {
  doc.updated = Date.now();
  return tx(['docs'], 'readwrite', t => { t.objectStore('docs').put(doc); });
}

// Lee, modifica y guarda un documento en una sola operación (sin pisar cambios hechos en medio).
// fn(doc) puede devolver false para no guardar. Devuelve el documento guardado o null.
export function updateDoc(id, fn) {
  return tx(['docs'], 'readwrite', t => new Promise((resolve) => {
    const store = t.objectStore('docs');
    store.get(id).onsuccess = (e) => {
      const doc = e.target.result;
      if (!doc || fn(doc) === false) return resolve(null);
      doc.updated = Date.now();
      store.put(doc);
      resolve(doc);
    };
  }));
}

export function getPage(id) {
  return tx(['pages'], 'readonly', t => req2p(t.objectStore('pages').get(id)));
}

export function putPage(page) {
  return tx(['pages'], 'readwrite', t => { t.objectStore('pages').put(page); });
}

// Como updateDoc, para una página.
export function updatePage(id, fn) {
  return tx(['pages'], 'readwrite', t => new Promise((resolve) => {
    const store = t.objectStore('pages');
    store.get(id).onsuccess = (e) => {
      const page = e.target.result;
      if (!page || fn(page) === false) return resolve(null);
      store.put(page);
      resolve(page);
    };
  }));
}

export function deletePage(id) {
  return tx(['pages', 'texts'], 'readwrite', t => {
    t.objectStore('pages').delete(id);
    t.objectStore('texts').delete(id);
  });
}

export async function getPages(doc) {
  const pages = await tx(['pages'], 'readonly', t =>
    req2p(t.objectStore('pages').index('docId').getAll(doc.id)));
  const byId = new Map(pages.map(p => [p.id, p]));
  return doc.pageIds.map(id => byId.get(id)).filter(Boolean);
}

export function deleteDoc(doc) {
  return tx(['docs', 'pages', 'texts'], 'readwrite', t => {
    t.objectStore('docs').delete(doc.id);
    for (const id of doc.pageIds) {
      t.objectStore('pages').delete(id);
      t.objectStore('texts').delete(id);
    }
  });
}

// Pasa páginas (objetos completos) de un documento a otro y guarda ambos documentos. Si el de
// origen queda sin páginas, se borra.
export function movePages(pages, from, to) {
  return tx(['docs', 'pages', 'texts'], 'readwrite', t => {
    const now = Date.now();
    const texts = t.objectStore('texts');
    for (const p of pages) {
      p.docId = to.id;
      t.objectStore('pages').put(p);
      texts.get(p.id).onsuccess = (e) => {
        const rec = e.target.result;
        if (rec) { rec.docId = to.id; texts.put(rec); }
      };
    }
    to.updated = now;
    t.objectStore('docs').put(to);
    if (from.pageIds.length) { from.updated = now; t.objectStore('docs').put(from); }
    else t.objectStore('docs').delete(from.id);
  });
}

// ---------- Texto leído de cada página (para buscar) ----------

export function putText(rec) {
  return tx(['texts'], 'readwrite', t => { t.objectStore('texts').put(rec); });
}

export function listTexts() {
  return tx(['texts'], 'readonly', t => req2p(t.objectStore('texts').getAll()));
}

// ---------- Datos sueltos (firmas guardadas) ----------

export function listMeta(prefix) {
  return tx(['meta'], 'readonly', t => req2p(t.objectStore('meta').getAll()))
    .then(all => all.filter(m => m.id.startsWith(prefix)).sort((a, b) => b.created - a.created));
}

export function putMeta(rec) {
  return tx(['meta'], 'readwrite', t => { t.objectStore('meta').put(rec); });
}

export function deleteMeta(id) {
  return tx(['meta'], 'readwrite', t => { t.objectStore('meta').delete(id); });
}

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* opcional */ }
}
