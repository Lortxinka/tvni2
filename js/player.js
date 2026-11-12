/* Экран плеера: управление, OSD, субтитры, громкость, автосохранение позиции. */
(function () {
  'use strict';
  var TV = window.TV;
  var U = TV.util;
  var store = TV.store;

  const SEEK_STEP = 10;
  const OSD_HIDE_MS = 4000;
  const SAVE_EVERY_MS = 5000;

  const $ = function (id) { return document.getElementById(id); };
  const screen = $('screen-player');
  const video = $('video');
  const osd = $('osd');
  const seekBar = $('p-seek');
  const playBtn = $('p-play');
  const subsBtn = $('p-subs');
  const big = $('p-big');

  let item = null;
  let onClose = null;
  let hideTimer = 0, bigTimer = 0;
  let lastSave = 0;
  let tracks = [];
  let subIndex = -1;
  let blobUrls = [];

  const ICONS = {
    play: '<svg class="ico" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg class="ico" viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>'
  };

  // ---------- Открытие / закрытие ----------

  function open(it, closeCb) {
    item = it;
    onClose = closeCb;
    $('p-title').textContent = it.title;
    clearSubs();
    setVolume(store.settings.get('volume'), true);
    updateTimes();
    video.src = it.url();
    loadSubs(it);
    showOsd();
    TV.nav.focus(playBtn);
    const p = video.play();
    if (p && p.catch) p.catch(function () { /* автозапуск запрещён — ждём OK */ });
  }

  function close() {
    if (!item) return;
    savePos();
    const it = item;
    item = null;
    video.pause();
    video.removeAttribute('src');
    try { video.load(); } catch (e) { /* ignore */ }
    clearSubs();
    exitFullscreen();
    clearTimeout(hideTimer);
    if (onClose) onClose(it);
  }

  // ---------- Позиция просмотра ----------

  function savePos() {
    if (!item || !isFinite(video.duration) || !video.duration) return;
    store.positions.save(item.id, video.currentTime, video.duration);
    lastSave = Date.now();
  }

  video.addEventListener('loadedmetadata', function () {
    if (!item) return;
    const pos = store.positions.get(item.id);
    if (pos && pos.t > 5 && pos.t < video.duration - 15) {
      video.currentTime = pos.t;
      U.toast('Продолжаем с ' + U.fmtTime(pos.t) + ' · «С начала» — смотреть сначала', { ms: 5000 });
    }
    updateTimes();
  });

  video.addEventListener('timeupdate', function () {
    updateTimes();
    if (Date.now() - lastSave > SAVE_EVERY_MS && !video.paused) savePos();
  });
  video.addEventListener('progress', updateBuffer);
  video.addEventListener('seeked', savePos);
  video.addEventListener('play', syncPlayState);
  video.addEventListener('pause', function () { syncPlayState(); savePos(); });
  video.addEventListener('ended', function () {
    if (item) store.positions.save(item.id, video.duration, video.duration);
    showOsd();
  });
  video.addEventListener('error', function () {
    if (!item || !video.error) return;
    const msg = {
      2: 'Ошибка сети при загрузке видео',
      3: 'Не удалось декодировать видео',
      4: 'Этот формат или кодек не поддерживается браузером'
    }[video.error.code] || 'Ошибка воспроизведения';
    U.toast(msg, { error: true, ms: 6000 });
    showOsd();
  });

  window.addEventListener('pagehide', savePos);
  window.addEventListener('beforeunload', savePos);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { savePos(); if (item) video.pause(); }
  });

  // ---------- Управление ----------

  function togglePlay() {
    if (video.paused || video.ended) {
      const p = video.play();
      if (p && p.catch) p.catch(function (e) { U.toast('Не удаётся начать воспроизведение', { error: true }); });
      flash(ICONS.play);
    } else {
      video.pause();
      flash(ICONS.pause);
    }
  }

  function seekBy(delta) {
    if (!isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration - 0.5, video.currentTime + delta));
    flash((delta > 0 ? '+' : '−') + Math.abs(delta) + ' с');
    updateTimes();
  }

  function setVolume(v, silent) {
    v = Math.round(Math.max(0, Math.min(1, v)) * 10) / 10;
    video.volume = v;
    video.muted = v === 0;
    store.settings.set('volume', v);
    $('p-vol').textContent = Math.round(v * 100) + '%';
    if (!silent) flash(v === 0 ? 'Без звука' : 'Громкость ' + Math.round(v * 100) + '%');
  }

  function toggleFullscreen() {
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) return exitFullscreen();
    const req = screen.requestFullscreen || screen.webkitRequestFullscreen;
    if (!req) return U.toast('Полноэкранный режим недоступен в этом браузере');
    const p = req.call(screen);
    if (p && p.catch) p.catch(function () { U.toast('Полноэкранный режим недоступен в этом браузере'); });
  }

  function exitFullscreen() {
    const d = document;
    if (!(d.fullscreenElement || d.webkitFullscreenElement)) return;
    const ex = d.exitFullscreen || d.webkitExitFullscreen;
    if (ex) { const p = ex.call(d); if (p && p.catch) p.catch(function () {}); }
  }

  const actions = {
    back: function () { TV.app.back(); },
    restart: function () { video.currentTime = 0; if (video.paused) togglePlay(); },
    rew: function () { seekBy(-SEEK_STEP); },
    fwd: function () { seekBy(SEEK_STEP); },
    play: togglePlay,
    voldown: function () { setVolume(video.volume - 0.1); },
    volup: function () { setVolume((video.muted ? 0 : video.volume) + 0.1); },
    subs: cycleSubs,
    fs: toggleFullscreen
  };

  screen.addEventListener('click', function (e) {
    const b = e.target.closest('[data-act]');
    if (b) { actions[b.getAttribute('data-act')](); showOsd(); return; }
    if (e.target === video) { togglePlay(); showOsd(); }
  });

  seekBar.addEventListener('click', function (e) {
    const r = seekBar.getBoundingClientRect();
    if (isFinite(video.duration)) video.currentTime = (e.clientX - r.left) / r.width * video.duration;
  });

  screen.addEventListener('mousemove', function () { if (item) showOsd(); });

  // ---------- OSD ----------

  function osdVisible() { return !osd.classList.contains('off'); }

  function showOsd() {
    osd.classList.remove('off');
    screen.classList.remove('osd-hidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (!video.paused && !video.ended) {
        osd.classList.add('off');
        screen.classList.add('osd-hidden');
      }
    }, OSD_HIDE_MS);
  }

  function syncPlayState() {
    screen.classList.toggle('playing', !video.paused);
    if (video.paused) showOsd();
    else if (osdVisible()) showOsd(); // перезапуск таймера скрытия
  }

  function flash(content) {
    big.innerHTML = content.charAt(0) === '<' ? content : '';
    if (content.charAt(0) !== '<') big.textContent = content;
    big.classList.remove('hidden');
    clearTimeout(bigTimer);
    bigTimer = setTimeout(function () { big.classList.add('hidden'); }, 700);
  }

  function updateTimes() {
    const d = isFinite(video.duration) ? video.duration : 0;
    const t = video.currentTime || 0;
    $('p-cur').textContent = U.fmtTime(t);
    $('p-dur').textContent = d ? U.fmtTime(d) : '--:--';
    $('p-fill').style.width = d ? (t / d * 100) + '%' : '0';
    seekBar.setAttribute('aria-valuenow', Math.floor(t));
    updateBuffer();
  }

  function updateBuffer() {
    const d = video.duration, b = video.buffered;
    if (!isFinite(d) || !d || !b.length) { $('p-buffer').style.width = '0'; return; }
    let end = 0;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= video.currentTime + 1) end = Math.max(end, b.end(i));
    }
    $('p-buffer').style.width = (end / d * 100) + '%';
  }

  // ---------- Субтитры ----------

  function clearSubs() {
    tracks.forEach(function (tr) { if (tr && tr.parentNode) tr.parentNode.removeChild(tr); });
    blobUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    tracks = [];
    blobUrls = [];
    subIndex = -1;
    updateSubsLabel();
  }

  function preferredSub(subs) {
    for (let i = 0; i < subs.length; i++) if (subs[i].lang === 'ru') return i;
    return 0;
  }

  function loadSubs(it) {
    if (!it.subs.length) return updateSubsLabel();
    subIndex = store.settings.get('subsOff') ? -1 : preferredSub(it.subs);
    updateSubsLabel();
    it.subs.forEach(function (s, i) {
      s.load().then(function (vtt) {
        if (item !== it) return;
        // Дорожка без языка в имени, но с кириллицей — считаем русской.
        if (!s.lang && /[А-Яа-яЁё]/.test(vtt)) { s.lang = 'ru'; s.label = 'Русские'; }
        const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
        blobUrls.push(url);
        const tr = document.createElement('track');
        tr.kind = 'subtitles';
        tr.label = s.label;
        if (s.lang) tr.srclang = s.lang;
        tr.src = url;
        video.appendChild(tr);
        tracks[i] = tr;
        applySubs();
      }).catch(function () {
        U.toast('Не удалось загрузить субтитры «' + s.label + '»', { error: true });
      });
    });
  }

  function applySubs() {
    // Chromium может сам включить только что добавленную дорожку — выставляем режимы явно.
    const els = video.querySelectorAll('track');
    for (let j = 0; j < els.length; j++) {
      const i = tracks.indexOf(els[j]);
      els[j].track.mode = i === subIndex ? 'showing' : 'disabled';
    }
    updateSubsLabel();
  }

  video.textTracks.addEventListener('addtrack', function () { setTimeout(applySubs, 0); });

  function cycleSubs() {
    if (!item || !item.subs.length) return U.toast('Субтитры для этого видео не найдены');
    subIndex = subIndex + 1 >= item.subs.length ? -1 : subIndex + 1;
    store.settings.set('subsOff', subIndex === -1);
    applySubs();
    flash(subIndex === -1 ? 'Субтитры выкл.' : item.subs[subIndex].label);
  }

  function updateSubsLabel() {
    let label;
    if (!item || !item.subs.length) label = 'Субтитры: нет';
    else if (subIndex === -1) label = 'Субтитры: выкл.';
    else label = 'Субтитры: ' + item.subs[subIndex].label;
    subsBtn.textContent = label;
  }

  // ---------- Пульт ----------

  // true — клавиша обработана плеером.
  function onKey(k) {
    switch (k) {
      case 'play': if (video.paused) togglePlay(); showOsd(); return true;
      case 'pause': if (!video.paused) togglePlay(); showOsd(); return true;
      case 'playpause': case 'space': togglePlay(); showOsd(); return true;
      case 'rewind': seekBy(-SEEK_STEP); showOsd(); return true;
      case 'forward': seekBy(SEEK_STEP); showOsd(); return true;
      case 'stop': TV.app.back(); return true;
    }
    if (!osdVisible()) {
      // OSD скрыт: ←/→ — перемотка (фокус на полосу, чтобы повторные нажатия тоже мотали),
      // OK — пауза, остальное — показать панель.
      if (k === 'left' || k === 'right') {
        seekBy(k === 'left' ? -SEEK_STEP : SEEK_STEP);
        TV.nav.focus(seekBar);
      } else if (k === 'enter') togglePlay();
      else if (k !== 'up' && k !== 'down') return false;
      showOsd();
      return true;
    }
    showOsd();
    if (document.activeElement === seekBar && (k === 'left' || k === 'right')) {
      seekBy(k === 'left' ? -SEEK_STEP : SEEK_STEP);
      return true;
    }
    return false;
  }

  TV.player = {
    open: open,
    close: close,
    onKey: onKey,
    isOpen: function () { return !!item; }
  };
})();
