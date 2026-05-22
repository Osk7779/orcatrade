// /account/screen/ — Sprint sanctions-ui-v1 client.
// Posts a counterparty name to /api/screen and renders potential matches.
// The endpoint never returns an all-clear, so a "no match" still shows the
// mandatory advisory to screen against the official lists.
(function () {
  'use strict';

  var els = {
    authNeeded: document.getElementById('authNeeded'),
    content: document.getElementById('content'),
    nameInput: document.getElementById('nameInput'),
    screenBtn: document.getElementById('screenBtn'),
    status: document.getElementById('status'),
    matches: document.getElementById('matches'),
    advisory: document.getElementById('advisory'),
    err: document.getElementById('err'),
  };

  var STATUS_LABEL = {
    potential_match: 'Potential match — investigate',
    no_sample_match: 'No match in sample — NOT cleared',
    invalid: 'Enter a name to screen',
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showError(msg) { els.err.hidden = false; els.err.textContent = msg; }
  function clearError() { els.err.hidden = true; els.err.textContent = ''; }

  function renderMatch(m) {
    return '' +
      '<div class="match">' +
        '<div>' +
          '<div class="name">' + esc(m.name) + '</div>' +
          '<div class="meta">' + esc((m.type || '') + ' · ' + (m.programme || '') + ' · ' + (m.listSource || '')) +
            (m.matchedOn && m.matchedOn !== m.name ? ' · matched on "' + esc(m.matchedOn) + '"' : '') + '</div>' +
        '</div>' +
        '<div class="score">' + esc((m.score != null ? Math.round(m.score * 100) : '') + '%') + '</div>' +
      '</div>';
  }

  function render(result) {
    els.status.hidden = false;
    els.status.className = 'status ' + (result.status || 'invalid');
    els.status.textContent = STATUS_LABEL[result.status] || result.status || '';
    els.matches.innerHTML = (result.matches || []).map(renderMatch).join('');
    if (result.advisory) {
      els.advisory.hidden = false;
      els.advisory.textContent = result.advisory;
    }
  }

  async function screen() {
    clearError();
    var name = els.nameInput.value.trim();
    if (!name) { showError('Enter a name to screen.'); return; }
    els.screenBtn.disabled = true;
    els.screenBtn.textContent = 'Screening…';
    try {
      var resp = await fetch('/api/screen', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name }),
      });
      if (!resp.ok) {
        var body = null; try { body = await resp.json(); } catch (_) { /* */ }
        showError((body && body.error) ? body.error : ('Screening failed (HTTP ' + resp.status + ').'));
        return;
      }
      render(await resp.json());
    } catch (err) {
      showError('Network error: ' + (err && err.message ? err.message : 'unknown'));
    } finally {
      els.screenBtn.disabled = false;
      els.screenBtn.textContent = 'Screen →';
    }
  }

  async function init() {
    // Gate the page on a session (consistent with the other account tools),
    // using the lightweight account overview probe.
    try {
      var probe = await fetch('/api/account/overview', { credentials: 'same-origin' });
      if (probe.status === 401) { els.authNeeded.hidden = false; return; }
    } catch (_) { /* fall through — show the tool, the API is still usable */ }
    els.content.hidden = false;
    els.screenBtn.addEventListener('click', screen);
    els.nameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') screen(); });
  }

  init();
})();
