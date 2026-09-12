/* Liber.DB — minimal IndexedDB wrapper. Stores book blobs + metadata + reading progress. */
(function () {
  const DB_NAME = "liber-db";
  const DB_VERSION = 1;
  const STORE = "books";

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("addedAt", "addedAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(mode) {
    const db = await open();
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  async function addBook(book) {
    const store = await tx("readwrite");
    return new Promise((resolve, reject) => {
      const req = store.add(book);
      req.onsuccess = () => resolve(book);
      req.onerror = () => reject(req.error);
    });
  }

    async function updateBook(id, patch) {
    const db = await open();
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);

    return new Promise((resolve, reject) => {
      let result = null;

      transaction.oncomplete = () => {
        resolve(result);
      };

      transaction.onerror = () => {
        reject(
          transaction.error ||
          new Error("IndexedDB update failed")
        );
      };

      transaction.onabort = () => {
        reject(
          transaction.error ||
          new Error("IndexedDB update aborted")
        );
      };

      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const existing = getReq.result;

        if (!existing) {
          result = null;
          return;
        }

        const updated =
          Object.assign(existing, patch);

        result = updated;

        const putReq =
          store.put(updated);

        putReq.onerror = () => {
          reject(
            putReq.error ||
            new Error("IndexedDB put failed")
          );
        };
      };

      getReq.onerror = () => {
        reject(
          getReq.error ||
          new Error("IndexedDB get failed")
        );
      };
    });
    }

  async function getBook(id) {
    const store = await tx("readonly");
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllBooks() {
    const store = await tx("readonly");
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteBook(id) {
    const store = await tx("readwrite");
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  window.LiberDB = { addBook, updateBook, getBook, getAllBooks, deleteBook };
})();
