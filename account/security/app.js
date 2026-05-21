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
      // Sprint password-auth-v1 — initialise the password card. /api/auth/me
      // carries hasPassword so we render the right variant on first paint.
      loadPasswordCard();
      // Sprint mfa-totp-v1 — initialise the two-factor card.
      loadMfaCard();
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

  // ── Sprint password-auth-v1 — password card ──────────
  function applyPasswordCard(hasPassword) {
    var subNone = document.getElementById('pwSubNone');
    var subHas = document.getElementById('pwSubHas');
    var currentRow = document.getElementById('currentPwRow');
    var clearBtn = document.getElementById('pwClearBtn');
    var submitBtn = document.getElementById('pwSubmitBtn');
    if (hasPassword) {
      if (subNone) subNone.hidden = true;
      if (subHas) subHas.hidden = false;
      if (currentRow) currentRow.hidden = false;
      if (clearBtn) clearBtn.hidden = false;
      if (submitBtn) submitBtn.textContent = 'Change password';
    } else {
      if (subNone) subNone.hidden = false;
      if (subHas) subHas.hidden = true;
      if (currentRow) currentRow.hidden = true;
      if (clearBtn) clearBtn.hidden = true;
      if (submitBtn) submitBtn.textContent = 'Set password';
    }
  }

  function showPwError(msg) {
    var el = document.getElementById('pwErr');
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = msg;
  }
  function showPwOk(msg) {
    var el = document.getElementById('pwOk');
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = msg;
  }

  function loadPasswordCard() {
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        applyPasswordCard(!!data.hasPassword);
      })
      .catch(function () { /* non-blocking */ });
    var form = document.getElementById('pwForm');
    if (form && !form._wired) {
      form._wired = true;
      form.addEventListener('submit', onPwSubmit);
      var clearBtn = document.getElementById('pwClearBtn');
      if (clearBtn) clearBtn.addEventListener('click', onPwClear);
    }
  }

  function onPwSubmit(e) {
    e.preventDefault();
    showPwError(''); showPwOk('');
    var newPw = (document.getElementById('newPassword').value || '');
    var curPwEl = document.getElementById('currentPassword');
    var curPw = curPwEl ? (curPwEl.value || '') : '';
    var currentRow = document.getElementById('currentPwRow');
    var needCurrent = currentRow && !currentRow.hidden;
    if (newPw.length < 12) { showPwError('Password must be at least 12 characters.'); return; }
    if (needCurrent && !curPw) { showPwError('Enter your current password.'); return; }
    var btn = document.getElementById('pwSubmitBtn');
    btn.disabled = true;
    var oldLabel = btn.textContent;
    btn.textContent = 'Saving…';
    var body = { newPassword: newPw };
    if (needCurrent) body.currentPassword = curPw;
    fetch('/api/auth/password/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (resp) {
        btn.disabled = false;
        btn.textContent = oldLabel;
        if (resp.ok) {
          document.getElementById('newPassword').value = '';
          if (curPwEl) curPwEl.value = '';
          applyPasswordCard(true);
          showPwOk(needCurrent ? 'Password updated.' : 'Password set. You can now sign in with email + password.');
        } else {
          showPwError((resp.j && resp.j.error) || 'Could not save password.');
        }
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = oldLabel;
        showPwError('Network error: ' + (err && err.message ? err.message : 'unknown'));
      });
  }

  function onPwClear() {
    showPwError(''); showPwOk('');
    var ok = confirm('Remove your password? After this, magic-link will be the only way to sign in.');
    if (!ok) return;
    var curPwEl = document.getElementById('currentPassword');
    var curPw = curPwEl ? (curPwEl.value || '') : '';
    if (!curPw) { showPwError('Enter your current password before removing it.'); return; }
    var btn = document.getElementById('pwClearBtn');
    btn.disabled = true;
    btn.textContent = 'Removing…';
    fetch('/api/auth/password/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ currentPassword: curPw }),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (resp) {
        btn.disabled = false;
        btn.textContent = 'Remove password';
        if (resp.ok) {
          if (curPwEl) curPwEl.value = '';
          document.getElementById('newPassword').value = '';
          applyPasswordCard(false);
          showPwOk('Password removed. Use magic-link to sign in next time.');
        } else {
          showPwError((resp.j && resp.j.error) || 'Could not remove password.');
        }
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Remove password';
        showPwError('Network error: ' + (err && err.message ? err.message : 'unknown'));
      });
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

  // ── Sprint mfa-totp-v1 — two-factor card ─────────────
  function mfaEl(id) { return document.getElementById(id); }
  function mfaShow(id, on) { var el = mfaEl(id); if (el) el.hidden = !on; }
  function mfaErr(msg) { var el = mfaEl('mfaErr'); if (el) { el.hidden = !msg; el.textContent = msg || ''; } }
  function mfaOk(msg) { var el = mfaEl('mfaOk'); if (el) { el.hidden = !msg; el.textContent = msg || ''; } }

  // Render the card for the OFF (not enrolled) state.
  function mfaRenderOff() {
    mfaShow('mfaSubOff', true); mfaShow('mfaSubOn', false);
    mfaShow('mfaSetup', false); mfaShow('mfaBackup', false); mfaShow('mfaDisableRow', false);
    mfaShow('mfaBeginBtn', true); mfaShow('mfaEnableBtn', false);
    mfaShow('mfaDisableBtn', false); mfaShow('mfaConfirmDisableBtn', false);
  }
  // Render the card for the ON (enabled) state.
  function mfaRenderOn() {
    mfaShow('mfaSubOff', false); mfaShow('mfaSubOn', true);
    mfaShow('mfaSetup', false); mfaShow('mfaDisableRow', false);
    mfaShow('mfaBeginBtn', false); mfaShow('mfaEnableBtn', false);
    mfaShow('mfaDisableBtn', true); mfaShow('mfaConfirmDisableBtn', false);
  }

  function loadMfaCard() {
    if (!mfaEl('mfaCard')) return;
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        if (data.mfaEnabled) mfaRenderOn(); else mfaRenderOff();
      })
      .catch(function () { /* non-blocking */ });

    var beginBtn = mfaEl('mfaBeginBtn');
    if (beginBtn && !beginBtn._wired) {
      beginBtn._wired = true;
      beginBtn.addEventListener('click', onMfaBegin);
    }
    var enableBtn = mfaEl('mfaEnableBtn');
    if (enableBtn && !enableBtn._wired) {
      enableBtn._wired = true;
      enableBtn.addEventListener('click', onMfaEnable);
    }
    var disableBtn = mfaEl('mfaDisableBtn');
    if (disableBtn && !disableBtn._wired) {
      disableBtn._wired = true;
      disableBtn.addEventListener('click', function () {
        // Reveal the code field + confirm button.
        mfaErr(''); mfaOk('');
        mfaShow('mfaDisableRow', true);
        mfaShow('mfaConfirmDisableBtn', true);
        disableBtn.hidden = true;
      });
    }
    var confirmDisableBtn = mfaEl('mfaConfirmDisableBtn');
    if (confirmDisableBtn && !confirmDisableBtn._wired) {
      confirmDisableBtn._wired = true;
      confirmDisableBtn.addEventListener('click', onMfaDisable);
    }
  }

  function onMfaBegin() {
    mfaErr(''); mfaOk('');
    var btn = mfaEl('mfaBeginBtn');
    btn.disabled = true;
    fetch('/api/auth/mfa/begin', { method: 'POST', credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (resp) {
        btn.disabled = false;
        if (!resp.ok) { mfaErr((resp.j && resp.j.error) || 'Could not start setup.'); return; }
        var secret = mfaEl('mfaSecret');
        if (secret) secret.textContent = resp.j.secret || '';
        var link = mfaEl('mfaOtpauthLink');
        if (link && resp.j.otpauthUri) link.setAttribute('href', resp.j.otpauthUri);
        mfaShow('mfaSetup', true);
        mfaShow('mfaBeginBtn', false);
        mfaShow('mfaEnableBtn', true);
      })
      .catch(function () { btn.disabled = false; mfaErr('Network error. Try again.'); });
  }

  function onMfaEnable() {
    mfaErr(''); mfaOk('');
    var code = (mfaEl('mfaCode').value || '').replace(/\s/g, '');
    if (!/^[0-9]{6}$/.test(code)) { mfaErr('Enter the 6-digit code from your app.'); return; }
    var btn = mfaEl('mfaEnableBtn');
    btn.disabled = true;
    fetch('/api/auth/mfa/enable', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code }),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (resp) {
        btn.disabled = false;
        if (!resp.ok) { mfaErr((resp.j && resp.j.error) || 'Could not enable two-factor.'); return; }
        // Show backup codes once.
        var list = mfaEl('mfaBackupList');
        if (list && Array.isArray(resp.j.backupCodes)) {
          list.innerHTML = resp.j.backupCodes.map(function (c) {
            return '<li>' + escapeHtml(c) + '</li>';
          }).join('');
        }
        mfaShow('mfaSetup', false);
        mfaShow('mfaEnableBtn', false);
        mfaShow('mfaBackup', true);
        mfaShow('mfaSubOff', false);
        mfaShow('mfaSubOn', true);
        mfaShow('mfaDisableBtn', true);
        mfaOk('Two-factor is now on.');
      })
      .catch(function () { btn.disabled = false; mfaErr('Network error. Try again.'); });
  }

  function onMfaDisable() {
    mfaErr(''); mfaOk('');
    var code = (mfaEl('mfaDisableCode').value || '').replace(/\s/g, '');
    if (!code) { mfaErr('Enter a current code (or backup code) to disable.'); return; }
    var btn = mfaEl('mfaConfirmDisableBtn');
    btn.disabled = true;
    fetch('/api/auth/mfa/disable', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code }),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (resp) {
        btn.disabled = false;
        if (!resp.ok) { mfaErr((resp.j && resp.j.error) || 'Could not disable two-factor.'); return; }
        mfaEl('mfaDisableCode').value = '';
        mfaShow('mfaBackup', false);
        mfaRenderOff();
        mfaOk('Two-factor has been turned off.');
      })
      .catch(function () { btn.disabled = false; mfaErr('Network error. Try again.'); });
  }

  document.addEventListener('DOMContentLoaded', load);
})();
