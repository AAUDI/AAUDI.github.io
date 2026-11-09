/* Hero lab: a private switcher to compare hero layouts on the live site.
   It only appears with ?hero in the address (e.g. aaudi.github.io/?hero, or ?hero=7
   to open layout 7); visitors never see it and keep the current hero. The choice is
   kept in localStorage while testing; the arrow keys step through the layouts.
   Remove this file once a layout is chosen. */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  if (!params.has('hero')) return;

  var root = document.documentElement;
  var KEY = 'hero-lab';
  var LAYOUTS = [['', 'Current'], ['stage', 'Centered stage'], ['control', 'Control room'], ['split', 'Split screen'], ['cinema', 'Cinematic'],
    ['strip', 'Filmstrip'], ['monitors', 'Monitor wall'], ['sides', 'Two sides'], ['tilt', 'Tilted'], ['index', 'Big index']];
  var FRAMES = [['', 'Clean frame'], ['vf', 'Viewfinder'], ['glow', 'Glow']];
  function find(list, v) { for (var i = 0; i < list.length; i++) if (list[i][0] === v) return i; return -1; }

  var state = { hl: '', fr: '' };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (saved) { state.hl = saved.hl || ''; state.fr = saved.fr || (saved.vf ? 'vf' : ''); }
  } catch (e) {}
  var asked = params.get('hero'), n = parseInt(asked, 10);
  if (n >= 1 && n <= LAYOUTS.length) state.hl = LAYOUTS[n - 1][0];
  else if (asked && find(LAYOUTS, asked) >= 0) state.hl = asked;
  if (find(LAYOUTS, state.hl) < 0) state.hl = '';
  if (find(FRAMES, state.fr) < 0) state.fr = '';

  var panel = document.createElement('div');
  panel.className = 'hero-lab';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Hero layout preview');
  panel.innerHTML = '<div class="hl-row hl-layouts"><div class="hl-nums"></div><span class="hl-name" aria-live="polite"></span></div>' +
    '<div class="hl-row hl-frame"></div>' +
    '<button type="button" class="hl-min" aria-label="Hide the layout buttons" title="Only you see this (link with ?hero)">Hide</button>';
  var nums = panel.querySelector('.hl-nums'), nameEl = panel.querySelector('.hl-name'), rowF = panel.querySelector('.hl-frame');

  function button(row, label, title, on) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    b.addEventListener('click', on);
    row.appendChild(b);
    return b;
  }
  var layoutButtons = LAYOUTS.map(function (l, i) {
    return button(nums, String(i + 1), (i + 1) + ' · ' + l[1], function () { state.hl = l[0]; apply(true); });
  });
  var frameButtons = FRAMES.map(function (f) { return button(rowF, f[1], '', function () { state.fr = f[0]; apply(true); }); });

  function apply(scroll) {
    if (state.hl) root.setAttribute('data-hl', state.hl); else root.removeAttribute('data-hl');
    if (state.fr === 'vf') root.setAttribute('data-hvf', 'on'); else root.removeAttribute('data-hvf');
    if (state.fr === 'glow') root.setAttribute('data-hglow', 'on'); else root.removeAttribute('data-hglow');
    var k = find(LAYOUTS, state.hl);
    nameEl.textContent = LAYOUTS[k][1];
    layoutButtons.forEach(function (b, i) { b.setAttribute('aria-pressed', String(i === k)); });
    frameButtons.forEach(function (b, i) { b.setAttribute('aria-pressed', String(FRAMES[i][0] === state.fr)); });
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    if (scroll) window.scrollTo({ top: 0, behavior: 'instant' });
    window.dispatchEvent(new Event('resize'));
  }

  // Left / right arrow keys step through the layouts.
  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (t && t.closest && t.closest('.compare, .slides, #heroStage')) return;
    var k = find(LAYOUTS, state.hl) + (e.key === 'ArrowRight' ? 1 : -1);
    state.hl = LAYOUTS[(k + LAYOUTS.length) % LAYOUTS.length][0];
    apply(true);
  });

  var min = panel.querySelector('.hl-min');
  min.addEventListener('click', function () {
    var on = panel.classList.toggle('is-min');
    min.textContent = on ? 'Hero layouts' : 'Hide';
  });
  document.body.appendChild(panel);
  apply(false);
})();
