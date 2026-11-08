/* Hero scene: a quadcopter with a stabilised LWIR gimbal follows a car round a
   loop road at dusk and locks onto it. Drawn with the small 3D renderer that
   js/work.js exposes through window.R3D; the models live here.

   Every lap runs the tracker's states:
     SEARCH    the gimbal sweeps the road
     ACQUIRE   a detection on the car, the box closes in
     LOCKED    brackets on, designator ring under the car, range tether
     COAST     under the tree canopy: a Kalman prediction carries the box on,
               drifting from the bend because it extrapolates straight
     REACQUIRE the detector finds the car again and the box snaps back

   Layers (buttons with [data-layer]) re-render the same scene:
     rgb        shaded, with distance fog, headlights and LEDs
     depth      every surface coloured by distance (turbo colormap)
     keypoints  sparse features with their frame-to-frame flow
     tracks     the car's trajectory, the drone's, and the predicted path
     thermal    Ironbow: hot engine, tyres and motors
   The inset, top right, is the gimbal camera's own zoomed view in LWIR.
   Drag or arrow keys orbit; it drifts slowly when left alone. */
(function () {
  'use strict';

  var R = window.R3D;
  var canvas = document.getElementById('heroCanvas');
  var stage = document.getElementById('heroStage');
  if (!R || !canvas || !stage || !canvas.getContext) return;

  var ctx = canvas.getContext('2d');
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var TAU = Math.PI * 2;
  var MONO = '"IBM Plex Mono", ui-monospace, monospace';
  var CYAN = '#5ee7d6', LIME = '#b6f36a', AMBER = '#ffb547', MAGENTA = '#f06bd0';
  var PAPER = 'rgba(232, 237, 242, 0.92)', FAINT = 'rgba(232, 237, 242, 0.55)', INK = '#0b0f13';
  var add = R.add, sub = R.sub, mul = R.mul, mix = R.mix, lerp = R.lerp, norm = R.norm, cross = R.cross, rotY = R.rotY;
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function seg(x, a, b) { return clamp((x - a) / (b - a), 0, 1); }

  var ui = {
    pan: document.getElementById('hPan'),
    tilt: document.getElementById('hTilt'),
    lock: document.getElementById('hLock'),
    layers: document.querySelectorAll('[data-layer]'),
    hint: document.getElementById('heroHint')
  };

  // ---------- World ----------
  function road(s) { var a = s * TAU; return [15 * Math.cos(a) + 2.5 * Math.sin(2 * a), 0, 10.5 * Math.sin(a) + 1.6 * Math.cos(3 * a)]; }
  var OCC0 = 0.285, OCC1 = 0.335, LAP = 0.033, M_PER_UNIT = 4.2;
  var T = R.makeTerrain(7, 26, 52, road, 0, undefined);
  var rnd = (function () { var a = 977; return function () { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  var TREES = [];
  (function () {
    var i, tx, tz;
    for (i = 0; i < 62; i++) { tx = (rnd() - 0.5) * 50; tz = (rnd() - 0.5) * 50; if (T.roadDist(tx, tz) > 3.2) TREES.push([tx, T.height(tx, tz), tz, 0.7 + rnd() * 0.9, 2.2 + rnd() * 2.4, rnd(), false]); }
    var cq = road((OCC0 + OCC1) / 2);
    for (i = 0; i < 8; i++) { var a = rnd() * TAU, r = 2.2 + rnd() * 2.2; tx = cq[0] + Math.cos(a) * r * 1.4; tz = cq[2] + Math.sin(a) * r; if (T.roadDist(tx, tz) > 1.8) TREES.push([tx, T.height(tx, tz), tz, 1.3 + rnd() * 0.6, 3.6 + rnd() * 1.2, rnd(), true]); }
    // Canopy over the road itself: broad crowns the car drives under.
    [-0.014, 0, 0.014].forEach(function (d) { var p = road((OCC0 + OCC1) / 2 + d); TREES.push([p[0] + 0.3, T.height(p[0], p[2]), p[2] - 0.2, 1.9, 4.2, 0.3, true]); });
  })();
  // Static keypoints: terrain corners and tree tops.
  var KP = [];
  for (var ci = 0; ci < T.cells.length; ci += 3) { var q0 = T.cells[ci].q[0]; KP.push([q0[0], q0[1] + 0.04, q0[2]]); }
  for (var ti = 0; ti < TREES.length; ti++) { var tr = TREES[ti]; KP.push([tr[0], tr[1] + tr[4], tr[2]]); }
  var kpPrev = new Float32Array(KP.length * 2 + 128), kpHave = false;
  var carTrail = [], droneTrail = [];
  // Road samples for the lane markings.
  var RS = [];
  (function () {
    for (var i = 0; i <= 240; i++) {
      var s = i / 240, p = road(s), q = road((s + 1 / 480) % 1), d = norm([q[0] - p[0], 0, q[2] - p[2]]);
      RS.push({ p: [p[0], T.height(p[0], p[2]) + 0.035, p[2]], n: [d[2], 0, -d[0]] });
    }
  })();

  // ---------- State ----------
  var orbit = { yaw: 0, pitch: 0.3, vyaw: 0, vpitch: 0 };
  var lastInput = -1e9, dragging = false, px = 0, py = 0, moved = 0;
  var mode = 'rgb';
  var simT = 0.4, lastNow = 0, rafId = 0, running = false, visible = true;
  var dpr = 1, cw = 1, ch = 1, conf = 0;
  var seed = 11;
  var jitter = R.makeNoise(function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }, 16);

  function fmtDeg(v) { var d = v * 180 / Math.PI; return (d < 0 ? '−' : '+') + Math.abs(d).toFixed(1) + '°'; }
  function rrect(x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }

  // ---------- Models ----------
  // A face whose winding is flipped if needed so its normal points away from ctr.
  function newell(pts) {
    var n = [0, 0, 0];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return n;
  }
  function faceOut(sc, pts, ctr, col, extra) {
    var c = [0, 0, 0];
    pts.forEach(function (p) { c = add(c, p); });
    c = mul(c, 1 / pts.length);
    // The renderer draws a face when cross(p1-p0, p2-p0) faces the eye; Newell's normal has the same
    // orientation, so make it point away from the part's centre.
    if (dot(newell(pts), sub(c, ctr)) < 0) pts = pts.slice().reverse();
    return sc.face(pts, col, extra);
  }
  function prism(sc, L, prof, y0, y1, col, extra, ctr) {
    var top = prof.map(function (q) { return L(q[0], y1, q[1]); }), bot = prof.map(function (q) { return L(q[0], y0, q[1]); });
    faceOut(sc, top, ctr, col, extra); faceOut(sc, bot, ctr, col, extra);
    for (var i = 0; i < prof.length; i++) { var j = (i + 1) % prof.length; faceOut(sc, [bot[i], bot[j], top[j], top[i]], ctr, col, extra); }
  }
  function disc(c, u, v, r, n) { var pts = []; for (var i = 0; i < n; i++) { var a = i / n * TAU; pts.push(add(c, add(mul(u, Math.cos(a) * r), mul(v, Math.sin(a) * r)))); } return pts; }

  // Sedan: a profiled body and a glass cabin, turning wheels, lights. Length 2.3 units.
  function addSedan(sc, pos, yaw, wheelA, paint) {
    function L(x, y, z) { var p = rotY([x, y, z], yaw); return [pos[0] + p[0], pos[1] + p[1], pos[2] + p[2]]; }
    var ctr = L(0, 0.42, 0), glass = [30, 40, 52], i;
    var P = [[-1.15, 0.17], [-1.16, 0.47], [-1.02, 0.57], [-0.6, 0.6], [0.42, 0.6], [0.98, 0.53], [1.15, 0.42], [1.15, 0.17]], hw = 0.5;
    faceOut(sc, P.map(function (q) { return L(-hw, q[1], q[0]); }), ctr, paint, { temp: 0.42 });
    faceOut(sc, P.map(function (q) { return L(hw, q[1], q[0]); }), ctr, paint, { temp: 0.42 });
    for (i = 0; i < P.length; i++) {
      var j = (i + 1) % P.length, hood = i === 4 || i === 5, bottom = j === 0;
      faceOut(sc, [L(-hw, P[i][1], P[i][0]), L(hw, P[i][1], P[i][0]), L(hw, P[j][1], P[j][0]), L(-hw, P[j][1], P[j][0])], ctr, bottom ? [16, 16, 18] : paint, { temp: hood ? 0.92 : bottom ? 0.6 : 0.44 });
    }
    var C = [[-0.6, 0.6], [-0.36, 0.88], [0.1, 0.9], [0.42, 0.6]], cw2 = 0.42, cctr = L(0, 0.72, -0.1);
    faceOut(sc, C.map(function (q) { return L(-cw2, q[1], q[0]); }), cctr, glass, { temp: 0.36 });
    faceOut(sc, C.map(function (q) { return L(cw2, q[1], q[0]); }), cctr, glass, { temp: 0.36 });
    [[0, 1, glass], [1, 2, paint], [2, 3, glass]].forEach(function (e) {
      faceOut(sc, [L(-cw2, C[e[0]][1], C[e[0]][0]), L(cw2, C[e[0]][1], C[e[0]][0]), L(cw2, C[e[1]][1], C[e[1]][0]), L(-cw2, C[e[1]][1], C[e[1]][0])], cctr, e[2], { temp: e[2] === glass ? 0.34 : 0.4 });
    });
    // Wheels with a turning spoke and a hubcap.
    var ax = rotY([1, 0, 0], yaw), up = [0, 1, 0], fw = rotY([0, 0, 1], yaw);
    [[-0.5, 0.72], [0.5, 0.72], [-0.5, -0.74], [0.5, -0.74]].forEach(function (w) {
      var c = L(w[0], 0.19, w[1]), side = w[0] < 0 ? -1 : 1;
      sc.cyl(c, ax, 0.19, 0.17, 12, [20, 20, 22], { temp: 0.7 });
      var hub = add(c, mul(ax, side * 0.088));
      sc.cyl(hub, ax, 0.105, 0.012, 10, [148, 150, 154], { temp: 0.6 });
      var ca = Math.cos(wheelA), sa = Math.sin(wheelA), tt = add(mul(up, ca), mul(fw, sa)), uu = add(mul(up, -sa), mul(fw, ca));
      sc.boxFrame(add(hub, mul(ax, side * 0.008)), ax, tt, uu, 0.012, 0.19, 0.04, [70, 72, 76], { temp: 0.6 });
    });
    // Lights and mirrors.
    [-1, 1].forEach(function (sd) {
      faceOut(sc, [L(sd * 0.22, 0.37, 1.152), L(sd * 0.42, 0.37, 1.152), L(sd * 0.42, 0.45, 1.13), L(sd * 0.22, 0.45, 1.13)], L(0, 0.4, 0), [255, 238, 196], { temp: 0.88 });
      faceOut(sc, [L(sd * 0.24, 0.42, -1.162), L(sd * 0.44, 0.42, -1.162), L(sd * 0.44, 0.5, -1.15), L(sd * 0.24, 0.5, -1.15)], L(0, 0.45, 0), [220, 36, 40], { temp: 0.7 });
      sc.boxFrame(L(sd * 0.55, 0.64, 0.38), ax, up, fw, 0.09, 0.06, 0.05, paint, { temp: 0.4 });
    });
    var corners = [];
    [[-0.5, -1.16], [0.5, -1.16], [0.5, 1.16], [-0.5, 1.16]].forEach(function (k) { corners.push(L(k[0], 0.02, k[1])); corners.push(L(k[0], 0.9, k[1])); });
    return { corners: corners, center: L(0, 0.45, 0), head: [L(0.32, 0.41, 1.17), L(-0.32, 0.41, 1.17)], tail: [L(0.34, 0.46, -1.17), L(-0.34, 0.46, -1.17)], fw: fw, ax: ax };
  }

  // Quadcopter: X frame, motors, blurred props, battery, GNSS mast, gear, LEDs
  // and a stabilised gimbal. pitch/roll come from the flight; the gimbal ignores them.
  function addQuad(sc, pos, yaw, pitch, roll, t, aim, S) {
    var fx = rotY([1, 0, 0], yaw), fy = [0, 1, 0], fz = rotY([0, 0, 1], yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    var Z = add(mul(fz, cp), mul(fy, -sp)), Y1 = add(mul(fz, sp), mul(fy, cp));
    var X = add(mul(fx, cr), mul(Y1, sr)), Y = add(mul(fx, -sr), mul(Y1, cr));
    function L(x, y, z) { return add(pos, add(mul(X, x * S), add(mul(Y, y * S), mul(Z, z * S)))); }
    function V(v) { return mul(v, S); }
    var ctr = L(0, 0.05, 0), k;
    var body = [[0.18, 0.6], [0.34, 0.44], [0.34, -0.44], [0.18, -0.6], [-0.18, -0.6], [-0.34, -0.44], [-0.34, 0.44], [-0.18, 0.6]];
    prism(sc, L, body, -0.08, 0.14, [190, 194, 200], { temp: 0.58 }, ctr);
    prism(sc, L, body.map(function (q) { return [q[0] * 0.78, q[1] * 0.82]; }), 0.14, 0.22, [222, 225, 230], { temp: 0.5 }, ctr);
    // Battery with its strap.
    sc.boxFrame(L(0, 0.31, -0.06), X, Y, Z, 0.4 * S, 0.17 * S, 0.56 * S, [28, 30, 34], { temp: 0.8 });
    sc.boxFrame(L(0, 0.31, -0.06), X, Y, Z, 0.42 * S, 0.18 * S, 0.06 * S, [214, 112, 44], { temp: 0.6 });
    // GNSS mast and puck.
    sc.beam(L(0, 0.22, -0.44), L(0, 0.64, -0.5), 0.03 * S, 0.03 * S, [32, 32, 34], { temp: 0.45 });
    sc.cyl(L(0, 0.66, -0.5), Y, 0.11 * S, 0.05 * S, 12, [214, 216, 220], { temp: 0.45 });
    // Arms, motors with metal bells, props as motion-blur discs with the blades.
    var leds = [], motors = [], spin = t * 47;
    for (k = 0; k < 4; k++) {
      var sx = k % 2 ? 1 : -1, sz = k < 2 ? 1 : -1;
      var root = L(sx * 0.26, 0.03, sz * 0.36), M = L(sx * 0.98, 0.1, sz * 0.98);
      sc.beam(root, M, 0.1 * S, 0.07 * S, [62, 64, 70], { temp: 0.5 });
      sc.cyl(M, Y, 0.12 * S, 0.15 * S, 10, [24, 24, 26], { temp: 0.88 });
      sc.cyl(add(M, V(mul(Y, 0.1))), Y, 0.115 * S, 0.05 * S, 10, [152, 154, 158], { temp: 0.84 });
      var H = add(M, V(mul(Y, 0.17)));
      sc.face(disc(H, X, Z, 0.66 * S, 22), [206, 212, 218], { a: 0.11, twoSided: true, temp: 0.42 });
      var ang = spin * (sx * sz > 0 ? 1 : -1) + k * 0.9, bd = add(mul(X, Math.cos(ang)), mul(Z, Math.sin(ang))), bp = add(mul(X, -Math.sin(ang)), mul(Z, Math.cos(ang)));
      var a0 = add(H, V(mul(bd, 0.62))), a1 = add(H, V(mul(bd, -0.62))), w = V(mul(bp, 0.05));
      sc.face([add(a0, w), sub(a0, w), sub(a1, w), add(a1, w)], [26, 28, 30], { a: 0.45, twoSided: true, temp: 0.42 });
      var ledP = add(M, V(mul(Y, -0.12)));
      sc.boxFrame(ledP, X, Y, Z, 0.08 * S, 0.04 * S, 0.08 * S, sz > 0 ? [90, 255, 150] : [255, 70, 60], { temp: 0.6 });
      leds.push({ p: ledP, c: sz > 0 ? '90, 255, 150' : '255, 70, 60' });
      motors.push(M);
    }
    // Landing gear.
    [-1, 1].forEach(function (s2) {
      sc.beam(L(s2 * 0.2, -0.08, 0.24), L(s2 * 0.44, -0.6, 0.28), 0.045 * S, 0.045 * S, [34, 34, 36], { temp: 0.45 });
      sc.beam(L(s2 * 0.2, -0.08, -0.24), L(s2 * 0.44, -0.6, -0.28), 0.045 * S, 0.045 * S, [34, 34, 36], { temp: 0.45 });
      sc.beam(L(s2 * 0.44, -0.6, 0.46), L(s2 * 0.44, -0.6, -0.46), 0.05 * S, 0.05 * S, [34, 34, 36], { temp: 0.45 });
    });
    // Gimbal, stabilised in the world frame: pan, a roll arm, tilt, camera.
    sc.boxFrame(L(0, -0.12, 0.36), X, Y, Z, 0.32 * S, 0.03 * S, 0.32 * S, [58, 58, 60], { temp: 0.5 });
    var panC = L(0, -0.2, 0.36), camC = L(0, -0.44, 0.36);
    sc.cyl(panC, Y, 0.09 * S, 0.1 * S, 10, [30, 30, 32], { temp: 0.7 });
    var d = sub(aim, camC), horiz = Math.sqrt(d[0] * d[0] + d[2] * d[2]) || 1e-6;
    var pan = Math.atan2(d[0], d[2]), tilt = Math.atan2(-d[1], horiz);
    var gx = rotY([1, 0, 0], pan), gy = rotY([0, Math.cos(tilt), Math.sin(tilt)], pan), gz = rotY([0, -Math.sin(tilt), Math.cos(tilt)], pan);
    var armTop = add(panC, [0, -0.06 * S, 0]), armSide = add(armTop, mul(gx, 0.22 * S)), armLow = add(armSide, [0, -0.18 * S, 0]);
    sc.beam(armTop, armSide, 0.055 * S, 0.055 * S, [44, 44, 46], { temp: 0.5 });
    sc.beam(armSide, armLow, 0.055 * S, 0.055 * S, [44, 44, 46], { temp: 0.5 });
    sc.cyl(add(camC, mul(gx, 0.19 * S)), gx, 0.08 * S, 0.08 * S, 10, [30, 30, 32], { temp: 0.7 });
    sc.boxFrame(camC, gx, gy, gz, 0.3 * S, 0.26 * S, 0.34 * S, [26, 26, 28], { temp: 0.62 });
    sc.cyl(add(camC, mul(gz, 0.22 * S)), gz, 0.09 * S, 0.12 * S, 12, [16, 16, 18], { temp: 0.45 }, false);
    sc.cyl(add(camC, mul(gz, 0.29 * S)), gz, 0.095 * S, 0.012 * S, 12, [214, 112, 44], { temp: 0.45 });
    sc.cyl(add(camC, mul(gz, 0.3 * S)), gz, 0.075 * S, 0.01 * S, 12, [24, 34, 70], { temp: 0.3 });
    return { cam: add(camC, mul(gz, 0.31 * S)), look: gz, pan: pan, tilt: tilt, mast: L(0, 0.7, -0.5), leds: leds, motors: motors, center: ctr, strobe: L(0, -0.1, -0.62) };
  }

  // Tree: trunk and three stacked crowns.
  function addTree(sc, tr, alpha) {
    var x = tr[0], y = tr[1], z = tr[2], r = tr[3], h = tr[4], v = tr[5], ex = alpha < 1 ? { a: alpha } : null;
    function E(temp) { var o = { temp: temp }; if (ex) o.a = ex.a; return o; }
    var g1 = mix([30, 58, 30], [52, 84, 38], v), g2 = mix([38, 70, 34], [62, 96, 44], v), g3 = mix([46, 82, 40], [76, 108, 50], v);
    sc.cyl([x, y + h * 0.16, z], [0, 1, 0], r * 0.11, h * 0.32, 6, [70, 52, 36], E(0.3), false);
    sc.cone([x, y + h * 0.24, z], r, h * 0.36, 8, g1, E(0.2));
    sc.cone([x, y + h * 0.44, z], r * 0.78, h * 0.33, 8, g2, E(0.21));
    sc.cone([x, y + h * 0.62, z], r * 0.52, h * 0.38, 7, g3, E(0.22));
  }

  // ---------- Kinematics ----------
  function carState(t) {
    var s = (t * LAP) % 1, p = road(s), q = road((s + 0.004) % 1);
    var d = norm([q[0] - p[0], 0, q[2] - p[2]]), right = [d[2], 0, -d[0]];
    var pos = add(p, mul(right, -0.55));
    pos[1] = T.height(pos[0], pos[2]);
    return { s: s, pos: pos, yaw: Math.atan2(d[0], d[2]), dir: d };
  }
  function dronePos(t) {
    var b = carState(t - 1.9).pos;
    return [b[0] + Math.sin(t * 0.7) * 1.0, 3.7 + Math.sin(t * 1.1) * 0.3 + Math.sin(t * 0.37) * 0.35, b[2] + Math.cos(t * 0.55) * 1.0];
  }

  // Tracker state for a lap position.
  function trackState(s, t, car) {
    var st, c, aim = car.pos, sAcq = 0.05, sLock = 0.088;
    if (s < sAcq) {
      st = 'SEARCH';
      var u = s / sAcq, sw = (1 - smooth(u)) * 3.2;
      aim = add(car.pos, [Math.sin(t * 2.3) * sw, 0, Math.cos(t * 1.7) * sw]);
      c = 0;
    } else if (s < sLock) {
      st = 'ACQUIRE'; c = 0.25 + 0.65 * smooth(seg(s, sAcq, sLock));
    } else if (s >= OCC0 && s < OCC1) {
      st = 'COAST';
      // Constant-velocity prediction from the last measurement before the canopy.
      var tin = t - (s - OCC0) / LAP, cin = carState(tin), v = mul(cin.dir, (LAP * 2 * Math.PI * 12.8)), dt = t - tin;
      aim = add(cin.pos, mul(v, dt));
      aim[1] = T.height(aim[0], aim[2]);
      c = 0.62 - 0.4 * seg(s, OCC0, OCC1);
    } else if (s >= OCC1 && s < OCC1 + 0.025) {
      st = 'REACQ'; c = 0.86;
    } else { st = 'LOCKED'; c = 0.94 + 0.03 * Math.sin(t * 3.7); }
    return { st: st, aim: aim, conf: c, acq: st === 'ACQUIRE' ? seg(s, sAcq, sLock) : 1 };
  }

  // ---------- Drawing helpers ----------
  var placed = [];
  function callout(cam, cx, cy, anchor, label, dx, dy, color) {
    var q = R.project(cam, anchor, cx, cy);
    if (!q) return;
    var lx = q[0] + dx * dpr, ly = q[1] + dy * dpr;
    ctx.font = '500 ' + Math.round(10 * dpr) + 'px ' + MONO;
    var tw = ctx.measureText(label).width, pad = 6 * dpr;
    var right = dx >= 0;
    if (right && lx + tw + pad * 2 > cw - 12 * dpr) { right = false; lx = q[0] - Math.abs(dx) * dpr; }
    if (!right && lx - tw - pad * 2 < 12 * dpr) { right = true; lx = q[0] + Math.abs(dx) * dpr; }
    var bx = right ? lx : lx - tw - pad * 2, by = ly - 9 * dpr, bw = tw + pad * 2, bh = 18 * dpr;
    for (var tries = 0; tries < 8; tries++) {
      var hit = null;
      for (var i = 0; i < placed.length; i++) { var o = placed[i]; if (bx < o.x + o.w + 4 * dpr && bx + bw + 4 * dpr > o.x && by < o.y + o.h + 4 * dpr && by + bh + 4 * dpr > o.y) { hit = o; break; } }
      if (!hit) break;
      by = hit.y + hit.h + 6 * dpr; ly = by + 9 * dpr;
    }
    if (by + bh > ch - 8 * dpr) return;
    placed.push({ x: bx, y: by, w: bw, h: bh });
    ctx.strokeStyle = 'rgba(232, 237, 242, 0.45)'; ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(right ? bx : bx + bw, ly); ctx.stroke();
    ctx.fillStyle = color || CYAN; ctx.beginPath(); ctx.arc(q[0], q[1], 2.4 * dpr, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(11, 15, 19, 0.82)';
    rrect(bx, by, bw, bh, 4 * dpr); ctx.fill();
    ctx.strokeStyle = 'rgba(232, 237, 242, 0.16)'; ctx.stroke();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = color || PAPER;
    ctx.fillText(label, bx + pad, ly + 0.5);
  }

  function chip(text, x, y, align, color, size) {
    ctx.font = '500 ' + Math.round((size || 8.5) * dpr) + 'px ' + MONO;
    var padX = 6 * dpr, h = (size ? size * 1.9 : 16) * dpr, w = ctx.measureText(text).width + padX * 2;
    var bx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    ctx.fillStyle = 'rgba(11, 15, 19, 0.82)';
    rrect(bx, y, w, h, 4 * dpr); ctx.fill();
    ctx.fillStyle = color || PAPER; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(text, bx + padX, y + h / 2 + 0.5);
    return { x: bx, y: y, w: w, h: h };
  }

  function sky() {
    var g = ctx.createLinearGradient(0, 0, 0, ch);
    if (mode === 'thermal') { g.addColorStop(0, '#05000c'); g.addColorStop(1, '#14001f'); }
    else if (mode === 'depth') { g.addColorStop(0, '#120a24'); g.addColorStop(1, '#1b1636'); }
    else { g.addColorStop(0, '#070a10'); g.addColorStop(0.45, '#111823'); g.addColorStop(0.62, '#2a2b33'); g.addColorStop(0.7, '#3a3330'); g.addColorStop(1, '#151a20'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
  }

  // Project a closed ground polygon (world points) and fill it.
  function groundPoly(cam, cx, cy, pts, fill) {
    ctx.beginPath(); var any = false;
    for (var i = 0; i < pts.length; i++) { var q = R.project(cam, pts[i], cx, cy); if (!q) return; if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); any = true; }
    if (!any) return;
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }
  function ringPts(c, rx, rz, rot, n, y) {
    var out = [], cr = Math.cos(rot), sr = Math.sin(rot);
    for (var i = 0; i < n; i++) { var a = i / n * TAU, x = Math.cos(a) * rx, z = Math.sin(a) * rz; out.push([c[0] + cr * x + sr * z, y, c[2] - sr * x + cr * z]); }
    return out;
  }
  function glow(q, r, rgb, a) {
    if (!q) return;
    var g = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], r);
    g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g; ctx.fillRect(q[0] - r, q[1] - r, r * 2, r * 2);
  }

  // ---------- Frame ----------
  var FOG = { col: [30, 33, 40], near: 16, far: 64 };
  function draw() {
    var t = simT;
    sky();
    var car = carState(t), carP = car.pos, s = car.s;
    var drone = dronePos(t), dPrev = dronePos(t - 0.12), dNext = dronePos(t + 0.12);
    var vel = mul(sub(dNext, dPrev), 1 / 0.24), acc = mul(sub(add(dNext, dPrev), mul(drone, 2)), 1 / (0.12 * 0.12));
    var speed = Math.sqrt(vel[0] * vel[0] + vel[2] * vel[2]), heading = Math.atan2(vel[0], vel[2]);
    var fwd = [Math.sin(heading), 0, Math.cos(heading)], rightV = [Math.cos(heading), 0, -Math.sin(heading)];
    var pitch = clamp(speed * 0.06 + dot(acc, fwd) * 0.02, -0.12, 0.32), roll = clamp(-dot(acc, rightV) * 0.045, -0.4, 0.4);
    var trk = trackState(s, t, car);
    conf = trk.conf;
    var locked = trk.st === 'LOCKED' || trk.st === 'REACQ', coast = trk.st === 'COAST', search = trk.st === 'SEARCH';
    var aim = [trk.aim[0], trk.aim[1] + 0.45, trk.aim[2]];
    if (running || !carTrail.length) {
      carTrail.push([carP[0], carP[1] + 0.12, carP[2]]); if (carTrail.length > 260) carTrail.shift();
      droneTrail.push(drone.slice()); if (droneTrail.length > 260) droneTrail.shift();
    }

    // Two passes: the ground first (with markings, shadows, light pools drawn on it), then everything standing on it.
    var ground = new R.Scene(), objs = new R.Scene(), i, q;
    for (i = 0; i < T.cells.length; i++) ground.face(T.cells[i].q, T.cells[i].col, { temp: T.cells[i].temp });
    var wheelA = -t * LAP * TAU * 12.8 / 0.19;
    var CAR = addSedan(objs, carP, car.yaw, wheelA, [196, 34, 38]);
    var G = addQuad(objs, drone, heading, pitch, roll, t, aim, 0.86);
    var fovR = search ? 2.4 : 1.5, foot = [];
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (k) { foot.push([trk.aim[0] + k[0] * fovR, T.height(trk.aim[0], trk.aim[2]) + 0.05, trk.aim[2] + k[1] * fovR]); });

    // Camera: side-on to the pair, following the car's smoothed heading; drag adds an offset.
    var hd = add(add(carState(t - 1.6).dir, carState(t - 0.8).dir), car.dir), baseYaw = Math.atan2(hd[0], hd[2]) - Math.PI / 2;
    var sep = Math.sqrt(Math.pow(drone[0] - carP[0], 2) + Math.pow(drone[1] - carP[1], 2) + Math.pow(drone[2] - carP[2], 2));
    var target = add(mix(drone, carP, 0.5), [0, -0.5, 0]), rad = clamp(sep * 1.05 + 4.2, 8, 13.5), yawC = baseYaw + orbit.yaw;
    var eye = [target[0] + rad * Math.cos(orbit.pitch) * Math.sin(yawC), target[1] + rad * Math.sin(orbit.pitch), target[2] + rad * Math.cos(orbit.pitch) * Math.cos(yawC)];
    var narrow = cw / dpr < 700;
    var cam = R.camera(eye, target, Math.max(Math.min(cw * 0.78, ch * 1.4), ch * 1.12));
    var cx = cw * 0.43, cy = ch * 0.56;
    var RW = 2 * Math.max(cx, cw - cx), RH = 2 * Math.max(cy, ch - cy), rect = { x: cx - RW / 2, y: cy - RH / 2, w: RW, h: RH };
    function P(p) { return R.project(cam, p, cx, cy); }
    var nearCanopy = s > OCC0 - 0.04 && s < OCC1 + 0.03, see = nearCanopy ? 0.32 + 0.68 * (1 - smooth(Math.min(seg(s, OCC0 - 0.04, OCC0), 1 - seg(s, OCC1, OCC1 + 0.03)))) : 1;
    var canopyOpaque = new R.Scene();
    for (i = 0; i < TREES.length; i++) {
      // Trees between the camera and the pair, and the canopy while the car is under it, turn see-through.
      var tx2 = TREES[i][0] - eye[0], tz2 = TREES[i][2] - eye[2], dEye = Math.sqrt(tx2 * tx2 + tz2 * tz2);
      var fg = dEye < rad * 0.82 ? 0.38 : 1, al = Math.min(fg, TREES[i][6] ? see : 1);
      if (al < 1 && mode !== 'thermal') { addTree(objs, TREES[i], al); addTree(canopyOpaque, TREES[i], 1); }
      else addTree(objs, TREES[i], 1);
    }
    var fogArg = mode === 'depth' ? { depth: [5, 34] } : mode === 'thermal' ? undefined : FOG;
    var thermal = mode === 'thermal';
    // Clip rect in R.render is centred on (cx, cy); the canvas is fully covered because the rect is canvas-sized.
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, cw, ch); ctx.clip();
    R.render(ctx, ground, cam, rect, dpr, thermal, fogArg);

    // Lane markings, perspective-width strokes.
    if (mode !== 'depth') {
      for (var side = -1; side <= 1; side++) {
        for (i = 0; i < RS.length - 1; i++) {
          if (side === 0 && (i >> 1) % 2) continue;
          var a = RS[i], b = RS[i + 1], o = side * 1.18, pa = P(add(a.p, mul(a.n, o))), pb = P(add(b.p, mul(b.n, o)));
          if (!pa || !pb) continue;
          var wpx = Math.max(0.5 * dpr, 0.07 * cam.f / ((pa[2] + pb[2]) / 2)), fade = clamp(1 - (pa[2] - 14) / 40, 0.15, 1);
          ctx.strokeStyle = thermal ? 'rgba(255, 190, 90, ' + (0.22 * fade) + ')' : side === 0 ? 'rgba(236, 214, 140, ' + (0.6 * fade) + ')' : 'rgba(225, 228, 230, ' + (0.42 * fade) + ')';
          ctx.lineWidth = wpx;
          ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
        }
      }
    }
    // Soft shadows under the car and the drone.
    var gy = T.height(carP[0], carP[2]) + 0.03;
    groundPoly(cam, cx, cy, ringPts(carP, 0.78, 1.42, car.yaw, 18, gy), 'rgba(0, 0, 0, 0.18)');
    groundPoly(cam, cx, cy, ringPts(carP, 0.6, 1.24, car.yaw, 18, gy), 'rgba(0, 0, 0, 0.26)');
    var dg = T.height(drone[0], drone[2]) + 0.03, hgt = drone[1] - dg, sh = clamp(1 - hgt / 9, 0.25, 0.8);
    groundPoly(cam, cx, cy, ringPts(drone, 0.95, 0.95, 0, 16, dg), 'rgba(0, 0, 0, ' + (0.12 * sh) + ')');
    groundPoly(cam, cx, cy, ringPts(drone, 0.55, 0.55, 0, 16, dg), 'rgba(0, 0, 0, ' + (0.16 * sh) + ')');
    // Headlight pools on the road.
    if (mode === 'rgb') {
      ctx.globalCompositeOperation = 'lighter';
      var hl = add(carP, mul(car.dir, 1.2)), rv = [car.dir[2], 0, -car.dir[0]], far = add(carP, mul(car.dir, 7.5));
      var pool = [add(hl, mul(rv, 0.45)), add(far, mul(rv, 2.3)), add(far, mul(rv, -2.3)), add(hl, mul(rv, -0.45))].map(function (p) { return [p[0], T.height(p[0], p[2]) + 0.04, p[2]]; });
      var qa = P(add(carP, mul(car.dir, 1.4))), qb = P(add(carP, mul(car.dir, 7)));
      if (qa && qb) {
        var lg = ctx.createLinearGradient(qa[0], qa[1], qb[0], qb[1]);
        lg.addColorStop(0, 'rgba(255, 226, 168, 0.3)'); lg.addColorStop(1, 'rgba(255, 226, 168, 0)');
        groundPoly(cam, cx, cy, pool, lg);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    // Designator ring on the ground under the target.
    if (!search) {
      var ringC = coast ? [trk.aim[0], 0, trk.aim[2]] : carP, ry = T.height(ringC[0], ringC[2]) + 0.06;
      var pulse = locked ? 1 + 0.12 * Math.sin(t * 5) : 1 + 1.4 * (1 - trk.acq);
      ctx.lineWidth = 1.6 * dpr; ctx.strokeStyle = coast ? 'rgba(255, 181, 71, 0.85)' : locked ? 'rgba(182, 243, 106, 0.85)' : 'rgba(255, 181, 71, ' + (0.3 + 0.6 * trk.acq) + ')';
      if (coast) ctx.setLineDash([5 * dpr, 4 * dpr]);
      ctx.beginPath();
      ringPts(ringC, 1.65 * pulse, 1.65 * pulse, 0, 40, ry).forEach(function (p, k) { var qq = P(p); if (!qq) return; if (k) ctx.lineTo(qq[0], qq[1]); else ctx.moveTo(qq[0], qq[1]); });
      ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      for (var tk = 0; tk < 4; tk++) {
        var ta = tk * TAU / 4 + t * 0.6, r1 = 1.65 * pulse, r2 = r1 + 0.45, p1 = P([ringC[0] + Math.cos(ta) * r1, ry, ringC[2] + Math.sin(ta) * r1]), p2 = P([ringC[0] + Math.cos(ta) * r2, ry, ringC[2] + Math.sin(ta) * r2]);
        if (p1 && p2) { ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke(); }
      }
    }
    // The gimbal's footprint on the ground.
    if (mode !== 'depth') {
      ctx.globalCompositeOperation = 'lighter';
      groundPoly(cam, cx, cy, foot, coast ? 'rgba(255, 181, 71, 0.08)' : search ? 'rgba(94, 231, 214, 0.07)' : 'rgba(94, 231, 214, 0.09)');
      ctx.globalCompositeOperation = 'source-over';
    }

    R.render(ctx, objs, cam, rect, dpr, thermal, fogArg);

    // Light: head/tail lights, LEDs, the strobe, rotor glints.
    if (mode === 'rgb') {
      ctx.globalCompositeOperation = 'lighter';
      CAR.head.forEach(function (p) { glow(P(p), 16 * dpr, '255, 236, 196', 0.55); });
      CAR.tail.forEach(function (p) { glow(P(p), 9 * dpr, '255, 50, 40', 0.5); });
      G.leds.forEach(function (l) { glow(P(l.p), 9 * dpr, l.c, 0.75); });
      if ((t % 1.3) < 0.07) glow(P(G.strobe), 26 * dpr, '255, 255, 255', 0.9);
      ctx.globalCompositeOperation = 'source-over';
    }

    // Gimbal frustum lines.
    if (mode !== 'depth') {
      ctx.strokeStyle = coast ? 'rgba(255, 181, 71, 0.35)' : 'rgba(94, 231, 214, 0.32)'; ctx.lineWidth = dpr;
      var gq = P(G.cam);
      if (gq) { ctx.beginPath(); foot.forEach(function (f) { var fq = P(f); if (fq) { ctx.moveTo(gq[0], gq[1]); ctx.lineTo(fq[0], fq[1]); } }); ctx.stroke(); }
    }

    // Keypoints and tracks layers.
    if (mode === 'keypoints') {
      ctx.fillStyle = 'rgba(11, 15, 19, 0.5)'; ctx.fillRect(0, 0, cw, ch);
      var pts = KP.concat(CAR.corners, [drone, G.cam, G.mast], G.motors);
      var matches = 0;
      ctx.lineWidth = dpr;
      for (i = 0; i < pts.length; i++) {
        q = P(pts[i]);
        if (!q || q[0] < 0 || q[0] > cw || q[1] < 0 || q[1] > ch) { kpPrev[i * 2] = -1; continue; }
        var pxp = kpPrev[i * 2], pyp = kpPrev[i * 2 + 1];
        if (kpHave && pxp >= 0) {
          var dxp = q[0] - pxp, dyp = q[1] - pyp;
          if (dxp * dxp + dyp * dyp < 60 * 60 * dpr * dpr) { matches++; ctx.strokeStyle = 'rgba(240, 107, 208, 0.55)'; ctx.beginPath(); ctx.moveTo(pxp, pyp); ctx.lineTo(q[0], q[1]); ctx.stroke(); }
        }
        ctx.fillStyle = i < KP.length ? MAGENTA : LIME;
        ctx.beginPath(); ctx.arc(q[0], q[1], (i < KP.length ? 1.8 : 2.6) * dpr, 0, TAU); ctx.fill();
        kpPrev[i * 2] = q[0]; kpPrev[i * 2 + 1] = q[1];
      }
      kpHave = true;
      chip('KEYPOINTS ' + pts.length + ' · FLOW ' + matches, 14 * dpr, ch - 40 * dpr, 'left', MAGENTA);
    } else kpHave = false;
    function poly(list, col, w, dash) {
      ctx.strokeStyle = col; ctx.lineWidth = w * dpr; if (dash) ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath(); var on = false;
      for (var k = 0; k < list.length; k++) { var p = P(list[k]); if (!p) { on = false; continue; } if (on) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); on = true; }
      ctx.stroke(); ctx.setLineDash([]);
    }
    // Predicted path: shown in the tracks layer, and ahead of the target while locked or coasting.
    var pred = [];
    for (i = 1; i <= 14; i++) { var ps = carState(t + i * 0.18).pos; pred.push([ps[0], ps[1] + 0.1, ps[2]]); }
    if (mode === 'tracks') {
      poly(carTrail, 'rgba(255, 181, 71, 0.9)', 2);
      poly(droneTrail, 'rgba(94, 231, 214, 0.7)', 1.2);
      poly(pred, 'rgba(255, 181, 71, 0.6)', 1.5, true);
      for (i = 0; i < carTrail.length; i += 40) { q = P(carTrail[i]); if (q) { ctx.fillStyle = AMBER; ctx.beginPath(); ctx.arc(q[0], q[1], 2.2 * dpr, 0, TAU); ctx.fill(); } }
      chip('TRACK #1 · ' + (coast ? 'PREDICTED' : 'MEASURED') + ' · ' + carTrail.length + ' pts', 14 * dpr, ch - 40 * dpr, 'left', AMBER);
    } else if (locked && mode !== 'keypoints') {
      for (i = 2; i < pred.length; i += 2) { q = P(pred[i]); if (q) { ctx.fillStyle = 'rgba(255, 181, 71, ' + (0.75 - i * 0.045) + ')'; ctx.beginPath(); ctx.arc(q[0], q[1], 2 * dpr, 0, TAU); ctx.fill(); } }
    }

    // Lock HUD: tether from the gimbal to the target, the box and its label.
    var bb = R.bbox(cam, CAR.corners, cx, cy), tq = P(coast ? aim : CAR.center), gq2 = P(G.cam);
    var col = coast ? AMBER : locked ? LIME : search ? CYAN : AMBER;
    if (tq && gq2 && !search && mode !== 'keypoints') {
      ctx.strokeStyle = coast ? 'rgba(255, 181, 71, 0.8)' : 'rgba(182, 243, 106, ' + (locked ? 0.85 : 0.4 * trk.acq) + ')';
      ctx.lineWidth = 1.3 * dpr; ctx.setLineDash([6 * dpr, 5 * dpr]); ctx.lineDashOffset = -t * 40 * dpr;
      ctx.beginPath(); ctx.moveTo(gq2[0], gq2[1]); ctx.lineTo(tq[0], tq[1]); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      if (!narrow && (locked || coast)) {
        var rng = Math.sqrt(Math.pow(G.cam[0] - carP[0], 2) + Math.pow(G.cam[1] - carP[1], 2) + Math.pow(G.cam[2] - carP[2], 2)) * M_PER_UNIT;
        chip('RNG ' + rng.toFixed(0) + ' m', (gq2[0] + tq[0]) / 2 + 8 * dpr, (gq2[1] + tq[1]) / 2 - 8 * dpr, 'left', coast ? AMBER : LIME);
      }
    }
    var label = null;
    if (bb && !search) {
      var bx = bb[0] - 5 * dpr, by = bb[1] - 5 * dpr, bw = bb[2] + 10 * dpr, bh = bb[3] + 10 * dpr;
      if (coast && tq) { bx = tq[0] - bw / 2; by = tq[1] - bh / 2; }
      if (trk.st === 'ACQUIRE') {
        var k3 = 1 + 1.6 * (1 - smooth(trk.acq)), mcx = bx + bw / 2, mcy = by + bh / 2;
        bw *= k3; bh *= k3; bx = mcx - bw / 2; by = mcy - bh / 2;
      }
      R.hudRect(ctx, bx, by, bw, bh, dpr, col, coast, locked ? 1.3 : 1);
      if (locked) {
        // Inner corner ticks and a centre mark: the lock reticle.
        var mx = bx + bw / 2, my = by + bh / 2, cl = Math.min(bw, bh) * 0.16;
        ctx.strokeStyle = LIME; ctx.lineWidth = dpr;
        ctx.beginPath(); ctx.moveTo(mx - cl, my); ctx.lineTo(mx + cl, my); ctx.moveTo(mx, my - cl); ctx.lineTo(mx, my + cl); ctx.stroke();
      }
      var kmh = LAP * 2 * Math.PI * 12.8 * M_PER_UNIT * 3.6;
      label = trk.st === 'ACQUIRE' ? 'ACQUIRING ' + Math.round(trk.acq * 100) + ' %' : coast ? 'COASTING · KALMAN' : trk.st === 'REACQ' ? 'RE-ACQUIRED · ID 01' : 'LOCKED · ID 01 · ' + kmh.toFixed(0) + ' km/h';
      chip(label, bx, by - 21 * dpr, 'left', col, 9);
    }
    if (search) {
      // A scanning reticle on the gimbal's aim point.
      var sq = P([trk.aim[0], T.height(trk.aim[0], trk.aim[2]) + 0.5, trk.aim[2]]);
      if (sq) {
        ctx.strokeStyle = CYAN; ctx.lineWidth = 1.2 * dpr;
        var rr = 22 * dpr, sa = t * 3;
        for (i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(sq[0], sq[1], rr, sa + i * TAU / 4, sa + i * TAU / 4 + 0.9); ctx.stroke(); }
        chip('SEARCHING', sq[0] + rr + 6 * dpr, sq[1] - 8 * dpr, 'left', CYAN, 9);
      }
    }
    ctx.restore();

    // Vignette.
    var vg = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.38, cw / 2, ch / 2, Math.max(cw, ch) * 0.78);
    vg.addColorStop(0, 'rgba(11, 15, 19, 0)'); vg.addColorStop(1, 'rgba(11, 15, 19, 0.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, cw, ch);

    // Inset, top right: the gimbal camera's own zoomed view, LWIR.
    var iw = Math.min(cw * (narrow ? 0.36 : 0.3), 240 * dpr), ih = iw * 0.66, ix = cw - 14 * dpr - iw, iy = 38 * dpr;
    ctx.fillStyle = INK; rrect(ix - 2 * dpr, iy - 2 * dpr, iw + 4 * dpr, ih + 4 * dpr, 6 * dpr); ctx.fill();
    var gcam = R.camera(G.cam, aim, ih * (search ? 1.5 : 2.3));
    var near = new R.Scene(), R2 = 14 * 14, all = ground.faces.concat(objs.faces.filter(function (f) { return f.a === undefined || f.a < 0.3 || f.a > 0.98; }), canopyOpaque.faces);
    for (var fi = 0; fi < all.length; fi++) { var p0 = all[fi].pts[0], ddx = p0[0] - aim[0], ddz = p0[2] - aim[2]; if (ddx * ddx + ddz * ddz < R2) near.faces.push(all[fi]); }
    ctx.save(); rrect(ix, iy, iw, ih, 4 * dpr); ctx.clip();
    ctx.fillStyle = '#1a0004'; ctx.fillRect(ix, iy, iw, ih);
    R.render(ctx, near, gcam, { x: ix, y: iy, w: iw, h: ih }, dpr, true);
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (var yy = 0; yy < ih; yy += 3 * dpr) if (jitter(yy / dpr * 0.37 + t * 9, 1) > 0.6) ctx.fillRect(ix, iy + yy, iw, dpr);
    var icx = ix + iw / 2, icy = iy + ih / 2;
    var ib = R.bbox(gcam, CAR.corners, icx, icy);
    if (ib && !search) {
      if (coast) { var pa2 = R.project(gcam, aim, icx, icy); if (pa2) ib = [pa2[0] - ib[2] / 2, pa2[1] - ib[3] / 2, ib[2], ib[3]]; }
      var k4 = trk.st === 'ACQUIRE' ? 1 + 1.4 * (1 - smooth(trk.acq)) : 1, jx = locked ? (jitter(t * 7, 3) - 0.5) * 1.6 * dpr : 0, jy = locked ? (jitter(t * 7, 7) - 0.5) * 1.6 * dpr : 0;
      var iw2 = (ib[2] + 6 * dpr) * k4, ih2 = (ib[3] + 6 * dpr) * k4, icx2 = ib[0] + ib[2] / 2, icy2 = ib[1] + ib[3] / 2;
      R.hudRect(ctx, icx2 - iw2 / 2 + jx, icy2 - ih2 / 2 + jy, iw2, ih2, dpr, col, coast, 1);
    }
    ctx.strokeStyle = 'rgba(232, 237, 242, 0.4)'; ctx.lineWidth = dpr;
    var cl2 = 7 * dpr;
    ctx.beginPath(); ctx.moveTo(icx - cl2 * 2, icy); ctx.lineTo(icx - cl2, icy); ctx.moveTo(icx + cl2, icy); ctx.lineTo(icx + cl2 * 2, icy); ctx.moveTo(icx, icy - cl2 * 2); ctx.lineTo(icx, icy - cl2); ctx.moveTo(icx, icy + cl2); ctx.lineTo(icx, icy + cl2 * 2); ctx.stroke();
    ctx.restore();
    chip(narrow ? 'LWIR · ZOOM' : 'GIMBAL · LWIR · 640×512', ix + 6 * dpr, iy + 6 * dpr);
    chip(search ? 'SEARCH' : coast ? 'PREDICT ' + conf.toFixed(2) : trk.st === 'ACQUIRE' ? 'ACQ ' + conf.toFixed(2) : 'LOCK ' + conf.toFixed(2), ix + iw - 6 * dpr, iy + ih - 22 * dpr, 'right', col);

    // Callouts on wide stages, kept clear of the inset, the label and the controls.
    placed.length = 0;
    placed.push({ x: ix - 2 * dpr, y: iy - 2 * dpr, w: iw + 4 * dpr, h: ih + 4 * dpr });
    placed.push({ x: 0, y: ch * 0.82, w: cw, h: ch * 0.18 });
    if (bb) placed.push({ x: bb[0] - 10 * dpr, y: bb[1] - 30 * dpr, w: bb[2] + 20 * dpr + 160 * dpr, h: bb[3] + 40 * dpr });
    if (!narrow && mode !== 'keypoints') {
      callout(cam, cx, cy, G.cam, 'LWIR GIMBAL · 3-AXIS', -34, 30);
      callout(cam, cx, cy, G.mast, 'GNSS · 30 FPS LINK', 30, -26);
    }

    // REC and a running timecode, top right above the inset.
    ctx.font = '500 ' + Math.round(10 * dpr) + 'px ' + MONO;
    ctx.textBaseline = 'top'; ctx.textAlign = 'right';
    var tcs = Math.floor(simT), tc = ('0' + Math.floor(tcs / 3600) % 24).slice(-2) + ':' + ('0' + Math.floor(tcs / 60) % 60).slice(-2) + ':' + ('0' + tcs % 60).slice(-2) + ':' + ('0' + Math.floor((simT % 1) * 30)).slice(-2);
    ctx.fillStyle = PAPER; ctx.fillText(tc, cw - 16 * dpr, 14 * dpr);
    if (Math.floor(simT * 1.6) % 2 === 0) { ctx.fillStyle = '#ff4d3d'; ctx.beginPath(); ctx.arc(cw - 16 * dpr - 78 * dpr, 19 * dpr, 3.2 * dpr, 0, TAU); ctx.fill(); }
    ctx.fillStyle = FAINT; ctx.fillText('REC', cw - 16 * dpr - 88 * dpr, 14 * dpr);
    ctx.textAlign = 'left';

    updateReadouts(G, trk);
  }

  var readoutClock = 0;
  function updateReadouts(G, trk) {
    var now = performance.now();
    if (now - readoutClock < 120) return;
    readoutClock = now;
    if (ui.pan) ui.pan.textContent = fmtDeg(G.pan);
    if (ui.tilt) ui.tilt.textContent = fmtDeg(-G.tilt);
    if (ui.lock) {
      ui.lock.textContent = trk.st === 'SEARCH' ? 'srch' : trk.st === 'COAST' ? 'pred' : trk.st === 'ACQUIRE' ? 'acq' : conf.toFixed(2);
      ui.lock.style.color = trk.st === 'COAST' || trk.st === 'ACQUIRE' ? AMBER : trk.st === 'SEARCH' ? CYAN : '';
    }
  }

  // ---------- Sizing and loop ----------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var r = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (w !== canvas.width || h !== canvas.height) { canvas.width = w; canvas.height = h; }
    cw = w; ch = h;
    draw();
  }

  function tick(now) {
    rafId = requestAnimationFrame(tick);
    var dt = Math.min(0.05, lastNow ? (now - lastNow) / 1000 : 0.016);
    lastNow = now;
    simT += dt;
    if (!dragging) {
      orbit.yaw += orbit.vyaw * dt; orbit.pitch += orbit.vpitch * dt;
      orbit.vyaw *= Math.pow(0.08, dt); orbit.vpitch *= Math.pow(0.08, dt);
      if (now - lastInput > 1800) orbit.yaw += (0.32 * Math.sin(simT * 0.11) - orbit.yaw) * Math.min(1, dt * 0.4);
    }
    orbit.pitch = clamp(orbit.pitch, 0.1, 1.05);
    draw();
  }

  function start() { if (running || reduceMotion) return; running = true; lastNow = 0; rafId = requestAnimationFrame(tick); }
  function stop() { running = false; cancelAnimationFrame(rafId); }
  function sync() { if (visible && !document.hidden) start(); else stop(); }

  // ---------- Interaction ----------
  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true; moved = 0; px = e.clientX; py = e.clientY;
    orbit.vyaw = orbit.vpitch = 0;
    lastInput = performance.now();
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    stage.classList.add('is-dragging');
  }
  function onMove(e) {
    if (!dragging) return;
    var dx = e.clientX - px, dy = e.clientY - py;
    px = e.clientX; py = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    var k = 0.0085;
    orbit.yaw += dx * k; orbit.pitch += dy * k;
    orbit.vyaw = dx * k * 40; orbit.vpitch = dy * k * 40;
    lastInput = performance.now();
    if (moved > 24 && ui.hint) ui.hint.classList.add('is-done');
    if (reduceMotion) draw();
  }
  function onUp() { dragging = false; stage.classList.remove('is-dragging'); lastInput = performance.now(); }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', onUp);

  stage.addEventListener('keydown', function (e) {
    var step = 0.12, handled = true;
    if (e.key === 'ArrowLeft') orbit.yaw -= step;
    else if (e.key === 'ArrowRight') orbit.yaw += step;
    else if (e.key === 'ArrowUp') orbit.pitch += step;
    else if (e.key === 'ArrowDown') orbit.pitch -= step;
    else handled = false;
    if (!handled) return;
    e.preventDefault();
    lastInput = performance.now();
    if (ui.hint) ui.hint.classList.add('is-done');
    if (reduceMotion) draw();
  });

  ui.layers.forEach(function (b) {
    b.addEventListener('click', function () {
      mode = b.getAttribute('data-layer');
      ui.layers.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      stage.setAttribute('data-mode', mode);
      kpHave = false;
      if (reduceMotion) draw();
    });
  });

  // Test hook: render a given moment (used by the site's screenshot checks).
  window.__hero = { at: function (t, yaw, pitch) { simT = t; if (yaw !== undefined) orbit.yaw = yaw; if (pitch !== undefined) orbit.pitch = pitch; draw(); }, stop: stop, setMode: function (m) { mode = m; } };

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; sync(); }, { threshold: 0.05 }).observe(stage);
  }
  document.addEventListener('visibilitychange', sync);
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);

  resize();
  sync();
})();
