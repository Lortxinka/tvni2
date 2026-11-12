/* Экран библиотеки: сетка карточек, поиск, превью, прогресс просмотра. */
(function () {
  'use strict';
  var TV = window.TV;
  var U = TV.util;

  const PLACEHOLDER = '<svg class="thumb-ph" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';

  let source = null;
  let shown = [];
  let observer = null;
  const durations = {};
  let onOpen = function () {};

  const grid = document.getElementById('grid');
  const search = document.getElementById('search');
  const empty = document.getElementById('lib-empty');

  function init(opts) {
    onOpen = opts.onOpen;
    search.addEventListener('input', U.debounce(function () { render(); }, 200));
    grid.addEventListener('click', function (e) {
      const card = e.target.closest('.card');
      if (card) onOpen(shown[+card.getAttribute('data-i')]);
    });
  }

  function setSource(src) {
    source = src;
    search.value = '';
    TV.nav.forgetGroup('grid');
    document.getElementById('lib-source').textContent = src.label;
    document.getElementById('btn-refresh').classList.toggle('hidden', src.kind !== 'server');
    render();
    grid.parentNode.scrollTop = 0;
  }

  function filtered() {
    const q = U.normalize(search.value);
    if (!q) return source.items.slice();
    const words = q.split(' ');
    return source.items.filter(function (it) {
      return words.every(function (w) { return it.search.indexOf(w) >= 0; });
    });
  }

  function render() {
    if (!source) return;
    TV.thumbs.reset();
    if (observer) observer.disconnect();
    shown = filtered();
    grid.innerHTML = '';
    document.getElementById('lib-count').textContent =
      (search.value ? 'найдено ' : '') + shown.length + ' видео';

    if (!shown.length) {
      empty.textContent = source.items.length ? 'Ничего не найдено' : 'В этом источнике нет видеофайлов';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    const frag = document.createDocumentFragment();
    shown.forEach(function (it, i) { frag.appendChild(card(it, i)); });
    grid.appendChild(frag);

    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          observer.unobserve(en.target);
          loadThumb(en.target);
        });
      }, { root: grid.parentNode, rootMargin: '400px 0px' });
      Array.prototype.forEach.call(grid.children, function (c) { observer.observe(c); });
    } else {
      Array.prototype.forEach.call(grid.children, loadThumb);
    }
  }

  function card(it, i) {
    const c = U.el('button', 'card focusable');
    c.type = 'button';
    c.setAttribute('data-i', i);
    c.setAttribute('data-id', it.id);
    const th = U.el('div', 'thumb');
    th.innerHTML = PLACEHOLDER;
    c.appendChild(th);
    const body = U.el('div', 'card-body');
    body.appendChild(U.el('div', 'card-title', it.title));
    body.appendChild(U.el('div', 'card-sub', it.folder || U.fmtSize(it.size)));
    c.appendChild(body);
    decorate(c, it);
    return c;
  }

  // Бейджи: длительность, «CC», прогресс просмотра.
  function decorate(c, it) {
    const th = c.querySelector('.thumb');
    Array.prototype.forEach.call(th.querySelectorAll('.badge, .progress'), function (n) { n.parentNode.removeChild(n); });
    const pos = TV.store.positions.get(it.id);
    const dur = durations[it.id] || (pos && pos.d) || 0;
    if (dur) th.appendChild(U.el('span', 'badge', U.fmtTime(dur)));
    if (pos && pos.w) th.appendChild(U.el('span', 'badge badge-left', '✓ Просмотрено'));
    else if (it.subs.length) th.appendChild(U.el('span', 'badge badge-left', 'CC'));
    if (pos && pos.t > 0 && dur) {
      const p = U.el('div', 'progress');
      const bar = U.el('i');
      bar.style.width = Math.min(100, pos.t / dur * 100) + '%';
      p.appendChild(bar);
      th.appendChild(p);
    }
  }

  function loadThumb(c) {
    const it = shown[+c.getAttribute('data-i')];
    if (!it) return;
    TV.thumbs.request(it, function (rec) {
      if (!rec || !c.parentNode) return;
      if (rec.duration) durations[it.id] = rec.duration;
      const th = c.querySelector('.thumb');
      if (rec.img) {
        th.style.backgroundImage = 'url("' + rec.img + '")';
        th.classList.add('has-img');
      }
      decorate(c, it);
    });
  }

  // После возврата из плеера — обновить прогресс одной карточки.
  function refreshItem(it) {
    const c = grid.querySelector('.card[data-id="' + cssEscape(it.id) + '"]');
    if (c) decorate(c, it);
    return c;
  }

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
  }

  function firstCard() { return grid.querySelector('.card'); }

  TV.library = {
    init: init,
    setSource: setSource,
    refreshItem: refreshItem,
    firstCard: firstCard,
    getSource: function () { return source; },
    search: search
  };
})();
