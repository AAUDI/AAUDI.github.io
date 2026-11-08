/* Ambient music, three sources in order of preference:
   1. YT_ID: a YouTube video played through YouTube's own player (the rights
      stay with YouTube and the channel). YouTube requires the player to be
      visible while it plays, so it sits in a small card in the corner, shown
      only while the music is on, at a low volume.
   2. TRACK: a recorded file the site may use (prepared quiet in advance).
   3. Otherwise an original, slow pipe-organ piece synthesised live with the
      Web Audio API (no file, nothing to license).

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
  var YT_ID = '';            // optional YouTube video id (played in a visible corner player); empty = off
  var YT_TITLE = 'Interstellar, Main Theme (epic version) · 2Hooks Music';
  var YT_VOLUME = 15;        // out of 100: quiet background
  var TRACK = 'assets/audio/ambient.mp3'; // "Interstellar" by QuentinGaming, Pixabay Content License (free for use); levelled to -30 LUFS with soft ends
  var TRACK_LEVEL = 1;       // the file itself is already quiet
  var LEVEL = 0.45;          // organ master level: quiet background (about -31 dBFS average)
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

  var ctx = null, master = null, bus = null, wave = null, audio = null;
  var on = false, timer = 0, nextT = 0, step = 0, fadeTimer = 0;

  // ---- YouTube player in a small corner card ----
  var ytCard = null, ytPlayer = null, ytReady = false, ytWaiting = null, ytFade = 0;

  function loadYT(cb) {
    if (window.YT && window.YT.Player) { cb(); return; }
    if (!ytWaiting) {
      ytWaiting = [];
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (prev) prev();
        ytWaiting.forEach(function (f) { f(); });
      };
      var s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
    ytWaiting.push(cb);
  }

  function ytVolume(to, sec, done) {
    clearInterval(ytFade);
    if (!ytReady) { if (done) done(); return; }
    var from = ytPlayer.getVolume ? ytPlayer.getVolume() : 0, t0 = Date.now();
    ytFade = setInterval(function () {
      var k = Math.min(1, (Date.now() - t0) / (sec * 1000));
      ytPlayer.setVolume(Math.round(from + (to - from) * k));
      if (k >= 1) { clearInterval(ytFade); if (done) done(); }
    }, 100);
  }

  function ytStart() {
    if (!ytCard) {
      ytCard = document.createElement('aside');
      ytCard.className = 'music-card';
      ytCard.setAttribute('aria-label', 'Background music');
      ytCard.innerHTML = '<div class="mc-head"><span class="mc-title"></span>' +
        '<button type="button" class="mc-close" aria-label="Stop the music">&times;</button></div>' +
        '<div class="mc-frame"><div id="musicPlayer"></div></div>';
      ytCard.querySelector('.mc-title').textContent = YT_TITLE;
      ytCard.querySelector('.mc-close').addEventListener('click', function () { stop(); remember(false); });
      document.body.appendChild(ytCard);
      loadYT(function () {
        ytPlayer = new window.YT.Player('musicPlayer', {
          host: 'https://www.youtube-nocookie.com',
          videoId: YT_ID,
          playerVars: { autoplay: 1, loop: 1, playlist: YT_ID, rel: 0, playsinline: 1 },
          events: {
            onReady: function (e) {
              ytReady = true;
              e.target.setVolume(0);
              if (on) { e.target.playVideo(); ytVolume(YT_VOLUME, 3); } else e.target.pauseVideo();
            }
          }
        });
      });
    }
    ytCard.hidden = false;
    if (ytReady) { ytPlayer.playVideo(); ytVolume(YT_VOLUME, 3); }
  }

  function ytStop() {
    ytVolume(0, 1.2, function () {
      if (on) return;
      if (ytReady) ytPlayer.pauseVideo();
      if (ytCard) ytCard.hidden = true;   // never a hidden player that plays
    });
  }

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
    if (TRACK) {
      audio = new Audio(TRACK);
      audio.loop = true;
      audio.preload = 'none';
      // Through Web Audio so the fades also work on iPhones (which ignore audio.volume).
      try { ctx.createMediaElementSource(audio).connect(master); master.connect(ctx.destination); }
      catch (e) { master = null; audio.volume = 0; }
      return;
    }
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

  // Fade the recorded track: by Web Audio gain, or by the element's volume as a fallback.
  function fadeTrack(to, sec, done) {
    clearInterval(fadeTimer);
    if (master) {
      var now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(to, now + sec);
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

  function start() {
    if (YT_ID) { on = true; ytStart(); sync(); return; }
    if (!ctx) setup();
    if (ctx.state === 'suspended') ctx.resume();
    on = true;
    if (TRACK) {
      var p = audio.play();
      if (p && p.catch) p.catch(function () {});
      fadeTrack(TRACK_LEVEL, 4);
      sync();
      return;
    }
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
    if (YT_ID) { ytStop(); return; }
    if (!ctx) return;
    if (TRACK) {
      fadeTrack(0, 1.5, function () { if (!on) audio.pause(); });
      return;
    }
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
    if (YT_ID && on && ytReady) { if (document.hidden) ytPlayer.pauseVideo(); else ytPlayer.playVideo(); return; }
    if (!ctx || !on) return;
    if (document.hidden) { ctx.suspend(); if (audio) audio.pause(); }
    else { ctx.resume(); if (audio) { var p = audio.play(); if (p && p.catch) p.catch(function () {}); } }
  });
  document.addEventListener('click', function (e) {
    if (on && e.target.closest && e.target.closest('.yt-facade')) stop();
  }, true);

  sync();
})();
