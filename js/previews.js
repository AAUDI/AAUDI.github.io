/* Project-card previews. Each one is computed in the browser, not a video:

   stack  Eight short, noisy exposures of an aerial scene, shaken like a drone
          camera. Averaging them as-is blurs; aligning them with the known
          (IMU) motion first, then averaging, gives a sharp, cleaner image.
   tomo   Parallel-beam CT of a Shepp-Logan phantom: analytic projections,
          Ram-Lak filtering, and back-projection added angle by angle.

   Previews play once when they scroll into view, hold their last frame, and
   have a Replay button. With reduced motion they show the last frame only. */
(function () {
  'use strict';

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var HUD = '#6ff3d6';
  var ACCENT = '#ff8f3f';
  var MONO = '"IBM Plex Mono", ui-monospace, monospace';

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function ease(x) { x = clamp(x, 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // Caption chip in the bottom-left corner, kept clear of the Replay button.
  // Takes [long, short] and uses the short form on narrow cards.
  function caption(ctx, cw, ch, dpr, texts) {
    ctx.font = '500 ' + Math.round(11 * dpr) + 'px ' + MONO;
    ctx.textBaseline = 'middle';
    var pad = 8 * dpr, h = 24 * dpr, maxW = cw - 120 * dpr;
    var text = ctx.measureText(texts[0]).width + pad * 2 <= maxW ? texts[0] : texts[1];
    while (text.length > 4 && ctx.measureText(text).width + pad * 2 > maxW) text = text.slice(0, -2) + '…';
    var w = ctx.measureText(text).width + pad * 2;
    var x = 12 * dpr, y = ch - 12 * dpr - h;
    ctx.fillStyle = 'rgba(7, 6, 5, 0.78)';
    roundRect(ctx, x, y, w, h, 6 * dpr);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 246, 236, 0.92)';
    ctx.fillText(text, x + pad, y + h / 2 + 0.5);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ======================================================================
  // 01 · Stack
  // ======================================================================

  var stackSpec = {
    duration: 10,
    init: function (p) {
      var rand = mulberry32(1646);
      var SW = 400, SH = 250, M = 28, K = 8;
      var scene = buildAerial(SW + 2 * M, SH + 2 * M, rand);

      function gauss() {
        var u = 1 - rand(), v = rand();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      }

      var motions = [];
      for (var k = 0; k < K; k++) {
        motions.push({
          dx: 10 * Math.sin(k * 0.95 + 0.4) + 2.5 * gauss(),
          dy: 7 * Math.cos(k * 1.3 + 0.2) + 2 * gauss(),
          rot: 0.028 * Math.sin(k * 1.1 + 1.0)
        });
      }

      var n = SW * SH;
      var subs = [], subCanvases = [], naive = [], aligned = [];
      var sumNaive = new Float32Array(n), sumAl = new Float32Array(n), wAl = new Float32Array(n);
      var work = makeCanvas(SW, SH), wg = work.getContext('2d', { willReadFrequently: true });

      for (k = 0; k < K; k++) {
        var m = motions[k];
        // Shaken short exposure: sharp but noisy.
        wg.setTransform(1, 0, 0, 1, 0, 0);
        wg.clearRect(0, 0, SW, SH);
        wg.translate(SW / 2 + m.dx, SH / 2 + m.dy);
        wg.rotate(m.rot);
        wg.drawImage(scene, -(SW / 2 + M), -(SH / 2 + M));
        var d = wg.getImageData(0, 0, SW, SH);
        var sub = new Float32Array(n);
        for (var i = 0; i < n; i++) sub[i] = d.data[i * 4] + 46 * gauss();
        subs.push(sub);
        var sc = toCanvas(sub, null, SW, SH);
        subCanvases.push(sc);

        for (i = 0; i < n; i++) sumNaive[i] += sub[i];
        naive.push(toCanvas(sumNaive, k + 1, SW, SH));

        // Undo the known motion, then accumulate with a coverage weight.
        wg.setTransform(1, 0, 0, 1, 0, 0);
        wg.clearRect(0, 0, SW, SH);
        wg.translate(SW / 2, SH / 2);
        wg.rotate(-m.rot);
        wg.translate(-m.dx, -m.dy);
        wg.drawImage(sc, -SW / 2, -SH / 2);
        var a = wg.getImageData(0, 0, SW, SH).data;
        for (i = 0; i < n; i++) {
          var wgt = a[i * 4 + 3] / 255;
          sumAl[i] += a[i * 4] * wgt;
          wAl[i] += wgt;
        }
        aligned.push(toCanvas(sumAl, wAl, SW, SH));
      }

      p.data = {
        SW: SW, SH: SH, K: K, motions: motions,
        subs: subCanvases, naive: naive, aligned: aligned,
        features: scene.features.map(function (f) { return [f[0] - M, f[1] - M]; })
      };
    },
    draw: function (ctx, cw, ch, t, dpr, p) {
      var D = p.data, K = D.K;
      // Trim the alignment borders, then cover-crop to the canvas aspect.
      var srcW = D.SW * 0.93, srcH = D.SH * 0.93;
      if (cw / ch < srcW / srcH) srcW = srcH * cw / ch; else srcH = srcW * ch / cw;
      var cropX = (D.SW - srcW) / 2, cropY = (D.SH - srcH) / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#070605';
      ctx.fillRect(0, 0, cw, ch);

      function blit(c) { ctx.drawImage(c, cropX, cropY, srcW, srcH, 0, 0, cw, ch); }

      var shownK = 0, text;
      if (t < 3.2) {
        shownK = Math.min(K - 1, Math.floor(t / 0.4));
        blit(D.subs[shownK]);
        text = ['1/4 Capture · short exposure ' + (shownK + 1) + ' of ' + K, '1/4 Capture · ' + (shownK + 1) + '/' + K];
      } else if (t < 5.0) {
        shownK = Math.min(K - 1, Math.floor((t - 3.2) / 1.8 * K * 1.15));
        blit(D.naive[shownK]);
        text = ['2/4 Average as-is · the shake becomes blur', '2/4 Average as-is · blur'];
        shownK = K - 1;
      } else if (t < 7.2) {
        shownK = Math.min(K - 1, Math.floor((t - 5.0) / 2.2 * K * 1.15));
        blit(D.aligned[shownK]);
        drawFeatures(ctx, cw, ch, dpr, D, cropX, cropY, srcW, srcH, (t - 5.0) / 2.2);
        text = ['3/4 Align with the IMU, then stack · ' + (shownK + 1) + ' of ' + K, '3/4 Align + stack · ' + (shownK + 1) + '/' + K];
        shownK = K - 1;
      } else {
        var pos = 1 - 0.5 * ease((t - 7.2) / 1.1);
        compare(ctx, cw, ch, dpr, D, blit, pos);
        text = ['4/4 Same ' + K + ' exposures · averaged vs stacked', '4/4 Averaged vs stacked'];
      }

      if (t < 7.2) imuPlot(ctx, cw, ch, dpr, D.motions, t < 3.2 ? shownK : K - 1);
      caption(ctx, cw, ch, dpr, text);
    }
  };

  function toCanvas(sum, count, w, h) {
    var c = makeCanvas(w, h);
    var g = c.getContext('2d');
    var img = g.createImageData(w, h);
    var px = img.data;
    for (var i = 0, n = w * h; i < n; i++) {
      var div = count === null ? 1 : typeof count === 'number' ? count : (count[i] > 0.05 ? count[i] : 0);
      var v = div ? sum[i] / div : 0;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      px[i * 4] = v; px[i * 4 + 1] = v; px[i * 4 + 2] = v * 0.97; px[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function drawFeatures(ctx, cw, ch, dpr, D, cropX, cropY, srcW, srcH, prog) {
    var s = 7 * dpr;
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = HUD;
    var shown = Math.ceil(clamp(prog * 1.6, 0, 1) * D.features.length);
    for (var i = 0; i < shown; i++) {
      var f = D.features[i];
      var x = (f[0] - cropX) / srcW * cw, y = (f[1] - cropY) / srcH * ch;
      ctx.strokeRect(x - s / 2, y - s / 2, s, s);
    }
  }

  function compare(ctx, cw, ch, dpr, D, blit, pos) {
    var K = D.K;
    blit(D.naive[K - 1]);
    var dx = Math.round(cw * pos);
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, 0, cw - dx, ch);
    ctx.clip();
    blit(D.aligned[K - 1]);
    ctx.restore();

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(dx - dpr, 0, 2 * dpr, ch);
    ctx.beginPath();
    ctx.arc(dx, ch / 2, 9 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#070605';
    ctx.font = '600 ' + Math.round(10 * dpr) + 'px ' + MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('↔', dx, ch / 2 + 0.5);
    ctx.textAlign = 'left';

    ctx.font = '500 ' + Math.round(11 * dpr) + 'px ' + MONO;
    var y = 46 * dpr;
    label(ctx, 'AVERAGED', 12 * dpr, y, dpr, 'left');
    if (pos < 0.9) label(ctx, 'STACKED', cw - 12 * dpr, y, dpr, 'right');
  }

  function label(ctx, text, x, y, dpr, align) {
    var w = ctx.measureText(text).width + 14 * dpr, h = 20 * dpr;
    var bx = align === 'right' ? x - w : x;
    ctx.fillStyle = 'rgba(7, 6, 5, 0.78)';
    roundRect(ctx, bx, y - h / 2, w, h, 5 * dpr);
    ctx.fill();
    ctx.fillStyle = align === 'right' ? HUD : 'rgba(255, 246, 236, 0.9)';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + 7 * dpr, y + 0.5);
  }

  function imuPlot(ctx, cw, ch, dpr, motions, upto) {
    var w = 128 * dpr, h = 52 * dpr, x = cw - w - 12 * dpr, y = 12 * dpr;
    ctx.fillStyle = 'rgba(7, 6, 5, 0.78)';
    roundRect(ctx, x, y, w, h, 6 * dpr);
    ctx.fill();
    ctx.font = '500 ' + Math.round(9.5 * dpr) + 'px ' + MONO;
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255, 246, 236, 0.7)';
    ctx.fillText('IMU · x y', x + 8 * dpr, y + 6 * dpr);

    var px = x + 8 * dpr, pw = w - 16 * dpr, py = y + 30 * dpr, ph = 16 * dpr;
    ctx.strokeStyle = 'rgba(255, 246, 236, 0.18)';
    ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + pw, py); ctx.stroke();

    [['dx', ACCENT, 13], ['dy', HUD, 10]].forEach(function (s) {
      ctx.strokeStyle = s[1];
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      for (var k = 0; k <= upto; k++) {
        var xx = px + pw * k / (motions.length - 1);
        var yy = py - motions[k][s[0]] / s[2] * ph;
        if (k === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
      var last = motions[upto];
      ctx.fillStyle = s[1];
      ctx.beginPath();
      ctx.arc(px + pw * upto / (motions.length - 1), py - last[s[0]] / s[2] * ph, 2.2 * dpr, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // A small synthetic aerial view: fields, roads, buildings, trees, and a
  // Siemens star resolution target that makes blur obvious.
  function buildAerial(w, h, rand) {
    var c = makeCanvas(w, h), g = c.getContext('2d');
    var features = [];
    function grey(v) { v = Math.round(clamp(v, 0, 255)); return 'rgb(' + v + ',' + v + ',' + v + ')'; }

    g.fillStyle = grey(118);
    g.fillRect(0, 0, w, h);

    var cols = 7, rows = 5, cwid = w / cols, chei = h / rows, pts = [], i, j;
    for (j = 0; j <= rows; j++) {
      pts.push([]);
      for (i = 0; i <= cols; i++) {
        var jx = (i > 0 && i < cols) ? (rand() - 0.5) * cwid * 0.5 : 0;
        var jy = (j > 0 && j < rows) ? (rand() - 0.5) * chei * 0.5 : 0;
        pts[j].push([i * cwid + jx, j * chei + jy]);
      }
    }
    for (j = 0; j < rows; j++) {
      for (i = 0; i < cols; i++) {
        var q = [pts[j][i], pts[j][i + 1], pts[j + 1][i + 1], pts[j + 1][i]];
        var tone = 70 + rand() * 100;
        g.save();
        g.beginPath();
        g.moveTo(q[0][0], q[0][1]);
        for (var v = 1; v < 4; v++) g.lineTo(q[v][0], q[v][1]);
        g.closePath();
        g.fillStyle = grey(tone);
        g.fill();
        if (rand() < 0.6) {
          g.clip();
          var ang = rand() * Math.PI, sp = 3 + rand() * 3;
          g.strokeStyle = grey(tone - 30);
          g.lineWidth = 1.2;
          g.translate(q[0][0], q[0][1]);
          g.rotate(ang);
          g.beginPath();
          for (var s = -200; s < 200; s += sp) { g.moveTo(-200, s); g.lineTo(200, s); }
          g.stroke();
        }
        g.restore();
        g.strokeStyle = grey(52);
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(q[0][0], q[0][1]);
        for (v = 1; v < 4; v++) g.lineTo(q[v][0], q[v][1]);
        g.closePath();
        g.stroke();
      }
    }

    // Roads with dashed centre lines.
    g.lineCap = 'round';
    var roads = [
      [[0, h * 0.66], [w * 0.35, h * 0.5], [w * 0.65, h * 0.72], [w, h * 0.4]],
      [[w * 0.28, 0], [w * 0.36, h * 0.4], [w * 0.22, h * 0.7], [w * 0.4, h]]
    ];
    roads.forEach(function (r) {
      g.beginPath();
      g.moveTo(r[0][0], r[0][1]);
      g.bezierCurveTo(r[1][0], r[1][1], r[2][0], r[2][1], r[3][0], r[3][1]);
      g.strokeStyle = grey(40); g.lineWidth = 13; g.stroke();
      g.strokeStyle = grey(196); g.lineWidth = 10; g.stroke();
      g.setLineDash([7, 7]); g.strokeStyle = grey(250); g.lineWidth = 1.3; g.stroke();
      g.setLineDash([]);
    });

    // Trees.
    for (i = 0; i < 70; i++) {
      var tx = rand() * w, ty = rand() * h, tr = 2.5 + rand() * 3.5;
      g.fillStyle = grey(30); g.beginPath(); g.arc(tx + 1.5, ty + 1.5, tr, 0, Math.PI * 2); g.fill();
      g.fillStyle = grey(70 + rand() * 25); g.beginPath(); g.arc(tx, ty, tr, 0, Math.PI * 2); g.fill();
    }

    // Building clusters; their corners double as "feature points".
    var clusters = [[w * 0.18, h * 0.3], [w * 0.47, h * 0.22], [w * 0.8, h * 0.68], [w * 0.15, h * 0.82]];
    clusters.forEach(function (cl) {
      var nb = 4 + Math.floor(rand() * 3);
      for (var b = 0; b < nb; b++) {
        var bx = cl[0] + (rand() - 0.5) * 60, by = cl[1] + (rand() - 0.5) * 44;
        var bw = 8 + rand() * 12, bh = 7 + rand() * 9;
        g.fillStyle = grey(25); g.fillRect(bx + 3, by + 3, bw, bh);
        g.fillStyle = grey(222); g.fillRect(bx, by, bw, bh);
        g.strokeStyle = grey(150); g.lineWidth = 1;
        g.beginPath(); g.moveTo(bx, by + bh / 2); g.lineTo(bx + bw, by + bh / 2); g.stroke();
        if (b < 3) features.push([bx, by]);
      }
    });

    // Siemens star.
    var sx = w * 0.62, sy = h * 0.47, sr = 38, spokes = 36;
    g.fillStyle = grey(245); g.beginPath(); g.arc(sx, sy, sr + 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = grey(15);
    for (i = 0; i < spokes; i += 2) {
      g.beginPath();
      g.moveTo(sx, sy);
      g.arc(sx, sy, sr, i / spokes * Math.PI * 2, (i + 1) / spokes * Math.PI * 2);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = grey(15); g.lineWidth = 2;
    g.beginPath(); g.arc(sx, sy, sr + 7, 0, Math.PI * 2); g.stroke();
    features.push([sx, sy]);

    c.features = features;
    return c;
  }

  // ======================================================================
  // 02 · Reconstruct
  // ======================================================================

  // Modified Shepp-Logan phantom: [density, a, b, x0, y0, angle in degrees].
  var PHANTOM = [
    [1, 0.69, 0.92, 0, 0, 0], [-0.8, 0.6624, 0.874, 0, -0.0184, 0],
    [-0.2, 0.11, 0.31, 0.22, 0, -18], [-0.2, 0.16, 0.41, -0.22, 0, 18],
    [0.1, 0.21, 0.25, 0, 0.35, 0], [0.1, 0.046, 0.046, 0, 0.1, 0],
    [0.1, 0.046, 0.046, 0, -0.1, 0], [0.1, 0.046, 0.023, -0.08, -0.605, 0],
    [0.1, 0.023, 0.023, 0, -0.606, 0], [0.1, 0.023, 0.046, 0.06, -0.605, 0]
  ];

  var tomoSpec = {
    duration: 8.6,
    init: function (p) {
      var NR = 112, M = 120, D = 161, T = 1.05, tau = 2 * T / (D - 1);
      var angles = new Float32Array(M), cosA = new Float32Array(M), sinA = new Float32Array(M);
      var proj = [], filt = [], pmax = 0, m, d, k;

      for (m = 0; m < M; m++) {
        angles[m] = m * Math.PI / M;
        cosA[m] = Math.cos(angles[m]);
        sinA[m] = Math.sin(angles[m]);
      }

      // Analytic projections of each ellipse.
      for (m = 0; m < M; m++) {
        var row = new Float32Array(D);
        for (d = 0; d < D; d++) {
          var tt = -T + d * tau, sum = 0;
          for (var e = 0; e < PHANTOM.length; e++) {
            var E = PHANTOM[e], phi = E[5] * Math.PI / 180;
            var c = Math.cos(angles[m] - phi), s = Math.sin(angles[m] - phi);
            var a2 = E[1] * E[1] * c * c + E[2] * E[2] * s * s;
            var ss = tt - (E[3] * cosA[m] + E[4] * sinA[m]);
            if (ss * ss <= a2) sum += 2 * E[0] * E[1] * E[2] * Math.sqrt(a2 - ss * ss) / a2;
          }
          row[d] = sum;
          if (sum > pmax) pmax = sum;
        }
        proj.push(row);
      }

      // Ram-Lak filter in the spatial domain.
      var h = new Float32Array(2 * D - 1);
      for (k = -(D - 1); k <= D - 1; k++) {
        h[k + D - 1] = k === 0 ? 1 / (4 * tau * tau) : (k % 2 ? -1 / (k * k * Math.PI * Math.PI * tau * tau) : 0);
      }
      for (m = 0; m < M; m++) {
        var q = new Float32Array(D), pr = proj[m];
        for (d = 0; d < D; d++) {
          var acc = 0;
          for (k = 0; k < D; k++) acc += pr[k] * h[d - k + D - 1];
          q[d] = acc * tau;
        }
        filt.push(q);
      }

      // Ground-truth phantom thumbnail for the scanner view.
      var thumb = makeCanvas(NR, NR), tg = thumb.getContext('2d'), timg = tg.createImageData(NR, NR);
      for (var py = 0; py < NR; py++) {
        for (var px = 0; px < NR; px++) {
          var x = -1 + 2 * (px + 0.5) / NR, y = 1 - 2 * (py + 0.5) / NR, v = 0;
          for (e = 0; e < PHANTOM.length; e++) {
            E = PHANTOM[e]; phi = E[5] * Math.PI / 180;
            var xr = (x - E[3]) * Math.cos(phi) + (y - E[4]) * Math.sin(phi);
            var yr = -(x - E[3]) * Math.sin(phi) + (y - E[4]) * Math.cos(phi);
            if ((xr * xr) / (E[1] * E[1]) + (yr * yr) / (E[2] * E[2]) <= 1) v += E[0];
          }
          var g = clamp(v / 0.45, 0, 1) * 235, o = (py * NR + px) * 4;
          timg.data[o] = g; timg.data[o + 1] = g; timg.data[o + 2] = g; timg.data[o + 3] = v > 0.001 ? 255 : 0;
        }
      }
      tg.putImageData(timg, 0, 0);

      var recon = makeCanvas(NR, NR);
      p.data = {
        NR: NR, M: M, D: D, T: T, tau: tau, cosA: cosA, sinA: sinA, angles: angles,
        proj: proj, filt: filt, pmax: pmax, thumb: thumb,
        f: new Float32Array(NR * NR), done: 0,
        recon: recon, rctx: recon.getContext('2d'), rimg: recon.getContext('2d').createImageData(NR, NR)
      };
    },
    draw: function (ctx, cw, ch, t, dpr, p) {
      var D = p.data;
      var prog = clamp((t - 0.3) / 7.0, 0, 1);
      var target = Math.max(1, Math.round(prog * D.M));
      if (target < D.done) { D.f.fill(0); D.done = 0; }
      while (D.done < target) backproject(D, D.done++);
      paintRecon(D);

      ctx.fillStyle = '#070605';
      ctx.fillRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      var m = Math.min(D.done, D.M) - 1;
      var theta = D.angles[m];

      // Scanner view on the left.
      var top = 38 * dpr, bottom = ch - 46 * dpr, cy = (top + bottom) / 2, half = (bottom - top) / 2;
      var cx = cw * 0.27, R = Math.min(half / 1.36 - 3 * dpr, cw * 0.19), r0 = R * 0.66;
      ctx.strokeStyle = 'rgba(255, 246, 236, 0.12)';
      ctx.lineWidth = dpr;
      ctx.setLineDash([3 * dpr, 4 * dpr]);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.drawImage(D.thumb, cx - r0, cy - r0, 2 * r0, 2 * r0);

      // Detector axis (cos, sin) and ray direction (-sin, cos); canvas y is flipped.
      var ax = Math.cos(theta), ay = -Math.sin(theta);
      var rx = -Math.sin(theta), ry = -Math.cos(theta);

      ctx.strokeStyle = 'rgba(255, 143, 63, 0.22)';
      ctx.lineWidth = dpr;
      for (var i = -5; i <= 5; i++) {
        var o = i / 5 * r0 * 0.95;
        ctx.beginPath();
        ctx.moveTo(cx + ax * o - rx * R, cy + ay * o - ry * R);
        ctx.lineTo(cx + ax * o + rx * R, cy + ay * o + ry * R);
        ctx.stroke();
      }

      // Source bar and detector bar.
      ctx.lineCap = 'round';
      ctx.lineWidth = 4 * dpr;
      ctx.strokeStyle = ACCENT;
      bar(ctx, cx - rx * R, cy - ry * R, ax, ay, r0 * 1.05);
      ctx.strokeStyle = 'rgba(255, 246, 236, 0.85)';
      bar(ctx, cx + rx * R, cy + ry * R, ax, ay, r0 * 1.05);
      ctx.lineCap = 'butt';

      // Projection profile drawn off the detector.
      var row = D.proj[m];
      ctx.strokeStyle = HUD;
      ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath();
      for (var d = 0; d < D.D; d++) {
        var tt = -D.T + d * D.tau;
        var off = R + 5 * dpr + row[d] / D.pmax * R * 0.34;
        var x = cx + ax * tt * r0 + rx * off, y = cy + ay * tt * r0 + ry * off;
        if (d === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Reconstruction on the right.
      var S = Math.min(bottom - top, cw * 0.44);
      var sx = cw * 0.73 - S / 2, sy = cy - S / 2;
      ctx.drawImage(D.recon, sx, sy, S, S);
      ctx.strokeStyle = 'rgba(255, 246, 236, 0.16)';
      ctx.lineWidth = dpr;
      ctx.strokeRect(sx - 0.5, sy - 0.5, S + 1, S + 1);

      var deg = Math.round(theta * 180 / Math.PI);
      var txt = D.done < D.M
        ? ['Back-projecting · θ ' + deg + '° · ' + D.done + ' of ' + D.M + ' angles', 'θ ' + deg + '° · ' + D.done + '/' + D.M]
        : ['Reconstructed · ' + D.M + ' angles · a 2D cut of FDK', 'Reconstructed · ' + D.M + ' angles'];
      caption(ctx, cw, ch, dpr, txt);
    }
  };

  function bar(ctx, x, y, ax, ay, half) {
    ctx.beginPath();
    ctx.moveTo(x - ax * half, y - ay * half);
    ctx.lineTo(x + ax * half, y + ay * half);
    ctx.stroke();
  }

  function backproject(D, m) {
    var NR = D.NR, f = D.f, q = D.filt[m];
    var c = D.cosA[m], s = D.sinA[m], scale = Math.PI / D.M, invTau = 1 / D.tau, Dm = D.D - 1;
    for (var py = 0; py < NR; py++) {
      var y = 1 - 2 * (py + 0.5) / NR;
      for (var px = 0; px < NR; px++) {
        var x = -1 + 2 * (px + 0.5) / NR;
        var u = (x * c + y * s + D.T) * invTau;
        var i0 = Math.floor(u);
        if (i0 < 0 || i0 >= Dm) continue;
        var fr = u - i0;
        f[py * NR + px] += (q[i0] * (1 - fr) + q[i0 + 1] * fr) * scale;
      }
    }
  }

  function paintRecon(D) {
    var n = D.NR * D.NR, px = D.rimg.data, norm = D.M / D.done;
    for (var i = 0; i < n; i++) {
      var v = clamp(D.f[i] * norm / 0.45, 0, 1) * 245;
      px[i * 4] = v; px[i * 4 + 1] = v; px[i * 4 + 2] = v * 0.97; px[i * 4 + 3] = 255;
    }
    D.rctx.putImageData(D.rimg, 0, 0);
  }

  // ======================================================================
  // Player
  // ======================================================================

  var SPECS = { stack: stackSpec, tomo: tomoSpec };
  var players = [];
  var rafId = 0;

  // js/work.js (loaded first) registers the client-project previews here and
  // borrows the drawing helpers so every card shares one look.
  if (typeof window.PREVIEW_EXT === 'function') {
    window.PREVIEW_EXT({
      mulberry32: mulberry32, clamp: clamp, ease: ease, makeCanvas: makeCanvas,
      caption: caption, roundRect: roundRect, label: label,
      HUD: HUD, ACCENT: ACCENT, MONO: MONO
    }, SPECS);
  }
  window.__previews = players;

  function Player(canvas, spec) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.spec = spec;
    this.t = spec.duration;
    this.playing = false;
    this.played = false;
    this.visible = false;
    this.ready = false;
    this.dpr = 1;
  }

  Player.prototype.prepare = function () {
    if (this.ready) return;
    this.spec.init(this);
    this.ready = true;
  };

  Player.prototype.resize = function () {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = this.canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width * this.dpr)), h = Math.max(1, Math.round(r.height * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (this.ready) this.render();
  };

  Player.prototype.render = function () {
    this.prepare();
    this.spec.draw(this.ctx, this.canvas.width, this.canvas.height, this.t, this.dpr, this);
  };

  Player.prototype.play = function () {
    this.prepare();
    this.t = 0;
    this.playing = true;
    this.played = true;
    this.last = 0;
    loop();
  };

  function frame(now) {
    rafId = 0;
    var any = false;
    players.forEach(function (p) {
      if (!p.playing || !p.visible) return;
      if (!p.last) p.last = now;
      p.t += Math.min(now - p.last, 100) / 1000;
      p.last = now;
      if (p.t >= p.spec.duration) {
        if (p.loop) {
          // Looping previews (home cards) hold the last frame briefly, then start over.
          p.holdUntil = p.holdUntil || now + 1600;
          if (now >= p.holdUntil) { p.t = 0; p.holdUntil = 0; } else p.t = p.spec.duration;
        } else { p.t = p.spec.duration; p.playing = false; }
      }
      p.render();
      if (p.playing) any = true;
    });
    if (any) loop();
  }

  function loop() { if (!rafId) rafId = requestAnimationFrame(frame); }

  document.querySelectorAll('canvas[data-preview]').forEach(function (canvas) {
    var spec = SPECS[canvas.getAttribute('data-preview')];
    if (!spec || !canvas.getContext) return;
    var player = new Player(canvas, spec);
    player.loop = canvas.hasAttribute('data-loop');
    players.push(player);

    var replay = document.querySelector('[data-replay="' + canvas.getAttribute('data-preview') + '"]');
    if (replay) replay.addEventListener('click', function () { player.visible = true; player.play(); });

    if ('ResizeObserver' in window) new ResizeObserver(function () { player.resize(); }).observe(canvas);
    else window.addEventListener('resize', function () { player.resize(); });
    player.resize();

    if (!('IntersectionObserver' in window)) { player.visible = true; player.render(); return; }

    // Build the frames a little before the card arrives, play once it's in view.
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) {
        player.prepare();
        if (!player.playing) player.render();
      }
    }, { rootMargin: '300px 0px' }).observe(canvas);

    new IntersectionObserver(function (entries) {
      var e = entries[0];
      player.visible = e.isIntersecting;
      if (!e.isIntersecting) return;
      if (!player.played && !reduceMotion) player.play();
      else if (player.playing) { player.last = 0; loop(); }
    }, { threshold: 0.45 }).observe(canvas);
  });

  // Still thumbnails: one frame of a preview, rendered once, never played.
  document.querySelectorAll('canvas[data-preview-still]').forEach(function (canvas) {
    var spec = SPECS[canvas.getAttribute('data-preview-still')];
    if (!spec || !canvas.getContext) return;
    var still = new Player(canvas, spec);
    still.t = spec.duration * (parseFloat(canvas.getAttribute('data-still')) || 0.5);
    function paint() { still.prepare(); still.t = spec.duration * (parseFloat(canvas.getAttribute('data-still')) || 0.5); still.resize(); still.render(); }
    if ('ResizeObserver' in window) new ResizeObserver(function () { paint(); }).observe(canvas);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries, obs) { if (entries[0].isIntersecting) { paint(); obs.disconnect(); } }, { rootMargin: '300px 0px' }).observe(canvas);
    } else paint();
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      players.forEach(function (p) { if (p.ready && !p.playing) p.render(); });
    });
  }
})();
