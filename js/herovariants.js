/* Hero design test links (index.html?hero=…). The default hero (one frame
   with project tabs, js/herowall.js) is unchanged; these build the other
   designs from the same twelve tiles, so every clip keeps its true shape
   (data-ar = width / height) and is never cropped:
     ?hero=strip   one row of clips at the same height, drifting sideways
     ?hero=mosaic  two justified rows: each tile's width follows its clip
     ?hero=split   CSS only: text left, a 4:3 frame on the right
     ?hero=wide    CSS only: the frame keeps only the wide clips
   Videos play only while visible, muted, from the short hero versions. */
(function () {
  'use strict';

  var root = document.documentElement;
  var v = root.getAttribute('data-herov');
  var wall = document.getElementById('heroWall');
  if (!wall || (v !== 'strip' && v !== 'mosaic')) return;

  var tiles = Array.prototype.slice.call(wall.querySelectorAll('.hw-grid button'));
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function item(t) {
    var d = t.dataset;
    var a = document.createElement('a');
    a.className = 'hv-item';
    a.href = d.href;
    a.style.setProperty('--a', d.ar || 1.6);
    a.setAttribute('aria-label', d.title);
    var img = document.createElement('img');
    img.src = d.still; img.alt = ''; img.decoding = 'async';
    a.appendChild(img);
    if (d.video) {
      var vid = document.createElement('video');
      vid.muted = true; vid.loop = true; vid.playsInline = true;
      vid.setAttribute('muted', ''); vid.setAttribute('playsinline', '');
      vid.preload = 'none';
      vid.setAttribute('data-src', d.video);
      a.appendChild(vid);
    }
    var cap = document.createElement('span');
    cap.className = 'hv-cap';
    cap.textContent = d.short;
    a.appendChild(cap);
    return a;
  }

  // Play a clip only while it is on screen.
  function watch(container) {
    var vids = Array.prototype.slice.call(container.querySelectorAll('video'));
    if (reduce) return;
    if (!('IntersectionObserver' in window)) { vids.forEach(play); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) play(e.target); else e.target.pause(); });
    }, { threshold: 0.05 });
    vids.forEach(function (x) { io.observe(x); });
  }
  function play(x) {
    if (!x.getAttribute('src')) x.src = x.getAttribute('data-src');
    var p = x.play(); if (p && p.catch) p.catch(function () {});
  }

  if (v === 'strip') {
    // FPV, thermal, airport, bin picking, ToF, feed bunk, people counting, Ph.D. drone camera.
    var pick = [0, 1, 2, 3, 4, 5, 6, 8];
    var strip = document.createElement('div');
    strip.className = 'hv-strip';
    var track = document.createElement('div');
    track.className = 'hv-track';
    // Two copies side by side so the drift loops without a seam.
    for (var copy = 0; copy < 2; copy++) {
      pick.forEach(function (k) {
        var el = item(tiles[k]);
        if (copy) { el.setAttribute('aria-hidden', 'true'); el.tabIndex = -1; }
        track.appendChild(el);
      });
    }
    strip.appendChild(track);
    wall.appendChild(strip);
    watch(strip);
  }

  if (v === 'mosaic') {
    // Two rows, each justified to the full width: wide clips get wide tiles, near-square clips narrow ones.
    var rows = [[0, 1], [3, 2, 5]];
    var mosaic = document.createElement('div');
    mosaic.className = 'hv-mosaic';
    rows.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'hv-row';
      r.forEach(function (k) { row.appendChild(item(tiles[k])); });
      mosaic.appendChild(row);
    });
    wall.appendChild(mosaic);
    watch(mosaic);
  }
})();
