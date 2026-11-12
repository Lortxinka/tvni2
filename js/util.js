/* Общие утилиты. Синтаксис ES2015 без async/await — для старых ТВ-браузеров. */
(function () {
  'use strict';
  var TV = window.TV = window.TV || {};

  var VIDEO_EXT = ['mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'ts', 'm2ts', 'mts', 'ogv', 'mpg', 'mpeg', '3gp', 'wmv'];
  var SUB_EXT = ['srt', 'vtt'];

  function ext(name) {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(i + 1).toLowerCase() : '';
  }

  function stripExt(name) {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(0, i) : name;
  }

  function baseName(path) {
    const i = path.lastIndexOf('/');
    return i >= 0 ? path.slice(i + 1) : path;
  }

  function dirName(path) {
    const i = path.lastIndexOf('/');
    return i >= 0 ? path.slice(0, i) : '';
  }

  // «Movie.Name.2019.1080p» → «Movie Name 2019 1080p»
  function prettyTitle(fileName) {
    let t = stripExt(fileName);
    if (t.indexOf(' ') < 0) t = t.replace(/[._]+/g, ' ');
    else t = t.replace(/_+/g, ' ');
    return t.trim() || fileName;
  }

  // Нормализация для поиска: регистр, ё/е, разделители.
  function normalize(s) {
    return String(s || '')
      .toLocaleLowerCase('ru')
      .replace(/ё/g, 'е')
      .replace(/[._\-–—()[\]{},]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const ss = (s < 10 ? '0' : '') + s;
    if (h) return h + ':' + (m < 10 ? '0' : '') + m + ':' + ss;
    return m + ':' + ss;
  }

  function fmtSize(bytes) {
    if (!bytes) return '';
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return (i >= 2 ? bytes.toFixed(1) : Math.round(bytes)) + ' ' + units[i];
  }

  // Субтитры часто сохранены в windows-1251: пробуем UTF-8 строго, иначе cp1251.
  function decodeText(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    } catch (e) {
      try { return new TextDecoder('windows-1251').decode(bytes); }
      catch (e2) { return new TextDecoder('utf-8').decode(bytes); }
    }
  }

  function compareNames(a, b) {
    return a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' });
  }

  function encodePath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function debounce(fn, ms) {
    let t = 0;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  let toastTimer = 0;
  function toast(msg, opts) {
    opts = opts || {};
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast' + (opts.error ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast hidden'; }, opts.ms || 3500);
  }

  TV.util = {
    VIDEO_EXT: VIDEO_EXT,
    SUB_EXT: SUB_EXT,
    isVideo: function (name) { return VIDEO_EXT.indexOf(ext(name)) >= 0 && name.charAt(0) !== '.'; },
    isSub: function (name) { return SUB_EXT.indexOf(ext(name)) >= 0 && name.charAt(0) !== '.'; },
    ext: ext,
    stripExt: stripExt,
    baseName: baseName,
    dirName: dirName,
    prettyTitle: prettyTitle,
    normalize: normalize,
    fmtTime: fmtTime,
    fmtSize: fmtSize,
    decodeText: decodeText,
    compareNames: compareNames,
    encodePath: encodePath,
    el: el,
    debounce: debounce,
    toast: toast
  };
})();
