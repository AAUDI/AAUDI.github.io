/* Ambient music: "Interstellar" by QuentinGaming (Pixabay Content License,
   free for use), levelled in advance to a quiet -30 LUFS with soft ends so the
   2-minute loop is seamless (source kept in tools/audio-source/).

   On by default: browsers never start sound on their own, so it starts at
   the visitor's first click, tap or key press (and at once where a browser
   allows it). The speaker button in the header turns it off and on, with
   fades; a visitor who turns it off stays off on later visits. It pauses in
   hidden tabs and when a YouTube video is played. */
(function () {
  'use strict';

  var themeBtn = document.getElementById('themeToggle');
  if (!themeBtn) return;

  var KEY = 'site-sound';
  var TRACK = 'assets/audio/ambient.mp3';
  var LEVEL = 1;             // the file itself is already quiet
  var AC = window.AudioContext || window.webkitAudioContext;

  // ---- The button ----
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn sound-toggle';
  btn.title = 'Ambient music';
  btn.innerHTML =
    '<svg class="icon-sound-on" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a7.8 7.8 0 0 1 0 11"/></svg>' +
    '<svg class="icon-sound-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
  themeBtn.parentNode.insertBefore(btn, themeBtn);

  var audio = null, ctx = null, gain = null, on = false, fadeTimer = 0;
  // Waiting to start at the first gesture (the default unless the visitor chose off).
  var armed = false;

  function setup() {
    audio = new Audio(TRACK);
    audio.loop = true;
    audio.preload = 'none';
    // Through Web Audio so the fades also work on iPhones (which ignore audio.volume).
    if (AC) {
      try {
        ctx = new AC();
        gain = ctx.createGain();
        gain.gain.value = 0;
        ctx.createMediaElementSource(audio).connect(gain);
        gain.connect(ctx.destination);
      } catch (e) { ctx = null; gain = null; }
    }
    if (!gain) audio.volume = 0;
  }

  function fade(to, sec, done) {
    clearInterval(fadeTimer);
    clearTimeout(fadeTimer);
    if (gain) {
      var now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(to, now + sec);
      if (done) fadeTimer = setTimeout(done, sec * 1000 + 100);
      return;
    }
    var from = audio.volume, t0 = Date.now();
    fadeTimer = setInterval(function () {
      var k = Math.min(1, (Date.now() - t0) / (sec * 1000));
      audio.volume = from + (to - from) * k;
      if (k >= 1) { clearInterval(fadeTimer); if (done) done(); }
    }, 50);
  }

  function play() { var p = audio.play(); if (p && p.catch) p.catch(function () {}); }

  function sync() {
    var shown = on || armed;
    btn.setAttribute('aria-pressed', String(shown));
    btn.setAttribute('aria-label', shown ? 'Turn the ambient music off' : 'Play ambient music');
  }

  function start() {
    armed = false;
    if (!audio) setup();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    on = true;
    play();
    fade(LEVEL, 4);
    sync();
  }

  function stop() {
    on = false;
    sync();
    if (!audio) return;
    fade(0, 1.5, function () { if (!on) audio.pause(); });
  }

  function remember(v) { try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch (e) {} }

  btn.addEventListener('click', function () {
    if (on || armed) { armed = false; stop(); remember(false); } else { start(); remember(true); }
  });

  // On unless the visitor turned it off: start at the first gesture anywhere but on the button.
  var pref = null;
  try { pref = localStorage.getItem(KEY); } catch (e) {}
  if (pref !== 'off') {
    armed = true;
    var resume = function (e) {
      if (e.target && e.target.closest && e.target.closest('.sound-toggle')) return;
      document.removeEventListener('pointerdown', resume, true);
      document.removeEventListener('keydown', resume, true);
      if (armed) start();
    };
    document.addEventListener('pointerdown', resume, true);
    document.addEventListener('keydown', resume, true);
    // Some browsers allow sound straight away (for example on a site the visitor uses often).
    setup();
    var p = audio.play();
    if (p && p.then) p.then(function () { if (armed) start(); }).catch(function () { if (!on) audio.pause(); });
  }

  // Quiet in background tabs; give way to a YouTube video.
  document.addEventListener('visibilitychange', function () {
    if (!audio || !on) return;
    if (document.hidden) audio.pause(); else play();
  });
  document.addEventListener('click', function (e) {
    if (on && e.target.closest && e.target.closest('.yt-facade')) stop();
  }, true);

  sync();
})();
