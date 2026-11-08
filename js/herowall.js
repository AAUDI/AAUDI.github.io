/* Camera wall hero (looks with data-hero="wall" on <html>).
   Twelve tiles, one per project, each carrying its real footage. Every few
   seconds the next camera takes the main view: its clip plays (or its photo
   shows), the label and link follow, and the word in "Computer vision for …"
   changes with it. Clicking a tile selects it and holds it for a while.
   Nothing runs while the wall is hidden, off screen, or the tab is hidden;
   with reduced motion the wall stays on the first camera until clicked. */
(function () {
  'use strict';

  var root = document.documentElement;
  var wall = document.getElementById('heroWall');
  if (!wall) return;
  var main = document.getElementById('hwMain');
  var still = document.getElementById('hwStill');
  var video = document.getElementById('hwVideo');
  var camEl = document.getElementById('hwCam');
  var titleEl = document.getElementById('hwTitle');
  var timeEl = document.getElementById('hwTime');
  var word = document.getElementById('hsWord');
  var tiles = Array.prototype.slice.call(wall.querySelectorAll('.hw-grid button'));
  if (!tiles.length) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var HOLD = 12000;
  // A look can slow the wall down with --hw-dwell (ms) on .hero-wall.
  function dwell() { var v = parseFloat(getComputedStyle(wall).getPropertyValue('--hw-dwell')); return v > 0 ? v : 3800; }
  // A look can hide some tiles; the cycle skips them.
  function shown(t) { return t.getClientRects().length > 0; }
  function step(from, dir) {
    for (var k = 1; k <= tiles.length; k++) { var j = ((from + dir * k) % tiles.length + tiles.length) % tiles.length; if (shown(tiles[j])) return j; }
    return from;
  }
  var idx = 0, timer = 0, visible = true, holdUntil = 0, t0 = performance.now(), shownIdx = -1;
  // A clip's turn only starts once it plays, so a slow connection never skips a project.
  var pendingPlay = false, MAXWAIT = 15000;

  function on() { return root.getAttribute('data-hero') === 'wall'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function swapWord(text, mk) {
    if (!word) return;
    if (reduce) { word.textContent = text; word.style.setProperty('--mk', mk); return; }
    word.classList.add('is-out');
    setTimeout(function () {
      word.textContent = text;
      word.style.setProperty('--mk', mk);
      word.classList.remove('is-out');
    }, 200);
  }

  function show(i) {
    idx = (i + tiles.length) % tiles.length;
    if (!shown(tiles[idx])) idx = step(idx, 1);
    wall.classList.toggle('is-held', performance.now() < holdUntil);
    var d = tiles[idx].dataset;
    tiles.forEach(function (t, k) { t.setAttribute('aria-pressed', String(k === idx)); });
    // Where the tiles scroll sideways (phones), bring the playing one into view.
    var grid = tiles[idx].closest('.hw-grid');
    if (grid && grid.scrollWidth > grid.clientWidth + 2) {
      var dx = tiles[idx].getBoundingClientRect().left - grid.getBoundingClientRect().left;
      grid.scrollTo({ left: grid.scrollLeft + dx - 4, behavior: reduce ? 'auto' : 'smooth' });
    }
    main.href = d.href;
    main.setAttribute('aria-label', 'Open the project: ' + d.title);
    camEl.textContent = 'CAM ' + pad(idx + 1) + ' · ' + d.cam;
    titleEl.textContent = d.title;
    still.src = d.still;
    wall.style.setProperty('--mk', d.mk);
    if (shownIdx !== idx) swapWord(d.word, d.mk);
    shownIdx = idx;
    video.classList.remove('is-on');
    video.pause();
    pendingPlay = !!(d.video && !reduce);
    wall.classList.toggle('is-live', !pendingPlay);
    if (d.video && !reduce) {
      if (video.getAttribute('src') !== d.video) video.src = d.video;
      try { video.currentTime = 0; } catch (e) {}
      var p = video.play();
      if (p && p.catch) p.catch(function () {});
    } else if (video.getAttribute('src')) {
      video.removeAttribute('src');
      video.load();
    }
  }
  video.addEventListener('playing', function () {
    video.classList.add('is-on');
    wall.classList.add('is-live');
    if (pendingPlay) { pendingPlay = false; schedule(); }
  });

  function schedule() {
    clearTimeout(timer);
    if (!on() || !visible || document.hidden || reduce) return;
    timer = setTimeout(function () {
      if (performance.now() >= holdUntil) show(step(idx, 1));
      schedule();
    }, pendingPlay ? MAXWAIT : dwell());
  }

  tiles.forEach(function (b, k) {
    b.addEventListener('click', function () { holdUntil = performance.now() + HOLD; show(k); schedule(); });
  });

  setInterval(function () {
    if (!on() || !visible || document.hidden) return;
    var s = Math.floor((performance.now() - t0) / 1000);
    timeEl.textContent = pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
  }, 1000);

  function resume() {
    if (!on()) { video.pause(); clearTimeout(timer); return; }
    if (shownIdx < 0 || !shown(tiles[idx])) show(idx);
    if (visible && !document.hidden && video.getAttribute('src') && !reduce) {
      var p = video.play(); if (p && p.catch) p.catch(function () {});
    } else video.pause();
    schedule();
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (e) { visible = e[0].isIntersecting; resume(); }, { threshold: 0.1 }).observe(wall);
  }
  document.addEventListener('visibilitychange', resume);
  // The looks switcher can turn the wall on or off without a reload.
  new MutationObserver(resume).observe(root, { attributes: true, attributeFilter: ['data-hero'] });
  resume();
})();
