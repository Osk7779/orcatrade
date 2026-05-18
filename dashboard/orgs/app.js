// /dashboard/orgs/ — Sprint BG-3.6 admin view of every org.
//
// Token-gated. Token persisted to sessionStorage (same pattern as
// /dashboard/audit/ + /dashboard/calibration/) so reload doesn't kick
// the user back to the form.

'use strict';

(function () {
  var STORAGE_KEY = 'orca_orgs_admin_token';

  var els = {
    form: document.getElementById('controls'),
    token: document.getElementById('token'),
    limit: document.getElementById('limit'),
    loadBtn: document.getElementById('load-btn'),
    error: document.getElementById('error'),
    empty: document.getElementById('empty'),
    results: document.getElementById('results'),
    stats: document.getElementById('stats'),
    tbody: document.getElementById('orgs-tbody'),
  };

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
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

  function renderStats(data) {
    var orgsCount = (data.orgs || []).length;
    var withTier = (data.orgs || []).filter(function (o) { return o.tier; }).length;
    var totalMembers = (data.orgs || []).reduce(function (acc, o) { return acc + (o.memberCount || 0); }, 0);
    els.stats.innerHTML = ''
      + '<div class="stat"><div class="num">' + orgsCount + '</div>'
      +   '<div class="label">Orgs</div></div>'
      + '<div class="stat"><div class="num">' + withTier + '</div>'
      +   '<div class="label">With tier override</div></div>'
      + '<div class="stat"><div class="num">' + totalMembers + '</div>'
      +   '<div class="label">Total memberships</div></div>';
  }

  function renderTier(tier) {
    if (!tier) return '<span class="pill tier-none">—</span>';
    return '<span class="pill tier-' + escapeHtml(tier.tierId) + '">'
      + escapeHtml(tier.tierId)
      + (tier.billingCycle ? ' · ' + escapeHtml(tier.billingCycle) : '')
      + '</span>';
  }

  function renderRows(orgs) {
    if (!orgs || orgs.length === 0) {
      els.tbody.innerHTML = '';
      return;
    }
    els.tbody.innerHTML = orgs.map(function (o) {
      var tierActionLink = '/api/orgs/' + encodeURIComponent(o.id) + '/tier';
      return '<tr>'
        + '<td class="name">' + escapeHtml(o.name || '—')
        +   '<div class="id">' + escapeHtml(o.id) + '</div>'
        + '</td>'
        + '<td>' + escapeHtml(o.ownerEmail || '—') + '</td>'
        + '<td class="num">' + (o.memberCount || 0) + '</td>'
        + '<td>' + renderTier(o.tier) + '</td>'
        + '<td>' + escapeHtml(fmtDate(o.createdAt)) + '</td>'
        + '<td><button type="button" class="btn" data-copy-id="' + escapeHtml(o.id) + '">Copy ID</button></td>'
      + '</tr>';
    }).join('');

    // Wire the per-row "Copy ID" buttons. Falls back to a visible
    // confirmation when clipboard API is unavailable (e.g. non-HTTPS
    // local testing).
    els.tbody.querySelectorAll('[data-copy-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-copy-id');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(id).then(function () {
            btn.textContent = 'Copied ✓';
            setTimeout(function () { btn.textContent = 'Copy ID'; }, 1400);
          }).catch(function () {
            btn.textContent = id;
          });
        } else {
          btn.textContent = id;
        }
      });
    });
  }

  function render(data) {
    clearError();
    if (!data || !Array.isArray(data.orgs) || data.orgs.length === 0) {
      els.empty.hidden = false;
      els.results.hidden = true;
      return;
    }
    els.empty.hidden = true;
    els.results.hidden = false;
    renderStats(data);
    renderRows(data.orgs);
  }

  async function load() {
    var token = els.token.value.trim();
    var limit = els.limit.value || 200;
    if (!token) { showError('Token required.'); return; }
    sessionStorage.setItem(STORAGE_KEY, token);
    els.loadBtn.disabled = true;
    els.loadBtn.textContent = 'Loading…';
    try {
      var url = '/api/orgs/admin?token=' + encodeURIComponent(token) +
        '&limit=' + encodeURIComponent(limit);
      var resp = await fetch(url, { credentials: 'same-origin' });
      if (resp.status === 401) {
        showError('Unauthorized — check the token.');
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      if (resp.status === 503) {
        showError('Admin endpoint not configured on the server (ORCATRADE_LEADS_TOKEN unset).');
        return;
      }
      if (!resp.ok) {
        showError('HTTP ' + resp.status + ' — could not load orgs.');
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

    document.addEventListener('DOMContentLoaded', function () {
      var saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        els.token.value = saved;
        load();
      }
    });
  }
})();
