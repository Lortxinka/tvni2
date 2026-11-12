/* Пространственная навигация (D-pad) и раскладка клавиш ТВ-пультов. */
(function () {
  'use strict';
  var TV = window.TV;

  // keyCode → действие. Включены коды Tizen (Samsung), webOS (LG) и HbbTV.
  const CODES = {
    37: 'left', 38: 'up', 39: 'right', 40: 'down',
    13: 'enter', 32: 'space',
    27: 'back', 8: 'backspace', 10009: 'back', 461: 'back', 166: 'back',
    415: 'play', 19: 'pause', 10252: 'playpause', 179: 'playpause', 413: 'stop',
    412: 'rewind', 417: 'forward', 227: 'rewind', 228: 'forward'
  };
  const KEYS = {
    ArrowLeft: 'left', ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down',
    Left: 'left', Up: 'up', Right: 'right', Down: 'down',
    Enter: 'enter', ' ': 'space', Escape: 'back', Esc: 'back', Backspace: 'backspace',
    GoBack: 'back', BrowserBack: 'back',
    MediaPlayPause: 'playpause', MediaPlay: 'play', MediaPause: 'pause', MediaStop: 'stop',
    MediaRewind: 'rewind', MediaFastForward: 'forward',
    MediaTrackPrevious: 'rewind', MediaTrackNext: 'forward'
  };

  function keyName(e) {
    return KEYS[e.key] || CODES[e.keyCode] || null;
  }

  // На Samsung Tizen медиа-клавиши нужно явно зарегистрировать.
  function registerTvKeys() {
    try {
      if (window.tizen && tizen.tvinputdevice) {
        ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaRewind', 'MediaFastForward']
          .forEach(function (k) { try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* ignore */ } });
      }
    } catch (e) { /* ignore */ }
  }

  let scope = document.body;
  const groupMemory = {};

  function isTextInput(el) {
    return el && el.tagName === 'INPUT' && /^(text|search|url|email|number|password|tel)$/i.test(el.type || 'text');
  }

  function visible(el) {
    if (el.disabled) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    // Элемент в скрытом (прозрачном) слое — например, OSD плеера.
    if (el.closest('.off, .hidden')) return false;
    return true;
  }

  function items() {
    return Array.prototype.filter.call(scope.querySelectorAll('.focusable'), visible);
  }

  function groupOf(el) {
    const g = el.closest('[data-nav-group]');
    return g ? g.getAttribute('data-nav-group') : null;
  }

  function ensureVisible(el) {
    const sc = el.closest('[data-scroll]');
    if (!sc) return;
    const s = sc.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const pad = Math.max(24, r.height * 0.15);
    if (r.top < s.top + pad) sc.scrollTop -= (s.top + pad - r.top);
    else if (r.bottom > s.bottom - pad) sc.scrollTop += (r.bottom - (s.bottom - pad));
  }

  function focus(el) {
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    ensureVisible(el);
    const g = groupOf(el);
    if (g) groupMemory[g] = el;
  }

  function rangeGap(a1, a2, b1, b2) {
    if (b2 < a1) return a1 - b2;
    if (b1 > a2) return b1 - a2;
    return 0;
  }

  // Ищем ближайший элемент в направлении: основная дистанция + штраф за смещение по поперечной оси.
  function findNext(cur, dir, list) {
    const r = cur.getBoundingClientRect();
    const rcx = (r.left + r.right) / 2, rcy = (r.top + r.bottom) / 2;
    let best = null, bestScore = Infinity;
    list.forEach(function (el) {
      if (el === cur) return;
      const c = el.getBoundingClientRect();
      const ccx = (c.left + c.right) / 2, ccy = (c.top + c.bottom) / 2;
      let main, cross, tie;
      if (dir === 'right' || dir === 'left') {
        if (dir === 'right' ? !(ccx > rcx + 1 && c.right > r.right) : !(ccx < rcx - 1 && c.left < r.left)) return;
        main = dir === 'right' ? Math.max(0, c.left - r.right) : Math.max(0, r.left - c.right);
        cross = rangeGap(r.top, r.bottom, c.top, c.bottom);
        tie = Math.abs(ccy - rcy);
      } else {
        if (dir === 'down' ? !(ccy > rcy + 1 && c.bottom > r.bottom) : !(ccy < rcy - 1 && c.top < r.top)) return;
        main = dir === 'down' ? Math.max(0, c.top - r.bottom) : Math.max(0, r.top - c.bottom);
        cross = rangeGap(r.left, r.right, c.left, c.right);
        tie = Math.abs(c.left - r.left);
      }
      const score = main + cross * 3 + tie * 0.01;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    return best;
  }

  function move(dir) {
    const list = items();
    if (!list.length) return false;
    const cur = document.activeElement;
    if (!cur || list.indexOf(cur) < 0) { focus(list[0]); return true; }
    let next = findNext(cur, dir, list);
    if (!next) return false;
    // При входе в группу (сетку) возвращаемся к последней выбранной карточке.
    const g = groupOf(next);
    if (g && g !== groupOf(cur)) {
      const mem = groupMemory[g];
      if (mem && mem !== next && document.body.contains(mem) && list.indexOf(mem) >= 0) next = mem;
    }
    focus(next);
    return true;
  }

  TV.nav = {
    keyName: keyName,
    registerTvKeys: registerTvKeys,
    isTextInput: isTextInput,
    setScope: function (el) { scope = el; },
    focus: focus,
    move: move,
    items: items,
    forgetGroup: function (g) { delete groupMemory[g]; },
    // Фокус на элемент, если текущий фокус вне области навигации.
    ensureFocus: function (preferred) {
      const list = items();
      if (list.indexOf(document.activeElement) >= 0) return;
      focus(preferred && list.indexOf(preferred) >= 0 ? preferred : list[0]);
    }
  };
})();
