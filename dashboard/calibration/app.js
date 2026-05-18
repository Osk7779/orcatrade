// /dashboard/calibration/ — Sprint BG-1.6 admin view.
//
// Token-gated. Token is persisted in sessionStorage so a single
// page reload doesn't kick the user back out (same pattern as
// /dashboard/audit/). All numbers come from /api/calibration.

'use strict';

(function () {
  var STORAGE_KEY = 'orca_cal_token';

  var els = {
    form: document.getElementById('controls'),
    token: document.getElementById('token'),
    limit: document.getElementById('limit'),
    loadBtn: document.getElementById('load-btn'),
    error: document.getElementById('error'),
    empty: document.getElementById('empty'),
    results: document.getElementById('results'),
    stats: document.getElementById('stats'),
    alertsPane: document.getElementById('alerts-pane'),    // Sprint BG-1.7
    byRoute: document.getElementById('byRoute'),
    byCategory: document.getElementById('byCategory'),
    byOrigin: document.getElementById('byOrigin'),
    byDestination: document.getElementById('byDestination'),
  };

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  function fmtEur(n) {
    if (!Number.isFinite(Number(n))) return '—';
    return '€' + Math.round(Number(n)).toLocaleString('en-IE');
  }

  function pctLabel(p) {
    if (!Number.isFinite(Number(p))) return '—';
    var n = Number(p);
    if (Math.abs(n) < 0.05) return '0%';
    return (n > 0 ? '+' : '') + n + '%';
  }

  function showError(msg) {
    els.error.textContent = msg;
    els.error.hidden = false;
    els.results.hidden = true;
    els.empty.hidden = true;
  }

  function clearError() {
    els.error.hidden = true;
    els.error.textContent = '';
  }

  function renderStats(total) {
    if (!total || total.sampleSize === 0) {
      els.stats.innerHTML = '';
      return;
    }
    var dirClass = total.direction === 'over' ? 'over'
      : total.direction === 'under' ? 'under'
      : 'neutral';
    els.stats.innerHTML = ''
      + '<div class="stat"><div class="num">' + total.sampleSize + '</div>'
      +   '<div class="label">Actuals (latest per plan)</div></div>'
      + '<div class="stat"><div class="num ' + dirClass + '">'
      +   pctLabel(total.avgVariancePct) + '</div>'
      +   '<div class="label">Avg variance (value-weighted)</div></div>'
      + '<div class="stat"><div class="num">' + fmtEur(total.totalEstimateEur) + '</div>'
      +   '<div class="label">Total estimated</div></div>'
      + '<div class="stat"><div class="num">' + fmtEur(total.totalActualEur) + '</div>'
      +   '<div class="label">Total actual</div></div>'
      + '<div class="stat"><div class="num ' + dirClass + '">'
      +   (total.totalDeltaEur >= 0 ? '+' : '') + fmtEur(total.totalDeltaEur) + '</div>'
      +   '<div class="label">Cumulative delta</div></div>'
      + '<div class="stat"><div class="num">'
      +   total.under + ' / ' + total.onTarget + ' / ' + total.over + '</div>'
      +   '<div class="label">Under / on-target / over</div></div>';
  }

  function renderGroup(groupName, rows, targetEl) {
    if (!rows || rows.length === 0) {
      targetEl.innerHTML = '<div class="empty">No data for this dimension yet.</div>';
      return;
    }
    var html = '<table class="groups"><thead><tr>'
      + '<th>' + escapeHtml(groupName) + '</th>'
      + '<th class="num">Samples</th>'
      + '<th class="num">Avg variance</th>'
      + '<th class="num">Est. total</th>'
      + '<th class="num">Actual total</th>'
      + '<th class="num">Under · On · Over</th>'
      + '</tr></thead><tbody>';

    html += rows.map(function (r) {
      var cls = r.weak ? 'weak' : '';
      var dir = r.avgVariancePct > 0.5 ? 'over'
        : r.avgVariancePct < -0.5 ? 'under'
        : 'neutral';
      if (r.significant) cls = (cls + ' significant ' + dir).trim();
      var pillHtml = r.weak
        ? '<span class="pill">weak sample</span>'
        : (r.significant ? '<span class="pill">significant</span>' : '');
      return '<tr class="' + cls + '">'
        + '<td>' + escapeHtml(r.key) + pillHtml + '</td>'
        + '<td class="num">' + r.sampleSize + '</td>'
        + '<td class="num delta ' + dir + '">' + pctLabel(r.avgVariancePct) + '</td>'
        + '<td class="num">' + fmtEur(r.totalEstimateEur) + '</td>'
        + '<td class="num">' + fmtEur(r.totalActualEur) + '</td>'
        + '<td class="num">' + r.under + ' · ' + r.onTarget + ' · ' + r.over + '</td>'
        + '</tr>';
    }).join('');

    html += '</tbody></table>';
    targetEl.innerHTML = html;
  }

  // Sprint BG-1.7 — current-alerts pane.
  // Each alert: { dimension, key, sampleSize, avgVariancePct, direction, … }
  function renderAlerts(alerts) {
    if (!Array.isArray(alerts) || alerts.length === 0) {
      els.alertsPane.hidden = true;
      els.alertsPane.innerHTML = '';
      return;
    }
    var DIM_LABELS = {
      byRoute: 'route', byCategory: 'category', byOrigin: 'origin', byDestination: 'destination',
    };
    var items = alerts.map(function (a) {
      var pctSign = a.avgVariancePct > 0 ? '+' : '';
      var label = (DIM_LABELS[a.dimension] || a.dimension);
      return '<li>'
        + '<span class="key">' + escapeHtml(label) + ' · ' + escapeHtml(a.key) + '</span> '
        + '<span class="pct ' + a.direction + '">' + pctSign + a.avgVariancePct + '%</span>'
        + '<span class="meta">' + a.sampleSize + ' samples · '
        +   fmtEur(a.totalEstimateEur) + ' est. → ' + fmtEur(a.totalActualEur) + ' actual'
        + '</span>'
      + '</li>';
    }).join('');
    els.alertsPane.innerHTML = '<div class="alerts-pane">'
      + '<div class="alerts-headline">' + alerts.length + ' calibration alert' + (alerts.length === 1 ? '' : 's') + ' active</div>'
      + '<ul>' + items + '</ul>'
      + '</div>';
    els.alertsPane.hidden = false;
  }

  function render(data) {
    clearError();
    if (!data || !data.total || data.total.sampleSize === 0) {
      els.empty.hidden = false;
      els.results.hidden = true;
      els.alertsPane.hidden = true;
      return;
    }
    els.empty.hidden = true;
    els.results.hidden = false;
    renderAlerts(data.alerts);
    renderStats(data.total);
    renderGroup('Route', data.byRoute, els.byRoute);
    renderGroup('Category', data.byCategory, els.byCategory);
    renderGroup('Origin', data.byOrigin, els.byOrigin);
    renderGroup('Destination', data.byDestination, els.byDestination);
  }

  async function load() {
    var token = els.token.value.trim();
    var limit = els.limit.value || 1000;
    if (!token) {
      showError('Token required.');
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, token);
    els.loadBtn.disabled = true;
    els.loadBtn.textContent = 'Loading…';
    try {
      var url = '/api/calibration?token=' + encodeURIComponent(token) +
        '&limit=' + encodeURIComponent(limit);
      var resp = await fetch(url, { credentials: 'same-origin' });
      if (resp.status === 401) {
        showError('Unauthorized — check the token.');
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      if (resp.status === 503) {
        showError('Calibration dashboard not configured on the server (ORCATRADE_LEADS_TOKEN unset).');
        return;
      }
      if (!resp.ok) {
        showError('HTTP ' + resp.status + ' — could not load calibration data.');
        return;
      }
      var data = await resp.json();
      render(data);
    } catch (err) {
      showError('Network error: ' + (err && err.message ? err.message : 'unknown'));
    } finally {
      els.loadBtn.disabled = false;
      els.loadBtn.textContent = 'Load';
    }
  }

  if (typeof document !== 'undefined') {
    els.form.addEventListener('submit', function (e) {
      e.preventDefault();
      load();
    });

    // Restore token from sessionStorage; auto-load if present.
    document.addEventListener('DOMContentLoaded', function () {
      var saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        els.token.value = saved;
        load();
      }
    });
  }
})();
