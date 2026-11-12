/* Связка экранов, обработка пульта и истории (кнопка «Назад» браузера). */
(function () {
  'use strict';
  var TV = window.TV;
  var U = TV.util;
  var store = TV.store;

  const $ = function (id) { return document.getElementById(id); };
  const screens = { start: $('screen-start'), library: $('screen-library'), player: $('screen-player') };
  let current = 'start';
  let lastCard = null;

  function show(name) {
    Object.keys(screens).forEach(function (k) { screens[k].classList.toggle('hidden', k !== name); });
    current = name;
    TV.nav.setScope(screens[name]);
  }

  // ---------- Старт ----------

  const msg = $('start-msg');
  function setMsg(text, isError) {
    msg.textContent = text || '';
    msg.className = 'hint' + (isError ? ' error' : '');
  }

  function goStart() {
    show('start');
    const url = $('server-url');
    if (!url.value) url.value = store.settings.get('serverUrl') || '';
    TV.nav.focus($('btn-pick-folder'));
  }

  function openSource(src) {
    TV.library.setSource(src);
    show('library');
    setMsg('');
    TV.nav.focus(TV.library.firstCard() || TV.library.search);
  }

  function pickFiles(input) {
    input.value = '';
    input.click();
  }

  function onFilesChosen(e) {
    const files = e.target.files;
    if (!files || !files.length) return;
    const src = TV.sources.fromFiles(files);
    if (!src.items.length) return setMsg('В выбранном нет видеофайлов (' + U.VIDEO_EXT.join(', ') + ')', true);
    openSource(src);
  }

  function connect(url, opts) {
    opts = opts || {};
    url = TV.sources.normalizeServerUrl(url);
    if (!url) { setMsg('Введите адрес сервера, например http://192.168.1.10:8080', true); return Promise.resolve(false); }
    setMsg('Подключение к ' + url + '…');
    return TV.sources.fromServer(url, opts.timeout).then(function (src) {
      store.settings.set('serverUrl', url);
      openSource(src);
      return true;
    }, function (err) {
      if (!opts.silent) setMsg('Не удалось подключиться к ' + url + ' (' + (err && err.message || err) + ')', true);
      else setMsg('');
      return false;
    });
  }

  $('btn-pick-folder').addEventListener('click', function () { pickFiles($('input-folder')); });
  $('btn-pick-files').addEventListener('click', function () { pickFiles($('input-files')); });
  $('input-folder').addEventListener('change', onFilesChosen);
  $('input-files').addEventListener('change', onFilesChosen);
  $('btn-connect').addEventListener('click', function () { connect($('server-url').value); });
  $('server-url').addEventListener('keydown', function (e) {
    if (TV.nav.keyName(e) === 'enter') { e.preventDefault(); connect($('server-url').value); }
  });

  // ---------- Библиотека ----------

  $('btn-change-source').addEventListener('click', goStart);
  $('btn-refresh').addEventListener('click', function () {
    const src = TV.library.getSource();
    if (src && src.kind === 'server') connect(src.base).then(function (ok) {
      if (ok) U.toast('Библиотека обновлена'); else U.toast('Сервер недоступен', { error: true });
    });
  });

  TV.library.init({
    onOpen: function (item) {
      lastCard = document.activeElement;
      show('player');
      try { history.pushState({ tvPlayer: 1 }, ''); } catch (e) { /* ignore */ }
      TV.player.open(item, function (it) {
        show('library');
        const c = TV.library.refreshItem(it) || lastCard;
        TV.nav.ensureFocus(c);
        if (c) TV.nav.focus(c);
      });
    }
  });

  // «Назад» браузера/пульта, когда открыт плеер.
  window.addEventListener('popstate', function () {
    if (TV.player.isOpen()) TV.player.close();
  });

  function back() {
    if (current === 'player') {
      if (history.state && history.state.tvPlayer) history.back(); // закроется в popstate
      else TV.player.close();
    } else if (current === 'library') {
      const s = TV.library.search;
      if (s.value) {
        s.value = '';
        s.dispatchEvent(new Event('input'));
        TV.nav.focus(s);
      } else if (document.activeElement !== s && document.activeElement && document.activeElement.classList.contains('card')) {
        TV.nav.focus(s);
      } else {
        goStart();
      }
    }
  }

  // ---------- Пульт ----------

  document.addEventListener('keydown', function (e) {
    let k = TV.nav.keyName(e);
    if (!k) return;
    const active = document.activeElement;
    const typing = TV.nav.isTextInput(active);

    // В поле ввода Backspace стирает символ, пробел — пробел, ←/→ двигают курсор.
    if (typing) {
      if (k === 'backspace' || k === 'space') return;
      if (k === 'left' && active.selectionStart > 0) return;
      if (k === 'right' && active.selectionEnd < active.value.length) return;
      if (k === 'enter') return;
    }
    if (k === 'backspace') k = 'back';

    if (current === 'player' && TV.player.onKey(k)) { e.preventDefault(); return; }

    if (k === 'left' || k === 'right' || k === 'up' || k === 'down') {
      e.preventDefault();
      TV.nav.move(k);
    } else if (k === 'enter') {
      if (active && active.classList.contains('focusable') && !e.repeat) {
        e.preventDefault();
        active.click();
      }
    } else if (k === 'back') {
      e.preventDefault();
      back();
    }
  });

  // Не даём мыши «потерять» фокус: клик вне элементов возвращает его в навигацию.
  document.addEventListener('mousedown', function (e) {
    if (!e.target.closest('.focusable')) setTimeout(function () { TV.nav.ensureFocus(); }, 0);
  });

  // ---------- Запуск ----------

  TV.app = { back: back };
  TV.nav.registerTvKeys();
  goStart();

  // Открыто с нашего сервера — сразу подключаемся к нему.
  if (/^https?:$/.test(location.protocol)) {
    connect(location.origin, { silent: true, timeout: 4000 });
  }
})();
