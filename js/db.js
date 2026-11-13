// Telefonda (tarayıcının IndexedDB'sinde) veri saklama katmanı.
const DB_NAME = 'kitapligim';
const DB_VERSION = 1;

let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('İşlem iptal edildi'));
  }));
}

const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  allBooks: () => tx('books', 'readonly', s => reqP(s.getAll())),
  putBook: book => tx('books', 'readwrite', s => { s.put(book); }),
  putBooks: books => tx('books', 'readwrite', s => { books.forEach(b => s.put(b)); }),
  deleteBook: id => tx('books', 'readwrite', s => { s.delete(id); }),
  clearBooks: () => tx('books', 'readwrite', s => { s.clear(); }),

  getCover: key => tx('covers', 'readonly', s => reqP(s.get(key))),
  putCover: (key, blob) => tx('covers', 'readwrite', s => { s.put(blob, key); }),
  deleteCover: key => tx('covers', 'readwrite', s => { s.delete(key); }),
  allCoverKeys: () => tx('covers', 'readonly', s => reqP(s.getAllKeys())),
  clearCovers: () => tx('covers', 'readwrite', s => { s.clear(); }),

  getMeta: key => tx('meta', 'readonly', s => reqP(s.get(key))),
  putMeta: (key, val) => tx('meta', 'readwrite', s => { s.put(val, key); }),
};

// Safari'den verilerin silinmemesini iste (Ana ekrana eklenmiş uygulamada genelde verilir).
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* desteklenmiyor */ }
  return false;
}
