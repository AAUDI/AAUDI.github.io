/* Hero viewfinder: a toy uncooled-LWIR camera and its image pipeline.

   A temperature scene (sky, tree line, field, road, a deer, a person and a
   car) is rendered at 160x120, passed through a simulated microbolometer
   (per-pixel gain/offset, column stripes, dead pixels, shading, temporal
   noise), then through the stages the visitor can toggle:

     01 NUC      remove the fixed-pattern noise with the calibration maps
     02 Denoise  motion-adaptive temporal IIR filter
     03 AGC      percentile contrast stretch (off = fixed -40..120 °C range)
     04 Palette  Ironbow false colour (off = white-hot greyscale)
     05 Detect   boxes around the warm targets

   Nothing here touches a real camera. */
(function () {
  'use strict';

  var canvas = document.getElementById('thermalCanvas');
  var screen = document.getElementById('vfScreen');
  if (!canvas || !screen || !canvas.getContext) return;

  var ctx = canvas.getContext('2d');
  var W = 160, H = 120, N = W * H;
  var FPS = 30;

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var ui = {
    timecode: document.getElementById('vfTimecode'),
    spot: document.getElementById('vfSpot'),
    min: document.getElementById('vfMin'),
    max: document.getElementById('vfMax'),
    proc: document.getElementById('vfProc'),
    status: document.getElementById('vfStatus'),
    replay: document.getElementById('vfReplay'),
    stages: document.querySelectorAll('.vf-controls .stage[data-stage]')
  };

  // ---------- Helpers ----------

  // Seeded PRNG so the scene and sensor defects are the same on every visit.
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var rand = mulberry32(20170718);

  function gauss() {
    var u = 1 - rand(), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function makeValueNoise(gw, gh) {
    var g = new Float32Array((gw + 1) * (gh + 1));
    for (var i = 0; i < g.length; i++) g[i] = rand();
    return function (x, y) {
      x = clamp(x, 0, gw - 0.0001); y = clamp(y, 0, gh - 0.0001);
      var x0 = Math.floor(x), y0 = Math.floor(y);
      var fx = x - x0, fy = y - y0;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      var i = y0 * (gw + 1) + x0;
      var a = g[i], b = g[i + 1], c = g[i + gw + 1], d = g[i + gw + 2];
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
  }

  var nCoarse = makeValueNoise(8, 6);
  var nMid = makeValueNoise(24, 18);
  var nFine = makeValueNoise(56, 42);

  function fbm(x, y) {
    var u = x / W, v = y / H;
    return 0.55 * nCoarse(u * 8, v * 6) + 0.3 * nMid(u * 24, v * 18) + 0.15 * nFine(u * 56, v * 42) - 0.5;
  }

  // ---------- Palettes (packed RGBA for a Uint32 view, little-endian) ----------

  function packRGB(r, g, b) { return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; }

  var IRONBOW_STOPS = [
    [0.00, 0, 0, 10], [0.12, 40, 0, 95], [0.30, 140, 0, 150], [0.45, 200, 30, 120],
    [0.60, 235, 90, 40], [0.75, 250, 150, 0], [0.90, 255, 215, 60], [1.00, 255, 255, 240]
  ];
  var ironbow = new Uint32Array(256);
  var greyscale = new Uint32Array(256);
  (function buildLuts() {
    for (var i = 0; i < 256; i++) {
      var u = i / 255, k = 0;
      while (k < IRONBOW_STOPS.length - 2 && u > IRONBOW_STOPS[k + 1][0]) k++;
      var a = IRONBOW_STOPS[k], b = IRONBOW_STOPS[k + 1];
      var f = (u - a[0]) / (b[0] - a[0]);
      ironbow[i] = packRGB(
        Math.round(a[1] + (b[1] - a[1]) * f),
        Math.round(a[2] + (b[2] - a[2]) * f),
        Math.round(a[3] + (b[3] - a[3]) * f)
      );
      greyscale[i] = packRGB(i, i, i);
    }
  })();

  // ---------- Static background temperature field (°C) ----------

  var HORIZON = 50;
  var ROAD_TOP = 87, ROAD_BOT = 100;
  var bg = new Float32Array(N);

  (function buildBackground() {
    var treeTop = new Float32Array(W);
    for (var x = 0; x < W; x++) {
      var n = nMid(x / W * 24, 2.5);
      treeTop[x] = n < 0.36 ? HORIZON - 1 - 2 * n : HORIZON - 3 - 15 * Math.pow(n, 1.6);
    }

    for (var y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var t, f = fbm(x, y);
        if (y < treeTop[x]) {
          var cloud = Math.max(0, nCoarse(x / W * 8, y / H * 6) - 0.45) * 2.2;
          t = -30 + 14 * (y / HORIZON) + 9 * cloud + 0.8 * f;
        } else if (y < HORIZON + 2) {
          t = 1.5 + 4 * f + (y - treeTop[x]) * 0.1;
        } else {
          var depth = (y - HORIZON) / (H - HORIZON);
          t = 2 + 9 * depth + 3 * f;
        }
        if (y >= ROAD_TOP && y < ROAD_BOT) {
          t = 13 + 1.4 * f;
          if ((y === 93) && (x % 16) < 8) t = 10;
        }
        bg[y * W + x] = t;
      }
    }

    // A farm building on the horizon: cold roof, lit window.
    fillRect(bg, 10, 33, 34, HORIZON + 3, 6);
    fillRect(bg, 8, 29, 36, 33, -6);
    fillRect(bg, 15, 38, 21, 44, 24);
    fillRect(bg, 26, 41, 30, HORIZON + 3, 11);

    // Sun-warmed rocks in the field.
    for (var r = 0; r < 6; r++) {
      var rx = 50 + rand() * 105, ry = 58 + rand() * 24, rr = 1.2 + rand() * 1.8;
      drawEllipse(bg, { cx: rx, cy: ry, rx: rr * 1.4, ry: rr, rot: 0, T: 9 + rand() * 3 });
    }
  })();

  function fillRect(T, x0, y0, x1, y1, temp) {
    for (var y = Math.max(0, y0); y < Math.min(H, y1); y++)
      for (var x = Math.max(0, x0); x < Math.min(W, x1); x++) T[y * W + x] = temp;
  }

  // Soft-edged rasterisers so moving targets don't shimmer.
  function drawEllipse(T, s) {
    var c = Math.cos(s.rot || 0), si = Math.sin(s.rot || 0);
    var r = Math.max(s.rx, s.ry) + 1;
    var x0 = Math.max(0, Math.floor(s.cx - r)), x1 = Math.min(W - 1, Math.ceil(s.cx + r));
    var y0 = Math.max(0, Math.floor(s.cy - r)), y1 = Math.min(H - 1, Math.ceil(s.cy + r));
    var minR = Math.min(s.rx, s.ry), irx2 = 1 / (s.rx * s.rx), iry2 = 1 / (s.ry * s.ry);
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var dx = x + 0.5 - s.cx, dy = y + 0.5 - s.cy;
        var lx = dx * c + dy * si, ly = -dx * si + dy * c;
        var d = Math.sqrt(lx * lx * irx2 + ly * ly * iry2);
        var cov = (1 - d) * minR + 0.5;
        if (cov <= 0) continue;
        if (cov > 1) cov = 1;
        var i = y * W + x;
        T[i] += (s.T - T[i]) * cov;
      }
    }
  }

  function drawBox(T, s) {
    var x0 = Math.max(0, Math.floor(s.x0)), x1 = Math.min(W - 1, Math.ceil(s.x1));
    var y0 = Math.max(0, Math.floor(s.y0)), y1 = Math.min(H - 1, Math.ceil(s.y1));
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var px = x + 0.5, py = y + 0.5;
        var cov = Math.min(px - s.x0, s.x1 - px, py - s.y0, s.y1 - py) + 0.5;
        if (cov <= 0) continue;
        if (cov > 1) cov = 1;
        var i = y * W + x;
        T[i] += (s.T - T[i]) * cov;
      }
    }
  }

  // ---------- Moving targets ----------

  function wrap(v, lo, hi) { var span = hi - lo; return lo + ((((v - lo) % span) + span) % span); }

  function deer(t) {
    var x = wrap(34 + 4.5 * t, -24, 184), y = 64, ph = t * 5.2;
    var shapes = [];
    var legs = [-6, -4.2, 4, 5.8];
    for (var k = 0; k < 4; k++) {
      var sw = Math.sin(ph + (k % 2 ? Math.PI : 0) + (k > 1 ? 0.6 : 0)) * 0.35;
      shapes.push({ cx: x + legs[k], cy: y + 6.5, rx: 0.9, ry: 4.4, rot: sw, T: 28.5 });
    }
    shapes.push({ cx: x, cy: y, rx: 8.2, ry: 4.1, rot: 0, T: 30.5 });
    shapes.push({ cx: x + 7.4, cy: y - 4.2, rx: 1.9, ry: 4.3, rot: -0.55, T: 31.5 });
    shapes.push({ cx: x + 9.6, cy: y - 8 + Math.sin(ph * 2) * 0.3, rx: 2.7, ry: 1.9, rot: 0.25, T: 34 });
    shapes.push({ cx: x + 8.4, cy: y - 10.4, rx: 0.7, ry: 1.4, rot: -0.3, T: 32 });
    shapes.push({ cx: x - 8.2, cy: y - 1.6, rx: 1.2, ry: 0.9, rot: 0, T: 29 });
    return { label: 'deer', id: 2, conf: 0.94, shapes: shapes, box: [x - 9.5, y - 12, x + 12.5, y + 11] };
  }

  function person(t) {
    var x = wrap(132 - 7 * t, -16, 186), feet = 85, ph = t * 7.5;
    var sw = Math.sin(ph) * 0.38;
    var shapes = [
      { cx: x - 0.7, cy: feet - 5, rx: 1.3, ry: 5.2, rot: sw, T: 28.5 },
      { cx: x + 0.7, cy: feet - 5, rx: 1.3, ry: 5.2, rot: -sw, T: 28.5 },
      { cx: x + Math.sin(ph) * 1.4, cy: feet - 14, rx: 1.1, ry: 4.4, rot: -sw * 0.8, T: 30.5 },
      { cx: x, cy: feet - 14.5, rx: 3.1, ry: 6, rot: 0, T: 29 },
      { cx: x - Math.sin(ph) * 1.4, cy: feet - 14, rx: 1.1, ry: 4.4, rot: sw * 0.8, T: 31 },
      { cx: x, cy: feet - 21.5, rx: 1.4, ry: 1.2, rot: 0, T: 33 },
      { cx: x - 0.3, cy: feet - 23.6, rx: 2.3, ry: 2.8, rot: 0, T: 34.5 }
    ];
    return { label: 'person', id: 1, conf: 0.91, shapes: shapes, box: [x - 4.5, feet - 27.5, x + 4.5, feet + 0.5] };
  }

  function car(t) {
    var phase = wrap(t + 3, 0, 15);
    var x = -44 + 27 * phase;
    if (x > W + 8) return null;
    var base = 99;
    return {
      label: 'car', id: 3, conf: 0.97, kind: 'car', x: x, base: base,
      box: [x - 7, base - 16, x + 31, base + 3]
    };
  }

  function drawCar(T, c) {
    var x = c.x, b = c.base;
    drawEllipse(T, { cx: x - 4.5, cy: b - 2.2, rx: 4.2, ry: 1.4, rot: 0, T: 22 });
    drawBox(T, { x0: x, y0: b - 9, x1: x + 30, y1: b - 1, T: 9 });
    drawBox(T, { x0: x + 7, y0: b - 15, x1: x + 21, y1: b - 9, T: 8 });
    drawBox(T, { x0: x + 9, y0: b - 14, x1: x + 19, y1: b - 10, T: -8 });
    drawBox(T, { x0: x + 22, y0: b - 9, x1: x + 30, y1: b - 4, T: 44 });
    drawEllipse(T, { cx: x + 6.5, cy: b - 1, rx: 3, ry: 3, rot: 0, T: 37 });
    drawEllipse(T, { cx: x + 24, cy: b - 1, rx: 3, ry: 3, rot: 0, T: 39 });
    drawEllipse(T, { cx: x - 0.5, cy: b - 2.4, rx: 1.4, ry: 0.9, rot: 0, T: 72 });
  }

  // ---------- Sensor model ----------

  var gainMap = new Float32Array(N);
  var offMap = new Float32Array(N);
  (function buildSensorDefects() {
    var col = new Float32Array(W);
    for (var x = 0; x < W; x++) col[x] = 2.2 * gauss();
    for (var y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var i = y * W + x;
        var nx = (x - W / 2) / (W / 2), ny = (y - H / 2) / (H / 2);
        gainMap[i] = 1 + 0.05 * gauss();
        offMap[i] = 1.3 * gauss() + col[x] + 6 * (nx * nx + ny * ny) - 3;
      }
    }
    for (var d = 0; d < 9; d++) offMap[(Math.floor(rand() * N))] += 45 + rand() * 30;
  })();

  // Gaussian table for cheap temporal noise.
  var NOISE_LEN = 1 << 16;
  var noiseTable = new Float32Array(NOISE_LEN);
  for (var ni = 0; ni < NOISE_LEN; ni++) noiseTable[ni] = gauss();
  var NOISE_SIGMA = 1.15;

  // ---------- Pipeline state ----------

  var stages = { nuc: true, denoise: true, agc: true, palette: true, detect: true };
  var scene = new Float32Array(N);
  var tmp = new Float32Array(N);
  var proc = new Float32Array(N);
  var prev = new Float32Array(N);
  var prevValid = false;
  var HIST_MIN = -60, HIST_BINS = 800, HIST_SCALE = 4;
  var hist = new Uint32Array(HIST_BINS);
  var clipped = new Float32Array(HIST_BINS);
  var binMap = new Float32Array(HIST_BINS);
  var agcLo = 0, agcHi = 30, agcValid = false;

  var small = document.createElement('canvas');
  small.width = W; small.height = H;
  var sctx = small.getContext('2d');
  var img = sctx.createImageData(W, H);
  var pix = new Uint32Array(img.data.buffer);

  var spot = { x: 108, y: 60 };
  var targets = [];
  var readout = { spot: 0, min: 0, max: 0 };
  var procMs = 0;

  function blur121(src, dst) {
    var x, y, i;
    for (y = 0; y < H; y++) {
      var row = y * W;
      dst[row] = (3 * src[row] + src[row + 1]) * 0.25;
      for (x = 1; x < W - 1; x++) {
        i = row + x;
        dst[i] = (src[i - 1] + 2 * src[i] + src[i + 1]) * 0.25;
      }
      dst[row + W - 1] = (src[row + W - 2] + 3 * src[row + W - 1]) * 0.25;
    }
    for (x = 0; x < W; x++) {
      src[x] = (3 * dst[x] + dst[x + W]) * 0.25;
      for (y = 1; y < H - 1; y++) {
        i = y * W + x;
        src[i] = (dst[i - W] + 2 * dst[i] + dst[i + W]) * 0.25;
      }
      i = (H - 1) * W + x;
      src[i] = (dst[i - W] + 3 * dst[i]) * 0.25;
    }
  }

  function buildScene(t) {
    scene.set(bg);
    targets = [];
    var d = deer(t), p = person(t), c = car(t);
    d.shapes.forEach(function (s) { drawEllipse(scene, s); });
    targets.push(d);
    if (c) { drawCar(scene, c); targets.push(c); }
    p.shapes.forEach(function (s) { drawEllipse(scene, s); });
    targets.push(p);
    blur121(scene, tmp);
  }

  function processFrame(t) {
    var t0 = performance.now();
    buildScene(t);

    var noiseOff = (Math.random() * NOISE_LEN) | 0;
    var i, v, raw;
    var vmin = Infinity, vmax = -Infinity;
    hist.fill(0);

    for (i = 0; i < N; i++) {
      raw = scene[i] * gainMap[i] + offMap[i] + NOISE_SIGMA * noiseTable[(noiseOff + i) & (NOISE_LEN - 1)];
      v = stages.nuc ? (raw - offMap[i]) / gainMap[i] : raw;

      if (stages.denoise && prevValid) {
        var diff = v - prev[i];
        var k = (diff > 4 || diff < -4) ? 0.85 : 0.28;
        v = prev[i] + k * diff;
      }
      prev[i] = v;
      proc[i] = v;

      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
      var b = ((v - HIST_MIN) * HIST_SCALE) | 0;
      hist[b < 0 ? 0 : b >= HIST_BINS ? HIST_BINS - 1 : b]++;
    }
    prevValid = true;

    var lut = stages.palette ? ironbow : greyscale;
    var idx;

    if (stages.agc) {
      // Blend of a percentile stretch and plateau histogram equalisation,
      // the usual trick for scenes where a cold sky would eat the range.
      var pLo = percentile(0.01), pHi = percentile(0.995);
      if (pHi - pLo < 8) { var mid = (pHi + pLo) / 2; pLo = mid - 4; pHi = mid + 4; }
      var fresh = !agcValid;
      if (fresh) { agcLo = pLo; agcHi = pHi; agcValid = true; }
      agcLo += (pLo - agcLo) * 0.15;
      agcHi += (pHi - agcHi) * 0.15;

      var plateau = N * 0.006, total = 0, b2;
      for (b2 = 0; b2 < HIST_BINS; b2++) { clipped[b2] = Math.min(hist[b2], plateau); total += clipped[b2]; }
      var run = 0, span = agcHi - agcLo;
      for (b2 = 0; b2 < HIST_BINS; b2++) {
        run += clipped[b2];
        var eq = (run - clipped[b2] * 0.5) / total;
        var lin = clamp((HIST_MIN + (b2 + 0.5) / HIST_SCALE - agcLo) / span, 0, 1);
        var target = Math.pow(0.7 * lin + 0.3 * eq, 1.35);
        binMap[b2] = fresh ? target : binMap[b2] + (target - binMap[b2]) * 0.2;
      }

      for (i = 0; i < N; i++) {
        var fb = (proc[i] - HIST_MIN) * HIST_SCALE - 0.5;
        var bi = fb | 0;
        if (bi < 0) { bi = 0; fb = 0; }
        else if (bi >= HIST_BINS - 1) { bi = HIST_BINS - 2; fb = bi + 1; }
        var m = binMap[bi] + (binMap[bi + 1] - binMap[bi]) * (fb - bi);
        idx = (m * 255) | 0;
        pix[i] = lut[idx < 0 ? 0 : idx > 255 ? 255 : idx];
      }
    } else {
      agcValid = false;
      var lo = -40, scale = 255 / 160;
      for (i = 0; i < N; i++) {
        idx = ((proc[i] - lo) * scale) | 0;
        pix[i] = lut[idx < 0 ? 0 : idx > 255 ? 255 : idx];
      }
    }
    sctx.putImageData(img, 0, 0);

    readout.spot = spotTemp();
    readout.min = vmin;
    readout.max = vmax;

    var dt = performance.now() - t0;
    procMs = procMs ? procMs * 0.9 + dt * 0.1 : dt;
  }

  function percentile(q) {
    var target = q * N, acc = 0;
    for (var b = 0; b < HIST_BINS; b++) {
      acc += hist[b];
      if (acc >= target) return HIST_MIN + (b + 0.5) / HIST_SCALE;
    }
    return HIST_MIN + HIST_BINS / HIST_SCALE;
  }

  function spotTemp() {
    var cx = Math.round(spot.x), cy = Math.round(spot.y), sum = 0, n = 0;
    for (var y = cy - 1; y <= cy + 1; y++)
      for (var x = cx - 1; x <= cx + 1; x++)
        if (x >= 0 && x < W && y >= 0 && y < H) { sum += proc[y * W + x]; n++; }
    return n ? sum / n : 0;
  }

  // ---------- Drawing ----------

  var dpr = 1;
  var HUD = '#6ff3d6';

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = screen.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    draw();
  }

  function draw() {
    var cw = canvas.width, ch = canvas.height;
    var sx = cw / W, sy = ch / H;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, cw, ch);

    if (stages.detect) drawDetections(sx, sy);
    drawSpot(sx, sy);
  }

  function drawDetections(sx, sy) {
    var lw = Math.max(1.5, 1.6 * dpr);
    ctx.lineWidth = lw;
    ctx.font = '500 ' + Math.round(10.5 * dpr) + 'px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';

    targets.forEach(function (tg) {
      var b = tg.box;
      var vis = Math.min(b[2], W) - Math.max(b[0], 0);
      if (vis < (b[2] - b[0]) * 0.55) return;

      var x0 = Math.max(b[0], 0.5) * sx, y0 = b[1] * sy;
      var x1 = Math.min(b[2], W - 0.5) * sx, y1 = b[3] * sy;
      var w = x1 - x0, h = y1 - y0;
      var c = Math.min(w, h) * 0.28;

      ctx.strokeStyle = HUD;
      ctx.beginPath();
      ctx.moveTo(x0, y0 + c); ctx.lineTo(x0, y0); ctx.lineTo(x0 + c, y0);
      ctx.moveTo(x1 - c, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + c);
      ctx.moveTo(x1, y1 - c); ctx.lineTo(x1, y1); ctx.lineTo(x1 - c, y1);
      ctx.moveTo(x0 + c, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - c);
      ctx.stroke();

      ctx.globalAlpha = 0.18;
      ctx.strokeRect(x0, y0, w, h);
      ctx.globalAlpha = 1;

      var conf = (tg.conf + Math.sin(frameNo * 0.21 + tg.id) * 0.012).toFixed(2);
      var text = tg.label.toUpperCase() + ' ' + conf + ' #' + tg.id;
      var tw = ctx.measureText(text).width;
      var pad = 4 * dpr, th = 15 * dpr;
      var ly = y0 - th - 2 * dpr;
      if (ly < 2 * dpr) ly = y1 + 2 * dpr;
      ctx.fillStyle = 'rgba(5, 12, 10, 0.78)';
      ctx.fillRect(x0, ly, tw + pad * 2, th);
      ctx.fillStyle = HUD;
      ctx.fillText(text, x0 + pad, ly + th / 2 + 0.5);
    });
  }

  function drawSpot(sx, sy) {
    var x = (spot.x + 0.5) * sx, y = (spot.y + 0.5) * sy;
    var r = 7 * dpr, g = 5 * dpr;
    ctx.lineWidth = Math.max(1.5, 1.5 * dpr);

    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 3.5 * dpr;
    spotPath(x, y, r, g);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 * dpr;
    spotPath(x, y, r, g);
    ctx.stroke();

    var label = readout.spot.toFixed(1) + '°';
    ctx.font = '500 ' + Math.round(12 * dpr) + 'px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    var tx = x + r + g + 4 * dpr;
    if (tx + ctx.measureText(label).width > canvas.width - 8 * dpr) tx = x - r - g - 4 * dpr - ctx.measureText(label).width;
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(label, tx, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, tx, y);
  }

  function spotPath(x, y, r, g) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.moveTo(x - r - g, y); ctx.lineTo(x - r + 2 * dpr, y);
    ctx.moveTo(x + r - 2 * dpr, y); ctx.lineTo(x + r + g, y);
    ctx.moveTo(x, y - r - g); ctx.lineTo(x, y - r + 2 * dpr);
    ctx.moveTo(x, y + r - 2 * dpr); ctx.lineTo(x, y + r + g);
  }

  // ---------- Readouts ----------

  var frameNo = 0;
  var lastReadout = 0;

  function fmt(v) { return (v < 0 ? '−' : '') + Math.abs(v).toFixed(1); }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function updateReadouts(now, force) {
    if (!force && now - lastReadout < 250) return;
    lastReadout = now;
    var f = frameNo % FPS, s = Math.floor(frameNo / FPS);
    if (ui.timecode) ui.timecode.textContent = pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor(s / 60) % 60) + ':' + pad2(s % 60) + ':' + pad2(f);
    if (ui.spot) ui.spot.textContent = fmt(readout.spot);
    if (ui.min) ui.min.textContent = fmt(readout.min);
    if (ui.max) ui.max.textContent = fmt(readout.max);
    if (ui.proc) ui.proc.textContent = procMs.toFixed(1);
  }

  // ---------- Stage buttons and the boot sequence ----------

  var MESSAGES = {
    raw: 'Raw sensor · column stripes, dead pixels, a flat 14-bit range',
    nuc: ['01 NUC on · per-pixel gain and offset calibrated out', '01 NUC off · stripes, shading and dead pixels are back'],
    denoise: ['02 Denoise on · motion-adaptive temporal filter', '02 Denoise off · temporal noise is back'],
    agc: ['03 AGC on · contrast stretched to this scene', '03 AGC off · fixed −40…120 °C range, the scene goes flat'],
    palette: ['04 Palette on · Ironbow false colour', '04 Palette off · white-hot greyscale'],
    detect: ['05 Detect on · warm targets boxed and labelled', '05 Detect off'],
    ready: 'Ready · switch a stage off to see what it fixes'
  };
  var ORDER = ['nuc', 'denoise', 'agc', 'palette', 'detect'];

  function setStatus(text) { if (ui.status) ui.status.textContent = text; }

  function setStage(name, on) {
    if (name === 'nuc' && stages.nuc !== on) prevValid = false;
    stages[name] = on;
    ui.stages.forEach(function (b) {
      if (b.getAttribute('data-stage') === name) b.setAttribute('aria-pressed', String(on));
    });
  }

  var bootTimers = [];
  function cancelBoot() {
    bootTimers.forEach(clearTimeout);
    bootTimers = [];
  }

  function boot() {
    cancelBoot();
    if (reduceMotion) {
      ORDER.forEach(function (n) { setStage(n, true); });
      setStatus(MESSAGES.ready);
      renderOnce();
      return;
    }
    ORDER.forEach(function (n) { setStage(n, false); });
    setStatus(MESSAGES.raw);
    ORDER.forEach(function (n, k) {
      bootTimers.push(setTimeout(function () {
        setStage(n, true);
        setStatus(MESSAGES[n][0]);
      }, 1500 + k * 1150));
    });
    bootTimers.push(setTimeout(function () { setStatus(MESSAGES.ready); }, 1500 + ORDER.length * 1150 + 900));
  }

  ui.stages.forEach(function (b) {
    b.addEventListener('click', function () {
      cancelBoot();
      var name = b.getAttribute('data-stage');
      var on = !stages[name];
      setStage(name, on);
      setStatus(MESSAGES[name][on ? 0 : 1]);
      if (reduceMotion) renderOnce();
    });
  });

  if (ui.replay) ui.replay.addEventListener('click', boot);

  // ---------- Spot meter: drag, tap, arrow keys ----------

  var dragging = false;

  function setSpotFromEvent(e) {
    var r = screen.getBoundingClientRect();
    spot.x = clamp((e.clientX - r.left) / r.width * W - 0.5, 1, W - 2);
    spot.y = clamp((e.clientY - r.top) / r.height * H - 0.5, 1, H - 2);
    if (reduceMotion || !running) renderOnce();
  }

  screen.addEventListener('pointerdown', function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    try { screen.setPointerCapture(e.pointerId); } catch (err) {}
    setSpotFromEvent(e);
  });
  screen.addEventListener('pointermove', function (e) { if (dragging) setSpotFromEvent(e); });
  function endDrag() { dragging = false; }
  screen.addEventListener('pointerup', endDrag);
  screen.addEventListener('pointercancel', endDrag);

  screen.addEventListener('keydown', function (e) {
    var step = e.shiftKey ? 10 : 3, moved = true;
    if (e.key === 'ArrowLeft') spot.x -= step;
    else if (e.key === 'ArrowRight') spot.x += step;
    else if (e.key === 'ArrowUp') spot.y -= step;
    else if (e.key === 'ArrowDown') spot.y += step;
    else moved = false;
    if (!moved) return;
    e.preventDefault();
    spot.x = clamp(spot.x, 1, W - 2);
    spot.y = clamp(spot.y, 1, H - 2);
    if (reduceMotion || !running) renderOnce();
  });

  // ---------- Main loop ----------

  var running = false;
  var visible = true;
  var rafId = 0;
  var simT = 0;
  var lastTick = 0;
  var acc = 0;
  var FRAME_MS = 1000 / FPS;
  var FROZEN_T = 2.4;

  function renderOnce() {
    processFrame(reduceMotion ? FROZEN_T : simT);
    draw();
    updateReadouts(performance.now(), true);
  }

  function tick(now) {
    rafId = requestAnimationFrame(tick);
    if (!lastTick) lastTick = now;
    acc += Math.min(now - lastTick, 250);
    lastTick = now;
    if (acc < FRAME_MS - 0.5) return;
    acc = acc % FRAME_MS;
    simT += 1 / FPS;
    frameNo++;
    processFrame(simT);
    draw();
    updateReadouts(now, false);
  }

  function start() {
    if (running || reduceMotion) return;
    running = true;
    lastTick = 0;
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  function syncRunning() {
    if (visible && !document.hidden) start();
    else stop();
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      syncRunning();
    }, { threshold: 0.05 }).observe(screen);
  }
  document.addEventListener('visibilitychange', syncRunning);

  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(screen);
  else window.addEventListener('resize', resize);

  // Redraw labels once the web font arrives so canvas text uses it.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { draw(); });

  resize();
  renderOnce();
  boot();
  syncRunning();
})();
