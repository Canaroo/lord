/*
 * Library — imported songs kept in the browser (IndexedDB), so they're one
 * click away next time instead of being re-imported.
 *
 * Two stores: "files" holds the MP3 bytes, "meta" holds title/size/dates so
 * the song list loads without reading every file. Keys match the leaderboard
 * keys from SaveData.registerSong, so scores and files line up.
 */
'use strict';
(function (root) {
  const DB_NAME = 'beatfrets';
  const DB_VERSION = 2; // 2: adds "cache" (rendered song-pack audio)
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('This browser cannot store songs.')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // Ask the browser not to clear our data under storage pressure (best effort).
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    return dbPromise;
  }

  function tx(stores, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let out;
      Promise.resolve(fn(t)).then((v) => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Storage aborted'));
    }));
  }

  const req2p = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const Library = {
    /** Save (or replace) a song's bytes. Throws if storage is full. */
    put(key, title, bytes) {
      return tx(['files', 'meta'], 'readwrite', async (t) => {
        const meta = t.objectStore('meta');
        const prev = await req2p(meta.get(key));
        t.objectStore('files').put(bytes, key);
        meta.put({
          key,
          title,
          size: bytes.byteLength,
          added: prev ? prev.added : new Date().toISOString(),
          played: new Date().toISOString(),
        });
      });
    },

    /** Rendered song-pack audio, so a song is synthesised once per device. */
    cacheGet(key) {
      return tx(['cache'], 'readonly', (t) => req2p(t.objectStore('cache').get(key))).then((v) => v || null).catch(() => null);
    },
    cachePut(key, value) {
      return tx(['cache'], 'readwrite', (t) => { t.objectStore('cache').put(value, key); }).catch(() => { /* storage full: just render next time */ });
    },

    /** @returns {Promise<ArrayBuffer|null>} */
    get(key) {
      return tx(['files'], 'readonly', (t) => req2p(t.objectStore('files').get(key))).then((b) => b || null);
    },

    has(key) {
      return tx(['meta'], 'readonly', (t) => req2p(t.objectStore('meta').get(key))).then((m) => !!m).catch(() => false);
    },

    /** Saved songs, most recently played first. */
    list() {
      return tx(['meta'], 'readonly', (t) => req2p(t.objectStore('meta').getAll()))
        .then((all) => (all || []).sort((a, b) => (b.played || '').localeCompare(a.played || '')))
        .catch(() => []);
    },

    touch(key) {
      return tx(['meta'], 'readwrite', async (t) => {
        const meta = t.objectStore('meta');
        const m = await req2p(meta.get(key));
        if (m) { m.played = new Date().toISOString(); meta.put(m); }
      }).catch(() => {});
    },

    remove(key) {
      return tx(['files', 'meta'], 'readwrite', (t) => {
        t.objectStore('files').delete(key);
        t.objectStore('meta').delete(key);
      });
    },
  };

  root.Library = Library;
})(window);
