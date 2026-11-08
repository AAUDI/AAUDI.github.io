/* Project previews that are computed in the browser. Real project material
   sits on the cards as photos; these fill in where a photo cannot:

   calib   Two camera views, feature matches, and a camera calibration that
           converges while a sparse 3D cloud is triangulated. (Oreyeon role)
   stream  Four camera streams batched through one GPU inference block; a
           stream is removed and re-added, the model is hot-swapped.
   tof     A time-of-flight depth map of objects on a conveyor, as an orbiting
           point cloud with per-object measurements.
   fpv3d   A low-poly drone with its gimbal camera following a car over
           terrain, with an inset of what the camera sees.
   sr3d    A car with a roof gimbal sweeping a street; the inset shows the
           thermal view, native on one side and 2x on the other.
   bin3d   A robot arm picking parts out of a bin by camera alone, deferring
           the uncertain one.

   The 3D scenes use a tiny flat-shaded renderer below (no library).
   Registered into js/previews.js through window.PREVIEW_EXT. */
window.PREVIEW_EXT = function (H, SPECS) {
  'use strict';

  var mulberry32 = H.mulberry32, clamp = H.clamp, makeCanvas = H.makeCanvas;
  var caption = H.caption, roundRect = H.roundRect;
  var HUD = H.HUD, ACCENT = H.ACCENT, MONO = H.MONO;
  var INK = '#070605', PAPER = 'rgba(255, 246, 236, 0.92)', FAINT = 'rgba(255, 246, 236, 0.55)';
  var TAU = Math.PI * 2;

  // ---------------------------------------------------------------------
  // Shared 2D helpers
  // ---------------------------------------------------------------------

  function lerp(a, b, x) { return a + (b - a) * x; }
  function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function seg(t, a, b) { return clamp((t - a) / (b - a), 0, 1); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function font(ctx, px, dpr, weight) {
    ctx.font = (weight || 500) + ' ' + Math.round(px * dpr) + 'px ' + MONO;
  }

  // Small rounded chip. align: 'left' | 'right' | 'center'. Returns its width.
  function chip(ctx, text, x, y, dpr, o) {
    o = o || {};
    font(ctx, o.size || 10, dpr, o.weight || 500);
    var padX = 7 * dpr, h = (o.h || 19) * dpr;
    var w = ctx.measureText(text).width + padX * 2;
    var bx = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    ctx.fillStyle = o.bg || 'rgba(7, 6, 5, 0.78)';
    roundRect(ctx, bx, y, w, h, 5 * dpr);
    ctx.fill();
    if (o.border) { ctx.strokeStyle = o.border; ctx.lineWidth = dpr; ctx.stroke(); }
    ctx.fillStyle = o.color || PAPER;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + padX, y + h / 2 + 0.5);
    return w;
  }

  function panel(ctx, x, y, w, h, dpr, alpha) {
    ctx.fillStyle = 'rgba(7, 6, 5, ' + (alpha === undefined ? 0.78 : alpha) + ')';
    roundRect(ctx, x, y, w, h, 6 * dpr);
    ctx.fill();
  }

  // Detection-style box with corner brackets.
  function hudRect(ctx, x, y, w, h, dpr, color, dashed, lw) {
    ctx.strokeStyle = color || HUD;
    ctx.lineWidth = (lw || 1.5) * dpr;
    if (dashed) ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    if (dashed) return;
    var c = Math.min(w, h) * 0.28;
    ctx.lineWidth = (lw || 1.5) * dpr * 2;
    ctx.beginPath();
    [[x, y, 1, 1], [x + w, y, -1, 1], [x + w, y + h, -1, -1], [x, y + h, 1, -1]].forEach(function (k) {
      ctx.moveTo(k[0], k[1] + k[3] * c); ctx.lineTo(k[0], k[1]); ctx.lineTo(k[0] + k[2] * c, k[1]);
    });
    ctx.stroke();
  }

  function text(ctx, s, x, y, dpr, o) {
    o = o || {};
    font(ctx, o.size || 10, dpr, o.weight || 500);
    ctx.fillStyle = o.color || PAPER;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'middle';
    ctx.fillText(s, x, y);
    ctx.textAlign = 'left';
  }

  // Value noise on a seeded lattice, plus a 3-octave fbm.
  function makeNoise(rand, size) {
    size = size || 64;
    var g = new Float32Array(size * size);
    for (var i = 0; i < g.length; i++) g[i] = rand();
    function n(x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      var x0 = ((xi % size) + size) % size, y0 = ((yi % size) + size) % size;
      var x1 = (x0 + 1) % size, y1 = (y0 + 1) % size;
      var a = g[y0 * size + x0], b = g[y0 * size + x1], c = g[y1 * size + x0], d = g[y1 * size + x1];
      return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
    }
    n.fbm = function (x, y) { return 0.57 * n(x, y) + 0.29 * n(x * 2.1 + 7, y * 2.1 + 3) + 0.14 * n(x * 4.3 + 11, y * 4.3 + 5); };
    return n;
  }

  function ramp(stops) {
    var lut = new Uint8Array(256 * 3);
    for (var i = 0; i < 256; i++) {
      var x = i / 255, k = 0;
      while (k < stops.length - 2 && x > stops[k + 1][0]) k++;
      var a = stops[k], b = stops[k + 1], f = clamp((x - a[0]) / (b[0] - a[0]), 0, 1);
      lut[i * 3] = Math.round(lerp(a[1], b[1], f));
      lut[i * 3 + 1] = Math.round(lerp(a[2], b[2], f));
      lut[i * 3 + 2] = Math.round(lerp(a[3], b[3], f));
    }
    return lut;
  }
  var HOT = ramp([[0, 6, 0, 0], [0.3, 140, 0, 0], [0.6, 255, 80, 0], [0.85, 255, 220, 40], [1, 255, 255, 230]]);
  // Ironbow, as on the viewfinder: cold is black-purple, hot is yellow-white.
  var IRONBOW = ramp([[0, 3, 0, 12], [0.2, 46, 0, 90], [0.4, 150, 24, 110], [0.6, 236, 88, 28], [0.8, 255, 186, 44], [1, 255, 250, 222]]);
  // Turbo colormap for depth views.
  var TURBO = ramp([[0, 48, 18, 59], [0.14, 70, 98, 215], [0.28, 54, 170, 249], [0.42, 26, 228, 182], [0.56, 114, 254, 94], [0.7, 200, 239, 52], [0.82, 250, 186, 57], [0.92, 246, 107, 25], [1, 202, 42, 4]]);
  var DEPTH = ramp([[0, 10, 30, 40], [0.35, 24, 150, 140], [0.7, 240, 230, 200], [1, 255, 143, 63]]);
  function lutColor(lut, x) { var i = clamp(x * 255, 0, 255) | 0; return [lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]]; }

  function bg(ctx, cw, ch) { ctx.fillStyle = INK; ctx.fillRect(0, 0, cw, ch); }

  // ---------------------------------------------------------------------
  // calib · online calibration + sparse reconstruction (Oreyeon)
  // ---------------------------------------------------------------------

  SPECS.calib = {
    duration: 10,
    init: function (p) {
      var rand = mulberry32(2023);
      var pts = [], i, j;
      for (j = 0; j < 7; j++) for (i = 0; i < 11; i++) pts.push([-1.0 + i * 0.2 + (rand() - 0.5) * 0.04, 0.9 - j * 0.22 + (rand() - 0.5) * 0.04, 4.0 + (rand() - 0.5) * 0.03, 0]);
      for (i = 0; i < 46; i++) pts.push([(rand() - 0.5) * 2.6, -0.65, 2.2 + rand() * 1.8, 1]);
      for (j = 0; j < 5; j++) for (i = 0; i < 7; i++) pts.push([1.1, 0.8 - j * 0.3, 2.6 + i * 0.22 + (rand() - 0.5) * 0.04, 2]);
      var pairs = [];
      for (i = 0; i < pts.length; i++) {
        if (pts[i][3] === 0 && i % 11 !== 10) pairs.push([i, i + 1]);
        if (pts[i][3] === 0 && i + 11 < 77) pairs.push([i, i + 11]);
      }
      var trueF = 1.0, trueK = -0.18, baseline = 0.55, yaw = -0.09;
      function project(P, cam, F, K) {
        var x = P[0], y = P[1], z = P[2];
        if (cam === 1) { x -= baseline; var c = Math.cos(yaw), s = Math.sin(yaw); var xr = c * x + s * z, zr = -s * x + c * z; x = xr; z = zr; }
        var u = x / z, v = y / z, r2 = u * u + v * v, d = 1 + K * r2;
        return [u * d * F, v * d * F];
      }
      var imgs = [[], []];
      for (i = 0; i < pts.length; i++) { imgs[0].push(project(pts[i], 0, trueF, trueK)); imgs[1].push(project(pts[i], 1, trueF, trueK)); }
      var order = pts.map(function (_, k) { return k; });
      for (i = order.length - 1; i > 0; i--) { j = Math.floor(rand() * (i + 1)); var tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
      p.data = { pts: pts, pairs: pairs, imgs: imgs, order: order, noise: [] };
      for (i = 0; i < pts.length; i++) p.data.noise.push([(rand() - 0.5), (rand() - 0.5)]);
    },
    draw: function (ctx, cw, ch, t, dpr, p) {
      var D = p.data;
      bg(ctx, cw, ch);
      var conv = smooth(seg(t, 1.6, 7.4));
      var F = lerp(0.84, 1, conv), K = lerp(0, -0.18, conv);
      var err = lerp(3.4, 0.27, Math.pow(conv, 0.6));

      var m = 10 * dpr, top = 38 * dpr, gap = 8 * dpr;
      var imgH = (ch - 48 * dpr - top) * 0.52, imgW = (cw - m * 2 - gap) / 2;
      var scale = Math.min(imgW / 1.4, imgH / 1.1) * 0.9;
      var frames = [[m, top], [m + imgW + gap, top]];
      var nMatch = Math.round(smooth(seg(t, 0.3, 1.8)) * D.pts.length);

      var scr = [[], []];
      for (var cam = 0; cam < 2; cam++) {
        var fx = frames[cam][0], fy = frames[cam][1];
        ctx.fillStyle = '#121010';
        roundRect(ctx, fx, fy, imgW, imgH, 4 * dpr); ctx.fill();
        ctx.save(); ctx.beginPath(); ctx.rect(fx, fy, imgW, imgH); ctx.clip();
        var cx = fx + imgW / 2, cy = fy + imgH * 0.52;
        for (var i = 0; i < D.pts.length; i++) {
          var q = D.imgs[cam][i];
          scr[cam].push([cx + q[0] * scale, cy - q[1] * scale]);
        }
        ctx.strokeStyle = 'rgba(255, 246, 236, 0.14)'; ctx.lineWidth = dpr;
        ctx.beginPath();
        D.pairs.forEach(function (pr) { ctx.moveTo(scr[cam][pr[0]][0], scr[cam][pr[0]][1]); ctx.lineTo(scr[cam][pr[1]][0], scr[cam][pr[1]][1]); });
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 246, 236, 0.1)';
        ctx.beginPath(); ctx.moveTo(fx, cy + 0.65 * scale); ctx.lineTo(fx + imgW, cy + 0.65 * scale); ctx.stroke();
        for (i = 0; i < nMatch; i++) {
          var k = D.order[i], s = scr[cam][k], r = 2.2 * dpr;
          ctx.strokeStyle = HUD; ctx.lineWidth = dpr;
          ctx.beginPath(); ctx.moveTo(s[0] - r, s[1]); ctx.lineTo(s[0] + r, s[1]); ctx.moveTo(s[0], s[1] - r); ctx.lineTo(s[0], s[1] + r); ctx.stroke();
        }
        if (t > 1.6) {
          for (i = 0; i < nMatch; i += 2) {
            k = D.order[i]; s = scr[cam][k];
            var ex = D.noise[k][0] * err * 2.4 * dpr, ey = D.noise[k][1] * err * 2.4 * dpr;
            ctx.strokeStyle = 'rgba(255, 143, 63, ' + (0.25 + 0.6 * (1 - conv)) + ')';
            ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(s[0] + ex, s[1] + ey); ctx.stroke();
          }
        }
        ctx.restore();
        chip(ctx, cam ? 'CAM B' : 'CAM A', fx + 6 * dpr, fy + 6 * dpr, dpr, { size: 9, h: 16 });
      }
      ctx.lineWidth = dpr;
      for (i = 0; i < nMatch; i += 4) {
        k = D.order[i];
        var a = scr[0][k], b = scr[1][k];
        if (a[0] < frames[0][0] || a[0] > frames[0][0] + imgW || b[0] < frames[1][0] || b[0] > frames[1][0] + imgW) continue;
        ctx.strokeStyle = 'rgba(111, 243, 214, 0.22)';
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }

      var by = top + imgH + gap, bh = ch - by - 44 * dpr;
      var cloudW = Math.min(cw * 0.46, bh * 1.6);
      ctx.fillStyle = '#0d0b0a'; roundRect(ctx, m, by, cloudW, bh, 4 * dpr); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.rect(m, by, cloudW, bh); ctx.clip();
      var nTri = Math.round(smooth(seg(t, 2.0, 7.0)) * D.pts.length);
      var az = 0.55 + 0.22 * Math.sin(t * 0.5), ca = Math.cos(az), sa = Math.sin(az), el = 0.42;
      var ccx = m + cloudW / 2, ccy = by + bh * 0.55, cs = Math.min(cloudW, bh) * 0.19;
      for (i = 0; i < nTri; i++) {
        k = D.order[i];
        var P = D.pts[k], x = P[0], y = P[1], z = P[2] - 3.4;
        var xr = ca * x + sa * z, zr = -sa * x + ca * z;
        var yr = y * Math.cos(el) - zr * Math.sin(el);
        var sx = ccx + xr * cs, sy = ccy - yr * cs;
        ctx.fillStyle = P[3] === 1 ? 'rgba(255, 246, 236, 0.55)' : P[3] === 0 ? HUD : ACCENT;
        ctx.fillRect(sx - dpr, sy - dpr, 2 * dpr, 2 * dpr);
      }
      ctx.restore();
      chip(ctx, 'SPARSE 3D · ' + nTri + ' pts', m + 6 * dpr, by + 6 * dpr, dpr, { size: 9, h: 16 });

      var rx = m + cloudW + gap, rw = cw - rx - m;
      ctx.fillStyle = '#0d0b0a'; roundRect(ctx, rx, by, rw, bh, 4 * dpr); ctx.fill();
      text(ctx, 'REPROJECTION ERROR', rx + 8 * dpr, by + 12 * dpr, dpr, { size: 9, color: FAINT });
      text(ctx, err.toFixed(2) + ' px', rx + 8 * dpr, by + 30 * dpr, dpr, { size: 15, weight: 600, color: conv > 0.95 ? HUD : PAPER });
      var gx = rx + 8 * dpr, gw = rw - 16 * dpr, gy = by + bh - 10 * dpr, gh = bh - 56 * dpr;
      if (gh > 8 * dpr) {
        ctx.strokeStyle = 'rgba(255, 246, 236, 0.15)'; ctx.lineWidth = dpr;
        ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + gw, gy); ctx.stroke();
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5 * dpr; ctx.beginPath();
        for (i = 0; i <= 60; i++) {
          var tt = 1.6 + (7.4 - 1.6) * i / 60; if (tt > t) break;
          var c2 = smooth(seg(tt, 1.6, 7.4)), e2 = lerp(3.4, 0.27, Math.pow(c2, 0.6));
          var px = gx + gw * (tt - 1.6) / (7.4 - 1.6), py = gy - gh * (e2 / 3.6);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      if (rw > 150 * dpr) text(ctx, 'f ' + Math.round(F * 1240) + ' px · k1 ' + K.toFixed(3), rx + 8 * dpr, by + 46 * dpr, dpr, { size: 9, color: FAINT });

      var txt = t < 1.8 ? ['Feature matching across two views', 'Matching features']
        : t < 7.4 ? ['Online calibration · refining focal length and distortion', 'Calibrating · ' + err.toFixed(2) + ' px']
        : ['Calibrated · sparse reconstruction from the matches', 'Calibrated · 3D from matches'];
      caption(ctx, cw, ch, dpr, txt);
    }
  };

  // ---------------------------------------------------------------------
  // stream · multi-camera DeepStream pipeline
  // ---------------------------------------------------------------------

  var COCO = [['person', HUD], ['car', ACCENT], ['truck', '#f3e76f']];
  var PPE = [['helmet', '#f3e76f'], ['vest', ACCENT], ['person', HUD]];

  SPECS.stream = {
    duration: 13,
    init: function (p) {
      var rand = mulberry32(77), tiles = [];
      for (var k = 0; k < 4; k++) {
        var objs = [];
        for (var i = 0; i < 3; i++) objs.push({ x: rand(), y: 0.35 + rand() * 0.5, vx: (rand() - 0.5) * 0.18, w: 0.08 + rand() * 0.07, h: 0.16 + rand() * 0.12, cls: i % 3, conf: 0.7 + rand() * 0.28 });
        tiles.push({ objs: objs, hue: 20 + k * 11 });
      }
      p.data = { tiles: tiles, rand: mulberry32(9), log: [], lastLog: -1, det: 87, cpu: 25 };
    },
    draw: function (ctx, cw, ch, t, dpr, p) {
      var D = p.data;
      bg(ctx, cw, ch);
      var removed = t > 4.5 && t < 6.8, swapped = t > 9.0, swapFlash = t > 9.0 && t < 9.9;
      var classes = swapped ? PPE : COCO;
      var m = 10 * dpr, top = 38 * dpr, bottom = ch - 44 * dpr;
      var narrow = cw < 420 * dpr;
      var leftW = narrow ? cw * 0.56 - m : cw * 0.44, gpuW = narrow ? cw * 0.2 : cw * 0.18;
      var tw = (leftW - m) / 2, th = (bottom - top - m) / 2;
      var tiles = [];
      for (var k = 0; k < 4; k++) {
        var tx = m + (k % 2) * (tw + m), ty = top + Math.floor(k / 2) * (th + m), T = D.tiles[k];
        tiles.push([tx, ty]);
        var off = k === 2 && removed;
        ctx.fillStyle = off ? '#0d0b0a' : 'hsl(' + T.hue + ', 12%, 16%)';
        roundRect(ctx, tx, ty, tw, th, 4 * dpr); ctx.fill();
        if (!off) {
          var grd = ctx.createLinearGradient(0, ty, 0, ty + th);
          grd.addColorStop(0, 'rgba(255,246,236,0)'); grd.addColorStop(1, 'rgba(255,246,236,0.08)');
          ctx.fillStyle = grd; ctx.fillRect(tx, ty, tw, th);
          ctx.save(); ctx.beginPath(); ctx.rect(tx, ty, tw, th); ctx.clip();
          T.objs.forEach(function (o) {
            var x = ((o.x + o.vx * t) % 1 + 1) % 1, ox = tx + x * tw, oy = ty + o.y * th, ow = o.w * tw, oh = o.h * th;
            ctx.fillStyle = 'rgba(255, 246, 236, 0.22)'; roundRect(ctx, ox - ow / 2, oy - oh, ow, oh, 2 * dpr); ctx.fill();
            var cl = classes[o.cls];
            hudRect(ctx, ox - ow / 2 - 2 * dpr, oy - oh - 2 * dpr, ow + 4 * dpr, oh + 4 * dpr, dpr, cl[1], false, 1);
            if (tw > 110 * dpr) text(ctx, cl[0] + ' ' + o.conf.toFixed(2), ox - ow / 2 - 2 * dpr, oy - oh - 8 * dpr, dpr, { size: 7.5, color: cl[1] });
          });
          ctx.restore();
        } else {
          text(ctx, 'REMOVED', tx + tw / 2, ty + th / 2, dpr, { size: 9, color: FAINT, align: 'center' });
        }
        chip(ctx, 'cam-0' + (k + 1), tx + 5 * dpr, ty + 5 * dpr, dpr, { size: 8, h: 15 });
        if (k === 2 && t >= 6.8 && t < 7.8) chip(ctx, 'RECONNECTED', tx + 5 * dpr, ty + th - 20 * dpr, dpr, { size: 8, h: 15, color: HUD, border: HUD });
      }
      var gx = m + leftW + m * 0.5, gy = top, gh = bottom - top;
      ctx.fillStyle = swapFlash ? 'rgba(255, 143, 63, 0.18)' : '#141211';
      roundRect(ctx, gx, gy, gpuW, gh, 5 * dpr); ctx.fill();
      ctx.strokeStyle = swapFlash ? ACCENT : 'rgba(255, 246, 236, 0.18)'; ctx.lineWidth = dpr; ctx.stroke();
      var stages = ['mux', 'infer', 'track'], sh = gh / 3;
      stages.forEach(function (s, i) {
        var sy = gy + sh * i;
        if (i) { ctx.strokeStyle = 'rgba(255, 246, 236, 0.12)'; ctx.beginPath(); ctx.moveTo(gx + 4 * dpr, sy); ctx.lineTo(gx + gpuW - 4 * dpr, sy); ctx.stroke(); }
        text(ctx, s, gx + gpuW / 2, sy + sh / 2, dpr, { size: narrow ? 8 : 9.5, align: 'center', color: i === 1 ? ACCENT : PAPER, weight: 600 });
        if (i === 1 && !narrow) text(ctx, swapped ? 'ppe.engine' : 'coco.engine', gx + gpuW / 2, sy + sh / 2 + 13 * dpr, dpr, { size: 7.5, align: 'center', color: FAINT });
      });
      text(ctx, 'GPU', gx + gpuW / 2, gy + 9 * dpr, dpr, { size: 7.5, align: 'center', color: FAINT });
      for (k = 0; k < 4; k++) {
        if (k === 2 && removed) continue;
        var ph = ((t * 1.6 + k * 0.25) % 1), from = [tiles[k][0] + tw, tiles[k][1] + th / 2], to = [gx, gy + gh * 0.5];
        var fx = lerp(from[0], to[0], ph), fy = lerp(from[1], to[1], ph);
        ctx.fillStyle = 'rgba(255, 246, 236, 0.85)'; ctx.fillRect(fx - 2.5 * dpr, fy - 2 * dpr, 5 * dpr, 4 * dpr);
        var ph2 = ((t * 1.6 + k * 0.25 + 0.5) % 1);
        ctx.fillStyle = HUD; ctx.beginPath(); ctx.arc(lerp(to[0], from[0], ph2), lerp(to[1], from[1], ph2) + 6 * dpr, 1.8 * dpr, 0, TAU); ctx.fill();
      }
      var rx = gx + gpuW + m, rw = cw - rx - m;
      var streams = removed ? 3 : 4;
      var detTarget = (removed ? 66 : 87) + Math.sin(t * 3.1) * 2.5, cpuTarget = (removed ? 21 : 25) + Math.sin(t * 2.3) * 1.2;
      D.det = lerp(D.det, detTarget, 0.1); D.cpu = lerp(D.cpu, cpuTarget, 0.1);
      var rows = [[streams + '', 'streams'], [Math.round(D.det) + '', 'det/s'], [Math.round(D.cpu) + ' %', 'cpu'], ['00:' + pad2(Math.floor(t) % 60), 'uptime']];
      var cy = top;
      rows.forEach(function (r) {
        if (narrow && cy + 30 * dpr > bottom) return;
        text(ctx, r[0], rx, cy + 10 * dpr, dpr, { size: narrow ? 12 : 15, weight: 600, color: r[1] === 'det/s' && removed ? ACCENT : PAPER });
        text(ctx, r[1], rx, cy + 26 * dpr, dpr, { size: 7.5, color: FAINT });
        cy += 38 * dpr;
      });
      if (!narrow) {
        if (t - D.lastLog > 0.45 || t < D.lastLog) {
          var cam = 1 + Math.floor(D.rand() * 4); if (removed && cam === 3) cam = 4;
          var cl = classes[Math.floor(D.rand() * 3)];
          D.log.unshift('cam-0' + cam + ' ' + cl[0] + ' ' + (0.6 + D.rand() * 0.38).toFixed(2));
          if (D.log.length > 6) D.log.pop(); D.lastLog = t;
        }
        text(ctx, 'events', rx, cy + 4 * dpr, dpr, { size: 7.5, color: FAINT });
        D.log.forEach(function (l, i) { if (cy + 18 * dpr + i * 12 * dpr < bottom) text(ctx, l, rx, cy + 18 * dpr + i * 12 * dpr, dpr, { size: 8, color: 'rgba(255,246,236,' + (0.85 - i * 0.12) + ')' }); });
      }
      if (swapFlash) chip(ctx, 'MODEL HOT-SWAP · coco → ppe · no restart', cw / 2, ch / 2 - 10 * dpr, dpr, { align: 'center', size: 9.5, h: 20, color: ACCENT, border: ACCENT });

      var txt = removed ? ['cam-03 removed while running · the rest keep going', 'cam-03 removed · others run']
        : t >= 6.8 && t < 8 ? ['cam-03 added back · reconnects and resumes', 'cam-03 back']
        : swapped ? ['Detector swapped to a PPE model mid-stream', 'Swapped to PPE model']
        : ['4 RTSP streams batched on one GPU · TensorRT detector', '4 streams · one GPU'];
      caption(ctx, cw, ch, dpr, txt);
    }
  };

  // ---------------------------------------------------------------------
  // tof · 3D time-of-flight camera on a conveyor
  // ---------------------------------------------------------------------

  SPECS.tof = {
    duration: 12,
    init: function (p) {
      var GX = 40, GY = 56, rand = mulberry32(3), n = makeNoise(rand);
      var objs = [
        { kind: 'box', w: 0.42, l: 0.5, h: 0.34, y0: -1.1, rot: 0.3 },
        { kind: 'cyl', r: 0.22, h: 0.48, y0: 0.1 },
        { kind: 'box', w: 0.3, l: 0.26, h: 0.16, y0: 1.0, rot: -0.5, tilt: 0.12 },
        { kind: 'box', w: 0.5, l: 0.36, h: 0.26, y0: 2.3, rot: 0.9 }
      ];
      p.data = { GX: GX, GY: GY, objs: objs, n: n, pts: new Float32Array(GX * GY * 3), idx: new Int32Array(GX * GY) };
    },
    draw: function (ctx, cw, ch, t, dpr, p) {
      var D = p.data, GX = D.GX, GY = D.GY;
      bg(ctx, cw, ch);
      var speed = 0.42;
      function height(x, y) {
        var z = 0.01 + D.n(x * 8, y * 8) * 0.01, i;
        for (i = 0; i < D.objs.length; i++) {
          var o = D.objs[i], oy = o.y0 + 1.6 - ((t * speed) % 4.6), dx = x, dy = y - oy;
          if (o.kind === 'cyl') { if (dx * dx + dy * dy < o.r * o.r) z = Math.max(z, o.h); }
          else {
            var c = Math.cos(o.rot), s = Math.sin(o.rot), u = c * dx + s * dy, v = -s * dx + c * dy;
            if (Math.abs(u) < o.w / 2 && Math.abs(v) < o.l / 2) z = Math.max(z, o.h + (o.tilt || 0) * u);
          }
        }
        return z;
      }
      var az = 0.7 + 0.3 * Math.sin(t * 0.35), el = 0.75, ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
      var top = 12 * dpr, bottom = ch - 44 * dpr;
      var cx = cw * 0.5, cy = (top + bottom) / 2 + 10 * dpr, S = Math.min(cw * 0.3, (bottom - top) * 0.42);
      var pts = D.pts, idx = D.idx, k = 0;
      for (var j = 0; j < GY; j++) for (var i = 0; i < GX; i++) {
        var x = -1 + 2 * i / (GX - 1), y = -1.5 + 3 * j / (GY - 1), z = height(x, y);
        var xr = ca * x - sa * y, yr = sa * x + ca * y;
        var yy = yr * ce - z * se;
        pts[k * 3] = cx + xr * S; pts[k * 3 + 1] = cy + yy * S; pts[k * 3 + 2] = z; idx[k] = k; k++;
      }
      var order = Array.prototype.slice.call(idx);
      order.sort(function (a, b) { return pts[a * 3 + 1] - pts[b * 3 + 1]; });
      var ps = Math.max(1.5 * dpr, S / GY * 1.6);
      for (k = 0; k < order.length; k++) {
        var q = order[k], z2 = pts[q * 3 + 2], c = clamp(z2 / 0.5 * 255, 0, 255) | 0;
        ctx.fillStyle = 'rgb(' + DEPTH[c * 3] + ',' + DEPTH[c * 3 + 1] + ',' + DEPTH[c * 3 + 2] + ')';
        ctx.fillRect(pts[q * 3] - ps / 2, pts[q * 3 + 1] - ps / 2, ps, ps);
      }
      var camX = cx, camY = top + 14 * dpr;
      ctx.fillStyle = PAPER; roundRect(ctx, camX - 9 * dpr, camY - 6 * dpr, 18 * dpr, 12 * dpr, 2 * dpr); ctx.fill();
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(camX, camY, 3 * dpr, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255, 143, 63, 0.35)'; ctx.lineWidth = dpr; ctx.setLineDash([2 * dpr, 3 * dpr]);
      [[-1, -1.5], [1, -1.5], [1, 1.5], [-1, 1.5]].forEach(function (cnr) {
        var xr = ca * cnr[0] - sa * cnr[1], yr = sa * cnr[0] + ca * cnr[1];
        ctx.beginPath(); ctx.moveTo(camX, camY + 6 * dpr); ctx.lineTo(cx + xr * S, cy + yr * ce * S); ctx.stroke();
      });
      ctx.setLineDash([]);
      D.objs.forEach(function (o) {
        var oy = o.y0 + 1.6 - ((t * speed) % 4.6);
        var half = o.kind === 'cyl' ? o.r : Math.max(o.w, o.l) / 2;
        if (oy - half < -1.5 || oy + half > 1.5) return;
        var xr = -sa * oy, yr = ca * oy, sx = cx + xr * S, sy = cy + (yr * ce - o.h * se) * S;
        ctx.strokeStyle = HUD; ctx.lineWidth = dpr;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 18 * dpr, sy - 18 * dpr); ctx.stroke();
        var hmm = Math.round(o.h * 100), dims = o.kind === 'cyl' ? 'ø ' + Math.round(o.r * 200) + ' mm' : Math.round(o.w * 100) + '×' + Math.round(o.l * 100) + ' mm';
        chip(ctx, (o.kind === 'cyl' ? 'cylinder' : 'box') + ' · h ' + hmm + ' · ' + dims + (o.tilt ? ' · tilt ' + Math.round(o.tilt * 57) + '°' : ''), sx + 18 * dpr, sy - 28 * dpr, dpr, { size: 8, h: 16, color: HUD });
      });
      chip(ctx, 'belt → ' + (speed * 100).toFixed(0) + ' mm/s', cw - 12 * dpr, 10 * dpr, dpr, { size: 9, h: 18, align: 'right' });
      chip(ctx, 'ToF depth · ' + GX + '×' + GY + ' shown', cw - 12 * dpr, 32 * dpr, dpr, { size: 9, h: 18, align: 'right' });
      caption(ctx, cw, ch, dpr, ['Depth map → segmentation → size, height and tilt per object, in-camera', 'Depth → size, in-camera']);
    }
  };

  // ---------------------------------------------------------------------
  // A tiny flat-shaded 3D renderer: faces are polygons with an outward
  // winding, sorted far-to-near each frame (painter's algorithm).
  // ---------------------------------------------------------------------

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function norm(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function mix(a, b, x) { return [lerp(a[0], b[0], x), lerp(a[1], b[1], x), lerp(a[2], b[2], x)]; }
  function rotY(p, a) { var c = Math.cos(a), s = Math.sin(a); return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]]; }

  function camera(eye, target, f) {
    var fwd = norm(sub(target, eye)), right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
    return { eye: eye, fwd: fwd, right: right, up: up, f: f };
  }
  function project(cam, p, cx, cy) {
    var d = sub(p, cam.eye), z = dot(d, cam.fwd);
    if (z < 0.08) return null;
    return [cx + cam.f * dot(d, cam.right) / z, cy - cam.f * dot(d, cam.up) / z, z];
  }

  // Scene: faces {pts, col:[r,g,b], a, temp}, lines {a, b, col, w, dash}.
  function Scene() { this.faces = []; this.lines = []; }
  Scene.prototype.face = function (pts, col, extra) { var f = { pts: pts, col: col }; if (extra) for (var k in extra) f[k] = extra[k]; this.faces.push(f); return f; };
  Scene.prototype.line = function (a, b, col, w, dash) { this.lines.push({ a: a, b: b, col: col, w: w || 1, dash: dash }); };

  // Box in an arbitrary right-handed frame (s, t, u) with half sizes.
  Scene.prototype.boxFrame = function (c, s, t, u, w, h, d, col, extra) {
    var self = this;
    function P(a, b, e) { return add(c, add(mul(s, a * w / 2), add(mul(t, b * h / 2), mul(u, e * d / 2)))); }
    [[[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
     [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
     [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]]
      .forEach(function (q) { self.face(q.map(function (k) { return P(k[0], k[1], k[2]); }), col, extra); });
  };
  Scene.prototype.box = function (c, w, h, d, col, yaw, extra) {
    var s = rotY([1, 0, 0], yaw || 0), u = rotY([0, 0, 1], yaw || 0);
    this.boxFrame(c, s, [0, 1, 0], u, w, h, d, col, extra);
  };
  // Beam from A to B with a w×h section.
  Scene.prototype.beam = function (A, B, w, h, col, extra) {
    var u = norm(sub(B, A)), ref = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    var s = norm(cross(u, ref)), t = cross(u, s);
    this.boxFrame(mix(A, B, 0.5), s, t, u, w, h, len(sub(B, A)), col, extra);
  };
  // Cylinder with axis u through c; s is any perpendicular direction.
  Scene.prototype.cyl = function (c, u, r, h, n, col, extra, caps) {
    u = norm(u);
    var ref = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    var s = norm(cross(ref, u)), t = cross(s, u), i, top = [], bot = [];
    for (i = 0; i < n; i++) {
      var a = i / n * TAU, rad = add(mul(s, Math.cos(a) * r), mul(t, Math.sin(a) * r));
      bot.push(add(sub(c, mul(u, h / 2)), rad)); top.push(add(add(c, mul(u, h / 2)), rad));
    }
    for (i = 0; i < n; i++) { var j = (i + 1) % n; this.face([bot[i], top[i], top[j], bot[j]], col, extra); }
    if (caps !== false) { this.face(top, col, extra); this.face(bot.slice().reverse(), col, extra); }
  };
  Scene.prototype.cone = function (c, r, h, n, col, extra) {
    var apex = add(c, [0, h, 0]), ring = [];
    for (var i = 0; i < n; i++) { var a = i / n * TAU; ring.push(add(c, [Math.cos(a) * r, 0, Math.sin(a) * r])); }
    for (i = 0; i < n; i++) this.face([ring[(i + 1) % n], ring[i], apex], col, extra);
  };

  var LIGHT = norm([0.45, 0.85, 0.3]), FILL = norm([-0.6, 0.35, -0.55]);
  var FOG = { col: [16, 13, 12], near: 18, far: 70 };
  function sky(ctx, cw, ch) {
    var g = ctx.createLinearGradient(0, 0, 0, ch);
    g.addColorStop(0, '#070605'); g.addColorStop(0.45, '#0e0b0a'); g.addColorStop(1, '#1a1412');
    ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
  }
  // Draw the scene from cam into the rect; thermal=true colours by face.temp;
  // fog={col,near,far} fades distant faces towards a colour; fog.depth=[near,far]
  // instead colours every face by its distance with the turbo colormap.
  function render(ctx, scene, cam, rect, dpr, thermal, fog) {
    var depth = fog && fog.depth;
    var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, i, j;
    var list = [];
    for (i = 0; i < scene.faces.length; i++) {
      var f = scene.faces[i], pts = f.pts, sp = [], zsum = 0, zmax = 0, ok = true;
      var n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
      if (!f.twoSided && dot(n, sub(cam.eye, pts[0])) <= 0) continue;
      for (j = 0; j < pts.length; j++) { var q = project(cam, pts[j], cx, cy); if (!q) { ok = false; break; } sp.push(q); zsum += q[2]; if (q[2] > zmax) zmax = q[2]; }
      if (!ok) continue;
      var col, zm = zsum / pts.length;
      if (depth) {
        col = lutColor(TURBO, clamp(1 - (zm - depth[0]) / (depth[1] - depth[0]), 0, 1));
        var dsh = 0.78 + 0.22 * Math.max(0, dot(n, LIGHT));
        col = [col[0] * dsh, col[1] * dsh, col[2] * dsh];
      } else if (thermal) {
        col = lutColor(IRONBOW, f.temp === undefined ? 0.3 : f.temp);
        var sh = 0.86 + 0.14 * Math.max(0, dot(n, LIGHT));
        col = [col[0] * sh, col[1] * sh, col[2] * sh];
      } else {
        var shade = 0.36 + 0.5 * Math.max(0, dot(n, LIGHT)) + 0.16 * Math.max(0, dot(n, FILL));
        col = [f.col[0] * shade, f.col[1] * shade, f.col[2] * shade];
      }
      if (fog && !depth && f.a === undefined) {
        var fz = clamp((zm - fog.near) / (fog.far - fog.near), 0, 1) * 0.85;
        col = [lerp(col[0], fog.col[0], fz), lerp(col[1], fog.col[1], fz), lerp(col[2], fog.col[2], fz)];
      }
      list.push({ sp: sp, z: zm * 0.6 + zmax * 0.4, col: col, a: f.a });
    }
    list.sort(function (a, b) { return b.z - a.z; });
    ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    ctx.lineJoin = 'round';
    for (i = 0; i < list.length; i++) {
      var L = list[i], c = L.col;
      var css = 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (L.a === undefined ? 1 : L.a) + ')';
      ctx.fillStyle = css; ctx.strokeStyle = css; ctx.lineWidth = 0.6 * dpr;
      ctx.beginPath();
      for (j = 0; j < L.sp.length; j++) { if (j === 0) ctx.moveTo(L.sp[j][0], L.sp[j][1]); else ctx.lineTo(L.sp[j][0], L.sp[j][1]); }
      ctx.closePath(); ctx.fill(); if (L.a === undefined) ctx.stroke();
    }
    for (i = 0; i < scene.lines.length; i++) {
      var l = scene.lines[i], a = project(cam, l.a, cx, cy), b = project(cam, l.b, cx, cy);
      if (!a || !b) continue;
      ctx.strokeStyle = l.col; ctx.lineWidth = l.w * dpr;
      if (l.dash) ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
  // Screen-space bounding box of some world points.
  function bbox(cam, pts, cx, cy) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < pts.length; i++) { var q = project(cam, pts[i], cx, cy); if (!q) return null; x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
    return [x0, y0, x1 - x0, y1 - y0];
  }

  // Shared model: a small car. Returns its 8 body corners for boxes.
  function addCar(sc, pos, yaw, col, temp) {
    var up = [0, 1, 0];
    sc.box(add(pos, [0, 0.32, 0]), 1.0, 0.36, 2.1, col, yaw, { temp: temp || 0.45 });
    sc.box(add(pos, rotY([0, 0.52, 0.75], yaw)), 0.9, 0.06, 0.5, col, yaw, { temp: 0.95 });
    sc.box(add(pos, rotY([0, 0.66, -0.15], yaw)), 0.86, 0.32, 1.1, [50, 62, 72], yaw, { temp: 0.35 });
    [[-0.5, 0.7], [0.5, 0.7], [-0.5, -0.7], [0.5, -0.7]].forEach(function (w) {
      sc.cyl(add(pos, rotY([w[0], 0.17, w[1]], yaw)), rotY([1, 0, 0], yaw), 0.17, 0.14, 8, [22, 22, 24], { temp: 0.62 });
    });
    sc.box(add(pos, rotY([0, 0.3, 1.03], yaw)), 0.9, 0.12, 0.06, [255, 230, 150], yaw, { temp: 0.9 });
    var c = [];
    [[-0.5, 0, -1.05], [0.5, 0, -1.05], [0.5, 0, 1.05], [-0.5, 0, 1.05]].forEach(function (k) { c.push(add(pos, rotY(k, yaw))); c.push(add(pos, rotY([k[0], 0.85, k[2]], yaw))); });
    void up;
    return c;
  }

  // ---------------------------------------------------------------------
  // Shared models: terrain with a road, trees, a quadcopter with a 3-axis
  // gimbal camera. Used by fpv3d here and by the hero object (js/hero3d.js).
  // ---------------------------------------------------------------------

  // Terrain: G×G cells over S×S units, with a road given by roadFn(s)->[x,0,z].
  function makeTerrain(seed, G, S, roadFn, treeCount, canopyAt) {
    var rand = mulberry32(seed), n = makeNoise(rand), path = [], i, j;
    for (i = 0; i <= 160; i++) path.push(roadFn(i / 160));
    function roadDist(x, z) { var d = Infinity; for (var k = 0; k < path.length; k++) { var dx = path[k][0] - x, dz = path[k][2] - z, q = dx * dx + dz * dz; if (q < d) d = q; } return Math.sqrt(d); }
    function height(x, z) { var h = n.fbm(x / 14 + 3, z / 14 + 1) * 3.2 - 1.2; var rd = roadDist(x, z); return rd < 2.4 ? h * smooth((rd - 1.2) / 1.2) * 0.3 : h; }
    var grid = [];
    for (j = 0; j <= G; j++) { grid.push([]); for (i = 0; i <= G; i++) { var x = -S / 2 + S * i / G, z = -S / 2 + S * j / G; grid[j].push([x, height(x, z), z]); } }
    var cells = [];
    for (j = 0; j < G; j++) for (i = 0; i < G; i++) {
      var cx = -S / 2 + S * (i + 0.5) / G, cz = -S / 2 + S * (j + 0.5) / G, rd = roadDist(cx, cz), v = n.fbm(cx / 6, cz / 6), w = n(cx / 2.3 + 9, cz / 2.3 + 4);
      var col, temp;
      if (rd < 1.3) { col = [84 + w * 10, 82 + w * 10, 78 + w * 8]; temp = 0.4; }
      else if (rd < 2.2) { col = [104, 100, 72]; temp = 0.3; }
      else { col = mix([58, 84, 42], [116, 104, 58], v); col = mix(col, [70, 92, 48], w * 0.5); temp = 0.14 + v * 0.1; }
      cells.push({ q: [grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1], grid[j][i]], col: col, temp: temp, road: rd < 1.3 });
    }
    var trees = [];
    for (i = 0; i < treeCount; i++) { var tx = (rand() - 0.5) * S * 0.95, tz = (rand() - 0.5) * S * 0.95; if (roadDist(tx, tz) > 2.8) trees.push([tx, height(tx, tz), tz, 0.8 + rand() * 1.1, 2.0 + rand() * 2.4, rand()]); }
    if (canopyAt !== undefined) {
      var cq = roadFn(canopyAt);
      for (i = 0; i < 9; i++) { var a = rand() * TAU, r = 0.6 + rand() * 2.2; trees.push([cq[0] + Math.cos(a) * r * 1.6, height(cq[0], cq[2]), cq[2] + Math.sin(a) * r, 1.5 + rand() * 0.8, 3.4 + rand() * 1.2, rand()]); }
    }
    return { road: roadFn, height: height, roadDist: roadDist, cells: cells, trees: trees };
  }

  function addTerrain(sc, T) {
    var cells = T.cells;
    for (var i = 0; i < cells.length; i++) sc.face(cells[i].q, cells[i].col, { temp: cells[i].temp });
    for (i = 0; i < T.trees.length; i++) addTree(sc, T.trees[i]);
  }

  // Tree: trunk plus two stacked cones; v picks the green.
  function addTree(sc, tr) {
    var x = tr[0], y = tr[1], z = tr[2], r = tr[3], h = tr[4], v = tr[5] || 0.5;
    var g1 = mix([34, 66, 32], [58, 92, 40], v), g2 = mix([44, 80, 38], [74, 108, 48], v);
    sc.cyl([x, y + h * 0.18, z], [0, 1, 0], r * 0.12, h * 0.36, 5, [72, 54, 36], { temp: 0.3 }, false);
    sc.cone([x, y + h * 0.28, z], r, h * 0.5, 6, g1, { temp: 0.2 });
    sc.cone([x, y + h * 0.55, z], r * 0.72, h * 0.45, 6, g2, { temp: 0.22 });
  }

  // Quadcopter at pos, heading yaw, props spinning with t, gimbal aimed at o.aim.
  // Returns the gimbal camera centre, its look direction and pan/tilt angles.
  function addDrone(sc, pos, yaw, t, o) {
    o = o || {};
    var Y = [0, 1, 0];
    var sx = rotY([1, 0, 0], yaw), sz = rotY([0, 0, 1], yaw);
    function L(x, y, z) { return add(pos, add(mul(sx, x), add(mul(Y, y), mul(sz, z)))); }
    var dark = [38, 38, 40], shell = [74, 74, 76], arm = [56, 56, 54], orange = [214, 112, 44];
    // Body: lower hull, top shell, battery, nose with the FPV camera.
    sc.boxFrame(L(0, 0, 0), sx, Y, sz, 1.1, 0.26, 1.3, dark, { temp: 0.5 });
    sc.boxFrame(L(0, 0.19, 0.05), sx, Y, sz, 0.82, 0.12, 0.95, shell, { temp: 0.48 });
    sc.boxFrame(L(0, 0.32, -0.25), sx, Y, sz, 0.5, 0.16, 0.7, [30, 30, 34], { temp: 0.78 });
    sc.boxFrame(L(0, 0.0, 0.7), sx, Y, sz, 0.5, 0.18, 0.12, [24, 24, 26], { temp: 0.5 });
    sc.cyl(L(-0.14, 0.0, 0.78), sz, 0.06, 0.06, 8, [8, 10, 14], { temp: 0.35 });
    sc.cyl(L(0.14, 0.0, 0.78), sz, 0.06, 0.06, 8, [8, 10, 14], { temp: 0.35 });
    // Arms, motors, props, LEDs.
    var k, spin = t * 42;
    for (k = 0; k < 4; k++) {
      var ax = k % 2 ? 1 : -1, az = k < 2 ? 1 : -1;
      var root = L(ax * 0.45, 0.02, az * 0.5), tip = L(ax * 1.35, 0.1, az * 1.35);
      sc.beam(root, tip, 0.13, 0.08, arm, { temp: 0.44 });
      sc.cyl(add(tip, [0, 0.1, 0]), Y, 0.16, 0.16, 10, [30, 30, 32], { temp: 0.72 });
      sc.cyl(add(tip, [0, 0.19, 0]), Y, 0.165, 0.02, 10, orange, { temp: 0.72 });
      var hub = add(tip, [0, 0.26, 0]), ang = spin * (k % 2 ? 1 : -1) + k * 1.3;
      sc.box(hub, 1.5, 0.018, 0.1, [205, 205, 200], ang, { a: 0.8, temp: 0.42 });
      sc.box(hub, 0.1, 0.018, 1.5, [205, 205, 200], ang, { a: 0.8, temp: 0.42 });
      sc.cyl(hub, Y, 0.78, 0.006, 14, [220, 220, 215], { a: 0.14, temp: 0.4 });
      // LEDs: green at the front, red at the back.
      sc.boxFrame(add(tip, [0, 0.0, 0]), sx, Y, sz, 0.3, 0.05, 0.3, az > 0 ? [90, 255, 140] : [255, 70, 60], { temp: 0.6 });
    }
    // Landing skids.
    [-1, 1].forEach(function (s) {
      var a = L(s * 0.5, -0.72, 0.55), b = L(s * 0.5, -0.72, -0.55);
      sc.beam(a, b, 0.05, 0.05, [50, 50, 52], { temp: 0.42 });
      sc.beam(L(s * 0.4, -0.13, 0.45), a, 0.05, 0.05, [50, 50, 52], { temp: 0.42 });
      sc.beam(L(s * 0.4, -0.13, -0.45), b, 0.05, 0.05, [50, 50, 52], { temp: 0.42 });
    });
    // Antenna.
    sc.beam(L(0.3, 0.3, -0.55), L(0.38, 0.95, -0.72), 0.025, 0.025, [20, 20, 22], { temp: 0.45 });
    sc.cyl(L(0.38, 0.97, -0.72), Y, 0.035, 0.05, 6, orange, { temp: 0.5 });

    // Gimbal: damping plate, pan motor, roll arm, tilt motor, camera.
    var plate = L(0, -0.17, 0.15), panC = L(0, -0.28, 0.15), camC = L(0, -0.72, 0.15);
    var aim = o.aim || add(camC, rotY([0, -0.6, 1], yaw));
    var d = sub(aim, camC), horiz = Math.sqrt(d[0] * d[0] + d[2] * d[2]) || 1e-6;
    var pan = Math.atan2(d[0], d[2]), tilt = Math.atan2(-d[1], horiz);
    var px = rotY([1, 0, 0], pan), pz = rotY([0, 0, 1], pan);
    sc.boxFrame(plate, sx, Y, sz, 0.5, 0.04, 0.5, [60, 60, 62], { temp: 0.46 });
    sc.cyl(panC, Y, 0.12, 0.14, 10, [34, 34, 36], { temp: 0.66 });
    // Roll arm: across the top, then down one side to the tilt motor.
    var armTop = add(panC, [0, -0.09, 0]), armSide = add(armTop, mul(px, 0.3)), armLow = add(armSide, [0, -0.35, 0]);
    sc.beam(armTop, armSide, 0.07, 0.07, [46, 46, 48], { temp: 0.48 });
    sc.beam(armSide, armLow, 0.07, 0.07, [46, 46, 48], { temp: 0.48 });
    sc.cyl(add(camC, mul(px, 0.26)), px, 0.1, 0.1, 10, [34, 34, 36], { temp: 0.66 });
    // Camera body tilted about the pan-rotated x axis, lens along the look.
    var ty = rotY([0, Math.cos(tilt), Math.sin(tilt)], pan), tz = rotY([0, -Math.sin(tilt), Math.cos(tilt)], pan);
    sc.boxFrame(camC, px, ty, tz, 0.34, 0.3, 0.42, [26, 26, 28], { temp: 0.6 });
    sc.cyl(add(camC, mul(tz, 0.28)), tz, 0.11, 0.16, 12, [18, 18, 20], { temp: 0.44 }, false);
    sc.cyl(add(camC, mul(tz, 0.36)), tz, 0.115, 0.012, 12, orange, { temp: 0.44 });
    sc.cyl(add(camC, mul(tz, 0.37)), tz, 0.09, 0.012, 12, [10, 12, 22], { temp: 0.3 });
    // Shadow blob on the ground, if a height function is given.
    if (o.height) {
      var gy = o.height(pos[0], pos[2]) + 0.04, r = 1.4, q = [];
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c) { q.push([pos[0] + c[0] * r, gy, pos[2] + c[1] * r * 0.8]); });
      sc.face(q.reverse(), [0, 0, 0], { a: 0.28, twoSided: true, temp: 0.12 });
    }
    return { cam: add(camC, mul(tz, 0.38)), look: tz, pan: pan, tilt: tilt, antenna: L(0.38, 1.0, -0.72), motor: add(L(1.35, 0.1, 1.35), [0, 0.2, 0]) };
  }

  // ---------------------------------------------------------------------
  // fpv3d · drone + gimbal camera following a car
  // ---------------------------------------------------------------------

  SPECS.fpv3d = {
    duration: 12,
    init: function (p) {
      function road(s) { return [-24 + 48 * s, 0, 8 * Math.sin(s * 4.2) - 4 + 6 * s]; }
      var T = makeTerrain(21, 24, 56, road, 90, 0.56);
      p.data = { T: T, rand: mulberry32(4), lastConf: 0.95 };
    },
    draw: function (ctx, cw, ch, t, dpr, p) {
      var D = p.data, T = D.T;
      sky(ctx, cw, ch);
      var s = clamp(0.05 + t / 12 * 0.88, 0, 1);
      var carP = T.road(s), carN = T.road(Math.min(1, s + 0.01));
      carP[1] = T.height(carP[0], carP[2]);
      var yaw = Math.atan2(carN[0] - carP[0], carN[2] - carP[2]);
      // Drone trails behind and above the car, with a little sway.
      var back = T.road(Math.max(0, s - 0.12));
      var drone = [back[0] + Math.sin(t * 0.9) * 0.8, 7.5 + Math.sin(t * 1.3) * 0.35, back[2] - 5 + Math.cos(t * 0.7) * 0.6];
      var occ = s > 0.52 && s < 0.61;
      var conf = occ ? lerp(D.lastConf, 0.24, 0.08) : lerp(D.lastConf, 0.93 + 0.05 * Math.sin(t * 4), 0.15);
      D.lastConf = conf;
      var aim = occ ? T.road(Math.min(1, s + 0.012)) : carP;
      aim = [aim[0], carP[1] + 0.4, aim[2]];

      var sc = new Scene();
      addTerrain(sc, T);
      var carCorners = addCar(sc, carP, yaw, [222, 220, 212]);
      var dyaw = Math.atan2(carP[0] - drone[0], carP[2] - drone[2]);
      var G = addDrone(sc, drone, dyaw, t, { aim: aim, height: T.height });
      var gim = G.cam;
      // Field of view cone onto the ground around the aim point.
      var fov = 1.6, foot = [];
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (k) { foot.push([aim[0] + k[0] * fov, aim[1] - 0.3, aim[2] + k[1] * fov]); });
      foot.forEach(function (f) { sc.line(gim, f, 'rgba(111, 243, 214, 0.45)', 1); });
      sc.face(foot.slice().reverse(), [111, 243, 214], { a: 0.14, twoSided: true });
      // Third-person camera orbiting slowly around the drone.
      var orb = 0.9 + t * 0.1, eye = [drone[0] + Math.cos(orb) * 13, drone[1] + 5.5, drone[2] + Math.sin(orb) * 13];
      var cam = camera(eye, mix(drone, carP, 0.5), ch * 0.8);
      render(ctx, sc, cam, { x: 0, y: 0, w: cw, h: ch }, dpr, false, FOG);
      // 3D box around the car (screen-space from its corners).
      var bb = bbox(cam, carCorners, cw / 2, ch / 2);
      if (bb) hudRect(ctx, bb[0] - 4 * dpr, bb[1] - 4 * dpr, bb[2] + 8 * dpr, bb[3] + 8 * dpr, dpr, occ ? ACCENT : HUD, occ, 1);

      // Inset: what the gimbal camera sees.
      var iw = Math.min(cw * 0.36, 210 * dpr), ih = iw * 0.62, ix = cw - 12 * dpr - iw, iy = 12 * dpr;
      ctx.fillStyle = INK; roundRect(ctx, ix - 2 * dpr, iy - 2 * dpr, iw + 4 * dpr, ih + 4 * dpr, 6 * dpr); ctx.fill();
      var gcam = camera(gim, aim, ih * 1.9);
      var near = new Scene(), R2 = 15 * 15;
      for (var fi = 0; fi < sc.faces.length; fi++) { var p0 = sc.faces[fi].pts[0], ddx = p0[0] - aim[0], ddz = p0[2] - aim[2]; if (ddx * ddx + ddz * ddz < R2) near.faces.push(sc.faces[fi]); }
      ctx.save(); roundRect(ctx, ix, iy, iw, ih, 4 * dpr); ctx.clip();
      ctx.fillStyle = '#2d3a26'; ctx.fillRect(ix, iy, iw, ih);
      render(ctx, near, gcam, { x: ix, y: iy, w: iw, h: ih }, dpr);
      var jit = occ ? 0 : 1.2 * dpr;
      var ib = bbox(gcam, carCorners, ix + iw / 2, iy + ih / 2);
      if (ib) {
        if (occ) { var pa = project(gcam, aim, ix + iw / 2, iy + ih / 2); ib = [pa[0] - ib[2] / 2, pa[1] - ib[3] / 2, ib[2], ib[3]]; }
        hudRect(ctx, ib[0] - 3 * dpr + (D.rand() - 0.5) * jit, ib[1] - 3 * dpr + (D.rand() - 0.5) * jit, ib[2] + 6 * dpr, ib[3] + 6 * dpr, dpr, occ ? ACCENT : HUD, occ, 1);
      }
      ctx.restore();
      chip(ctx, 'GIMBAL CAM · 30 FPS', ix + 6 * dpr, iy + 6 * dpr, dpr, { size: 7.5, h: 14 });
      chip(ctx, (occ ? 'PREDICT ' : 'LOCK ') + conf.toFixed(2), ix + iw - 6 * dpr, iy + ih - 20 * dpr, dpr, { size: 7.5, h: 14, align: 'right', color: occ ? ACCENT : HUD });

      var txt = occ ? ['Car under the canopy · the gimbal holds on the Kalman prediction', 'Occluded · predicting']
        : s >= 0.61 && s < 0.68 ? ['Re-acquired on the far side', 'Re-acquired']
        : ['Drone follows · gimbal camera keeps the operator’s target centred', 'Gimbal keeps the target centred'];
      caption(ctx, cw, ch, dpr, txt);
    }
  };

  // ---------------------------------------------------------------------
  // sr3d · car with a roof gimbal sweeping a street, thermal inset at 2x
  // ---------------------------------------------------------------------

  SPECS.sr3d = {
    duration: 11,
    init: function (p) {
      var rand = mulberry32(640), blds = [], i;
      for (i = 0; i < 14; i++) {
        var side = i % 2 ? 1 : -1, z = -30 + i * 4.6 + rand() * 1.5;
        blds.push({ x: side * (7.5 + rand() * 1.5), z: z, w: 4 + rand() * 3, d: 3.5 + rand() * 1.5, h: 4 + rand() * 7, col: [80 + rand() * 30, 76 + rand() * 24, 70 + rand() * 20] });
      }
      var trees = [];
      for (i = 0; i < 10; i++) trees.push({ x: (i % 2 ? 1 : -1) * 5.6, z: -26 + i * 5.3 + rand() * 2 });
      var riders = [];
      for (i = 0; i < 4; i++) riders.push({ lane: (i % 2 ? 1 : -1) * 1.6 + (rand() - 0.5), z0: -6 + i * 7, v: 3.2 + rand() * 1.2 });
      var lo = makeCanvas(64, 40);
      p.data = { blds: blds, trees: trees, riders: riders, lo: lo, loCtx: lo.getContext('2d') };
    },
    draw: function (ctx, cw, ch, t, dpr, p) {
      var D = p.data;
      bg(ctx, cw, ch);
      var carZ = -2 + t * 0.9, pan = 0.55 * Math.sin(t * 0.7);
      var sc = new Scene(), i;
      // Street: ground, road, kerbs, lane marks.
      for (i = -8; i < 8; i++) for (var j = -2; j < 2; j++) {
        var x0 = j * 8, z0 = i * 8;
        sc.face([[x0, 0, z0 + 8], [x0 + 8, 0, z0 + 8], [x0 + 8, 0, z0], [x0, 0, z0]], Math.abs(x0 + 4) < 5 ? [58, 56, 54] : [96, 92, 86], { temp: Math.abs(x0 + 4) < 5 ? 0.66 : 0.4 });
      }
      for (i = -8; i < 8; i++) { var z = i * 8 + 2; sc.box([0, 0.01, z], 0.16, 0.02, 2.2, [220, 215, 200], 0, { temp: 0.8 }); sc.box([-4.6, 0.08, z + 2], 0.3, 0.16, 8, [140, 136, 128], 0, { temp: 0.5 }); sc.box([4.6, 0.08, z + 2], 0.3, 0.16, 8, [140, 136, 128], 0, { temp: 0.5 }); }
      D.blds.forEach(function (b) {
        sc.box([b.x, b.h / 2, b.z], b.w, b.h, b.d, b.col, 0, { temp: 0.32 });
        // Windows on the wall that faces the road.
        var fx = b.x - Math.sign(b.x) * (b.w / 2 + 0.03);
        for (var wy = 1.2; wy < b.h - 0.8; wy += 1.6) for (var wz = b.z - b.d / 2 + 0.6; wz < b.z + b.d / 2 - 0.4; wz += 1.1) sc.box([fx, wy, wz], 0.06, 0.8, 0.6, [40, 44, 52], 0, { temp: 0.55 });
      });
      D.trees.forEach(function (tr) { sc.cyl([tr.x, 0.9, tr.z], [0, 1, 0], 0.12, 1.8, 6, [70, 56, 40], { temp: 0.42 }); sc.cone([tr.x, 1.6, tr.z], 1.1, 2.6, 7, [48, 84, 44], { temp: 0.46 }); });
      // Cyclists: wheels, body, head.
      D.riders.forEach(function (r) {
        var z2 = r.z0 + t * r.v - 2;
        sc.cyl([r.lane, 0.32, z2 - 0.5], [1, 0, 0], 0.32, 0.06, 10, [30, 30, 32], { temp: 0.25 });
        sc.cyl([r.lane, 0.32, z2 + 0.5], [1, 0, 0], 0.32, 0.06, 10, [30, 30, 32], { temp: 0.25 });
        sc.box([r.lane, 1.05, z2], 0.36, 0.7, 0.5, [160, 70, 60], 0.1, { temp: 0.95 });
        sc.cyl([r.lane, 1.55, z2 + 0.1], [0, 1, 0], 0.14, 0.28, 8, [210, 170, 140], { temp: 1.0 });
      });
      // The car with its roof bar and gimbal.
      var carP = [1.8, 0, carZ];
      var carCorners = addCar(sc, carP, 0, [96, 100, 104], 0.5);
      void carCorners;
      sc.beam(add(carP, [-0.55, 0.9, -0.1]), add(carP, [0.55, 0.9, -0.1]), 0.06, 0.06, [170, 170, 165]);
      var gimBase = add(carP, [0, 1.02, -0.1]);
      sc.cyl(gimBase, [0, 1, 0], 0.16, 0.24, 10, [26, 26, 28]);
      var head = add(gimBase, [0, 0.3, 0]);
      sc.box(head, 0.28, 0.3, 0.3, [20, 20, 22], pan);
      var look = rotY([0, -0.12, 1], pan);
      sc.beam(head, add(head, mul(look, 0.26)), 0.16, 0.16, [10, 10, 10]);
      // Frustum.
      var far = add(head, mul(look, 14)), r = norm(cross(look, [0, 1, 0])), u = cross(r, look);
      var fr = [add(add(far, mul(r, -2.6)), mul(u, -1.6)), add(add(far, mul(r, 2.6)), mul(u, -1.6)), add(add(far, mul(r, 2.6)), mul(u, 1.6)), add(add(far, mul(r, -2.6)), mul(u, 1.6))];
      fr.forEach(function (f) { sc.line(head, f, 'rgba(255, 143, 63, 0.5)', 1); });
      sc.face(fr, [255, 143, 63], { a: 0.1, twoSided: true });

      // Three-quarter rear view from above, kept inside the street.
      var orb = t * 0.25, eye = [carP[0] - 1.2 + Math.cos(orb) * 3.2, 3.8 + 0.3 * Math.sin(orb), carP[2] - 7.5];
      var cam = camera(eye, add(carP, [0, 0.9, 3]), ch * 0.9);
      render(ctx, sc, cam, { x: 0, y: 0, w: cw, h: ch }, dpr, false, { col: [16, 13, 12], near: 14, far: 48 });
      var g = ctx.createLinearGradient(0, 0, 0, ch * 0.4); g.addColorStop(0, 'rgba(7,6,5,0.9)'); g.addColorStop(1, 'rgba(7,6,5,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch * 0.4);

      // Inset: thermal view from the gimbal, native (left) vs 2x (right).
      var iw = Math.min(cw * 0.4, 230 * dpr), ih = iw * 0.62, ix = cw - 12 * dpr - iw, iy = 12 * dpr;
      ctx.fillStyle = INK; roundRect(ctx, ix - 2 * dpr, iy - 2 * dpr, iw + 4 * dpr, ih + 4 * dpr, 6 * dpr); ctx.fill();
      var gcam = camera(head, add(head, look), ih * 1.4);
      // Low-res pass into a 64x40 buffer, blown up with nearest-neighbour.
      var lc = D.loCtx; lc.fillStyle = '#060000'; lc.fillRect(0, 0, 64, 40);
      render(lc, sc, camera(head, add(head, look), 40 * 1.4), { x: 0, y: 0, w: 64, h: 40 }, 0.5, true);
      ctx.save(); roundRect(ctx, ix, iy, iw, ih, 4 * dpr); ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(D.lo, ix, iy, iw, ih);
      ctx.imageSmoothingEnabled = true;
      var split = ix + iw * (0.5 + 0.3 * Math.sin(t * 0.8));
      ctx.save(); ctx.beginPath(); ctx.rect(split, iy, ix + iw - split, ih); ctx.clip();
      ctx.fillStyle = '#060000'; ctx.fillRect(ix, iy, iw, ih);
      render(ctx, sc, gcam, { x: ix, y: iy, w: iw, h: ih }, dpr, true);
      ctx.restore();
      ctx.fillStyle = '#fff'; ctx.fillRect(split - dpr, iy, 2 * dpr, ih);
      ctx.restore();
      chip(ctx, 'NATIVE', ix + 6 * dpr, iy + ih - 20 * dpr, dpr, { size: 7.5, h: 14 });
      chip(ctx, '2× ON-DEVICE', ix + iw - 6 * dpr, iy + ih - 20 * dpr, dpr, { size: 7.5, h: 14, align: 'right', color: HUD });
      chip(ctx, 'GIMBAL · THERMAL', ix + 6 * dpr, iy + 6 * dpr, dpr, { size: 7.5, h: 14 });

      caption(ctx, cw, ch, dpr, ['Roof gimbal sweeps the street · the inset is its thermal view, native vs 2×', 'Roof gimbal · native vs 2× inset']);
    }
  };

  // ---------------------------------------------------------------------
  // bin3d · robot arm picking from a bin by camera
  // ---------------------------------------------------------------------

  SPECS.bin3d = {
    duration: 14,
    init: function (p) {
      var parts = [
        { x: -1.9, z: 0.0, y: 0.1, yaw: 0.5, w: 1.0, d: 0.6, conf: 0.96, pick: 1 },
        { x: -1.2, z: 0.75, y: 0.1, yaw: -0.9, w: 0.9, d: 0.55, conf: 0.91, pick: 2 },
        { x: -2.1, z: 0.95, y: 0.1, yaw: 2.2, w: 0.7, d: 0.5, conf: 0.88, pick: 3 },
        { x: -1.35, z: -0.25, y: 0.1, yaw: 1.9, w: 1.0, d: 0.6, conf: 0.47, pick: 0 },
        { x: -1.2, z: -0.1, y: 0.26, yaw: 0.4, w: 0.7, d: 0.5, conf: 0.74, pick: -1 },
        { x: -1.75, z: 0.45, y: 0.26, yaw: 2.8, w: 0.8, d: 0.5, conf: 0.69, pick: -1 }
      ];
      var slots = [[1.7, 0.06, -0.7], [1.7, 0.06, 0.1], [1.7, 0.06, 0.9]];
      p.data = { parts: parts, slots: slots };
    },
    draw: function (ctx, cw, ch, t, dpr, p) {
      var D = p.data;
      bg(ctx, cw, ch);
      var sc = new Scene(), i, j;
      // Table (split so the painter's sort behaves), bin, tray.
      for (i = -3; i < 3; i++) for (j = -3; j < 3; j++) sc.face([[i, 0, j + 1], [i + 1, 0, j + 1], [i + 1, 0, j], [i, 0, j]], [52, 50, 48]);
      var binC = [-1.6, 0, 0.35], bw = 2.4, bd = 2.0, bh = 0.7, wt = 0.06;
      sc.box([binC[0], 0.02, binC[2]], bw, 0.04, bd, [30, 28, 27]);
      sc.box([binC[0] - bw / 2, bh / 2, binC[2]], wt, bh, bd, [78, 74, 70]);
      sc.box([binC[0] + bw / 2, bh / 2, binC[2]], wt, bh, bd, [78, 74, 70]);
      sc.box([binC[0], bh / 2, binC[2] - bd / 2], bw, bh, wt, [78, 74, 70]);
      sc.box([binC[0], bh / 2, binC[2] + bd / 2], bw, bh, wt, [78, 74, 70]);
      sc.box([1.7, 0.03, 0.1], 1.5, 0.06, 2.3, [36, 34, 33]);
      D.slots.forEach(function (s) { sc.box(s, 1.0, 0.02, 0.6, [60, 58, 56]); });
      // Camera over the bin.
      var camP = [binC[0], 3.6, binC[2]];
      sc.box(camP, 0.5, 0.22, 0.3, [230, 226, 220]);
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (k) { sc.line(camP, [binC[0] + k[0] * bw / 2, 0.05, binC[2] + k[1] * bd / 2], 'rgba(111, 243, 214, 0.25)', 1, true); });

      // Pick schedule, same as the 2D version.
      var perceive = smooth(seg(t, 0.4, 1.8)), cycle = 3.6, picked = 0;
      var tool = [-0.4, 1.7, -0.3], attached = null;
      D.parts.forEach(function (P) {
        var pos = [P.x, P.y, P.z], yaw = P.yaw, done = false, moving = false;
        if (P.pick > 0) {
          var t0 = 2.2 + (P.pick - 1) * cycle, u = t - t0, slot = D.slots[P.pick - 1];
          var start = [P.x, P.y, P.z], above = [P.x, 1.6, P.z], sAbove = [slot[0], 1.6, slot[2]], sDown = [slot[0], 0.16, slot[2]];
          if (u > 0) {
            moving = true;
            if (u < 0.6) { tool = mix(above, start, smooth(u / 0.6)); }
            else if (u < 1.1) { attached = P; var f = smooth((u - 0.6) / 0.5); tool = mix(start, above, f); pos = sub(tool, [0, 0.0, 0]); }
            else if (u < 2.3) { attached = P; f = smooth((u - 1.1) / 1.2); tool = mix(above, sAbove, f); tool[1] += Math.sin(f * Math.PI) * 0.4; pos = tool.slice(); yaw = lerp(P.yaw, 0, f); }
            else if (u < 2.8) { attached = P; f = smooth((u - 2.3) / 0.5); tool = mix(sAbove, sDown, f); pos = tool.slice(); yaw = 0; }
            else if (u < 3.3) { f = smooth((u - 2.8) / 0.5); tool = mix(sDown, sAbove, f); pos = sDown.slice(); yaw = 0; done = true; }
            else { pos = sDown.slice(); yaw = 0; done = true; tool = sAbove; }
            if (u >= 2.8) picked++;
          }
        }
        P._pos = pos; P._yaw = yaw; P._done = done; P._moving = moving;
        var metal = P.pick === 0 ? [150, 120, 96] : [176, 172, 164];
        sc.box(add(pos, [0, 0.08, 0]), P.w, 0.14, P.d, metal, yaw);
        sc.box(add(pos, rotY([P.w * 0.25, 0.17, 0], yaw)), P.w * 0.3, 0.06, P.d * 0.5, [120, 116, 110], yaw);
      });
      // Robot arm: base, turret, two links, wrist, tool. Simple planar IK.
      var base = [0.3, 0, -1.6], L1 = 2.3, L2 = 2.1, sh = add(base, [0, 1.15, 0]);
      var W = add(tool, [0, 0.55, 0]), rel = sub(W, sh), r = Math.hypot(rel[0], rel[2]), dz = rel[1];
      var Dd = Math.min(Math.hypot(r, dz), L1 + L2 - 0.05);
      var yawA = Math.atan2(rel[0], rel[2]), dirR = [Math.sin(yawA), 0, Math.cos(yawA)];
      var a1 = Math.atan2(dz, r) + Math.acos(clamp((L1 * L1 + Dd * Dd - L2 * L2) / (2 * L1 * Dd), -1, 1));
      var E = add(sh, add(mul(dirR, Math.cos(a1) * L1), [0, Math.sin(a1) * L1, 0]));
      sc.cyl(add(base, [0, 0.2, 0]), [0, 1, 0], 0.5, 0.4, 14, [40, 38, 36]);
      sc.cyl(add(base, [0, 0.75, 0]), [0, 1, 0], 0.34, 0.7, 12, [235, 232, 226]);
      sc.cyl(sh, cross(dirR, [0, 1, 0]), 0.3, 0.42, 12, [40, 38, 36]);
      sc.beam(sh, E, 0.34, 0.3, [235, 232, 226]);
      sc.cyl(E, cross(dirR, [0, 1, 0]), 0.24, 0.4, 12, [40, 38, 36]);
      sc.beam(E, W, 0.26, 0.24, [235, 232, 226]);
      sc.cyl(W, cross(dirR, [0, 1, 0]), 0.18, 0.3, 10, [40, 38, 36]);
      sc.beam(W, add(tool, [0, 0.06, 0]), 0.1, 0.1, [60, 58, 56]);
      sc.cyl(add(tool, [0, 0.2, 0]), [0, 1, 0], 0.14, 0.08, 10, [255, 143, 63]);

      var orb = 0.75 + 0.18 * Math.sin(t * 0.35), eye = [Math.cos(orb) * 6.2, 4.4, Math.sin(orb) * 6.2 - 0.6];
      var cam = camera(eye, [-0.2, 0.5, 0.1], ch * 1.05);
      render(ctx, sc, cam, { x: 0, y: 0, w: cw, h: ch }, dpr);

      // Perception overlays in screen space: pose axes and confidence per part.
      if (perceive > 0) D.parts.forEach(function (P) {
        if (P._done || P._moving) return;
        var c = add(P._pos, [0, 0.18, 0]), ax = rotY([0.45 * perceive, 0, 0], P._yaw), az = rotY([0, 0, 0.45 * perceive], P._yaw);
        var pc = project(cam, c, cw / 2, ch / 2), px = project(cam, add(c, ax), cw / 2, ch / 2), pz = project(cam, add(c, az), cw / 2, ch / 2), py = project(cam, add(c, [0, 0.45 * perceive, 0]), cw / 2, ch / 2);
        if (!pc || !px || !pz || !py) return;
        ctx.lineWidth = 1.5 * dpr;
        ctx.strokeStyle = ACCENT; ctx.beginPath(); ctx.moveTo(pc[0], pc[1]); ctx.lineTo(px[0], px[1]); ctx.stroke();
        ctx.strokeStyle = HUD; ctx.beginPath(); ctx.moveTo(pc[0], pc[1]); ctx.lineTo(py[0], py[1]); ctx.stroke();
        ctx.strokeStyle = PAPER; ctx.beginPath(); ctx.moveTo(pc[0], pc[1]); ctx.lineTo(pz[0], pz[1]); ctx.stroke();
        ctx.beginPath(); ctx.arc(pc[0], pc[1], 4 * dpr, 0, TAU); ctx.stroke();
        if (perceive > 0.7) chip(ctx, (P.pick === 0 ? 'DEFER · ' : '') + P.conf.toFixed(2), pc[0] + 8 * dpr, pc[1] - 24 * dpr, dpr, { size: 8, h: 15, color: P.pick === 0 ? ACCENT : HUD, border: P.pick === 0 ? ACCENT : null });
      });
      chip(ctx, 'picked ' + picked + ' · deferred 1 · fixtures 0', cw - 12 * dpr, 10 * dpr, dpr, { size: 9, h: 18, align: 'right' });
      var txt = t < 2.0 ? ['Camera only · pose and suction point estimated for every part', 'Pose + grasp per part']
        : picked >= 3 ? ['Three parts placed · the doubtful one was deferred, not guessed', 'Placed 3 · deferred 1']
        : ['Pick ' + Math.min(3, picked + 1) + ' of 3 · highest confidence first', 'Pick ' + Math.min(3, picked + 1) + '/3'];
      caption(ctx, cw, ch, dpr, txt);
    }
  };

  // Shared with js/hero3d.js, which draws the draggable object in the hero.
  window.R3D = { Scene: Scene, camera: camera, project: project, render: render, bbox: bbox, sky: sky, FOG: FOG, makeTerrain: makeTerrain, addTerrain: addTerrain, addTree: addTree, addDrone: addDrone, addCar: addCar, hudRectFn: hudRect, roundRect: roundRect, caption: caption, add: add, sub: sub, mul: mul, cross: cross, norm: norm, mix: mix, rotY: rotY, lerp: lerp, smooth: smooth, chip: chip, text: text, hudRect: hudRect, panel: panel, makeNoise: makeNoise, lutColor: lutColor, HOT: HOT, TURBO: TURBO, IRONBOW: IRONBOW };
};
