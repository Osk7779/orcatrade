// /account/alerts/ — Sprint monitoring-v1 client.
// Fetches the signed-in user's proactive monitoring alerts from
// GET /api/account/alerts and renders them, with mark-read / dismiss actions
// that POST back. Mirrors the auth-gating pattern of /account/calendar/.
(function () {
  'use strict';

  var els = {
    authNeeded: document.getElementById('authNeeded'),
    content: document.getElementById('content'),
    list: document.getElementById('list'),
    empty: document.getElementById('empty'),
    counts: document.getElementById('counts'),
    markAllBtn: document.getElementById('markAllBtn'),
    advisory: document.getElementById('advisory'),
    err: document.getElementById('err'),
  };

  var TYPE_LABELS = {
    plan_cost_drift: 'Cost drift',
    portfolio_cost_drift: 'Portfolio drift',
    fx_exposure: 'FX exposure',
    compliance_deadline: 'Compliance deadline',
    sanctions_list_update: 'Sanctions update',
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function severityClass(sev) {
    return 'sev-' + (['critical', 'high', 'medium', 'low', 'info'].indexOf(sev) >= 0 ? sev : 'low');
  }

  function renderAlert(a) {
    var isRead = a.status !== 'open';
    var typeLabel = TYPE_LABELS[a.type] || a.type;
    return '' +
      '<div class="alert ' + severityClass(a.severity) + (isRead ? ' is-read' : '') + '" data-id="' + esc(a.id) + '">' +
        '<div class="top">' +
          '<div>' +
            '<div class="type">' + esc(typeLabel) + '</div>' +
            '<div class="title">' + esc(a.title) + '</div>' +
          '</div>' +
          '<div class="sev">' + esc(a.severity) + '</div>' +
        '</div>' +
        (a.body ? '<div class="body">' + esc(a.body) + '</div>' : '') +
        '<div class="actions">' +
          (a.status === 'open' ? '<button class="btn" data-action="markRead" data-id="' + esc(a.id) + '">Mark read</button>' : '') +
          '<button class="btn" data-action="dismiss" data-id="' + esc(a.id) + '">Dismiss</button>' +
        '</div>' +
      '</div>';
  }

  function showError(msg) {
    els.err.hidden = false;
    els.err.textContent = msg;
  }

  async function post(body) {
    var resp = await fetch('/api/account/alerts', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return resp.ok;
  }

  function wireActions() {
    els.list.addEventListener('click', async function (ev) {
      var btn = ev.target.closest('button[data-action]');
      if (!btn) return;
      btn.disabled = true;
      var ok = await post({ action: btn.getAttribute('data-action'), id: btn.getAttribute('data-id') });
      if (ok) load(); else { btn.disabled = false; showError('Could not update that alert.'); }
    });
    els.markAllBtn.addEventListener('click', async function () {
      els.markAllBtn.disabled = true;
      var ok = await post({ action: 'markAllRead' });
      if (ok) load(); else { els.markAllBtn.disabled = false; showError('Could not mark all read.'); }
    });
  }

  async function load() {
    try {
      var resp = await fetch('/api/account/alerts', { credentials: 'same-origin' });
      if (resp.status === 401) { els.authNeeded.hidden = false; return; }
      els.content.hidden = false;
      els.err.hidden = true;
      if (!resp.ok) { showError('Could not load your alerts (HTTP ' + resp.status + ').'); return; }
      var data = await resp.json();
      var alerts = (data && data.alerts) || [];
      els.counts.textContent = (data.openCount || 0) + ' open · ' + alerts.length + ' total';
      els.markAllBtn.hidden = !(data.openCount > 0);
      if (!alerts.length) {
        els.empty.hidden = false;
        els.list.innerHTML = '';
      } else {
        els.empty.hidden = true;
        els.list.innerHTML = alerts.map(renderAlert).join('');
      }
      if (data && data.advisory) {
        els.advisory.hidden = false;
        els.advisory.textContent = data.advisory;
      }
    } catch (err) {
      els.content.hidden = false;
      showError('Network error: ' + (err && err.message ? err.message : 'unknown'));
    }
  }

  wireActions();
  load();
})();
