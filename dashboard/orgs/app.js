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
      return '<tr class="org-row" data-org-id="' + escapeHtml(o.id) + '">'
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
    // local testing). Stops propagation so the click doesn't ALSO
    // trigger the row-expand handler below.
    els.tbody.querySelectorAll('[data-copy-id]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
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

    // Sprint BG-3.7 — clicking a row toggles an inline detail pane.
    // Lazy-fetches GET /api/orgs/admin/<orgId> on first expand; the
    // result is cached on the row so re-expanding doesn't re-fetch.
    els.tbody.querySelectorAll('tr.org-row').forEach(function (row) {
      row.addEventListener('click', function () { toggleDetail(row); });
    });
  }

  // ── Sprint BG-3.7 — per-org detail expand ─────────────

  function renderMembersTable(members) {
    if (!Array.isArray(members) || members.length === 0) {
      return '<div class="detail-empty">No members.</div>';
    }
    var rows = members.map(function (m) {
      return '<tr>'
        + '<td>' + escapeHtml(m.email || '—') + '</td>'
        + '<td><span class="pill role-' + escapeHtml(m.role || 'member') + '">'
        +   escapeHtml(m.role || 'member') + '</span></td>'
        + '<td>' + escapeHtml(fmtDate(m.joinedAt || m.invitedAt)) + '</td>'
      + '</tr>';
    }).join('');
    return '<table class="members"><thead><tr>'
      + '<th>Email</th><th>Role</th><th>Joined</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderDetailPane(data) {
    if (!data || !data.org) return '<div class="detail-err">Could not load detail.</div>';
    var tierLine = data.tier
      ? 'Tier: <strong>' + escapeHtml(data.tier.tierId) + '</strong>'
        + (data.tier.billingCycle ? ' · ' + escapeHtml(data.tier.billingCycle) : '')
        + ' · since ' + escapeHtml(fmtDate(data.tier.since))
      : 'No tier override (members fall through to per-email tier).';
    return '<div class="detail-pane">'
      + '<h3>' + escapeHtml(data.org.name || '—') + '</h3>'
      + '<div class="detail-sub">' + escapeHtml(data.org.id) + '</div>'
      + '<div class="detail-sub">' + tierLine + '</div>'
      + renderMembersTable(data.members)
      + '</div>';
  }

  async function toggleDetail(row) {
    var orgId = row.getAttribute('data-org-id');
    var next = row.nextElementSibling;
    // Collapse if the next sibling is the expanded detail row.
    if (next && next.classList.contains('org-detail')) {
      next.remove();
      row.classList.remove('expanded');
      return;
    }
    row.classList.add('expanded');
    var detailTr = document.createElement('tr');
    detailTr.className = 'org-detail';
    var td = document.createElement('td');
    td.colSpan = 6;
    td.innerHTML = '<div class="detail-loading">Loading…</div>';
    detailTr.appendChild(td);
    row.parentNode.insertBefore(detailTr, row.nextSibling);

    // Sprint admin-session-auth: omit ?token when none is in hand so the
    // server falls back to the cookie path. credentials:same-origin sends
    // the session cookie either way.
    var token = sessionStorage.getItem(STORAGE_KEY) || els.token.value.trim();
    var url = '/api/orgs/admin/' + encodeURIComponent(orgId)
      + (token ? '?token=' + encodeURIComponent(token) : '');
    try {
      var resp = await fetch(url, { credentials: 'same-origin' });
      if (!resp.ok) {
        td.innerHTML = '<div class="detail-err">HTTP ' + resp.status + ' — could not load org detail.</div>';
        return;
      }
      var data = await resp.json();
      td.innerHTML = renderDetailPane(data);
    } catch (err) {
      td.innerHTML = '<div class="detail-err">Network error: '
        + escapeHtml((err && err.message) || 'unknown') + '</div>';
    }
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

  // silent=true is the Sprint admin-session-auth cold-load probe — skips
  // visible "Token required" / 401 errors so an admin signed in via the
  // cookie path doesn't see a spurious error before the cookie attempt
  // resolves.
  async function load(silent) {
    var token = els.token.value.trim();
    var limit = els.limit.value || 200;
    if (token) sessionStorage.setItem(STORAGE_KEY, token);
    els.loadBtn.disabled = true;
    els.loadBtn.textContent = 'Loading…';
    try {
      var url = '/api/orgs/admin?limit=' + encodeURIComponent(limit) +
        (token ? '&token=' + encodeURIComponent(token) : '');
      var resp = await fetch(url, { credentials: 'same-origin' });
      if (resp.status === 401) {
        if (!silent) {
          showError(token ? 'Unauthorized — check the token.' : 'Token required.');
          if (token) sessionStorage.removeItem(STORAGE_KEY);
        }
        return false;
      }
      if (resp.status === 503) {
        if (!silent) showError('Admin endpoint not configured on the server (set ORCATRADE_ADMIN_EMAILS or ORCATRADE_LEADS_TOKEN).');
        return false;
      }
      if (!resp.ok) {
        if (!silent) showError('HTTP ' + resp.status + ' — could not load orgs.');
        return false;
      }
      var data = await resp.json();
      render(data);
      return true;
    } catch (err) {
      if (!silent) showError('Network error: ' + (err && err.message ? err.message : 'unknown'));
      return false;
    } finally {
      els.loadBtn.disabled = false;
      els.loadBtn.textContent = 'Load';
    }
  }

  if (typeof document !== 'undefined') {
    els.form.addEventListener('submit', function (e) {
      e.preventDefault();
      load(false);
    });

    document.addEventListener('DOMContentLoaded', function () {
      var saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) els.token.value = saved;
      // Cookie-first probe (Sprint admin-session-auth).
      load(true);
    });
  }
})();
