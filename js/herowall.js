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

  // Each project can carry a playlist (data-media: [{v: video, s: still, p: focus, l: label}]);
  // every visit to the project shows its next item, so the same clip does not come back each time.
  function mediaList(t) {
    if (!t._media) {
      var d = t.dataset;
      try { t._media = JSON.parse(d.media || '[]'); } catch (e) { t._media = []; }
      if (!t._media.length) t._media = [{ v: d.video, s: d.still, p: d.pos }];
      t._next = 0;
    }
    return t._media;
  }
  function nextMedia(t) {
    var list = mediaList(t), m = list[t._next % list.length];
    t._next++;
    return m;
  }

  // On wide screens a project with several clips shows them all at once, in a grid inside the frame.
  var multi = null, turn = 0;
  function multiOK() { return !window.matchMedia || window.matchMedia('(min-width: 1001px)').matches; }
  function buildMulti(list) {
    var g = document.createElement('div');
    g.className = 'hw-multi n-' + Math.min(list.length, 5);
    list.slice(0, 5).forEach(function (m) {
      var c = document.createElement('div'), el;
      c.className = 'hm-tile';
      if (m.v && !reduce) {
        el = document.createElement('video');
        el.muted = true; el.loop = true; el.playsInline = true; el.autoplay = true;
        el.setAttribute('muted', ''); el.setAttribute('playsinline', '');
        el.poster = m.s; el.src = m.v;
      } else {
        el = document.createElement('img');
        el.src = m.s; el.alt = '';
      }
      el.style.objectPosition = m.p || '50% 50%';
      c.appendChild(el);
      // lp: "tl" puts the label top-left, for clips that carry their own caption top-right.
      if (m.l) { var lab = document.createElement('span'); lab.className = 'hm-label' + (m.lp === 'tl' ? ' tl' : ''); lab.textContent = m.l; c.appendChild(lab); }
      g.appendChild(c);
    });
    return g;
  }
  function multiVideos(fn) { if (multi) Array.prototype.forEach.call(multi.querySelectorAll('video'), fn); }
  function playAll() { multiVideos(function (v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }); }
  function clearMulti() {
    if (!multi) return;
    multiVideos(function (v) { v.pause(); v.removeAttribute('src'); v.load(); });
    multi.parentNode.removeChild(multi);
    multi = null;
  }

  function show(i) {
    idx = (i + tiles.length) % tiles.length;
    if (!shown(tiles[idx])) idx = step(idx, 1);
    wall.classList.toggle('is-held', performance.now() < holdUntil);
    var d = tiles[idx].dataset, list = mediaList(tiles[idx]);
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
    wall.style.setProperty('--mk', d.mk);
    if (shownIdx !== idx) swapWord(d.word, d.mk);
    shownIdx = idx;
    video.classList.remove('is-on');
    video.pause();
    clearMulti();
    if (list.length > 1 && multiOK()) {
      // Every clip and photo of the project at once; a longer turn, since there is more to watch.
      titleEl.textContent = d.title;
      still.style.visibility = 'hidden';
      if (video.getAttribute('src')) { video.removeAttribute('src'); video.load(); }
      multi = buildMulti(list);
      video.parentNode.insertBefore(multi, video.nextSibling);
      if (visible && !document.hidden) playAll();
      pendingPlay = false;
      wall.classList.add('is-live');
      turn = Math.round(dwell() * 1.4);
      wall.style.setProperty('--hw-dwell-s', (turn / 1000) + 's');
      return;
    }
    var m = nextMedia(tiles[idx]);
    turn = dwell();
    wall.style.setProperty('--hw-dwell-s', (turn / 1000) + 's');
    still.style.visibility = '';
    titleEl.textContent = d.title + (m.l ? ' · ' + m.l : '');
    still.src = m.s;
    // Light crop: each clip fills the frame from its focus point (data-pos, default the centre).
    main.style.setProperty('--hw-pos', m.p || '50% 50%');
    pendingPlay = !!(m.v && !reduce);
    wall.classList.toggle('is-live', !pendingPlay);
    if (m.v && !reduce) {
      if (video.getAttribute('src') !== m.v) video.src = m.v;
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
    }, pendingPlay ? MAXWAIT : (turn || dwell()));
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
    if (!on()) { video.pause(); multiVideos(function (v) { v.pause(); }); clearTimeout(timer); return; }
    if (visible && !document.hidden) playAll(); else multiVideos(function (v) { v.pause(); });
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
