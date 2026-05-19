// /account/security/ — Sprint BG-3.2 phase 2 client.
//
// GET /api/auth/sessions on load, render each session with a revoke
// button. The current session is highlighted. Revoking the current
// session also clears the cookie server-side and bounces to /account/.

'use strict';

(function () {
  if (typeof document === 'undefined') return;

  var els = {
    authNeeded: document.getElementById('authNeeded'),
    content: document.getElementById('content'),
    sessions: document.getElementById('sessions'),
    empty: document.getElementById('empty'),
    err: document.getElementById('err'),
    legacyBanner: document.getElementById('legacyBanner'),
  };

  function showError(msg) {
    els.err.hidden = false;
    els.err.textContent = msg;
  }

  function clearError() {
    els.err.hidden = true;
    els.err.textContent = '';
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  // Crude UA parser — enough to label "Chrome on macOS" / "Safari on iOS"
  // / "Firefox on Windows". Full UA still appears in a smaller line below.
  function summariseUa(ua) {
    if (!ua) return 'Unknown device';
    var browser = 'Browser';
    if (/Edg\//i.test(ua)) browser = 'Edge';
    else if (/Firefox\//i.test(ua)) browser = 'Firefox';
    else if (/Chrome\//i.test(ua) && !/OPR\//i.test(ua)) browser = 'Chrome';
    else if (/Safari\//i.test(ua)) browser = 'Safari';
    else if (/OPR\//i.test(ua)) browser = 'Opera';
    var os = 'Unknown OS';
    if (/iPhone|iPad/i.test(ua)) os = 'iOS';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
    else if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Linux/i.test(ua)) os = 'Linux';
    return browser + ' on ' + os;
  }

  function fmtTimestamp(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  }

  function renderSession(s) {
    var classes = ['session-row'];
    if (s.isCurrent) classes.push('current');
    var pill = s.isCurrent
      ? '<span class="pill current">This device</span>'
      : '';
    var summary = escapeHtml(summariseUa(s.ua));
    var fullUa = s.ua ? '<div class="when">' + escapeHtml(s.ua) + '</div>' : '';
    var when = '<div class="when">Started ' + escapeHtml(fmtTimestamp(s.createdAt))
      + (s.lastSeenAt && s.lastSeenAt !== s.createdAt
          ? ' · last seen ' + escapeHtml(fmtTimestamp(s.lastSeenAt))
          : '')
      + ' · sid <code>' + escapeHtml(String(s.sid).slice(0, 8)) + '…</code></div>';
    var label = s.isCurrent
      ? 'Revoke (sign out here)'
      : 'Revoke';
    return '<div class="' + classes.join(' ') + '" data-sid="' + escapeHtml(s.sid) + '">'
      + '<div>'
      +   '<div class="ua">' + pill + summary + '</div>'
      + '</div>'
      + '<div class="actions"><button type="button" class="revoke-btn" data-action="revoke">' + label + '</button></div>'
      + when + fullUa
      + '</div>';
  }

  async function load() {
    clearError();
    try {
      var resp = await fetch('/api/auth/sessions', { credentials: 'same-origin' });
      if (resp.status === 401) {
        els.authNeeded.hidden = false;
        return;
      }
      if (!resp.ok) {
        els.content.hidden = false;
        showError('Could not load sessions (HTTP ' + resp.status + ').');
        return;
      }
      var data = await resp.json();
      els.content.hidden = false;
      // Show the legacy banner if the user's current cookie has no sid —
      // that's the pre-Sprint BG-3.2-phase-2 state.
      if (data && !data.currentSid) {
        els.legacyBanner.hidden = false;
      }
      var sessions = (data && data.sessions) || [];
      if (sessions.length === 0) {
        els.empty.hidden = false;
        return;
      }
      els.sessions.innerHTML = sessions.map(renderSession).join('');
      els.sessions.querySelectorAll('[data-action="revoke"]').forEach(function (btn) {
        btn.addEventListener('click', function () { onRevoke(btn); });
      });
    } catch (err) {
      els.content.hidden = false;
      showError('Network error: ' + (err && err.message ? err.message : 'unknown'));
    }
  }

  async function onRevoke(btn) {
    var row = btn.closest('.session-row');
    if (!row) return;
    var sid = row.getAttribute('data-sid');
    if (!sid) return;
    var isCurrent = row.classList.contains('current');
    var confirmMsg = isCurrent
      ? 'Revoke THIS session? You will be signed out on this device immediately.'
      : 'Revoke this session? The other device will be signed out on its next request.';
    if (!confirm(confirmMsg)) return;
    btn.disabled = true;
    btn.textContent = 'Revoking…';
    try {
      var resp = await fetch('/api/auth/sessions/' + encodeURIComponent(sid) + '/revoke', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!resp.ok) {
        showError('Could not revoke session (HTTP ' + resp.status + ').');
        btn.disabled = false;
        btn.textContent = isCurrent ? 'Revoke (sign out here)' : 'Revoke';
        return;
      }
      if (isCurrent) {
        // Server cleared the cookie; bounce to /account/.
        window.location.href = '/account/';
        return;
      }
      // Otherwise just drop the row.
      row.remove();
      if (!els.sessions.querySelector('.session-row')) {
        els.empty.hidden = false;
      }
    } catch (err) {
      showError('Network error: ' + (err && err.message ? err.message : 'unknown'));
      btn.disabled = false;
      btn.textContent = isCurrent ? 'Revoke (sign out here)' : 'Revoke';
    }
  }

  document.addEventListener('DOMContentLoaded', load);
})();
