/* Section motifs drawn live:
   - [data-flight]     a flight path through the experience waypoints (SVG)
   - [data-pointcloud] a point cloud that settles into the e-mail address */
(function () {
  'use strict';
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var NS = 'http://www.w3.org/2000/svg';

  // ---------- Flight path ----------
  document.querySelectorAll('[data-flight]').forEach(function (box) {
    var items = box.querySelectorAll('.tl-item');
    if (!items.length) return;
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'flightpath'); svg.setAttribute('aria-hidden', 'true');
    box.insertBefore(svg, box.firstChild);
    var path = document.createElementNS(NS, 'path'); path.setAttribute('class', 'fp-line');
    var glow = document.createElementNS(NS, 'path'); glow.setAttribute('class', 'fp-glow');
    svg.appendChild(glow); svg.appendChild(path);
    var marks = document.createElementNS(NS, 'g'); svg.appendChild(marks);
    function layout() {
      var H = box.offsetHeight, W = 64;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('width', W); svg.setAttribute('height', H);
      var pts = [];
      items.forEach(function (it, i) { pts.push([i % 2 ? 44 : 20, it.offsetTop + 26]); });
      var d = '';
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        if (i === 0) { d += 'M' + p[0] + ' ' + (p[1] - 40) + ' L' + p[0] + ' ' + p[1]; continue; }
        var q = pts[i - 1], my = (q[1] + p[1]) / 2;
        d += ' C' + q[0] + ' ' + my + ' ' + p[0] + ' ' + my + ' ' + p[0] + ' ' + p[1];
      }
      path.setAttribute('d', d); glow.setAttribute('d', d);
      while (marks.firstChild) marks.removeChild(marks.firstChild);
      pts.forEach(function (p, i) {
        var ring = document.createElementNS(NS, 'circle');
        ring.setAttribute('cx', p[0]); ring.setAttribute('cy', p[1]); ring.setAttribute('r', i === 0 ? 7 : 5);
        ring.setAttribute('class', 'fp-wp' + (i === 0 ? ' fp-now' : ''));
        marks.appendChild(ring);
        var dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('cx', p[0]); dot.setAttribute('cy', p[1]); dot.setAttribute('r', 1.8); dot.setAttribute('class', 'fp-dot');
        marks.appendChild(dot);
      });
      // A small quadcopter glyph at the current waypoint.
      var p0 = pts[0], g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'fp-drone');
      g.setAttribute('transform', 'translate(' + p0[0] + ' ' + (p0[1] - 22) + ')');
      [[-6, -6], [6, -6], [-6, 6], [6, 6]].forEach(function (c) {
        var l = document.createElementNS(NS, 'line'); l.setAttribute('x1', 0); l.setAttribute('y1', 0); l.setAttribute('x2', c[0]); l.setAttribute('y2', c[1]); g.appendChild(l);
        var r = document.createElementNS(NS, 'circle'); r.setAttribute('cx', c[0]); r.setAttribute('cy', c[1]); r.setAttribute('r', 3.2); g.appendChild(r);
      });
      var body = document.createElementNS(NS, 'rect'); body.setAttribute('x', -3); body.setAttribute('y', -2.2); body.setAttribute('width', 6); body.setAttribute('height', 4.4); body.setAttribute('rx', 1); g.appendChild(body);
      marks.appendChild(g);
      // Dash animation length.
      var len = path.getTotalLength ? path.getTotalLength() : 2000;
      path.style.strokeDasharray = '6 7';
      glow.style.strokeDasharray = len; glow.style.strokeDashoffset = reduceMotion ? 0 : len;
      box._len = len;
    }
    layout();
    if ('ResizeObserver' in window) new ResizeObserver(layout).observe(box);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
    if ('IntersectionObserver' in window && !reduceMotion) {
      new IntersectionObserver(function (entries, obs) {
        if (!entries[0].isIntersecting) return;
        obs.disconnect();
        glow.style.transition = 'stroke-dashoffset 2.4s cubic-bezier(.2,.8,.2,1)';
        glow.style.strokeDashoffset = 0;
      }, { threshold: 0.1 }).observe(box);
    }
  });

  // ---------- Point cloud that becomes the e-mail ----------
  document.querySelectorAll('[data-pointcloud]').forEach(function (wrap) {
    var link = wrap.querySelector('a');
    if (!link || reduceMotion) { wrap.classList.add('is-done'); return; }
    var canvas = document.createElement('canvas');
    canvas.className = 'pointcloud'; canvas.setAttribute('aria-hidden', 'true');
    wrap.insertBefore(canvas, link);
    var ctx = canvas.getContext('2d');
    var pts = [], W = 0, H = 0, dpr = 1, t0 = 0, raf = 0, started = false;

    function sample() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      var r = link.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      W = Math.max(1, Math.round(wr.width * dpr)); H = Math.max(1, Math.round(wr.height * dpr));
      canvas.width = W; canvas.height = H;
      var off = document.createElement('canvas'); off.width = W; off.height = H;
      var o = off.getContext('2d');
      var cs = getComputedStyle(link);
      o.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + (parseFloat(cs.fontSize) * dpr) + 'px ' + cs.fontFamily;
      o.textBaseline = 'alphabetic'; o.fillStyle = '#fff';
      var text = link.textContent.replace(/\s*→\s*$/, '').trim();
      var baseline = (r.top - wr.top) * dpr + parseFloat(cs.fontSize) * dpr * 0.78;
      o.fillText(text, (r.left - wr.left) * dpr, baseline);
      var img = o.getImageData(0, 0, W, H).data, step = Math.max(3, Math.round(3.2 * dpr));
      pts = [];
      for (var y = 0; y < H; y += step) for (var x = 0; x < W; x += step) {
        if (img[(y * W + x) * 4 + 3] > 120) {
          var a = Math.random() * Math.PI * 2, d = (0.4 + Math.random() * 0.9);
          pts.push({ tx: x, ty: y, sx: W / 2 + Math.cos(a) * W * 0.55 * d, sy: H / 2 + Math.sin(a) * H * 1.6 * d, hue: Math.random() });
        }
      }
    }
    function frame(now) {
      if (!t0) t0 = now;
      var x = Math.min(1, (now - t0) / 2200), k = 1 - Math.pow(1 - x, 3);
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i], kk = Math.min(1, Math.max(0, (k - p.hue * 0.25) / 0.75));
        var px = p.sx + (p.tx - p.sx) * kk, py = p.sy + (p.ty - p.sy) * kk;
        ctx.fillStyle = p.hue < 0.3 ? 'rgba(240,107,208,0.9)' : 'rgba(94,231,214,0.9)';
        ctx.fillRect(px, py, 1.6 * dpr, 1.6 * dpr);
      }
      if (x < 1) raf = requestAnimationFrame(frame);
      else { wrap.classList.add('is-done'); setTimeout(function () { ctx.clearRect(0, 0, W, H); }, 900); }
    }
    function go() { if (started) return; started = true; sample(); raf = requestAnimationFrame(frame); }
    if ('IntersectionObserver' in window) new IntersectionObserver(function (entries, obs) { if (entries[0].isIntersecting) { obs.disconnect(); go(); } }, { threshold: 0.5 }).observe(wrap);
    else go();
  });
})();
