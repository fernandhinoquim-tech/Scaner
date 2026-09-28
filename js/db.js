// Almacenamiento local en IndexedDB: documentos y páginas (sin límite de escaneos).

const DB_NAME = 'scaner';
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('docs', { keyPath: 'id' });
        const pages = db.createObjectStore('pages', { keyPath: 'id' });
        pages.createIndex('docId', 'docId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
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

export function getPage(id) {
  return tx(['pages'], 'readonly', t => req2p(t.objectStore('pages').get(id)));
}

export function putPage(page) {
  return tx(['pages'], 'readwrite', t => { t.objectStore('pages').put(page); });
}

export function deletePage(id) {
  return tx(['pages'], 'readwrite', t => { t.objectStore('pages').delete(id); });
}

export async function getPages(doc) {
  const pages = await tx(['pages'], 'readonly', t =>
    req2p(t.objectStore('pages').index('docId').getAll(doc.id)));
  const byId = new Map(pages.map(p => [p.id, p]));
  return doc.pageIds.map(id => byId.get(id)).filter(Boolean);
}

export function deleteDoc(doc) {
  return tx(['docs', 'pages'], 'readwrite', t => {
    t.objectStore('docs').delete(doc.id);
    for (const id of doc.pageIds) t.objectStore('pages').delete(id);
  });
}

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* opcional */ }
}
