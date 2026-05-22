// /account/calendar/ — Sprint calendar-ui-v1 client.
// Fetches the signed-in user's upcoming statutory deadlines from
// GET /api/account/calendar and renders them soonest-first. Mirrors the
// auth-gating pattern of /account/preferences/.
(function () {
  'use strict';

  var els = {
    authNeeded: document.getElementById('authNeeded'),
    content: document.getElementById('content'),
    list: document.getElementById('list'),
    empty: document.getElementById('empty'),
    advisory: document.getElementById('advisory'),
    err: document.getElementById('err'),
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function dayLabel(n) {
    if (n === 0) return 'today';
    return n + ' day' + (n === 1 ? '' : 's');
  }

  function severityClass(sev) {
    return 'sev-' + (['critical', 'high', 'medium', 'low'].indexOf(sev) >= 0 ? sev : 'low');
  }

  function renderObligation(o) {
    return '' +
      '<div class="deadline ' + severityClass(o.severity) + '">' +
        '<div class="body">' +
          '<div class="regime">' + esc(o.regime) + '</div>' +
          '<div class="title">' + esc(o.title) + '</div>' +
          (o.detail ? '<div class="detail">' + esc(o.detail) + '</div>' : '') +
          (o.citation ? '<div class="cite">' + esc(o.citation) + '</div>' : '') +
        '</div>' +
        '<div class="when">' +
          '<div class="days">' + dayLabel(o.daysUntil) + '</div>' +
          '<div class="date">' + esc(o.dueDate) + '</div>' +
        '</div>' +
      '</div>';
  }

  function showError(msg) {
    els.err.hidden = false;
    els.err.textContent = msg;
  }

  async function load() {
    try {
      var resp = await fetch('/api/account/calendar', { credentials: 'same-origin' });
      if (resp.status === 401) {
        els.authNeeded.hidden = false;
        return;
      }
      els.content.hidden = false;
      if (!resp.ok) {
        showError('Could not load your calendar (HTTP ' + resp.status + ').');
        return;
      }
      var data = await resp.json();
      var obligations = (data && data.obligations) || [];
      if (!obligations.length) {
        els.empty.hidden = false;
      } else {
        els.list.innerHTML = obligations.map(renderObligation).join('');
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

  load();
})();
