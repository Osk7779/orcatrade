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
      + '<div class="pf-actions">'
      +   '<a class="pf-open" href="/portfolio/?id=' + encodeURIComponent(p.id) + '">Open</a>'
      +   '<button type="button" class="pf-del" data-action="delete">Delete</button>'
      + '</div>'
      + '</div>';
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
    })
    .catch(function () {
      els.content.hidden = false;
      showErr('Could not load your portfolios.');
    });
})();
