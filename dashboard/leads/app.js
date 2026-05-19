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
    foundingPanel: document.getElementById('founding-panel'),
    foundingTable: document.getElementById('founding-table'),
    wizardFunnelPanel: document.getElementById('wizard-funnel-panel'),
    wizardFunnel: document.getElementById('wizard-funnel'),
    exportCsvBtn: document.getElementById('export-csv-btn'),
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
      // Sprint G: HS-code engagement on the new optional wizard field
      { label: 'HS code provided', value: summary.hsCodeProvided != null ? summary.hsCodeProvided : 0,
        sub: fmtPct(summary.hsCodeProvidedRate || 0) + ' of plans · drives live TARIC lookup' },
      // Sprint J.3: Founding 10 pipeline
      { label: 'Founding 10 applied',
        value: (summary.foundingApplied || 0) + (summary.foundingApplied >= 10 ? '' : ' / 10'),
        sub: (summary.foundingWaitlist || 0) > 0
          ? (summary.foundingWaitlist + ' on waitlist · ' + Math.max(0, 10 - (summary.foundingApplied || 0)) + ' spots left')
          : (Math.max(0, 10 - (summary.foundingApplied || 0)) + ' spots remaining') },
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

  // Sprint J.3: Recent Founding 10 applications panel. Hidden until at least
  // one application has come in — empty state on the dashboard would just be
  // noise next to a "0 applied" tile.
  function renderFounding(recent) {
    if (!els.foundingPanel || !els.foundingTable) return;
    if (!recent || !recent.length) {
      els.foundingPanel.hidden = true;
      return;
    }
    els.foundingPanel.hidden = false;
    var head = '<tr><th>Time (UTC)</th><th>Name</th><th>Company</th><th>Email</th><th>Role</th><th>Monthly €</th><th>Status</th></tr>';
    var rows = recent.map(function (a) {
      var status = a.waitlist
        ? '<span style="color:#f59e0b;">Waitlist</span>'
        : '<span style="color:#5fb56b;">Founding</span>';
      return '<tr>' +
        '<td>' + escapeHtml(fmtTimestamp(a.at)) + '</td>' +
        '<td>' + escapeHtml(a.name || '—') + '</td>' +
        '<td>' + escapeHtml(a.company || '—') + '</td>' +
        '<td>' + escapeHtml(a.email || '—') + '</td>' +
        '<td>' + escapeHtml(a.role || '—') + '</td>' +
        '<td>' + escapeHtml(a.monthlyValueEur || '—') + '</td>' +
        '<td>' + status + '</td>' +
      '</tr>';
    }).join('');
    els.foundingTable.innerHTML = head + rows;
  }

  // Sprint wizard-step-funnel-v1 — six rows, each showing the next/back/
  // submit counts at that step. Drop-off between consecutive steps is
  // the headline signal (step N next vs step N+1 next, capping the
  // funnel at step 6 = submit).
  function renderWizardFunnel(funnel) {
    if (!funnel || !Array.isArray(funnel.byStep) || funnel.byStep.length === 0) {
      els.wizardFunnelPanel.hidden = true;
      return;
    }
    var anyEvents = funnel.totalNext + funnel.totalBack + funnel.totalSubmit;
    if (anyEvents === 0) {
      els.wizardFunnelPanel.hidden = true;
      return;
    }
    var max = 0;
    for (var i = 0; i < funnel.byStep.length; i++) {
      max = Math.max(max, funnel.byStep[i].total || 0);
    }
    if (max === 0) max = 1;
    els.wizardFunnel.innerHTML = funnel.byStep.map(function (slot) {
      var widthPct = Math.max(2, Math.round((slot.total / max) * 100));
      var meta = 'next: ' + slot.next + ' · back: ' + slot.back;
      if (slot.submit) meta += ' · submit: ' + slot.submit;
      return '<div class="bar-row">' +
        '<div class="key">Step ' + slot.step + '</div>' +
        '<div class="bar" style="width: ' + widthPct + '%"></div>' +
        '<div class="count">' + slot.total + ' <span style="opacity:0.55;font-size:0.78em">(' + meta + ')</span></div>' +
      '</div>';
    }).join('');
    els.wizardFunnelPanel.hidden = false;
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
    renderWizardFunnel(s.wizardFunnel);
    renderRecent(s.recent);
    renderFounding(s.foundingRecent);
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

  // Sprint leads-csv-export-v1 — Export CSV button. Reuses the same
  // auth path as the dashboard fetch: when an admin email is signed
  // in, the cookie alone authenticates; otherwise we attach the token
  // from sessionStorage (or the URL) as a query param.
  function exportCsv() {
    var token = null;
    try { token = sessionStorage.getItem('orcatrade-leads-token'); } catch (_e) {}
    if (!token) token = new URLSearchParams(window.location.search).get('token');
    var url = '/api/leads?format=csv&limit=5000';
    if (token) url += '&token=' + encodeURIComponent(token);
    els.exportCsvBtn.disabled = true;
    var orig = els.exportCsvBtn.textContent;
    els.exportCsvBtn.textContent = 'Exporting…';
    fetch(url, { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob().then(function (blob) {
          var match = (r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/);
          var filename = match ? match[1] : 'orcatrade-leads.csv';
          var objectUrl = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = objectUrl; a.download = filename; a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          setTimeout(function () {
            document.body.removeChild(a);
            URL.revokeObjectURL(objectUrl);
          }, 0);
        });
      })
      .catch(function (err) {
        alert('Could not export CSV: ' + (err && err.message ? err.message : 'unknown'));
      })
      .then(function () {
        els.exportCsvBtn.disabled = false;
        els.exportCsvBtn.textContent = orig;
      });
  }
  if (els.exportCsvBtn) {
    els.exportCsvBtn.addEventListener('click', exportCsv);
  }

  // Sprint admin-session-auth — try the session cookie first. If the
  // signed-in user is on ORCATRADE_ADMIN_EMAILS the request succeeds
  // and we render straight away. On 401 we fall back to the token form
  // (URL ?token=, sessionStorage cache, or manual paste).
  function tryCookieAuth() {
    return fetch('/api/leads', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return false;
        showDashboard(data);
        return true;
      })
      .catch(function () { return false; });
  }

  tryCookieAuth().then(function (ok) {
    if (ok) return;
    var urlToken = new URLSearchParams(window.location.search).get('token');
    var cached = null;
    try { cached = sessionStorage.getItem('orcatrade-leads-token'); } catch (_e) {}
    var initial = urlToken || cached;
    if (initial) {
      els.tokenInput.value = initial;
      load(initial);
    }
  });
})();
