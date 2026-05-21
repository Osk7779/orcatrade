// /account/portfolios/ — Sprint portfolio-v1 (phase 3) client.
//
// Lists the signed-in user's saved portfolios (GET /api/portfolio/list),
// renders a card per portfolio with its aggregate snapshot, and offers
// Open (→ /portfolio/?id=<id>, which recomputes) + Delete.

(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  var els = {
    authNeeded: document.getElementById('authNeeded'),
    content: document.getElementById('content'),
    list: document.getElementById('list'),
    empty: document.getElementById('empty'),
    err: document.getElementById('err'),
  };

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }
  function fmtEur(n) {
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
  }
  function showErr(msg) { els.err.hidden = !msg; els.err.textContent = msg || ''; }

  function renderCard(p) {
    var snap = p.snapshot || {};
    var totals = snap.totals || {};
    var figs = '<span class="accent">' + fmtEur(totals.perShipmentLandedTotal) + '</span> landed'
      + ' · ' + (snap.blendedDutyRatePct != null ? snap.blendedDutyRatePct.toFixed(1) + '% blended duty' : '—');
    if (snap.consolidationSavingEur > 0) {
      figs += ' · <span class="save">' + fmtEur(snap.consolidationSavingEur) + '</span> consolidation saving';
    }
    return '<div class="pf-card" data-id="' + escapeHtml(p.id) + '">'
      + '<div class="pf-title">' + escapeHtml(p.label) + '</div>'
      + '<div class="pf-meta">' + (p.lineCount || 0) + ' SKU' + ((p.lineCount === 1) ? '' : 's') + ' · saved ' + escapeHtml(fmtDate(p.savedAt)) + '</div>'
      + '<div class="pf-figs">' + figs + '</div>'
      + '<div class="pf-share" data-share hidden></div>'
      + '<div class="pf-actions">'
      +   '<a class="pf-open" href="/portfolio/?id=' + encodeURIComponent(p.id) + '">Open</a>'
      +   '<button type="button" class="pf-share-btn" data-action="share">Share</button>'
      +   '<button type="button" class="pf-del" data-action="delete">Delete</button>'
      + '</div>'
      + '</div>';
  }

  function shareUrl(code) {
    return window.location.origin + '/portfolio/?share=' + code;
  }

  function renderShareRow(box, code) {
    var url = shareUrl(code);
    box.hidden = false;
    box.innerHTML = '<input type="text" class="pf-share-url" readonly value="' + escapeHtml(url) + '" />'
      + '<button type="button" class="pf-copy" data-action="copy">Copy</button>'
      + '<button type="button" class="pf-revoke" data-action="revoke">Revoke</button>'
      + '<span class="pf-share-note">Anyone with this link sees the portfolio recomputed live — read-only, no sign-in.</span>';
    var urlInput = box.querySelector('.pf-share-url');
    box.querySelector('[data-action="copy"]').addEventListener('click', function () {
      urlInput.select();
      try { navigator.clipboard.writeText(url); } catch (_) { document.execCommand('copy'); }
      var b = box.querySelector('[data-action="copy"]'); b.textContent = 'Copied ✓';
      setTimeout(function () { b.textContent = 'Copy'; }, 1800);
    });
    box.querySelector('[data-action="revoke"]').addEventListener('click', function () {
      if (!confirm('Revoke this share link? Anyone who has it will lose access.')) return;
      var card = box.closest('.pf-card');
      var id = card && card.getAttribute('data-id');
      fetch('/api/portfolio/item/' + encodeURIComponent(id) + '/share', { method: 'DELETE', credentials: 'same-origin' })
        .then(function () { box.hidden = true; box.innerHTML = ''; })
        .catch(function () { showErr('Could not revoke the link.'); });
    });
  }

  function wireShares() {
    els.list.querySelectorAll('[data-action="share"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('.pf-card');
        var id = card && card.getAttribute('data-id');
        var box = card && card.querySelector('[data-share]');
        if (!id || !box) return;
        // Toggle if already shown.
        if (!box.hidden && box.innerHTML) { box.hidden = true; return; }
        btn.disabled = true; btn.textContent = 'Sharing…';
        fetch('/api/portfolio/item/' + encodeURIComponent(id) + '/share', { method: 'POST', credentials: 'same-origin' })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (resp) {
            btn.disabled = false; btn.textContent = 'Share';
            if (resp.ok && resp.j.code) renderShareRow(box, resp.j.code);
            else showErr('Could not create a share link.');
          })
          .catch(function () { btn.disabled = false; btn.textContent = 'Share'; showErr('Network error.'); });
      });
    });
  }

  function wireDeletes() {
    els.list.querySelectorAll('[data-action="delete"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('.pf-card');
        var id = card && card.getAttribute('data-id');
        if (!id) return;
        if (!confirm('Delete this saved portfolio? This cannot be undone.')) return;
        btn.disabled = true; btn.textContent = 'Deleting…';
        fetch('/api/portfolio/item/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin' })
          .then(function (r) { return r.ok; })
          .then(function (ok) {
            if (ok) {
              card.remove();
              if (!els.list.querySelector('.pf-card')) els.empty.hidden = false;
            } else {
              btn.disabled = false; btn.textContent = 'Delete';
              showErr('Could not delete that portfolio.');
            }
          })
          .catch(function () { btn.disabled = false; btn.textContent = 'Delete'; showErr('Network error.'); });
      });
    });
  }

  fetch('/api/portfolio/list', { credentials: 'same-origin' })
    .then(function (r) {
      if (r.status === 401) { els.authNeeded.hidden = false; return null; }
      return r.ok ? r.json() : null;
    })
    .then(function (data) {
      if (!data) return;
      els.content.hidden = false;
      var items = (data.portfolios) || [];
      if (!items.length) { els.empty.hidden = false; return; }
      els.list.innerHTML = items.map(renderCard).join('');
      wireDeletes();
      wireShares();
    })
    .catch(function () {
      els.content.hidden = false;
      showErr('Could not load your portfolios.');
    });
})();
