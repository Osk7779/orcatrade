// /trust/anchors/ — visual timeline of the rolling audit-chain
// anchor history (apex III2 follow-on to PRs #35 + #37 + #38).
//
// Public, unauthenticated. Renders the response from
// GET /api/audit-anchor/history (capped at MAX_SNAPSHOTS = 90)
// as a vertical timeline. The newest row is highlighted as
// `is-newest` so a procurement reader's eye lands on "this is
// the current state" before scanning historical rows.

(function () {
  'use strict';

  var loadingEl = document.getElementById('anchors-loading');
  var emptyEl = document.getElementById('anchors-empty');
  var errorEl = document.getElementById('anchors-error');
  var timelineEl = document.getElementById('anchors-timeline');

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = String(s == null ? '' : s);
    return div.innerHTML;
  }

  // ISO datetime → "2026-06-01 02:00 UTC" for at-a-glance reading.
  function fmtTimestamp(iso) {
    if (!iso) return '';
    // Render YYYY-MM-DD HH:mm UTC. We deliberately don't honour
    // the viewer's local timezone — the chain head is a global
    // fact, and a procurement reviewer comparing two pins should
    // see consistent timestamps regardless of where they're sitting.
    return String(iso).slice(0, 10) + ' ' + String(iso).slice(11, 16) + ' UTC';
  }

  function renderTimeline(snapshots) {
    timelineEl.innerHTML = snapshots.map(function (s, i) {
      var isNewest = i === 0;
      var headFull = String(s.chainHead || '');
      // Render the full sha256 hex (it's a fingerprint; truncating
      // would defeat the verification flow — a customer who pinned
      // the full head can't compare against a truncated one).
      var newestPill = isNewest ? '<span class="newest-pill">current</span>' : '';
      return '<div class="anchor-row' + (isNewest ? ' is-newest' : '') + '">' +
          '<div class="when">' + escapeHtml(fmtTimestamp(s.savedAt)) + newestPill + '</div>' +
          '<div class="head">' + escapeHtml(headFull) + '</div>' +
          '<div class="meta">' +
            '<strong>chainLength</strong> ' + escapeHtml(String(s.chainLength)) +
            ' · <strong>asOf</strong> ' + escapeHtml(fmtTimestamp(s.asOf)) +
            ' · <strong>genesis</strong> ' + escapeHtml(String(s.genesis || '')) +
          '</div>' +
        '</div>';
    }).join('');
    timelineEl.hidden = false;
  }

  function showState(which) {
    loadingEl.hidden = which !== 'loading';
    emptyEl.hidden = which !== 'empty';
    errorEl.hidden = which !== 'error';
    if (which !== 'timeline') timelineEl.hidden = true;
  }

  showState('loading');

  fetch('/api/audit-anchor/history', { credentials: 'omit' })
    .then(function (r) {
      if (!r.ok) throw new Error('history HTTP ' + r.status);
      return r.json();
    })
    .then(function (body) {
      if (!body || body.ok === false) throw new Error('history not ok');
      var snapshots = Array.isArray(body.snapshots) ? body.snapshots : [];
      if (snapshots.length === 0) {
        showState('empty');
        return;
      }
      showState('timeline');
      renderTimeline(snapshots);
    })
    .catch(function () {
      showState('error');
    });
}());
