/* Субтитры: поиск файлов рядом с видео и конвертация SRT → WebVTT. */
(function () {
  'use strict';
  var TV = window.TV;
  var U = TV.util;

  const SUB_DIRS = ['', 'sub', 'subs', 'subtitles', 'субтитры'];

  // Подбор субтитров для видео: тот же каталог (или подпапка Subs/…),
  // имя совпадает или начинается с «<имя видео>.» — например «Фильм.ru.srt».
  function match(videoPath, subFiles) {
    const dir = U.dirName(videoPath).toLowerCase();
    const base = U.stripExt(U.baseName(videoPath)).toLowerCase();
    const found = [];
    subFiles.forEach(function (sub) {
      const sDir = U.dirName(sub.path).toLowerCase();
      const sBase = U.stripExt(U.baseName(sub.path));
      const sLow = sBase.toLowerCase();
      let rel = null;
      SUB_DIRS.forEach(function (d) {
        if (rel === null && sDir === (d ? (dir ? dir + '/' : '') + d : dir)) rel = d;
      });
      if (rel === null) return;
      let tag;
      if (sLow === base) tag = '';
      else if (sLow.indexOf(base + '.') === 0 || sLow.indexOf(base + '_') === 0) tag = sBase.slice(base.length + 1);
      else return;
      found.push({ file: sub, tag: tag, near: rel === '' });
    });
    found.sort(function (a, b) {
      if (a.near !== b.near) return a.near ? -1 : 1;
      return U.compareNames(a.tag, b.tag);
    });
    return found.map(function (f) {
      const lang = guessLang(f.tag);
      return {
        file: f.file,
        label: LANG_LABELS[lang] || f.tag || 'Основные',
        lang: lang
      };
    });
  }

  const LANG_LABELS = { ru: 'Русские', en: 'Английские', uk: 'Украинские', de: 'Немецкие', fr: 'Французские' };

  function guessLang(tag) {
    const t = tag.toLowerCase();
    if (/(^|[^a-z])(ru|rus|russian)([^a-z]|$)|рус/.test(t)) return 'ru';
    if (/(^|[^a-z])(en|eng|english)([^a-z]|$)|англ/.test(t)) return 'en';
    if (!t) return '';
    const m = t.match(/^[a-z]{2,3}$/);
    return m ? m[0] : '';
  }

  function srtToVtt(text) {
    text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (/^WEBVTT/.test(text)) return text;
    const out = ['WEBVTT', ''];
    text.split(/\n{2,}/).forEach(function (block) {
      const lines = block.split('\n').filter(function (l) { return l.trim() !== ''; });
      const ti = lines.findIndex(function (l) { return l.indexOf('-->') >= 0; });
      if (ti < 0) return;
      const timing = lines[ti]
        .replace(/(\d+):(\d+):(\d+)[,.](\d+)/g, function (m, h, mi, s, ms) {
          return pad(h, 2) + ':' + pad(mi, 2) + ':' + pad(s, 2) + '.' + (ms + '00').slice(0, 3);
        })
        .replace(/\s+X1:.*$/, ''); // координаты из некоторых SRT
      const body = lines.slice(ti + 1).join('\n')
        .replace(/\{\\[^}]*\}/g, '')            // теги ASS вида {\an8}
        .replace(/<font[^>]*>|<\/font>/gi, '');
      if (!body) return;
      out.push(timing, body, '');
    });
    return out.join('\n');
  }

  function pad(v, n) {
    v = String(parseInt(v, 10));
    while (v.length < n) v = '0' + v;
    return v;
  }

  TV.subs = { match: match, srtToVtt: srtToVtt };
})();
