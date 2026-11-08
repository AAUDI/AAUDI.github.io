/* Project-card slideshows. The card's big media area holds several slides
   (real photos, and sometimes a 3D preview canvas); the thumbnails under it
   select a slide. Slides advance on their own while the card is on screen
   until the visitor takes over. Clicking a photo opens the lightbox. */
(function () {
  'use strict';

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var players = window.__previews || [];
  function playerFor(canvas) {
    for (var i = 0; i < players.length; i++) if (players[i].canvas === canvas) return players[i];
    return null;
  }

  document.querySelectorAll('.slides').forEach(function (box) {
    var slides = Array.prototype.slice.call(box.querySelectorAll('.slide'));
    if (!slides.length) return;
    var card = box.closest('.project');
    var thumbs = card ? Array.prototype.slice.call(card.querySelectorAll('.shot[data-slide]')) : [];
    var cap = box.querySelector('.slide-cap');
    var openBtn = box.querySelector('.media-open');
    var replay = box.querySelector('.media-replay');
    var idx = 0, timer = 0, auto = !reduceMotion, hover = false, onScreen = false;

    slides.forEach(function (s) {
      var c = s.querySelector('canvas');
      if (c) { var pl = playerFor(c); if (pl) { pl.played = true; s._player = pl; } }
      var v = s.querySelector('video');
      if (v) { s._video = v; v.muted = true; v.loop = true; v.playsInline = true; }
    });

    // Photos and videos both open in the lightbox.
    var photos = slides.filter(function (s) { var k = s.getAttribute('data-kind'); return k === 'img' || k === 'video'; }).map(function (s) {
      var img = s.querySelector('img'), v = s.querySelector('video');
      return { full: s.getAttribute('data-full') || (img && img.getAttribute('src')), video: v ? v.getAttribute('src') : null, poster: v ? v.getAttribute('poster') : null, cap: s.getAttribute('data-cap'), alt: img ? img.alt : (v ? v.getAttribute('aria-label') : ''), el: s };
    });

    function go(i, byUser) {
      idx = (i + slides.length) % slides.length;
      var s = slides[idx], kind = s.getAttribute('data-kind') || 'img';
      slides.forEach(function (x, k) { x.classList.toggle('is-active', k === idx); x.setAttribute('aria-hidden', k === idx ? 'false' : 'true'); });
      thumbs.forEach(function (b) { b.setAttribute('aria-pressed', String(parseInt(b.getAttribute('data-slide'), 10) === idx)); });
      box.setAttribute('data-kind', kind);
      if (cap) cap.textContent = s.getAttribute('data-short') || s.getAttribute('data-cap') || '';
      if (openBtn) openBtn.hidden = kind !== 'img' && kind !== 'video';
      if (replay) replay.hidden = !s._player;
      slides.forEach(function (x, k) {
        if (k !== idx && x._frame) { x._frame.replaceWith(x._facade); x._frame = null; box.classList.remove('is-playing'); }
      });
      slides.forEach(function (x, k) {
        if (!x._video) return;
        if (k === idx && !reduceMotion) { var pr = x._video.play(); if (pr && pr.catch) pr.catch(function () {}); }
        else x._video.pause();
      });
      if (s._player) {
        s._player.visible = true;
        s._player.resize();
        if (reduceMotion) s._player.render(); else s._player.play();
      }
      if (byUser) auto = false;
      schedule();
    }

    function schedule() {
      clearTimeout(timer);
      if (!auto || slides.length < 2) return;
      var s = slides[idx];
      var ms = s._player ? s._player.spec.duration * 1000 + 1800 : s._video ? Math.min(14000, Math.max(6000, (s._video.duration || 8) * 1000)) : s.getAttribute('data-kind') === 'compare' ? 9000 : 5200;
      timer = setTimeout(function () {
        if (onScreen && !hover && !document.getElementById('lightbox').open) go(idx + 1);
        else schedule();
      }, ms);
    }

    thumbs.forEach(function (b) {
      b.addEventListener('click', function () { go(parseInt(b.getAttribute('data-slide'), 10), true); });
    });
    box.addEventListener('mouseenter', function () { hover = true; });
    box.addEventListener('mouseleave', function () { hover = false; });
    box.addEventListener('focusin', function () { hover = true; });
    box.addEventListener('focusout', function () { hover = false; });

    function openCurrent() {
      var s = slides[idx];
      var k = photos.map(function (p) { return p.el; }).indexOf(s);
      if (k < 0 || typeof window.openLightbox !== 'function') return;
      auto = false; clearTimeout(timer);
      window.openLightbox(photos, k, openBtn || box);
    }
    // YouTube slides: a cover with a play button; the privacy-mode player is
    // only loaded on click, and removed again when the slide is left.
    slides.forEach(function (s) {
      var f = s.querySelector('.yt-facade');
      if (!f) return;
      f.addEventListener('click', function () {
        auto = false; clearTimeout(timer);
        if (location.protocol === 'file:') { window.open('https://www.youtube.com/watch?v=' + f.getAttribute('data-yt'), '_blank', 'noopener'); return; }
        var fr = document.createElement('iframe');
        fr.className = 'yt-frame';
        fr.src = 'https://www.youtube-nocookie.com/embed/' + f.getAttribute('data-yt') + '?autoplay=1&rel=0&playsinline=1';
        fr.title = f.getAttribute('aria-label') || 'Video';
        fr.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        fr.setAttribute('allowfullscreen', '');
        fr.referrerPolicy = 'strict-origin-when-cross-origin';  // YouTube needs the page origin (error 153 without it)
        s._facade = f; s._frame = fr;
        f.replaceWith(fr);
        box.classList.add('is-playing');
        fr.focus();
      });
    });
    if (openBtn) openBtn.addEventListener('click', openCurrent);
    slides.forEach(function (s) { if (s.getAttribute('data-kind') === 'compare') return; var el = s.querySelector('img, video'); if (el) el.addEventListener('click', openCurrent); });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        var v = slides[idx]._video;
        if (v) { if (onScreen && !reduceMotion) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } else v.pause(); }
        if (onScreen) schedule();
      }, { threshold: 0.4 }).observe(box);
    } else onScreen = true;

    go(0);
  });
})();
