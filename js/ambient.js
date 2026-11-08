/* Ambient music: an original, slow pipe-organ piece in A minor with a long
   cathedral reverb, in the spirit of a space-film score. Synthesised live with
   the Web Audio API, so there is no audio file and nothing to license.

   Off by default. The speaker button in the header turns it on at a low level
   (fades in over 4 s) and off again; the choice is remembered, and on a later
   visit it resumes at the first click or key press (browsers never start sound
   on their own). It pauses in hidden tabs and when a YouTube video is played. */
(function () {
  'use strict';

  var AC = window.AudioContext || window.webkitAudioContext;
  var themeBtn = document.getElementById('themeToggle');
  if (!AC || !themeBtn) return;

  var KEY = 'site-sound';
  var LEVEL = 0.45;          // master level: quiet background (about -31 dBFS average)
  var DUR = 9;               // seconds per chord
  // Chords as MIDI notes, root first: Am9 Fadd9 Cadd9 G6/9 Am(add9) F Dm7 E.
  var CHORDS = [
    [45, 52, 60, 64, 71], [41, 48, 57, 64, 67], [48, 55, 64, 67, 74], [43, 50, 59, 64, 69],
    [45, 52, 60, 64, 72], [41, 48, 57, 65, 69], [38, 50, 57, 60, 65], [40, 47, 56, 59, 64]
  ];

  // ---- The button ----
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn sound-toggle';
  btn.title = 'Ambient music';
  btn.innerHTML =
    '<svg class="icon-sound-on" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a7.8 7.8 0 0 1 0 11"/></svg>' +
    '<svg class="icon-sound-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
  themeBtn.parentNode.insertBefore(btn, themeBtn);

  var ctx = null, master = null, bus = null, wave = null;
  var on = false, timer = 0, nextT = 0, step = 0;

  function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function impulse(sec) {
    var n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = b.getChannelData(c);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
    return b;
  }

  function setup() {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24; comp.ratio.value = 3; comp.attack.value = 0.05; comp.release.value = 0.6;
    // Soft top end that breathes slowly.
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1700; lp.Q.value = 0.4;
    var lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfo.frequency.value = 0.05; lfoGain.gain.value = 350;
    lfo.connect(lfoGain); lfoGain.connect(lp.frequency); lfo.start();
    // Cathedral: a long generated reverb under a lighter dry signal.
    var verb = ctx.createConvolver(); verb.buffer = impulse(5.5);
    var dry = ctx.createGain(), wet = ctx.createGain();
    dry.gain.value = 0.55; wet.gain.value = 0.8;
    bus = ctx.createGain();
    bus.connect(lp); lp.connect(dry); lp.connect(verb); verb.connect(wet);
    dry.connect(comp); wet.connect(comp); comp.connect(master); master.connect(ctx.destination);
    // Organ tone: fundamental, octave, twelfth, fifteenth and a little higher, like a few stops pulled.
    var amps = [0, 1, 0.55, 0.22, 0.32, 0, 0.12, 0, 0.1];
    wave = ctx.createPeriodicWave(new Float32Array(amps.length), new Float32Array(amps));
  }

  function voice(freq, type, t, len, amp, cents) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    if (type === 'organ') o.setPeriodicWave(wave); else o.type = type;
    o.frequency.value = freq;
    o.detune.value = cents || 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 3);
    g.gain.setValueAtTime(amp, t + len);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 5);
    o.connect(g); g.connect(bus);
    o.start(t); o.stop(t + len + 5.2);
  }

  function chord(t) {
    var c = CHORDS[step % CHORDS.length];
    step++;
    c.forEach(function (m, k) {
      var amp = k === 0 ? 0.05 : 0.035;
      voice(hz(m), 'organ', t, DUR, amp, -4);   // two slightly detuned ranks
      voice(hz(m), 'organ', t, DUR, amp, 4);
    });
    voice(hz(c[0] - 12), 'sine', t, DUR, 0.06, 0); // soft pedal an octave below
  }

  function pump() {
    if (!on) return;
    while (nextT < ctx.currentTime + 2) { chord(nextT); nextT += DUR; }
    timer = setTimeout(pump, 500);
  }

  function sync() {
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Turn the ambient music off' : 'Play ambient music');
  }

  function start() {
    if (!ctx) setup();
    if (ctx.state === 'suspended') ctx.resume();
    on = true;
    var now = ctx.currentTime;
    nextT = Math.max(nextT, now + 0.1);
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(LEVEL, now + 4);
    clearTimeout(timer);
    pump();
    sync();
  }

  function stop() {
    on = false;
    clearTimeout(timer);
    sync();
    if (!ctx) return;
    var now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + 1.5);
    setTimeout(function () { if (!on && ctx.state === 'running') ctx.suspend(); }, 1700);
  }

  function remember(v) { try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch (e) {} }

  btn.addEventListener('click', function () {
    if (on) { stop(); remember(false); } else { start(); remember(true); }
  });

  // Remembered "on": resume at the first gesture anywhere but on the button itself.
  var wanted = false;
  try { wanted = localStorage.getItem(KEY) === 'on'; } catch (e) {}
  if (wanted) {
    var resume = function (e) {
      if (e.target && e.target.closest && e.target.closest('.sound-toggle')) return;
      document.removeEventListener('pointerdown', resume, true);
      document.removeEventListener('keydown', resume, true);
      if (!on) start();
    };
    document.addEventListener('pointerdown', resume, true);
    document.addEventListener('keydown', resume, true);
  }

  // Quiet in background tabs; give way to a YouTube video.
  document.addEventListener('visibilitychange', function () {
    if (!ctx || !on) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });
  document.addEventListener('click', function (e) {
    if (on && e.target.closest && e.target.closest('.yt-facade')) stop();
  }, true);

  sync();
})();
