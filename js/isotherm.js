/* Isotherm background: faint contour lines of a smooth "temperature" field,
   drawn once per size behind the hero and the closing panel. Marching squares
   over value noise; the lines fade out towards the edges so they never fight
   the content. Redrawn on resize and when the theme changes. */
(function () {
  'use strict';

  var canvases = document.querySelectorAll('canvas[data-isotherm]');
  if (!canvases.length) return;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function makeNoise(seed, size) {
    var rand = mulberry32(seed), g = new Float32Array(size * size);
    for (var i = 0; i < g.length; i++) g[i] = rand();
    function n(x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      var x0 = ((xi % size) + size) % size, y0 = ((yi % size) + size) % size, x1 = (x0 + 1) % size, y1 = (y0 + 1) % size;
      var a = g[y0 * size + x0], b = g[y0 * size + x1], c = g[y1 * size + x0], d = g[y1 * size + x1];
      var top = a + (b - a) * fx, bot = c + (d - c) * fx;
      return top + (bot - top) * fy;
    }
    return function (x, y) { return 0.57 * n(x, y) + 0.29 * n(x * 2.1 + 7, y * 2.1 + 3) + 0.14 * n(x * 4.3 + 11, y * 4.3 + 5); };
  }

  function accentRGB() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    var m = /^#([0-9a-f]{6})$/i.exec(v);
    if (!m) return [255, 143, 63];
    var h = parseInt(m[1], 16);
    return [h >> 16 & 255, h >> 8 & 255, h & 255];
  }

  function draw(canvas) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = canvas.getBoundingClientRect();
    var cw = Math.max(1, Math.round(r.width * dpr)), ch = Math.max(1, Math.round(r.height * dpr));
    if (cw < 4 || ch < 4) return;
    canvas.width = cw; canvas.height = ch;
    var g = canvas.getContext('2d');
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    var acc = accentRGB(), warm = canvas.getAttribute('data-isotherm') === 'warm';
    var fbm = makeNoise(warm ? 17 : 7, 64);
    var cell = 13 * dpr, nx = Math.ceil(cw / cell) + 1, ny = Math.ceil(ch / cell) + 1, i, j;
    var F = new Float32Array(nx * ny);
    var sx = 1 / (190 * dpr), sy = 1 / (190 * dpr);
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      var x = i * cell, y = j * cell;
      var blob = Math.exp(-(Math.pow((x - cw * (warm ? 0.8 : 0.22)) / (cw * 0.45), 2) + Math.pow((y - ch * (warm ? 0.9 : 0.35)) / (ch * 0.7), 2)));
      F[j * nx + i] = fbm(x * sx + 2.3, y * sy + 1.7) * 0.85 + blob * 0.5;
    }
    g.lineWidth = Math.max(1, 0.8 * dpr);
    g.lineCap = 'round';
    var levels = 12;
    for (var k = 0; k < levels; k++) {
      var lv = 0.16 + k * 0.07, major = k % 3 === 0;
      var a = light ? (major ? 0.22 : 0.09) : (major ? 0.2 : 0.075);
      g.strokeStyle = major ? 'rgba(' + acc[0] + ',' + acc[1] + ',' + acc[2] + ',' + a + ')' : (light ? 'rgba(40,25,10,' + a + ')' : 'rgba(255,246,236,' + a + ')');
      g.beginPath();
      for (j = 0; j < ny - 1; j++) for (i = 0; i < nx - 1; i++) {
        var A = F[j * nx + i], B = F[j * nx + i + 1], D = F[(j + 1) * nx + i + 1], E = F[(j + 1) * nx + i];
        var code = (A > lv ? 8 : 0) | (B > lv ? 4 : 0) | (D > lv ? 2 : 0) | (E > lv ? 1 : 0);
        if (code === 0 || code === 15) continue;
        var x0 = i * cell, y0 = j * cell;
        var top = [x0 + cell * (lv - A) / ((B - A) || 1e-6), y0], right = [x0 + cell, y0 + cell * (lv - B) / ((D - B) || 1e-6)];
        var bot = [x0 + cell * (lv - E) / ((D - E) || 1e-6), y0 + cell], left = [x0, y0 + cell * (lv - A) / ((E - A) || 1e-6)];
        var segs = { 1: [left, bot], 2: [bot, right], 3: [left, right], 4: [top, right], 5: [top, right, left, bot], 6: [top, bot], 7: [top, left], 8: [top, left], 9: [top, bot], 10: [top, left, right, bot], 11: [top, right], 12: [left, right], 13: [bot, right], 14: [left, bot] }[code];
        for (var s2 = 0; s2 < segs.length; s2 += 2) { g.moveTo(segs[s2][0], segs[s2][1]); g.lineTo(segs[s2 + 1][0], segs[s2 + 1][1]); }
      }
      g.stroke();
    }
    // Fade towards the edges and the middle of the hero, where the copy sits.
    g.globalCompositeOperation = 'destination-out';
    var vg = g.createRadialGradient(cw * (warm ? 0.8 : 0.2), ch * (warm ? 0.9 : 0.3), Math.min(cw, ch) * 0.1, cw * (warm ? 0.8 : 0.2), ch * (warm ? 0.9 : 0.3), Math.max(cw, ch) * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(0.5, 'rgba(0,0,0,0.35)'); vg.addColorStop(1, 'rgba(0,0,0,0.95)');
    g.fillStyle = vg; g.fillRect(0, 0, cw, ch);
    g.globalCompositeOperation = 'source-over';
  }

  var pending = 0;
  function drawAll() {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(function () { canvases.forEach(draw); });
  }
  if ('ResizeObserver' in window) {
    var ro = new ResizeObserver(drawAll);
    canvases.forEach(function (c) { ro.observe(c); });
  } else window.addEventListener('resize', drawAll);
  new MutationObserver(drawAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  drawAll();
})();
