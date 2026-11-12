/* Хранилище: позиции просмотра и настройки — localStorage,
   превью — IndexedDB (если недоступен, кэш только в памяти). */
(function () {
  'use strict';
  var TV = window.TV;
  const PREFIX = 'tvp:';
  const mem = {};

  function lsGet(key) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v ? JSON.parse(v) : null;
    } catch (e) { return mem[key] || null; }
  }

  function lsSet(key, val) {
    mem[key] = val;
    try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch (e) { /* квота / приватный режим */ }
  }

  function lsDel(key) {
    delete mem[key];
    try { localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
  }

  // ---- Позиции просмотра ----
  // Запись: { t: секунды, d: длительность, w: 1 если досмотрено, u: время сохранения }
  const positions = {
    get: function (id) { return lsGet('pos:' + id); },
    save: function (id, t, d) {
      if (!id || !isFinite(t)) return;
      const dur = isFinite(d) ? d : 0;
      // Досмотрено (последние 15 с или 97%): следующий запуск — с начала.
      if (dur && (t > dur - 15 || t / dur > 0.97)) {
        lsSet('pos:' + id, { t: 0, d: dur, w: 1, u: Date.now() });
      } else if (t < 5) {
        const prev = lsGet('pos:' + id);
        if (prev && prev.w) return;
        lsSet('pos:' + id, { t: 0, d: dur, u: Date.now() });
      } else {
        lsSet('pos:' + id, { t: Math.floor(t * 10) / 10, d: dur, u: Date.now() });
      }
    },
    clear: function (id) { lsDel('pos:' + id); }
  };

  // ---- Настройки ----
  const DEFAULTS = { volume: 1, subsOff: false, serverUrl: '' };
  const settings = {
    get: function (k) {
      const s = lsGet('settings') || {};
      return k in s ? s[k] : DEFAULTS[k];
    },
    set: function (k, v) {
      const s = lsGet('settings') || {};
      s[k] = v;
      lsSet('settings', s);
    }
  };

  // ---- Превью (IndexedDB) ----
  const thumbMem = {};
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      try {
        const req = indexedDB.open('tv-player', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('thumbs'); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return dbPromise;
  }

  const thumbs = {
    get: function (id) {
      if (thumbMem[id]) return Promise.resolve(thumbMem[id]);
      return openDb().then(function (db) {
        if (!db) return null;
        return new Promise(function (resolve) {
          try {
            const req = db.transaction('thumbs', 'readonly').objectStore('thumbs').get(id);
            req.onsuccess = function () { resolve(req.result || null); };
            req.onerror = function () { resolve(null); };
          } catch (e) { resolve(null); }
        });
      });
    },
    put: function (id, rec) {
      thumbMem[id] = rec;
      return openDb().then(function (db) {
        if (!db) return;
        try { db.transaction('thumbs', 'readwrite').objectStore('thumbs').put(rec, id); } catch (e) { /* ignore */ }
      });
    }
  };

  TV.store = { positions: positions, settings: settings, thumbs: thumbs };
})();
