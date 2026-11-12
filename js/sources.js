/* Источники контента: локальная папка (File API) и сервер в локальной сети. */
(function () {
  'use strict';
  var TV = window.TV;
  var U = TV.util;

  // Общая сборка библиотеки из плоского списка файлов.
  // entries: [{ path, size, mtime, url(), read() → Promise<ArrayBuffer> }]
  function build(entries, remote) {
    const subs = entries.filter(function (e) { return U.isSub(U.baseName(e.path)); });
    const videos = entries.filter(function (e) { return U.isVideo(U.baseName(e.path)); });
    videos.sort(function (a, b) { return U.compareNames(a.path, b.path); });
    return videos.map(function (v) {
      const name = U.baseName(v.path);
      return {
        // Ключ по имени и размеру: позиция общая для USB и сервера.
        id: name.toLowerCase() + '|' + v.size,
        path: v.path,
        name: name,
        title: U.prettyTitle(name),
        folder: U.dirName(v.path),
        size: v.size,
        remote: remote,
        url: v.url,
        search: U.normalize(U.prettyTitle(name) + ' ' + U.dirName(v.path)),
        subs: TV.subs.match(v.path, subs).map(function (s) {
          return {
            label: s.label,
            lang: s.lang,
            load: function () {
              return s.file.read().then(function (buf) {
                const text = U.decodeText(buf);
                return U.ext(s.file.path) === 'vtt' ? text.replace(/^\uFEFF/, '') : TV.subs.srtToVtt(text);
              });
            }
          };
        })
      };
    });
  }

  function fromFiles(fileList) {
    const files = Array.prototype.slice.call(fileList);
    let root = '';
    const entries = files.map(function (f) {
      const path = f.webkitRelativePath || f.name;
      if (!root && f.webkitRelativePath) root = path.split('/')[0];
      let url = null;
      return {
        path: path,
        size: f.size,
        url: function () { return url || (url = URL.createObjectURL(f)); },
        read: function () {
          if (f.arrayBuffer) return f.arrayBuffer();
          return new Promise(function (resolve, reject) {
            const r = new FileReader();
            r.onload = function () { resolve(r.result); };
            r.onerror = function () { reject(r.error); };
            r.readAsArrayBuffer(f);
          });
        }
      };
    });
    // Убираем общий корень «Папка/», чтобы в карточках были только подпапки.
    if (root && entries.every(function (e) { return e.path.indexOf(root + '/') === 0; })) {
      entries.forEach(function (e) { e.path = e.path.slice(root.length + 1); });
    }
    return {
      kind: 'local',
      label: root ? 'Папка «' + root + '»' : 'Локальные файлы',
      items: build(entries, false)
    };
  }

  function normalizeServerUrl(s) {
    s = String(s || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    return s.replace(/\/+$/, '');
  }

  function fetchWithTimeout(url, ms) {
    return new Promise(function (resolve, reject) {
      const t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      fetch(url, { cache: 'no-store' }).then(function (r) { clearTimeout(t); resolve(r); },
        function (e) { clearTimeout(t); reject(e); });
    });
  }

  function fromServer(base, timeoutMs) {
    base = normalizeServerUrl(base);
    return fetchWithTimeout(base + '/api/library', timeoutMs || 8000)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        const entries = (data.files || []).map(function (f) {
          const url = base + '/media/' + U.encodePath(f.path);
          return {
            path: f.path,
            size: f.size,
            url: function () { return url; },
            read: function () {
              return fetch(url).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.arrayBuffer();
              });
            }
          };
        });
        return {
          kind: 'server',
          base: base,
          label: 'Сервер ' + base.replace(/^https?:\/\//, '') + (data.name ? ' — ' + data.name : ''),
          items: build(entries, true)
        };
      });
  }

  TV.sources = { fromFiles: fromFiles, fromServer: fromServer, normalizeServerUrl: normalizeServerUrl };
})();
