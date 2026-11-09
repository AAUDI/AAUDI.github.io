/* Hero lab: a private switcher to compare hero layouts on the live site.
   It only appears with ?hero in the address (e.g. aaudi.github.io/?hero);
   visitors never see it and keep the current hero. The choice is kept in
   localStorage while testing. Remove this file once a layout is chosen. */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  if (!params.has('hero')) return;

  var root = document.documentElement;
  var KEY = 'hero-lab';
  var LAYOUTS = [['', 'Current'], ['stage', 'Centered stage'], ['control', 'Control room'], ['split', 'Split screen'], ['cinema', 'Cinematic']];
  var state = { hl: '', vf: false };
  try { var saved = JSON.parse(localStorage.getItem(KEY) || '{}'); if (saved) { state.hl = saved.hl || ''; state.vf = !!saved.vf; } } catch (e) {}
  var asked = params.get('hero');
  if (asked && LAYOUTS.some(function (l) { return l[0] === asked; })) state.hl = asked;

  var panel = document.createElement('div');
  panel.className = 'hero-lab';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Hero layout preview');
  panel.innerHTML = '<div class="hl-row hl-layouts"></div><div class="hl-row hl-frame"></div><button type="button" class="hl-min" aria-label="Hide the layout buttons" title="Only you see this (link with ?hero)">Hide</button>';
  var rowL = panel.querySelector('.hl-layouts'), rowF = panel.querySelector('.hl-frame');

  function button(row, label, on) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.addEventListener('click', on);
    row.appendChild(b);
    return b;
  }
  var layoutButtons = LAYOUTS.map(function (l) { return button(rowL, l[1], function () { state.hl = l[0]; apply(true); }); });
  var clean = button(rowF, 'Clean frame', function () { state.vf = false; apply(true); });
  var vf = button(rowF, 'Viewfinder', function () { state.vf = true; apply(true); });

  function apply(scroll) {
    if (state.hl) root.setAttribute('data-hl', state.hl); else root.removeAttribute('data-hl');
    if (state.vf) root.setAttribute('data-hvf', 'on'); else root.removeAttribute('data-hvf');
    LAYOUTS.forEach(function (l, i) { layoutButtons[i].setAttribute('aria-pressed', String(l[0] === state.hl)); });
    clean.setAttribute('aria-pressed', String(!state.vf));
    vf.setAttribute('aria-pressed', String(state.vf));
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    if (scroll) window.scrollTo({ top: 0, behavior: 'instant' });
    window.dispatchEvent(new Event('resize'));
  }

  var min = panel.querySelector('.hl-min');
  min.addEventListener('click', function () {
    var on = panel.classList.toggle('is-min');
    min.textContent = on ? 'Hero layouts' : 'Hide';
  });
  document.body.appendChild(panel);
  apply(false);
})();
