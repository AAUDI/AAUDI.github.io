/* Before / after comparison. Markup:
     <div class="compare" data-before="Noisy" data-after="Denoised" data-auto>
       <img class="cmp-a" src="before.jpg" alt="">
       <img class="cmp-b" src="after.jpg" alt="">
       <input class="cmp-range" type="range" min="0" max="100" value="50" aria-label="Reveal the processed image">
     </div>
   The slider position is the CSS variable --split (0..100 %). With data-auto the
   divider sweeps on its own while on screen until the visitor takes hold of it.
   The two labels come from data-before / data-after. */
(function () {
  'use strict';
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  document.querySelectorAll('.compare').forEach(function (box) {
    var range = box.querySelector('.cmp-range');
    if (!range) return;
    var auto = box.hasAttribute('data-auto') && !reduceMotion, onScreen = false, raf = 0, wait = 0, t0 = 0, held = false;
    var slide = box.closest('.slide');

    ['before', 'after'].forEach(function (k, i) {
      var txt = box.getAttribute('data-' + k);
      if (!txt) return;
      var tag = document.createElement('span');
      tag.className = 'cmp-tag cmp-tag-' + (i ? 'b' : 'a');
      tag.textContent = txt;
      tag.setAttribute('aria-hidden', 'true');
      box.appendChild(tag);
    });

    var handle = document.createElement('span'); handle.className = 'cmp-handle'; handle.textContent = '‹ ›'; handle.setAttribute('aria-hidden', 'true'); box.appendChild(handle);

    function set(v) { box.style.setProperty('--split', v + '%'); range.value = v; }
    set(parseFloat(range.value) || 50);

    function visible() { return onScreen && !document.hidden && !(slide && !slide.classList.contains('is-active')); }
    function sweep(now) {
      raf = 0;
      if (!auto || held) return;
      if (!visible()) { wait = setTimeout(start, 400); return; }
      if (!t0) t0 = now;
      var x = (now - t0) / 1000;
      set(50 + 36 * Math.sin(x * 0.9));
      raf = requestAnimationFrame(sweep);
    }
    function start() { clearTimeout(wait); wait = 0; if (!raf && auto && onScreen && !held) raf = requestAnimationFrame(sweep); }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; clearTimeout(wait); wait = 0; }
    function take() { held = true; auto = false; stop(); box.classList.add('is-held'); }

    range.addEventListener('input', function () { take(); set(parseFloat(range.value)); });
    range.addEventListener('pointerdown', take);
    // Dragging anywhere on the image, not only on the thumb.
    box.addEventListener('pointerdown', function (e) {
      if (e.target === range) return;
      if (e.button !== undefined && e.button !== 0) return;
      take();
      var r = box.getBoundingClientRect();
      var move = function (ev) { set(Math.max(0, Math.min(100, (ev.clientX - r.left) / r.width * 100))); };
      move(e);
      var up = function () { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    });
    // The compare sits inside a card link on the home page: a drag must not follow the link.
    box.addEventListener('click', function (e) { if (box.classList.contains('is-held')) { e.preventDefault(); e.stopPropagation(); } });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) { onScreen = entries[0].isIntersecting; if (onScreen) start(); else stop(); }, { threshold: 0.3 }).observe(box);
    } else { onScreen = true; start(); }
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
  });
})();
