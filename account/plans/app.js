// Saved-plans listing page client.
//   1. GET /api/plans
//   2. If 401 → show sign-in CTA
//   3. If 200 + empty → show empty state
//   4. If 200 + populated → render cards with Open / Delete actions
//
// Uses the share-codec encoder to build a `/start/?p=<base64>` link
// from each saved plan's inputs. We embed a minimal copy of the codec
// (same algorithm as start/app.js) to avoid pulling the wizard's full JS.

(function () {
  'use strict';

  // ── Mini share-codec (copy of start/app.js encodeShareInputs) ──
  var SHARE_KEYS = [
    'productCategory', 'originCountry', 'destinationCountry',
    'customsValueEur', 'weightKg', 'linesCount', 'urgencyWeeks',
    'monthlyOrders', 'avgUnitsPerOrder', 'avgPalletsHeld', 'avgOrderWeightKg',
    'claimPreferential', 'hsCode', 'moq', 'targetFobUnitEur',
    'quoteCurrency', 'paymentTermsDays',
    'shipmentsPerYear', 'waccPct', 'daysInInventory', 'daysReceivable',
  ];

  function encodeShareInputs(inputs) {
    var minimal = {};
    SHARE_KEYS.forEach(function (k) {
      if (inputs[k] !== undefined && inputs[k] !== null && inputs[k] !== '') minimal[k] = inputs[k];
    });
    var json = JSON.stringify(minimal);
    var bytes = new TextEncoder().encode(json);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function buildPlanUrl(record) {
    return '/start/?p=' + encodeShareInputs(record.inputs);
  }

  // ── Element refs ────────────────────────────────────

  var loadingEl = document.getElementById('plans-loading');
  var listEl = document.getElementById('plans-list');
  var emptyEl = document.getElementById('plans-empty');
  var signinEl = document.getElementById('plans-signin');

  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }
  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = String(s == null ? '' : s);
    return div.innerHTML;
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  }
  function fmtEur(n) {
    if (!Number.isFinite(Number(n))) return '';
    return '€' + Math.round(Number(n)).toLocaleString('en-IE');
  }
  function driverLabel(d) {
    return ({ duty: 'duty', vat: 'VAT', transport: 'freight', brokerage: 'brokerage' }[d]) || 'pricing';
  }

  // Diff badge: only render when we have both a saved snapshot and a recomputed
  // total. Significance threshold (≥5%) comes from the server.
  function renderDelta(r) {
    if (!r.delta || !r.snapshot || !r.current) return '';
    var d = r.delta;
    var direction = d.landedDeltaEur > 0 ? 'up' : (d.landedDeltaEur < 0 ? 'down' : 'flat');
    var cls = 'delta-' + direction + (d.significant ? ' delta-significant' : '');
    var arrow = direction === 'up' ? '▲' : (direction === 'down' ? '▼' : '·');
    var sign = d.landedDeltaEur > 0 ? '+' : '';
    var pctSign = d.landedDeltaPct > 0 ? '+' : '';
    var headline;
    if (direction === 'flat' || Math.abs(d.landedDeltaEur) < 1) {
      headline = 'Pricing steady since you saved this';
    } else {
      headline = 'Landed cost ' + (direction === 'up' ? 'up' : 'down') +
        ' ' + sign + fmtEur(d.landedDeltaEur) + ' (' + pctSign + d.landedDeltaPct + '%)' +
        (d.primaryDriver ? ' — ' + driverLabel(d.primaryDriver) + ' moved most' : '');
    }
    var savedLine = 'Saved at ' + fmtEur(r.snapshot.perShipmentLandedTotal) +
      ' · now ' + fmtEur(r.current.perShipmentLandedTotal);
    return '<div class="plan-delta ' + cls + '">' +
        '<span class="delta-arrow">' + arrow + '</span>' +
        '<span class="delta-text">' + escapeHtml(headline) + '</span>' +
        '<span class="delta-sub">' + escapeHtml(savedLine) + '</span>' +
      '</div>';
  }

  // ── Render ──────────────────────────────────────────

  function renderList(records) {
    if (!records.length) {
      hide(loadingEl);
      show(emptyEl);
      return;
    }
    listEl.innerHTML = records.map(function (r) {
      var url = buildPlanUrl(r);
      return '<div class="plan-card" data-plan-id="' + escapeHtml(r.id) + '">' +
        '<div class="plan-info">' +
          '<div class="plan-label">' + escapeHtml(r.label || '(unnamed plan)') + '</div>' +
          '<div class="plan-meta">' + escapeHtml(r.id) + ' · saved ' + escapeHtml(fmtDate(r.savedAt)) + '</div>' +
          renderDelta(r) +
        '</div>' +
        '<div class="plan-actions">' +
          '<a href="' + url + '">Open</a>' +
          '<button type="button" class="delete-btn" data-action="delete">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');
    hide(loadingEl);
    show(listEl);

    // Wire delete buttons
    listEl.querySelectorAll('.delete-btn[data-action="delete"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('.plan-card');
        var planId = card.getAttribute('data-plan-id');
        if (!confirm('Delete this saved plan?')) return;
        btn.disabled = true;
        btn.textContent = '...';
        fetch('/api/plans/' + encodeURIComponent(planId), {
          method: 'DELETE',
          credentials: 'same-origin',
        }).then(function (r) {
          if (r.ok) {
            card.style.display = 'none';
          } else {
            btn.disabled = false;
            btn.textContent = 'Delete';
          }
        }).catch(function () {
          btn.disabled = false;
          btn.textContent = 'Delete';
        });
      });
    });
  }

  // ── Init ────────────────────────────────────────────

  fetch('/api/plans', { credentials: 'same-origin' })
    .then(function (r) {
      if (r.status === 401) {
        hide(loadingEl);
        show(signinEl);
        return null;
      }
      return r.ok ? r.json() : null;
    })
    .then(function (data) {
      if (!data) return;
      renderList(Array.isArray(data.plans) ? data.plans : []);
    })
    .catch(function () {
      hide(loadingEl);
      show(signinEl);
    });
})();
