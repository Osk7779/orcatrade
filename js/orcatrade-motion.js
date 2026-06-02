/* OrcaTrade shared scroll-reveal + light motion.
   Pairs with css/orcatrade-shell.css. On every page that loads the shell,
   any element marked [data-fade-up] starts hidden and is revealed (class
   .ot-revealed) when it enters the viewport. Respects
   prefers-reduced-motion and IntersectionObserver availability.

   Auto-tags common candidates so legacy HTML benefits without per-page
   markup edits:
     - <section>, <article>, .card, .tier, .feature, .addon, .step,
       .panel, .quote-card, .testimonial — top-level children of <main>.
*/
(function () {
  'use strict';

  var ROOT_SELECTOR =
    'section, article, .card, .tier, .feature, .addon, .step, .panel, .quote-card, .testimonial';

  function ready(fn) {
    if (document.readyState !== 'loading') return fn();
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  function autoTag() {
    // Tag obvious storytelling blocks. Skip if already tagged or inside a
    // [data-no-reveal] container (escape hatch).
    var nodes = document.querySelectorAll(ROOT_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.hasAttribute('data-fade-up')) continue;
      if (n.closest('[data-no-reveal]')) continue;
      // Don't tag deeply nested grandchildren — only first-level reveals.
      if (n.parentElement && n.parentElement.closest(ROOT_SELECTOR)) continue;
      n.setAttribute('data-fade-up', '');
    }
  }

  function reveal(el) {
    el.classList.add('ot-revealed');
  }

  function init() {
    var reduce =
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    autoTag();

    var targets = document.querySelectorAll('[data-fade-up]');
    if (!targets.length) return;

    if (reduce || typeof IntersectionObserver === 'undefined') {
      for (var i = 0; i < targets.length; i++) reveal(targets[i]);
      return;
    }

    var io = new IntersectionObserver(
      function (entries) {
        for (var k = 0; k < entries.length; k++) {
          var e = entries[k];
          if (e.isIntersecting) {
            reveal(e.target);
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 }
    );

    for (var j = 0; j < targets.length; j++) {
      // If the element is already on screen at load time, reveal immediately
      // to avoid an awkward first-paint blank.
      var r = targets[j].getBoundingClientRect();
      if (r.top < window.innerHeight * 0.92 && r.bottom > 0) {
        reveal(targets[j]);
      } else {
        io.observe(targets[j]);
      }
    }
  }

  ready(init);
})();
