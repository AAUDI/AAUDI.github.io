/* Project filters on the home page: buttons above "Selected projects" show
   only the cards whose data-tags contain the chosen field. Counts are
   computed from the cards, so they stay right when a project is added. */
(function () {
  'use strict';

  var bar = document.querySelector('.pfilter');
  var grid = document.querySelector('.pgrid');
  if (!bar || !grid) return;
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.pcard'));
  var buttons = Array.prototype.slice.call(bar.querySelectorAll('button[data-f]'));

  function has(card, f) {
    return f === 'all' || (' ' + (card.getAttribute('data-tags') || '') + ' ').indexOf(' ' + f + ' ') >= 0;
  }

  buttons.forEach(function (b) {
    var n = cards.filter(function (c) { return has(c, b.getAttribute('data-f')); }).length;
    var count = b.querySelector('span');
    if (count) count.textContent = n;
    if (!n) b.hidden = true;
  });

  function apply(f) {
    cards.forEach(function (c) {
      var on = has(c, f);
      c.hidden = !on;
      // A card brought back is shown at once, without waiting for the scroll reveal.
      if (on) c.classList.add('in');
    });
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-f') === f)); });
  }

  buttons.forEach(function (b) {
    b.addEventListener('click', function () { apply(b.getAttribute('data-f')); });
  });
})();
