/* Titles never break inside a hyphenated word ("time-of-flight",
   "super-resolution"): each one is wrapped in a no-wrap span. */
(function () {
  'use strict';
  var SEL = 'h1, h2, h3, h4, .hero-statement, .statement, .section-title, .contact-title';
  Array.prototype.forEach.call(document.querySelectorAll(SEL), function (el) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (n) {
      if (!/\S-\S/.test(n.nodeValue) || (n.parentNode.classList && n.parentNode.classList.contains('nobr'))) return;
      var frag = document.createDocumentFragment();
      n.nodeValue.split(/(\S+-\S+)/).forEach(function (part, i) {
        if (!part) return;
        if (i % 2) { var s = document.createElement('span'); s.className = 'nobr'; s.textContent = part; frag.appendChild(s); }
        else frag.appendChild(document.createTextNode(part));
      });
      n.parentNode.replaceChild(frag, n);
    });
  });
})();
