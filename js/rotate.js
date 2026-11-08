/* Rotating stills on the home cards. Markup:
     <div class="rot" data-every="1000" role="img" aria-label="…">
       <img class="is-on" src="a-thumb.jpg" alt=""><img src="b-thumb.jpg" alt="">…
     </div>
   The images cross-fade one after another while the card is on screen; the
   small dots show which one is up. Reduced motion keeps the first image. */
(function () {
  'use strict';
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  document.querySelectorAll('.rot').forEach(function (box) {
    var imgs = Array.prototype.slice.call(box.querySelectorAll('img'));
    if (imgs.length < 2) return;
    var every = Math.max(400, parseInt(box.getAttribute('data-every'), 10) || 1000), i = 0, timer = 0, onScreen = false;

    var dots = document.createElement('span');
    dots.className = 'rot-dots';
    dots.setAttribute('aria-hidden', 'true');
    imgs.forEach(function () { dots.appendChild(document.createElement('i')); });
    box.appendChild(dots);

    function show(k) {
      i = (k + imgs.length) % imgs.length;
      imgs.forEach(function (im, j) { im.classList.toggle('is-on', j === i); dots.children[j].classList.toggle('is-on', j === i); });
    }
    function start() { if (timer || reduceMotion) return; timer = setInterval(function () { if (!document.hidden) show(i + 1); }, every); }
    function stop() { clearInterval(timer); timer = 0; }

    show(0);
    if (reduceMotion) return;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) { onScreen = entries[0].isIntersecting; if (onScreen) start(); else stop(); }, { threshold: 0.3 }).observe(box);
    } else { onScreen = true; start(); }
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else if (onScreen) start(); });
  });

  /* Several clips on one card: <div class="vrot" data-max="11000"> with one
     <video> per clip (the first with src, the others with data-src). Only the
     clip on screen plays; it hands over when it ends or after data-max ms, and
     the next one is loaded just before its turn. A clip's data-cls replaces
     the card's class-label chip while it plays. */
  document.querySelectorAll('.vrot').forEach(function (box) {
    var vids = Array.prototype.slice.call(box.querySelectorAll('video'));
    if (!vids.length) return;
    var media = box.closest('.pcard-media'), i = 0, timer = 0, onScreen = false;
    var maxMs = parseInt(box.getAttribute('data-max'), 10) || 11000;
    var dots = null;
    if (vids.length > 1) {
      dots = document.createElement('span');
      dots.className = 'rot-dots';
      dots.setAttribute('aria-hidden', 'true');
      vids.forEach(function () { dots.appendChild(document.createElement('i')); });
      box.appendChild(dots);
    }
    function load(v) { if (!v.getAttribute('src') && v.getAttribute('data-src')) { v.setAttribute('preload', 'auto'); v.src = v.getAttribute('data-src'); } }
    function play(v) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); }
    vids.forEach(function (v, j) {
      v.muted = true; v.playsInline = true; v.loop = vids.length === 1;
      v.addEventListener('ended', function () { if (j === i && vids.length > 1) show(i + 1); });
    });
    function show(k) {
      var prev = vids[i];
      i = (k + vids.length) % vids.length;
      var v = vids[i];
      load(v);
      vids.forEach(function (x, j) { x.classList.toggle('is-on', j === i); if (dots) dots.children[j].classList.toggle('is-on', j === i); });
      if (media && v.getAttribute('data-cls')) media.setAttribute('data-cls', v.getAttribute('data-cls'));
      if (prev !== v) { prev.pause(); try { v.currentTime = 0; } catch (e) {} }
      clearTimeout(timer);
      if (onScreen && !reduceMotion) {
        play(v);
        if (vids.length > 1) { timer = setTimeout(function () { show(i + 1); }, maxMs); load(vids[(i + 1) % vids.length]); }
      }
    }
    show(0);
    if (reduceMotion) return;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        if (onScreen) show(i); else { clearTimeout(timer); vids[i].pause(); }
      }, { threshold: 0.3 }).observe(box);
    } else { onScreen = true; show(0); }
    document.addEventListener('visibilitychange', function () { if (document.hidden) { clearTimeout(timer); vids[i].pause(); } else if (onScreen) show(i); });
  });
})();
