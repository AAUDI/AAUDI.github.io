/* Page chrome: theme toggle, mobile menu, header state, scroll reveal,
   and the active nav link. */
(function () {
  'use strict';

  var root = document.documentElement;

  // ---------- Footer year ----------
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  // ---------- Theme ----------
  var themeToggle = document.getElementById('themeToggle');
  var themeColor = document.querySelector('meta[name="theme-color"]');

  function applyThemeLabel() {
    var isLight = root.getAttribute('data-theme') === 'light';
    themeToggle.setAttribute('aria-label', isLight ? 'Switch to dark theme' : 'Switch to light theme');
    if (themeColor) themeColor.setAttribute('content', isLight ? '#f5f0ea' : '#0d0b0a');
  }

  if (themeToggle) {
    applyThemeLabel();
    themeToggle.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('site-theme', next); } catch (e) {}
      applyThemeLabel();
    });
  }

  // ---------- Mobile menu ----------
  var menuToggle = document.getElementById('menuToggle');
  var nav = document.getElementById('siteNav');

  function setMenu(open) {
    nav.classList.toggle('open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.textContent = open ? 'Close' : 'Menu';
  }

  if (menuToggle && nav) {
    menuToggle.addEventListener('click', function () {
      setMenu(menuToggle.getAttribute('aria-expanded') !== 'true');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        setMenu(false);
        menuToggle.focus();
      }
    });
  }

  // ---------- Header border once scrolled ----------
  var header = document.getElementById('siteHeader');
  function onScroll() {
    header.classList.toggle('scrolled', window.scrollY > 8);
  }
  if (header) {
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    // Home page: the big name is the title, so the small one in the header only appears once it has scrolled away.
    var bigName = document.getElementById('heroName');
    if (bigName && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (e) { header.classList.toggle('brand-hidden', e[0].isIntersecting); }, { rootMargin: '-64px 0px 0px 0px' }).observe(bigName);
    } else header.classList.remove('brand-hidden');
  }

  // ---------- Reveal on scroll ----------
  // Children of a [data-stagger] group arrive one after the other.
  document.querySelectorAll('[data-stagger]').forEach(function (box) {
    var kids = Array.prototype.filter.call(box.children, function (el) { return el.classList.contains('reveal'); });
    kids.forEach(function (el, i) { el.style.transitionDelay = Math.min(i, 11) * 70 + 'ms'; });
  });
  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  }

  // ---------- Sliding pill behind the active nav link ----------
  var pill = null;
  function movePill() {
    if (!nav) return;
    var ul = nav.querySelector('ul'), cur = nav.querySelector('a[aria-current]');
    if (!ul) return;
    if (!pill) { pill = document.createElement('span'); pill.className = 'nav-pill'; pill.setAttribute('aria-hidden', 'true'); ul.insertBefore(pill, ul.firstChild); }
    if (!cur || getComputedStyle(pill).display === 'none') { pill.style.opacity = '0'; return; }
    var r = cur.getBoundingClientRect(), u = ul.getBoundingClientRect();
    pill.style.left = (r.left - u.left) + 'px';
    pill.style.width = r.width + 'px';
    pill.style.opacity = '1';
  }
  window.addEventListener('resize', movePill);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(movePill);

  // ---------- Reading progress under the header ----------
  var progress = document.createElement('div');
  progress.className = 'progress'; progress.setAttribute('aria-hidden', 'true');
  document.body.appendChild(progress);
  function onProgress() {
    var h = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = (h > 0 ? Math.min(100, window.scrollY / h * 100) : 0) + '%';
  }
  onProgress();
  window.addEventListener('scroll', onProgress, { passive: true });
  window.addEventListener('resize', onProgress);

  // ---------- Numbers that count up when they arrive ----------
  var counters = document.querySelectorAll('[data-count]');
  var reduceMotionCount = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (counters.length && 'IntersectionObserver' in window && !reduceMotionCount) {
    var countObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        countObserver.unobserve(e.target);
        var el = e.target, target = parseFloat(el.getAttribute('data-count')), suffix = el.getAttribute('data-suffix') || '', t0 = 0;
        function step(now) {
          if (!t0) t0 = now;
          var x = Math.min(1, (now - t0) / 1100), k = 1 - Math.pow(1 - x, 3);
          el.textContent = Math.round(target * k) + suffix;
          if (x < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });
    }, { threshold: 0.6 });
    counters.forEach(function (el) { countObserver.observe(el); });
  }

  // ---------- Active nav link ----------
  var navLinks = nav ? nav.querySelectorAll('a[href^="#"]') : [];
  var sections = [];
  navLinks.forEach(function (a) {
    var target = document.querySelector(a.getAttribute('href'));
    if (target) sections.push({ link: a, el: target });
  });

  if (sections.length && 'IntersectionObserver' in window) {
    var navObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        sections.forEach(function (s) {
          if (s.el === entry.target) s.link.setAttribute('aria-current', 'true');
          else s.link.removeAttribute('aria-current');
        });
        movePill();
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function (s) { navObserver.observe(s.el); });
  }

  // ---------- Muted clips on cards: play only while on screen ----------
  var clips = document.querySelectorAll('video[data-autoplay]');
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (clips.length && 'IntersectionObserver' in window && !reduceMotion) {
    var clipObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); }
        else v.pause();
      });
    }, { threshold: 0.3 });
    clips.forEach(function (v) { v.muted = true; clipObserver.observe(v); });
  }

  // ---------- Lightbox for project material ----------
  var lb = document.getElementById('lightbox');
  if (lb && typeof lb.showModal === 'function') {
    var lbImg = document.getElementById('lbImg');
    var lbVid = document.getElementById('lbVid');
    var lbCap = document.getElementById('lbCap');
    var lbCount = lb.querySelector('.lb-count');
    var group = [], index = 0, opener = null;

    // group: [{full, cap, alt}] or [{video, poster, cap, alt}]
    function show(i) {
      index = (i + group.length) % group.length;
      var it = group[index];
      if (lbVid) { lbVid.pause(); lbVid.removeAttribute('src'); lbVid.hidden = true; }
      if (it.video && lbVid) {
        lbImg.hidden = true; lbImg.removeAttribute('src');
        lbVid.hidden = false; lbVid.poster = it.poster || ''; lbVid.src = it.video; lbVid.setAttribute('aria-label', it.alt || '');
        var pr = lbVid.play(); if (pr && pr.catch) pr.catch(function () {});
      } else {
        lbImg.hidden = false;
        lbImg.src = it.full;
        lbImg.alt = it.alt || '';
      }
      lbCap.textContent = it.cap || '';
      if (lbCount) lbCount.textContent = (index + 1) + ' / ' + group.length;
      lb.classList.toggle('single', group.length < 2);
      // Warm the neighbours so arrows feel instant.
      [index + 1, index - 1].forEach(function (k) {
        var n = group[(k + group.length) % group.length];
        if (n && n.full) { var im = new Image(); im.src = n.full; }
      });
    }

    window.openLightbox = function (items, i, openedBy) {
      if (!items || !items.length) return;
      group = items; opener = openedBy || document.activeElement;
      show(i || 0);
      lb.showModal();
    };

    function itemFrom(el) {
      var img = el.querySelector('img');
      return { full: el.getAttribute('data-full'), cap: el.getAttribute('data-cap'), alt: img ? img.alt : '' };
    }
    // Thumbnails that are not slide selectors open the lightbox directly.
    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.shot') : null;
      if (!b || b.hasAttribute('data-slide')) return;
      var list = b.closest('.shots');
      var all = list ? Array.prototype.slice.call(list.querySelectorAll('.shot:not([data-slide])')) : [b];
      window.openLightbox(all.map(itemFrom), all.indexOf(b), b);
    });
    lb.querySelector('.lb-close').addEventListener('click', function () { lb.close(); });
    lb.querySelector('.lb-prev').addEventListener('click', function () { show(index - 1); });
    lb.querySelector('.lb-next').addEventListener('click', function () { show(index + 1); });
    lb.addEventListener('click', function (e) { if (e.target === lb) lb.close(); });
    lb.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') show(index + 1);
      else if (e.key === 'ArrowLeft') show(index - 1);
    });
    lb.addEventListener('close', function () {
      lbImg.removeAttribute('src');
      if (lbVid) { lbVid.pause(); lbVid.removeAttribute('src'); }
      if (opener) opener.focus();
    });
  }
})();
