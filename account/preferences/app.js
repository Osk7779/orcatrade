// /account/preferences/ — Sprint prefs-v1 client.
//
// One GET to /api/account/preferences on load, then per-toggle POSTs
// with optimistic-ish UX: switch flips immediately, server confirms
// on the response. If the POST fails the switch reverts.

'use strict';

(function () {
  if (typeof document === 'undefined') return;

  var els = {
    authNeeded: document.getElementById('authNeeded'),
    content: document.getElementById('content'),
    flash: document.getElementById('saved-flash'),
    err: document.getElementById('err'),
  };

  function showFlash() {
    els.flash.classList.add('show');
    clearTimeout(showFlash._t);
    showFlash._t = setTimeout(function () {
      els.flash.classList.remove('show');
    }, 1600);
  }

  function showError(msg) {
    els.err.hidden = false;
    els.err.textContent = msg;
  }

  function clearError() {
    els.err.hidden = true;
    els.err.textContent = '';
  }

  async function load() {
    try {
      var resp = await fetch('/api/account/preferences', { credentials: 'same-origin' });
      if (resp.status === 401) {
        els.authNeeded.hidden = false;
        return;
      }
      if (!resp.ok) {
        els.content.hidden = false;
        showError('Could not load preferences (HTTP ' + resp.status + ').');
        return;
      }
      var data = await resp.json();
      els.content.hidden = false;
      // Apply current values to every switch on the page. New pref
      // keys added in a later sprint just need a matching DOM element.
      var toggles = document.querySelectorAll('input[data-pref-key]');
      toggles.forEach(function (input) {
        var key = input.getAttribute('data-pref-key');
        input.checked = data.prefs && data.prefs[key] === true;
        input.disabled = false;
        input.addEventListener('change', function () { savePref(input, key); });
      });
      // Sprint email-locale-v1 — locale selector. The server returns
      // the current value + the allowedLocales array; we set the
      // <select> and listen for change. Skipped silently if the page
      // doesn't carry the selector (forwards-compat with future trims).
      var localeSelect = document.querySelector('select[data-pref-key="locale"]');
      if (localeSelect && data.prefs && data.prefs.locale) {
        localeSelect.value = data.prefs.locale;
        localeSelect.disabled = false;
        localeSelect.addEventListener('change', function () { saveLocale(localeSelect); });
      }
    } catch (err) {
      els.content.hidden = false;
      showError('Network error: ' + (err && err.message ? err.message : 'unknown'));
    }
  }

  async function savePref(input, key) {
    clearError();
    var nextValue = input.checked;
    input.disabled = true;
    var body = {};
    body[key] = nextValue;
    try {
      var resp = await fetch('/api/account/preferences', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        // Revert.
        input.checked = !nextValue;
        showError('Could not save (HTTP ' + resp.status + '). Reverted.');
        return;
      }
      showFlash();
    } catch (err) {
      input.checked = !nextValue;
      showError('Network error: ' + (err && err.message ? err.message : 'unknown') + '. Reverted.');
    } finally {
      input.disabled = false;
    }
  }

  // Sprint email-locale-v1 — string-valued counterpart to savePref.
  async function saveLocale(select) {
    clearError();
    var nextValue = select.value;
    var prevValue = select.getAttribute('data-prev') || nextValue;
    select.disabled = true;
    try {
      var resp = await fetch('/api/account/preferences', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: nextValue }),
      });
      if (!resp.ok) {
        select.value = prevValue;
        showError('Could not save (HTTP ' + resp.status + '). Reverted.');
        return;
      }
      select.setAttribute('data-prev', nextValue);
      showFlash();
    } catch (err) {
      select.value = prevValue;
      showError('Network error: ' + (err && err.message ? err.message : 'unknown') + '. Reverted.');
    } finally {
      select.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', load);
})();
