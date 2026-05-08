// Conversion analytics dashboard client (Sprint 36).
//
// Token comes either from `?token=…` in the URL (preferred — easy to bookmark
// once) or from the password input on the page (sessionStorage caches it
// across page reloads but never persists).
//
// We deliberately keep the token in sessionStorage (not localStorage) so
// closing the tab clears it. The page is noindex/nofollow.

(function () {
  'use strict';

  var els = {
    tokenForm: document.getElementById('token-form'),
    tokenInput: document.getElementById('token'),
    tokenSubmit: document.getElementById('token-submit'),
    tokenErr: document.getElementById('token-err'),
    dashboard: document.getElementById('dashboard'),
    empty: document.getElementById('empty'),
    tiles: document.getElementById('tiles'),
    metaLine: document.getElementById('meta-line'),
    barsCategory: document.getElementById('bars-category'),
    barsRoute: document.getElementById('bars-route'),
    barsOrigin: document.getElementById('bars-origin'),
    barsDest: document.getElementById('bars-dest'),
    barsLocale: document.getElementById('bars-locale'),
    barsType: document.getElementById('bars-type'),
    recentTable: document.getElementById('recent-table'),
  };

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = String(s == null ? '' : s);
    return div.innerHTML;
  }
  function fmtEur(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return '€' + Math.round(Number(n)).toLocaleString('en-IE');
  }
  function fmtPct(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return n + '%';
  }
  function fmtTimestamp(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toISOString().replace('T', ' ').slice(0, 16);
  }

  function renderBars(container, items) {
    if (!items || !items.length) {
      container.innerHTML = '<div style="font-size: 0.82rem; color: rgba(255,255,255,0.4);">No data yet.</div>';
      return;
    }
    var max = items[0].count || 1;
    container.innerHTML = items.map(function (it) {
      var widthPct = Math.max(2, Math.round((it.count / max) * 100));
      return '<div class="bar-row">' +
        '<div class="key">' + escapeHtml(it.key) + '</div>' +
        '<div class="bar" style="width: ' + widthPct + '%"></div>' +
        '<div class="count">' + it.count + '</div>' +
      '</div>';
    }).join('');
  }

  function renderTiles(summary) {
    var tiles = [
      { label: 'Total events', value: summary.total, sub: 'Capped at 5,000 newest' },
      { label: 'Email captured', value: summary.emailCaptured, sub: fmtPct(summary.emailCaptureRate) + ' of submissions' },
      { label: 'Mean landed cost', value: fmtEur(summary.meanLandedEur), sub: 'Per shipment' },
      { label: 'Distinct routes', value: summary.topRoutes.length, sub: 'Top 10 surfaced' },
    ];
    els.tiles.innerHTML = tiles.map(function (t) {
      return '<div class="tile">' +
        '<div class="label">' + escapeHtml(t.label) + '</div>' +
        '<div class="value">' + escapeHtml(String(t.value)) + '</div>' +
        '<div class="sub">' + escapeHtml(t.sub) + '</div>' +
      '</div>';
    }).join('');
  }

  function renderRecent(recent) {
    if (!recent || !recent.length) {
      els.recentTable.innerHTML = '<tr><td>No events yet.</td></tr>';
      return;
    }
    var head = '<tr><th>Time (UTC)</th><th>Type</th><th>Locale</th><th>Route</th><th>Category</th><th>Landed</th><th>Email</th></tr>';
    var rows = recent.map(function (e) {
      return '<tr>' +
        '<td>' + escapeHtml(fmtTimestamp(e.at)) + '</td>' +
        '<td>' + escapeHtml(e.type || '') + '</td>' +
        '<td>' + escapeHtml(e.locale || '—') + '</td>' +
        '<td>' + escapeHtml(e.route || '—') + '</td>' +
        '<td>' + escapeHtml(e.category || '—') + '</td>' +
        '<td>' + escapeHtml(fmtEur(e.landedTotal)) + '</td>' +
        '<td class="' + (e.emailProvided ? 'email-yes' : 'email-no') + '">' + (e.emailProvided ? '✓' : '—') + '</td>' +
      '</tr>';
    }).join('');
    els.recentTable.innerHTML = head + rows;
  }

  function showDashboard(payload) {
    var s = payload.summary;
    els.tokenForm.hidden = true;
    if (!s || s.total === 0) {
      els.empty.hidden = false;
      return;
    }
    els.dashboard.hidden = false;
    renderTiles(s);
    renderBars(els.barsCategory, s.byCategory);
    renderBars(els.barsRoute, s.topRoutes);
    renderBars(els.barsOrigin, s.byOrigin);
    renderBars(els.barsDest, s.byDestination);
    renderBars(els.barsLocale, s.byLocale);
    renderBars(els.barsType, s.byType);
    renderRecent(s.recent);
    els.metaLine.textContent = 'Mode: ' + (payload.mode || '?') + ' · As of ' + fmtTimestamp(payload.asOf);
  }

  function load(token) {
    els.tokenErr.textContent = '';
    fetch('/api/leads?token=' + encodeURIComponent(token), { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 401) {
          els.tokenErr.textContent = 'Invalid token.';
          return null;
        }
        if (r.status === 503) {
          els.tokenErr.textContent = 'Dashboard not configured (set ORCATRADE_LEADS_TOKEN on Vercel).';
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data) return;
        try { sessionStorage.setItem('orcatrade-leads-token', token); } catch (_e) {}
        showDashboard(data);
      })
      .catch(function () {
        els.tokenErr.textContent = 'Network error. Try again.';
      });
  }

  els.tokenSubmit.addEventListener('click', function () {
    var t = (els.tokenInput.value || '').trim();
    if (!t) { els.tokenErr.textContent = 'Token required.'; return; }
    load(t);
  });
  els.tokenInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') els.tokenSubmit.click();
  });

  // Auto-load if token in URL or sessionStorage
  var urlToken = new URLSearchParams(window.location.search).get('token');
  var cached = null;
  try { cached = sessionStorage.getItem('orcatrade-leads-token'); } catch (_e) {}
  var initial = urlToken || cached;
  if (initial) {
    els.tokenInput.value = initial;
    load(initial);
  }
})();
