(function () {
  // ── Styles ──────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = [
    '#pt-overlay{position:fixed;inset:0;z-index:99999;background:#050507;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity 0.6s ease;}',
    '#pt-overlay.pt-visible{opacity:1;pointer-events:all;}',
    '.pt-inner{text-align:center;user-select:none;}',
    '.pt-wordmark{display:block;font-family:"Cormorant Garamond","Playfair Display",Georgia,serif;font-weight:300;font-size:clamp(1.6rem,5vw,4.2rem);letter-spacing:0.42em;text-indent:0.42em;color:#f5f0e8;opacity:0;transition:opacity 0.8s ease;}',
    '.pt-wordmark.pt-show{opacity:1;}',
    '.pt-line{width:0;height:1px;background:linear-gradient(to right,transparent,#ffffff,transparent);margin:1.4rem auto 0;transition:width 0.9s ease 0.3s;}',
    '.pt-line.pt-show{width:120px;}'
  ].join('');
  document.head.appendChild(style);

  // ── Overlay HTML ─────────────────────────────────────────
  var overlay = document.createElement('div');
  overlay.id = 'pt-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = '<div class="pt-inner"><span class="pt-wordmark">ORCATRADE HOLDING</span><div class="pt-line"></div></div>';
  document.body.appendChild(overlay);

  var wordmark = overlay.querySelector('.pt-wordmark');
  var line     = overlay.querySelector('.pt-line');

  function showOverlay() {
    wordmark.classList.remove('pt-show');
    line.classList.remove('pt-show');
    overlay.classList.add('pt-visible');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        wordmark.classList.add('pt-show');
        line.classList.add('pt-show');
      });
    });
  }

  function hideOverlay() {
    overlay.classList.remove('pt-visible');
    wordmark.classList.remove('pt-show');
    line.classList.remove('pt-show');
  }

  // ── Page-load reveal ─────────────────────────────────────
  // Skip auto-show on the homepage — it has its own intro overlay
  if (!document.getElementById('intro-overlay')) {
    showOverlay();
    setTimeout(hideOverlay, 1100);
  }

  // Always hide on pageshow (covers browser back/forward cache)
  window.addEventListener('pageshow', function () {
    hideOverlay();
  });

  // ── Intercept internal link clicks ───────────────────────
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href');
    // Skip: empty, anchors, external, mailto, tel
    if (!href || href.charAt(0) === '#' || /^(https?:|mailto:|tel:)/.test(href)) return;
    // Skip: opens in new tab
    if (link.target === '_blank') return;

    e.preventDefault();
    var dest = href;
    showOverlay();
    setTimeout(function () { window.location.href = dest; }, 500);
  });
})();
