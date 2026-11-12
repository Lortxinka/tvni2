/* Автопревью: первый кадр видео через скрытый <video> + canvas.
   Генерация строго по одному файлу — ТВ-железо слабое. */
(function () {
  'use strict';
  var TV = window.TV;

  const W = 384, H = 216;
  const TIMEOUT = 12000;
  const queue = [];
  let busy = false;
  let generation = 0;

  // Запрос превью; cb({ img, duration }) или cb(null).
  function request(item, cb) {
    TV.store.thumbs.get(item.id).then(function (rec) {
      if (rec) return cb(rec);
      queue.push({ item: item, cb: cb, gen: generation });
      pump();
    });
  }

  // Сбрасываем очередь при смене источника/поиска.
  function reset() {
    generation++;
    queue.length = 0;
  }

  function pump() {
    if (busy) return;
    let job;
    while ((job = queue.shift()) && job.gen !== generation) { /* устаревшие задачи */ }
    if (!job) return;
    busy = true;
    capture(job.item).then(function (rec) {
      if (rec) TV.store.thumbs.put(job.item.id, rec);
      job.cb(rec);
    }, function () { job.cb(null); }).then(function () {
      busy = false;
      setTimeout(pump, 30);
    });
  }

  function isDark(ctx) {
    try {
      const d = ctx.getImageData(0, 0, W, H).data;
      let sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 4 * 97) { sum += d[i] + d[i + 1] + d[i + 2]; n++; }
      return sum / (n * 3) < 18;
    } catch (e) { return false; }
  }

  function capture(item) {
    return new Promise(function (resolve) {
      const v = document.createElement('video');
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      let done = false, triedLater = false;

      function finish(rec) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        v.removeAttribute('src');
        try { v.load(); } catch (e) { /* ignore */ }
        resolve(rec);
      }

      function draw() {
        const vw = v.videoWidth, vh = v.videoHeight;
        if (!vw || !vh) return false;
        // «cover»: заполняем 16:9, обрезая лишнее.
        const scale = Math.max(W / vw, H / vh);
        const dw = vw * scale, dh = vh * scale;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
        return true;
      }

      const timer = setTimeout(function () { finish(null); }, TIMEOUT);

      v.muted = true;
      v.preload = 'auto';
      v.setAttribute('playsinline', '');
      if (item.remote) v.crossOrigin = 'anonymous';

      v.addEventListener('loadedmetadata', function () {
        v.currentTime = 0.05; // первый кадр
      });
      v.addEventListener('seeked', function () {
        if (done) return;
        try {
          if (!draw()) return finish(null);
          // Чёрный первый кадр (заставка) — берём кадр поглубже.
          if (!triedLater && isDark(ctx) && v.duration > 4) {
            triedLater = true;
            v.currentTime = Math.min(v.duration * 0.1, 30);
            return;
          }
          finish({ img: canvas.toDataURL('image/jpeg', 0.72), duration: v.duration || 0 });
        } catch (e) {
          finish(null); // например, «грязный» canvas без CORS
        }
      });
      // Формат не поддерживается — запоминаем, чтобы не пытаться снова.
      v.addEventListener('error', function () { finish({ img: null, duration: 0 }); });
      v.src = item.url();
    });
  }

  TV.thumbs = { request: request, reset: reset };
})();
